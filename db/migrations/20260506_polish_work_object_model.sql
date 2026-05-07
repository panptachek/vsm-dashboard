-- VSM dashboard DB polish, 2026-05-06.
--
-- Pre-change backup:
--   /home/aboba/db_backups/works_db_v2_before_polish_20260506_164942.dump
--
-- Goals:
-- - make object_types the canonical object/work category dictionary while keeping
--   constructives as a compatibility layer for the current API;
-- - remove stale report/import fact rows;
-- - clear project_work_item_segments;
-- - keep object_segments restored/preserved;
-- - remove generated stockpile objects;
-- - add an empty pile plan table for future period plans.

BEGIN;

-- 1. Canonical object/work categories: object_types becomes the target dictionary.
ALTER TABLE object_types
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS map_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS work_accounting_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS material_accounting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_linear boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accounting_note text;

INSERT INTO object_types (
  id, code, name, created_at, sort_order, is_active, map_enabled,
  work_accounting_enabled, material_accounting_enabled, is_linear, accounting_note
)
VALUES (
  gen_random_uuid(), 'PILE_FIELD', 'Свайное поле', now(), 50, true, true,
  true, false, true, 'Свайные поля пока хранятся в отдельной таблице pile_fields.'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  map_enabled = EXCLUDED.map_enabled,
  work_accounting_enabled = EXCLUDED.work_accounting_enabled,
  material_accounting_enabled = EXCLUDED.material_accounting_enabled,
  is_linear = EXCLUDED.is_linear,
  accounting_note = EXCLUDED.accounting_note;

UPDATE object_types
SET
  sort_order = CASE code
    WHEN 'MAIN_TRACK' THEN 10
    WHEN 'TEMP_ROAD' THEN 20
    WHEN 'SERVICE_ROAD' THEN 30
    WHEN 'PIPE' THEN 40
    WHEN 'PILE_FIELD' THEN 50
    WHEN 'STOCKPILE' THEN 60
    WHEN 'BORROW_PIT' THEN 70
    WHEN 'TEMP_DUMP' THEN 80
    WHEN 'BRIDGE' THEN 90
    WHEN 'OVERPASS' THEN 91
    WHEN 'INTERSECTION_FIN' THEN 92
    WHEN 'INTERSECTION_PROP' THEN 93
    ELSE 100
  END,
  is_active = true,
  map_enabled = true,
  work_accounting_enabled = CASE
    WHEN code IN ('BRIDGE', 'OVERPASS', 'INTERSECTION_FIN', 'INTERSECTION_PROP', 'BORROW_PIT', 'TEMP_DUMP')
      THEN false
    ELSE true
  END,
  material_accounting_enabled = code IN ('BORROW_PIT', 'STOCKPILE', 'TEMP_DUMP'),
  is_linear = code IN ('MAIN_TRACK', 'TEMP_ROAD', 'SERVICE_ROAD', 'PILE_FIELD'),
  accounting_note = CASE
    WHEN code IN ('BRIDGE', 'OVERPASS') THEN 'Карта: да; учет работ: нет по текущему решению.'
    WHEN code IN ('INTERSECTION_FIN', 'INTERSECTION_PROP') THEN 'Карта/реестр пересечений; производственный учет не ведется.'
    WHEN code = 'BORROW_PIT' THEN 'Источник материалов; используется в перевозках, не как конструктив работ.'
    WHEN code = 'STOCKPILE' THEN 'Накопитель материалов; учет через stockpiles/snapshots после загрузки фактического списка.'
    WHEN code = 'PIPE' THEN 'Трубы; текущие project_work_items относятся к трубам на временных автодорогах.'
    ELSE accounting_note
  END;

-- Compatibility: current API still joins constructives, so keep it but link it
-- to canonical object_types.
ALTER TABLE constructives
  ADD COLUMN IF NOT EXISTS object_type_id uuid REFERENCES object_types(id);

UPDATE constructives c
SET object_type_id = ot.id
FROM object_types ot
WHERE (c.code, ot.code) IN (
  ('VPD', 'TEMP_ROAD'),
  ('PIPE_VPD', 'PIPE'),
  ('ISSO_PAD', 'SERVICE_ROAD'),
  ('PILE_FIELD', 'PILE_FIELD'),
  ('PJ', 'MAIN_TRACK'),
  ('STOCK', 'STOCKPILE'),
  ('PTP', 'SERVICE_ROAD'),
  ('MAIN', 'MAIN_TRACK'),
  ('ASP', 'SERVICE_ROAD'),
  ('STU', 'OTHER'),
  ('STATION', 'MAIN_TRACK')
);

UPDATE constructives
SET name = CASE code
  WHEN 'ISSO_PAD' THEN 'Площадки и проезды под ИССО'
  WHEN 'PTP' THEN 'Стартовые площадки и проезды'
  ELSE name
END
WHERE code IN ('ISSO_PAD', 'PTP');

DELETE FROM constructives c
WHERE c.code = 'POH'
  AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.constructive_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM project_work_items pwi WHERE pwi.constructive_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM daily_work_items dwi WHERE dwi.constructive_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM constructive_work_types cwt WHERE cwt.constructive_id = c.id);

