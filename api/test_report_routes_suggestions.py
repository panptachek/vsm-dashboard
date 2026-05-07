#!/usr/bin/env python3
from __future__ import annotations

import sys
import types


class DummyRouter:
    def __init__(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return lambda fn: fn

    post = get
    patch = get
    delete = get


class DummyHTTPException(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class DummyBaseModel:
    pass


fastapi_stub = types.ModuleType("fastapi")
fastapi_stub.APIRouter = DummyRouter
fastapi_stub.File = lambda *args, **kwargs: None
fastapi_stub.HTTPException = DummyHTTPException
fastapi_stub.UploadFile = object
sys.modules.setdefault("fastapi", fastapi_stub)

pydantic_stub = types.ModuleType("pydantic")
pydantic_stub.BaseModel = DummyBaseModel
sys.modules.setdefault("pydantic", pydantic_stub)

main_stub = types.ModuleType("main")
main_stub.get_conn = lambda: None
main_stub.query = lambda sql, params=None: []
sys.modules.setdefault("main", main_stub)

xlsx_stub = types.ModuleType("xlsx_report_adapter")
xlsx_stub.xlsx_bytes_to_report_text = lambda blob: ""
sys.modules.setdefault("xlsx_report_adapter", xlsx_stub)

import reports_routes


SAMPLE = """
Дата - 04.05.2026
Смена - день
Участок - участок №1
|
===Основные работы===
-ОХ-
/Разработка выемки/
ПК ВСЖМ: ПК2654+50-ПК2655+20
V = 620 м3
|
-АД5-
/Устройство насыпи из песка/
ПК ВСЖМ: ПК2694+00
ПК АД: ПК51+20-ПК53+20
V = 1804,7 м3
===Сопутствующие работы===
-Работа на ИССО-
/Работа на ИССО/
ПК ВСЖМ: ПК2658
V = 1 шт
"""


def fake_query(sql: str, params=None) -> list[dict]:
    if "FROM work_type_aliases" in sql:
        return []
    if "FROM work_types" in sql:
        return [
            {"code": "EARTH_EXCAVATION", "name": "Разработка выемки", "default_unit": "м3", "work_group": "earthwork"},
            {"code": "EMBANKMENT_CONSTRUCTION", "name": "Устройство насыпи", "default_unit": "м3", "work_group": "earthwork"},
            {"code": "SOIL_WORK", "name": "Грунтовые работы", "default_unit": "м3", "work_group": "earthwork"},
        ]
    if "FROM materials" in sql:
        return [
            {"code": "SAND", "name": "Песок", "default_unit": "м3"},
            {"code": "SHPGS", "name": "ЩПГС", "default_unit": "м3"},
        ]
    if "FROM objects o" in sql:
        return [
            {
                "code": "MAIN_001",
                "label": "Основной ход, участок 1",
                "object_type_code": "MAIN",
                "constructive_code": "MAIN",
                "constructive_name": "Основной ход",
            },
            {
                "code": "MAIN_005",
                "label": "Основной ход, участок 5",
                "object_type_code": "MAIN",
                "constructive_code": "MAIN",
                "constructive_name": "Основной ход",
            },
            {
                "code": "VPD_005",
                "label": "Притрассовая дорога №5",
                "object_type_code": "TEMP_ROAD",
                "constructive_code": "VPD",
                "constructive_name": "Временные притрассовые дороги",
            },
            {
                "code": "STUFF_1",
                "label": "Сопутствующее участок №1",
                "object_type_code": "OTHER",
                "constructive_code": "STU",
                "constructive_name": "Сопутствующее",
            },
            {
                "code": "PLATFORM_PK2702",
                "label": "Устройство площадки и проезда к ИССО ПК2702",
                "object_type_code": "ISSO_ACCESS",
                "constructive_code": "STU",
                "constructive_name": "Сопутствующее",
            },
        ]
    if "FROM constructives" in sql:
        return [
            {"code": "MAIN", "name": "Основной ход"},
            {"code": "VPD", "name": "Временные притрассовые дороги"},
            {"code": "STU", "name": "Сопутствующее"},
        ]
    return []


def main() -> int:
    original_query = reports_routes.query
    reports_routes.query = fake_query
    reports_routes._ALIAS_CACHE = {"ts": 0.0, "by_kind": {}}
    reports_routes._REF_CACHE = {"ts": 0.0, "by_kind": {}}
    try:
        parsed = reports_routes._parse_report_text("sample.txt", SAMPLE)
        manual_search = reports_routes.reference_search(
            "object",
            "площадка №1 ПК2702",
            section="UCH_1",
            limit=5,
        )
    finally:
        reports_routes.query = original_query
        reports_routes._ALIAS_CACHE = {"ts": 0.0, "by_kind": {}}
        reports_routes._REF_CACHE = {"ts": 0.0, "by_kind": {}}

    first = parsed["main_works"][0]
    assert first["work_type_code"] == "EARTH_EXCAVATION"
    assert first["object_code"] == "MAIN_001"
    assert first["work_type_suggestions"][0]["code"] == "EARTH_EXCAVATION"
    assert first["object_suggestions"][0]["code"] == "MAIN_001"

    second = parsed["main_works"][1]
    assert second["work_type_code"] == "EMBANKMENT_CONSTRUCTION"
    assert second["object_code"] == "VPD_005"

    aux = parsed["aux_works"][0]
    assert aux["work_type_code"] == "SOIL_WORK"
    assert aux["object_code"] == "STUFF_1"
    assert manual_search[0]["code"] == "PLATFORM_PK2702"
    assert parsed["aliases"]["unresolved"] == 0
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
