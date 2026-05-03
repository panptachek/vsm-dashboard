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
from wip_routes import _expand_sections, _parse_range, _merge_section  # noqa: E402

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
          AND mm.movement_type IN ('pit_to_constructive','pit_to_stockpile')
        GROUP BY m.code, cs.code, mm.shift, c.kind, c.short_name
        """,
        params_mm,
    )

    MAT_CAT = {'SAND': 'sand', 'SOIL': 'soil', 'SHPGS': 'shps', 'PEAT': 'peat'}
    SECTIONS_ALL = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']

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


# ── analytics works summary (показатели по основным работам) ──────────

# Семантическое соответствие UI-категории → (work_type_codes, constructive_codes)
# constructive_codes=None → любые конструктивы.
WORKS_CATEGORIES = {
    'SAND':     (['EMBANKMENT_CONSTRUCTION', 'PAVEMENT_SANDING'], None),
    'PRS':      (['TOPSOIL_STRIPPING'], None),
    'VYEMKA':   (['EARTH_EXCAVATION'], ['VPD']),              # временные притрассовые дороги
    'VYEMKA_OH':(['EARTH_EXCAVATION'], ['MAIN', 'POH']),      # основной ход
    'SCHEBEN':  ([], None),                                    # TODO: отдельный материал в БД
    'SHPS':     (['CRUSHED_STONE_PLACEMENT', 'FIRST_PROTECTIVE_LAYER'], None),
}


@router.get("/analytics/works-summary")
def analytics_works_summary(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    «Показатели по основным работам»: факт и план по категориям работ
    (sand=насыпь песком+ДО, PRS=срезка, VYEMKA=выемка на ВПД, VYEMKA_OH=выемка ОХ,
    shps=ЩПС/ЩПГС работы). Возвращает тот же shape, что и analytics/summary,
    только факт считается из daily_work_items (реальные работы, не перевозка).
    Плюс отдельная категория `transport` — из material_movements (сохранена).
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    SECTIONS_ALL = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']

    def empty_cat() -> dict:
        return {
            'fact': 0.0, 'plan': 0.0,
            'trips': 0,
            'by_section': {s: 0.0 for s in SECTIONS_ALL},
            'by_shift': {'day': 0.0, 'night': 0.0},
            'by_contractor': {'own': 0.0, 'almaz': 0.0, 'other_hired': 0.0},
        }

    cats: dict[str, dict] = {k: empty_cat() for k in list(WORKS_CATEGORIES.keys()) + ['transport']}

    # 1. Факты работ из daily_work_items × constructives × contractors
    where_dwi = ["dwi.report_date BETWEEN %s AND %s"]
    params_dwi: list = [d_from, d_to]
    if codes:
        where_dwi.append("cs.code = ANY(%s)")
        params_dwi.append(codes)
    work_rows = query(
        f"""
        SELECT wt.code           AS wt_code,
               cs.code            AS section_code,
               COALESCE(LOWER(dwi.shift), 'day') AS shift,
               c.code             AS constructive_code,
               LOWER(COALESCE(dwi.contractor_name, '')) AS contractor_name_lower,
               dwi.labor_source_type AS labor_src,
               SUM(dwi.volume)::numeric AS volume
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        LEFT JOIN constructives c ON c.id = dwi.constructive_id
        WHERE {' AND '.join(where_dwi)}
        GROUP BY wt.code, cs.code, dwi.shift, c.code, dwi.contractor_name, dwi.labor_source_type
        """,
        params_dwi,
    )

    for r in work_rows:
        v = float(r['volume'] or 0)
        sec = r['section_code']
        shift = r['shift'] if r['shift'] in ('day','night') else 'day'
        contr = r['contractor_name_lower'] or ''
        if r['labor_src'] == 'own':
            bucket = 'own'
        elif 'алмаз' in contr:
            bucket = 'almaz'
        else:
            bucket = 'other_hired'
        for cat_key, (wt_codes, constr_codes) in WORKS_CATEGORIES.items():
            if r['wt_code'] not in wt_codes:
                continue
            if constr_codes and r['constructive_code'] not in constr_codes:
                continue
            c = cats[cat_key]
            c['fact'] += v
            c['by_shift'][shift] += v
            c['by_contractor'][bucket] += v
            if sec in c['by_section']:
                c['by_section'][sec] += v

    # 2. Транспорт — отдельная категория из material_movements (не перезаписывается работами)
    where_mm = ["mm.report_date BETWEEN %s AND %s"]
    params_mm: list = [d_from, d_to]
    if codes:
        where_mm.append("cs.code = ANY(%s)")
        params_mm.append(codes)
    tr_rows = query(
        f"""
        SELECT cs.code AS section_code,
               LOWER(COALESCE(mm.shift, 'day')) AS shift,
               LOWER(COALESCE(mm.contractor_name, '')) AS contractor_name_lower,
               mm.labor_source_type AS labor_src,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips
        FROM material_movements mm
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE {' AND '.join(where_mm)}
        GROUP BY cs.code, mm.shift, mm.contractor_name, mm.labor_source_type
        """,
        params_mm,
    )
    tr = cats['transport']
    for r in tr_rows:
        v = float(r['volume'] or 0)
        t = int(r['trips'] or 0)
        sec = r['section_code']
        shift = r['shift'] if r['shift'] in ('day','night') else 'day'
        contr = r['contractor_name_lower'] or ''
        if r['labor_src'] == 'own':
            bucket = 'own'
        elif 'алмаз' in contr:
            bucket = 'almaz'
        else:
            bucket = 'other_hired'
        tr['fact'] += v
        tr['trips'] += t
        tr['by_shift'][shift] += v
        tr['by_contractor'][bucket] += v
        if sec in tr['by_section']:
            tr['by_section'][sec] += v

    # 3. План — из project_work_items, группируем по wt_code (как в summary)
    plan_rows = query(
        """
        SELECT wt.code AS wt_code, COALESCE(SUM(pwi.project_volume), 0)::numeric AS plan
        FROM project_work_items pwi
        JOIN work_types wt ON wt.id = pwi.work_type_id
        GROUP BY wt.code
        """
    )
    plan_by_wt = {r['wt_code']: float(r['plan'] or 0) for r in plan_rows}
    for cat_key, (wt_codes, _) in WORKS_CATEGORIES.items():
        cats[cat_key]['plan'] = round(sum(plan_by_wt.get(c, 0) for c in wt_codes), 1)
    cats['transport']['plan'] = cats['SAND']['plan']

    # Округление
    for c in cats.values():
        c['fact'] = round(c['fact'], 1)
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
    source_type: Optional[str] = Query(None, description="quarry | stockpile; default — все"),
):
    """Донат-диаграмма: объёмы по источникам (карьеры/накопители).

    source_type:
      quarry    — только from_object_type = BORROW_PIT (реальные карьеры)
      stockpile — только STOCKPILE (накопители)
      (none)    — всё вместе (back-compat).
    """
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
    if source_type == 'quarry':
        # Только BORROW_PIT + movement_type=pit_to_stockpile (возка с карьеров в накопители).
        where.append("ot.code = 'BORROW_PIT'")
        where.append("mm.movement_type = 'pit_to_stockpile'")
    elif source_type == 'stockpile':
        # «Источники в конструктив»: все movement_types, оканчивающиеся в конструктив.
        # Сейчас в БД есть только stockpile_to_constructive, но если появится
        # pit_to_constructive — оно тоже попадёт (источник = BORROW_PIT).
        where.append("mm.movement_type IN ('stockpile_to_constructive', 'pit_to_constructive')")

    # Группируем по (pit × material), чтобы не дублировать карьер, если он
    # возит несколько материалов — материал пойдёт как дополнительное поле,
    # но для вывода агрегируем по pit (сумма материалов на один карьер).
    rows = query(
        f"""
        SELECT pit.id          AS quarry_id,
               pit.name         AS quarry_name,
               os.start_lat     AS start_lat,
               os.start_lng     AS start_lng,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips,
               STRING_AGG(DISTINCT m.code, ',' ORDER BY m.code) AS materials
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN objects pit ON pit.id = mm.from_object_id
        LEFT JOIN object_types ot ON ot.id = pit.object_type_id
        LEFT JOIN LATERAL (
            SELECT start_lat, start_lng
            FROM object_segments
            WHERE object_id = pit.id
            ORDER BY pk_start
            LIMIT 1
        ) os ON true
        WHERE {' AND '.join(where)}
          AND pit.id IS NOT NULL
        GROUP BY pit.id, pit.name, os.start_lat, os.start_lng
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
            'material': r['materials'],  # CSV материалов; может быть null
            'volume': round(v, 1),
            'trips': int(r['trips'] or 0),
            'share': round(v / total * 100, 1) if total > 0 else 0,
            'lat': float(r['start_lat']) if r['start_lat'] else None,
            'lng': float(r['start_lng']) if r['start_lng'] else None,
        })
    return {'total': round(total, 1), 'rows': out}


