"""
WIP endpoints for VSM dashboard v2.

Подключение в api/main.py:
    from wip_routes import router as wip_router
    app.include_router(wip_router)

Все эндпоинты под префиксом /api/wip/*. Используют тот же psycopg2-пул,
что и основной api/main.py — импортируем get_conn и query оттуда.
"""
from __future__ import annotations

import json
from datetime import date as date_cls, timedelta
from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from main import query, query_one, get_conn  # noqa: E402 — импорт из соседнего модуля

router = APIRouter(prefix="/api/wip", tags=["wip"])


# ── helpers ──────────────────────────────────────────────────────────────

def _expand_sections(section: Optional[str]) -> Optional[list[str]]:
    """'UCH_1,UCH_2' → ['UCH_1','UCH_2']. После миграции 24.04.2026 UCH_3 — один
    код, поэтому спец-раскрытие UCH_31/UCH_32 больше не нужно."""
    if not section or section == "all":
        return None
    codes = [c.strip() for c in section.split(",") if c.strip()]
    return codes or None


def _merge_section(code: Optional[str]) -> Optional[str]:
    """No-op. Исторически сворачивал UCH_31/UCH_32 в UCH_3; после миграции
    24.04.2026 все данные уже под UCH_3."""
    return code


def _equipment_bucket_by_section_date(
    d_from: date_cls, d_to: date_cls, codes: Optional[list[str]]
) -> dict[tuple, str]:
    """
    Для каждой пары (section_code_merged, report_date) определяем
    контрактор-букет по самосвалам: own → zhds, АЛМАЗ → almaz, иначе → hire.
    Выбираем букет с наибольшим числом единиц; tie-break: own > остальные.
    """
    where = ["dr.report_date BETWEEN %s AND %s",
             "reu.equipment_type IN ('самосвал','dump_truck')",
             "reu.is_demo = false"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)
    rows = query(
        f"""
        SELECT cs.code AS section_code, dr.report_date AS d,
               reu.ownership_type, c.short_name, c.kind,
               COUNT(*)::int AS units
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        LEFT JOIN contractors c ON c.id = reu.contractor_id
        WHERE {' AND '.join(where)}
        GROUP BY cs.code, dr.report_date, reu.ownership_type, c.short_name, c.kind
        """,
        params,
    )
    tally: dict[tuple, dict[str, int]] = {}
    for r in rows:
        sec = _merge_section(r["section_code"])
        if not sec:
            continue
        if r["ownership_type"] == "own" or r["kind"] == "own":
            bucket = "zhds"
        elif (r["short_name"] or "").upper() == "АЛМАЗ":
            bucket = "almaz"
        else:
            bucket = "hire"
        key = (sec, r["d"])
        tally.setdefault(key, {"zhds": 0, "almaz": 0, "hire": 0})
        tally[key][bucket] += int(r["units"] or 0)
    # Pick dominant bucket per (section, date). Tie → prefer zhds.
    priority = {"zhds": 0, "almaz": 1, "hire": 2}
    winner: dict[tuple, str] = {}
    for key, counts in tally.items():
        best = sorted(counts.items(), key=lambda x: (-x[1], priority[x[0]]))
        winner[key] = best[0][0]
    return winner


def _parse_range(
    date_from: Optional[str], date_to: Optional[str]
) -> tuple[date_cls, date_cls]:
    if not date_to:
        date_to = (date_cls.today() - timedelta(days=1)).isoformat()
    if not date_from:
        date_from = date_to
    return date_cls.fromisoformat(date_from), date_cls.fromisoformat(date_to)


# ── contractors ──────────────────────────────────────────────────────────

@router.get("/contractors")
def list_contractors():
    return query(
        """
        SELECT id, name, short_name, kind, is_active
        FROM contractors
        WHERE is_active = true
        ORDER BY
          CASE kind WHEN 'own' THEN 0 WHEN 'subcontractor' THEN 1 ELSE 2 END,
          name
        """
    )


# ── temp roads ──────────────────────────────────────────────────────────

@router.get("/temp-roads/status")
def temp_roads_status(to: Optional[str] = None):
    """
    По каждой дороге: свежий срез статусов на дату `to` (или вчера),
    посегментно. Каждый сегмент — (pk_start, pk_end, status_type).
    Схема линии рисуется на фронте по целым пикетам ПК.
    """
    _, d_to = _parse_range(None, to)

    roads = query(
        """
        SELECT tr.id, tr.road_code AS code, tr.road_name AS name,
               tr.ad_start_pk AS ad_pk_start, tr.ad_end_pk AS ad_pk_end,
               tr.rail_start_pk AS rail_pk_start, tr.rail_end_pk AS rail_pk_end,
               ABS(tr.ad_end_pk - tr.ad_start_pk) AS length_m,
               m.ad_pk_start AS m_ad_start, m.ad_pk_end AS m_ad_end,
               m.rail_pk_start AS m_rail_start, m.rail_pk_end AS m_rail_end
        FROM temporary_roads tr
        LEFT JOIN temporary_road_pk_mappings m
          ON m.road_id = tr.id AND m.mapping_type = 'full_axis_range'
        ORDER BY COALESCE(tr.rail_start_pk, 9e12), tr.road_code
        """
    )

    # Кумулятивное состояние на дату d_to: берём ВСЕ сегменты со status_date <= d_to,
    # сливаем по статусу, применяем приоритет (shpgs_done > ready_for_shpgs > dso >
    # subgrade_not_to_grade > pioneer_fill) чтобы каждый ПК был ровно в одном статусе.
    # Мёрджим в AD-координатах: в PDF длины считаются по АД-пикетажу, а rail у некоторых
    # дорог (напр. АД4 №8.1) отсутствует.
    PRIORITY = ["shpgs_done", "ready_for_shpgs", "dso", "subgrade_not_to_grade", "pioneer_fill"]

    def merge_ranges(ranges):
        if not ranges:
            return []
        s = sorted([(float(a), float(b)) for a, b in ranges], key=lambda x: x[0])
        out = [list(s[0])]
        for a, b in s[1:]:
            if a <= out[-1][1]:
                out[-1][1] = max(out[-1][1], b)
            else:
                out.append([a, b])
        return [tuple(x) for x in out]

    def subtract(ranges, holes):
        if not holes:
            return ranges
        out = list(ranges)
        for h_a, h_b in holes:
            new = []
            for a, b in out:
                if h_b <= a or h_a >= b:
                    new.append((a, b))
                else:
                    if a < h_a:
                        new.append((a, h_a))
                    if h_b < b:
                        new.append((h_b, b))
            out = new
        return out

    for r in roads:
        # Мэппинг AD↔rail: берём full_axis_range, при его отсутствии — road-level PKs.
        m_ad_s = r.pop("m_ad_start", None)
        m_ad_e = r.pop("m_ad_end", None)
        m_rail_s = r.pop("m_rail_start", None)
        m_rail_e = r.pop("m_rail_end", None)
        if None in (m_ad_s, m_ad_e, m_rail_s, m_rail_e):
            m_ad_s, m_ad_e = r["ad_pk_start"], r["ad_pk_end"]
            m_rail_s, m_rail_e = r["rail_pk_start"], r["rail_pk_end"]
        has_mapping = None not in (m_ad_s, m_ad_e, m_rail_s, m_rail_e)
        ad_span = (float(m_ad_e) - float(m_ad_s)) if has_mapping else None
        rail_span = (float(m_rail_e) - float(m_rail_s)) if has_mapping else None

        def rail_to_ad(rs, re):
            if not has_mapping or abs(rail_span) < 1e-4:
                return None, None
            t0 = (rs - float(m_rail_s)) / rail_span
            t1 = (re - float(m_rail_s)) / rail_span
            a0 = float(m_ad_s) + t0 * ad_span
            a1 = float(m_ad_s) + t1 * ad_span
            return (min(a0, a1), max(a0, a1))

        def ad_to_rail(as_, ae):
            if not has_mapping or abs(ad_span) < 1e-4:
                return None, None
            t0 = (as_ - float(m_ad_s)) / ad_span
            t1 = (ae - float(m_ad_s)) / ad_span
            r0 = float(m_rail_s) + t0 * rail_span
            r1 = float(m_rail_s) + t1 * rail_span
            return (min(r0, r1), max(r0, r1))

        raw = query(
            """
            SELECT road_pk_start, road_pk_end, rail_pk_start, rail_pk_end,
                   status_type, is_demo, MAX(status_date) OVER () AS last_date
            FROM temporary_road_status_segments
            WHERE road_id = %s AND status_date <= %s
              AND (road_pk_start IS NOT NULL OR rail_pk_start IS NOT NULL)
            """,
            (r["id"], d_to),
        )
        last_date = raw[0]["last_date"] if raw else None
        by_status = {s: [] for s in PRIORITY}
        for s in raw:
            ad_s = float(s["road_pk_start"]) if s["road_pk_start"] is not None else None
            ad_e = float(s["road_pk_end"]) if s["road_pk_end"] is not None else None
            rl_s = float(s["rail_pk_start"]) if s["rail_pk_start"] is not None else None
            rl_e = float(s["rail_pk_end"]) if s["rail_pk_end"] is not None else None
            if ad_s is None and rl_s is not None:
                ad_s, ad_e = rail_to_ad(rl_s, rl_e)
            if ad_s is None:
                continue
            if s["status_type"] in by_status:
                by_status[s["status_type"]].append((ad_s, ad_e))
        # Слияние по статусу в AD-координатах
        for st in PRIORITY:
            by_status[st] = merge_ranges(by_status[st])
        # Эксклюзивный приоритет: вычитаем у каждого нижестоящего пересечения с вышестоящими
        excl = {}
        higher = []
        for st in PRIORITY:
            excl[st] = subtract(by_status[st], higher)
            higher.extend(excl[st])
            higher = merge_ranges(higher)
        segs = []
        for st, ranges in excl.items():
            for a, b in ranges:
                if b - a >= 0.5:
                    rail = ad_to_rail(a, b) if has_mapping else (None, None)
                    segs.append({
                        "ad_pk_start": a, "ad_pk_end": b,
                        "rail_pk_start": rail[0], "rail_pk_end": rail[1],
                        # Совместимость со старым фронтом: pk_* = координата для оси
                        # (rail если есть мэппинг, иначе AD).
                        "pk_start": rail[0] if has_mapping else a,
                        "pk_end":   rail[1] if has_mapping else b,
                        "status_type": st, "is_demo": False,
                    })
        segs.sort(key=lambda x: x["ad_pk_start"])
        r["segments"] = segs
        r["effective_date"] = last_date.isoformat() if last_date else None
        r["ad_pk_start"] = float(r["ad_pk_start"]) if r["ad_pk_start"] is not None else None
        r["ad_pk_end"] = float(r["ad_pk_end"]) if r["ad_pk_end"] is not None else None
        r["rail_pk_start"] = float(r["rail_pk_start"]) if r["rail_pk_start"] is not None else None
        r["rail_pk_end"] = float(r["rail_pk_end"]) if r["rail_pk_end"] is not None else None
        r["length_m"] = float(r["length_m"]) if r["length_m"] is not None else None

    return {"as_of": d_to.isoformat(), "roads": roads}


# ── material flow ───────────────────────────────────────────────────────

