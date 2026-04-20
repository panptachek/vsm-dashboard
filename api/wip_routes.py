"""
WIP endpoints for VSM dashboard v2.

Подключение в api/main.py:
    from wip_routes import router as wip_router
    app.include_router(wip_router)

Все эндпоинты под префиксом /api/wip/*. Используют тот же psycopg2-пул,
что и основной api/main.py — импортируем get_conn и query оттуда.
"""
from __future__ import annotations

from datetime import date as date_cls, timedelta
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from main import query, query_one  # noqa: E402 — импорт из соседнего модуля

router = APIRouter(prefix="/api/wip", tags=["wip"])


# ── helpers ──────────────────────────────────────────────────────────────

def _expand_sections(section: Optional[str]) -> Optional[list[str]]:
    """UCH_3 → [UCH_31, UCH_32]; 'UCH_1,UCH_2' → ['UCH_1','UCH_2']."""
    if not section or section == "all":
        return None
    codes: list[str] = []
    for raw in section.split(","):
        c = raw.strip()
        if not c:
            continue
        if c == "UCH_3":
            codes.extend(["UCH_31", "UCH_32"])
        else:
            codes.append(c)
    return codes or None


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
               ABS(tr.ad_end_pk - tr.ad_start_pk) AS length_m
        FROM temporary_roads tr
        ORDER BY tr.road_code
        """
    )

    # Для каждого road берём самый свежий status_date <= d_to и все
    # сегменты этой даты. Если на d_to ничего нет — откатываемся глубже.
    for r in roads:
        last = query_one(
            """
            SELECT MAX(status_date) AS d
            FROM temporary_road_status_segments
            WHERE road_id = %s AND status_date <= %s
            """,
            (r["id"], d_to),
        )
        effective = last["d"] if last and last["d"] else None
        if effective is None:
            r["segments"] = []
            r["effective_date"] = None
            continue
        segs = query(
            """
            SELECT rail_pk_start AS pk_start, rail_pk_end AS pk_end,
                   status_type, is_demo
            FROM temporary_road_status_segments
            WHERE road_id = %s AND status_date = %s
            ORDER BY rail_pk_start
            """,
            (r["id"], effective),
        )
        for s in segs:
            s["pk_start"] = float(s["pk_start"]) if s["pk_start"] else 0
            s["pk_end"] = float(s["pk_end"]) if s["pk_end"] else 0
        r["segments"] = segs
        r["effective_date"] = effective.isoformat()
        r["ad_pk_start"] = float(r["ad_pk_start"])
        r["ad_pk_end"] = float(r["ad_pk_end"])
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
    Возка песка/ЩПГС. Матрица (участок × карьер × подрядчик × материал).
    Учёт прозрачного pass-through через накопитель:
      pit_to_constructive — считается как есть;
      pit_to_stockpile + stockpile_to_constructive (одинаковый материал,
      тот же участок) сливаются в один агрегат "pit_to_constructive",
      volume = min(pit_in, from_stockpile).
    Фронт получает уже обработанные данные, не парит мозг.
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["mm.report_date >= %s", "mm.report_date <= %s"]
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
               c.id                  AS contractor_id,
               c.name                AS contractor_name,
               c.short_name          AS contractor_short,
               c.kind                AS contractor_kind,
               mm.movement_type,
               SUM(mm.volume)::numeric        AS volume,
               SUM(mm.trip_count)::int        AS trips
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        LEFT JOIN objects pit ON pit.id = mm.from_object_id
        LEFT JOIN contractors c ON c.id = mm.contractor_id
        WHERE {' AND '.join(where)}
          AND mm.movement_type IN (
            'pit_to_constructive', 'pit_to_stockpile', 'stockpile_to_constructive'
          )
        GROUP BY cs.code, m.code, pit.name, pit.id,
                 c.id, c.name, c.short_name, c.kind, mm.movement_type
        """,
        params,
    )

    # Свёртка pass-through
    by_key: dict[tuple, dict] = {}
    stockpile_in: dict[tuple, float] = {}
    stockpile_out: dict[tuple, float] = {}
    for r in rows:
        key = (r["section_code"], r["material"], r["quarry_id"], r["contractor_id"])
        vol = float(r["volume"] or 0)
        if r["movement_type"] == "pit_to_stockpile":
            stockpile_in[key] = stockpile_in.get(key, 0) + vol
        elif r["movement_type"] == "stockpile_to_constructive":
            stockpile_out[key] = stockpile_out.get(key, 0) + vol
        else:  # pit_to_constructive
            if key not in by_key:
                by_key[key] = {
                    "section_code": r["section_code"],
                    "material": r["material"],
                    "quarry_id": str(r["quarry_id"]) if r["quarry_id"] else None,
                    "quarry_name": r["quarry_name"],
                    "contractor_id": str(r["contractor_id"]) if r["contractor_id"] else None,
                    "contractor_name": r["contractor_name"],
                    "contractor_short": r["contractor_short"],
                    "contractor_kind": r["contractor_kind"] or "subcontractor",
                    "volume": 0.0,
                    "trips": 0,
                }
            by_key[key]["volume"] += vol
            by_key[key]["trips"] += int(r["trips"] or 0)

    # Pass-through: добавляем min(pit_in, from_stockpile) в pit_to_constructive
    for key, vin in stockpile_in.items():
        vout = stockpile_out.get(key, 0)
        passed = min(vin, vout)
        if passed <= 0:
            continue
        if key not in by_key:
            # восстановим метаданные
            meta = next((r for r in rows if (r["section_code"], r["material"], r["quarry_id"], r["contractor_id"]) == key), {})
            by_key[key] = {
                "section_code": key[0],
                "material": key[1],
                "quarry_id": str(key[2]) if key[2] else None,
                "quarry_name": meta.get("quarry_name"),
                "contractor_id": str(key[3]) if key[3] else None,
                "contractor_name": meta.get("contractor_name"),
                "contractor_short": meta.get("contractor_short"),
                "contractor_kind": meta.get("contractor_kind") or "subcontractor",
                "volume": 0.0,
                "trips": 0,
            }
        by_key[key]["volume"] += passed

    result = list(by_key.values())
    for r in result:
        r["volume"] = round(r["volume"], 1)

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

    return {"rows": rows}


