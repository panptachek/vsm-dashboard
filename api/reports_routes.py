"""
Reports endpoints for the «Отчёты» tab.

Подключение в api/main.py:
    from reports_routes import router as reports_router
    app.include_router(reports_router)

Все эндпоинты под префиксом /api/wip/reports/*.
"""
from __future__ import annotations

import time
import uuid
from datetime import date as date_cls
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from main import get_conn, query  # noqa: E402

router = APIRouter(prefix="/api/wip/reports", tags=["wip-reports"])


# ── Alias cache (TTL 60s) ───────────────────────────────────────────────
#
# Кэш алиасов: {kind: {alias_text_lower: canonical_code}}.
# Загружается из таблицы work_type_aliases (см. wip_routes.py).
_ALIAS_CACHE: dict[str, Any] = {"ts": 0.0, "by_kind": {}}
_ALIAS_TTL_SEC = 60.0


def load_aliases(force: bool = False) -> dict[str, dict[str, str]]:
    """Возвращает dict[kind -> dict[alias_text_lower -> canonical_code]].

    Кэширует результат на _ALIAS_TTL_SEC секунд. При ошибке БД возвращает
    последний известный кэш (или пустой словарь на первом запуске).
    """
    now = time.time()
    if not force and (now - float(_ALIAS_CACHE["ts"])) < _ALIAS_TTL_SEC and _ALIAS_CACHE["by_kind"]:
        return _ALIAS_CACHE["by_kind"]  # type: ignore[return-value]
    try:
        rows = query("SELECT canonical_code, alias_text, kind FROM work_type_aliases")
    except Exception:
        return _ALIAS_CACHE["by_kind"]  # type: ignore[return-value]
    by_kind: dict[str, dict[str, str]] = {}
    for r in rows:
        kind = (r.get("kind") or "").strip()
        alias = (r.get("alias_text") or "").strip().lower()
        canonical = (r.get("canonical_code") or "").strip()
        if not kind or not alias or not canonical:
            continue
        by_kind.setdefault(kind, {})[alias] = canonical
    _ALIAS_CACHE["by_kind"] = by_kind
    _ALIAS_CACHE["ts"] = now
    return by_kind


def _resolve(by_kind: dict[str, dict[str, str]], kind: str, text: Optional[str]) -> Optional[str]:
    """Ищет canonical_code для text в алиасах данного kind. None если нет."""
    if not text:
        return None
    key = str(text).strip().lower()
    if not key:
        return None
    return by_kind.get(kind, {}).get(key)


# ── GET /api/wip/reports ────────────────────────────────────────────────

@router.get("")
def list_reports(limit: int = 100):
    """
    Список суточных отчётов с привязкой участка и счётчиками зависимых сущностей.
    """
    limit = max(1, min(500, limit))
    return query(
        """
        SELECT
          dr.id::text        AS id,
          dr.report_date,
          dr.shift,
          dr.source_type,
          dr.status,
          dr.parse_status,
          dr.operator_status,
          dr.created_at,
          cs.code            AS section_code,
          cs.name            AS section_name,
          (SELECT COUNT(*) FROM daily_work_items  dwi WHERE dwi.daily_report_id = dr.id) AS work_items_count,
          (SELECT COUNT(*) FROM material_movements mm  WHERE mm.daily_report_id  = dr.id) AS movements_count,
          (SELECT COUNT(*) FROM report_equipment_units reu WHERE reu.daily_report_id = dr.id) AS equipment_count
        FROM daily_reports dr
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        ORDER BY dr.report_date DESC, dr.created_at DESC
        LIMIT %s
        """,
        [limit],
    )


# ── POST /api/wip/reports/preview ───────────────────────────────────────

import re

# Регексы для разбора ведомости
_SECTION_RE = re.compile(r"===\s*(.+?)\s*===", re.MULTILINE)
_VOLUME_TRIPS_RE = re.compile(
    r"([\d\s]*[\d,\.]+|Н/Д)\s*(м3|м²|м2|м|км|шт)?\s*/\s*(\d+)\s*рейс"
)
_VOLUME_ONLY_RE = re.compile(r"([\d\s]*[\d,\.]+)\s*(м3|м²|м2|м|км|шт)(?:\s*\(([^)]+)\))?")
_PK_RANGE_RE = re.compile(r"ПК\s*(\d+)\+(\d+(?:[.,]\d+)?)\s*[-–—]\s*ПК\s*(\d+)\+(\d+(?:[.,]\d+)?)")
_VEHICLE_RE = re.compile(r"^(.+?)\s*\(([^)]+)\);\s*(.+)$")
_DRIVER_RE = re.compile(r"^-\s*(.+?)\s*-\s*$")
_MAT_BLOCK_RE = re.compile(r"^/(.+?)/\s*$")
_CONSTR_RE = re.compile(r"^-\s*(АД\s*[\d\.]+(?:\s*№\s*\d+(?:\.\d+)?)?)\s*-\s*$", re.IGNORECASE)
_SHIFT_MAP = {"день": "day", "ночь": "night"}