@router.get("/material-flow")
def material_flow(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    Возка с карьеров. Строки = (section × material × quarry).
    В данных есть только pit_to_stockpile (карьер → накопитель) и
    stockpile_to_constructive (накопитель → насыпь). Показываем обе стадии:
      - pit_to_stockpile → строка с destination='stockpile'
        или 'constructive' (если есть встречный out на тот же section+material);
      - остаток stockpile_to_constructive, не покрытый pit_in, → синтетическая
        строка с quarry='Склад', destination='constructive'.
    Атрибуция контрактор-букета: по принадлежности самосвалов в отчётах того
    же участка и даты (contractor_id на самих movements забит мусором).
    UCH_31 и UCH_32 схлопываются в UCH_3.
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["mm.report_date BETWEEN %s AND %s", "mm.is_demo = false"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)

    rows = query(
        f"""
        SELECT cs.code              AS section_code,
               m.code                AS material,
               pit.name              AS quarry_name,
               pit.id                AS quarry_id,
               mm.movement_type,
               mm.report_date        AS d,
               SUM(mm.volume)::numeric AS volume,
               SUM(COALESCE(mm.trip_count,0))::int AS trips
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN objects pit ON pit.id = mm.from_object_id
        WHERE {' AND '.join(where)}
          AND mm.movement_type IN ('pit_to_stockpile','stockpile_to_constructive')
        GROUP BY cs.code, m.code, pit.name, pit.id, mm.movement_type, mm.report_date
        """,
        params,
    )

    bucket = _equipment_bucket_by_section_date(d_from, d_to, codes)
    # bucket → label map
    KIND = {
        "zhds": ("ЖДС", "own"),
        "almaz": ("АЛМАЗ", "subcontractor"),
        "hire": ("Наёмники", "subcontractor"),
    }

    # Агрегаты
    pit_rows: dict[tuple, dict] = {}        # key = (sec, mat, quarry_id, bucket)
    out_by_secmat: dict[tuple, float] = {}  # key = (sec, mat)
    stockpile_names: dict[tuple, str] = {}  # key = (sec, mat) → name

    for r in rows:
        sec = _merge_section(r["section_code"]) or "—"
        mat = r["material"]
        vol = float(r["volume"] or 0)
        b = bucket.get((sec, r["d"]), "hire")
        if r["movement_type"] == "pit_to_stockpile":
            key = (sec, mat, r["quarry_id"], b)
            if key not in pit_rows:
                short, kind = KIND[b]
                pit_rows[key] = {
                    "section_code": sec,
                    "material": mat,
                    "quarry_id": str(r["quarry_id"]) if r["quarry_id"] else None,
                    "quarry_name": r["quarry_name"],
                    "contractor_short": short,
                    "contractor_kind": kind,
                    "contractor_bucket": b,
                    "volume": 0.0,
                    "trips": 0,
                    "destination": "stockpile",
                }
            pit_rows[key]["volume"] += vol
            pit_rows[key]["trips"] += int(r["trips"] or 0)
        else:  # stockpile_to_constructive
            out_by_secmat[(sec, mat)] = out_by_secmat.get((sec, mat), 0) + vol
            stockpile_names.setdefault((sec, mat), r["quarry_name"] or "Склад")

    # Если на (section, material) есть stockpile_out — значит карьерный pit_in
    # по этому же (section, material) реально ушёл в насыпь. Помечаем.
    pit_in_by_secmat: dict[tuple, float] = {}
    for (sec, mat, qid, b), v in pit_rows.items():
        pit_in_by_secmat[(sec, mat)] = pit_in_by_secmat.get((sec, mat), 0) + v["volume"]
    for row in pit_rows.values():
        if out_by_secmat.get((row["section_code"], row["material"]), 0) > 0:
            row["destination"] = "constructive"

    result = list(pit_rows.values())

    # Overflow: stockpile_out > pit_in → синтетическая строка «Склад».
    # В наших данных склад это отдельный ресурс без учёта origin.
    for (sec, mat), vout in out_by_secmat.items():
        pit_in = pit_in_by_secmat.get((sec, mat), 0)
        overflow = vout - pit_in
        if overflow <= 1.0:
            continue
        # букет: доминирующий за весь период по этому участку
        bsum: dict[str, int] = {"zhds": 0, "almaz": 0, "hire": 0}
        for (s, _), b in bucket.items():
            if s == sec:
                bsum[b] += 1
        b_top = max(bsum.items(), key=lambda x: x[1])[0] if any(bsum.values()) else "hire"
        short, kind = KIND[b_top]
        result.append({
            "section_code": sec,
            "material": mat,
            "quarry_id": None,
            "quarry_name": stockpile_names.get((sec, mat), "Склад"),
            "contractor_short": short,
            "contractor_kind": kind,
            "contractor_bucket": b_top,
            "volume": round(overflow, 1),
            "trips": 0,
            "destination": "constructive",
        })

    for r in result:
        r["volume"] = round(float(r["volume"]), 1)

    result.sort(key=lambda x: (x["section_code"], x["material"], x["quarry_name"] or ""))

    return {
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "rows": result,
    }


# ── piles ──────────────────────────────────────────────────────────────

@router.get("/piles")
def piles(
    section: Optional[str] = None,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """
    Свайные работы. Группировка: участок × поле × field_type × pile_type.
    Привязка поля к участку — по PK через construction_section_versions.

    Период (`from`/`to`) сейчас не фильтрует: в схеме нет фактовой таблицы
    с датами забивки свай — pile_fields это статический каталог полей.
    Возвращаем поле `notes` с предупреждением, чтобы фронт мог показать.
    UCH_31 / UCH_32 схлопываем в UCH_3.
    """
    codes = _expand_sections(section)
    where = ["1=1"]
    params: list = []
    if codes:
        where.append(
            """
            EXISTS (
              SELECT 1
              FROM construction_section_versions csv
              JOIN construction_sections cs ON cs.id = csv.section_id
              WHERE csv.is_current = true
                AND cs.code = ANY(%s)
                AND pf.pk_start >= csv.pk_start
                AND pf.pk_end   <= csv.pk_end
            )
            """
        )
        params.append(codes)

    rows = query(
        f"""
        SELECT
          pf.id, pf.field_code, pf.field_type, pf.pile_type,
          pf.pk_start, pf.pk_end,
          pf.pile_count, pf.dynamic_test_count,
          pf.is_demo,
          COALESCE(
            (SELECT cs.code
             FROM construction_section_versions csv
             JOIN construction_sections cs ON cs.id = csv.section_id
             WHERE csv.is_current = true
               AND pf.pk_start >= csv.pk_start
               AND pf.pk_end   <= csv.pk_end
             ORDER BY csv.pk_start LIMIT 1),
            '—'
          ) AS section_code
        FROM pile_fields pf
        WHERE {' AND '.join(where)}
        ORDER BY pf.pk_start
        """,
        params,
    )

    for r in rows:
        r["pk_start"] = float(r["pk_start"]) if r["pk_start"] is not None else None
        r["pk_end"] = float(r["pk_end"]) if r["pk_end"] is not None else None
        r["section_code"] = _merge_section(r.get("section_code")) or r.get("section_code")

    # Факт забивки свай за период — из daily_work_items по PILE_* work_types
    d_from, d_to = _parse_range(date_from, date_to)
    where_dwi = ["dwi.report_date >= %s", "dwi.report_date <= %s"]
    p_dwi: list = [d_from, d_to]
    if codes:
        where_dwi.append("cs.code = ANY(%s)")
        p_dwi.append(codes)
    fact_rows = query(
        f"""
        SELECT cs.code AS section_code, wt.code AS wt_code,
               SUM(dwi.volume)::numeric AS cnt
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {' AND '.join(where_dwi)}
          AND wt.code IN ('PILE_MAIN', 'PILE_TRIAL', 'PILE_DYNTEST')
        GROUP BY cs.code, wt.code
        """,
        p_dwi,
    )
    fact_by_sec: dict[str, dict[str, float]] = {}
    for f in fact_rows:
        sec = _merge_section(f["section_code"]) or "—"
        fact_by_sec.setdefault(sec, {"main": 0.0, "test": 0.0, "dyn": 0.0})
        if f["wt_code"] == "PILE_MAIN":
            fact_by_sec[sec]["main"] += float(f["cnt"] or 0)
        elif f["wt_code"] == "PILE_TRIAL":
            fact_by_sec[sec]["test"] += float(f["cnt"] or 0)
        elif f["wt_code"] == "PILE_DYNTEST":
            fact_by_sec[sec]["dyn"] += float(f["cnt"] or 0)

    fact_totals = {"main": 0.0, "test": 0.0, "dyn": 0.0}
    for sec_facts in fact_by_sec.values():
        for k, v in sec_facts.items():
            fact_totals[k] += v

    return {
        "rows": rows,
        "fact_by_section": fact_by_sec,
        "fact_totals": fact_totals,
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat()},
    }


# ── overview table day totals ──────────────────────────────────────────

@router.get("/overview/day-totals")
def overview_day_totals(
    date: Optional[str] = Query(None),
):
    """Итоги за сутки: техника (working / ремонт), материалы, силы, ИТОГО по всем участкам.

    Используется в режиме "Таблица" на Обзоре для нижних summary-строк как в
    "старом отчёте".
    """
    d = date_cls.fromisoformat(date) if date else date_cls.today()

    # 1) Техника per (equipment_type × status).
    eq_by_type_status = query(
        """
        SELECT reu.equipment_type AS et, reu.status AS st, COUNT(*)::int AS cnt
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        WHERE dr.report_date = %s
        GROUP BY reu.equipment_type, reu.status
        """,
        (d,),
    )
    eq_working: dict[str, int] = {}
    eq_repair: dict[str, int] = {}
    for r in eq_by_type_status:
        et = (r['et'] or 'unknown').lower()
        cnt = int(r['cnt'] or 0)
        if r['st'] == 'working':
            eq_working[et] = eq_working.get(et, 0) + cnt
        else:
            eq_repair[et] = eq_repair.get(et, 0) + cnt

    # 2) Материалы (возка) × силы: sum volume per (material, bucket).
    mm_rows = query(
        """
        SELECT mat.code AS mat, mm.labor_source_type AS lsrc,
               LOWER(COALESCE(mm.contractor_name, '')) AS contr,
               SUM(mm.volume)::numeric AS v,
               SUM(mm.trip_count)::int AS trips
        FROM material_movements mm
        LEFT JOIN materials mat ON mat.id = mm.material_id
        WHERE mm.report_date = %s
        GROUP BY mat.code, mm.labor_source_type, mm.contractor_name
        """,
        (d,),
    )
    mat_totals: dict[str, dict[str, float]] = {}  # {MAT: {own, almaz, hired, total, trips}}
    grand = {'own': 0.0, 'almaz': 0.0, 'hired': 0.0, 'total': 0.0, 'trips': 0}
    for r in mm_rows:
        mat = (r['mat'] or 'OTHER').upper()
        v = float(r['v'] or 0)
        trips = int(r['trips'] or 0)
        bucket = ('own' if r['lsrc'] == 'own'
                  else 'almaz' if 'алмаз' in (r['contr'] or '')
                  else 'hired')
        slot = mat_totals.setdefault(mat, {'own': 0.0, 'almaz': 0.0, 'hired': 0.0, 'total': 0.0, 'trips': 0})
        slot[bucket] += v
        slot['total'] += v
        slot['trips'] += trips
        grand[bucket] += v
        grand['total'] += v
        grand['trips'] += trips

    return {
        'date': d.isoformat(),
        'equipment_working': eq_working,
        'equipment_repair': eq_repair,
        'equipment_working_total': sum(eq_working.values()),
        'equipment_repair_total': sum(eq_repair.values()),
        'materials': {mat: {k: (round(v, 1) if isinstance(v, float) else v) for k, v in vals.items()}
                      for mat, vals in mat_totals.items()},
        'grand': {k: (round(v, 1) if isinstance(v, float) else v) for k, v in grand.items()},
    }


# ── works by section ────────────────────────────────────────────────────

@router.get("/works-by-section")
def works_by_section(
    section: Optional[str] = None,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """
    Выполненные работы за период: плоский список записей (вид работ × конструктив ×
    участок), с объёмом, числом дней и диапазоном ПК (если он есть в segments).
    UCH_31/UCH_32 → UCH_3.
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["dwi.report_date BETWEEN %s AND %s"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)

    # Агрегация по (wt × object × section). Объект (object_id) — это конкретная
    # дорога/сооружение (например, «Притрассовая дорога №9»), конструктив — лишь
    # тип («Временные притрассовые дороги»). Пользователь хочет видеть объект.
    rows = query(
        f"""
        SELECT wt.code AS wt_code,
               wt.name AS wt_name,
               COALESCE(MAX(dwi.unit), MAX(wt.default_unit)) AS unit,
               cs.code AS section_code,
               obj.id   AS object_id,
               obj.name AS object_name,
               c.name   AS constructive_name,
               SUM(dwi.volume)::numeric AS volume,
               COUNT(DISTINCT dwi.report_date)::int AS days,
               MIN(LEAST(seg.pk_start, seg.pk_end)) AS pk_min,
               MAX(GREATEST(seg.pk_start, seg.pk_end)) AS pk_max
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        LEFT JOIN objects obj ON obj.id = dwi.object_id
        LEFT JOIN constructives c ON c.id = dwi.constructive_id
        LEFT JOIN daily_work_item_segments seg ON seg.daily_work_item_id = dwi.id
        WHERE {' AND '.join(where)}
        GROUP BY wt.code, wt.name, cs.code, obj.id, obj.name, c.name
        ORDER BY SUM(dwi.volume) DESC
        """,
        params,
    )

    out = []
    for r in rows:
        sec_raw = r["section_code"]
        sec = _merge_section(sec_raw) or sec_raw or "—"
        out.append({
            "wt_code": r["wt_code"],
            "wt_name": r["wt_name"],
            "unit": r["unit"],
            "section_code": sec,
            "object_id": str(r["object_id"]) if r["object_id"] else None,
            "object_name": r["object_name"] or "—",
            "constructive_name": r["constructive_name"] or "—",
            "volume": round(float(r["volume"] or 0), 2),
            "days": int(r["days"] or 0),
            "pk_min": float(r["pk_min"]) if r["pk_min"] is not None else None,
            "pk_max": float(r["pk_max"]) if r["pk_max"] is not None else None,
        })

    # Слить UCH_31 / UCH_32 в UCH_3.
    merged: dict[tuple, dict] = {}
    for r in out:
        key = (r["wt_code"], r["object_id"], r["section_code"])
        if key in merged:
            m = merged[key]
            m["volume"] = round(m["volume"] + r["volume"], 2)
            m["days"] = max(m["days"], r["days"])
            if r["pk_min"] is not None:
                m["pk_min"] = r["pk_min"] if m["pk_min"] is None else min(m["pk_min"], r["pk_min"])
            if r["pk_max"] is not None:
                m["pk_max"] = r["pk_max"] if m["pk_max"] is None else max(m["pk_max"], r["pk_max"])
        else:
            merged[key] = r

    def _sort_key(x):
        # Сортируем по номеру участка (UCH_1..UCH_8, «—» в конец), затем по объекту.
        sc = (x.get("section_code") or "—")
        try:
            sec_n = int(sc.replace('UCH_', '')) if sc.startswith('UCH_') else 99
        except Exception:
            sec_n = 99
        return (sec_n, x.get("object_name") or '', x.get("wt_name") or '')

    final_rows = sorted(merged.values(), key=_sort_key)
    return {
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "section": section or "all",
        "rows": final_rows,
    }


# ── equipment productivity ──────────────────────────────────────────────

# Нормы (per-unit, per-shift, коэф. загрузки уже учтён) из справочника пользователя.
# Дефолтные значения — используются при старте для сидирования и как fallback, если DB пуста.
# В рантайме загружаются через load_norms_from_db() (см. ниже).
# Ключ: (equipment_type_lower, work_type_code) → {norm, unit, code}
_DEFAULT_WORK_TYPE_NORMS: dict[tuple[str, str], dict] = {
    # Экскаватор
    ('экскаватор', 'EARTH_EXCAVATION'):         {'norm': 718.0,  'unit': 'м³', 'code': 'RzrGrn004'},
    ('экскаватор', 'PEAT_REMOVAL'):             {'norm': 718.0,  'unit': 'м³', 'code': 'RzrGrn004'},
    ('экскаватор', 'EMBANKMENT_CONSTRUCTION'):  {'norm': 718.0,  'unit': 'м³', 'code': 'RzrGrn004'},
    ('экскаватор', 'DITCH_CONSTRUCTION'):       {'norm': 450.0,  'unit': 'м³', 'code': 'UkrOtk007'},
    ('экскаватор', 'TOPSOIL_STRIPPING'):        {'norm': 700.0,  'unit': 'м³', 'code': 'SntPRS003'},
    ('экскаватор', 'AREA_GRADING'):             {'norm': 1018.0, 'unit': 'м²', 'code': 'PlnOtk001'},
    # Бульдозер
    ('бульдозер', 'TOPSOIL_STRIPPING'):         {'norm': 800.0,  'unit': 'м³', 'code': 'SntPRS001'},
    ('бульдозер', 'EARTH_EXCAVATION'):          {'norm': 500.0,  'unit': 'м³', 'code': 'RzrGrn021'},
    ('бульдозер', 'EMBANKMENT_CONSTRUCTION'):   {'norm': 1400.0, 'unit': 'м³', 'code': 'UsOsTN001'},
    ('бульдозер', 'PAVEMENT_SANDING'):          {'norm': 1400.0, 'unit': 'м³', 'code': 'UsOsTN001'},
    ('бульдозер', 'CRUSHED_STONE_PLACEMENT'):   {'norm': 1400.0, 'unit': 'м³', 'code': 'UNSOSh001'},
    ('бульдозер', 'FIRST_PROTECTIVE_LAYER'):    {'norm': 1400.0, 'unit': 'м³', 'code': 'UNSOSh001'},
    ('бульдозер', 'AREA_GRADING'):              {'norm': 2037.0, 'unit': 'м²', 'code': 'PlnZmp001'},
    # Автогрейдер
    ('автогрейдер', 'AREA_GRADING'):            {'norm': 6800.0, 'unit': 'м²', 'code': 'PlnZmp002'},
    # Каток
    ('каток', 'CONSOLIDATION'):                 {'norm': 4253.0, 'unit': 'м²', 'code': 'UplPds001'},
}

# Нормы самосвалов, разбитые по направлениям.
# SAND pit → stockpile и pit → конструктив: per-section, свои нормы.
# Для уч. 6 наёмники возят с карьера в накопитель → не учитываем для ЖДС.
_DEFAULT_SAND_PIT_DIRECTION_NORMS = {
    1: (9,  16),    # 9 рейс × 16 м³ = 144
    2: (5,  16),
    3: (4,  16),
    4: (3,  16),
    5: (3,  16),
    # уч.6: наёмники в накопитель; ЖДС не ездит с карьера — норма не определена
    7: (5,  16),
    8: (12, 16),
}
# SAND stockpile → конструктив — по своей таблице per section.
_DEFAULT_SAND_STOCKPILE_TO_CONSTR_NORMS = {
    1: (9,  16),
    2: (25, 10),
    3: (16, 10),
    4: (10, 8),
    5: (15, 7),
    6: (12, 15),
    7: (12, 16),
    8: (5,  16),
}
# Универсальная норма «прочей перевозки» (торф, ЩПС/ЩПГС, щебень, накопитель-накопитель и т.д.)
_DEFAULT_GENERIC_TRUCK_NORM = 166  # м³/смена/единица


# ── Settings: DB schema, seeding & loader ────────────────────────────────

def _ensure_settings_tables() -> None:
    """Create equipment_norms_config and work_type_aliases tables if missing."""
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS equipment_norms_config (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        category TEXT NOT NULL,
                        key JSONB NOT NULL,
                        value JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_by TEXT,
                        UNIQUE (category, key)
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS work_type_aliases (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        canonical_code TEXT NOT NULL,
                        alias_text TEXT NOT NULL UNIQUE,
                        kind TEXT NOT NULL,
                        notes TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
    finally:
        conn.close()


def _seed_norms_if_empty() -> None:
    """Populate equipment_norms_config from hardcoded defaults if table is empty."""
    row = query_one("SELECT COUNT(*)::int AS cnt FROM equipment_norms_config")
    if row and row["cnt"] > 0:
        return
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                # work_types
                for (et, wt_code), spec in _DEFAULT_WORK_TYPE_NORMS.items():
                    cur.execute(
                        "INSERT INTO equipment_norms_config (category, key, value, updated_by) "
                        "VALUES (%s, %s, %s, 'seed') ON CONFLICT DO NOTHING",
                        ('work_types',
                         json.dumps({'equipment_type': et, 'work_type_code': wt_code}),
                         json.dumps(spec)),
                    )
                # sand_pit
                for sec, (trips, m3) in _DEFAULT_SAND_PIT_DIRECTION_NORMS.items():
                    cur.execute(
                        "INSERT INTO equipment_norms_config (category, key, value, updated_by) "
                        "VALUES (%s, %s, %s, 'seed') ON CONFLICT DO NOTHING",
                        ('sand_pit',
                         json.dumps({'section': sec}),
                         json.dumps({'trips': trips, 'm3_per_trip': m3})),
                    )
                # sand_stockpile
                for sec, (trips, m3) in _DEFAULT_SAND_STOCKPILE_TO_CONSTR_NORMS.items():
                    cur.execute(
                        "INSERT INTO equipment_norms_config (category, key, value, updated_by) "
                        "VALUES (%s, %s, %s, 'seed') ON CONFLICT DO NOTHING",
                        ('sand_stockpile',
                         json.dumps({'section': sec}),
                         json.dumps({'trips': trips, 'm3_per_trip': m3})),
                    )
                # generic
                cur.execute(
                    "INSERT INTO equipment_norms_config (category, key, value, updated_by) "
                    "VALUES (%s, %s, %s, 'seed') ON CONFLICT DO NOTHING",
                    ('generic',
                     json.dumps({'name': 'truck_norm'}),
                     json.dumps({'norm_m3_per_shift': _DEFAULT_GENERIC_TRUCK_NORM})),
                )
    finally:
        conn.close()


def load_norms_from_db() -> dict:
    """Read all norms from DB. On any error, return defaults.

    Returns dict with keys:
      work_types: {(et, wt_code): {norm, unit, code}}
      sand_pit: {section_num: (trips, m3_per_trip)}
      sand_stockpile: {section_num: (trips, m3_per_trip)}
      generic_truck_norm: float
    """
    try:
        rows = query("SELECT category, key, value FROM equipment_norms_config")
    except Exception:
        return {
            'work_types': dict(_DEFAULT_WORK_TYPE_NORMS),
            'sand_pit': dict(_DEFAULT_SAND_PIT_DIRECTION_NORMS),
            'sand_stockpile': dict(_DEFAULT_SAND_STOCKPILE_TO_CONSTR_NORMS),
            'generic_truck_norm': _DEFAULT_GENERIC_TRUCK_NORM,
        }
    out = {'work_types': {}, 'sand_pit': {}, 'sand_stockpile': {},
           'generic_truck_norm': _DEFAULT_GENERIC_TRUCK_NORM}
    for r in rows:
        cat = r['category']
        key = r['key'] if isinstance(r['key'], dict) else json.loads(r['key'])
        val = r['value'] if isinstance(r['value'], dict) else json.loads(r['value'])
        if cat == 'work_types':
            et = key.get('equipment_type')
            wt = key.get('work_type_code')
            if et and wt:
                out['work_types'][(et, wt)] = val
        elif cat == 'sand_pit':
            sec = key.get('section')
            if sec is not None:
                out['sand_pit'][int(sec)] = (val.get('trips'), val.get('m3_per_trip'))
        elif cat == 'sand_stockpile':
            sec = key.get('section')
            if sec is not None:
                out['sand_stockpile'][int(sec)] = (val.get('trips'), val.get('m3_per_trip'))
        elif cat == 'generic':
            if key.get('name') == 'truck_norm':
                out['generic_truck_norm'] = float(val.get('norm_m3_per_shift') or _DEFAULT_GENERIC_TRUCK_NORM)
    # Fallback per-section: если в таблице чего-то нет, не теряем дефолт
    if not out['work_types']:
        out['work_types'] = dict(_DEFAULT_WORK_TYPE_NORMS)
    if not out['sand_pit']:
        out['sand_pit'] = dict(_DEFAULT_SAND_PIT_DIRECTION_NORMS)
    if not out['sand_stockpile']:
        out['sand_stockpile'] = dict(_DEFAULT_SAND_STOCKPILE_TO_CONSTR_NORMS)
    return out


# Мутируемые модуль-level словари, которыми пользуется остальной код.
# Инициализируются дефолтами; обновляются _refresh_norms() (startup / после PATCH).
WORK_TYPE_NORMS: dict[tuple[str, str], dict] = dict(_DEFAULT_WORK_TYPE_NORMS)
SAND_PIT_DIRECTION_NORMS: dict[int, tuple] = dict(_DEFAULT_SAND_PIT_DIRECTION_NORMS)
SAND_STOCKPILE_TO_CONSTR_NORMS: dict[int, tuple] = dict(_DEFAULT_SAND_STOCKPILE_TO_CONSTR_NORMS)
GENERIC_TRUCK_NORM: float = float(_DEFAULT_GENERIC_TRUCK_NORM)


def _refresh_norms() -> None:
    """Обновляет модульные словари из БД (атомарно, на месте)."""
    global GENERIC_TRUCK_NORM
    loaded = load_norms_from_db()
    WORK_TYPE_NORMS.clear()
    WORK_TYPE_NORMS.update(loaded['work_types'])
    SAND_PIT_DIRECTION_NORMS.clear()
    SAND_PIT_DIRECTION_NORMS.update(loaded['sand_pit'])
    SAND_STOCKPILE_TO_CONSTR_NORMS.clear()
    SAND_STOCKPILE_TO_CONSTR_NORMS.update(loaded['sand_stockpile'])
    GENERIC_TRUCK_NORM = float(loaded['generic_truck_norm'])


# Сиды алиасов для парсера отчётов. Каноническим кодом для материалов/работ
# служит код из work_types.code либо материальный идентификатор (PEAT, SOIL, SAND,
# CRUSHED_STONE, SHPGS). Для конструктивов — objects.name (точное совпадение).
_DEFAULT_ALIASES: list[tuple[str, str, str]] = [
    # (canonical_code, alias_text, kind)
    # ── materials ──
    ('PEAT', 'торф', 'material'),
    ('PEAT', 'непригодный грунт', 'material'),
    ('SOIL', 'грунт', 'material'),
    ('SOIL', 'боковые резервы', 'material'),
    ('SAND', 'песок', 'material'),
    ('CRUSHED_STONE', 'щебень', 'material'),
    ('SHPGS', 'ЩПС', 'material'),
    ('SHPGS', 'ЩПГС', 'material'),
    # ── work types ──
    ('AREA_GRADING', 'Профилирование', 'work_type'),
    ('PAVEMENT_SANDING', 'Устройство дополнительного песчаного слоя дорожной одежды', 'work_type'),
    ('PAVEMENT_SANDING', 'Отсыпка ДСО', 'work_type'),
    ('PAVEMENT_SANDING', 'Устройство дополнительного слоя ДО', 'work_type'),
    ('CONSOLIDATION', 'Уплотнение послойное', 'work_type'),
    ('CONSOLIDATION', 'Уплотнение насыпи', 'work_type'),
    ('EMBANKMENT_CONSTRUCTION', 'Устройство основания земляного полотна', 'work_type'),
    ('EARTH_EXCAVATION', 'Разработка грунта боковых резервов', 'work_type'),
    ('WEAK_SOIL_REPLACEMENT', 'Обратная засыпка песком при замене грунта', 'work_type'),
    ('PEAT_REMOVAL', 'Выемка непригодного грунта', 'work_type'),
    ('EARTH_EXCAVATION', 'Работа на отвале, перемещение грунта', 'work_type'),
    ('AREA_GRADING', 'Планировка откосов ЗП', 'work_type'),
    ('AREA_GRADING', 'Профилирование поверхности земляного полотна', 'work_type'),
    ('TOPSOIL_STRIPPING', 'Срезка растительного грунта', 'work_type'),
    ('TOPSOIL_STRIPPING', 'Снятие ПРС', 'work_type'),
    # ── constructives (canonical = objects.name) ──
    ('Притрассовая дорога №4.8', 'АД 4.8', 'constructive'),
    ('Притрассовая дорога №4.8.1', 'АД 4.8.1', 'constructive'),
    ('Притрассовая дорога №4.9', 'АД 4.9', 'constructive'),
    ('Притрассовая дорога №12', 'АД 12', 'constructive'),
]


def _seed_aliases_if_empty() -> None:
    """Наполняет work_type_aliases дефолтными алиасами, если таблица пуста.

    Идемпотентно: если записи уже есть — не трогает. Каждый INSERT — ON CONFLICT
    DO NOTHING по UNIQUE(alias_text), поэтому повторный запуск безопасен.
    """
    row = query_one("SELECT COUNT(*)::int AS cnt FROM work_type_aliases")
    if row and row["cnt"] > 0:
        return
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                for canonical, alias, kind in _DEFAULT_ALIASES:
                    cur.execute(
                        "INSERT INTO work_type_aliases (canonical_code, alias_text, kind, notes) "
                        "VALUES (%s, %s, %s, 'seed') ON CONFLICT (alias_text) DO NOTHING",
                        (canonical, alias, kind),
                    )
    finally:
        conn.close()


def _init_settings() -> None:
    """Создаёт таблицы, сидит дефолтами, подтягивает в память. Вызывается из startup."""
    try:
        _ensure_settings_tables()
        _seed_norms_if_empty()
        _seed_aliases_if_empty()
        _refresh_norms()
    except Exception:
        # Не роняем приложение при отсутствии БД на старте.
        pass

_QUARRY_BY_SEC = {1:'Карьер Васильки',2:'Карьер Васильки',3:'Карьер Васильки',4:'Карьер Васильки',
                  5:'Карьер Васильки',6:'Карьер Южные Маяки',7:'Карьер Великий',8:'Карьер Великий'}


class _DumpTruckNormsProxy:
    """Легаси-словарь: всегда берёт актуальные SAND_PIT_DIRECTION_NORMS.

    Поддерживает .get((sec, mat)) — единственный способ использования в коде.
    """
    def get(self, key, default=None):
        if not (isinstance(key, tuple) and len(key) == 2):
            return default
        n, mat = key
        if mat != 'SAND' or not isinstance(n, int) or n not in _QUARRY_BY_SEC:
            return default
        tpl = SAND_PIT_DIRECTION_NORMS.get(n, (12, 15) if n != 6 else (12, 15))
        trips = tpl[0] if n != 6 else 12
        m3 = tpl[1] if n != 6 else 15
        return {
            'quarry': _QUARRY_BY_SEC[n],
            'trips': trips,
            'm3_per_trip': m3,
            'include_pit_to_stockpile': n != 6,
        }


DUMP_TRUCK_NORMS = _DumpTruckNormsProxy()


def _sec_code_to_num(code: Optional[str]) -> Optional[int]:
    """UCH_1..UCH_8 → 1..8. UCH_31/UCH_32 → 3."""
    if not code:
        return None
    c = _merge_section(code) or code
    if not c.startswith('UCH_'):
        return None
    try:
        return int(c.split('_', 1)[1])
    except Exception:
        return None


EQUIPMENT_CATEGORIES = {
    "dump_truck": {"label": "Самосвалы", "short": "СВ"},
    "excavator": {"label": "Экскаваторы", "short": "ЭК"},
    "bulldozer": {"label": "Бульдозеры", "short": "БД"},
    "other": {"label": "Прочая", "short": "ПР"},
}


def _equipment_category(equipment_type: Optional[str]) -> str:
    et = (equipment_type or "").strip().lower()
    if "самосвал" in et or "dump" in et:
        return "dump_truck"
    if "экскав" in et or "excav" in et:
        return "excavator"
    if "бульд" in et or "dozer" in et:
        return "bulldozer"
    return "other"


@router.get("/equipment-productivity")
def equipment_productivity(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    Производительность техники по участкам × видам работ с нормативами
    из справочника пользователя (см. WORK_TYPE_NORMS, DUMP_TRUCK_NORMS).

    Для экск./бульд./автогр./катка:
      — для каждой (section, equipment_type, work_type) считаем:
        fact_vol, days_with_work, avg_units_on_those_days, norm → %
      — агрегируем в средний % по технике (по списку применимых видов работ)
      — в детализации показываем per-work-type разбивку.

    Для самосвалов (только материал=SAND):
      — норма per section из DUMP_TRUCK_NORMS
      — АЛМАЗ (contractor_name ILIKE '%алмаз%') засчитывается в факт,
        но не участвует в знаменателе
      — уч.6: учитываем только stockpile_to_constructive (наёмники не считаются).
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where_dr = ["dr.report_date BETWEEN %s AND %s"]
    params_dr: list = [d_from, d_to]
    if codes:
        where_dr.append("cs.code = ANY(%s)")
        params_dr.append(codes)

    # 1. Ед. техники per (section × date × shift × equipment_type) — шкала «смена».
    eq_rows = query(
        f"""
        SELECT cs.code AS section_code,
               dr.report_date AS report_date,
               LOWER(COALESCE(dr.shift, 'day')) AS shift,
               reu.equipment_type AS et,
               COUNT(*)::int AS units
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE {' AND '.join(where_dr)}
          AND reu.status = 'working'
        GROUP BY cs.code, dr.report_date, dr.shift, reu.equipment_type
        """,
        params_dr,
    )
    # units_by_shift[(sec, et)][(date, shift)] = units
    units_by_shift: dict[tuple, dict] = {}
    for r in eq_rows:
        sec = _merge_section(r["section_code"]) or "—"
        et = (r["et"] or "").lower()
        units_by_shift.setdefault((sec, et), {})[(r["report_date"], r["shift"])] = int(r["units"] or 0)

    # 2. Факт per (section × date × shift × work_type).
    where_dwi = ["dwi.report_date BETWEEN %s AND %s"]
    params_dwi: list = [d_from, d_to]
    if codes:
        where_dwi.append("cs.code = ANY(%s)")
        params_dwi.append(codes)
    dwi_rows = query(
        f"""
        SELECT cs.code AS section_code,
               dwi.report_date AS report_date,
               LOWER(COALESCE(dwi.shift, 'day')) AS shift,
               wt.code AS wt_code,
               wt.name AS wt_name,
               SUM(dwi.volume)::numeric AS volume
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {' AND '.join(where_dwi)}
        GROUP BY cs.code, dwi.report_date, dwi.shift, wt.code, wt.name
        HAVING SUM(dwi.volume) > 0
        """,
        params_dwi,
    )
    # facts_by_shift[(sec, wt_code)] = {(date, shift): volume}
    facts_by_shift: dict[tuple, dict] = {}
    wt_names: dict[str, str] = {}
    for r in dwi_rows:
        sec = _merge_section(r["section_code"]) or "—"
        wtc = r["wt_code"]
        wt_names[wtc] = r["wt_name"]
        facts_by_shift.setdefault((sec, wtc), {})[(r["report_date"], r["shift"])] = float(r["volume"] or 0)

    # ── Экск./бульд./автогр./каток ─────────────────────────────────────
    # Считаем per-смена: только смены, где был факт по этой работе И техника работала.
    # Expected = sum_over_shifts(units × norm); pct = fact / expected × 100.
    by_section_et: dict[tuple, dict] = {}
    for (et_norm, wt_code), norm_spec in WORK_TYPE_NORMS.items():
        for (sec, wtc), shift_vol in facts_by_shift.items():
            if wtc != wt_code:
                continue
            units_map = units_by_shift.get((sec, et_norm), {})
            fact_sum = 0.0
            expected = 0.0
            shifts_worked = 0
            units_sum = 0
            dates_with_work = set()
            for (d, sh), v in shift_vol.items():
                if v <= 0:
                    continue
                u = units_map.get((d, sh), 0)
                if u <= 0:
                    # факт есть, но ни одной единицы техники этого типа в этой смене —
                    # работу делали другой техникой/подрядчиком, в % этой техники не кладём.
                    continue
                fact_sum += v
                expected += u * norm_spec["norm"]
                shifts_worked += 1
                units_sum += u
                dates_with_work.add(d)
            if shifts_worked == 0:
                continue
            pct = (fact_sum / expected * 100) if expected > 0 else None
            avg_units = units_sum / shifts_worked

            entry = by_section_et.setdefault((sec, et_norm), {
                "section_code": sec,
                "equipment_type": et_norm,
                "by_work_type": [],
            })
            entry["by_work_type"].append({
                "wt_code": wtc,
                "wt_name": wt_names.get(wtc, wtc),
                "norm_code": norm_spec["code"],
                "norm_per_shift": norm_spec["norm"],
                "norm_unit": norm_spec["unit"],
                "fact_volume": round(fact_sum, 2),
                "days": len(dates_with_work),
                "shifts": shifts_worked,
                "avg_units": round(avg_units, 2),
                "expected": round(expected, 1),
                "percent": round(pct, 1) if pct is not None else None,
            })

    # Агрегируем per-техника: средний % по применимым видам работ.
    for (sec, et), entry in by_section_et.items():
        pcts = [w["percent"] for w in entry["by_work_type"] if w["percent"] is not None]
        entry["percent"] = round(sum(pcts) / len(pcts), 1) if pcts else None
        entry["fact_volume_total_m3"] = round(
            sum(w["fact_volume"] for w in entry["by_work_type"] if w["norm_unit"] == "м³"), 1)
        entry["fact_volume_total_m2"] = round(
            sum(w["fact_volume"] for w in entry["by_work_type"] if w["norm_unit"] == "м²"), 1)
        total_shifts = sum(w["shifts"] for w in entry["by_work_type"])
        total_unit_shifts = sum(w["avg_units"] * w["shifts"] for w in entry["by_work_type"])
        entry["avg_units"] = round(total_unit_shifts / total_shifts, 1) if total_shifts else 0
        entry["work_shifts_total"] = total_shifts
        entry["work_days_total"] = max((w["days"] for w in entry["by_work_type"]), default=0)

    # ── Самосвалы ──────────────────────────────────────────────────────
    # Per-смена: факт грузим из material_movements с разбивкой по (date × shift).
    # Знаменатель = units_samosval(sec, date, shift) × norm_per_shift, только по тем сменам,
    # где был факт в норме (non-АЛМАЗ, для уч.6 — только stockpile_to_constructive).
    mm_rows = query(
        f"""
        SELECT cs.code AS section_code,
               mm.report_date AS report_date,
               LOWER(COALESCE(mm.shift, 'day')) AS shift,
               mm.movement_type AS mtype,
               mat.code AS material_code,
               mm.contractor_name AS contractor_name,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips
        FROM material_movements mm
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN materials mat ON mat.id = mm.material_id
        WHERE mm.report_date BETWEEN %s AND %s
          {" AND cs.code = ANY(%s)" if codes else ""}
        GROUP BY cs.code, mm.report_date, mm.shift, mm.movement_type, mat.code, mm.contractor_name
        """,
        [d_from, d_to] + ([codes] if codes else []),
    )

    # dump_by_sec[sec]["by_material"][mat_key] — накопитель
    # норм-факт/смены/даты отдельно для fact_in_norm и fact_off_norm
    dump_by_sec: dict[str, dict] = {}
    for r in mm_rows:
        sec = _merge_section(r["section_code"]) or "—"
        n = _sec_code_to_num(sec)
        if n is None:
            continue
        mat = (r["material_code"] or "").upper()
        key_mat = 'SAND' if mat == 'SAND' else ('SHPGS' if mat in ('SHPGS', 'SCHEBEN') else None)
        if key_mat is None:
            continue
        spec = DUMP_TRUCK_NORMS.get((n, key_mat)) if key_mat == 'SAND' else None
        mtype = r["mtype"]
        contractor = (r["contractor_name"] or "").lower()
        is_almaz = 'алмаз' in contractor

        count_in_norm = True
        if spec is not None and not spec["include_pit_to_stockpile"] and mtype == 'pit_to_stockpile':
            count_in_norm = False
        if is_almaz:
            count_in_norm = False
        if key_mat == 'SHPGS':
            count_in_norm = False  # нормы ЩПГС ждём

        bucket = dump_by_sec.setdefault(sec, {
            "section_code": sec,
            "equipment_type": "самосвал",
            "by_material": {},
        })["by_material"].setdefault(key_mat, {
            "fact_norm_by_shift": {},   # {(date, shift): volume} — только учитываемые в норме
            "fact_off_norm": 0.0,
            "trips_norm": 0, "trips_off_norm": 0,
        })
        vol = float(r["volume"] or 0)
        trips = int(r["trips"] or 0)
        if count_in_norm:
            key = (r["report_date"], r["shift"])
            bucket["fact_norm_by_shift"][key] = bucket["fact_norm_by_shift"].get(key, 0) + vol
            bucket["trips_norm"] += trips
        else:
            bucket["fact_off_norm"] += vol
            bucket["trips_off_norm"] += trips

    # Собираем строки по самосвалам — per-смена формула.
    dump_rows: list[dict] = []
    for sec, info in dump_by_sec.items():
        n = _sec_code_to_num(sec)
        by_material_out = []
        pct_list = []
        fact_m3_total = 0.0
        all_shifts_used = set()
        # units самосвалов per (date, shift)
        units_map_samo = dict(units_by_shift.get((sec, "самосвал"), {}))
        for (d, sh), u in units_by_shift.get((sec, "dump_truck"), {}).items():
            units_map_samo[(d, sh)] = units_map_samo.get((d, sh), 0) + u

        for mat_key, b in info["by_material"].items():
            spec = DUMP_TRUCK_NORMS.get((n, mat_key))
            norm_per_shift = (spec["trips"] * spec["m3_per_trip"]) if spec else None

            fact_sum = 0.0
            expected = 0.0
            shifts_worked = 0
            units_sum = 0
            dates_with_work = set()
            for (d, sh), v in b["fact_norm_by_shift"].items():
                if v <= 0 or norm_per_shift is None:
                    continue
                u = units_map_samo.get((d, sh), 0)
                if u <= 0:
                    continue
                fact_sum += v
                expected += u * norm_per_shift
                shifts_worked += 1
                units_sum += u
                dates_with_work.add(d)
                all_shifts_used.add((d, sh))
            pct = (fact_sum / expected * 100) if expected > 0 else None
            if pct is not None:
                pct_list.append(pct)
            avg_units = (units_sum / shifts_worked) if shifts_worked else 0
            fact_off_norm = b["fact_off_norm"]
            fact_m3_total += fact_sum + fact_off_norm
            by_material_out.append({
                "material": mat_key,
                "quarry": spec["quarry"] if spec else None,
                "norm_per_shift": round(norm_per_shift, 1) if norm_per_shift else None,
                "norm_formula": (f"{spec['trips']} рейс × {spec['m3_per_trip']} м³"
                                  if spec else None),
                "include_pit_to_stockpile": spec["include_pit_to_stockpile"] if spec else None,
                "fact_in_norm": round(fact_sum, 1),
                "fact_off_norm": round(fact_off_norm, 1),
                "trips_in_norm": b["trips_norm"],
                "trips_off_norm": b["trips_off_norm"],
                "days": len(dates_with_work),
                "shifts": shifts_worked,
                "avg_units": round(avg_units, 2),
                "expected": round(expected, 1),
                "percent": round(pct, 1) if pct is not None else None,
            })
        info["by_material"] = by_material_out
        info["percent"] = round(sum(pct_list) / len(pct_list), 1) if pct_list else None
        # На карточке показываем факт В НОРМЕ (сопоставимо с %), off-norm — в тултипе.
        info["fact_volume_total_m3"] = round(sum(m["fact_in_norm"] for m in by_material_out), 1)
        info["fact_volume_total_m2"] = 0.0
        info["fact_off_norm_total_m3"] = round(sum(m["fact_off_norm"] for m in by_material_out), 1)
        total_shifts = sum(m["shifts"] for m in by_material_out)
        total_unit_shifts = sum(m["avg_units"] * m["shifts"] for m in by_material_out)
        info["avg_units"] = round(total_unit_shifts / total_shifts, 1) if total_shifts else 0
        info["work_shifts_total"] = total_shifts
        info["work_days_total"] = len({d for d, _ in all_shifts_used})
        dump_rows.append(info)

    # Объединяем экск/бульд/автогр/каток и самосвалы в один список строк
    out = list(by_section_et.values()) + dump_rows
    out.sort(key=lambda x: (x["section_code"], x["equipment_type"]))
    return {
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "rows": out,
    }


@router.get("/overview/equipment-pulse")
def overview_equipment_pulse(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """Upper overview infographics: equipment load, downtime, productivity and risks."""
    d_from, d_to = _parse_range(date_from, date_to)
    days = max((d_to - d_from).days + 1, 1)

    sections_raw = query(
        """
        SELECT code, name, sort_order
        FROM construction_sections
        WHERE is_active IS NOT FALSE
        ORDER BY sort_order NULLS LAST, code
        """
    )
    sections_meta = {
        r["code"]: {
            "section_code": r["code"],
            "label": (r["name"] or r["code"]).replace("Участок ", "Уч. "),
            "working_total": 0,
            "idle_total": 0,
            "productivity": None,
            "productivity_weight": 0,
            "categories": {
                key: {"working": 0, "idle": 0, "productivity": None, "productivity_weight": 0}
                for key in EQUIPMENT_CATEGORIES
            },
        }
        for r in sections_raw
    }

    categories = {
        key: {
            "key": key,
            "label": spec["label"],
            "short": spec["short"],
            "working": 0,
            "idle": 0,
            "productivity": None,
            "productivity_weight": 0,
        }
        for key, spec in EQUIPMENT_CATEGORIES.items()
    }

    eq_rows = query(
        """
        SELECT cs.code AS section_code,
               reu.equipment_type,
               COALESCE(reu.status, 'unknown') AS status,
               COUNT(*)::int AS cnt
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE dr.report_date BETWEEN %s AND %s
          AND reu.is_demo IS NOT TRUE
        GROUP BY cs.code, reu.equipment_type, reu.status
        """,
        [d_from, d_to],
    )

    for row in eq_rows:
        section_code = _merge_section(row["section_code"]) or "—"
        if section_code not in sections_meta:
            sections_meta[section_code] = {
                "section_code": section_code,
                "label": section_code.replace("UCH_", "Уч. "),
                "working_total": 0,
                "idle_total": 0,
                "productivity": None,
                "productivity_weight": 0,
                "categories": {
                    key: {"working": 0, "idle": 0, "productivity": None, "productivity_weight": 0}
                    for key in EQUIPMENT_CATEGORIES
                },
            }
        cat = _equipment_category(row["equipment_type"])
        cnt = int(row["cnt"] or 0)
        is_working = (row["status"] or "").lower() == "working"
        slot = "working" if is_working else "idle"
        categories[cat][slot] += cnt
        sections_meta[section_code][f"{slot}_total"] += cnt
        sections_meta[section_code]["categories"][cat][slot] += cnt

    productivity_data = equipment_productivity(
        date_from=d_from.isoformat(),
        date_to=d_to.isoformat(),
    )
    productivity_rows = productivity_data.get("rows", [])
    overall_weighted = 0.0
    overall_weight = 0.0
    for row in productivity_rows:
        pct = row.get("percent")
        if pct is None:
            continue
        cat = _equipment_category(row.get("equipment_type"))
        section_code = _merge_section(row.get("section_code")) or "—"
        weight = max(
            float(row.get("work_shifts_total") or 0),
            float(row.get("avg_units") or 0),
            1.0,
        )
        categories[cat]["productivity_weight"] += weight
        prev = categories[cat]["productivity"]
        prev_weight = categories[cat]["productivity_weight"] - weight
        categories[cat]["productivity"] = (
            round(((prev or 0) * prev_weight + float(pct) * weight) / categories[cat]["productivity_weight"], 1)
        )

        if section_code not in sections_meta:
            sections_meta[section_code] = {
                "section_code": section_code,
                "label": section_code.replace("UCH_", "Уч. "),
                "working_total": 0,
                "idle_total": 0,
                "productivity": None,
                "productivity_weight": 0,
                "categories": {
                    key: {"working": 0, "idle": 0, "productivity": None, "productivity_weight": 0}
                    for key in EQUIPMENT_CATEGORIES
                },
            }
        sec = sections_meta[section_code]
        sec_cat = sec["categories"][cat]
        prev_cat = sec_cat["productivity"]
        prev_cat_weight = sec_cat["productivity_weight"]
        sec_cat["productivity_weight"] += weight
        sec_cat["productivity"] = round(((prev_cat or 0) * prev_cat_weight + float(pct) * weight) / sec_cat["productivity_weight"], 1)

        prev_sec = sec["productivity"]
        prev_sec_weight = sec["productivity_weight"]
        sec["productivity_weight"] += weight
        sec["productivity"] = round(((prev_sec or 0) * prev_sec_weight + float(pct) * weight) / sec["productivity_weight"], 1)
        overall_weighted += float(pct) * weight
        overall_weight += weight

    for cat in categories.values():
        cat.pop("productivity_weight", None)
    sections = []
    for sec in sections_meta.values():
        sec.pop("productivity_weight", None)
        for cat in sec["categories"].values():
            cat.pop("productivity_weight", None)
        sections.append(sec)

    totals = {
        "working": sum(c["working"] for c in categories.values()),
        "idle": sum(c["idle"] for c in categories.values()),
        "productivity": round(overall_weighted / overall_weight, 1) if overall_weight else None,
    }

    pile_row = query_one(
        """
        SELECT COALESCE(SUM(dwi.volume), 0)::numeric AS piles
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        WHERE dwi.report_date BETWEEN %s AND %s
          AND dwi.is_demo IS NOT TRUE
          AND wt.code IN ('PILE_MAIN', 'PILE_TRIAL')
        """,
        [d_from, d_to],
    )
    piles_done = float(pile_row["piles"] or 0) if pile_row else 0.0
    pile_threshold = 20 * days

    road_row = query_one(
        """
        SELECT COALESCE(SUM(
          ABS(
            COALESCE(s.road_pk_end, s.rail_pk_end, 0)
            - COALESCE(s.road_pk_start, s.rail_pk_start, 0)
          )
        ), 0)::numeric AS meters
        FROM temporary_road_status_segments s
        WHERE s.status_date BETWEEN %s AND %s
          AND s.is_demo IS NOT TRUE
          AND s.status_type IN ('pioneer_fill', 'ready_for_shpgs', 'shpgs_done')
        """,
        [d_from, d_to],
    )
    road_meters = float(road_row["meters"] or 0) if road_row else 0.0
    road_threshold = 100 * days

    insights = []
    if totals["working"] == 0:
        insights.append({
            "severity": "high",
            "title": "Нет подтвержденной техники в работе",
            "text": "За выбранный период в отчетах нет работающих единиц техники. Проверь загрузку суточных отчетов или выбранный период.",
        })
    if totals["idle"] >= 3 and totals["idle"] > totals["working"] * 0.25:
        insights.append({
            "severity": "medium",
            "title": "Высокий простой техники",
            "text": f"В простое {totals['idle']} ед. против {totals['working']} ед. в работе. Стоит проверить причины standby/ремонта.",
        })
    if totals["productivity"] is not None and totals["productivity"] < 60:
        insights.append({
            "severity": "high",
            "title": "Низкая производительность",
            "text": f"Средняя производительность {totals['productivity']}% от норматива. Риск недобора суточного темпа.",
        })
    if piles_done < pile_threshold:
        insights.append({
            "severity": "medium",
            "title": "Риск по свайным работам",
            "text": f"Забито {int(round(piles_done))} свай при ориентире {pile_threshold} шт за период.",
        })
    if road_meters < road_threshold:
        insights.append({
            "severity": "medium",
            "title": "Риск по временным автодорогам",
            "text": f"Зафиксировано {int(round(road_meters))} м новых/готовых сегментов при ориентире {road_threshold} м.",
        })

    return {
        "from": d_from.isoformat(),
        "to": d_to.isoformat(),
        "categories": list(categories.values()),
        "sections": sections,
        "totals": totals,
        "benchmarks": {
            "piles_done": round(piles_done, 1),
            "pile_threshold": pile_threshold,
            "road_meters": round(road_meters, 1),
            "road_threshold": road_threshold,
        },
        "insights": insights[:5],
    }


# ── mechanization: per-unit productivity ──────────────────────────────

@router.get("/mechanization/units")
def mechanization_units(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    ownership: Optional[str] = Query(None, description="own/subcontractor/supplier, null = все"),
):
    """Список всех единиц техники и их производительность за период (см. _mechanization_units_impl)."""
    d_from, d_to = _parse_range(date_from, date_to)
    return _mechanization_units_impl(d_from, d_to, ownership)


def _mechanization_units_impl(d_from, d_to, ownership: Optional[str] = None):
    """Внутренняя логика per-unit productivity — переиспользуется агрегатами.

    Методика:
      Экск/бульд/автогр/каток — норма из WORK_TYPE_NORMS × смен.
      Самосвал — факт = volume движений этого юнита из *_equipment_usage; план:
         * SAND pit_to_stockpile|pit_to_constructive — SAND_PIT_DIRECTION_NORMS[sec]
         * SAND stockpile_to_constructive — SAND_STOCKPILE_TO_CONSTR_NORMS[sec]
         * остальное — 166 м³/см.
    """
    # 1) Снимаем список всех единиц техники, встречавшихся за период.
    where = ["dr.report_date BETWEEN %s AND %s"]
    params: list = [d_from, d_to]
    if ownership:
        where.append("reu.ownership_type = %s")
        params.append(ownership)

    unit_rows = query(
        f"""
        SELECT reu.equipment_type, reu.brand_model, reu.plate_number, reu.unit_number,
               reu.ownership_type, reu.contractor_name,
               cs.code AS section_code,
               dr.report_date,
               LOWER(COALESCE(dr.shift, 'day')) AS shift
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE {' AND '.join(where)}
          AND reu.status = 'working'
        """,
        params,
    )

    # Дедуп ключ: (et_lower, plate, unit_num) — плоский композит.
    def key_of(r):
        return (
            (r['equipment_type'] or '').lower(),
            (r['plate_number'] or '').strip(),
            (r['unit_number'] or '').strip(),
        )

    # Собираем smeнные записи per unit
    units: dict[tuple, dict] = {}
    for r in unit_rows:
        k = key_of(r)
        if k not in units:
            units[k] = {
                'key': k,
                'equipment_type': r['equipment_type'],
                'brand_model': r['brand_model'] or '—',
                'plate_number': r['plate_number'] or '—',
                'unit_number': r['unit_number'] or '—',
                'ownership': r['ownership_type'] or '—',
                'contractor': r['contractor_name'] or '—',
                'shifts': [],   # [(date, shift, section_code)]
            }
        units[k]['shifts'].append((r['report_date'], r['shift'], _merge_section(r['section_code']) or r['section_code']))

    # 2) Per-unit факт из usage-таблиц.
    # work_item_equipment_usage (eq_id → work_item → wt_code, volume/area)
    wieu_rows = query(
        """
        SELECT wieu.report_equipment_unit_id AS eq_id,
               dwi.report_date, LOWER(COALESCE(dwi.shift,'day')) AS shift,
               cs.code AS section_code,
               wt.code AS wt_code,
               COALESCE(wieu.worked_volume, wieu.worked_area) AS fact,
               CASE WHEN wieu.worked_volume IS NOT NULL THEN 'м³' ELSE 'м²' END AS unit
        FROM work_item_equipment_usage wieu
        JOIN daily_work_items dwi ON dwi.id = wieu.daily_work_item_id
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE dwi.report_date BETWEEN %s AND %s
        """,
        [d_from, d_to],
    )
    unit_work_facts: dict[str, list] = {}
    for r in wieu_rows:
        eid = str(r['eq_id'])
        unit_work_facts.setdefault(eid, []).append({
            'date': r['report_date'], 'shift': r['shift'],
            'section': _merge_section(r['section_code']) or r['section_code'],
            'wt_code': r['wt_code'], 'fact': float(r['fact'] or 0), 'unit': r['unit'],
        })

    # material_movement_equipment_usage
    mmeu_rows = query(
        """
        SELECT mmeu.report_equipment_unit_id AS eq_id,
               mm.report_date, LOWER(COALESCE(mm.shift,'day')) AS shift,
               cs.code AS section_code,
               mm.movement_type, mat.code AS mat,
               COALESCE(mmeu.worked_volume, mm.volume) AS fact,
               COALESCE(mmeu.trips_count, 0) AS trips
        FROM material_movement_equipment_usage mmeu
        JOIN material_movements mm ON mm.id = mmeu.material_movement_id
        LEFT JOIN materials mat ON mat.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE mm.report_date BETWEEN %s AND %s
        """,
        [d_from, d_to],
    )
    unit_mov_facts: dict[str, list] = {}
    for r in mmeu_rows:
        eid = str(r['eq_id'])
        unit_mov_facts.setdefault(eid, []).append({
            'date': r['report_date'], 'shift': r['shift'],
            'section': _merge_section(r['section_code']) or r['section_code'],
            'mat': r['mat'], 'mtype': r['movement_type'],
            'fact': float(r['fact'] or 0), 'trips': int(r['trips'] or 0),
        })

    # 3) Сборка: per unit — суммируем факты из usage-таблиц, норма per работу.
    def dump_truck_norm(sec_num: int, mov) -> tuple[float, str]:
        mat = (mov['mat'] or '').upper()
        mt = mov['mtype']
        if mat == 'SAND' and mt in ('pit_to_stockpile', 'pit_to_constructive'):
            tpl = SAND_PIT_DIRECTION_NORMS.get(sec_num)
            if tpl:
                trips, m3 = tpl
                return trips * m3, f'песок {mt} ({trips}×{m3})'
            return GENERIC_TRUCK_NORM, f'песок {mt} (fallback 166)'
        if mat == 'SAND' and mt == 'stockpile_to_constructive':
            tpl = SAND_STOCKPILE_TO_CONSTR_NORMS.get(sec_num)
            if tpl:
                trips, m3 = tpl
                return trips * m3, f'песок stockpile→constr ({trips}×{m3})'
        return GENERIC_TRUCK_NORM, f'{mat or "-"} {mt} (166)'

    # Нам нужен eq_id для ключа в usage таблицах.
    # Перестраиваем units с eq_id'ами вместо плейта.
    # eq_rows уже содержат eq_ids через JOIN на daily_reports. Запрос выше собирал только
    # метаданные, но не сохранял reu.id. Перезапрашиваем id юнитов.
    id_rows = query(
        f"""
        SELECT reu.id AS eq_id,
               reu.equipment_type, reu.brand_model, reu.plate_number, reu.unit_number,
               reu.ownership_type, reu.contractor_name,
               cs.code AS section_code, dr.report_date,
               LOWER(COALESCE(dr.shift, 'day')) AS shift
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE {' AND '.join(where)}
          AND reu.status = 'working'
        """,
        params,
    )

    # Группируем per (equipment_type+plate+unit_num) и собираем eq_ids
    units_by_key: dict[tuple, dict] = {}
    for r in id_rows:
        k = (
            (r['equipment_type'] or '').lower(),
            (r['plate_number'] or '').strip(),
            (r['unit_number'] or '').strip(),
        )
        u = units_by_key.setdefault(k, {
            'key': k,
            'equipment_type': r['equipment_type'],
            'brand_model': r['brand_model'] or '—',
            'plate_number': r['plate_number'] or '—',
            'unit_number': r['unit_number'] or '—',
            'ownership': r['ownership_type'] or '—',
            'contractor': r['contractor_name'] or '—',
            'eq_ids': [],
            'last_date': None,
            'last_section': None,
            'shifts_count': 0,
        })
        u['eq_ids'].append(str(r['eq_id']))
        u['shifts_count'] += 1
        if u['last_date'] is None or r['report_date'] > u['last_date']:
            u['last_date'] = r['report_date']
            u['last_section'] = _merge_section(r['section_code']) or r['section_code']

    out_units = []
    for k, u in units_by_key.items():
        et = (u['equipment_type'] or '').lower()
        per_shift_recs = []
        total_fact = 0.0
        total_expected = 0.0
        fact_unit = None
        for eq_id in u['eq_ids']:
            # Для не-самосвалов — берём work usage
            if et not in ('самосвал', 'dump_truck'):
                for w in unit_work_facts.get(eq_id, []):
                    norm_spec = WORK_TYPE_NORMS.get((et, w['wt_code']))
                    if not norm_spec or w['fact'] <= 0:
                        continue
                    total_fact += w['fact']
                    total_expected += norm_spec['norm']
                    fact_unit = norm_spec['unit']
                    per_shift_recs.append({
                        'date': w['date'].isoformat(), 'shift': w['shift'], 'section': w['section'],
                        'work': f"{w['wt_code']} ({norm_spec['code']})",
                        'fact': round(w['fact'], 1),
                        'norm': norm_spec['norm'],
                        'percent': round(w['fact'] / norm_spec['norm'] * 100, 1) if norm_spec['norm'] > 0 else None,
                    })
            else:
                for mov in unit_mov_facts.get(eq_id, []):
                    if mov['fact'] <= 0:
                        continue
                    sec_num = _sec_code_to_num(mov['section'])
                    norm, label = dump_truck_norm(sec_num or 0, mov)
                    total_fact += mov['fact']
                    total_expected += norm
                    fact_unit = 'м³'
                    per_shift_recs.append({
                        'date': mov['date'].isoformat(), 'shift': mov['shift'], 'section': mov['section'],
                        'work': label, 'fact': round(mov['fact'], 1),
                        'norm': round(norm, 1),
                        'percent': round(mov['fact'] / norm * 100, 1) if norm > 0 else None,
                    })

        pct = (total_fact / total_expected * 100) if total_expected > 0 else None
        out_units.append({
            'equipment_type': u['equipment_type'],
            'brand_model': u['brand_model'],
            'plate_number': u['plate_number'],
            'unit_number': u['unit_number'],
            'ownership': u['ownership'],
            'contractor': u['contractor'],
            'last_section': u['last_section'],
            'last_date': u['last_date'].isoformat() if u['last_date'] else None,
            'shifts_worked': u['shifts_count'],
            'fact_total': round(total_fact, 1),
            'expected_total': round(total_expected, 1),
            'fact_unit': fact_unit,
            'percent': round(pct, 1) if pct is not None else None,
            'details': per_shift_recs,
        })

    # Сортировка: по последнему участку (desc по номеру), затем по типу техники.
    def sort_key(x):
        sec_n = _sec_code_to_num(x['last_section']) or 99
        return (sec_n, x['equipment_type'] or '', x['plate_number'] or '')

    out_units.sort(key=sort_key)
    return {
        'from': d_from.isoformat(),
        'to': d_to.isoformat(),
        'count': len(out_units),
        'units': out_units,
    }


# ── mechanization aggregates for Analytics tab ────────────────────────

@router.get("/mechanization/aggregates")
def mechanization_aggregates(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    bucket: str = Query("own", description="own|almaz|hired|all — фильтр по собственности"),
):
    """Агрегат per (section × equipment_type) из /mechanization/units с фильтром ЖДС.

    Возвращает ровно тот же shape, что и /equipment-productivity (для совместимости
    с EquipmentBlock на Аналитике): rows с полями section_code, equipment_type,
    percent, avg_units, work_days_total, work_shifts_total, by_work_type, by_material.
    """
    # Собираем данные per-unit через прямой вызов внутренней функции.
    # Используем _parse_range для стандартной обработки дат.
    d_from, d_to = _parse_range(date_from, date_to)
    unit_data = _mechanization_units_impl(d_from, d_to)
    units = unit_data['units']

    def in_bucket(u):
        if bucket == 'all':
            return True
        own = (u.get('ownership') or '').lower() == 'own'
        almaz = 'алмаз' in (u.get('contractor') or '').lower()
        if bucket == 'own':
            return own
        if bucket == 'almaz':
            return almaz
        if bucket == 'hired':
            return not own and not almaz
        return True

    # Группируем per (section, equipment_type)
    agg: dict[tuple, dict] = {}
    for u in units:
        if not in_bucket(u):
            continue
        sec = u['last_section'] or '—'  # возможно, юнит менял участок — берём последний
        et = (u['equipment_type'] or '').lower()
        key = (sec, et)
        entry = agg.setdefault(key, {
            'section_code': sec, 'equipment_type': et,
            'units_count': 0, 'shifts_total': 0,
            'fact_total_m3': 0.0, 'fact_total_m2': 0.0,
            'expected_total': 0.0,
            'pcts': [],  # для средневзвешенного
            'by_work_type': {},  # wt/label → {fact, norm, days, shifts, percent}
        })
        entry['units_count'] += 1
        entry['shifts_total'] += u['shifts_worked']
        fu = u.get('fact_unit') or 'м³'
        if fu == 'м³':
            entry['fact_total_m3'] += u['fact_total']
        else:
            entry['fact_total_m2'] += u['fact_total']
        entry['expected_total'] += u['expected_total']
        if u['percent'] is not None:
            entry['pcts'].append(u['percent'])
        # Детализация per work — группируем по work-label
        for d in u.get('details', []):
            wlabel = d.get('work') or ''
            w = entry['by_work_type'].setdefault(wlabel, {
                'wt_name': wlabel, 'norm_code': wlabel, 'norm_per_shift': d.get('norm') or 0,
                'norm_unit': 'м³' if fu == 'м³' else 'м²',
                'fact_volume': 0.0, 'shifts': 0, 'days_set': set(),
                'avg_units': 0, 'expected': 0.0, 'pcts': [],
            })
            w['fact_volume'] += d['fact']
            w['shifts'] += 1
            w['days_set'].add(d['date'])
            w['expected'] += d['norm'] or 0
            if d.get('percent') is not None:
                w['pcts'].append(d['percent'])

    rows_out = []
    for (sec, et), e in agg.items():
        # avg units per shift ≈ units_count (если каждая единица отработала смены равномерно)
        avg_units = e['units_count'] * (e['shifts_total'] / max(e['shifts_total'], 1))
        # Пересчитываем среднее % через сумма_факта/сумма_ожидания по m³ или m² отдельно.
        # Для простоты — средневзвешенное по pcts.
        percent = round(sum(e['pcts']) / len(e['pcts']), 1) if e['pcts'] else None
        by_work = []
        for wlabel, w in e['by_work_type'].items():
            wpct = (w['fact_volume'] / w['expected'] * 100) if w['expected'] > 0 else None
            by_work.append({
                'wt_code': wlabel, 'wt_name': wlabel,
                'norm_code': wlabel, 'norm_per_shift': w['norm_per_shift'],
                'norm_unit': w['norm_unit'],
                'fact_volume': round(w['fact_volume'], 1),
                'days': len(w['days_set']), 'shifts': w['shifts'],
                'avg_units': e['units_count'], 'expected': round(w['expected'], 1),
                'percent': round(wpct, 1) if wpct is not None else None,
            })
        rows_out.append({
            'section_code': sec, 'equipment_type': et,
            'percent': percent,
            'avg_units': e['units_count'],
            'work_days_total': max((len(w['days_set']) for w in e['by_work_type'].values()), default=0),
            'work_shifts_total': e['shifts_total'],
            'fact_volume_total_m3': round(e['fact_total_m3'], 1),
            'fact_volume_total_m2': round(e['fact_total_m2'], 1),
            'by_work_type': by_work,
        })
    rows_out.sort(key=lambda x: (x['section_code'], x['equipment_type']))
    return {
        'from': unit_data['from'], 'to': unit_data['to'],
        'bucket': bucket, 'rows': rows_out,
    }


# ── overview: summary-by-section pivot ──────────────────────────────────

@router.get("/overview/table")
def overview_table(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    """
    Сводная по участкам (без «Объекты»): песок/ЩПГС, подрядчики-самосвалы
    (ЖДС/Алмаз/наёмники), свайные поля (main/test/dyntest), готовность ТАД,
    число единиц техники. Период — опционально from/to; иначе всё время.
    """
    # period clause — none → all-time.
    # Для атрибуции букетов нужен диапазон дат; для all-time используем широкий.
    if date_from or date_to:
        d_from, d_to = _parse_range(date_from, date_to)
    else:
        d_from = date_cls(2000, 1, 1)
        d_to = date_cls.today()
    date_clause = " AND mm.report_date BETWEEN %s AND %s"
    params: list = [d_from, d_to]

    # 1. material flow per section × material × date (объёмы — сквозь склад).
    mat_rows = query(
        f"""
        SELECT cs.code AS sec, m.code AS mat, mm.report_date AS d,
               SUM(mm.volume)::numeric AS volume
        FROM material_movements mm
        JOIN construction_sections cs ON cs.id = mm.section_id
        JOIN materials m ON m.id = mm.material_id
        WHERE mm.is_demo = false
          AND mm.movement_type IN ('pit_to_stockpile','stockpile_to_constructive')
          {date_clause}
        GROUP BY cs.code, m.code, mm.report_date
        """,
        params,
    )
    # Атрибуция по букетам через владение самосвалами.
    eq_bucket = _equipment_bucket_by_section_date(d_from, d_to, None)

    # 2. piles per section
    pile_rows = query(
        """
        SELECT
          COALESCE(
            (SELECT cs.code FROM construction_section_versions csv
             JOIN construction_sections cs ON cs.id = csv.section_id
             WHERE csv.is_current = true
               AND pf.pk_start >= csv.pk_start AND pf.pk_end <= csv.pk_end
             ORDER BY csv.pk_start LIMIT 1), '—') AS sec,
          pf.field_type,
          SUM(pf.pile_count)::int AS pcnt,
          SUM(COALESCE(pf.dynamic_test_count, 0))::int AS dyn
        FROM pile_fields pf
        GROUP BY sec, pf.field_type
        """
    )

    # 3. equipment units (working) per section
    eq_rows = query(
        """
        SELECT cs.code AS sec, COUNT(*)::int AS units
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE reu.status = 'working' AND cs.code IS NOT NULL
        GROUP BY cs.code
        """
    )

    # 4. TAD readiness — % of road length with status 'shpgs_done' on latest date
    tad_rows = query(
        """
        SELECT cs.code AS sec,
               SUM(ABS(tr.ad_end_pk - tr.ad_start_pk))::numeric AS total_len,
               SUM(CASE WHEN s.status_type = 'shpgs_done'
                        THEN ABS(COALESCE(s.rail_pk_end, s.road_pk_end, 0) -
                                 COALESCE(s.rail_pk_start, s.road_pk_start, 0))
                        ELSE 0 END)::numeric AS ready_len
        FROM temporary_roads tr
        JOIN construction_sections cs ON cs.id = tr.section_id
        LEFT JOIN temporary_road_status_segments s ON s.road_id = tr.id
        GROUP BY cs.code
        """
    )

    sections: dict[str, dict] = {}
    def row(code: str) -> dict:
        code = _merge_section(code) or code
        if code not in sections:
            label = f"Уч. №{code.replace('UCH_','')}" if code.startswith("UCH_") else code
            sections[code] = {
                "code": code, "label": label,
                "sand_m3": 0.0, "shps_m3": 0.0,
                "zhds": 0.0, "almaz": 0.0, "hire": 0.0,
                "total_m3": 0.0,
                "piles_main": 0, "piles_trial": 0, "piles_dyntest": 0,
                "tad_ready_pct": 0.0, "equipment_units": 0,
                "_tad_days": 0,  # для среднего
            }
        return sections[code]

    # Материалы: объём делим на 2 (pit→stockpile и stockpile→constructive — это
    # одна и та же партия в двух стадиях). Букет берём из equipment-атрибуции.
    for r in mat_rows:
        sec = _merge_section(r["sec"]) or r["sec"]
        s = row(r["sec"])
        vol = float(r["volume"] or 0) / 2.0
        if r["mat"] == "SAND":
            s["sand_m3"] += vol
        elif r["mat"] == "SHPGS":
            s["shps_m3"] += vol
        s["total_m3"] += vol
        b = eq_bucket.get((sec, r["d"]), "hire")
        s[b] += vol

    for r in pile_rows:
        s = row(r["sec"])
        if r["field_type"] == "main":
            s["piles_main"] += int(r["pcnt"] or 0)
        else:
            s["piles_trial"] += int(r["pcnt"] or 0)
        s["piles_dyntest"] += int(r["dyn"] or 0)

    for r in eq_rows:
        s = row(r["sec"])
        s["equipment_units"] += int(r["units"] or 0)

    # TAD — простое среднее по исходным участкам (UCH_31 и UCH_32 усредняем).
    for r in tad_rows:
        s = row(r["sec"])
        tot = float(r["total_len"] or 0); rdy = float(r["ready_len"] or 0)
        pct = rdy / tot * 100 if tot > 0 else 0.0
        s["tad_ready_pct"] += pct
        s["_tad_days"] += 1

    # round money fields, exclude synthetic sections
    out = []
    for code in sorted(sections):
        if code in ("—", "OBJECTS", "Объекты"):
            continue
        v = sections[code]
        if v["_tad_days"] > 0:
            v["tad_ready_pct"] = round(v["tad_ready_pct"] / v["_tad_days"], 1)
        v.pop("_tad_days", None)
        for k in ("sand_m3","shps_m3","zhds","almaz","hire","total_m3"):
            v[k] = round(v[k], 1)
        out.append(v)

    as_of = date_to or date_cls.today().isoformat()
    return {"as_of": as_of, "sections": out}


# ── overview: milestone timeline per section ────────────────────────────

@router.get("/overview/timeline")
def overview_timeline(section: Optional[str] = None):
    """
    Для каждого work_type с show_in_timeline=true: min/max report_date,
    суммарный объём. section=UCH_1/UCH_3/all. Source: daily_work_items.
    """
    codes = _expand_sections(section)
    where = ["wt.show_in_timeline = true", "dwi.is_demo = false"]
    params: list = []
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)

    rows = query(
        f"""
        SELECT wt.code, wt.name, wt.default_unit AS unit,
               MIN(dwi.report_date) AS first_d,
               MAX(dwi.report_date) AS last_d,
               SUM(dwi.volume)::numeric AS total_volume
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {' AND '.join(where)}
        GROUP BY wt.code, wt.name, wt.default_unit
        HAVING MIN(dwi.report_date) IS NOT NULL
        ORDER BY MIN(dwi.report_date)
        """,
        params,
    )

    events = []
    for r in rows:
        first, last = r["first_d"], r["last_d"]
        days = (last - first).days + 1 if first and last else 0
        events.append({
            "code": r["code"],
            "name": r["name"],
            "first": first.isoformat() if first else None,
            "last": last.isoformat() if last else None,
            "days": days,
            "total_volume": round(float(r["total_volume"] or 0), 1),
            "unit": r["unit"],
        })

    return {"section": section or "all", "events": events}


# ── temp-roads: last updated per (road, status_type) ────────────────────

@router.get("/temp-roads/updated")
def temp_roads_updated():
    """Последняя дата статуса по каждой паре (road_code, status_type)."""
    rows = query(
        """
        SELECT tr.road_code, s.status_type,
               MAX(s.status_date) AS last_updated
        FROM temporary_road_status_segments s
        JOIN temporary_roads tr ON tr.id = s.road_id
        GROUP BY tr.road_code, s.status_type
        ORDER BY tr.road_code, s.status_type
        """
    )
    return {
        "rows": [
            {
                "road_code": r["road_code"],
                "status_type": r["status_type"],
                "last_updated": r["last_updated"].isoformat()
                                if r["last_updated"] else None,
            }
            for r in rows
        ]
    }


# ── Settings: norms & aliases ─────────────────────────────────────────────

_NORM_CODE_PREFIX_FALLBACK: dict[str, str] = {
    'RzrGrn': 'Разработка грунта',
    'SntPRS': 'Снятие ПРС',
    'UkrOtk': 'Устройство кюветов/укрепление откосов',
    'PlnOtk': 'Планировка откосов',
    'PlnZmp': 'Планировка земполотна под отметку',
    'PlnSch': 'Профилировка щебёночного слоя',
    'UsOsTN': 'Устройство насыпи',
    'UNSOSh': 'Устройство насыпи из ЩПС/ЩПГС',
    'RspGrn': 'Профилирование (ПРС поверхности)',
    'UplPds': 'Уплотнение насыпи',
}


def _resolve_work_name(wt_code: str, norm_code: Optional[str]) -> str:
    """Вернёт человекочитаемое название: work_types.name либо fallback по префиксу norm_code."""
    try:
        row = query_one("SELECT name FROM work_types WHERE code = %s", (wt_code,))
        if row and row.get("name"):
            return str(row["name"])
    except Exception:
        pass
    if norm_code:
        for prefix, label in _NORM_CODE_PREFIX_FALLBACK.items():
            if norm_code.startswith(prefix):
                return label
    return wt_code


@router.get("/settings/norms")
def get_settings_norms():
    """Возвращает все нормы, сгруппированные по 4 категориям."""
    try:
        _ensure_settings_tables()
        _seed_norms_if_empty()
    except Exception:
        pass
    data = load_norms_from_db()
    work_types = [
        {
            "equipment_type": et,
            "work_type_code": wt,
            "name": _resolve_work_name(wt, spec.get("code")),
            "norm": float(spec.get("norm") or 0),
            "unit": spec.get("unit"),
            "code": spec.get("code"),
        }
        for (et, wt), spec in sorted(data["work_types"].items())
    ]
    sand_pit = [
        {"section": sec, "trips": tpl[0], "m3_per_trip": tpl[1]}
        for sec, tpl in sorted(data["sand_pit"].items())
    ]
    sand_stockpile = [
        {"section": sec, "trips": tpl[0], "m3_per_trip": tpl[1]}
        for sec, tpl in sorted(data["sand_stockpile"].items())
    ]
    generic = {"norm_m3_per_shift": float(data["generic_truck_norm"])}
    return {
        "work_types": work_types,
        "sand_pit": sand_pit,
        "sand_stockpile": sand_stockpile,
        "generic": generic,
    }


class NormsPatchBody(BaseModel):
    work_types: Optional[list[dict]] = None        # [{equipment_type, work_type_code, norm, unit, code}]
    sand_pit: Optional[list[dict]] = None          # [{section, trips, m3_per_trip}]
    sand_stockpile: Optional[list[dict]] = None    # [{section, trips, m3_per_trip}]
    generic: Optional[dict] = None                 # {norm_m3_per_shift}
    updated_by: Optional[str] = None


@router.patch("/settings/norms")
def patch_settings_norms(body: NormsPatchBody):
    """Частичное обновление норм. Принимает любой набор из 4 секций."""
    try:
        _ensure_settings_tables()
    except Exception:
        pass
    updated_by = body.updated_by or "web"
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                if body.work_types is not None:
                    for row in body.work_types:
                        et = (row.get("equipment_type") or "").strip().lower()
                        wt = (row.get("work_type_code") or "").strip()
                        if not et or not wt:
                            continue
                        key = {"equipment_type": et, "work_type_code": wt}
                        value = {
                            "norm": float(row.get("norm") or 0),
                            "unit": row.get("unit") or "м³",
                            "code": row.get("code") or "",
                        }
                        cur.execute(
                            """
                            INSERT INTO equipment_norms_config (category, key, value, updated_at, updated_by)
                            VALUES ('work_types', %s, %s, NOW(), %s)
                            ON CONFLICT (category, key) DO UPDATE
                              SET value = EXCLUDED.value,
                                  updated_at = NOW(),
                                  updated_by = EXCLUDED.updated_by
                            """,
                            (json.dumps(key), json.dumps(value), updated_by),
                        )
                for cat, rows in (("sand_pit", body.sand_pit), ("sand_stockpile", body.sand_stockpile)):
                    if rows is None:
                        continue
                    for row in rows:
                        sec = row.get("section")
                        if sec is None:
                            continue
                        try:
                            sec = int(sec)
                        except (TypeError, ValueError):
                            continue
                        key = {"section": sec}
                        value = {
                            "trips": int(row.get("trips") or 0),
                            "m3_per_trip": float(row.get("m3_per_trip") or 0),
                        }
                        cur.execute(
                            """
                            INSERT INTO equipment_norms_config (category, key, value, updated_at, updated_by)
                            VALUES (%s, %s, %s, NOW(), %s)
                            ON CONFLICT (category, key) DO UPDATE
                              SET value = EXCLUDED.value,
                                  updated_at = NOW(),
                                  updated_by = EXCLUDED.updated_by
                            """,
                            (cat, json.dumps(key), json.dumps(value), updated_by),
                        )
                if body.generic is not None:
                    key = {"name": "truck_norm"}
                    value = {"norm_m3_per_shift": float(body.generic.get("norm_m3_per_shift") or 0)}
                    cur.execute(
                        """
                        INSERT INTO equipment_norms_config (category, key, value, updated_at, updated_by)
                        VALUES ('generic', %s, %s, NOW(), %s)
                        ON CONFLICT (category, key) DO UPDATE
                          SET value = EXCLUDED.value,
                              updated_at = NOW(),
                              updated_by = EXCLUDED.updated_by
                        """,
                        (json.dumps(key), json.dumps(value), updated_by),
                    )
    finally:
        conn.close()
    # Обновляем in-memory кэш, чтобы следующий запрос /equipment-productivity уже видел изменения.
    _refresh_norms()
    return {"ok": True}


# ── aliases CRUD ──────────────────────────────────────────────────────────

_ALIAS_KINDS = {"work_type", "material", "constructive"}


class AliasCreateBody(BaseModel):
    canonical_code: str
    alias_text: str
    kind: str
    notes: Optional[str] = None


class AliasPatchBody(BaseModel):
    canonical_code: Optional[str] = None
    alias_text: Optional[str] = None
    kind: Optional[str] = None
    notes: Optional[str] = None


@router.get("/settings/aliases")
def list_aliases():
    try:
        _ensure_settings_tables()
        _seed_aliases_if_empty()
    except Exception:
        pass
    rows = query(
        "SELECT id::text AS id, canonical_code, alias_text, kind, notes, "
        "created_at FROM work_type_aliases ORDER BY kind, canonical_code, alias_text"
    )
    return {
        "rows": [
            {
                "id": r["id"],
                "canonical_code": r["canonical_code"],
                "alias_text": r["alias_text"],
                "kind": r["kind"],
                "notes": r["notes"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ]
    }


@router.post("/settings/aliases")
def create_alias(body: AliasCreateBody):
    try:
        _ensure_settings_tables()
    except Exception:
        pass
    canonical = (body.canonical_code or "").strip()
    alias_text = (body.alias_text or "").strip()
    kind = (body.kind or "").strip()
    if not canonical or not alias_text:
        raise HTTPException(400, "canonical_code and alias_text are required")
    if kind not in _ALIAS_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(_ALIAS_KINDS)}")
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO work_type_aliases (canonical_code, alias_text, kind, notes) "
                        "VALUES (%s, %s, %s, %s) RETURNING id::text",
                        (canonical, alias_text, kind, body.notes),
                    )
                except Exception as e:
                    raise HTTPException(409, f"Alias already exists or invalid: {e}")
                row = cur.fetchone()
                return {"id": row[0] if row else None, "ok": True}
    finally:
        conn.close()


@router.patch("/settings/aliases/{alias_id}")
def update_alias(alias_id: str, body: AliasPatchBody):
    fields = []
    params: list = []
    if body.canonical_code is not None:
        fields.append("canonical_code = %s")
        params.append(body.canonical_code.strip())
    if body.alias_text is not None:
        fields.append("alias_text = %s")
        params.append(body.alias_text.strip())
    if body.kind is not None:
        if body.kind not in _ALIAS_KINDS:
            raise HTTPException(400, f"kind must be one of {sorted(_ALIAS_KINDS)}")
        fields.append("kind = %s")
        params.append(body.kind)
    if body.notes is not None:
        fields.append("notes = %s")
        params.append(body.notes)
    if not fields:
        return {"ok": True, "changed": 0}
    params.append(alias_id)
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE work_type_aliases SET {', '.join(fields)} WHERE id = %s",
                    params,
                )
                return {"ok": True, "changed": cur.rowcount}
    finally:
        conn.close()


@router.delete("/settings/aliases/{alias_id}")
def delete_alias(alias_id: str):
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM work_type_aliases WHERE id = %s", (alias_id,))
                return {"ok": True, "deleted": cur.rowcount}
    finally:
        conn.close()
