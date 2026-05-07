"""Deterministic parser for VSM daily text reports.

The parser is deliberately format-first. It does not write to DB and does not
resolve DB ids. reports_routes.py enriches aliases and performs import.
"""
from __future__ import annotations

from datetime import date as date_cls
import re
from typing import Any, Optional


SECTION_RE = re.compile(r"^\s*===\s*(.+?)\s*===\s*$", re.MULTILINE)
MAT_OR_WORK_RE = re.compile(r"^/(.+?)/\s*$")
CONSTRUCTIVE_RE = re.compile(r"^-\s*(.+?)\s*-\s*$")
FIELD_RE = re.compile(r"^([^:：]+)\s*[:：]\s*(.*)$")
HEADER_RE = re.compile(r"^([^-\n–—]+?)\s*[-–—]\s*(.+)$")
VEHICLE_RE = re.compile(r"^(.+?)\s*\(([^)]*)\)\s*;\s*(.+?)\s*[;,]?\s*$")
VOLUME_TRIPS_RE = re.compile(r"(\d[\d\s]*(?:[,.]\d+)?|Н/Д|н/д)\s*(м3|м²|м2|м|км|шт|т)?\s*/\s*(\d+)\s*рейс", re.I)
VOLUME_RE = re.compile(r"(?:[A-ZА-Я]\s*=\s*)?(\d[\d\s]*(?:[,.]\d+)?)\s*(м3|м²|м2|м|км|шт|т)(?:\s*[;(]\s*([^)]+?)\s*\)?)?", re.I)
PK_RE = re.compile(r"ПК\s*([А-ЯA-Z]*\s*)?(\d+)\s*\+\s*(\d+(?:[,.]\d+)?)", re.I)
PK_LINE_RE = re.compile(r"^(ПК\s+(?:ВСЖМ|АД))\s*:\s*(.*)$", re.I)
OPERATOR_RE = re.compile(r"^ф\s*\.?\s*и\s*\.?\s*о\s*\.?\s*:?\s*(.*)$", re.I)
EQUIPMENT_WORD_RE = re.compile(
    r"\b(экскаватор-погрузчик|фронтальный\s+погрузчик|экскаватор|самосвал|шахман|shacman|бульдозер|автогрейдер|виброкаток|каток|коток|камаз|кдм|топливозаправщик|вахтовка|уаз|кму|прм)\b",
    re.I,
)
PLAIN_OPERATOR_RE = re.compile(r"^[А-ЯЁ][а-яё]+(?:\s*[А-ЯЁ]\.?){1,2}$")
PLATE_LIKE_RE = re.compile(r"^(?=.*\d)(?=.*[A-ZА-ЯЁ])[A-ZА-ЯЁ0-9]+$", re.I)
UNIT_NUMBER_LABEL = r"(?:б\s*/\s*н|борт(?:\.|овой)?(?:\s*(?:№|номер))?|инв(?:\.|ентарн(?:ый|ого)?)?(?:\s*(?:№|номер))?)"
PLATE_NUMBER_LABEL = r"(?:г\s*/\s*н|гос\.?\s*(?:номер|н)|госномер|государственн(?:ый|ого)?\s*номер|рег(?:\.|истрационн(?:ый|ого)?)?\s*(?:номер)?)"
UNIT_NUMBER_LABEL_RE = re.compile(UNIT_NUMBER_LABEL, re.I)
PLATE_NUMBER_LABEL_RE = re.compile(PLATE_NUMBER_LABEL, re.I)
NUMBER_MARKER_RE = re.compile(rf"(?:{UNIT_NUMBER_LABEL}|{PLATE_NUMBER_LABEL})", re.I)
NUMBER_STOP_RE = re.compile(rf"\s*(?:[;,]|\b(?:{UNIT_NUMBER_LABEL}|{PLATE_NUMBER_LABEL})\b)", re.I)
NUMBER_TOKEN_RE = re.compile(
    rf"\s*(?:{UNIT_NUMBER_LABEL}|{PLATE_NUMBER_LABEL})\s*[:№#-]?\s*.*?(?=\s*(?:[;,]|\b(?:{UNIT_NUMBER_LABEL}|{PLATE_NUMBER_LABEL})\b|$))",
    re.I,
)
STATUS_MAP = {
    "в работе": "working",
    "работа": "working",
    "working": "working",
    "ремонт": "repair",
    "repair": "repair",
    "простой": "standby",
    "standby": "standby",
    "резерв": "standby",
    "вне": "out",
    "out": "out",
    "н/д": "unknown",
    "нд": "unknown",
    "unknown": "unknown",
}
MATERIAL_CODES = [
    ("SHPGS", re.compile(r"\b(щпгс|щпс)\b", re.I)),
    ("SAND", re.compile(r"\bпес", re.I)),
    ("PEAT", re.compile(r"\b(торф|непригод)", re.I)),
    ("SOIL", re.compile(r"\b(грунт|глин)", re.I)),
    ("CRUSHED_STONE", re.compile(r"\bщеб", re.I)),
]
WORK_TYPE_CODES = [
    ("CONSOLIDATION", re.compile(r"\bуплотнен", re.I)),
    ("DITCH_CONSTRUCTION", re.compile(r"\b(канава|кювет|водоотвод)", re.I)),
    ("EARTH_EXCAVATION", re.compile(r"\b(разработка\s+(?:выемки|грунта)|выемк)", re.I)),
    ("AREA_GRADING", re.compile(r"\b(планировк|профилирован)", re.I)),
    ("EMBANKMENT_CONSTRUCTION", re.compile(r"\bустройство\s+насып", re.I)),
    ("PAVEMENT_SANDING", re.compile(r"\b(дорожн(?:ой|ая)\s+одежд|дсо|дополнительн.*сло)", re.I)),
    ("TOPSOIL_STRIPPING", re.compile(r"\b(прс|растительн)", re.I)),
    ("SOIL_WORK", re.compile(r"\b(погруз|при[её]м|иссо|конус|накопител)", re.I)),
]