# ── equipment productivity ──────────────────────────────────────────────

@router.get("/equipment-productivity")
def equipment_productivity(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    section: Optional[str] = None,
):
    """
    Производительность техники с прозрачной формулой:
      result = {units, trips, avg_trip_volume, fact_volume,
                norm_per_unit, norm_total, percent}
    Выдаём числа для подстановки в тултип:
      «факт 2620 м³ ÷ (13 × 16 × 6 × 2) = 10.5%»
    """
    d_from, d_to = _parse_range(date_from, date_to)
    codes = _expand_sections(section)

    where = ["dr.report_date >= %s", "dr.report_date <= %s"]
    params: list = [d_from, d_to]
    if codes:
        where.append("cs.code = ANY(%s)")
        params.append(codes)

    # 1. Парк техники
    units = query(
        f"""
        SELECT reu.equipment_type,
               cs.code AS section_code,
               COUNT(*)::int AS units
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE {' AND '.join(where)}
          AND reu.status = 'working'
        GROUP BY reu.equipment_type, cs.code
        """,
        params,
    )

    # 2. Факт по самосвалам — из material_movements
    trips = query(
        f"""
        SELECT cs.code AS section_code,
               SUM(mm.volume)::numeric AS volume,
               SUM(mm.trip_count)::int AS trips
        FROM material_movements mm
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE {' AND '.join(where).replace('dr.report_date', 'mm.report_date')}
        GROUP BY cs.code
        """,
        params,
    )

    # 3. Нормативы
    norms = {
        (r["equipment_type"], r["metric"]): float(r["value"])
        for r in query(
            """
            SELECT equipment_type, metric, value
            FROM equipment_productivity_norms
            WHERE COALESCE(effective_to, CURRENT_DATE) >= CURRENT_DATE
            """
        )
    }

    # 4. Сборка
    by_section_type: dict[tuple, dict] = {}
    for u in units:
        key = (u["section_code"] or "—", u["equipment_type"] or "unknown")
        by_section_type.setdefault(key, {
            "section_code": key[0],
            "equipment_type": key[1],
            "units": 0,
            "trips": 0,
            "fact_volume": 0.0,
            "norm_per_unit": norms.get((key[1], "per_trip_m3"))
                             or norms.get((key[1], "excavation_m3_per_shift"))
                             or 0,
        })["units"] += int(u["units"])

    for t in trips:
        sc = t["section_code"] or "—"
        for et in ("dump_truck",):
            key = (sc, et)
            if key in by_section_type:
                by_section_type[key]["trips"] += int(t["trips"] or 0)
                by_section_type[key]["fact_volume"] += float(t["volume"] or 0)

    out = []
    days = (d_to - d_from).days + 1
    for v in by_section_type.values():
        norm_total = v["units"] * v["norm_per_unit"] * days * 2  # 2 смены
        percent = (v["fact_volume"] / norm_total * 100) if norm_total > 0 else 0
        avg_trip = (v["fact_volume"] / v["trips"]) if v["trips"] else 0
        out.append({
            **v,
            "days": days,
            "shifts": 2,
            "norm_total": round(norm_total, 1),
            "fact_volume": round(v["fact_volume"], 1),
            "avg_trip_volume": round(avg_trip, 2),
            "percent": round(percent, 1),
            "formula_human": (
                f"Факт {round(v['fact_volume'], 1)} м³ ÷ "
                f"({v['units']} ед. × {v['norm_per_unit']} × "
                f"{days} дн. × 2 смены) = {round(percent, 1)}%"
            ),
        })
    out.sort(key=lambda x: (x["section_code"], x["equipment_type"]))
    return {"from": d_from.isoformat(), "to": d_to.isoformat(), "rows": out}
