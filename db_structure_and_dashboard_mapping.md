# БД works_db_v2 — структура + связь с дашбордом
Дата: 2026-04-20

## Подключение
- Host: 127.0.0.1:5433
- DB: works_db_v2
- User: works_user / 27052775

## Таблицы БД (31)

### construction_section_versions (9 rows)
- `id` (uuid)
- `section_id` (uuid)
- `valid_from` (date)
- `valid_to` (date)
- `pk_start` (numeric)
- `pk_end` (numeric)
- `pk_raw_text` (text)
- `is_current` (boolean)
- `comment` (text)
- `created_at` (timestamp with time zone)

### construction_sections (10 rows)
- `id` (uuid)
- `code` (character varying)
- `name` (character varying)
- `is_active` (boolean)
- `created_at` (timestamp with time zone)
- `map_color` (character varying)
- `sort_order` (integer)

### constructive_work_types (0 rows)
- `id` (uuid)
- `constructive_id` (uuid)
- `work_type_id` (uuid)
- `created_at` (timestamp with time zone)

### constructives (12 rows)
- `id` (uuid)
- `code` (character varying)
- `name` (character varying)
- `sort_order` (integer)
- `is_active` (boolean)
- `created_at` (timestamp with time zone)

### contractors (9 rows)
- `id` (uuid)
- `name` (character varying)
- `short_name` (character varying)
- `inn` (character varying)
- `kind` (character varying)
- `is_active` (boolean)
- `notes` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)

### daily_report_parse_candidates (3 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `candidate_type` (character varying)
- `payload_json` (jsonb)
- `confidence` (numeric)
- `needs_manual_review` (boolean)
- `comment` (text)
- `created_at` (timestamp with time zone)

### daily_report_personnel (1674 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `category` (character varying)
- `person_count` (integer)
- `created_at` (timestamp with time zone)

### daily_report_problems (0 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `problem_text` (text)
- `sort_order` (integer)
- `created_at` (timestamp with time zone)

### daily_reports (561 rows)
- `id` (uuid)
- `report_date` (date)
- `shift` (character varying)
- `section_id` (uuid)
- `source_type` (character varying)
- `source_reference` (text)
- `raw_text` (text)
- `parse_status` (character varying)
- `operator_status` (character varying)
- `created_at` (timestamp with time zone)
- `status` (character varying)
- `is_demo` (boolean)

### daily_work_item_segments (0 rows)
- `id` (uuid)
- `daily_work_item_id` (uuid)
- `pk_start` (numeric)
- `pk_end` (numeric)
- `pk_raw_text` (text)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `volume_segment` (numeric)
- `is_demo` (boolean)

### daily_work_items (3117 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `report_date` (date)
- `shift` (character varying)
- `section_id` (uuid)
- `object_id` (uuid)
- `constructive_id` (uuid)
- `work_type_id` (uuid)
- `work_name_raw` (text)
- `unit` (character varying)
- `volume` (numeric)
- `labor_source_type` (character varying)
- `contractor_name` (character varying)
- `comment` (text)
- `approved_by` (character varying)
- `approved_at` (timestamp with time zone)
- `created_at` (timestamp with time zone)
- `is_demo` (boolean)

### equipment_productivity_norms (5 rows)
- `id` (uuid)
- `equipment_type` (character varying)
- `metric` (character varying)
- `value` (numeric)
- `unit` (character varying)
- `note` (text)
- `effective_from` (date)
- `effective_to` (date)
- `created_at` (timestamp with time zone)

### material_movement_equipment_usage (0 rows)
- `id` (uuid)
- `material_movement_id` (uuid)
- `report_equipment_unit_id` (uuid)
- `trips_count` (integer)
- `worked_volume` (numeric)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `is_demo` (boolean)

### material_movements (1942 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `report_date` (date)
- `shift` (character varying)
- `section_id` (uuid)
- `material_id` (uuid)
- `from_object_id` (uuid)
- `to_object_id` (uuid)
- `volume` (numeric)
- `unit` (character varying)
- `trip_count` (integer)
- `movement_type` (character varying)
- `labor_source_type` (character varying)
- `contractor_name` (character varying)
- `comment` (text)
- `approved_by` (character varying)
- `approved_at` (timestamp with time zone)
- `created_at` (timestamp with time zone)
- `equipment_type` (character varying)
- `equipment_count` (integer)
- `is_demo` (boolean)
- `contractor_id` (uuid)