def normalize_text(raw_text: str) -> tuple[str, list[str]]:
    comments: list[str] = []
    lines: list[str] = []
    for raw_line in (raw_text or "").replace("\r\n", "\n").replace("\r", "\n").splitlines():
        line = raw_line.replace("\t", " ")
        line = re.sub(r"[ \u00a0]+", " ", line).strip()
        if not line:
            lines.append("")
            continue
        if line.startswith("%%"):
            comments.append(line.lstrip("%").strip())
            continue
        if line == "|":
            lines.append("")
            continue
        lines.append(line)
    return "\n".join(lines), comments


def to_float(value: str | None) -> Optional[float]:
    if not value:
        return None
    v = value.strip()
    if v.lower() in {"н/д", "нд", "-", "—"}:
        return None
    try:
        return float(v.replace(" ", "").replace(",", "."))
    except ValueError:
        return None


def clean_value(value: str | None) -> str:
    return (value or "").strip().strip(";,. ")


def equipment_identifier_keys(row: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for prefix, fields in (("plate", ("plate_number", "plate")), ("unit", ("unit_number",))):
        for field in fields:
            value = clean_value(row.get(field))
            if value and value.lower() not in {"н/д", "нд", "-", "—"}:
                key = f"{prefix}:{value.lower()}"
                if key not in keys:
                    keys.append(key)
                break
    return keys


def merge_equipment_row(target: dict[str, Any], source: dict[str, Any], *, infer_working: bool = False) -> None:
    if target.get("plate_number") and not target.get("plate"):
        target["plate"] = target.get("plate_number")
    if target.get("plate") and not target.get("plate_number"):
        target["plate_number"] = target.get("plate")

    source_status = clean_value(source.get("status")).lower()
    target_status = clean_value(target.get("status")).lower()
    if source_status and source_status != "unknown" and target_status in {"", "unknown"}:
        target["status"] = source.get("status")
    if infer_working and target_status in {"", "unknown"}:
        target["status"] = "working"

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
    ):
        if not target.get(field) and source.get(field):
            target[field] = source.get(field)

    source_comment = clean_value(source.get("comment"))
    target_comment = clean_value(target.get("comment"))
    if source_comment and source_comment != target_comment:
        target["comment"] = "; ".join(x for x in [target_comment, source_comment] if x)


def parse_date(value: str) -> str:
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", value or "")
    if not m:
        return date_cls.today().isoformat()
    return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"


def parse_shift(value: str) -> str:
    v = (value or "").lower()
    if "день" in v:
        return "day"
    if "ноч" in v:
        return "night"
    return "unknown"


def parse_section_code(value: str) -> str:
    m = re.search(r"№\s*(\d+)|участок\s*(\d+)", value or "", re.I)
    if not m:
        return ""
    num = m.group(1) or m.group(2)
    return f"UCH_{num}"


def parse_pk_value(text: str) -> Optional[float]:
    m = PK_RE.search(text or "")
    if not m:
        return None
    return int(m.group(2)) * 100 + float(m.group(3).replace(",", "."))


def parse_pk_range(text: str) -> dict[str, Any]:
    raw = clean_value(text)
    matches = list(PK_RE.finditer(raw))
    if not matches:
        return {"start": None, "end": None, "raw": raw}
    first = parse_pk_value(matches[0].group(0))
    last = parse_pk_value(matches[-1].group(0))
    return {"start": first, "end": last if len(matches) > 1 else first, "raw": raw}


