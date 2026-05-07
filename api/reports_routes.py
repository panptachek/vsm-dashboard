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
import re
from datetime import date as date_cls
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from main import get_conn, query  # noqa: E402
from report_text_parser import parse_report_text  # noqa: E402
from xlsx_report_adapter import xlsx_bytes_to_report_text  # noqa: E402

router = APIRouter(prefix="/api/wip/reports", tags=["wip-reports"])


# ── Alias cache (TTL 60s) ───────────────────────────────────────────────
#
# Кэш алиасов: {kind: {alias_text_lower: canonical_code}}.
# Загружается из таблицы work_type_aliases (см. wip_routes.py).
_ALIAS_CACHE: dict[str, Any] = {"ts": 0.0, "by_kind": {}}
_ALIAS_TTL_SEC = 60.0
_REF_CACHE: dict[str, Any] = {"ts": 0.0, "by_kind": {}}
_REF_TTL_SEC = 60.0


class ReferenceCreateBody(BaseModel):
    kind: str
    code: Optional[str] = None
    name: str
    alias_text: Optional[str] = None
    default_unit: Optional[str] = None
    work_group: Optional[str] = None
    productivity_enabled: bool = True
    object_type_code: Optional[str] = None
    constructive_code: Optional[str] = None
    pk_start: Optional[Any] = None
    pk_end: Optional[Any] = None
    pk_raw_text: Optional[str] = None
    comment: Optional[str] = None


class ObjectTypeCreateBody(BaseModel):
    code: Optional[str] = None
    name: str
    map_enabled: bool = True
    work_accounting_enabled: bool = True
    material_accounting_enabled: bool = False
    is_linear: bool = False
    accounting_note: Optional[str] = None


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
    if kind == "object":
        return by_kind.get("object", {}).get(key) or by_kind.get("constructive", {}).get(key)
    return by_kind.get(kind, {}).get(key)


