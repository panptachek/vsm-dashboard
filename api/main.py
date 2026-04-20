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

# Add workspace to sys.path so we can import the parser/importer
sys.path.insert(0, '/home/aboba/.openclaw/workspace')

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


@app.get("/api/dashboard/analytics/materials")
def analytics_materials(
    period: str = 'day',
    section: str = 'all',
    shift: str = 'all',
    date: str | None = None,
):
    """Materials breakdown by section."""
    d_from, d_to, sec, sh = _parse_analytics_params(period, section, shift, date)

    # Base WHERE (no shift filter for sub-row breakdowns)
    where_base, params_base = _build_where(
        'mm.report_date', d_from, d_to, sec, None,
        section_join_alias='cs', shift_col=None,
    )

    # Full query: material, section, shift, movement_type, labor_source_type
    detail_rows = query(f"""
        SELECT m.code AS mat_code, m.name AS mat_name,
               cs.code AS sec_code,
               mm.shift,
               mm.movement_type,
               mm.labor_source_type,
               COALESCE(SUM(mm.volume), 0) AS vol
        FROM material_movements mm
        JOIN materials m ON m.id = mm.material_id
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE {where_base}
        GROUP BY m.code, m.name, cs.code, mm.shift, mm.movement_type, mm.labor_source_type
    """, params_base)

    # Build nested structure
    # mat_code -> {total, by_section, day, night, to_stockpile, from_stockpile, hired}
    mat_data: dict[str, dict] = {}
    for row in detail_rows:
        mc = row['mat_code']
        if mc not in mat_data:
            mat_data[mc] = {
                'name': row['mat_name'],
                'total': 0,
                'by_section': {s: 0.0 for s in ALL_SECTIONS},
                'day': {'total': 0, 'by_section': {s: 0.0 for s in ALL_SECTIONS}},
                'night': {'total': 0, 'by_section': {s: 0.0 for s in ALL_SECTIONS}},
                'to_stockpile': {'total': 0, 'by_section': {s: 0.0 for s in ALL_SECTIONS}},
                'from_stockpile': {'total': 0, 'by_section': {s: 0.0 for s in ALL_SECTIONS}},
                'hired': {'total': 0, 'by_section': {s: 0.0 for s in ALL_SECTIONS}},
            }
        v = float(row['vol'])
        sec_code = row['sec_code'] or 'UCH_1'
        if sec_code not in mat_data[mc]['by_section']:
            continue  # skip unknown sections

        # Apply shift filter if given
        if sh and row['shift'] != sh:
            continue

        mat_data[mc]['total'] += v
        mat_data[mc]['by_section'][sec_code] += v

        if row['shift'] == 'day':
            mat_data[mc]['day']['total'] += v
            mat_data[mc]['day']['by_section'][sec_code] += v
        elif row['shift'] == 'night':
            mat_data[mc]['night']['total'] += v
            mat_data[mc]['night']['by_section'][sec_code] += v

        if row['movement_type'] == 'pit_to_stockpile':
            mat_data[mc]['to_stockpile']['total'] += v
            mat_data[mc]['to_stockpile']['by_section'][sec_code] += v
        elif row['movement_type'] == 'stockpile_to_constructive':
            mat_data[mc]['from_stockpile']['total'] += v
            mat_data[mc]['from_stockpile']['by_section'][sec_code] += v

        if row['labor_source_type'] == 'hired':
            mat_data[mc]['hired']['total'] += v
            mat_data[mc]['hired']['by_section'][sec_code] += v

    def _round_section_dict(d: dict) -> dict:
        return {k: round(v, 1) if isinstance(v, float) else v for k, v in d.items()}

    # Material ordering
    mat_order = ['SAND', 'SOIL', 'SHPGS', 'PEAT']
    mat_labels = {'SAND': 'sand', 'SOIL': 'soil', 'SHPGS': 'shps', 'PEAT': 'gravel'}

    rows_out = []
    for mc in mat_order:
        md = mat_data.get(mc)
        if not md:
            md = {
                'name': _MATERIAL_CATEGORY.get(mc, (mc, mc))[1],
                'total': 0,
                'by_section': {s: 0 for s in ALL_SECTIONS},
                'day': {'total': 0, 'by_section': {s: 0 for s in ALL_SECTIONS}},
                'night': {'total': 0, 'by_section': {s: 0 for s in ALL_SECTIONS}},
                'to_stockpile': {'total': 0, 'by_section': {s: 0 for s in ALL_SECTIONS}},
                'from_stockpile': {'total': 0, 'by_section': {s: 0 for s in ALL_SECTIONS}},
                'hired': {'total': 0, 'by_section': {s: 0 for s in ALL_SECTIONS}},
            }
        rows_out.append({
            'type': mat_labels.get(mc, mc.lower()),
            'label': md['name'],
            'total': round(md['total'], 1),
            'by_section': _round_section_dict(md['by_section']),
            'sub_rows': [
                {'label': 'день', 'total': round(md['day']['total'], 1),
                 'by_section': _round_section_dict(md['day']['by_section'])},
                {'label': 'ночь', 'total': round(md['night']['total'], 1),
                 'by_section': _round_section_dict(md['night']['by_section'])},
                {'label': 'в накопитель', 'total': round(md['to_stockpile']['total'], 1),
                 'by_section': _round_section_dict(md['to_stockpile']['by_section'])},
                {'label': 'из накопителя', 'total': round(md['from_stockpile']['total'], 1),
                 'by_section': _round_section_dict(md['from_stockpile']['by_section'])},
                {'label': 'наёмники', 'total': round(md['hired']['total'], 1),
                 'by_section': _round_section_dict(md['hired']['by_section'])},
            ],
        })

    return {'rows': rows_out}