-- 2. Remove stale report/import fact rows.
DELETE FROM work_item_equipment_usage;
DELETE FROM daily_work_item_segments;
DELETE FROM material_movement_equipment_usage;
DELETE FROM daily_work_items;
DELETE FROM material_movements;
DELETE FROM report_equipment_units;
DELETE FROM daily_report_parse_candidates;
DELETE FROM daily_report_personnel;
DELETE FROM daily_report_problems;
DELETE FROM daily_reports;

-- 3. Clear project work segments completely.
DELETE FROM project_work_item_segments;

-- 4. Apply WIP cleanup to project_work_items: keep pipe project items and remove
-- stale/demo whole-project volumes. New non-pipe plans will be loaded from clean data.
DELETE FROM project_work_items pwi
USING work_types wt
WHERE wt.id = pwi.work_type_id
  AND wt.code NOT LIKE 'PIPE_ARRANGEMENT_%';

UPDATE work_types
SET work_group = 'pipe_temp_road'
WHERE code LIKE 'PIPE_ARRANGEMENT_%';

DELETE FROM work_types wt
WHERE wt.code IN (
  'SOIL_WORK',
  'SHPGS_DELIVERY',
  'SAND_DELIVERY',
  'SURFACE_PROFILE',
  'PRS',
  'TRANSPORT'
)
AND NOT EXISTS (SELECT 1 FROM project_work_items pwi WHERE pwi.work_type_id = wt.id)
AND NOT EXISTS (SELECT 1 FROM daily_work_items dwi WHERE dwi.work_type_id = wt.id)
AND NOT EXISTS (SELECT 1 FROM constructive_work_types cwt WHERE cwt.work_type_id = wt.id);

-- 5. Keep only current contractors from the WIP cleanup.
DELETE FROM contractors c
WHERE COALESCE(c.short_name, c.name) NOT IN ('ЖДС', 'АЛМАЗ', 'РЛ')
  AND NOT EXISTS (SELECT 1 FROM material_movements mm WHERE mm.contractor_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM report_equipment_units reu WHERE reu.contractor_id = c.id);

INSERT INTO contractors (id, name, short_name, inn, kind, is_active, notes, created_at, updated_at)
VALUES
  (
    '3222bfcf-4b11-4812-825d-42e15ffa5d9f'::uuid,
    'ООО «ЖЕЛДОРСТРОЙ»', 'ЖДС', NULL, 'own', true,
    'собственные силы (владельцы проекта)',
    '2026-04-19 18:05:25.939621+00'::timestamptz,
    '2026-04-19 18:05:25.939621+00'::timestamptz
  ),
  (
    '7fb2e821-2513-49cd-a041-c88cf702eab9'::uuid,
    'ООО «АЛМАЗ»', 'АЛМАЗ', NULL, 'subcontractor', true,
    'основной наёмный перевозчик',
    '2026-04-19 18:05:25.939621+00'::timestamptz,
    '2026-04-19 18:05:25.939621+00'::timestamptz
  ),
  (
    'd3706259-3302-4dd6-a61f-67466a2e3286'::uuid,
    'ООО «РейлЛогистик»', 'РЛ', NULL, 'subcontractor', true,
    NULL,
    '2026-04-19 18:05:25.939621+00'::timestamptz,
    '2026-04-19 18:05:25.939621+00'::timestamptz
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  kind = EXCLUDED.kind,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes,
  updated_at = EXCLUDED.updated_at;

-- 6. Remove generated stockpile objects and their object segments.
WITH stockpile_objects AS (
  SELECT o.id
  FROM objects o
  JOIN object_types ot ON ot.id = o.object_type_id
  WHERE ot.code = 'STOCKPILE'
)
DELETE FROM object_segments os
USING stockpile_objects so
WHERE os.object_id = so.id;

WITH stockpile_objects AS (
  SELECT o.id
  FROM objects o
  JOIN object_types ot ON ot.id = o.object_type_id
  WHERE ot.code = 'STOCKPILE'
)
DELETE FROM stockpiles sp
USING stockpile_objects so
WHERE sp.object_id = so.id;

DELETE FROM objects o
USING object_types ot
WHERE ot.id = o.object_type_id
  AND ot.code = 'STOCKPILE';

-- 7. Add pile plans table for monthly/weekly/custom plan imports.
CREATE TABLE IF NOT EXISTS pile_plan_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid REFERENCES construction_sections(id),
  pile_field_id uuid REFERENCES pile_fields(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  plan_type varchar(32) NOT NULL DEFAULT 'monthly',
  planned_main_piles integer NOT NULL DEFAULT 0,
  planned_test_piles integer NOT NULL DEFAULT 0,
  planned_dynamic_tests integer NOT NULL DEFAULT 0,
  source_reference text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (planned_main_piles >= 0),
  CHECK (planned_test_piles >= 0),
  CHECK (planned_dynamic_tests >= 0),
  CHECK (section_id IS NOT NULL OR pile_field_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pile_plan_periods_section_period
  ON pile_plan_periods(section_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_pile_plan_periods_field_period
  ON pile_plan_periods(pile_field_id, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pile_plan_periods_scope
  ON pile_plan_periods(
    COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(pile_field_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_start,
    period_end,
    plan_type
  );

COMMIT;