def _to_float(s: str) -> Optional[float]:
    if not s or s.strip().upper() in ("Н/Д", "НД", "-", "—"):
        return None
    try:
        return float(s.replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def _parse_section(section_body: str, section_name: str) -> Any:
    """Парсит тело одной секции отчёта."""
    sn = section_name.upper()

    if sn == 'ШАПКА':
        result = {}
        for line in section_body.splitlines():
            if '-' in line:
                k, _, v = line.partition('-')
                result[k.strip().lower()] = v.strip()
        return result

    if sn == 'ПЕРЕВОЗКА':
        drivers = []
        current = None
        current_trip = None
        for line in section_body.splitlines():
            line = line.rstrip()
            if not line.strip():
                continue
            m = _DRIVER_RE.match(line)
            if m:
                if current:
                    drivers.append(current)
                current = {
                    'driver': m.group(1).strip(),
                    'vehicle': None, 'plate': None, 'owner': None,
                    'comments': [], 'trips': [],
                }
                current_trip = None
                continue
            if current is None:
                continue
            if line.startswith('%%%'):
                current['comments'].append(line[3:].strip())
                continue
            vm = _VEHICLE_RE.match(line)
            if vm and current['vehicle'] is None:
                current['vehicle'] = vm.group(1).strip()
                current['plate'] = vm.group(2).strip()
                current['owner'] = vm.group(3).strip()
                continue
            mat_m = _MAT_BLOCK_RE.match(line)
            if mat_m:
                if current_trip:
                    current['trips'].append(current_trip)
                current_trip = {'material': mat_m.group(1).strip(), 'from': None, 'to': None,
                                'volume': None, 'trips': None}
                continue
            if '→' in line and current_trip:
                a, _, b = line.partition('→')
                current_trip['from'] = a.strip()
                current_trip['to'] = b.strip()
                continue
            vt_m = _VOLUME_TRIPS_RE.search(line)
            if vt_m and current_trip:
                current_trip['volume'] = _to_float(vt_m.group(1))
                current_trip['trips'] = int(vt_m.group(3))
                current['trips'].append(current_trip)
                current_trip = None
        if current:
            if current_trip:
                current['trips'].append(current_trip)
            drivers.append(current)
        return drivers

    if sn in ('ОСНОВНЫЕ РАБОТЫ', 'СОПУТСТВУЮЩИЕ РАБОТЫ'):
        works = []
        current_constr = None if sn == 'СОПУТСТВУЮЩИЕ РАБОТЫ' else None
        current = None
        lines = section_body.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].rstrip()
            if not line.strip():
                i += 1
                continue
            cm = _CONSTR_RE.match(line)
            if cm:
                current_constr = cm.group(1).strip()
                i += 1
                continue
            mat_m = _MAT_BLOCK_RE.match(line)
            if mat_m:
                if current:
                    works.append(current)
                current = {
                    'constructive': current_constr, 'work_name': mat_m.group(1).strip(),
                    'pk_rail_start': None, 'pk_rail_end': None,
                    'pk_ad_start': None, 'pk_ad_end': None,
                    'operator': None, 'vehicle': None, 'plate': None, 'owner': None,
                    'volume': None, 'unit': None, 'volume_note': None,
                }
                i += 1
                continue
            if current is None:
                i += 1
                continue
            if line.startswith('ПК ВСЖМ:'):
                body = line[len('ПК ВСЖМ:'):].strip()
                pm = _PK_RANGE_RE.search(body)
                if pm:
                    current['pk_rail_start'] = int(pm.group(1)) * 100 + float(pm.group(2).replace(',', '.'))
                    current['pk_rail_end']   = int(pm.group(3)) * 100 + float(pm.group(4).replace(',', '.'))
                i += 1; continue
            if line.startswith('ПК АД:'):
                body = line[len('ПК АД:'):].strip()
                pm = _PK_RANGE_RE.search(body)
                if pm:
                    current['pk_ad_start'] = int(pm.group(1)) * 100 + float(pm.group(2).replace(',', '.'))
                    current['pk_ad_end']   = int(pm.group(3)) * 100 + float(pm.group(4).replace(',', '.'))
                i += 1; continue
            vm = _VEHICLE_RE.match(line)
            if vm and current['vehicle'] is None:
                # Ожидаем: предыдущая строка была operator
                current['vehicle'] = vm.group(1).strip()
                current['plate'] = vm.group(2).strip()
                current['owner'] = vm.group(3).strip()
                i += 1; continue
            # volume line
            vol_m = _VOLUME_ONLY_RE.search(line)
            if vol_m:
                current['volume'] = _to_float(vol_m.group(1))
                current['unit'] = vol_m.group(2)
                if vol_m.group(3):
                    current['volume_note'] = vol_m.group(3)
                i += 1; continue
            # иначе — operator name (обычно короткая строка с инициалами)
            if current['operator'] is None and not line.startswith('%'):
                current['operator'] = line.strip()
            i += 1
        if current:
            works.append(current)
        return works

    if sn == 'ПАРК ТЕХНИКИ':
        park = []
        for line in section_body.splitlines():
            line = line.rstrip()
            if not line.strip() or line.startswith('%'):
                continue
            vm = _VEHICLE_RE.match(line)
            if not vm:
                continue
            left = vm.group(1).strip()
            plate = vm.group(2).strip()
            tail = vm.group(3).strip()
            tail_parts = [p.strip() for p in tail.split(';')]
            owner = tail_parts[0] if tail_parts else None
            status = tail_parts[1].lower() if len(tail_parts) > 1 else 'working'
            comment = '; '.join(tail_parts[2:]) if len(tail_parts) > 2 else None
            # Попытка выделить тип техники из начала строки
            tokens = left.split(None, 1)
            et = tokens[0]
            model_and_num = tokens[1] if len(tokens) > 1 else ''
            park.append({
                'equipment_type': et,
                'brand_model': model_and_num,
                'plate_number': plate,
                'owner': owner,
                'status': 'working' if status in ('в работе', 'working', 'в_работе') else 'idle',
                'status_reason': comment if status not in ('в работе', 'working') else None,
            })
        return park

    if sn == 'ПРОБЛЕМНЫЕ ВОПРОСЫ':
        return section_body.strip()

    if sn == 'ПЕРСОНАЛ':
        out = []
        for line in section_body.splitlines():
            if line.startswith('%'):
                continue
            m = re.match(r"([А-ЯA-Z][А-Яа-яA-Za-z]*)\s*:\s*(\d+)", line.strip())
            if m:
                out.append({'category': m.group(1), 'count': int(m.group(2))})
        return out

    return section_body.strip()