@app.get("/api/dashboard/analytics/equipment")
def analytics_equipment(
    period: str = 'day',
    section: str = 'all',
    date: str | None = None,
):
    """Equipment stats by type and section."""
    d_from, d_to, sec, _ = _parse_analytics_params(period, section, 'all', date)

    where_parts = ["dr.report_date >= %s", "dr.report_date <= %s"]
    params: list = [d_from, d_to]
    if sec:
        where_parts.append("cs.code = %s")
        params.append(sec)

    equip_rows = query(f"""
        SELECT reu.equipment_type,
               reu.ownership_type,
               reu.status,
               dr.shift,
               cs.code AS sec_code,
               COUNT(*) AS cnt
        FROM report_equipment_units reu
        JOIN daily_reports dr ON dr.id = reu.daily_report_id
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE {' AND '.join(where_parts)}
        GROUP BY reu.equipment_type, reu.ownership_type, reu.status, dr.shift, cs.code
    """, params)

    # Aggregate by equipment type -> section -> shift -> status
    type_data: dict[str, dict] = {}
    for row in equip_rows:
        et = row['equipment_type'] or 'unknown'
        sec_code = row['sec_code'] or 'UCH_1'
        shift = row['shift'] or 'unknown'
        status = row['status'] or 'unknown'
        ownership = row['ownership_type'] or 'unknown'
        cnt = int(row['cnt'])

        if et not in type_data:
            type_data[et] = {}
        if sec_code not in type_data[et]:
            type_data[et][sec_code] = {
                'plan_day': 0, 'fact_day': 0,
                'plan_night': 0, 'fact_night': 0,
                'hired': 0, 'total': 0,
            }
        sd = type_data[et][sec_code]
        sd['total'] += cnt
        if shift == 'day' and status == 'working':
            sd['fact_day'] += cnt
        elif shift == 'night' and status == 'working':
            sd['fact_night'] += cnt
        if ownership == 'hired':
            sd['hired'] += cnt

    # Equipment type labels
    eq_labels = {
        'dump_truck': 'Самосвалы',
        'excavator': 'Экскаваторы',
        'bulldozer': 'Бульдозеры',
        'loader': 'Погрузчики',
        'grader': 'Грейдеры',
        'roller': 'Катки',
        'crane': 'Краны',
        'pile_driver': 'Копры',
    }

    # Quarry info per equipment type (from material_movements with distance info)
    quarry_rows = query(f"""
        SELECT DISTINCT o.name AS quarry_name,
               ot.code AS type_code,
               mm.equipment_type
        FROM material_movements mm
        JOIN objects o ON o.id = mm.from_object_id
        JOIN object_types ot ON ot.id = o.object_type_id
        WHERE ot.code = 'BORROW_PIT'
          AND mm.report_date >= %s AND mm.report_date <= %s
    """, [d_from, d_to])

    quarry_map: dict[str, list[dict]] = {}
    for qr in quarry_rows:
        et = qr['equipment_type'] or 'dump_truck'
        if et not in quarry_map:
            quarry_map[et] = []
        quarry_map[et].append({'name': qr['quarry_name'], 'distance_km': 0, 'trips_per_unit': 0})

    types_out = []
    for et in sorted(type_data.keys()):
        sections_list = []
        total_fact = 0
        total_capacity = 0
        for sc in ALL_SECTIONS:
            sd = type_data[et].get(sc, {
                'plan_day': 0, 'fact_day': 0,
                'plan_night': 0, 'fact_night': 0,
                'hired': 0, 'total': 0,
            })
            fact = sd['fact_day'] + sd['fact_night']
            cap = max(sd['total'], fact) if sd['total'] else fact
            total_fact += fact
            total_capacity += cap
            sections_list.append({
                'section': sc,
                'plan_day': sd['plan_day'],
                'fact_day': sd['fact_day'],
                'plan_night': sd['plan_night'],
                'fact_night': sd['fact_night'],
                'ki': round(fact / cap, 2) if cap > 0 else 0,
                'hired': sd['hired'],
            })
        ki_total = round(total_fact / total_capacity, 2) if total_capacity > 0 else 0
        types_out.append({
            'type': et,
            'label': eq_labels.get(et, et),
            'ki_total': ki_total,
            'by_section': sections_list,
            'quarries': quarry_map.get(et, []),
        })

    return {'types': types_out}


