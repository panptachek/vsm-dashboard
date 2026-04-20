"""
Analytics & Map endpoints — дополнение к wip_routes.py.
Подключение в api/main.py:
    from wip_analytics_routes import router as wip_analytics_router
    app.include_router(wip_analytics_router)
"""
from __future__ import annotations

from datetime import date as date_cls, timedelta
from typing import Optional

from fastapi import APIRouter, Query

from main import query, query_one  # noqa: E402
from wip_routes import _expand_sections, _parse_range  # noqa: E402

router = APIRouter(prefix="/api/wip", tags=["wip-analytics"])


# ── analytics summary ───────────────────────────────────────────────────

@router.get("/analytics/summary")
def analytics_summary(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    Возвращает абсолютные числа (без процентов) в разрезе категорий:
      sand, soil, shps, transport — и по каждой разбивка
      {total, by_section, by_shift, plan, fact, by_contractor}.
    На фронте процент вычисляется только в прогресс-барах (fact/plan).
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where_mm = ["mm.report_date >= %s", "mm.report_date <= %s"]
    params_mm: list = [d_from, d_to]
    if codes:
        where_mm.append("cs.code = ANY(%s)")
        params_mm.append(codes)

    # Транспорт: факт перевозок в м³/рейсах по материалу × участку × смене × подрядчику
    rows = query(
        f"""
        SELECT m.code            AS material,
               cs.code           AS section_code,
               mm.shift,
               c.kind            AS contractor_kind,
               c.short_name      AS contractor_short,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN contractors c ON c.id = mm.contractor_id
        WHERE {' AND '.join(where_mm)}
          AND mm.movement_type IN ('pit_to_constructive','stockpile_to_constructive')
        GROUP BY m.code, cs.code, mm.shift, c.kind, c.short_name
        """,
        params_mm,
    )

    MAT_CAT = {'SAND': 'sand', 'SOIL': 'soil', 'SHPGS': 'shps', 'PEAT': 'peat'}
    SECTIONS_ALL = ['UCH_1','UCH_2','UCH_31','UCH_32','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']

    def empty_cat() -> dict:
        return {
            'fact': 0.0, 'plan': 0.0,
            'trips': 0,
            'by_section': {s: 0.0 for s in SECTIONS_ALL},
            'by_shift': {'day': 0.0, 'night': 0.0},
            'by_contractor': {'own': 0.0, 'almaz': 0.0, 'other_hired': 0.0},
        }

    cats: dict[str, dict] = {
        'sand': empty_cat(),
        'soil': empty_cat(),
        'shps': empty_cat(),
        'peat': empty_cat(),
        'transport': empty_cat(),  # агрегат всех материалов
    }

    for r in rows:
        cat = MAT_CAT.get(r['material'])
        v = float(r['volume'] or 0)
        t = int(r['trips'] or 0)
        sec = r['section_code']
        shift = r['shift'] if r['shift'] in ('day', 'night') else 'day'
        if r['contractor_kind'] == 'own':
            bucket = 'own'
        elif (r['contractor_short'] or '').upper() == 'АЛМАЗ':
            bucket = 'almaz'
        else:
            bucket = 'other_hired'

        for target in filter(None, [cat, 'transport']):
            c = cats[target]
            c['fact'] += v
            c['trips'] += t
            c['by_shift'][shift] += v
            c['by_contractor'][bucket] += v
            if sec in c['by_section']:
                c['by_section'][sec] += v

    # План по материалам — из project_work_items × materials
    plan_rows = query(
        """
        SELECT m.code AS material,
               COALESCE(SUM(pwi.project_volume), 0)::numeric AS plan
        FROM project_work_items pwi
        JOIN work_types wt ON wt.id = pwi.work_type_id
        LEFT JOIN materials m ON m.code =
          CASE wt.code
            WHEN 'EMBANKMENT_CONSTRUCTION' THEN 'SAND'
            WHEN 'PAVEMENT_SANDING'        THEN 'SAND'
            WHEN 'WEAK_SOIL_REPLACEMENT'   THEN 'SAND'
            WHEN 'EARTH_EXCAVATION'        THEN 'SOIL'
            WHEN 'CRUSHED_STONE_PLACEMENT' THEN 'SHPGS'
            ELSE NULL
          END
        WHERE m.code IS NOT NULL
        GROUP BY m.code
        """
    )
    for r in plan_rows:
        cat = MAT_CAT.get(r['material'])
        if cat and cat in cats:
            cats[cat]['plan'] = float(r['plan'] or 0)
    cats['transport']['plan'] = cats['sand']['plan']

    # Округление
    for c in cats.values():
        c['fact'] = round(c['fact'], 1)
        c['plan'] = round(c['plan'], 1)
        c['by_shift'] = {k: round(v, 1) for k, v in c['by_shift'].items()}
        c['by_section'] = {k: round(v, 1) for k, v in c['by_section'].items()}
        c['by_contractor'] = {k: round(v, 1) for k, v in c['by_contractor'].items()}

    return {
        'from': d_from.isoformat(),
        'to': d_to.isoformat(),
        'categories': cats,
        'sections': SECTIONS_ALL,
    }


# ── analytics donut: volume per quarry ─────────────────────────────────

@router.get("/analytics/quarry-donut")
def analytics_quarry_donut(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
    material: Optional[str] = None,
):
    """Донат-диаграмма: объёмы по карьерам."""
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["mm.report_date >= %s", "mm.report_date <= %s"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)
    if material:
        where.append("m.code = %s")
        params.append(material)

    rows = query(
        f"""
        SELECT pit.id          AS quarry_id,
               pit.name         AS quarry_name,
               pit.start_lat, pit.start_lng,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips,
               m.code           AS material
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN objects pit ON pit.id = mm.from_object_id
        WHERE {' AND '.join(where)}
          AND pit.id IS NOT NULL
        GROUP BY pit.id, pit.name, pit.start_lat, pit.start_lng, m.code
        ORDER BY volume DESC
        """,
        params,
    )

    total = sum(float(r['volume'] or 0) for r in rows)
    out = []
    for r in rows:
        v = float(r['volume'] or 0)
        out.append({
            'quarry_id': str(r['quarry_id']),
            'quarry_name': r['quarry_name'],
            'material': r['material'],
            'volume': round(v, 1),
            'trips': int(r['trips'] or 0),
            'share': round(v / total * 100, 1) if total > 0 else 0,
            'lat': float(r['start_lat']) if r['start_lat'] else None,
            'lng': float(r['start_lng']) if r['start_lng'] else None,
        })
    return {'total': round(total, 1), 'rows': out}


# ── map: всё для карты v2 ──────────────────────────────────────────────

@router.get("/map/markers")
def map_markers():
    """
    Единый запрос для карты: карьеры, свайные поля, мосты, ИССО,
    накопители, базы. Каждое — с типом, координатами, лейблом.
    Под обозначения из `Условные обозначения.html`.
    """
    objects = query(
        """
        SELECT o.id, o.object_code, o.name,
               ot.code AS type_code, ot.name AS type_name,
               os.pk_start, os.pk_end, os.pk_raw_text,
               os.start_lat, os.start_lng, os.end_lat, os.end_lng
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id
        LEFT JOIN object_segments os ON os.object_id = o.id
        WHERE os.start_lat IS NOT NULL
        ORDER BY ot.code, os.pk_start
        """
    )
    piles = query(
        """
        SELECT id, field_code, field_type, pile_type,
               pk_start, pk_end, pile_count, dynamic_test_count,
               start_lat, start_lng, end_lat, end_lng
        FROM pile_fields
        WHERE start_lat IS NOT NULL
        ORDER BY pk_start
        """
    )
    roads = query(
        """
        SELECT tr.id, tr.code, tr.name,
               tr.ad_pk_start, tr.ad_pk_end,
               trg.geom_geojson AS geojson
        FROM temporary_roads tr
        LEFT JOIN temporary_road_geometry trg ON trg.road_id = tr.id
        WHERE tr.is_active = true
        """
    )

    # Cast numerics → floats
    def _coord(r: dict, *keys: str) -> None:
        for k in keys:
            if r.get(k) is not None:
                r[k] = float(r[k])

    for r in objects: _coord(r, 'pk_start','pk_end','start_lat','start_lng','end_lat','end_lng')
    for r in piles:   _coord(r, 'pk_start','pk_end','start_lat','start_lng','end_lat','end_lng')
    for r in roads:   _coord(r, 'ad_pk_start','ad_pk_end')

    # Километровые точки вдоль оси (каждые 1000 м = 10 ПК)
    km_posts = query(
        """
        SELECT pk_number, latitude, longitude
        FROM route_pickets
        WHERE pk_number % 10 = 0
        ORDER BY pk_number
        """
    )
    for p in km_posts:
        p['latitude']  = float(p['latitude'])
        p['longitude'] = float(p['longitude'])

    return {
        'objects': objects,
        'piles': piles,
        'temp_roads': roads,
        'km_posts': km_posts,
    }