def _parse_report_text(filename: str, raw_text: str) -> dict[str, Any]:
    """Парсер суточного отчёта в формате ===СЕКЦИИ===."""
    source = {
        "filename": filename,
        "chars": len(raw_text or ""),
        "lines": len((raw_text or "").splitlines()),
    }
    # Разрезаем по заголовкам === ИМЯ ===
    parts = _SECTION_RE.split(raw_text or "")
    sections: dict[str, str] = {}
    if len(parts) > 1:
        # parts[0] — всё до первой секции; parts[1..] чередуются: name, body, name, body
        for i in range(1, len(parts), 2):
            name = parts[i].strip()
            body = parts[i + 1] if i + 1 < len(parts) else ''
            sections[name.upper()] = body

    header_raw = _parse_section(sections.get('ШАПКА', ''), 'ШАПКА') if 'ШАПКА' in sections else {}
    # Пост-обработка header
    shift_raw = (header_raw.get('смена', '') or '').lower()
    shift = _SHIFT_MAP.get(shift_raw, 'unknown')
    sec_text = (header_raw.get('участок', '') or '').lower()
    sec_m = re.search(r"№\s*(\d+)", sec_text)
    section_code = f"UCH_{sec_m.group(1)}" if sec_m else ""
    date_raw = (header_raw.get('дата', '') or '').strip()
    # Формат 16.04.2026 → 2026-04-16
    d_m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", date_raw)
    report_date = f"{d_m.group(3)}-{d_m.group(2).zfill(2)}-{d_m.group(1).zfill(2)}" if d_m else date_cls.today().isoformat()

    transport = _parse_section(sections.get('ПЕРЕВОЗКА', ''), 'ПЕРЕВОЗКА') if 'ПЕРЕВОЗКА' in sections else []
    main_works = _parse_section(sections.get('ОСНОВНЫЕ РАБОТЫ', ''), 'ОСНОВНЫЕ РАБОТЫ') if 'ОСНОВНЫЕ РАБОТЫ' in sections else []
    aux_works = _parse_section(sections.get('СОПУТСТВУЮЩИЕ РАБОТЫ', ''), 'СОПУТСТВУЮЩИЕ РАБОТЫ') if 'СОПУТСТВУЮЩИЕ РАБОТЫ' in sections else []

    # Enrichment by aliases ─ см. load_aliases().
    aliases = load_aliases()
    total_items = 0
    resolved_items = 0
    unresolved_samples: dict[str, str] = {}  # kind:text (lower) -> original text

    def _check(kind: str, text: Optional[str]) -> Optional[str]:
        nonlocal total_items, resolved_items
        if text is None or str(text).strip() == "":
            return None
        total_items += 1
        code = _resolve(aliases, kind, text)
        if code:
            resolved_items += 1
        else:
            key = f"{kind}:{str(text).strip().lower()}"
            unresolved_samples.setdefault(key, str(text).strip())
        return code

    if isinstance(transport, list):
        for d in transport:
            if not isinstance(d, dict):
                continue
            needs = False
            for t in d.get('trips') or []:
                if not isinstance(t, dict):
                    continue
                t['material_code'] = _check('material', t.get('material'))
                t['from_object_code'] = _check('constructive', t.get('from'))
                t['to_object_code'] = _check('constructive', t.get('to'))
                t_needs = (
                    (t.get('material') and not t['material_code']) or
                    (t.get('from') and not t['from_object_code']) or
                    (t.get('to') and not t['to_object_code'])
                )
                t['needs_alias'] = bool(t_needs)
                if t_needs:
                    needs = True
            d['needs_alias'] = needs

    for coll in (main_works, aux_works):
        if not isinstance(coll, list):
            continue
        for w in coll:
            if not isinstance(w, dict):
                continue
            w['work_type_code'] = _check('work_type', w.get('work_name'))
            w['constructive_code'] = _check('constructive', w.get('constructive'))
            w_needs = (
                (w.get('work_name') and not w['work_type_code']) or
                (w.get('constructive') and not w['constructive_code'])
            )
            w['needs_alias'] = bool(w_needs)

    aliases_summary = {
        "total_items": total_items,
        "resolved": resolved_items,
        "unresolved": total_items - resolved_items,
        "unresolved_samples": list(unresolved_samples.values())[:50],
    }

    return {
        "source": source,
        "aliases": aliases_summary,
        "header": {
            "report_date": report_date,
            "shift": shift,
            "section_code": section_code,
            "section_name": header_raw.get('участок', ''),
            "direction": header_raw.get('направление', ''),
            "constructives": header_raw.get('конструктивы', ''),
            "author": "",
        },
        "transport": transport,
        "main_works": main_works,
        "aux_works": aux_works,
        "park": _parse_section(sections.get('ПАРК ТЕХНИКИ', ''), 'ПАРК ТЕХНИКИ') if 'ПАРК ТЕХНИКИ' in sections else [],
        "problems": _parse_section(sections.get('ПРОБЛЕМНЫЕ ВОПРОСЫ', ''), 'ПРОБЛЕМНЫЕ ВОПРОСЫ') if 'ПРОБЛЕМНЫЕ ВОПРОСЫ' in sections else "",
        "personnel": _parse_section(sections.get('ПЕРСОНАЛ', ''), 'ПЕРСОНАЛ') if 'ПЕРСОНАЛ' in sections else [],
        "raw_text": raw_text,
        "_stub": False,
    }