@app.get("/api/dashboard/analytics/piles")
def analytics_piles(
    period: str = 'day',
    section: str = 'all',
    date: str | None = None,
):
    """Pile work stats."""
    d_from, d_to, sec, _ = _parse_analytics_params(period, section, 'all', date)

    # Piles driven from daily_work_items where constructive = PILE_FIELD
    where_parts = [
        "dwi.report_date >= %s",
        "dwi.report_date <= %s",
        "c.code = 'PILE_FIELD'",
    ]
    params: list = [d_from, d_to]
    if sec:
        where_parts.append("cs.code = %s")
        params.append(sec)

    pile_work_rows = query(f"""
        SELECT wt.code AS wt_code,
               wt.name AS wt_name,
               cs.code AS sec_code,
               dwi.work_name_raw,
               COALESCE(SUM(dwi.volume), 0) AS vol
        FROM daily_work_items dwi
        JOIN constructives c ON c.id = dwi.constructive_id
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {' AND '.join(where_parts)}
        GROUP BY wt.code, wt.name, cs.code, dwi.work_name_raw
    """, params)

    total_driven = 0
    by_section: dict[str, float] = {s: 0 for s in ALL_SECTIONS}
    by_length: dict[str, float] = {'9': 0, '12': 0, '16': 0, '21': 0, '24': 0}
    test_piles = 0
    welding = 0
    platforms = 0
    dynamic_tests = 0

    for row in pile_work_rows:
        vol = float(row['vol'])
        sc = row['sec_code'] or 'UCH_1'
        wt = row['wt_code'] or ''
        raw_name = (row['work_name_raw'] or '').lower()

        # Categorize pile work by raw name heuristics
        if 'сварк' in raw_name or 'weld' in raw_name.lower():
            welding += vol
        elif 'площадк' in raw_name or 'platform' in raw_name.lower():
            platforms += vol
        elif 'динамич' in raw_name or 'испытан' in raw_name:
            dynamic_tests += vol
        elif 'тестов' in raw_name or 'пробн' in raw_name:
            test_piles += vol
        else:
            # Count as piles driven
            total_driven += vol
            if sc in by_section:
                by_section[sc] += vol

            # Try to extract pile length from raw name (e.g. "16м", "Сваи 12м")
            length_match = re.search(r'(\d+)\s*м', raw_name)
            if length_match:
                length_key = length_match.group(1)
                if length_key in by_length:
                    by_length[length_key] += vol

    # Supplement test piles and dynamic tests from pile_fields table
    pf_rows = query("SELECT field_type, pile_count, dynamic_test_count FROM pile_fields")
    for pf in pf_rows:
        if pf['field_type'] == 'test':
            test_piles += (pf['pile_count'] or 0)
        dynamic_tests += (pf['dynamic_test_count'] or 0)

    return {
        'total_driven': round(total_driven),
        'by_length': {k: round(v) for k, v in by_length.items()},
        'by_section': {k: round(v) for k, v in by_section.items()},
        'test_piles': round(test_piles),
        'welding': round(welding),
        'platforms': round(platforms),
        'dynamic_tests': round(dynamic_tests),
    }