### materials (4 rows)
- `id` (uuid)
- `code` (character varying)
- `name` (character varying)
- `default_unit` (character varying)
- `created_at` (timestamp with time zone)

### object_segments (125 rows)
- `id` (uuid)
- `object_id` (uuid)
- `pk_start` (numeric)
- `pk_end` (numeric)
- `pk_raw_text` (text)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `start_lat` (double precision)
- `start_lng` (double precision)
- `end_lat` (double precision)
- `end_lng` (double precision)

### object_types (12 rows)
- `id` (uuid)
- `code` (character varying)
- `name` (character varying)
- `created_at` (timestamp with time zone)

### objects (199 rows)
- `id` (uuid)
- `object_code` (character varying)
- `name` (character varying)
- `object_type_id` (uuid)
- `constructive_id` (uuid)
- `is_active` (boolean)
- `comment` (text)
- `created_at` (timestamp with time zone)

### pile_fields (299 rows)
- `id` (uuid)
- `field_code` (character varying)
- `field_type` (character varying)
- `pk_start` (numeric)
- `pk_end` (numeric)
- `pk_raw_text` (text)
- `pile_type` (character varying)
- `pile_count` (integer)
- `dynamic_test_count` (integer)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `start_lat` (double precision)
- `start_lng` (double precision)
- `end_lat` (double precision)
- `end_lng` (double precision)
- `is_demo` (boolean)

### project_work_item_segments (96 rows)
- `id` (uuid)
- `project_work_item_id` (uuid)
- `pk_start` (numeric)
- `pk_end` (numeric)
- `project_volume_segment` (numeric)
- `comment` (text)
- `created_at` (timestamp with time zone)

### project_work_items (90 rows)
- `id` (uuid)
- `object_id` (uuid)
- `constructive_id` (uuid)
- `work_type_id` (uuid)
- `project_volume` (numeric)
- `unit` (character varying)
- `source_reference` (text)
- `comment` (text)
- `created_at` (timestamp with time zone)

### report_equipment_units (7186 rows)
- `id` (uuid)
- `daily_report_id` (uuid)
- `equipment_type` (character varying)
- `brand_model` (character varying)
- `unit_number` (character varying)
- `plate_number` (character varying)
- `operator_name` (character varying)
- `ownership_type` (character varying)
- `contractor_name` (character varying)
- `status` (character varying)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `is_demo` (boolean)
- `contractor_id` (uuid)

### route_pickets (657 rows)
- `id` (integer)
- `pk_number` (integer)
- `pk_name` (character varying)
- `latitude` (double precision)
- `longitude` (double precision)
- `created_at` (timestamp with time zone)

### stockpile_balance_snapshots (0 rows)
- `id` (uuid)
- `stockpile_id` (uuid)
- `snapshot_date` (date)
- `balance_volume` (numeric)
- `unit` (character varying)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `is_demo` (boolean)

### stockpiles (0 rows)
- `id` (uuid)
- `object_id` (uuid)
- `material_id` (uuid)
- `name` (character varying)
- `is_active` (boolean)
- `created_at` (timestamp with time zone)

### temporary_road_import_runs (35 rows)
- `id` (uuid)
- `source_type` (text)
- `source_reference` (text)
- `started_at` (timestamp with time zone)
- `finished_at` (timestamp with time zone)
- `status` (text)
- `rows_total` (integer)
- `rows_loaded` (integer)
- `rows_failed` (integer)
- `message` (text)
- `created_at` (timestamp with time zone)

### temporary_road_pk_mappings (18 rows)
- `id` (uuid)
- `road_id` (uuid)
- `mapping_type` (text)
- `ad_pk_start` (numeric)
- `ad_pk_end` (numeric)
- `rail_pk_start` (numeric)
- `rail_pk_end` (numeric)
- `source_reference` (text)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)

### temporary_road_status_segments (531 rows)
- `id` (uuid)
- `road_id` (uuid)
- `status_date` (date)
- `status_type` (text)
- `input_pk_system` (text)
- `road_pk_start` (numeric)
- `road_pk_end` (numeric)
- `rail_pk_start` (numeric)
- `rail_pk_end` (numeric)
- `import_run_id` (uuid)
- `source_reference` (text)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)
- `is_demo` (boolean)