def _normalize_ref(value: Any) -> str:
    value = str(value or "").lower().replace("ё", "е")
    value = value.replace("№", " ")
    value = re.sub(r"\bпк\s*(\d+)", r"пк \1", value)
    value = re.sub(r"[^0-9a-zа-я]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _compact_ref(value: Any) -> str:
    return _normalize_ref(value).replace(" ", "")


def _ref_tokens(value: Any) -> set[str]:
    return {token for token in _normalize_ref(value).split() if len(token) > 1}


def _safe_ref_code(value: Any, fallback_prefix: str, *, max_len: int = 100) -> str:
    raw = str(value or "").strip().upper()
    raw = raw.replace("Ё", "Е")
    raw = re.sub(r"[^0-9A-Z_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        raw = f"{fallback_prefix}_{uuid.uuid4().hex[:8]}".upper()
    return raw[:max_len]


def _parse_pk_input(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        raw = float(value)
        return raw * 100 if raw < 10000 else raw
    text = str(value or "").strip().lower().replace("ё", "е")
    if not text:
        return None
    numeric = re.fullmatch(r"\d+(?:[,.]\d+)?", text)
    if numeric:
        raw = float(text.replace(",", "."))
        return raw * 100 if raw < 10000 else raw
    match = re.search(r"(?:пк\s*)?(\d{3,5})(?:\s*\+\s*(\d+(?:[,.]\d+)?))?", text, re.I)
    if not match:
        return None
    plus = float((match.group(2) or "0").replace(",", "."))
    return int(match.group(1)) * 100 + plus


def _reset_reference_caches() -> None:
    _REF_CACHE["ts"] = 0.0
    _REF_CACHE["by_kind"] = {}
    _ALIAS_CACHE["ts"] = 0.0
    _ALIAS_CACHE["by_kind"] = {}


def _ensure_alias_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS work_type_aliases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            canonical_code TEXT NOT NULL,
            alias_text TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _upsert_reference_alias(cur, kind: str, alias_text: Optional[str], canonical_code: str) -> None:
    alias = (alias_text or "").strip()
    if not alias or not canonical_code:
        return
    _ensure_alias_table(cur)
    cur.execute(
        """
        INSERT INTO work_type_aliases (canonical_code, alias_text, kind, notes)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (alias_text) DO UPDATE
        SET canonical_code = EXCLUDED.canonical_code,
            kind = EXCLUDED.kind,
            notes = EXCLUDED.notes
        """,
        (canonical_code, alias, kind, "created from report preview"),
    )


def _section_num_from_code(code: Optional[str]) -> Optional[int]:
    m = re.search(r"UCH_(\d+)", code or "")
    if not m:
        return None
    num = int(m.group(1))
    return 3 if num in (31, 32) else num


def _object_aliases(code: str, name: str, constructive_code: Optional[str]) -> list[str]:
    aliases = [code, name]
    name_norm = _normalize_ref(name)
    pk_matches = re.findall(r"\bпк\s+(\d{3,5})\b", name_norm)
    for pk in pk_matches:
        aliases.extend([f"ПК{pk}", f"ПК {pk}"])
        if "площад" in name_norm:
            aliases.extend([f"площадка {pk}", f"площадка ПК{pk}", f"площадка ПК {pk}"])
    road_match = re.search(r"дорог[а-я]*\s+(\d+(?:\.\d+)*)", name_norm)
    if road_match:
        road_no = road_match.group(1)
        aliases.extend([f"АД {road_no}", f"АД{road_no}", f"ВПД {road_no}", f"дорога {road_no}"])
    section_match = re.search(r"участок\s+(\d+)", name_norm)
    if code.startswith("MAIN_") or constructive_code == "MAIN":
        aliases.extend(["ОХ", "основной ход"])
        if section_match:
            aliases.append(f"основной ход участок {section_match.group(1)}")
    if code.startswith("STUFF_"):
        aliases.extend(["сопутствующее", "прочее", "работа на иссо", "иссо"])
    return aliases


def load_reference_catalog(force: bool = False) -> dict[str, list[dict[str, Any]]]:
    """DB-backed dictionaries used by parser preview suggestions.

    Кэш короткий: оператор видит актуальные справочники, но preview не делает
    несколько одинаковых запросов на каждую строку отчета.
    """
    now = time.time()
    if not force and (now - float(_REF_CACHE["ts"])) < _REF_TTL_SEC and _REF_CACHE["by_kind"]:
        return _REF_CACHE["by_kind"]  # type: ignore[return-value]

    by_kind: dict[str, list[dict[str, Any]]] = {
        "work_type": [],
        "material": [],
        "object": [],
        "constructive": [],
    }
    try:
        for r in query(
            """
            SELECT code, name, default_unit, work_group, COALESCE(productivity_enabled, true) AS productivity_enabled
            FROM work_types
            WHERE is_active = true
            ORDER BY show_in_timeline DESC, work_group NULLS LAST, name
            """
        ):
            code = str(r.get("code") or "").strip()
            name = str(r.get("name") or "").strip()
            if code and name:
                by_kind["work_type"].append({
                    "code": code,
                    "label": name,
                    "table": "work_types",
                    "default_unit": r.get("default_unit"),
                    "work_group": r.get("work_group"),
                    "productivity_enabled": r.get("productivity_enabled", True),
                    "aliases": [code, name],
                })
    except Exception:
        pass

    try:
        for r in query("SELECT code, name, default_unit FROM materials ORDER BY name"):
            code = str(r.get("code") or "").strip()
            name = str(r.get("name") or "").strip()
            if code and name:
                by_kind["material"].append({
                    "code": code,
                    "label": name,
                    "table": "materials",
                    "default_unit": r.get("default_unit"),
                    "aliases": [code, name],
                })
    except Exception:
        pass

    try:
        for r in query(
            """
            SELECT
              o.object_code AS code,
              o.name AS label,
              ot.code AS object_type_code,
              c.code AS constructive_code,
              c.name AS constructive_name
            FROM objects o
            LEFT JOIN object_types ot ON ot.id = o.object_type_id
            LEFT JOIN constructives c ON c.id = o.constructive_id
            WHERE o.is_active = true
            ORDER BY o.name
            """
        ):
            code = str(r.get("code") or "").strip()
            label = str(r.get("label") or "").strip()
            if code and label:
                by_kind["object"].append({
                    "code": code,
                    "label": label,
                    "table": "objects",
                    "object_type_code": r.get("object_type_code"),
                    "constructive_code": r.get("constructive_code"),
                    "constructive_name": r.get("constructive_name"),
                    "aliases": _object_aliases(code, label, r.get("constructive_code")),
                })
    except Exception:
        pass

    try:
        for r in query("SELECT code, name FROM constructives WHERE is_active = true ORDER BY sort_order, name"):
            code = str(r.get("code") or "").strip()
            name = str(r.get("name") or "").strip()
            if code and name:
                by_kind["constructive"].append({
                    "code": code,
                    "label": name,
                    "table": "constructives",
                    "aliases": [code, name],
                })
    except Exception:
        pass

    _REF_CACHE["by_kind"] = by_kind
    _REF_CACHE["ts"] = now
    return by_kind


def _entry_score(text: str, entry: dict[str, Any]) -> float:
    text_norm = _normalize_ref(text)
    text_compact = _compact_ref(text)
    if not text_norm:
        return 0.0
    best = 0.0
    for alias in entry.get("aliases") or [entry.get("label"), entry.get("code")]:
        alias_norm = _normalize_ref(alias)
        alias_compact = _compact_ref(alias)
        if not alias_norm:
            continue
        if text_norm == alias_norm or text_compact == alias_compact:
            best = max(best, 1.0)
            continue
        if len(text_norm) >= 3 and len(alias_norm) >= 3 and (text_norm in alias_norm or alias_norm in text_norm):
            best = max(best, 0.92)
        text_tokens = _ref_tokens(text_norm)
        alias_tokens = _ref_tokens(alias_norm)
        if text_tokens and alias_tokens:
            overlap = len(text_tokens & alias_tokens)
            if overlap:
                best = max(best, 0.35 + 0.55 * (overlap / max(len(text_tokens), len(alias_tokens))))
    return best


def _section_object_bonus(entry: dict[str, Any], section_code: Optional[str]) -> float:
    section_num = _section_num_from_code(section_code)
    if section_num is None:
        return 0.0
    code = str(entry.get("code") or "")
    if code == f"MAIN_{section_num:03d}" or code == f"STUFF_{section_num}":
        return 0.08
    if code == f"STOCK_00{section_num}" or code == f"STOCK_0{section_num}0":
        return 0.04
    if section_num == 3 and code in {"MAIN_031", "MAIN_032"}:
        return 0.08
    return 0.0


def _reference_candidates(
    kind: str,
    text: Optional[str],
    existing_code: Optional[str] = None,
    *,
    section_code: Optional[str] = None,
    limit: int = 6,
) -> list[dict[str, Any]]:
    if not text and not existing_code:
        return []
    catalog = load_reference_catalog().get(kind, [])
    scored: dict[str, dict[str, Any]] = {}
    existing_norm = _normalize_ref(existing_code)
    existing_compact = _compact_ref(existing_code)

    for entry in catalog:
        code = str(entry.get("code") or "")
        label = str(entry.get("label") or "")
        score = _entry_score(str(text or ""), entry)
        source = "fuzzy"
        if existing_norm and (
            existing_norm == _normalize_ref(code)
            or existing_norm == _normalize_ref(label)
            or existing_compact == _compact_ref(code)
        ):
            score = max(score, 1.0)
            source = "selected"
        if kind == "object":
            score = score + _section_object_bonus(entry, section_code)
        if score < 0.35:
            continue
        current = scored.get(code)
        if current and current["score"] >= score:
            continue
        scored[code] = {
            "code": code,
            "label": label,
            "score": round(score, 3),
            "source": source,
            "table": entry.get("table"),
            "default_unit": entry.get("default_unit"),
            "work_group": entry.get("work_group"),
            "productivity_enabled": entry.get("productivity_enabled"),
            "object_type_code": entry.get("object_type_code"),
            "constructive_code": entry.get("constructive_code"),
            "constructive_name": entry.get("constructive_name"),
        }

    return sorted(scored.values(), key=lambda item: (-item["score"], item["label"]))[:limit]


def _select_reference_code(kind: str, existing_code: Optional[str], candidates: list[dict[str, Any]]) -> Optional[str]:
    if not candidates:
        return None
    existing_norm = _normalize_ref(existing_code)
    existing_compact = _compact_ref(existing_code)
    for candidate in candidates:
        if existing_norm and (
            existing_norm == _normalize_ref(candidate.get("code"))
            or existing_norm == _normalize_ref(candidate.get("label"))
            or existing_compact == _compact_ref(candidate.get("code"))
        ):
            return candidate.get("code")
    best = candidates[0]
    if float(best.get("score") or 0) >= 0.92:
        return best.get("code")
    return None


@router.get("/reference-search")
def reference_search(
    kind: str,
    q: str = "",
    section: Optional[str] = None,
    limit: int = 12,
) -> list[dict[str, Any]]:
    """Manual DB dictionary search for parser review dropdowns."""
    normalized_kind = (kind or "").strip()
    if normalized_kind not in {"work_type", "material", "object", "constructive"}:
        raise HTTPException(400, "Unsupported reference kind")
    query_text = (q or "").strip()
    if len(query_text) < 2:
        return []
    safe_limit = max(1, min(int(limit or 12), 30))
    return _reference_candidates(
        normalized_kind,
        query_text,
        section_code=section,
        limit=safe_limit,
    )


@router.get("/reference-meta")
def reference_meta() -> dict[str, Any]:
    """Small dictionaries for creating missing parser references inline."""
    return {
        "object_types": query(
            """
            SELECT code, name, map_enabled, work_accounting_enabled,
                   material_accounting_enabled, is_linear, accounting_note
            FROM object_types
            WHERE is_active = true
            ORDER BY name
            """
        ),
        "constructives": query("SELECT code, name FROM constructives WHERE is_active = true ORDER BY sort_order, name"),
        "work_groups": [
            r["work_group"]
            for r in query(
                "SELECT DISTINCT work_group FROM work_types WHERE work_group IS NOT NULL ORDER BY work_group"
            )
        ],
    }


@router.post("/object-type-create")
def object_type_create(body: ObjectTypeCreateBody) -> dict[str, Any]:
    """Create a missing object type directly from the report preview object modal."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    code = _safe_ref_code(body.code or name, "OBJECT_TYPE", max_len=50)
    note = (body.accounting_note or "").strip() or None

    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT code, name, map_enabled, work_accounting_enabled,
                           material_accounting_enabled, is_linear, accounting_note
                    FROM object_types
                    WHERE code = %s
                    LIMIT 1
                    """,
                    (code,),
                )
                existing = cur.fetchone()
                if existing:
                    return {
                        "code": existing[0],
                        "name": existing[1],
                        "map_enabled": existing[2],
                        "work_accounting_enabled": existing[3],
                        "material_accounting_enabled": existing[4],
                        "is_linear": existing[5],
                        "accounting_note": existing[6],
                        "source": "existing",
                    }
                cur.execute(
                    """
                    INSERT INTO object_types (
                        code, name, map_enabled, work_accounting_enabled,
                        material_accounting_enabled, is_linear, accounting_note,
                        is_active, sort_order
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, true, 100)
                    RETURNING code, name, map_enabled, work_accounting_enabled,
                              material_accounting_enabled, is_linear, accounting_note
                    """,
                    (
                        code,
                        name[:255],
                        body.map_enabled,
                        body.work_accounting_enabled,
                        body.material_accounting_enabled,
                        body.is_linear,
                        note,
                    ),
                )
                row = cur.fetchone()
                _reset_reference_caches()
                return {
                    "code": row[0],
                    "name": row[1],
                    "map_enabled": row[2],
                    "work_accounting_enabled": row[3],
                    "material_accounting_enabled": row[4],
                    "is_linear": row[5],
                    "accounting_note": row[6],
                    "source": "created",
                }
    finally:
        conn.close()


@router.post("/reference-create")
def reference_create(body: ReferenceCreateBody) -> dict[str, Any]:
    """Create a missing DB reference directly from report preview."""
    kind = (body.kind or "").strip()
    if kind not in {"work_type", "material", "object", "constructive"}:
        raise HTTPException(400, "Unsupported reference kind")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name is required")

    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                if kind == "material":
                    code = _safe_ref_code(body.code, "MAT", max_len=50)
                    unit = (body.default_unit or "м3").strip()[:50]
                    cur.execute("SELECT code, name, default_unit FROM materials WHERE code = %s LIMIT 1", (code,))
                    row = cur.fetchone()
                    if not row:
                        cur.execute(
                            """
                            INSERT INTO materials (code, name, default_unit)
                            VALUES (%s, %s, %s)
                            RETURNING code, name, default_unit
                            """,
                            (code, name[:255], unit),
                        )
                        row = cur.fetchone()
                    _upsert_reference_alias(cur, kind, body.alias_text, code)
                    _reset_reference_caches()
                    return {
                        "code": row[0],
                        "label": row[1],
                        "table": "materials",
                        "default_unit": row[2],
                        "source": "created",
                    }

                if kind == "work_type":
                    code = _safe_ref_code(body.code, "WT")
                    unit = (body.default_unit or "м3").strip()[:50]
                    work_group = (body.work_group or "").strip() or None
                    cur.execute(
                        """
                        SELECT code, name, default_unit, work_group, COALESCE(productivity_enabled, true)
                        FROM work_types
                        WHERE code = %s
                        LIMIT 1
                        """,
                        (code,),
                    )
                    row = cur.fetchone()
                    if not row:
                        cur.execute(
                            """
                            INSERT INTO work_types (
                                code, name, default_unit, work_group,
                                productivity_enabled, is_active, show_in_timeline
                            )
                            VALUES (%s, %s, %s, %s, %s, true, false)
                            RETURNING code, name, default_unit, work_group, productivity_enabled
                            """,
                            (
                                code,
                                name[:255],
                                unit,
                                work_group[:100] if work_group else None,
                                bool(body.productivity_enabled),
                            ),
                        )
                        row = cur.fetchone()
                    _upsert_reference_alias(cur, kind, body.alias_text, code)
                    _reset_reference_caches()
                    return {
                        "code": row[0],
                        "label": row[1],
                        "table": "work_types",
                        "default_unit": row[2],
                        "work_group": row[3],
                        "productivity_enabled": row[4],
                        "source": "created",
                    }

                if kind == "constructive":
                    code = _safe_ref_code(body.code, "CONSTR", max_len=50)
                    cur.execute("SELECT code, name FROM constructives WHERE code = %s LIMIT 1", (code,))
                    row = cur.fetchone()
                    if not row:
                        cur.execute(
                            """
                            INSERT INTO constructives (code, name, sort_order, is_active)
                            VALUES (%s, %s, 100, true)
                            RETURNING code, name
                            """,
                            (code, name[:255]),
                        )
                        row = cur.fetchone()
                    _upsert_reference_alias(cur, kind, body.alias_text, code)
                    _reset_reference_caches()
                    return {
                        "code": row[0],
                        "label": row[1],
                        "table": "constructives",
                        "source": "created",
                    }

                object_type_code = (body.object_type_code or "OTHER").strip()
                constructive_code = (body.constructive_code or "").strip() or None
                pk_start = _parse_pk_input(body.pk_start or body.pk_raw_text or name)
                pk_end = _parse_pk_input(body.pk_end) if body.pk_end not in (None, "") else pk_start
                code_seed = body.code
                if not code_seed and pk_start is not None:
                    prefix = (constructive_code or object_type_code or "OBJ").upper()
                    code_seed = f"{prefix}_{int(round(pk_start / 100))}"
                code = _safe_ref_code(code_seed, "OBJ")

                cur.execute("SELECT id FROM object_types WHERE code = %s LIMIT 1", (object_type_code,))
                type_row = cur.fetchone()
                if not type_row:
                    raise HTTPException(400, f"object_type_code not found: {object_type_code}")
                constructive_id = None
                if constructive_code:
                    cur.execute("SELECT id FROM constructives WHERE code = %s LIMIT 1", (constructive_code,))
                    constructive_row = cur.fetchone()
                    if not constructive_row:
                        raise HTTPException(400, f"constructive_code not found: {constructive_code}")
                    constructive_id = constructive_row[0]

                cur.execute(
                    """
                    SELECT o.id, o.object_code, o.name, ot.code AS object_type_code,
                           c.code AS constructive_code, c.name AS constructive_name
                    FROM objects o
                    JOIN object_types ot ON ot.id = o.object_type_id
                    LEFT JOIN constructives c ON c.id = o.constructive_id
                    WHERE o.object_code = %s
                    LIMIT 1
                    """,
                    (code,),
                )
                row = cur.fetchone()
                if not row:
                    object_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO objects (id, object_code, name, object_type_id, constructive_id, is_active, comment)
                        VALUES (%s, %s, %s, %s, %s, true, %s)
                        RETURNING id, object_code, name
                        """,
                        (
                            object_id,
                            code,
                            name[:255],
                            type_row[0],
                            constructive_id,
                            (body.comment or "created from report preview"),
                        ),
                    )
                    created = cur.fetchone()
                    row = (created[0], created[1], created[2], object_type_code, constructive_code, None)

                if pk_start is not None:
                    raw_pk = (body.pk_raw_text or _format_pk_db(pk_start) or "").strip() or None
                    cur.execute(
                        """
                        SELECT 1 FROM object_segments
                        WHERE object_id = %s AND pk_start = %s AND pk_end = %s
                        LIMIT 1
                        """,
                        (row[0], pk_start, pk_end),
                    )
                    if not cur.fetchone():
                        cur.execute(
                            """
                            INSERT INTO object_segments (object_id, pk_start, pk_end, pk_raw_text, comment)
                            VALUES (%s, %s, %s, %s, %s)
                            """,
                            (row[0], pk_start, pk_end, raw_pk, "created from report preview"),
                        )
                _upsert_reference_alias(cur, "object", body.alias_text, code)
                _reset_reference_caches()
                return {
                    "code": row[1],
                    "label": row[2],
                    "table": "objects",
                    "object_type_code": row[3],
                    "constructive_code": row[4],
                    "constructive_name": row[5],
                    "source": "created",
                }
    finally:
        conn.close()


def _ownership_from_owner(owner: Optional[str]) -> str:
    value = (owner or "").strip().lower()
    if not value:
        return "unknown"
    if value == "ждс":
        return "own"
    return "hired"


def _clean_identifier(value: Any) -> str:
    return str(value or "").strip().strip(";,. ")


def _equipment_identifier_keys(row: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for prefix, fields in (("plate", ("plate_number", "plate")), ("unit", ("unit_number",))):
        for field in fields:
            value = _clean_identifier(row.get(field))
            if value and value.lower() not in {"н/д", "нд", "-", "—"}:
                key = f"{prefix}:{value.lower()}"
                if key not in keys:
                    keys.append(key)
                break
    return keys


def _merge_equipment_payload_row(target: dict[str, Any], source: dict[str, Any]) -> None:
    target_status = _clean_identifier(target.get("status")).lower()
    source_status = _clean_identifier(source.get("status")).lower()
    if source_status and source_status != "unknown" and target_status in {"", "unknown"}:
        target["status"] = source.get("status")
    for field in (
        "equipment_type",
        "brand_model",
        "unit_number",
        "plate_number",
        "plate",
        "operator_name",
        "operator",
        "owner",
        "contractor_name",
        "ownership_type",
        "status_reason",
    ):
        if not target.get(field) and source.get(field):
            target[field] = source.get(field)
    if target.get("plate_number") and not target.get("plate"):
        target["plate"] = target.get("plate_number")
    if target.get("plate") and not target.get("plate_number"):
        target["plate_number"] = target.get("plate")
    source_comment = _clean_identifier(source.get("comment"))
    target_comment = _clean_identifier(target.get("comment"))
    if source_comment and source_comment != target_comment:
        target["comment"] = "; ".join(x for x in [target_comment, source_comment] if x)


def _lookup_equipment_id(row: dict[str, Any], by_identifier: dict[str, str]) -> Optional[str]:
    for key in _equipment_identifier_keys(row):
        if key in by_identifier:
            return by_identifier[key]
    return None


def _format_pk_db(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    pk = int(raw // 100)
    plus = raw - pk * 100
    return f"ПК{pk}+{plus:05.2f}"


def _pile_length_label(pile_type: Optional[str]) -> str:
    value = (pile_type or "").strip()
    m = re.search(r"С\s*(\d{3})", value, re.I)
    if not m:
        return value or "н/д"
    length_m = int(m.group(1)) / 10
    suffix = ", составная" if re.search(r"-\s*С", value, re.I) else ""
    return f"{length_m:g} м{suffix}"


def _section_number_from_code(code: Optional[str]) -> Optional[int]:
    m = re.search(r"UCH_(\d+)", code or "")
    return int(m.group(1)) if m else None


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
    """Parser v2 + DB-backed alias/review enrichment."""
    parsed = parse_report_text(filename, raw_text)
    aliases = load_aliases()
    section_code = (parsed.get("header") or {}).get("section_code")
    total_items = 0
    resolved_items = 0
    unresolved_samples: dict[str, str] = {}  # kind:text (lower) -> original text
    alias_suggestions: list[dict[str, str]] = []

    def _check(kind: str, text: Optional[str], existing_code: Optional[str] = None) -> tuple[Optional[str], list[dict[str, Any]]]:
        nonlocal total_items, resolved_items
        if text is None or str(text).strip() == "":
            return existing_code, []
        total_items += 1
        alias_code = _resolve(aliases, kind, text)
        preferred_code = alias_code or existing_code
        candidates = _reference_candidates(kind, text, preferred_code, section_code=section_code)
        code = _select_reference_code(kind, preferred_code, candidates)
        if code:
            resolved_items += 1
            if existing_code and not alias_code:
                alias_suggestions.append({
                    "kind": kind,
                    "alias_text": str(text).strip(),
                    "canonical_code": code,
                    "reason": "parser_inferred_after_operator_confirmation",
                })
        else:
            key = f"{kind}:{str(text).strip().lower()}"
            unresolved_samples.setdefault(key, str(text).strip())
        return code, candidates

    transport = parsed.get("transport") or []
    if isinstance(transport, list):
        for d in transport:
            if not isinstance(d, dict):
                continue
            needs = False
            for t in d.get('trips') or []:
                if not isinstance(t, dict):
                    continue
                t['material_code'], t['material_suggestions'] = _check('material', t.get('material'), t.get('material_code'))
                t['from_object_code'], t['from_object_suggestions'] = _check('object', t.get('from'), t.get('from_object_code'))
                t['to_object_code'], t['to_object_suggestions'] = _check('object', t.get('to'), t.get('to_object_code'))
                t_needs = (
                    (t.get('material') and not t['material_code']) or
                    (t.get('from') and not t['from_object_code']) or
                    (t.get('to') and not t['to_object_code'])
                )
                t['needs_alias'] = bool(t_needs)
                if t_needs:
                    needs = True
            d['needs_alias'] = needs

    main_works = parsed.get("main_works") or []
    aux_works = parsed.get("aux_works") or []
    for coll in (main_works, aux_works):
        if not isinstance(coll, list):
            continue
        for w in coll:
            if not isinstance(w, dict):
                continue
            w['work_type_code'], w['work_type_suggestions'] = _check('work_type', w.get('work_name'), w.get('work_type_code'))
            object_code, object_suggestions = _check(
                'object',
                w.get('constructive'),
                w.get('object_code') or w.get('constructive_code'),
            )
            w['object_code'] = object_code
            w['object_suggestions'] = object_suggestions
            if object_code:
                # Backward compatibility: the existing import path reads constructive_code
                # before falling back to the raw constructive text.
                w['constructive_code'] = object_code
            w_needs = (
                (w.get('work_name') and not w['work_type_code']) or
                (w.get('constructive') and not w.get('object_code'))
            )
            w['needs_alias'] = bool(w_needs)

    warnings = [
        warning for warning in list(parsed.get("warnings") or [])
        if not ("Накопитель '" in warning and "требует проверки по пикету" in warning)
    ]
    review_actions = parsed.setdefault("review_actions", {})
    review_actions["stockpiles_to_create"] = []
    stockpiles = parsed.get("stockpiles") or []
    if isinstance(stockpiles, list):
        for sp in stockpiles:
            if not isinstance(sp, dict):
                continue
            sp["material_code"], sp["material_suggestions"] = _check("material", sp.get("material"), sp.get("material_code"))
            rounded_pk = sp.get("rounded_pk")
            material_code = sp.get("material_code")
            if rounded_pk is None:
                sp["needs_create"] = None
                sp["requires_user_confirmation"] = True
                warnings.append(f"Накопитель '{sp.get('name')}' без распознанного пикета: нужна ручная проверка")
                continue
            try:
                rows = query(
                    """
                    SELECT
                      o.id::text AS object_id,
                      o.object_code,
                      o.name AS object_name,
                      s.id::text AS stockpile_id,
                      m.code AS material_code,
                      os.pk_start,
                      os.pk_raw_text
                    FROM objects o
                    JOIN object_types ot ON ot.id = o.object_type_id AND ot.code = 'STOCKPILE'
                    LEFT JOIN object_segments os ON os.object_id = o.id
                    LEFT JOIN stockpiles s ON s.object_id = o.id
                    LEFT JOIN materials m ON m.id = s.material_id
                    WHERE ROUND((os.pk_start / 100.0)::numeric) = %s
                      AND (%s IS NULL OR m.code = %s OR s.material_id IS NULL)
                    ORDER BY CASE WHEN m.code = %s THEN 0 ELSE 1 END, o.created_at
                    LIMIT 1
                    """,
                    [rounded_pk, material_code, material_code, material_code],
                )
            except Exception:
                rows = []
            if rows:
                row = rows[0]
                sp.update({
                    "needs_create": False,
                    "requires_user_confirmation": False,
                    "existing_object_id": row.get("object_id"),
                    "existing_object_code": row.get("object_code"),
                    "existing_object_name": row.get("object_name"),
                    "existing_stockpile_id": row.get("stockpile_id"),
                    "action": "use_existing",
                })
            else:
                section_code = (parsed.get("header") or {}).get("section_code") or "UCH"
                proposed = f"STOCK_AUTO_{section_code}_{rounded_pk}_{material_code or 'MAT'}"
                sp.update({
                    "needs_create": True,
                    "requires_user_confirmation": True,
                    "proposed_object_code": proposed[:100],
                    "proposed_object_name": sp.get("name") or proposed,
                    "action": "create_after_operator_confirmation",
                })
                review_actions["stockpiles_to_create"].append(sp)
                warnings.append(
                    f"Накопитель '{sp.get('name')}' на ПК {sp.get('pk_raw_text')} не найден в БД по округленному пикету {rounded_pk}; будет создан после подтверждения"
                )

    piles = parsed.get("piles") or []
    if isinstance(piles, list):
        for p in piles:
            if not isinstance(p, dict):
                continue
            rows: list[dict[str, Any]] = []
            try:
                if p.get("field_code"):
                    rows = query(
                        """SELECT id::text AS id, field_code, field_type, pile_type, pk_start, pk_end, pk_raw_text
                           FROM pile_fields WHERE field_code = %s LIMIT 1""",
                        [p.get("field_code")],
                    )
                elif p.get("pk_start") is not None:
                    rows = query(
                        """SELECT id::text AS id, field_code, field_type, pile_type, pk_start, pk_end, pk_raw_text
                           FROM pile_fields
                           WHERE %s BETWEEN pk_start AND pk_end
                           ORDER BY ABS(((pk_start + pk_end) / 2.0) - %s)
                           LIMIT 1""",
                        [p.get("pk_start"), p.get("pk_start")],
                    )
            except Exception:
                rows = []
            if rows:
                pf = rows[0]
                p.update({
                    "field_id": pf.get("id"),
                    "field_code": pf.get("field_code"),
                    "field_type": pf.get("field_type"),
                    "pile_type": pf.get("pile_type"),
                    "pile_length_label": _pile_length_label(pf.get("pile_type")),
                    "pk_start": float(pf["pk_start"]) if pf.get("pk_start") is not None else None,
                    "pk_end": float(pf["pk_end"]) if pf.get("pk_end") is not None else None,
                    "pk_text": f"{_format_pk_db(pf.get('pk_start'))} — {_format_pk_db(pf.get('pk_end'))}",
                })
            else:
                warnings.append(f"Свайная строка '{p.get('field_code') or p.get('pk_text') or p.get('comment')}' требует выбора поля")
            if p.get("count") in (None, "", 0):
                warnings.append(f"Свайная строка '{p.get('field_code') or p.get('pk_text') or 'без поля'}' без количества")

    aliases_summary = {
        "total_items": total_items,
        "resolved": resolved_items,
        "unresolved": total_items - resolved_items,
        "unresolved_samples": list(unresolved_samples.values())[:50],
        "suggestions": alias_suggestions[:100],
    }

    parsed["aliases"] = aliases_summary
    parsed["warnings"] = warnings
    return parsed


MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/preview")
async def preview_report(file: UploadFile = File(...)):
    """
    multipart/form-data: file=<.txt | .pdf | .xlsx | .xlsm>
    Возвращает распарсенную структуру (ни одной записи в БД не создаётся).
    """
    name = (file.filename or "").lower()
    if not (name.endswith(".txt") or name.endswith(".pdf") or name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(400, "Поддерживаются только .txt, .pdf, .xlsx и .xlsm")

    # Read in chunks with running byte count, reject above 50 MB without buffering the whole file.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"Файл больше {MAX_UPLOAD_SIZE // (1024 * 1024)} МБ")
        chunks.append(chunk)
    blob = b"".join(chunks)
    if not blob:
        raise HTTPException(400, "Пустой файл")

    if name.endswith((".xlsx", ".xlsm")):
        try:
            raw_text = xlsx_bytes_to_report_text(blob)
        except Exception as exc:
            raise HTTPException(400, f"Не удалось разобрать Excel-шаблон: {exc}") from exc
    # TODO: реальный парсер для .pdf. Пока пытаемся декодировать как текст.
    elif name.endswith(".pdf"):
        raw_text = f"[PDF binary, {len(blob)} байт — TODO: реальный парсер]"
    else:
        try:
            raw_text = blob.decode("utf-8")
        except UnicodeDecodeError:
            raw_text = blob.decode("cp1251", errors="replace")

    parsed = _parse_report_text(file.filename or "report.txt", raw_text)
    return parsed


# ── GET /api/wip/reports/pile-fields ───────────────────────────────────

@router.get("/pile-fields")
def report_pile_fields(section: Optional[str] = None):
    """
    Справочник свайных полей для review-блока отчёта.
    Ничего не пишет: только варианты выбора поля/пикета и длина по pile_type.
    """
    where: list[str] = ["pf.is_demo = false"]
    params: list[Any] = []
    if section and section != "all":
        where.append(
            """
            EXISTS (
              SELECT 1
              FROM construction_section_versions csv
              JOIN construction_sections cs ON cs.id = csv.section_id
              WHERE csv.is_current = true
                AND cs.code = %s
                AND pf.pk_start >= csv.pk_start
                AND pf.pk_end <= csv.pk_end
            )
            """
        )
        params.append(section)
    rows = query(
        f"""
        SELECT
          pf.id::text AS id,
          pf.field_code,
          pf.field_type,
          pf.pile_type,
          pf.pk_start,
          pf.pk_end,
          pf.pk_raw_text,
          pf.pile_count,
          COALESCE(
            (SELECT cs.code
             FROM construction_section_versions csv
             JOIN construction_sections cs ON cs.id = csv.section_id
             WHERE csv.is_current = true
               AND pf.pk_start >= csv.pk_start
               AND pf.pk_end <= csv.pk_end
             ORDER BY csv.pk_start
             LIMIT 1),
            NULL
          ) AS section_code
        FROM pile_fields pf
        WHERE {' AND '.join(where)}
        ORDER BY pf.pk_start, pf.field_code
        """,
        params,
    )
    for row in rows:
        row["pk_start"] = float(row["pk_start"]) if row.get("pk_start") is not None else None
        row["pk_end"] = float(row["pk_end"]) if row.get("pk_end") is not None else None
        row["pk_label"] = (
            f"{_format_pk_db(row.get('pk_start'))} — {_format_pk_db(row.get('pk_end'))}"
            if row.get("pk_start") is not None and row.get("pk_end") is not None
            else row.get("pk_raw_text")
        )
        row["pile_length_label"] = _pile_length_label(row.get("pile_type"))
    return {"rows": rows}


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
    stockpiles: list[dict[str, Any]] = []
    piles: list[dict[str, Any]] = []
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

                def _learn_alias(kind: str, alias_text: Optional[str], canonical_code: Optional[str]) -> None:
                    alias = (alias_text or "").strip()
                    canonical = (canonical_code or "").strip()
                    if not alias or not canonical:
                        return
                    cur.execute(
                        """INSERT INTO work_type_aliases (canonical_code, alias_text, kind, notes)
                           VALUES (%s, %s, %s, 'learned_from_confirmed_report_import')
                           ON CONFLICT (alias_text) DO NOTHING""",
                        (canonical, alias, kind),
                    )

                def _get_object_type_id(code: str) -> Optional[str]:
                    cur.execute("SELECT id FROM object_types WHERE code = %s LIMIT 1", (code,))
                    r = cur.fetchone()
                    return r[0] if r else None

                def _find_stockpile_by_pk_material(rounded_pk: Optional[int], material_code: Optional[str]) -> tuple[Optional[str], Optional[str]]:
                    if rounded_pk is None:
                        return None, None
                    cur.execute(
                        """
                        SELECT s.id, o.id
                        FROM objects o
                        JOIN object_types ot ON ot.id = o.object_type_id AND ot.code = 'STOCKPILE'
                        LEFT JOIN object_segments os ON os.object_id = o.id
                        LEFT JOIN stockpiles s ON s.object_id = o.id
                        LEFT JOIN materials m ON m.id = s.material_id
                        WHERE ROUND((os.pk_start / 100.0)::numeric) = %s
                          AND (%s IS NULL OR m.code = %s OR s.material_id IS NULL)
                        ORDER BY CASE WHEN m.code = %s THEN 0 ELSE 1 END, o.created_at
                        LIMIT 1
                        """,
                        (rounded_pk, material_code, material_code, material_code),
                    )
                    r = cur.fetchone()
                    return (r[0], r[1]) if r else (None, None)

                def _ensure_stockpile(sp: dict[str, Any]) -> Optional[str]:
                    material_id = _find_material_id(sp.get("material_code"))
                    if not material_id:
                        return None
                    existing_stockpile_id = sp.get("existing_stockpile_id")
                    if existing_stockpile_id:
                        return existing_stockpile_id
                    found_stockpile_id, found_object_id = _find_stockpile_by_pk_material(sp.get("rounded_pk"), sp.get("material_code"))
                    if found_stockpile_id:
                        return found_stockpile_id

                    object_id = found_object_id or str(uuid.uuid4())
                    stockpile_id = str(uuid.uuid4())
                    object_code = (sp.get("proposed_object_code") or f"STOCK_AUTO_{uuid.uuid4().hex[:12]}")[:100]
                    object_name = (sp.get("proposed_object_name") or sp.get("name") or object_code)[:255]
                    if not found_object_id:
                        object_type_id = _get_object_type_id("STOCKPILE")
                        if not object_type_id:
                            return None
                        cur.execute(
                            """INSERT INTO objects
                               (id, object_code, name, object_type_id, constructive_id, is_active, comment)
                               VALUES (%s, %s, %s, %s, NULL, true, %s)
                               ON CONFLICT (object_code) DO NOTHING""",
                            (object_id, object_code, object_name, object_type_id, "auto-created from confirmed report stockpile block"),
                        )
                        cur.execute("SELECT id FROM objects WHERE object_code = %s LIMIT 1", (object_code,))
                        r_obj = cur.fetchone()
                        object_id = r_obj[0] if r_obj else object_id
                    if sp.get("pk_start") is not None:
                        cur.execute(
                            """INSERT INTO object_segments
                               (id, object_id, pk_start, pk_end, pk_raw_text, comment)
                               VALUES (%s, %s, %s, %s, %s, %s)
                               ON CONFLICT DO NOTHING""",
                            (
                                str(uuid.uuid4()),
                                object_id,
                                sp.get("pk_start"),
                                sp.get("pk_end") or sp.get("pk_start"),
                                sp.get("pk_raw_text"),
                                "auto-created from confirmed report stockpile block",
                            ),
                        )
                    cur.execute(
                        """INSERT INTO stockpiles (id, object_id, material_id, name, is_active)
                           VALUES (%s, %s, %s, %s, true)
                           ON CONFLICT (object_id) DO UPDATE
                           SET material_id = EXCLUDED.material_id,
                               name = EXCLUDED.name
                           RETURNING id""",
                        (stockpile_id, object_id, material_id, sp.get("name") or object_name),
                    )
                    r_stock = cur.fetchone()
                    return r_stock[0] if r_stock else stockpile_id

                def _find_section_misc_object_id(section_code: Optional[str]) -> Optional[str]:
                    num = _section_number_from_code(section_code)
                    if num is not None:
                        cur.execute("SELECT id FROM objects WHERE object_code = %s LIMIT 1", (f"STUFF_{num}",))
                        r = cur.fetchone()
                        if r:
                            return r[0]
                    cur.execute(
                        """
                        SELECT o.id
                        FROM objects o
                        JOIN object_types ot ON ot.id = o.object_type_id
                        WHERE ot.code = 'OTHER'
                        ORDER BY o.created_at
                        LIMIT 1
                        """
                    )
                    r = cur.fetchone()
                    return r[0] if r else None

                def _find_pile_field(row: dict[str, Any]) -> Optional[dict[str, Any]]:
                    if row.get("field_id"):
                        cur.execute(
                            """SELECT id::text, field_code, field_type, pile_type, pk_start, pk_end, pk_raw_text
                               FROM pile_fields WHERE id = %s LIMIT 1""",
                            (row.get("field_id"),),
                        )
                    elif row.get("field_code"):
                        cur.execute(
                            """SELECT id::text, field_code, field_type, pile_type, pk_start, pk_end, pk_raw_text
                               FROM pile_fields WHERE field_code = %s LIMIT 1""",
                            (row.get("field_code"),),
                        )
                    elif row.get("pk_start") is not None:
                        cur.execute(
                            """SELECT id::text, field_code, field_type, pile_type, pk_start, pk_end, pk_raw_text
                               FROM pile_fields
                               WHERE %s BETWEEN pk_start AND pk_end
                               ORDER BY ABS(((pk_start + pk_end) / 2.0) - %s)
                               LIMIT 1""",
                            (row.get("pk_start"), row.get("pk_start")),
                        )
                    else:
                        return None
                    found = cur.fetchone()
                    if not found:
                        return None
                    return {
                        "id": found[0],
                        "field_code": found[1],
                        "field_type": found[2],
                        "pile_type": found[3],
                        "pk_start": found[4],
                        "pk_end": found[5],
                        "pk_raw_text": found[6],
                    }

                # ── Парк техники → report_equipment_units ──
                eq_by_identifier: dict[str, str] = {}
                park_by_identifier: dict[str, dict[str, Any]] = {}
                merged_park: list[dict[str, Any]] = []
                for raw_p in payload.park:
                    p = dict(raw_p)
                    keys = _equipment_identifier_keys(p)
                    if not keys:
                        continue
                    existing = next((park_by_identifier[key] for key in keys if key in park_by_identifier), None)
                    if existing:
                        _merge_equipment_payload_row(existing, p)
                    else:
                        existing = p
                        merged_park.append(existing)
                    for key in _equipment_identifier_keys(existing):
                        park_by_identifier[key] = existing

                n_equipment = 0
                for p in merged_park:
                    plate = _clean_identifier(p.get('plate_number') or p.get('plate'))
                    unit_number = _clean_identifier(p.get('unit_number'))
                    if not plate and not unit_number:
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
                         p.get('brand_model'), unit_number or None, plate or None,
                         p.get('operator_name') or p.get('operator'),
                         p.get('ownership_type') or _ownership_from_owner(owner),
                         p.get('contractor_name') or owner,
                         status_db,
                         p.get('status_reason') or p.get('comment')))
                    for key in _equipment_identifier_keys(p):
                        eq_by_identifier[key] = eq_id
                    n_equipment += 1

                # ── Работы → daily_work_items (+ work_item_equipment_usage) ──
                n_work_items = 0
                n_skipped = 0
                skipped_details: list[str] = []
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
                    obj_id = _find_object_id(w.get('object_code') or w.get('constructive_code') or w.get('constructive')) or default_obj_id
                    constr_id = _find_constructive_id(w.get('constructive_type_code') or w.get('constructive'))
                    vol = w.get('volume')
                    unit = (w.get('unit') or 'м3').replace('м²', 'м2')
                    if vol is None or obj_id is None or wt_id is None:
                        n_skipped += 1
                        skipped_details.append(
                            f"{w.get('constructive') or 'без конструктива'} / {w.get('work_name') or 'без названия'}"
                        )
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
                         _ownership_from_owner(w.get('owner')),
                         w.get('owner')))
                    n_work_items += 1
                    _learn_alias("work_type", w.get("work_name"), w.get("work_type_code"))
                    _learn_alias("object", w.get("constructive"), w.get("object_code") or w.get("constructive_code"))
                    pk_rail_start = _parse_pk_input(w.get("pk_rail_start") or w.get("pk_start") or w.get("pk_rail_raw"))
                    pk_rail_end = _parse_pk_input(w.get("pk_rail_end") or w.get("pk_end")) if w.get("pk_rail_end") not in (None, "") else pk_rail_start
                    pk_raw = (w.get("pk_rail_raw") or "").strip() if isinstance(w.get("pk_rail_raw"), str) else None
                    if not pk_raw and pk_rail_start is not None:
                        start_label = _format_pk_db(pk_rail_start)
                        end_label = _format_pk_db(pk_rail_end)
                        pk_raw = f"{start_label} - {end_label}" if start_label and end_label and start_label != end_label else start_label
                    if pk_rail_start is not None and pk_rail_end is not None:
                        cur.execute(
                            """INSERT INTO daily_work_item_segments
                               (id, daily_work_item_id, pk_start, pk_end, pk_raw_text, comment, volume_segment)
                               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                            (
                                str(uuid.uuid4()),
                                dwi_id,
                                pk_rail_start,
                                pk_rail_end,
                                pk_raw,
                                f"ПК АД: {w.get('pk_ad_raw')}" if w.get("pk_ad_raw") else None,
                                vol,
                            ),
                        )
                    equipment_rows = list(w.get("equipment") or [])
                    if not equipment_rows and (w.get('plate') or w.get('plate_number') or w.get('unit_number')):
                        equipment_rows = [{
                            "plate_number": w.get('plate') or w.get('plate_number'),
                            "unit_number": w.get('unit_number'),
                            "volume": vol,
                            "unit": unit,
                        }]
                    for eq in equipment_rows:
                        eq_id = _lookup_equipment_id(eq, eq_by_identifier)
                        if eq_id:
                            eq_vol = eq.get("volume")
                            eq_unit = (eq.get("unit") or unit).replace("м²", "м2")
                            cur.execute(
                                """INSERT INTO work_item_equipment_usage
                                   (id, daily_work_item_id, report_equipment_unit_id,
                                   worked_volume, worked_area, comment)
                                   VALUES (%s, %s, %s, %s, %s, %s)""",
                                (str(uuid.uuid4()), dwi_id, eq_id,
                                 eq_vol if eq_unit == 'м3' else None,
                                 eq_vol if eq_unit in ('м2', 'м²') else None,
                                 'import'))
                if n_skipped:
                    raise HTTPException(
                        400,
                        "Импорт остановлен: есть работы без объема, объекта или типа работы: " + "; ".join(skipped_details[:10]),
                    )

                # ── Забивка свай → daily_work_items (+ segment by pile field) ──
                n_piles = 0
                pile_skipped: list[str] = []
                for p in (payload.piles or []):
                    count = p.get("count")
                    try:
                        count_num = float(count)
                    except (TypeError, ValueError):
                        count_num = 0
                    if count_num <= 0:
                        continue
                    field = _find_pile_field(p)
                    pile_kind = (p.get("pile_kind") or p.get("field_type") or (field or {}).get("field_type") or "main").lower()
                    wt_code = "PILE_TRIAL" if pile_kind in ("test", "trial", "пробные", "пробная") else "PILE_MAIN"
                    wt_id = _find_work_type_id(wt_code)
                    if not wt_id or not field:
                        pile_skipped.append(str(p.get("field_code") or p.get("pk_text") or "свайное поле н/д"))
                        continue
                    dwi_id = str(uuid.uuid4())
                    comment_parts = [
                        f"field={field.get('field_code')}",
                        f"pile_type={field.get('pile_type')}",
                        f"length={_pile_length_label(field.get('pile_type'))}",
                    ]
                    if p.get("is_composite_complete"):
                        comment_parts.append("составная свая готова")
                    if p.get("comment"):
                        comment_parts.append(str(p.get("comment")))
                    cur.execute(
                        """INSERT INTO daily_work_items
                           (id, daily_report_id, report_date, shift, section_id, object_id,
                            constructive_id, work_type_id, work_name_raw, unit, volume,
                            labor_source_type, contractor_name, comment)
                           VALUES (%s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            dwi_id,
                            report_id,
                            report_date,
                            shift,
                            section_id,
                            None,
                            wt_id,
                            "Забивка пробных свай" if wt_code == "PILE_TRIAL" else "Забивка основных свай",
                            "шт",
                            count_num,
                            "unknown",
                            None,
                            "; ".join(comment_parts),
                        ),
                    )
                    cur.execute(
                        """INSERT INTO daily_work_item_segments
                           (id, daily_work_item_id, pile_field_id, pk_start, pk_end, pk_raw_text, comment, volume_segment)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (
                            str(uuid.uuid4()),
                            dwi_id,
                            field.get("id"),
                            field.get("pk_start"),
                            field.get("pk_end"),
                            field.get("pk_raw_text"),
                            f"Свайное поле {field.get('field_code')}",
                            count_num,
                        ),
                    )
                    n_work_items += 1
                    n_piles += 1
                if pile_skipped:
                    raise HTTPException(
                        400,
                        "Импорт остановлен: есть свайные строки без поля или типа работ: " + "; ".join(pile_skipped[:10]),
                    )

                # ── Перевозка → material_movements (+ usage) ──
                n_movements = 0
                movement_skipped: list[str] = []
                for d in (payload.transport or []):
                    eq_id = _lookup_equipment_id(d, eq_by_identifier)
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
                            movement_skipped.append(f"{trip.get('material') or 'материал н/д'}: {trip.get('from') or 'откуда н/д'} → {trip.get('to') or 'куда н/д'}")
                            continue
                        _learn_alias("material", trip.get("material"), trip.get("material_code"))
                        _learn_alias("object", trip.get("from"), trip.get("from_object_code"))
                        _learn_alias("object", trip.get("to"), trip.get("to_object_code"))
                        mm_id = str(uuid.uuid4())
                        cur.execute(
                            """INSERT INTO material_movements
                               (id, daily_report_id, report_date, shift, section_id, material_id,
                                from_object_id, to_object_id, volume, unit, trip_count, movement_type,
                                labor_source_type, contractor_name, equipment_type, equipment_count)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                            (mm_id, report_id, report_date, shift, section_id, mat_id,
                             from_id, to_id, vol, trip.get('unit') or 'м3', trips_cnt, mtype,
                             _ownership_from_owner(owner),
                             owner, 'самосвал', 1))
                        n_movements += 1
                        if eq_id:
                            cur.execute(
                                """INSERT INTO material_movement_equipment_usage
                                   (id, material_movement_id, report_equipment_unit_id,
                                    trips_count, worked_volume, comment)
                                   VALUES (%s, %s, %s, %s, %s, %s)""",
                                (str(uuid.uuid4()), mm_id, eq_id,
                                 trips_cnt, vol, 'import'))
                if movement_skipped:
                    raise HTTPException(
                        400,
                        "Импорт остановлен: есть перевозки без объема или распознанных объектов: " + "; ".join(movement_skipped[:10]),
                    )

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

                # ── Персонал ──
                n_personnel = 0
                for person_row in (payload.personnel or []):
                    category = (person_row.get("category") or "").strip()
                    count = person_row.get("count")
                    if not category or count is None:
                        continue
                    cur.execute(
                        """INSERT INTO daily_report_personnel
                           (id, daily_report_id, category, person_count)
                           VALUES (%s, %s, %s, %s)""",
                        (str(uuid.uuid4()), report_id, category, int(count)),
                    )
                    n_personnel += 1

                # ── Накопители → stockpiles + stockpile_balance_snapshots ──
                n_stockpiles = 0
                n_stockpiles_created_or_used = 0
                stockpile_skipped: list[str] = []
                for sp in (payload.stockpiles or []):
                    if sp.get("volume") is None:
                        stockpile_skipped.append(f"{sp.get('name') or 'накопитель н/д'} без объема")
                        continue
                    stockpile_id = _ensure_stockpile(sp)
                    if not stockpile_id:
                        stockpile_skipped.append(f"{sp.get('name') or 'накопитель н/д'} без материала/пикета/типа объекта")
                        continue
                    cur.execute(
                        """INSERT INTO stockpile_balance_snapshots
                           (id, stockpile_id, snapshot_date, balance_volume, unit, comment)
                           VALUES (%s, %s, %s, %s, %s, %s)
                           ON CONFLICT (stockpile_id, snapshot_date) DO UPDATE
                           SET balance_volume = EXCLUDED.balance_volume,
                               unit = EXCLUDED.unit,
                               comment = EXCLUDED.comment""",
                        (
                            str(uuid.uuid4()),
                            stockpile_id,
                            report_date,
                            sp.get("volume"),
                            sp.get("unit") or "м3",
                            "confirmed report import; stockpile block",
                        ),
                    )
                    n_stockpiles += 1
                    n_stockpiles_created_or_used += 1
                if stockpile_skipped:
                    raise HTTPException(
                        400,
                        "Импорт остановлен: есть накопители без обязательных данных: " + "; ".join(stockpile_skipped[:10]),
                    )

                inserted = {
                    "daily_report_id": report_id,
                    "work_items": n_work_items,
                    "work_items_skipped_no_object": n_skipped,
                    "movements": n_movements,
                    "equipment_units": n_equipment,
                    "problems": n_problems,
                    "personnel": n_personnel,
                    "stockpile_snapshots": n_stockpiles,
                    "stockpiles_created_or_used": n_stockpiles_created_or_used,
                    "pile_items": n_piles,
                }

                return {"ok": True, **inserted}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Ошибка импорта: {e}")
    finally:
        conn.close()