@app.get("/api/dashboard/analytics/plan-fact")
def analytics_plan_fact(
    period: str = 'week',
    section: str = 'all',
):
    """Daily time series for plan vs fact chart."""
    d_from, d_to, sec, _ = _parse_analytics_params(period, section, 'all', None)

    where_parts = ["dwi.report_date >= %s", "dwi.report_date <= %s"]
    params: list = [d_from, d_to]
    if sec:
        where_parts.append("cs.code = %s")
        params.append(sec)

    fact_rows = query(f"""
        SELECT dwi.report_date,
               wt.code AS wt_code,
               COALESCE(SUM(dwi.volume), 0) AS vol
        FROM daily_work_items dwi
        JOIN work_types wt ON wt.id = dwi.work_type_id
        LEFT JOIN construction_sections cs ON cs.id = dwi.section_id
        WHERE {' AND '.join(where_parts)}
        GROUP BY dwi.report_date, wt.code
        ORDER BY dwi.report_date
    """, params)

    # Transport from material_movements
    where_mm = ["mm.report_date >= %s", "mm.report_date <= %s"]
    params_mm: list = [d_from, d_to]
    if sec:
        where_mm.append("cs.code = %s")
        params_mm.append(sec)

    mm_rows = query(f"""
        SELECT mm.report_date,
               COALESCE(SUM(mm.volume), 0) AS vol
        FROM material_movements mm
        LEFT JOIN construction_sections cs ON cs.id = mm.section_id
        WHERE {' AND '.join(where_mm)}
        GROUP BY mm.report_date
        ORDER BY mm.report_date
    """, params_mm)

    mm_by_date = {str(r['report_date']): float(r['vol']) for r in mm_rows}

    # Plan totals (not daily — divide evenly across period)
    plan_where = ["1=1"]
    plan_params: list = []
    if sec:
        plan_where.append("""
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
        WHERE {' AND '.join(plan_where)}
        GROUP BY wt.code
    """, plan_params)

    plan_by_cat: dict[str, float] = {}
    for row in plan_rows:
        cat = _WORK_TYPE_CATEGORY.get(row['wt_code'])
        if cat:
            plan_by_cat[cat] = plan_by_cat.get(cat, 0) + float(row['vol'])
    plan_by_cat['transport'] = plan_by_cat.get('sand', 0)

    # Total days in the project for daily plan rate (approximate)
    total_project_days = max((d_to - date(2024, 1, 1)).days, 1)
    num_days = max((d_to - d_from).days + 1, 1)

    # Build daily fact map
    daily: dict[str, dict[str, dict]] = {}
    current = d_from
    while current <= d_to:
        ds = str(current)
        daily[ds] = {}
        for cat in ('sand', 'excavation', 'transport', 'prs', 'soil', 'shps', 'gravel'):
            daily_plan = round(plan_by_cat.get(cat, 0) / total_project_days, 1)
            daily[ds][cat] = {'plan': daily_plan, 'fact': 0}
        current += timedelta(days=1)

    for row in fact_rows:
        ds = str(row['report_date'])
        if ds not in daily:
            continue
        cat = _WORK_TYPE_CATEGORY.get(row['wt_code'])
        if cat and cat in daily[ds]:
            daily[ds][cat]['fact'] += round(float(row['vol']), 1)

    # Add transport facts
    for ds, vol in mm_by_date.items():
        if ds in daily:
            daily[ds]['transport']['fact'] += round(vol, 1)

    days_out = []
    for ds in sorted(daily.keys()):
        entry = {'date': ds}
        entry.update(daily[ds])
        days_out.append(entry)

    return {'days': days_out}