def rounded_pk(pk: Optional[float]) -> Optional[int]:
    if pk is None:
        return None
    return int(round(pk / 100))


def infer_material_code(value: str | None) -> Optional[str]:
    for code, pattern in MATERIAL_CODES:
        if pattern.search(value or ""):
            return code
    return None


def infer_work_type_code(value: str | None) -> Optional[str]:
    for code, pattern in WORK_TYPE_CODES:
        if pattern.search(value or ""):
            return code
    return None


def split_sections(text: str) -> tuple[str, dict[str, str]]:
    matches = list(SECTION_RE.finditer(text or ""))
    if not matches:
        return text or "", {}
    header = text[: matches[0].start()]
    sections: dict[str, str] = {}
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        sections[match.group(1).strip().upper()] = text[start:end].strip()
    return header, sections


def parse_header(header_text: str) -> dict[str, Any]:
    raw: dict[str, str] = {}
    delivery_info = ""
    for line in header_text.splitlines():
        if not line.strip():
            continue
        if line.lower().startswith("информация по завозу"):
            _, _, delivery_info = line.partition(":")
            delivery_info = delivery_info.strip()
            continue
        m = HEADER_RE.match(line)
        if m:
            raw[m.group(1).strip().lower()] = m.group(2).strip()
    report_date = parse_date(raw.get("дата", ""))
    shift = parse_shift(raw.get("смена", ""))
    section_name = raw.get("участок", "")
    return {
        "report_date": report_date,
        "shift": shift,
        "section_code": parse_section_code(section_name),
        "section_name": section_name,
        "direction": raw.get("направление", ""),
        "constructives": raw.get("конструктивы", ""),
        "delivery_info": delivery_info,
        "author": "",
    }


def parse_operator_line(line: str) -> Optional[str]:
    m = OPERATOR_RE.match(line.strip())
    if not m:
        return None
    return clean_value(m.group(1)) or "н/д"


def parse_dash_person_line(line: str) -> Optional[str]:
    m = CONSTRUCTIVE_RE.match(line)
    if not m:
        return None
    value = clean_value(m.group(1))
    return value if parse_plain_operator_line(value) else None


def parse_plain_operator_line(line: str) -> Optional[str]:
    value = (line or "").strip().strip("; ")
    if PLAIN_OPERATOR_RE.match(value):
        return value
    return None


def split_inline_operator_equipment(value: str) -> tuple[str, Optional[str]]:
    m = EQUIPMENT_WORD_RE.search(value or "")
    if not m or m.start() == 0:
        return clean_value(value), None
    return clean_value(value[: m.start()]), clean_value(value[m.start():])


def parse_numbers(numbers: str) -> dict[str, Optional[str]]:
    def clean_identifier(value: str | None) -> Optional[str]:
        v = clean_value(value)
        v = re.sub(r"^(?:№|#|n|no|номер)\s*", "", v, flags=re.I)
        v = clean_value(v)
        if not v or v.lower() in {"н/д", "нд", "-", "—"}:
            return None
        return re.sub(r"\s+", "", v)

    def extract_labeled(pattern: re.Pattern[str], text: str) -> Optional[str]:
        for match in pattern.finditer(text):
            tail = text[match.end():]
            stop = NUMBER_STOP_RE.search(tail)
            value = tail[: stop.start()] if stop else tail
            cleaned = clean_identifier(value)
            if cleaned:
                return cleaned
        return None

    unit_number = extract_labeled(UNIT_NUMBER_LABEL_RE, numbers)
    plate_number = extract_labeled(PLATE_NUMBER_LABEL_RE, numbers)
    if unit_number or plate_number:
        return {"unit_number": unit_number or None, "plate_number": plate_number or None}

    parts = [clean_identifier(part) for part in re.split(r"[;,]", numbers)]
    parts = [part for part in parts if part]
    if len(parts) >= 2:
        unit_number = parts[0]
        plate_number = parts[1]
    elif len(parts) == 1:
        unit_number = parts[0]
    return {"unit_number": unit_number or None, "plate_number": plate_number or None}


def strip_number_markers(value: str) -> str:
    stripped = NUMBER_TOKEN_RE.sub(" ", value)
    stripped = re.sub(r"\s*[;,]\s*", " ", stripped)
    return clean_value(re.sub(r"\s+", " ", stripped))