### temporary_roads (19 rows)
- `id` (uuid)
- `road_code` (text)
- `road_name` (text)
- `section_id` (uuid)
- `road_type` (text)
- `ad_start_pk` (numeric)
- `ad_end_pk` (numeric)
- `rail_start_pk` (numeric)
- `rail_end_pk` (numeric)
- `can_translate_to_rail` (boolean)
- `comment` (text)
- `created_at` (timestamp with time zone)
- `updated_at` (timestamp with time zone)

### work_item_equipment_usage (0 rows)
- `id` (uuid)
- `daily_work_item_id` (uuid)
- `report_equipment_unit_id` (uuid)
- `trips_count` (integer)
- `worked_volume` (numeric)
- `worked_area` (numeric)
- `worked_length` (numeric)
- `comment` (text)
- `created_at` (timestamp with time zone)

### work_types (92 rows)
- `id` (uuid)
- `code` (character varying)
- `name` (character varying)
- `default_unit` (character varying)
- `work_group` (character varying)
- `is_active` (boolean)
- `created_at` (timestamp with time zone)

---
## Откуда берутся данные для дашборда

### Frontend страницы

| Страница | URL | API-эндпоинты | Таблицы БД |
|----------|-----|---------------|------------|
| Аналитика | `/` | `/api/dashboard/analytics/*` | `daily_reports`, `daily_work_items`, `material_movements`, `temporary_road_*`, `pile_fields` |
| Карта | `/map` | `/api/geo/pickets`, `/api/geo/objects`, `/api/geo/pile-fields`, `/api/geo/sections` | `route_pickets`, `objects`, `object_segments`, `object_types`, `pile_fields`, `construction_sections`, `construction_section_versions` |
| Обзор | `/overview` | `/api/dashboard/summary` | `construction_sections`, `project_work_items`, `daily_work_items`, `daily_reports` |
| Выработка автосамосвалов | `/daily-quarry-report` | `/api/dashboard/analytics/quarries` | `material_movements`, `objects` (карьеры), `construction_sections` |
| Отчёты | `/reports` | `/api/reports/*` | `daily_reports`, `daily_report_parse_candidates` |
| Детали участка | `/sections/:code` | `/api/dashboard/section/{code}` | `construction_sections`, `daily_reports`, `daily_work_items` |
| WIP Обзор v2 | `/wip/overview-v2` | `/api/wip/temp-roads/status`, `/api/wip/material-flow`, `/api/wip/piles`, `/api/wip/equipment-productivity` | `temporary_road_status_segments`, `temporary_roads`, `material_movements`, `contractors`, `pile_fields`, `report_equipment_units` |
| WIP Аналитика v2 | `/wip/analytics-v2` | те же + `/api/wip/contractors` | + `contractors` |
| WIP Карта v2 | `/wip/map-v2` | `/api/geo/*` | те же, что `/map` |

### API-эндпоинты (детально)

#### Гео
- `GET /api/geo/pickets` — точки оси трассы с lat/lng (таблица `route_pickets`, 657 строк)
- `GET /api/geo/sections` — границы 8 участков в ВСЖМ ПК (таблицы `construction_sections` + `construction_section_versions`)
- `GET /api/geo/objects` — все объекты (мосты, трубы, путепроводы, пересечения) с координатами и сегментами (`objects` + `object_segments` + `object_types`)
- `GET /api/geo/pile-fields` — свайные поля (`pile_fields`, 299 строк)

#### Dashboard
- `GET /api/dashboard/summary` — KPI по 8 участкам: % готовности, план/факт, дата последнего отчёта
- `GET /api/dashboard/section/{code}` — детали участка: список работ, техники, отчётов
- `GET /api/dashboard/timeline?days=N` — активность по дням