@app.get("/api/dashboard/analytics/quarries")
def analytics_quarries():
    """List of quarries (borrow pits) with today's stats."""
    yesterday = date.today() - timedelta(days=1)

    quarries = query("""
        SELECT o.id, o.object_code, o.name,
               ot.code AS type_code
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id
        WHERE ot.code = 'BORROW_PIT' AND o.is_active = true
        ORDER BY o.name
    """)

    result = []
    for q in quarries:
        # Determine primary material for this quarry
        mat_row = query_one("""
            SELECT m.name AS mat_name, m.code AS mat_code,
                   COUNT(*) AS cnt
            FROM material_movements mm
            JOIN materials m ON m.id = mm.material_id
            WHERE mm.from_object_id = %s
            GROUP BY m.name, m.code
            ORDER BY cnt DESC
            LIMIT 1
        """, (q['id'],))

        # Sections this quarry serves
        sec_rows = query("""
            SELECT DISTINCT cs.code
            FROM material_movements mm
            JOIN construction_sections cs ON cs.id = mm.section_id
            WHERE mm.from_object_id = %s
            ORDER BY cs.code
        """, (q['id'],))

        # Today's volume
        vol_row = query_one("""
            SELECT COALESCE(SUM(mm.volume), 0) AS vol
            FROM material_movements mm
            WHERE mm.from_object_id = %s AND mm.report_date = %s
        """, (q['id'], yesterday))

        # Today's trucks
        trucks_row = query_one("""
            SELECT
                COUNT(DISTINCT CASE WHEN reu.status = 'working' THEN reu.id END) AS fact,
                COUNT(DISTINCT reu.id) AS total
            FROM material_movements mm
            JOIN daily_reports dr ON dr.id = mm.daily_report_id
            JOIN report_equipment_units reu ON reu.daily_report_id = dr.id
                AND reu.equipment_type = 'dump_truck'
            WHERE mm.from_object_id = %s AND mm.report_date = %s
        """, (q['id'], yesterday))

        result.append({
            'name': q['name'],
            'material': mat_row['mat_name'] if mat_row else 'Песок',
            'distance_km': 0,  # No distance data in DB yet
            'sections': [r['code'] for r in sec_rows],
            'today_volume': round(float(vol_row['vol']), 1) if vol_row else 0,
            'trucks_plan': 0,  # No plan data in DB yet
            'trucks_fact': int(trucks_row['fact']) if trucks_row else 0,
        })

    return {'quarries': result}