def normalize_equipment_left(value: str) -> str:
    fixed = clean_value(value)
    for word in ("Самосвал", "Шахман", "SHACMAN", "Бульдозер", "Экскаватор", "Автогрейдер", "Виброкаток", "Каток", "Коток"):
        fixed = re.sub(rf"^({word})(?=[A-ZА-ЯЁ])", r"\1 ", fixed, flags=re.I)
    return re.sub(r"\s+", " ", fixed).strip()


def split_equipment_name(left: str) -> tuple[str, Optional[str]]:
    parts = normalize_equipment_left(left).split(None, 1)
    if not parts:
        return "unknown", None
    first = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else None
    if first == "коток":
        first = "каток"
    if first == "фронтальный" and rest and rest.lower().startswith("погрузчик"):
        tail = rest.split(None, 1)
        return "фронтальный погрузчик", tail[1] if len(tail) > 1 else None
    return first, rest


def split_trailing_unit_from_model(equipment_type: str, brand_model: str | None) -> tuple[str | None, Optional[str]]:
    if not brand_model:
        return brand_model, None
    m = re.match(r"^(.+\S)\s+([A-ZА-ЯЁ]?\d{2,4}[A-ZА-ЯЁ]?)$", brand_model, re.I)
    if not m:
        return brand_model, None
    prefix = m.group(1)
    unit = m.group(2)
    if equipment_type == "самосвал" or re.search(r"\d", prefix):
        return prefix, unit
    return brand_model, None


def split_equipment_line(line: str) -> Optional[tuple[str, str, str]]:
    raw = line.strip()
    m = VEHICLE_RE.match(raw)
    if m:
        return clean_value(m.group(1)), m.group(2), clean_value(m.group(3))

    paren = re.match(r"^(.+?)\s*\(([^)]*)\)\s*(?:[;,]?\s*(.+?))?\s*$", raw)
    if paren and EQUIPMENT_WORD_RE.search(paren.group(1)) and (NUMBER_MARKER_RE.search(paren.group(2)) or any(parse_numbers(paren.group(2)).values())):
        return clean_value(paren.group(1)), paren.group(2), clean_value(paren.group(3))

    if ";" in raw:
        left_with_numbers, tail = raw.rsplit(";", 1)
        if NUMBER_MARKER_RE.search(left_with_numbers):
            left = strip_number_markers(left_with_numbers)
            if left:
                return left, left_with_numbers, clean_value(tail)
        if EQUIPMENT_WORD_RE.search(left_with_numbers):
            return clean_value(left_with_numbers), "", clean_value(tail)

    if NUMBER_MARKER_RE.search(raw):
        left = strip_number_markers(raw)
        if left and left != raw:
            return left, raw, ""
    return None


def parse_equipment_line(line: str, operator_name: str | None = None) -> Optional[dict[str, Any]]:
    parsed = split_equipment_line(line)
    if not parsed:
        return None
    left, numbers, owner = parsed
    nums = parse_numbers(numbers)
    equipment_type, brand_model = split_equipment_name(left)
    if nums["unit_number"] and not nums["plate_number"] and PLATE_LIKE_RE.match(nums["unit_number"]):
        brand_model, inferred_unit = split_trailing_unit_from_model(equipment_type, brand_model)
        if inferred_unit:
            nums["plate_number"] = nums["unit_number"]
            nums["unit_number"] = inferred_unit
    return {
        "equipment_type": equipment_type,
        "brand_model": brand_model,
        "unit_number": nums["unit_number"],
        "plate_number": nums["plate_number"],
        "plate": nums["plate_number"],
        "operator_name": operator_name,
        "operator": operator_name,
        "owner": owner,
        "contractor_name": owner,
        "status": "unknown",
        "comment": None,
    }


def parse_status(value: str | None) -> str:
    v = clean_value(value).lower()
    return STATUS_MAP.get(v, "unknown")


def looks_company(value: str) -> bool:
    v = value.lower()
    return any(marker in v for marker in ("ооо", "ждс", "алмаз", "рейл", "логистик", "ао", "зао"))