@router.post("/preview")
async def preview_report(file: UploadFile = File(...)):
    """
    multipart/form-data: file=<.txt | .pdf>
    Возвращает распарсенную структуру (ни одной записи в БД не создаётся).
    """
    name = (file.filename or "").lower()
    if not (name.endswith(".txt") or name.endswith(".pdf")):
        raise HTTPException(400, "Поддерживаются только .txt и .pdf")

    blob = await file.read()
    if not blob:
        raise HTTPException(400, "Пустой файл")

    # TODO: реальный парсер для .pdf. Пока пытаемся декодировать как текст.
    if name.endswith(".pdf"):
        raw_text = f"[PDF binary, {len(blob)} байт — TODO: реальный парсер]"
    else:
        try:
            raw_text = blob.decode("utf-8")
        except UnicodeDecodeError:
            raw_text = blob.decode("cp1251", errors="replace")

    parsed = _parse_report_text(file.filename or "report.txt", raw_text)
    return parsed


# ── GET /api/wip/reports/{id}/preview ───────────────────────────────────

@router.get("/{report_id}/preview")
def preview_stored_report(report_id: str):
    """
    Возвращает распарсенную структуру для уже сохранённого отчёта.
    Если raw_text отсутствует — возвращает {"available": false, ...}.
    """
    try:
        uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(400, "Невалидный id")

    rows = query(
        """
        SELECT
          dr.id::text        AS id,
          dr.report_date,
          dr.shift,
          dr.source_type,
          dr.source_reference,
          dr.raw_text,
          cs.code            AS section_code,
          cs.name            AS section_name
        FROM daily_reports dr
        LEFT JOIN construction_sections cs ON cs.id = dr.section_id
        WHERE dr.id = %s
        LIMIT 1
        """,
        [report_id],
    )
    if not rows:
        raise HTTPException(404, "Отчёт не найден")
    row = rows[0]
    raw_text = row.get("raw_text")

    meta = {
        "id": row["id"],
        "report_date": row["report_date"].isoformat() if row.get("report_date") else None,
        "shift": row.get("shift"),
        "section_code": row.get("section_code"),
        "section_name": row.get("section_name"),
        "source_type": row.get("source_type"),
        "source_reference": row.get("source_reference"),
    }

    if not raw_text:
        return {
            "available": False,
            "reason": "парсинг недоступен — исходный текст не сохранён",
            "meta": meta,
        }

    filename = row.get("source_reference") or "report.txt"
    parsed = _parse_report_text(filename, raw_text)
    return {"available": True, "meta": meta, "parsed": parsed}