@app.get("/api/dashboard/analytics/storages")
def analytics_storages(date_str: str | None = None):
    """Stockpile balances: current volume = SUM(in) - SUM(out) up to date."""
    target = date_str or str(date.today() - timedelta(days=1))
    rows = query("""
        SELECT o.object_code, o.name,
               COALESCE(SUM(CASE WHEN mm.to_object_id = o.id THEN mm.volume ELSE 0 END), 0) as total_in,
               COALESCE(SUM(CASE WHEN mm.from_object_id = o.id THEN mm.volume ELSE 0 END), 0) as total_out
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id AND ot.code = 'STOCKPILE'
        LEFT JOIN material_movements mm ON (mm.to_object_id = o.id OR mm.from_object_id = o.id)
            AND mm.report_date <= %s
        GROUP BY o.id, o.object_code, o.name
        ORDER BY o.name
    """, (target,))
    today_rows = query("""
        SELECT o.object_code,
               COALESCE(SUM(CASE WHEN mm.to_object_id = o.id THEN mm.volume ELSE 0 END), 0) as today_in,
               COALESCE(SUM(CASE WHEN mm.from_object_id = o.id THEN mm.volume ELSE 0 END), 0) as today_out
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id AND ot.code = 'STOCKPILE'
        LEFT JOIN material_movements mm ON (mm.to_object_id = o.id OR mm.from_object_id = o.id)
            AND mm.report_date = %s
        GROUP BY o.id, o.object_code
    """, (target,))
    today_map = {r['object_code']: r for r in today_rows}
    storages = []
    for r in rows:
        code = r['object_code']
        t = today_map.get(code, {})
        current = float(r['total_in']) - float(r['total_out'])
        storages.append({
            'code': code, 'name': r['name'],
            'current_volume': max(0, current),
            'today_in': float(t.get('today_in', 0)),
            'today_out': float(t.get('today_out', 0)),
            'today_balance': float(t.get('today_in', 0)) - float(t.get('today_out', 0)),
        })
    return {'storages': storages}



# ── TEMP ROADS analytics ────────────────────────────────────────────

# --- helper functions (from generate_temp_roads_daily_pdf_weasy.py) ---

