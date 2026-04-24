"""VSM Dashboard API — FastAPI backend for works_db_v2."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict
from collections import defaultdict
from datetime import date as date_cls, datetime, timedelta

# Keep 'date' available as type for backward compat
date = date_cls

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB = dict(
    dbname=os.getenv('DB_NAME', 'works_db_v2'),
    user=os.getenv('DB_USER', 'works_user'),
    password=os.getenv('DB_PASSWORD', 'changeme'),
    host=os.getenv('DB_HOST', '127.0.0.1'),
    port=int(os.getenv('DB_PORT', '5433')),
)


def get_conn():
    return psycopg2.connect(**DB)


def query(sql: str, params=None) -> list[dict]:
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def query_one(sql: str, params=None) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Test DB connection on startup
    conn = get_conn()
    conn.close()
    yield

app = FastAPI(title="VSM Dashboard API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── GEO endpoints ────────────────────────────────────────────────────────

@app.get("/api/geo/pickets")
def geo_pickets(pk_from: int | None = None, pk_to: int | None = None):
    """Route pickets (axis points for map)."""
    sql = "SELECT pk_number, pk_name, latitude, longitude FROM route_pickets"
    conditions = []
    params: list = []
    if pk_from is not None:
        conditions.append("pk_number >= %s")
        params.append(pk_from)
    if pk_to is not None:
        conditions.append("pk_number <= %s")
        params.append(pk_to)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY pk_number"
    return query(sql, params)


@app.get("/api/geo/sections")
def geo_sections():
    """Construction sections with PK ranges and colors."""
    return query("""
        SELECT cs.code, cs.name, cs.map_color, cs.sort_order,
               csv.pk_start, csv.pk_end, csv.pk_raw_text
        FROM construction_sections cs
        LEFT JOIN construction_section_versions csv
          ON csv.section_id = cs.id AND csv.is_current = true
        ORDER BY cs.sort_order NULLS LAST, cs.code
    """)


@app.get("/api/geo/objects")
def geo_objects(section: str | None = None, obj_type: str | None = None):
    """Objects with segments and cached coordinates."""
    sql = """
        SELECT o.object_code, o.name, ot.code as type_code, ot.name as type_name,
               os.pk_start, os.pk_end, os.pk_raw_text,
               os.start_lat, os.start_lng, os.end_lat, os.end_lng
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id
        LEFT JOIN object_segments os ON os.object_id = o.id
        WHERE 1=1
    """
    params: list = []
    if obj_type:
        sql += " AND ot.code = %s"
        params.append(obj_type)
    sql += " ORDER BY os.pk_start NULLS LAST"
    return query(sql, params)


@app.get("/api/geo/pile-fields")
def geo_pile_fields():
    """Pile fields with coordinates."""
    return query("""
        SELECT field_code, field_type, pile_type,
               pk_start, pk_end, pile_count, dynamic_test_count,
               start_lat, start_lng, end_lat, end_lng
        FROM pile_fields
        ORDER BY pk_start
    """)


# ── DASHBOARD endpoints ──────────────────────────────────────────────────

@app.get("/api/dashboard/summary")
def dashboard_summary():
    """Overall dashboard: KPI + sections progress."""
    sections_raw = query("""
        SELECT cs.code, cs.name, cs.map_color, cs.sort_order,
               csv.pk_start, csv.pk_end, csv.pk_raw_text
        FROM construction_sections cs
        LEFT JOIN construction_section_versions csv
          ON csv.section_id = cs.id AND csv.is_current = true
        WHERE cs.is_active = true
        ORDER BY cs.sort_order NULLS LAST
    """)

    sections = []
    total_planned = 0
    total_completed = 0
    active = 0

    for sec in sections_raw:
        # Planned volume
        planned = query_one("""
            SELECT COALESCE(SUM(pwi.project_volume), 0) as vol
            FROM project_work_items pwi
            JOIN objects o ON o.id = pwi.object_id
            JOIN construction_sections cs ON cs.code = %s
        """, (sec['code'],))

        # Completed volume
        completed = query_one("""
            SELECT COALESCE(SUM(dwi.volume), 0) as vol
            FROM daily_work_items dwi
            JOIN construction_sections cs ON cs.id = dwi.section_id AND cs.code = %s
        """, (sec['code'],))

        # Last report
        last_report = query_one("""
            SELECT MAX(dr.report_date) as last_date
            FROM daily_reports dr
            JOIN construction_sections cs ON cs.id = dr.section_id AND cs.code = %s
        """, (sec['code'],))

        pv = float(planned['vol']) if planned else 0
        cv = float(completed['vol']) if completed else 0
        pct = (cv / pv * 100) if pv > 0 else 0
        total_planned += pv
        total_completed += cv

        ld = last_report['last_date'] if last_report else None
        if ld and (date.today() - ld).days < 14:
            active += 1

        pk_range = sec.get('pk_raw_text') or ''
        if sec.get('pk_start') and sec.get('pk_end'):
            pk_s = sec['pk_start']
            pk_e = sec['pk_end']
            pk_range = f"ПК{int(pk_s//100)}+{int(pk_s%100):02d} - ПК{int(pk_e//100)}+{int(pk_e%100):02d}"

        sections.append({
            'code': sec['code'],
            'name': sec['name'],
            'map_color': sec.get('map_color') or '#64748b',
            'pk_range': pk_range,
            'progress_percent': round(pct, 1),
            'planned_volume': pv,
            'completed_volume': cv,
            'last_report_date': str(ld) if ld else None,
        })

    # Reports this week
    week_ago = date.today() - timedelta(days=7)
    reports_week = query_one(
        "SELECT COUNT(*) as cnt FROM daily_reports WHERE report_date >= %s",
        (week_ago,),
    )

    # Total objects
    total_objects = query_one("SELECT COUNT(*) as cnt FROM objects")

    overall_pct = (total_completed / total_planned * 100) if total_planned > 0 else 0

    return {
        'sections': sections,
        'totals': {
            'overall_percent': round(overall_pct, 1),
            'active_sections': active,
            'total_objects': total_objects['cnt'] if total_objects else 0,
            'reports_this_week': reports_week['cnt'] if reports_week else 0,
        },
    }


@app.get("/api/dashboard/section/{code}")
def dashboard_section(code: str):
    """Detailed section view."""
    section = query_one("""
        SELECT cs.id, cs.code, cs.name, cs.map_color,
               csv.pk_start, csv.pk_end
        FROM construction_sections cs
        LEFT JOIN construction_section_versions csv
          ON csv.section_id = cs.id AND csv.is_current = true
        WHERE cs.code = %s
    """, (code,))
    if not section:
        return {"error": "Section not found"}

    work_items = query("""
        SELECT wt.code as work_type_code, wt.name as work_type_name,
               COALESCE(SUM(dwi.volume), 0) as completed,
               dwi.unit
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        WHERE dwi.section_id = %s
        GROUP BY wt.code, wt.name, dwi.unit
        ORDER BY completed DESC
    """, (section['id'],))

    recent_reports = query("""
        SELECT dr.report_date, dr.shift, dr.source_type, dr.parse_status
        FROM daily_reports dr
        WHERE dr.section_id = %s
        ORDER BY dr.report_date DESC
        LIMIT 10
    """, (section['id'],))

    return {
        'section': section,
        'work_items': work_items,
        'recent_reports': recent_reports,
    }


@app.get("/api/dashboard/timeline")
def dashboard_timeline(days: int = 30):
    """Daily volumes timeline."""
    since = date.today() - timedelta(days=days)
    return query("""
        SELECT dwi.report_date as date,
               COALESCE(SUM(dwi.volume), 0) as volume,
               COUNT(DISTINCT dwi.daily_report_id) as reports
        FROM daily_work_items dwi
        WHERE dwi.report_date >= %s
        GROUP BY dwi.report_date
        ORDER BY dwi.report_date
    """, (since,))


# ── REPORTS endpoints ────────────────────────────────────────────────────

class ReportUploadBody(BaseModel):
    text: str
    section_code: str
    date: str          # YYYY-MM-DD
    shift: str         # day | night


class CandidateUpdateBody(BaseModel):
    candidate_type: str | None = None
    data: dict | None = None
    accepted: bool | None = None


def _ensure_parse_tables():
    """Create daily_report_parse_candidates table if not exists."""
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS daily_report_parse_candidates (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        daily_report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
                        candidate_type VARCHAR(50) NOT NULL,
                        data JSONB NOT NULL DEFAULT '{}',
                        confidence REAL NOT NULL DEFAULT 0.8,
                        accepted BOOLEAN DEFAULT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
                # Add status column to daily_reports if missing
                cur.execute("""
                    DO $$ BEGIN
                        ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';
                    EXCEPTION WHEN duplicate_column THEN NULL; END $$
                """)
    finally:
        conn.close()


@app.on_event("startup")
def _init_tables():
    try:
        _ensure_parse_tables()
    except Exception:
        pass  # Will fail gracefully if DB is not yet available
    # Settings tables (equipment_norms_config, work_type_aliases) + seed + in-memory refresh.
    try:
        from wip_routes import _init_settings as _wip_init_settings
        _wip_init_settings()
    except Exception:
        pass


@app.post("/api/reports/upload")
def report_upload(body: ReportUploadBody):
    """Accept text report, create daily_report with status 'draft'."""
    try:
        report_date = date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "Invalid date format, expected YYYY-MM-DD")

    shift = body.shift if body.shift in ('day', 'night') else 'unknown'

    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Get section_id
                cur.execute(
                    "SELECT id FROM construction_sections WHERE code = %s",
                    (body.section_code,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, f"Section {body.section_code} not found")
                section_id = row['id']

                source_ref = f"web_upload:{report_date}:{shift}:{body.section_code}"

                cur.execute(
                    """INSERT INTO daily_reports
                       (report_date, shift, section_id, source_type, source_reference,
                        raw_text, parse_status, operator_status, status)
                       VALUES (%s, %s, %s, 'web_text', %s, %s, 'pending', 'pending', 'draft')
                       RETURNING id, report_date, shift, status""",
                    (report_date, shift, section_id, source_ref, body.text[:10000]),
                )
                created = dict(cur.fetchone())
                return {
                    "id": created['id'],
                    "report_date": str(created['report_date']),
                    "shift": created['shift'],
                    "status": created['status'],
                }
    finally:
        conn.close()


@app.post("/api/reports/{report_id}/parse")
def report_parse(report_id: int):
    """Parse the raw text using parse_daily_text_report, store results as candidates."""
    from parse_daily_text_report import parse_report as parse_text_report

    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, raw_text, status FROM daily_reports WHERE id = %s",
                    (report_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Report not found")

                # Update status to parsing
                cur.execute(
                    "UPDATE daily_reports SET status = 'parsing', parse_status = 'parsing' WHERE id = %s",
                    (report_id,),
                )

                raw_text = row['raw_text'] or ''
                parsed = parse_text_report(raw_text)

                # Clear old candidates
                cur.execute(
                    "DELETE FROM daily_report_parse_candidates WHERE daily_report_id = %s",
                    (report_id,),
                )

                candidates = []
                sort_idx = 0

                # Transport candidates
                for t in parsed.transport:
                    eq = asdict(t.equipment) if t.equipment else {}
                    data = {
                        'material': t.material,
                        'from_location': t.from_location,
                        'to_location': t.to_location,
                        'route_type': t.route_type,
                        'equipment': eq,
                        'volume': t.volume,
                        'unit': t.unit,
                        'trip_count': t.trip_count,
                    }
                    confidence = 0.85 if t.volume > 0 and t.material else 0.6
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'movement', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), confidence, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'movement', 'data': data, 'confidence': confidence})
                    sort_idx += 1

                # Main works candidates
                for w in parsed.main_works:
                    eq = asdict(w.equipment) if w.equipment else {}
                    data = {
                        'constructive': w.constructive,
                        'work_name': w.work_name,
                        'pk_start': w.pk_start,
                        'pk_end': w.pk_end,
                        'pk_raw': w.pk_raw,
                        'equipment': eq,
                        'volume': w.volume,
                        'unit': w.unit,
                        'work_group': 'main',
                    }
                    confidence = 0.9 if w.volume > 0 and w.work_name else 0.65
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'work', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), confidence, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'work', 'data': data, 'confidence': confidence})
                    sort_idx += 1

                # Auxiliary works candidates
                for w in parsed.auxiliary_works:
                    eq = asdict(w.equipment) if w.equipment else {}
                    data = {
                        'constructive': w.constructive,
                        'work_name': w.work_name,
                        'pk_start': w.pk_start,
                        'pk_end': w.pk_end,
                        'pk_raw': w.pk_raw,
                        'equipment': eq,
                        'volume': w.volume,
                        'unit': w.unit,
                        'work_group': 'auxiliary',
                    }
                    confidence = 0.85 if w.volume > 0 else 0.6
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'work', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), confidence, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'work', 'data': data, 'confidence': confidence})
                    sort_idx += 1

                # Equipment candidates (from all transport + works)
                seen_equipment = set()
                all_eq_entries = []
                for t in parsed.transport:
                    if t.equipment and t.equipment.equipment_type:
                        all_eq_entries.append(t.equipment)
                for w in parsed.main_works + parsed.auxiliary_works:
                    if w.equipment and w.equipment.equipment_type:
                        all_eq_entries.append(w.equipment)
                for eq in all_eq_entries:
                    key = f"{eq.equipment_type}|{eq.brand_model}|{eq.unit_number}"
                    if key in seen_equipment:
                        continue
                    seen_equipment.add(key)
                    data = asdict(eq)
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'equipment', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), 0.9, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'equipment', 'data': data, 'confidence': 0.9})
                    sort_idx += 1

                # Problem candidates
                for p in parsed.problems:
                    data = {'text': p.text}
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'problem', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), 0.95, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'problem', 'data': data, 'confidence': 0.95})
                    sort_idx += 1

                # Personnel candidates
                for p in parsed.personnel:
                    data = {'category': p.category, 'count': p.count}
                    cur.execute(
                        """INSERT INTO daily_report_parse_candidates
                           (daily_report_id, candidate_type, data, confidence, sort_order)
                           VALUES (%s, 'personnel', %s, %s, %s)
                           RETURNING id""",
                        (report_id, json.dumps(data, ensure_ascii=False), 0.95, sort_idx),
                    )
                    cid = cur.fetchone()['id']
                    candidates.append({'id': str(cid), 'type': 'personnel', 'data': data, 'confidence': 0.95})
                    sort_idx += 1

                # Update status to review
                cur.execute(
                    "UPDATE daily_reports SET status = 'review', parse_status = 'parsed' WHERE id = %s",
                    (report_id,),
                )

                return {
                    "report_id": report_id,
                    "status": "review",
                    "candidates_count": len(candidates),
                    "candidates": candidates,
                }
    finally:
        conn.close()


@app.get("/api/reports")
def reports_list(
    section: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    page: int = 1,
    per_page: int = 20,
):
    """List reports with pagination and filters."""
    conditions = []
    params: list = []

    if section:
        conditions.append("cs.code = %s")
        params.append(section)
    if date_from:
        conditions.append("dr.report_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("dr.report_date <= %s")
        params.append(date_to)
    if status:
        conditions.append("COALESCE(dr.status, 'draft') = %s")
        params.append(status)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    # Count total
    count_row = query_one(
        f"SELECT COUNT(*) as total FROM daily_reports dr "
        f"JOIN construction_sections cs ON cs.id = dr.section_id {where}",
        params,
    )
    total = count_row['total'] if count_row else 0

    offset = (page - 1) * per_page
    params_with_limit = params + [per_page, offset]

    rows = query(
        f"""SELECT dr.id, dr.report_date, dr.shift, cs.code as section_code, cs.name as section_name,
                   dr.source_type, COALESCE(dr.status, 'draft') as status,
                   dr.parse_status, dr.created_at,
                   (SELECT COUNT(*) FROM daily_report_parse_candidates c WHERE c.daily_report_id = dr.id) as candidates_count
            FROM daily_reports dr
            JOIN construction_sections cs ON cs.id = dr.section_id
            {where}
            ORDER BY dr.report_date DESC, dr.created_at DESC
            LIMIT %s OFFSET %s""",
        params_with_limit,
    )

    # Serialize dates/datetimes
    for r in rows:
        for k in ('report_date', 'created_at'):
            if r.get(k) and hasattr(r[k], 'isoformat'):
                r[k] = r[k].isoformat()

    return {
        'items': rows,
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': max(1, (total + per_page - 1) // per_page),
    }


@app.get("/api/reports/{report_id}")
def report_detail(report_id: int):
    """Report detail with candidates."""
    report = query_one(
        """SELECT dr.id, dr.report_date, dr.shift, cs.code as section_code,
                  cs.name as section_name, dr.source_type, dr.raw_text,
                  COALESCE(dr.status, 'draft') as status, dr.parse_status,
                  dr.created_at
           FROM daily_reports dr
           JOIN construction_sections cs ON cs.id = dr.section_id
           WHERE dr.id = %s""",
        (report_id,),
    )
    if not report:
        raise HTTPException(404, "Report not found")

    for k in ('report_date', 'created_at'):
        if report.get(k) and hasattr(report[k], 'isoformat'):
            report[k] = report[k].isoformat()

    candidates = query(
        """SELECT id, candidate_type, data, confidence, accepted, sort_order
           FROM daily_report_parse_candidates
           WHERE daily_report_id = %s
           ORDER BY sort_order""",
        (report_id,),
    )
    for c in candidates:
        c['id'] = str(c['id'])

    report['candidates'] = candidates
    return report


@app.patch("/api/reports/{report_id}/candidates/{candidate_id}")
def update_candidate(report_id: int, candidate_id: str, body: CandidateUpdateBody):
    """Update a parse candidate (edit parsed values or accept/skip)."""
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, data FROM daily_report_parse_candidates WHERE id = %s AND daily_report_id = %s",
                    (candidate_id, report_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Candidate not found")

                updates = []
                params: list = []
                if body.data is not None:
                    updates.append("data = %s")
                    params.append(json.dumps(body.data, ensure_ascii=False))
                if body.candidate_type is not None:
                    updates.append("candidate_type = %s")
                    params.append(body.candidate_type)
                if body.accepted is not None:
                    updates.append("accepted = %s")
                    params.append(body.accepted)

                updates.append("updated_at = NOW()")

                if updates:
                    params.append(candidate_id)
                    cur.execute(
                        f"UPDATE daily_report_parse_candidates SET {', '.join(updates)} WHERE id = %s",
                        params,
                    )

                # Return updated
                cur.execute(
                    "SELECT id, candidate_type, data, confidence, accepted, sort_order "
                    "FROM daily_report_parse_candidates WHERE id = %s",
                    (candidate_id,),
                )
                updated = dict(cur.fetchone())
                updated['id'] = str(updated['id'])
                return updated
    finally:
        conn.close()


@app.post("/api/reports/{report_id}/confirm")
def report_confirm(report_id: int):
    """Import confirmed candidates to DB using import_daily_text_report."""
    from parse_daily_text_report import (
        ParsedReport, TransportItem, WorkItem, EquipmentEntry,
        ProblemItem, PersonnelItem,
    )
    from import_daily_text_report import import_report as do_import

    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, raw_text, report_date, shift, status FROM daily_reports WHERE id = %s",
                    (report_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Report not found")
                if row['status'] == 'confirmed':
                    raise HTTPException(400, "Report already confirmed")

                # Get accepted candidates (accepted = true or accepted IS NULL for auto-accept)
                cur.execute(
                    """SELECT candidate_type, data, confidence, accepted
                       FROM daily_report_parse_candidates
                       WHERE daily_report_id = %s AND (accepted = true OR accepted IS NULL)
                       ORDER BY sort_order""",
                    (report_id,),
                )
                candidates = [dict(r) for r in cur.fetchall()]

                # Get section code
                cur.execute(
                    "SELECT cs.code FROM construction_sections cs "
                    "JOIN daily_reports dr ON dr.section_id = cs.id WHERE dr.id = %s",
                    (report_id,),
                )
                sec_row = cur.fetchone()
                section_code = sec_row['code'] if sec_row else ''
                section_num = ''.join(c for c in section_code if c.isdigit()) or section_code

        # Build a ParsedReport from candidates
        report_date = row['report_date']
        shift_val = row['shift'] or 'unknown'

        parsed = ParsedReport(
            report_date=report_date,
            shift=shift_val,
            section=section_num,
            raw_text=row['raw_text'] or '',
        )

        for c in candidates:
            d = c['data'] if isinstance(c['data'], dict) else json.loads(c['data'])
            ctype = c['candidate_type']

            if ctype == 'movement':
                eq_d = d.get('equipment', {})
                eq = EquipmentEntry(
                    operator_name=eq_d.get('operator_name', ''),
                    equipment_type=eq_d.get('equipment_type', ''),
                    brand_model=eq_d.get('brand_model', ''),
                    unit_number=eq_d.get('unit_number', ''),
                    plate_number=eq_d.get('plate_number', ''),
                    ownership=eq_d.get('ownership', 'own'),
                    contractor_name=eq_d.get('contractor_name', ''),
                )
                parsed.transport.append(TransportItem(
                    material=d.get('material', ''),
                    from_location=d.get('from_location', ''),
                    to_location=d.get('to_location', ''),
                    route_type=d.get('route_type', ''),
                    equipment=eq,
                    volume=float(d.get('volume', 0)),
                    unit=d.get('unit', 'м3'),
                    trip_count=int(d.get('trip_count', 0)),
                ))
            elif ctype == 'work':
                eq_d = d.get('equipment', {})
                eq = EquipmentEntry(
                    operator_name=eq_d.get('operator_name', ''),
                    equipment_type=eq_d.get('equipment_type', ''),
                    brand_model=eq_d.get('brand_model', ''),
                    unit_number=eq_d.get('unit_number', ''),
                    plate_number=eq_d.get('plate_number', ''),
                    ownership=eq_d.get('ownership', 'own'),
                    contractor_name=eq_d.get('contractor_name', ''),
                )
                wi = WorkItem(
                    constructive=d.get('constructive', ''),
                    work_name=d.get('work_name', ''),
                    pk_start=d.get('pk_start', ''),
                    pk_end=d.get('pk_end', ''),
                    pk_raw=d.get('pk_raw', ''),
                    equipment=eq,
                    volume=float(d.get('volume', 0)),
                    unit=d.get('unit', 'м3'),
                )
                if d.get('work_group') == 'auxiliary':
                    parsed.auxiliary_works.append(wi)
                else:
                    parsed.main_works.append(wi)
            elif ctype == 'problem':
                parsed.problems.append(ProblemItem(text=d.get('text', '')))
            elif ctype == 'personnel':
                parsed.personnel.append(PersonnelItem(
                    category=d.get('category', ''),
                    count=int(d.get('count', 0)),
                ))

        # Delete the draft report row before import (import_report will create its own)
        # Actually, we should just run the importer which handles upsert
        stats = do_import(parsed)

        # Update the web-upload report status to confirmed
        conn2 = get_conn()
        try:
            with conn2:
                with conn2.cursor() as cur2:
                    cur2.execute(
                        "UPDATE daily_reports SET status = 'confirmed', parse_status = 'imported' WHERE id = %s",
                        (report_id,),
                    )
        finally:
            conn2.close()

        return {
            "report_id": report_id,
            "status": "confirmed",
            "import_stats": stats,
        }
    finally:
        conn.close()


@app.delete("/api/reports/{report_id}")
def report_delete(report_id: int):
    """Delete a draft report."""
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, status FROM daily_reports WHERE id = %s",
                    (report_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Report not found")
                if row['status'] not in ('draft', 'review', None):
                    raise HTTPException(400, "Can only delete draft/review reports")

                # Delete candidates first
                cur.execute(
                    "DELETE FROM daily_report_parse_candidates WHERE daily_report_id = %s",
                    (report_id,),
                )
                cur.execute("DELETE FROM daily_reports WHERE id = %s", (report_id,))
                return {"ok": True, "deleted_id": report_id}
    finally:
        conn.close()


@app.get("/api/sections/list")
def sections_list():
    """List all active construction sections for dropdowns."""
    return query("""
        SELECT cs.code, cs.name
        FROM construction_sections cs
        WHERE cs.is_active = true
        ORDER BY cs.sort_order NULLS LAST, cs.code
    """)


# ── ANALYTICS endpoints ──────────────────────────────────────────────────

# Mapping work_type codes to analytics categories
_WORK_TYPE_CATEGORY = {
    'EMBANKMENT_CONSTRUCTION': 'sand',
    'PAVEMENT_SANDING': 'sand',
    'WEAK_SOIL_REPLACEMENT': 'sand',
    'EARTH_EXCAVATION': 'excavation',
    'PEAT_REMOVAL': 'excavation',
    'TOPSOIL_STRIPPING': 'excavation',
    'CRUSHED_STONE_PLACEMENT': 'shps',
    'FIRST_PROTECTIVE_LAYER': 'prs',
    'SECOND_PROTECTIVE_LAYER': 'prs',
    'GEOTEXTILE_LAYER': 'prs',
    'GEOTEXTILE_LAYER_DO': 'prs',
    'SHOULDER_BACKFILL': 'prs',
    'SLOPE_FORMATION': 'prs',
    'AREA_GRADING': 'prs',
    'DITCH_CONSTRUCTION': 'prs',
}

# Material code -> analytics key
_MATERIAL_CATEGORY = {
    'SAND': ('sand', 'Песок'),
    'SOIL': ('soil', 'Грунт'),
    'SHPGS': ('shps', 'ЩПГС'),
    'PEAT': ('gravel', 'Торф'),
}

ALL_SECTIONS = ['UCH_1', 'UCH_2', 'UCH_3', 'UCH_31', 'UCH_32',
                'UCH_4', 'UCH_5', 'UCH_6', 'UCH_7', 'UCH_8']


def _parse_analytics_params(
    period: str = 'day',
    section: str = 'all',
    shift: str = 'all',
    date_str: str | None = None,
) -> tuple[date, date, str | None, str | None]:
    """Return (date_from, date_to, section_code_or_none, shift_or_none)."""
    ref_date = date.fromisoformat(date_str) if date_str else date.today() - timedelta(days=1)
    if period == 'day':
        d_from = d_to = ref_date
    elif period == 'week':
        d_from = ref_date - timedelta(days=6)
        d_to = ref_date
    elif period == 'month':
        d_from = ref_date.replace(day=1)
        d_to = ref_date
    else:  # total
        d_from = date(2020, 1, 1)
        d_to = ref_date
    sec = None if section == 'all' else section
    sh = None if shift == 'all' else shift
    return d_from, d_to, sec, sh


def _build_where(
    date_col: str,
    d_from: date,
    d_to: date,
    section_code: str | None,
    shift_val: str | None,
    section_join_alias: str = 'cs',
    shift_col: str | None = None,
) -> tuple[str, list]:
    """Build WHERE clause fragments and params list."""
    clauses = [f"{date_col} >= %s", f"{date_col} <= %s"]
    params: list = [d_from, d_to]
    if section_code:
        clauses.append(f"{section_join_alias}.code = %s")
        params.append(section_code)
    if shift_val and shift_col:
        clauses.append(f"{shift_col} = %s")
        params.append(shift_val)
    return " AND ".join(clauses), params


@app.get("/api/dashboard/analytics/summary")
def analytics_summary(
    period: str = 'day',
    section: str = 'all',
    shift: str = 'all',
    date: str | None = None,
):
    """Aggregated work volumes by type category."""
    d_from, d_to, sec, sh = _parse_analytics_params(period, section, shift, date)

    # ── Fact volumes from daily_work_items ────────────────────────────
    where_clause, params = _build_where(
        'dwi.report_date', d_from, d_to, sec, sh,
        section_join_alias='cs', shift_col='dwi.shift',
    )
    fact_rows = query(f"""
        SELECT wt.code AS wt_code,
               dwi.shift,
               COALESCE(SUM(dwi.volume), 0) AS vol
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {where_clause}
        GROUP BY wt.code, dwi.shift
    """, params)

    # ── Transport volumes from material_movements ─────────────────────
    where_mm, params_mm = _build_where(
        'mm.report_date', d_from, d_to, sec, sh,
        section_join_alias='cs', shift_col='mm.shift',
    )
    transport_rows = query(f"""
        SELECT COALESCE(SUM(mm.volume), 0) AS vol,
               mm.shift
        FROM material_movements mm
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE {where_mm}
        GROUP BY mm.shift
    """, params_mm)

    # Build category aggregates
    categories = {
        'sand': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0, 'percent': 0},
        'excavation': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0, 'percent': 0},
        'transport': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0, 'percent': 0},
        'prs': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0, 'percent': 0},
        'soil': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0},
        'shps': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0},
        'gravel': {'plan': 0, 'fact': 0, 'fact_day': 0, 'fact_night': 0},
    }

    for row in fact_rows:
        cat = _WORK_TYPE_CATEGORY.get(row['wt_code'])
        if not cat:
            continue
        vol = float(row['vol'])
        categories[cat]['fact'] += vol
        if row['shift'] == 'day':
            categories[cat]['fact_day'] += vol
        elif row['shift'] == 'night':
            categories[cat]['fact_night'] += vol

    # Transport from material_movements
    for row in transport_rows:
        vol = float(row['vol'])
        categories['transport']['fact'] += vol
        if row['shift'] == 'day':
            categories['transport']['fact_day'] += vol
        elif row['shift'] == 'night':
            categories['transport']['fact_night'] += vol

    # ── Plan from project_work_items ──────────────────────────────────
    plan_where_parts = ["1=1"]
    plan_params: list = []
    if sec:
        # Filter by section: objects linked to the section via constructive or object_segments
        plan_where_parts.append("""
            EXISTS (
                SELECT 1 FROM object_segments os
                JOIN construction_section_versions csv ON csv.is_current = true
                    AND os.pk_start < csv.pk_end AND os.pk_end > csv.pk_start
                JOIN construction_sections cs2 ON cs2.id = csv.section_id AND cs2.code = %s
                WHERE os.object_id = pwi.object_id
            )
        """)
        plan_params.append(sec)

    plan_rows = query(f"""
        SELECT wt.code AS wt_code,
               COALESCE(SUM(pwi.project_volume), 0) AS vol
        FROM project_work_items pwi
        JOIN work_types wt ON wt.id = pwi.work_type_id
        WHERE {' AND '.join(plan_where_parts)}
        GROUP BY wt.code
    """, plan_params)

    for row in plan_rows:
        cat = _WORK_TYPE_CATEGORY.get(row['wt_code'])
        if not cat:
            continue
        categories[cat]['plan'] += float(row['vol'])

    # Transport plan: sum of sand plan (rough proxy — sand must be transported)
    categories['transport']['plan'] = categories['sand']['plan']

    # Compute percent
    for cat_data in categories.values():
        plan_val = cat_data.get('plan', 0)
        if plan_val > 0:
            cat_data['percent'] = round(cat_data['fact'] / plan_val * 100, 1)

    # Round all numeric values
    for cat_data in categories.values():
        for k, v in cat_data.items():
            if isinstance(v, float):
                cat_data[k] = round(v, 1)

    return {
        'period': period,
        'date': str(d_to),
        **categories,
    }


# ── PDF endpoints ───────────────────────────────────────────────────


class PDFRequest(BaseModel):
    date: str | None = None  # YYYY-MM-DD, defaults to yesterday


@app.post("/api/pdf/analytics")
def pdf_analytics(body: PDFRequest | None = None):
    """Generate analytics PDF (3-page A4 landscape)."""
    from fastapi.responses import Response

    report_date = None
    if body and body.date:
        try:
            report_date = date.fromisoformat(body.date)
        except ValueError:
            raise HTTPException(400, "Invalid date format, expected YYYY-MM-DD")

    # Import here to avoid loading weasyprint at startup
    sys.path.insert(0, os.path.dirname(__file__))
    from pdf.analytics import generate_analytics_pdf

    pdf_bytes = generate_analytics_pdf(report_date)
    d = report_date or (date.today() - timedelta(days=1))
    filename_ascii = f"VSM_Analytics_{d.strftime('%Y-%m-%d')}.pdf"
    filename_utf8 = f"VSM_Аналитика_{d.strftime('%Y-%m-%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename_ascii}\"; filename*=UTF-8''{urllib.parse.quote(filename_utf8)}",
        },
    )


@app.post("/api/pdf/quarry-report")
def pdf_quarry_report(body: PDFRequest | None = None):
    """Generate daily quarry report PDF (A4 landscape)."""
    from fastapi.responses import Response

    report_date = None
    if body and body.date:
        try:
            report_date = date.fromisoformat(body.date)
        except ValueError:
            raise HTTPException(400, "Invalid date format, expected YYYY-MM-DD")

    sys.path.insert(0, os.path.dirname(__file__))
    from pdf.quarry_report import generate_quarry_pdf

    pdf_bytes = generate_quarry_pdf(report_date)
    d = report_date or (date.today() - timedelta(days=1))
    filename_ascii = f"VSM_Quarry_{d.strftime('%Y-%m-%d')}.pdf"
    filename_utf8 = f"VSM_Суточный_{d.strftime('%Y-%m-%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename_ascii}\"; filename*=UTF-8''{urllib.parse.quote(filename_utf8)}",
        },
    )


# WIP API routes
try:
    from wip_routes import router as wip_router
    from wip_analytics_routes import router as wip_analytics_router
    app.include_router(wip_analytics_router)
    app.include_router(wip_router)
except ImportError:
    pass

try:
    from wip_map_routes import router as wip_map_router
    app.include_router(wip_map_router)
except ImportError:
    pass

try:
    from reports_routes import router as reports_router
    app.include_router(reports_router)
except ImportError:
    pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090)