# ── POST /api/wip/reports/import ────────────────────────────────────────

class ImportHeader(BaseModel):
    report_date: str
    shift: str  # day | night | unknown
    section_code: Optional[str] = None
    author: Optional[str] = None


class ImportPayload(BaseModel):
    header: ImportHeader
    transport: list[dict[str, Any]] = []
    main_works: list[dict[str, Any]] = []
    aux_works: list[dict[str, Any]] = []
    park: list[dict[str, Any]] = []
    problems: Optional[str] = ""
    personnel: list[dict[str, Any]] = []
    raw_text: Optional[str] = None
    source_type: Optional[str] = "web_upload"
    source_reference: Optional[str] = None


@router.post("/import")
def import_report(payload: ImportPayload):
    """
    Сохраняет подтверждённый оператором отчёт в БД.

    TODO: реальный парсер наполняет transport/main_works/aux_works/park осмысленными
    данными — здесь мы их просто мэппим на таблицы. Пока парсер-заглушка возвращает
    пустые массивы, поэтому создаётся только сама запись daily_reports; остальные
    таблицы получают 0 строк. Когда парсер будет готов — ниже уже есть каркас
    вставки в daily_work_items / material_movements / report_equipment_units.
    """
    try:
        report_date = date_cls.fromisoformat(payload.header.report_date)
    except ValueError:
        raise HTTPException(400, "header.report_date должен быть YYYY-MM-DD")

    shift = payload.header.shift or "unknown"
    if shift not in ("day", "night", "unknown"):
        raise HTTPException(400, "header.shift должен быть day|night|unknown")

    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                # Resolve section_id from code
                section_id: Optional[str] = None
                if payload.header.section_code:
                    cur.execute(
                        "SELECT id FROM construction_sections WHERE code = %s LIMIT 1",
                        (payload.header.section_code,),
                    )
                    row = cur.fetchone()
                    if row:
                        section_id = row[0]

                report_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO daily_reports
                        (id, report_date, shift, section_id, source_type,
                         source_reference, raw_text, parse_status, operator_status, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        report_id,
                        report_date,
                        shift,
                        section_id,
                        payload.source_type or "web_upload",
                        payload.source_reference,
                        payload.raw_text,
                        "parsed",
                        "approved",
                        "confirmed",
                    ),
                )

                # ── Lookup helpers ─────────────────────────────────────
                def _find_work_type_id(code: Optional[str]) -> Optional[str]:
                    if not code:
                        return None
                    cur.execute("SELECT id FROM work_types WHERE code = %s LIMIT 1", (code,))
                    r = cur.fetchone()
                    return r[0] if r else None

                def _find_material_id(code: Optional[str]) -> Optional[str]:
                    if not code:
                        return None
                    cur.execute("SELECT id FROM materials WHERE code = %s LIMIT 1", (code,))
                    r = cur.fetchone()
                    return r[0] if r else None

                def _find_object_id(name_or_code: Optional[str]) -> Optional[str]:
                    if not name_or_code:
                        return None
                    cur.execute("SELECT id FROM objects WHERE name = %s LIMIT 1", (name_or_code,))
                    r = cur.fetchone()
                    if r:
                        return r[0]
                    cur.execute("SELECT id FROM objects WHERE object_code = %s LIMIT 1", (name_or_code,))
                    r = cur.fetchone()
                    return r[0] if r else None

                def _find_constructive_id(code_or_name: Optional[str]) -> Optional[str]:
                    if not code_or_name:
                        return None
                    cur.execute("SELECT id FROM constructives WHERE code = %s LIMIT 1", (code_or_name,))
                    r = cur.fetchone()
                    if r:
                        return r[0]
                    cur.execute("SELECT id FROM constructives WHERE name = %s LIMIT 1", (code_or_name,))
                    r = cur.fetchone()
                    return r[0] if r else None

                # ── Парк техники → report_equipment_units ──
                eq_by_plate: dict[str, str] = {}
                n_equipment = 0
                for p in payload.park:
                    plate = p.get('plate_number') or p.get('plate') or ''
                    if not plate:
                        continue
                    eq_id = str(uuid.uuid4())
                    owner = (p.get('owner') or p.get('contractor_name') or '').strip()
                    raw_status = (p.get('status') or 'working').lower()
                    # Маппим в допустимые БД-значения: working | repair | out | standby | unknown
                    if raw_status in ('working', 'в работе', 'в_работе'):
                        status_db = 'working'
                    elif raw_status in ('idle', 'standby', 'простой', 'резерв'):
                        status_db = 'standby'
                    elif raw_status in ('repair', 'ремонт'):
                        status_db = 'repair'
                    elif raw_status in ('out', 'вне', 'списан'):
                        status_db = 'out'
                    else:
                        status_db = 'unknown'
                    cur.execute(
                        """INSERT INTO report_equipment_units
                           (id, daily_report_id, equipment_type, brand_model, unit_number,
                            plate_number, operator_name, ownership_type, contractor_name,
                            status, comment)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (eq_id, report_id,
                         (p.get('equipment_type') or 'unknown').lower(),
                         p.get('brand_model'), p.get('unit_number'), plate,
                         p.get('operator_name') or p.get('operator'),
                         p.get('ownership_type') or ('own' if owner.lower() == 'ждс' else 'subcontractor'),
                         p.get('contractor_name') or owner,
                         status_db,
                         p.get('status_reason') or p.get('comment')))
                    eq_by_plate[plate] = eq_id
                    n_equipment += 1

                # ── Работы → daily_work_items (+ work_item_equipment_usage) ──
                n_work_items = 0
                n_skipped = 0
                # Default object для сопутствующих работ — любая TEMP_ROAD в этом участке.
                default_obj_id = None
                if section_id:
                    cur.execute(
                        """SELECT o.id FROM objects o
                           JOIN object_types ot ON ot.id = o.object_type_id
                           WHERE ot.code = 'TEMP_ROAD'
                             AND EXISTS (SELECT 1 FROM object_segments os WHERE os.object_id = o.id)
                           LIMIT 1""")
                    r = cur.fetchone()
                    if r:
                        default_obj_id = r[0]
                for w in (payload.main_works or []) + (payload.aux_works or []):
                    wt_id = _find_work_type_id(w.get('work_type_code'))
                    obj_id = _find_object_id(w.get('constructive_code') or w.get('constructive')) or default_obj_id
                    constr_id = _find_constructive_id(w.get('constructive_code') or w.get('constructive'))
                    vol = w.get('volume')
                    unit = (w.get('unit') or 'м3').replace('м²', 'м2')
                    if vol is None or obj_id is None or wt_id is None:
                        n_skipped += 1
                        continue
                    dwi_id = str(uuid.uuid4())
                    cur.execute(
                        """INSERT INTO daily_work_items
                           (id, daily_report_id, report_date, shift, section_id, object_id,
                            constructive_id, work_type_id, work_name_raw, unit, volume,
                            labor_source_type, contractor_name)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (dwi_id, report_id, report_date, shift, section_id,
                         obj_id, constr_id, wt_id, w.get('work_name') or '',
                         unit, vol,
                         'own' if (w.get('owner') or '').lower() == 'ждс' else 'subcontractor',
                         w.get('owner')))
                    n_work_items += 1
                    plate = w.get('plate') or w.get('plate_number')
                    if plate and plate in eq_by_plate:
                        cur.execute(
                            """INSERT INTO work_item_equipment_usage
                               (id, daily_work_item_id, report_equipment_unit_id,
                                worked_volume, worked_area, comment)
                               VALUES (%s, %s, %s, %s, %s, %s)""",
                            (str(uuid.uuid4()), dwi_id, eq_by_plate[plate],
                             vol if unit == 'м3' else None,
                             vol if unit in ('м2', 'м²') else None,
                             'import'))

                # ── Перевозка → material_movements (+ usage) ──
                n_movements = 0
                for d in (payload.transport or []):
                    plate = d.get('plate') or d.get('plate_number')
                    owner = d.get('owner') or 'ЖДС'
                    for trip in (d.get('trips') or []):
                        mat_id = _find_material_id(trip.get('material_code'))
                        from_id = _find_object_id(trip.get('from_object_code') or trip.get('from'))
                        to_id = _find_object_id(trip.get('to_object_code') or trip.get('to'))
                        frm = (trip.get('from') or '').lower()
                        to = (trip.get('to') or '').lower()
                        if 'карьер' in frm and 'накопитель' in to:
                            mtype = 'pit_to_stockpile'
                        elif 'карьер' in frm or 'резерв' in frm:
                            mtype = 'pit_to_constructive'
                        elif 'накопитель' in frm:
                            mtype = 'stockpile_to_constructive'
                        else:
                            mtype = 'pit_to_constructive'
                        vol = trip.get('volume')
                        trips_cnt = trip.get('trips') or 0
                        if vol is None or from_id is None or to_id is None:
                            # Не резолвится — скипаем, чтобы не упасть по NOT NULL
                            continue
                        mm_id = str(uuid.uuid4())
                        cur.execute(
                            """INSERT INTO material_movements
                               (id, daily_report_id, report_date, shift, section_id, material_id,
                                from_object_id, to_object_id, volume, unit, trip_count, movement_type,
                                labor_source_type, contractor_name, equipment_type, equipment_count)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                            (mm_id, report_id, report_date, shift, section_id, mat_id,
                             from_id, to_id, vol, 'м3', trips_cnt, mtype,
                             'own' if owner.lower() == 'ждс' else 'subcontractor',
                             owner, 'самосвал', 1))
                        n_movements += 1
                        if plate and plate in eq_by_plate:
                            cur.execute(
                                """INSERT INTO material_movement_equipment_usage
                                   (id, material_movement_id, report_equipment_unit_id,
                                    trips_count, worked_volume, comment)
                                   VALUES (%s, %s, %s, %s, %s, %s)""",
                                (str(uuid.uuid4()), mm_id, eq_by_plate[plate],
                                 trips_cnt, vol, 'import'))

                # ── Проблемные вопросы ──
                problems_text = (payload.problems or '').strip()
                n_problems = 0
                if problems_text:
                    cur.execute(
                        """INSERT INTO daily_report_problems
                           (id, daily_report_id, problem_text, sort_order)
                           VALUES (%s, %s, %s, %s)""",
                        (str(uuid.uuid4()), report_id, problems_text, 0))
                    n_problems = 1

                inserted = {
                    "daily_report_id": report_id,
                    "work_items": n_work_items,
                    "work_items_skipped_no_object": n_skipped,
                    "movements": n_movements,
                    "equipment_units": n_equipment,
                    "problems": n_problems,
                    "personnel": len(payload.personnel or []),
                }

                return {"ok": True, **inserted}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Ошибка импорта: {e}")
    finally:
        conn.close()