def parse_transport(body: str) -> list[dict[str, Any]]:
    drivers: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_material: str | None = None
    pending_route: tuple[str, str] | None = None
    for line in body.splitlines():
        if not line.strip():
            continue
        operator = parse_operator_line(line) or parse_dash_person_line(line)
        if operator is not None:
            if current:
                drivers.append(current)
            current = {"driver": operator, "operator_name": operator, "trips": [], "comments": []}
            current_material = None
            pending_route = None
            continue
        if current is None:
            continue
        if line.startswith("%%"):
            current["comments"].append(line.lstrip("%").strip())
            continue
        eq = parse_equipment_line(line, current.get("driver"))
        if eq and not current.get("vehicle"):
            current.update(eq)
            current["vehicle"] = " ".join(x for x in [eq.get("equipment_type"), eq.get("brand_model")] if x)
            continue
        mat = MAT_OR_WORK_RE.match(line)
        if mat:
            current_material = clean_value(mat.group(1))
            pending_route = None
            continue
        if current_material and ("→" in line or "->" in line):
            arrow = "→" if "→" in line else "->"
            src, _, dst = line.partition(arrow)
            pending_route = (clean_value(src), clean_value(dst))
            continue
        vol = VOLUME_TRIPS_RE.search(line)
        if vol and current_material and pending_route:
            unit = vol.group(2) or "м3"
            current["trips"].append({
                "material": current_material,
                "material_code": infer_material_code(current_material),
                "from": pending_route[0],
                "to": pending_route[1],
                "from_location": pending_route[0],
                "to_location": pending_route[1],
                "volume": to_float(vol.group(1)),
                "unit": unit.replace("м²", "м2"),
                "trips": int(vol.group(3)),
                "trip_count": int(vol.group(3)),
            })
            pending_route = None
    if current:
        drivers.append(current)
    return drivers


def finalize_work(current: dict[str, Any] | None, out: list[dict[str, Any]]) -> None:
    if not current:
        return
    equipment = current.get("equipment") or []
    with_individual = [eq for eq in equipment if eq.get("volume") is not None]
    performers = current.get("performers") or []
    common_equipment_volume = (
        len(with_individual) == 1
        and len(equipment) > 1
        and current.get("volume") == with_individual[0].get("volume")
    )

    def drop_internal(item: dict[str, Any]) -> None:
        item.pop("_last_equipment_index", None)
        item.pop("performers", None)
        item.pop("_pending_volume", None)

    if (with_individual and not common_equipment_volume) or performers:
        for eq in with_individual:
            item = dict(current)
            item["equipment"] = [eq]
            item["operator"] = eq.get("operator_name")
            item["operator_name"] = eq.get("operator_name")
            item["plate"] = eq.get("plate_number")
            item["plate_number"] = eq.get("plate_number")
            item["unit_number"] = eq.get("unit_number")
            item["vehicle"] = " ".join(x for x in [eq.get("equipment_type"), eq.get("brand_model")] if x)
            item["owner"] = eq.get("owner")
            item["volume"] = eq.get("volume")
            item["unit"] = eq.get("unit") or current.get("unit")
            drop_internal(item)
            out.append(item)
        for eq in equipment:
            if eq.get("volume") is not None:
                continue
            item = dict(current)
            item["equipment"] = [eq]
            item["operator"] = eq.get("operator_name")
            item["operator_name"] = eq.get("operator_name")
            item["plate"] = eq.get("plate_number")
            item["plate_number"] = eq.get("plate_number")
            item["unit_number"] = eq.get("unit_number")
            item["vehicle"] = " ".join(x for x in [eq.get("equipment_type"), eq.get("brand_model")] if x)
            item["owner"] = eq.get("owner")
            item["volume"] = None
            item["unit"] = current.get("unit")
            drop_internal(item)
            out.append(item)
        for performer in performers:
            item = dict(current)
            if len(equipment) == 1:
                item["equipment"] = [equipment[0]]
            else:
                item["equipment"] = []
            item["operator"] = performer.get("operator_name")
            item["operator_name"] = performer.get("operator_name")
            item["volume"] = performer.get("volume")
            item["unit"] = performer.get("unit") or current.get("unit")
            if equipment:
                first = equipment[0]
                item["plate"] = first.get("plate_number")
                item["plate_number"] = first.get("plate_number")
                item["unit_number"] = first.get("unit_number")
                item["vehicle"] = " ".join(x for x in [first.get("equipment_type"), first.get("brand_model")] if x)
                item["owner"] = first.get("owner")
            drop_internal(item)
            out.append(item)
    else:
        item = dict(current)
        item["equipment"] = []
        for eq in equipment:
            eq_item = dict(eq)
            if common_equipment_volume and eq_item.get("volume") == current.get("volume"):
                eq_item.pop("volume", None)
                eq_item.pop("unit", None)
            item["equipment"].append(eq_item)
        if equipment:
            first = equipment[0]
            item["operator"] = first.get("operator_name")
            item["operator_name"] = first.get("operator_name")
            item["plate"] = first.get("plate_number")
            item["plate_number"] = first.get("plate_number")
            item["unit_number"] = first.get("unit_number")
            item["vehicle"] = " ".join(x for x in [first.get("equipment_type"), first.get("brand_model")] if x)
            item["owner"] = first.get("owner")
        drop_internal(item)
        out.append(item)