#### Аналитика (существующие)
- `GET /api/dashboard/analytics/summary?date=YYYY-MM-DD&section=CODE` — суточный отчёт в разрезе категорий: песок, выемка, перевозка, ПРС, ЩПС и т.д. (из `daily_work_items`)
- `GET /api/dashboard/analytics/materials` — матрица материалов по участкам/сменам (`material_movements`)
- `GET /api/dashboard/analytics/equipment` — производительность техники с Ки (`report_equipment_units`)
- `GET /api/dashboard/analytics/piles` — свайные работы (`pile_fields`)
- `GET /api/dashboard/analytics/plan-fact` — план/факт (`project_work_items` vs `daily_work_items`)
- `GET /api/dashboard/analytics/quarries` — возка с карьеров по участкам (`material_movements` + `objects` карьеры)
- `GET /api/dashboard/analytics/storages` — остатки в накопителях (`stockpiles` + `stockpile_balance_snapshots`)
- `GET /api/dashboard/analytics/temp-roads?date=...` — 19 дорог, статусы отсыпки с make_exclusive (`temporary_road_status_segments` + `temporary_roads`)

#### WIP v2
- `GET /api/wip/temp-roads/status?to=YYYY-MM-DD` — статусы временных АД на дату (19 дорог)
- `GET /api/wip/material-flow?from=&to=&section=` — возка: матрица участок × карьер × подрядчик × материал
- `GET /api/wip/piles?section=` — свайные работы: поля × участок × тип сваи + испытания
- `GET /api/wip/equipment-productivity?from=&to=&section=` — прозрачная методика Ки
- `GET /api/wip/contractors` — справочник подрядчиков (ЖДС, АЛМАЗ, ДАЛЕКС и др.)

#### PDF
- `POST /api/pdf/analytics` — генерация 3-страничного PDF аналитики (A4 landscape)
- `POST /api/pdf/quarry-report` — суточный отчёт по карьерам
- `POST /api/reports/upload` — загрузка сырого отчёта
- `POST /api/reports/{id}/parse` — NLP-парсинг
- `POST /api/reports/{id}/confirm` — подтверждение и запись в БД

### Участки
- `UCH_1` — Участок 1 (active=True)
- `UCH_2` — Участок 2 (active=True)
- `UCH_3` — Участок 3 (active=False)
- `UCH_31` — Участок 3_1 (active=True)
- `UCH_32` — Участок 3_2 (active=True)
- `UCH_4` — Участок 4 (active=True)
- `UCH_5` — Участок 5 (active=True)
- `UCH_6` — Участок 6 (active=True)
- `UCH_7` — Участок 7 (active=True)
- `UCH_8` — Участок 8 (active=True)

**Важно:** Участок №3 в БД живёт как `UCH_31` + `UCH_32`. Родителя `UCH_3` нет. На UI оба кода сливаются в «Участок №3». Helper: `src/lib/sections.ts`.

### Типы объектов на карте
- `BORROW_PIT` — Карьер
- `BRIDGE` — Мост
- `INTERSECTION_FIN` — Пересечение (финансовое)
- `INTERSECTION_PROP` — Пересечение (имущественное)
- `MAIN_TRACK` — Путь основного хода
- `OTHER` — Прочее
- `OVERPASS` — Путепровод
- `PIPE` — Труба
- `SERVICE_ROAD` — Технологическая дорога
- `STOCKPILE` — Накопитель
- `TEMP_DUMP` — Временный отвал
- `TEMP_ROAD` — Временная притрассовая дорога

### Объём данных
- `daily_reports`: 561 rows
- `daily_work_items`: 3117 rows
- `material_movements`: 1942 rows
- `report_equipment_units`: 7186 rows
- `temporary_roads`: 19 rows
- `temporary_road_status_segments`: 531 rows
- `pile_fields`: 299 rows
- `route_pickets`: 657 rows
- `objects`: 199 rows
- `object_segments`: 125 rows

### Источники данных
- **Demo данные** (тег `source_type = 'demo'` в `daily_reports` + `is_demo = true` в детальных таблицах): 558 отчётов, 31 день × 2 смены × 9 участков. Удаляются одной командой: `DELETE FROM daily_reports WHERE source_type = 'demo'`.
- **Реальные отчёты по отсыпке** (PDF/XLSX от мастеров СМР): 32 даты (18.03–19.04.2026) в `temporary_road_status_segments`, 531 сегмент.
- **Ручные отчёты**: 3 `daily_reports` с `source_type = 'manual'`.