def _tr_merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    clean = sorted(
        (min(float(a), float(b)), max(float(a), float(b)))
        for a, b in ranges if a is not None and b is not None
    )
    if not clean:
        return []
    merged = [clean[0]]
    for start, end in clean[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _tr_subtract_ranges(
    base: list[tuple[float, float]], exclude: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    if not base or not exclude:
        return list(base)
    merged_exclude = _tr_merge_ranges(exclude)
    result = []
    for b_start, b_end in base:
        cursor = b_start
        for ex_start, ex_end in merged_exclude:
            if ex_end <= cursor:
                continue
            if ex_start >= b_end:
                break
            if ex_start > cursor:
                result.append((cursor, ex_start))
            cursor = max(cursor, ex_end)
        if cursor < b_end:
            result.append((cursor, b_end))
    return _tr_merge_ranges(result)


def _tr_make_exclusive(
    merged_per_status: dict[str, list[tuple[float, float]]]
) -> dict[str, list[tuple[float, float]]]:
    priority = ["shpgs_done", "ready_for_shpgs", "subgrade_not_to_grade", "pioneer_fill"]
    result = {}
    claimed: list[tuple[float, float]] = []
    for status in priority:
        raw = merged_per_status.get(status, [])
        effective = _tr_subtract_ranges(raw, claimed)
        result[status] = effective
        claimed.extend(effective)
        claimed = _tr_merge_ranges(claimed)
    return result


def _tr_clip_ranges(
    ranges: list[tuple[float, float]], clip_start: float | None, clip_end: float | None
) -> list[tuple[float, float]]:
    result = []
    for s, e in ranges:
        cs = s if clip_start is None else max(s, clip_start)
        ce = e if clip_end is None else min(e, clip_end)
        if ce > cs:
            result.append((cs, ce))
    return result


def _tr_invert_ranges(
    total_start: float | None, total_end: float | None,
    busy: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    if total_start is None or total_end is None:
        return []
    start = min(float(total_start), float(total_end))
    end = max(float(total_start), float(total_end))
    merged_busy = _tr_merge_ranges(busy)
    result = []
    cursor = start
    for busy_start, busy_end in merged_busy:
        if busy_start > cursor:
            result.append((cursor, busy_start))
        cursor = max(cursor, busy_end)
    if cursor < end:
        result.append((cursor, end))
    return [(a, b) for a, b in result if (b - a) > 0.5]


_TR_ORDERED_STATUSES = [
    "pioneer_fill", "subgrade_not_to_grade", "ready_for_shpgs", "shpgs_done"
]
_TR_TARGET_DATE = date(2026, 5, 15)


@app.get("/api/dashboard/analytics/temp-roads")
def analytics_temp_roads(date: str = Query(None, alias="date")):
    """Temp roads status analytics: merged exclusive ranges per road."""
    from collections import defaultdict as _dd

    report_date = date_cls.fromisoformat(date) if date else date_cls.today() - timedelta(days=1)

    # 1. Load roads + mapping
    roads_raw = query("""
        SELECT tr.road_code, tr.ad_start_pk, tr.ad_end_pk,
               tr.rail_start_pk, tr.rail_end_pk,
               m.ad_pk_start, m.ad_pk_end, m.rail_pk_start, m.rail_pk_end
        FROM temporary_roads tr
        LEFT JOIN temporary_road_pk_mappings m
          ON m.road_id = tr.id AND m.mapping_type = 'full_axis_range'
        ORDER BY tr.road_code
    """)

    # Build road dict
    roads: dict[str, dict] = {}
    for r in roads_raw:
        code = r['road_code']
        ad_s = float(r['ad_start_pk']) if r['ad_start_pk'] is not None else None
        ad_e = float(r['ad_end_pk']) if r['ad_end_pk'] is not None else None
        rail_s = float(r['rail_start_pk']) if r['rail_start_pk'] is not None else None
        rail_e = float(r['rail_end_pk']) if r['rail_end_pk'] is not None else None
        mapping = None
        if None not in (r['ad_pk_start'], r['ad_pk_end'], r['rail_pk_start'], r['rail_pk_end']):
            mapping = {
                'ad_start': float(r['ad_pk_start']), 'ad_end': float(r['ad_pk_end']),
                'rail_start': float(r['rail_pk_start']), 'rail_end': float(r['rail_pk_end']),
            }
        total_len = abs((ad_e or 0.0) - (ad_s or 0.0))
        sort_key = rail_s if rail_s is not None else 999999999.0
        roads[code] = {
            'ad_start': ad_s, 'ad_end': ad_e,
            'rail_start': rail_s, 'rail_end': rail_e,
            'total_len': total_len, 'mapping': mapping,
            'sort_key': sort_key,
        }

    # 2. Load all status segments <= report_date
    statuses_raw = query("""
        SELECT tr.road_code, s.status_date, s.status_type,
               s.road_pk_start, s.road_pk_end,
               s.rail_pk_start, s.rail_pk_end
        FROM temporary_road_status_segments s
        JOIN temporary_roads tr ON tr.id = s.road_id
        WHERE s.status_date <= %s
        ORDER BY tr.road_code, s.status_date, s.status_type
    """, (report_date,))

    def _translate_rail_to_ad(start, end, mapping):
        if start is None or end is None or mapping is None:
            return None, None
        rail_span = mapping['rail_end'] - mapping['rail_start']
        ad_span = mapping['ad_end'] - mapping['ad_start']
        if abs(rail_span) < 0.0001:
            return None, None
        s_ratio = (float(start) - mapping['rail_start']) / rail_span
        e_ratio = (float(end) - mapping['rail_start']) / rail_span
        a_s = mapping['ad_start'] + s_ratio * ad_span
        a_e = mapping['ad_start'] + e_ratio * ad_span
        return min(a_s, a_e), max(a_s, a_e)

    # 3. Collect raw AD ranges per road per status
    raw_ad_ranges: dict[str, dict[str, list]] = _dd(lambda: _dd(list))
    for row in statuses_raw:
        code = row['road_code']
        if code not in roads:
            continue
        road = roads[code]
        ad_s = float(row['road_pk_start']) if row['road_pk_start'] is not None else None
        ad_e = float(row['road_pk_end']) if row['road_pk_end'] is not None else None
        rail_s = float(row['rail_pk_start']) if row['rail_pk_start'] is not None else None
        rail_e = float(row['rail_pk_end']) if row['rail_pk_end'] is not None else None
        if ad_s is None or ad_e is None:
            ad_s, ad_e = _translate_rail_to_ad(rail_s, rail_e, road['mapping'])
        if ad_s is None or ad_e is None:
            continue
        raw_ad_ranges[code][row['status_type']].append((ad_s, ad_e))

    # 4. Merge, clip, make exclusive per road
    days_left = max((_TR_TARGET_DATE - report_date).days, 1)
    result_roads = []
    for code, road in sorted(roads.items(), key=lambda kv: (kv[1]['sort_key'], kv[0])):
        ad_s, ad_e = road['ad_start'], road['ad_end']
        if ad_s is None or ad_e is None:
            continue
        a_lo, a_hi = min(ad_s, ad_e), max(ad_s, ad_e)
        total_len = road['total_len']

        # Merge + clip per status
        raw_merged_ad = {}
        for st in _TR_ORDERED_STATUSES:
            ma = _tr_merge_ranges(raw_ad_ranges[code][st])
            ma = _tr_clip_ranges(ma, a_lo, a_hi)
            raw_merged_ad[st] = ma

        # Make exclusive
        excl_ad = _tr_make_exclusive(raw_merged_ad)

        # Compute lengths and ranges per status
        per_status = {}
        all_busy = []
        for st in _TR_ORDERED_STATUSES:
            ranges = excl_ad[st]
            length = sum(abs(b - a) for a, b in ranges)
            per_status[st] = {
                'length_m': round(length, 1),
                'ranges': [[round(a, 1), round(b, 1)] for a, b in ranges],
            }
            all_busy.extend(ranges)

        # no_work
        no_work_ranges = _tr_invert_ranges(ad_s, ad_e, all_busy)
        no_work_len = sum(abs(b - a) for a, b in no_work_ranges)
        per_status['no_work'] = {
            'length_m': round(no_work_len, 1),
            'ranges': [[round(a, 1), round(b, 1)] for a, b in no_work_ranges],
        }

        # l_ready = ready_for_shpgs + shpgs_done
        l_ready = per_status['ready_for_shpgs']['length_m'] + per_status['shpgs_done']['length_m']
        pct_ready = round(l_ready / total_len * 100, 1) if total_len > 0 else 0
        pace = round(no_work_len / days_left, 1) if no_work_len > 1.5 else 0

        # Flat lengths dict for frontend convenience
        lengths = {st: per_status[st]['length_m'] for st in _TR_ORDERED_STATUSES}
        lengths['no_work'] = per_status['no_work']['length_m']

        result_roads.append({
            'road_code': code,
            'code': code,
            'length_km': round(total_len / 1000, 3),
            'rail_start': road['rail_start'],
            'rail_end': road['rail_end'],
            'per_status': per_status,
            'l_ready': round(l_ready, 1),
            'pct_ready': pct_ready,
            'pace': pace,
            # flat format for frontend bars
            'totalLen': round(total_len, 1),
            'lengths': lengths,
        })

    return {'roads': result_roads, 'date': str(report_date)}


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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090)