def parse_operator_volume_entries(value: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for part in re.split(r"\s*;\s*", value or ""):
        vol = VOLUME_RE.search(part)
        if not vol:
            continue
        name = clean_value(part[: vol.start()])
        name = clean_value(re.sub(r"\s*[-–—:]\s*$", "", name))
        if not name:
            continue
        unit = (vol.group(2) or "").replace("м²", "м2")
        entries.append({
            "operator_name": name,
            "operator": name,
            "volume": to_float(vol.group(1)),
            "unit": unit,
        })
    return entries


def parse_works(body: str) -> list[dict[str, Any]]:
    works: list[dict[str, Any]] = []
    current_constructive: str | None = None
    current: dict[str, Any] | None = None
    pending_operator: str | None = None
    for line in body.splitlines():
        if not line.strip():
            continue
        constr = CONSTRUCTIVE_RE.match(line)
        if constr and not MAT_OR_WORK_RE.match(line):
            finalize_work(current, works)
            current = None
            current_constructive = clean_value(constr.group(1))
            continue
        work = MAT_OR_WORK_RE.match(line)
        if work:
            finalize_work(current, works)
            name = clean_value(work.group(1))
            current = {
                "constructive": current_constructive,
                "constructive_code": None,
                "work_name": name,
                "work_type_code": infer_work_type_code(name),
                "pk_rail_start": None,
                "pk_rail_end": None,
                "pk_rail_raw": None,
                "pk_ad_start": None,
                "pk_ad_end": None,
                "pk_ad_raw": None,
                "pk_start": None,
                "pk_end": None,
                "volume": None,
                "unit": None,
                "volume_note": None,
                "equipment": [],
                "performers": [],
                "_pending_volume": None,
                "comments": [],
            }
            pending_operator = None
            continue
        if current is None:
            continue
        if line.startswith("%%"):
            current["comments"].append(line.lstrip("%").strip())
            continue
        pk_line = PK_LINE_RE.match(line)
        if pk_line:
            parsed = parse_pk_range(pk_line.group(2))
            if "ВСЖМ" in pk_line.group(1).upper():
                current["pk_rail_start"] = parsed["start"]
                current["pk_rail_end"] = parsed["end"]
                current["pk_rail_raw"] = parsed["raw"]
                current["pk_start"] = parsed["start"]
                current["pk_end"] = parsed["end"]
            else:
                current["pk_ad_start"] = parsed["start"]
                current["pk_ad_end"] = parsed["end"]
                current["pk_ad_raw"] = parsed["raw"]
            continue
        operator_line = parse_operator_line(line)
        if operator_line is not None:
            operator_text, inline_equipment = split_inline_operator_equipment(operator_line)
            operator_text = operator_text or "н/д"
            performer_volumes = parse_operator_volume_entries(operator_text)
            if performer_volumes:
                current["performers"].extend(performer_volumes)
                pending_operator = None
            else:
                pending_operator = operator_text
            if inline_equipment:
                eq = parse_equipment_line(inline_equipment, pending_operator)
                if eq:
                    pending_volume = current.get("_pending_volume")
                    if pending_volume and eq.get("volume") is None:
                        eq["volume"] = pending_volume.get("volume")
                        eq["unit"] = pending_volume.get("unit")
                        current["_pending_volume"] = None
                    current["equipment"].append(eq)
                    current["_last_equipment_index"] = len(current["equipment"]) - 1
                    pending_operator = None
            continue
        plain_operator = parse_plain_operator_line(line)
        if plain_operator is not None:
            pending_operator = plain_operator
            continue
        eq = parse_equipment_line(line, pending_operator)
        if eq:
            pending_volume = current.get("_pending_volume")
            if pending_volume and eq.get("volume") is None:
                eq["volume"] = pending_volume.get("volume")
                eq["unit"] = pending_volume.get("unit")
                current["_pending_volume"] = None
            current["equipment"].append(eq)
            current["_last_equipment_index"] = len(current["equipment"]) - 1
            pending_operator = None
            continue
        volume_matches = list(VOLUME_RE.finditer(line))
        if volume_matches:
            vol = volume_matches[0]
            value = to_float(vol.group(1))
            unit = (vol.group(2) or "").replace("м²", "м2")
            note = clean_value(vol.group(3))
            extra_notes = [clean_value(m.group(0)) for m in volume_matches[1:] if clean_value(m.group(0))]
            if extra_notes:
                note = "; ".join(x for x in [note, *extra_notes] if x)
            if pending_operator:
                current["performers"].append({
                    "operator_name": pending_operator,
                    "operator": pending_operator,
                    "volume": value,
                    "unit": unit,
                })
                pending_operator = None
                if note:
                    current["volume_note"] = note
                continue
            last_idx = current.get("_last_equipment_index")
            if isinstance(last_idx, int) and last_idx < len(current["equipment"]):
                eq = current["equipment"][last_idx]
                if eq.get("volume") is None:
                    eq["volume"] = value
                    eq["unit"] = unit
                    if current.get("volume") is None:
                        current["volume"] = value
                        current["unit"] = unit
                else:
                    if current.get("volume") is None:
                        current["volume"] = value
                        current["unit"] = unit
                    current["_pending_volume"] = {"volume": value, "unit": unit}
            else:
                if current.get("volume") is None:
                    current["volume"] = value
                    current["unit"] = unit
                current["_pending_volume"] = {"volume": value, "unit": unit}
            if note:
                current["volume_note"] = note
            continue
    finalize_work(current, works)
    return works


def parse_park(body: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in body.splitlines():
        if not line.strip():
            continue
        parsed = split_equipment_line(line)
        if not parsed:
            continue
        eq = parse_equipment_line(line)
        if not eq:
            continue
        tail = parsed[2]
        parts = [clean_value(p) for p in tail.split(";") if clean_value(p)]
        owner = None
        operator = None
        status = "unknown"
        comment = None
        for part in parts:
            parsed_status = parse_status(part)
            if parsed_status != "unknown":
                status = parsed_status
            elif looks_company(part):
                owner = part
            elif operator is None:
                operator = part
            else:
                comment = "; ".join(x for x in [comment, part] if x)
        eq["owner"] = owner
        eq["contractor_name"] = owner
        eq["operator_name"] = operator
        eq["operator"] = operator
        eq["status"] = status
        eq["comment"] = comment
        rows.append(eq)
    return rows


def parse_personnel(body: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in body.splitlines():
        m = re.match(r"([^:]+)\s*:\s*(\d+)", line.strip())
        if m:
            rows.append({"category": clean_value(m.group(1)), "count": int(m.group(2))})
    return rows


def parse_stockpiles(body: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in body.splitlines():
        if not line.strip():
            continue
        parts = [clean_value(p) for p in re.split(r"\s*[-–—]\s*", line, maxsplit=2)]
        if len(parts) < 3:
            continue
        name, pk_raw, rest = parts
        vol = VOLUME_RE.search(rest)
        material = name.replace("Накопитель", "").strip() or name
        pk = parse_pk_value(pk_raw)
        rows.append({
            "name": name,
            "material": material,
            "material_code": infer_material_code(material),
            "pk_raw_text": pk_raw,
            "pk_start": pk,
            "pk_end": pk,
            "rounded_pk": rounded_pk(pk),
            "volume": to_float(vol.group(1)) if vol else None,
            "unit": (vol.group(2) if vol else "м3").replace("м²", "м2"),
            "needs_create": None,
            "requires_user_confirmation": False,
        })
    return rows


def parse_pile_driving(body: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in body.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("%"):
            continue
        parts = [clean_value(p) for p in re.split(r"\s*-\s*", raw) if clean_value(p)]
        if not parts:
            continue
        joined = " ".join(parts)
        count_m = re.search(r"(\d+)\s*(?:шт|сва)", joined, re.I)
        field_code = parts[0] if parts else ""
        pk = next((parse_pk_value(p) for p in parts if parse_pk_value(p) is not None), None)
        kind_text = joined.lower()
        pile_kind = "test" if "проб" in kind_text else "main"
        rows.append({
            "field_code": field_code,
            "field_id": None,
            "pk_start": pk,
            "pk_end": pk,
            "pk_text": next((p for p in parts if "пк" in p.lower()), ""),
            "pile_kind": pile_kind,
            "count": int(count_m.group(1)) if count_m else None,
            "pile_type": "",
            "pile_length_label": "",
            "is_composite_complete": bool(re.search(r"(составн|готов)", joined, re.I)),
            "comment": raw,
        })
    return rows


def enrich_park_from_usage(
    park: list[dict[str, Any]],
    transport: list[dict[str, Any]],
    works: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    deduped: list[dict[str, Any]] = []
    for item in park:
        keys = equipment_identifier_keys(item)
        if not keys:
            deduped.append(item)
            continue
        existing = next((by_key[key] for key in keys if key in by_key), None)
        if existing:
            merge_equipment_row(existing, item)
        else:
            existing = item
            deduped.append(existing)
        for key in equipment_identifier_keys(existing):
            by_key[key] = existing
    park = deduped

    usage_rows: list[dict[str, Any]] = []
    for driver in transport:
        if equipment_identifier_keys(driver):
            usage_rows.append(driver)
    for work in works:
        usage_rows.extend(work.get("equipment") or [])

    for usage in usage_rows:
        keys = equipment_identifier_keys(usage)
        if not keys:
            continue
        existing = next((by_key[key] for key in keys if key in by_key), None)
        if existing:
            merge_equipment_row(existing, usage, infer_working=True)
            for key in equipment_identifier_keys(existing):
                by_key[key] = existing
            continue
        plate = clean_value(usage.get("plate_number") or usage.get("plate")) or None
        unit_number = clean_value(usage.get("unit_number")) or None
        row = {
            "equipment_type": usage.get("equipment_type") or "unknown",
            "brand_model": usage.get("brand_model"),
            "unit_number": unit_number,
            "plate_number": plate,
            "plate": plate,
            "operator_name": usage.get("operator_name") or usage.get("operator"),
            "operator": usage.get("operator_name") or usage.get("operator"),
            "owner": usage.get("owner"),
            "contractor_name": usage.get("contractor_name") or usage.get("owner"),
            "status": "working",
            "comment": "auto-added from work/transport block",
        }
        park.append(row)
        for key in equipment_identifier_keys(row):
            by_key[key] = row
    return park


def apply_special_work_defaults(works: list[dict[str, Any]]) -> None:
    note = "условная учетная единица: техника передана на направление ИССО, производительность не рассчитывается"
    for work in works:
        text = f"{work.get('constructive') or ''} {work.get('work_name') or ''}".lower()
        if "иссо" not in text or work.get("volume") is not None:
            continue
        work["volume"] = 1.0
        work["unit"] = "шт"
        work["volume_note"] = note
        work["work_type_code"] = work.get("work_type_code") or "SOIL_WORK"
        comments = work.setdefault("comments", [])
        if note not in comments:
            comments.append(note)


def parse_delivery_info(value: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for part in (value or "").split(";"):
        bits = [clean_value(x) for x in re.split(r"\s*[-–—]\s*", part)]
        if len(bits) < 3:
            continue
        vol = VOLUME_RE.search(bits[-1])
        material = bits[-2]
        rows.append({
            "source": bits[0],
            "material": material,
            "material_code": infer_material_code(material),
            "volume": to_float(vol.group(1)) if vol else None,
            "unit": (vol.group(2) if vol else "м3").replace("м²", "м2"),
            "human_only": True,
        })
    return rows


def parse_report_text(filename: str, raw_text: str) -> dict[str, Any]:
    text, comments = normalize_text(raw_text)
    header_text, sections = split_sections(text)
    header_source = "\n".join(part for part in [header_text, sections.get("ШАПКА", "")] if part.strip())
    header = parse_header(header_source)
    delivery = parse_delivery_info(header.get("delivery_info", ""))
    transport = parse_transport(sections.get("ПЕРЕВОЗКА", ""))
    main_works = parse_works(sections.get("ОСНОВНЫЕ РАБОТЫ", ""))
    aux_works = parse_works(sections.get("СОПУТСТВУЮЩИЕ РАБОТЫ", ""))
    apply_special_work_defaults(main_works)
    apply_special_work_defaults(aux_works)
    park = enrich_park_from_usage(parse_park(sections.get("ПАРК ТЕХНИКИ", "")), transport, main_works + aux_works)
    stockpiles = parse_stockpiles(sections.get("НАКОПИТЕЛИ", ""))
    piles = parse_pile_driving(
        sections.get("ЗАБИВКА СВАЙ", "")
        or sections.get("СВАЙНЫЕ РАБОТЫ", "")
        or sections.get("СВАИ", "")
    )
    warnings: list[str] = []
    for row in stockpiles:
        if row.get("needs_create") is None:
            warnings.append(f"Накопитель '{row.get('name')}' требует проверки по пикету перед импортом")
    for work in main_works + aux_works:
        if work.get("volume") is None:
            warnings.append(f"Работа '{work.get('work_name')}' ({work.get('constructive') or 'без конструктива'}) без объема: перед импортом нужно заполнить или удалить строку")
    return {
        "source": {"filename": filename, "chars": len(raw_text or ""), "lines": len((raw_text or "").splitlines())},
        "header": header,
        "human_summary": {
            "constructives": header.get("constructives", ""),
            "delivery_info": header.get("delivery_info", ""),
            "delivery_rows": delivery,
            "global_comments": comments,
        },
        "transport": transport,
        "main_works": main_works,
        "aux_works": aux_works,
        "park": park,
        "problems": sections.get("ПРОБЛЕМНЫЕ ВОПРОСЫ", "").strip(),
        "personnel": parse_personnel(sections.get("ПЕРСОНАЛ", "")),
        "stockpiles": stockpiles,
        "piles": piles,
        "warnings": warnings,
        "review_actions": {"stockpiles_to_create": []},
        "raw_text": raw_text,
        "_stub": False,
    }