# ── analytics timeseries (за период, по дням per-category) ─────────────

@router.get("/analytics/works-timeseries")
def works_timeseries(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    category: str = Query("SAND"),
):
    """Ряд (дата, факт) per-category для спарклайна + heatmap (дата × участок).

    category: SAND | PRS | VYEMKA | VYEMKA_OH | SCHEBEN | SHPS | TRANSPORT
    """
    d_from, d_to = _parse_range(date_from, date_to)
    spec = WORKS_CATEGORIES.get(category.upper())
    if category.upper() == 'TRANSPORT' or spec is None:
        # Перевозка = material_movements (всё)
        rows = query(
            """
            SELECT mm.report_date AS d, cs.code AS sec, SUM(mm.volume)::numeric AS v
            FROM material_movements mm
            LEFT JOIN construction_sections cs ON cs.id = mm.section_id
            WHERE mm.report_date BETWEEN %s AND %s
            GROUP BY mm.report_date, cs.code
            """, (d_from, d_to))
    else:
        wt_codes, constr_codes = spec
        where = ["dwi.report_date BETWEEN %s AND %s", "wt.code = ANY(%s)"]
        params: list = [d_from, d_to, list(wt_codes)]
        if constr_codes:
            where.append("c.code = ANY(%s)")
            params.append(list(constr_codes))
        rows = query(
            f"""
            SELECT dwi.report_date AS d, cs.code AS sec, SUM(dwi.volume)::numeric AS v
            FROM daily_work_items dwi
            JOIN work_types wt ON wt.id = dwi.work_type_id
            LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
            LEFT JOIN constructives c ON c.id = dwi.constructive_id
            WHERE {' AND '.join(where)}
            GROUP BY dwi.report_date, cs.code
            """, params)

    by_day: dict[str, float] = {}
    by_day_sec: dict[tuple, float] = {}
    for r in rows:
        d = r['d'].isoformat()
        sec = _merge_section(r['sec']) or r['sec'] or '—'
        v = float(r['v'] or 0)
        by_day[d] = by_day.get(d, 0) + v
        by_day_sec[(d, sec)] = by_day_sec.get((d, sec), 0) + v
    # Заполняем пустые дни нулями.
    days = []
    cur = d_from
    while cur <= d_to:
        days.append(cur.isoformat())
        cur += timedelta(days=1)
    sections_all = ['UCH_1','UCH_2','UCH_3','UCH_4','UCH_5','UCH_6','UCH_7','UCH_8']
    timeseries = [{'date': d, 'value': round(by_day.get(d, 0), 1)} for d in days]
    heatmap = []
    for d in days:
        for sec in sections_all:
            v = by_day_sec.get((d, sec), 0)
            heatmap.append({'date': d, 'section': sec, 'value': round(v, 1)})
    return {'from': d_from.isoformat(), 'to': d_to.isoformat(),
            'category': category, 'days': days, 'sections': sections_all,
            'timeseries': timeseries, 'heatmap': heatmap}


# ── daily summary + per-section temp-roads stats ──────────────────────

# Маппинг road_code → список участков — для сумм по участку.
ROAD_SECTIONS = {
    'АД9': [1], 'АД6': [1], 'АД5': [1], 'АД13': [1],
    'АД14': [2],
    'АД7': [3], 'АД15': [3], 'АД1': [3],
    'АД8 №1': [3, 4],   # сплит: 3 до ПК2925+20, 4 после (упрощаем — пополам).
    'АД3': [4],
    'АД8 №2': [5], 'АД11': [5],
    'АД12': [6], 'АД2 №6': [6],
    'АД2 №7': [7], 'АД4 №7': [7],
    'АД4 №8': [7, 8],
    'АД4 №8.1': [8], 'АД4 №9': [8],
}


@router.get("/analytics/daily-summary")
def daily_summary(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """Сводка «Выполнение за период»: работы, возка, сваи, проблемы + срез 3 этапа на дату to."""
    d_from, d_to = _parse_range(date_from, date_to)

    # 1) Работы за сутки — sum volume по wt_code
    work_rows = query(
        """
        SELECT wt.code AS wt_code, wt.name AS wt_name,
               MAX(COALESCE(dwi.unit, wt.default_unit)) AS unit,
               SUM(dwi.volume)::numeric AS volume
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        WHERE dwi.report_date BETWEEN %s AND %s
        GROUP BY wt.code, wt.name
        """,
        (d_from, d_to),
    )
    works_by_code = {r['wt_code']: {
        'name': r['wt_name'], 'unit': r['unit'],
        'volume': float(r['volume'] or 0),
    } for r in work_rows}

    def pick(codes: list[str]) -> float:
        return sum(works_by_code.get(c, {}).get('volume', 0) for c in codes)

    # 2) Возка материалов за сутки — разбивка по contractor
    mm_rows = query(
        """
        SELECT mat.code AS mat,
               mm.labor_source_type AS labor_src,
               LOWER(COALESCE(mm.contractor_name, '')) AS contractor_name,
               SUM(mm.volume)::numeric AS v
        FROM material_movements mm
        LEFT JOIN materials mat ON mat.id = mm.material_id
        WHERE mm.report_date BETWEEN %s AND %s
        GROUP BY mat.code, mm.labor_source_type, mm.contractor_name
        """,
        (d_from, d_to),
    )
    mat_by_contractor: dict[str, dict[str, float]] = {}
    for r in mm_rows:
        mat = (r['mat'] or 'OTHER').upper()
        v = float(r['v'] or 0)
        contr = r['contractor_name'] or ''
        if r['labor_src'] == 'own':
            bucket = 'own'
        elif 'алмаз' in contr:
            bucket = 'almaz'
        else:
            bucket = 'hired'
        mat_by_contractor.setdefault(mat, {'own': 0.0, 'almaz': 0.0, 'hired': 0.0, 'total': 0.0})
        mat_by_contractor[mat][bucket] += v
        mat_by_contractor[mat]['total'] += v

    # 3) Сваи — из daily_work_items PILE_*
    piles = {
        'main':  works_by_code.get('PILE_MAIN', {}).get('volume', 0),
        'trial': works_by_code.get('PILE_TRIAL', {}).get('volume', 0),
        'dyntest': works_by_code.get('PILE_DYNTEST', {}).get('volume', 0),
    }

    summary = {
        'prs_m3':     pick(['TOPSOIL_STRIPPING']),
        'vyemka_m3':  pick(['EARTH_EXCAVATION']),
        'shpgs_m3':   pick(['CRUSHED_STONE_PLACEMENT', 'FIRST_PROTECTIVE_LAYER']),
        'sand_transport': mat_by_contractor.get('SAND', {'own': 0, 'almaz': 0, 'hired': 0, 'total': 0}),
        'shpgs_transport': mat_by_contractor.get('SHPGS', {'own': 0, 'almaz': 0, 'hired': 0, 'total': 0}),
        'soil_transport': mat_by_contractor.get('SOIL', {'own': 0, 'almaz': 0, 'hired': 0, 'total': 0}),
        'piles': {
            'main': int(piles['main']),
            'trial': int(piles['trial']),
            'dyntest': int(piles['dyntest']),
            'total': int(piles['main']) + int(piles['trial']),
        },
    }

    # 4) Проблемные вопросы за сутки
    problems = query(
        """
        SELECT cs.code AS section_code, dr.report_date, p.problem_text
        FROM daily_report_problems p
        JOIN daily_reports dr ON dr.id = p.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE dr.report_date BETWEEN %s AND %s
        ORDER BY cs.code, p.sort_order
        """,
        (d_from, d_to),
    )
    problem_list = [{
        'section_code': _merge_section(p['section_code']) or p['section_code'] or '—',
        'date': p['report_date'].isoformat(),
        'text': p['problem_text'],
    } for p in problems]

    # 5) Сводные показатели по 3 этапу — читаем кумулятив дорог и считаем per section.
    roads = query(
        """
        SELECT tr.id, tr.road_code, tr.ad_start_pk, tr.ad_end_pk,
               tr.rail_start_pk, tr.rail_end_pk
        FROM temporary_roads tr
        """
    )
    road_info = {r['road_code']: r for r in roads}

    # Cumulative per road per status на d_to
    segs = query(
        """
        SELECT tr.road_code, s.status_type,
               s.road_pk_start, s.road_pk_end,
               s.rail_pk_start, s.rail_pk_end
        FROM temporary_road_status_segments s
        JOIN temporary_roads tr ON tr.id = s.road_id
        WHERE s.status_date <= %s
        """,
        (d_to,),
    )
    PRIORITY = ["shpgs_done", "ready_for_shpgs", "dso", "subgrade_not_to_grade", "pioneer_fill"]

    def merge_ranges(ranges):
        clean = sorted((min(float(a), float(b)), max(float(a), float(b)))
                        for a, b in ranges if a is not None and b is not None)
        if not clean:
            return []
        merged = [list(clean[0])]
        for s, e in clean[1:]:
            if s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        return [tuple(x) for x in merged]

    def subtract(base, exclude):
        if not exclude:
            return list(base)
        result = []
        mexcl = merge_ranges(exclude)
        for bs, be in base:
            cur = bs
            for es, ee in mexcl:
                if ee <= cur:
                    continue
                if es >= be:
                    break
                if es > cur:
                    result.append((cur, es))
                cur = max(cur, ee)
            if cur < be:
                result.append((cur, be))
        return merge_ranges(result)

    # По дороге — кумулятив exclusive (приоритет)
    road_covered: dict[str, dict[str, list]] = {}
    by_road_status: dict[str, dict[str, list]] = {}
    for r in segs:
        code = r['road_code']
        st = r['status_type']
        # Берём AD-ранж (а если нет — translate из rail через road info)
        info = road_info.get(code)
        if not info:
            continue
        ad_s, ad_e = r['road_pk_start'], r['road_pk_end']
        if ad_s is None and r['rail_pk_start'] is not None and info['rail_start_pk'] is not None:
            rail_span = float(info['rail_end_pk']) - float(info['rail_start_pk'])
            ad_span = float(info['ad_end_pk']) - float(info['ad_start_pk'])
            if abs(rail_span) > 1e-4:
                t0 = (float(r['rail_pk_start']) - float(info['rail_start_pk'])) / rail_span
                t1 = (float(r['rail_pk_end']) - float(info['rail_start_pk'])) / rail_span
                a0 = float(info['ad_start_pk']) + t0 * ad_span
                a1 = float(info['ad_start_pk']) + t1 * ad_span
                ad_s, ad_e = min(a0, a1), max(a0, a1)
        if ad_s is None or ad_e is None:
            continue
        by_road_status.setdefault(code, {}).setdefault(st, []).append((float(ad_s), float(ad_e)))

    # Exclusive по приоритету на каждой дороге
    per_section: dict[int, dict] = {n: {
        'length_m': 0.0, 'pioneer': 0.0, 'work': 0.0, 'dso': 0.0,
        'ready': 0.0, 'done': 0.0, 'no_work': 0.0,
    } for n in range(1, 9)}
    total_per_status = {st: 0.0 for st in PRIORITY + ['no_work']}

    for code, info in road_info.items():
        total_ad = abs(float(info['ad_end_pk']) - float(info['ad_start_pk']))
        road_sts = by_road_status.get(code, {})
        merged = {st: merge_ranges(road_sts.get(st, [])) for st in PRIORITY}
        claimed = []
        exclusive = {}
        for st in PRIORITY:
            exclusive[st] = subtract(merged[st], claimed)
            claimed.extend(exclusive[st])
            claimed = merge_ranges(claimed)
        lengths = {st: sum(abs(e - s) for s, e in exclusive[st]) for st in PRIORITY}
        worked = sum(lengths.values())
        lengths['no_work'] = max(total_ad - worked, 0)

        sections_for_road = ROAD_SECTIONS.get(code, [])
        # Для простоты: если road в нескольких участках, делим пополам.
        fractions = [1.0 / len(sections_for_road)] if sections_for_road else []
        for sec_n in sections_for_road:
            f = 1.0 / len(sections_for_road)
            per_section[sec_n]['length_m'] += total_ad * f
            per_section[sec_n]['pioneer'] += lengths['pioneer_fill'] * f
            per_section[sec_n]['work'] += lengths['subgrade_not_to_grade'] * f
            per_section[sec_n]['dso'] += lengths['dso'] * f
            per_section[sec_n]['ready'] += lengths['ready_for_shpgs'] * f
            per_section[sec_n]['done'] += lengths['shpgs_done'] * f
            per_section[sec_n]['no_work'] += lengths['no_work'] * f
        for st in PRIORITY:
            total_per_status[st] += lengths[st]
        total_per_status['no_work'] += lengths['no_work']

    total_length = sum(s['length_m'] for s in per_section.values())
    total_done = total_per_status['shpgs_done']
    total_ready_plus_done = total_per_status['ready_for_shpgs'] + total_per_status['shpgs_done']
    total_passable = total_length - total_per_status['no_work']  # всё покрытое = доступно

    # Requested rate (требуемый темп): остаток_нe_под_щпгс_на_дату / дней_до_target(01.05.2026)
    target = date_cls(2026, 5, 15)
    days_to_target = max((target - d_to).days, 1)
    sections_out = []
    for n in range(1, 9):
        s = per_section[n]
        l = s['length_m']
        rpd = s['ready'] + s['done']
        # ЗП, не переданное под ЩПГС (остаток к цели)
        remaining = max(l - rpd, 0)
        sections_out.append({
            'section': n,
            'length_m': round(l, 2),
            'ready_plus_done_m': round(rpd, 2),
            'pct_ready_plus_done': round(rpd / l * 100, 1) if l > 0 else 0,
            'required_rate_m_per_day': round(remaining / days_to_target, 2),
        })

    return {
        'from': d_from.isoformat(),
        'to': d_to.isoformat(),
        'summary': summary,
        'problems': problem_list,
        'stage3': {
            'total_length_m': round(total_length, 2),
            'passable_m': round(total_passable, 2),
            'completed_m': round(total_done, 2),
            'ready_plus_done_m': round(total_ready_plus_done, 2),
            'required_rate_m_per_day_total': round(
                max(total_length - total_ready_plus_done, 0) / days_to_target, 2),
            'target_date': target.isoformat(),
            'days_to_target': days_to_target,
            'sections': sections_out,
        },
    }


# ── analytics stockpile balances ───────────────────────────────────────

@router.get("/analytics/stockpile-balances")
def analytics_stockpile_balances(
    as_of: Optional[str] = Query(None, description="YYYY-MM-DD; если позже максимума — берём максимум"),
):
    """Состояние накопителей на выбранную дату.

    Баланс = сумма inbound (pit_to_stockpile, to_object=stockpile) минус
    outbound (stockpile_to_constructive, from_object=stockpile).
    Возвращает строки {section, material, stockpile_name, balance, last_mov_date}.
    """
    # Последняя дата движений в БД
    r = query_one(
        "SELECT MAX(report_date) AS max_date FROM material_movements WHERE is_demo IS NOT TRUE OR is_demo = true"
    )
    max_date = r['max_date'] if r else None
    effective_date = None
    note = None
    if as_of:
        try:
            effective_date = date_cls.fromisoformat(as_of)
        except Exception:
            effective_date = None
    if max_date is None:
        return {'as_of': None, 'effective_date': None, 'rows': [], 'note': 'нет данных о движениях'}
    if effective_date is None or effective_date > max_date:
        if effective_date is not None and effective_date > max_date:
            note = f"Запрошенная дата {effective_date.isoformat()} позже последней актуальной — показываем состояние на {max_date.isoformat()}"
        effective_date = max_date

    # Таблица stockpiles пустая — используем objects с типом STOCKPILE.
    # Материал выводим из имени (Накопитель песка / торфа / ЩПГС) и из movements.
    rows = query(
        """
        WITH sp AS (
          SELECT obj.id AS object_id, obj.name AS object_name,
                 (REGEXP_MATCHES(obj.name, 'участок[[:space:]]*№[[:space:]]*([[:digit:]]+)'))[1]::int AS sec_num,
                 CASE
                   WHEN obj.name ILIKE '%%песка%%' OR obj.name ILIKE '%%песок%%' THEN 'SAND'
                   WHEN obj.name ILIKE '%%торфа%%' OR obj.name ILIKE '%%торф%%' THEN 'PEAT'
                   WHEN obj.name ILIKE '%%ЩПГС%%' OR obj.name ILIKE '%%ЩПС%%' OR obj.name ILIKE '%%щебен%%' THEN 'SHPGS'
                   ELSE 'OTHER'
                 END AS material_code
          FROM objects obj
          JOIN object_types ot ON ot.id = obj.object_type_id
          WHERE ot.code = 'STOCKPILE'
        ),
        mats AS (
          SELECT code, name FROM materials
        ),
        inbound AS (
          SELECT mm.to_object_id AS obj_id, SUM(mm.volume)::numeric AS v
          FROM material_movements mm
          WHERE mm.report_date <= %s AND mm.movement_type = 'pit_to_stockpile'
          GROUP BY mm.to_object_id
        ),
        outbound AS (
          SELECT mm.from_object_id AS obj_id, SUM(mm.volume)::numeric AS v
          FROM material_movements mm
          WHERE mm.report_date <= %s AND mm.movement_type IN ('stockpile_to_constructive', 'constructive_to_dump')
          GROUP BY mm.from_object_id
        )
        SELECT sp.object_id, sp.object_name, sp.sec_num,
               sp.material_code,
               COALESCE(m.name, sp.material_code) AS material_name,
               COALESCE(i.v, 0)::numeric AS inbound_vol,
               COALESCE(o.v, 0)::numeric AS outbound_vol,
               (COALESCE(i.v, 0) - COALESCE(o.v, 0))::numeric AS balance
        FROM sp
        LEFT JOIN mats m ON m.code = sp.material_code
        LEFT JOIN inbound i ON i.obj_id = sp.object_id
        LEFT JOIN outbound o ON o.obj_id = sp.object_id
        WHERE sp.sec_num IS NOT NULL
        ORDER BY sp.sec_num, sp.material_code
        """,
        (effective_date, effective_date),
    )

    out = []
    for r in rows:
        out.append({
            'stockpile_id': str(r['object_id']),
            'stockpile_name': r['object_name'] or '—',
            'section_num': int(r['sec_num']) if r['sec_num'] else None,
            'material_code': r['material_code'],
            'material_name': r['material_name'],
            'inbound': round(float(r['inbound_vol'] or 0), 1),
            'outbound': round(float(r['outbound_vol'] or 0), 1),
            'balance': round(float(r['balance'] or 0), 1),
        })
    return {
        'as_of': as_of,
        'effective_date': effective_date.isoformat(),
        'max_date': max_date.isoformat(),
        'note': note,
        'rows': out,
    }


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
        SELECT tr.id,
               tr.road_code AS code,
               tr.road_name AS name,
               tr.ad_start_pk AS ad_pk_start,
               tr.ad_end_pk   AS ad_pk_end,
               NULL::text      AS geojson
        FROM temporary_roads tr
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
        WHERE pk_number %% 10 = 0
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


# ── map: equipment on pickets ───────────────────────────────────────────

@router.get("/map/equipment")
def map_equipment(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    Агрегат по технике, привязанной к пикетам.
    Группировка: section_code × equipment_type.
    pk — середина диапазона участка (из construction_section_versions).

    Возвращает [{pk, sec, type, count}]:
      pk    — целый ПК (середина секции) — для отрисовки на карте;
      sec   — section_code (UCH_31 / UCH_32 раздельно, UI сливает);
      type  — нормализованный код: dump/excav/dozer/grader/roller/loader;
      count — суммарное число единиц со статусом working.
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["dr.report_date >= %s", "dr.report_date <= %s", "reu.status = 'working'"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)

    # Нормализация типа техники: в БД — русские, на карте — латинские коды
    type_case = """
      CASE LOWER(reu.equipment_type)
        WHEN 'самосвал'     THEN 'dump'
        WHEN 'экскаватор'   THEN 'excav'
        WHEN 'бульдозер'    THEN 'dozer'
        WHEN 'автогрейдер'  THEN 'grader'
        WHEN 'грейдер'      THEN 'grader'
        WHEN 'каток'        THEN 'roller'
        WHEN 'погрузчик'    THEN 'loader'
        WHEN 'фр.погрузчик' THEN 'loader'
        ELSE 'other'
      END
    """

    rows = query(
        f"""
        SELECT
          cs.code AS section_code,
          {type_case} AS equip_type,
          COUNT(*)::int AS count,
          (csv.pk_start + csv.pk_end) / 2 AS mid_pk
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        LEFT JOIN construction_section_versions csv
          ON csv.section_id = cs.id AND csv.is_current = true
        WHERE {' AND '.join(where)}
          AND cs.code IS NOT NULL
        GROUP BY cs.code, {type_case}, csv.pk_start, csv.pk_end
        ORDER BY cs.code, equip_type
        """,
        params,
    )

    out = []
    for r in rows:
        if r['equip_type'] == 'other':
            continue
        mid = float(r['mid_pk']) if r['mid_pk'] is not None else None
        out.append({
            'sec': r['section_code'],
            'type': r['equip_type'],
            'count': int(r['count']),
            # pk — округляем до целого пикета (1 ПК = 100 единиц pk_start)
            'pk': round(mid / 100) if mid is not None else None,
        })
    return {'from': d_from.isoformat(), 'to': d_to.isoformat(), 'rows': out}
