#!/usr/bin/env python3
from __future__ import annotations

from report_text_parser import parse_equipment_line, parse_report_text


SAMPLE = """
%%Комментарий к заполнению
Дата - 04.05.2026
Смена - день
Участок - участок №1
Направление - ЗП
Конструктивы - АД9, ОХ, стартовая площадка участка усиления 5.2
|
Информация по завозу: Карьер Васильки - песок - 666 м3; Карьер Миголощи - ЩПГС - 999 м3
|
===Перевозка===
|
ФИО: Степанов А. А.
Самосвал FAW (б/н 42; г/н 913); ЖДС
/песок/
карьер Васильки → АД5 ПК51+20-ПК53+20
111,1 м3 / 6 рейс
|
===Основные работы===
-ОХ-
/Разработка выемки/
ПК ВСЖМ: ПК2654+50-ПК2655+20
ПК АД:
ФИО: Грошин А. В.
Экскаватор CAT 330 (б/н ; г/н 7439); ЖДС
V = 620 м3
|
-АД5-
/Устройство насыпи из песка/
ПК ВСЖМ: ПК2694+00
ПК АД: ПК51+20-ПК53+20
ФИО: Анипченко В. Е.
Бульдозер SEM (б/н ; г/н 6947); ЖДС
V = 1804,7 м3
===Сопутствующие работы===
|
-Работа на ИССО-
|
/Работа на ИССО/
ПК ВСЖМ: ПК2658
ПК АД: ПК12+20
ФИО: Пулатов Ю. З.
Экскаватор HITACHI330 (б/н ; г/н 0337); ЖДС
===Парк техники===
|
Самосвал FAW (б/н ; г/н 256); ООО "Алмаз"
Самосвал FAW (б/н ; г/н 256); ООО "Алмаз"
Бульдозер SEM (б/н ; г/н 6947); Анипченко В. Е.; в работе;
|
===Персонал===
ДР: 3
ИТР: 4
|
===Накопители===
Накопитель песка АД13 - ПК2715+00 -1000 м3
Накопитель ЩПГС - ПК2687+00 - 2000 м3
|
===Забивка свай===
5_1 Н - ПК2655+73.50 - основные - 4 шт - составная готова
"""


def assert_equipment_number_variants() -> None:
    samples = [
        "Самосвал FAW (бортовой 42; госномер А123ВС178); ЖДС",
        "Самосвал FAW б/н 42 г/н А123ВС178; ЖДС",
        "Самосвал FAW бортовой 42 госномер А123ВС178; ЖДС",
        "Самосвал FAW; бортовой 42; госномер А123ВС178; ЖДС",
    ]
    for line in samples:
        parsed = parse_equipment_line(line)
        assert parsed is not None, line
        assert parsed["unit_number"] == "42", line
        assert parsed["plate_number"] == "А123ВС178", line
        assert parsed["owner"] == "ЖДС", line
    unlabeled = parse_equipment_line("Самосвал FAW (913); ЖДС")
    assert unlabeled is not None
    assert unlabeled["unit_number"] == "913"
    assert unlabeled["plate_number"] is None
    no_semicolon = parse_equipment_line("Коток грунтовый SANY (3581) ЖДС")
    assert no_semicolon is not None
    assert no_semicolon["equipment_type"] == "каток"
    assert no_semicolon["unit_number"] == "3581"
    assert no_semicolon["owner"] == "ЖДС"


def assert_work_split_by_performer_volumes() -> None:
    text = """
Дата - 07.05.2026
Смена - день
Участок - участок №1
===Основные работы===
-ОХ-
/Устройство насыпи из песка/
ПК ВСЖМ: ПК2654+50-ПК2655+20
ФИО: Иванов И. И.
V = 40 м3
ФИО: Петров П. П.
V = 60 м3
"""
    parsed = parse_report_text("performers.txt", text)
    rows = parsed["main_works"]
    assert len(rows) == 2
    assert [row["operator_name"] for row in rows] == ["Иванов И. И", "Петров П. П"]
    assert [row["volume"] for row in rows] == [40.0, 60.0]
    assert not parsed["warnings"]


def assert_work_split_by_equipment_volume_variants() -> None:
    text = """
Дата - 07.05.2026
Смена - день
Участок - участок №1
===Основные работы===
-ОХ-
/Устройство насыпи из песка/
ПК ВСЖМ: ПК2654+50-ПК2655+20
ФИО: Иванов И. И.
Бульдозер CAT бортовой D12 госномер А123ВС178; ЖДС
V = 40 м3
ФИО: Петров П. П.
Бульдозер SEM (бортовой D13; госномер В456ОР178); Алмаз
V = 60 м3
"""
    parsed = parse_report_text("equipment-performers.txt", text)
    rows = parsed["main_works"]
    assert len(rows) == 2
    assert [row["operator_name"] for row in rows] == ["Иванов И. И", "Петров П. П"]
    assert [row["unit_number"] for row in rows] == ["D12", "D13"]
    assert [row["plate_number"] for row in rows] == ["А123ВС178", "В456ОР178"]
    assert [row["owner"] for row in rows] == ["ЖДС", "Алмаз"]
    assert [row["volume"] for row in rows] == [40.0, 60.0]


def assert_real_report_volume_and_operator_variants() -> None:
    text = """
Дата - 06.05.2026
Смена - день
Участок - участок №1
===Основные работы===
-ОХ-
/Разработка выемки грунта с 2-й перекидкой/
ПК ВСЖМ: ПК2654+55-ПК2655+20
V = 1150 м3
ФИО: Вернигоров Р. В.
Бульдозер SHANTUY (7032); ЖДС
V = 720 м3
ФИО: Вишерский О. В.
Бульдозер SEM (3944); ЖДС
ФИО: Матвеев Д. Е.
Экскаватор CAT 330 (3588); ЖДС
|
/Уплотнение насыпи из песка/
S = 1000 м2
Ф.И.О Бадаев Р. А.
Коток грунтовый SANY (3581) ЖДС
"""
    parsed = parse_report_text("real-variants.txt", text)
    rows = parsed["main_works"]
    assert len(rows) == 4
    assert [rows[0]["operator_name"], rows[1]["operator_name"]] == ["Вернигоров Р. В", "Вишерский О. В"]
    assert [rows[0]["volume"], rows[1]["volume"]] == [1150.0, 720.0]
    assert rows[2]["operator_name"] == "Матвеев Д. Е"
    assert rows[2]["volume"] is None
    assert rows[3]["operator_name"] == "Бадаев Р. А"
    assert rows[3]["vehicle"] == "каток грунтовый SANY"
    assert any("Разработка выемки грунта" in warning and "без объема" in warning for warning in parsed["warnings"])


def assert_section_7_8_report_variants() -> None:
    text = """
===Шапка===
Дата - 06.05.2026
Смена - ночь
Участок - участок №8
Направление - ЗП
Конструктивы - АД 4.8, АД 12
===Перевозка===
-Исаков А.А.-
Самосвал FAW 806 (с527хв27); ЖДС
/песок/
Боковой резерв → АД 4.8
560 м3 / 35 рейсов
===Основные работы===
-АД 4.9-
/Устройство основания земляного полотна/
ПК ВСЖМ: ПК3286+70 – ПК3287+00
Фрелих М.
Экскаватор LonKing 336 845 (27ха6735); ЖДС
1200 м3 (непригодный грунт)
"""
    parsed = parse_report_text("section-8-night.txt", text)
    assert parsed["header"]["report_date"] == "2026-05-06"
    assert parsed["header"]["shift"] == "night"
    assert parsed["header"]["section_code"] == "UCH_8"
    assert len(parsed["transport"]) == 1
    assert parsed["transport"][0]["driver"] == "Исаков А.А"
    assert parsed["transport"][0]["unit_number"] == "806"
    assert parsed["transport"][0]["plate_number"] == "с527хв27"
    assert parsed["transport"][0]["trips"][0]["trips"] == 35
    work = parsed["main_works"][0]
    assert work["operator_name"] == "Фрелих М."
    assert work["volume"] == 1200.0
    assert work["unit_number"] == "845"
    assert work["plate_number"] == "27ха6735"

    text_7 = """
Дата- 06.05.2026 г
Смена - ночь
Участок-участок №7
Направление – ЗП
Конструктивы – АД4.8
Информация по завозу: Карьер Великий – песок – 1199,9 м3
===Перевозка===
ФИО: Голиков
Самосвал FAW (б/н 709); ЖДС
/песок/
Карьер-> свайная площадка ПК ВСЖМ: 3230-3231
51,2 м3 / 3 рейс
===Основные работы===
-АД4.8-
/Устройство ДСО/
ФИО: Чирков Е.
БульдозерSEM 826 (г/н 3448ха27); ЖДС
V = 837,2 м3
"""
    parsed_7 = parse_report_text("section-7-night.txt", text_7)
    assert parsed_7["header"]["direction"] == "ЗП"
    assert parsed_7["human_summary"]["delivery_rows"][0]["volume"] == 1199.9
    assert parsed_7["transport"][0]["trips"][0]["trips"] == 3
    assert parsed_7["main_works"][0]["vehicle"] == "бульдозер SEM 826"
    assert parsed_7["main_works"][0]["plate_number"] == "3448ха27"


def main() -> int:
    assert_equipment_number_variants()
    assert_work_split_by_performer_volumes()
    assert_work_split_by_equipment_volume_variants()
    assert_real_report_volume_and_operator_variants()
    assert_section_7_8_report_variants()
    parsed = parse_report_text("sample.txt", SAMPLE)
    assert parsed["header"]["report_date"] == "2026-05-04"
    assert parsed["header"]["shift"] == "day"
    assert parsed["header"]["section_code"] == "UCH_1"
    assert "АД9" in parsed["human_summary"]["constructives"]
    assert "Карьер Васильки" in parsed["human_summary"]["delivery_info"]
    assert len(parsed["transport"]) == 1
    assert parsed["transport"][0]["unit_number"] == "42"
    assert parsed["transport"][0]["plate_number"] == "913"
    assert parsed["transport"][0]["trips"][0]["material_code"] == "SAND"
    assert len(parsed["main_works"]) == 2
    assert parsed["main_works"][1]["work_type_code"] == "EMBANKMENT_CONSTRUCTION"
    assert len(parsed["aux_works"]) == 1
    assert parsed["aux_works"][0]["work_type_code"] == "SOIL_WORK"
    assert parsed["aux_works"][0]["volume"] == 1.0
    assert parsed["aux_works"][0]["unit"] == "шт"
    assert parsed["park"][0]["status"] == "unknown"
    assert parsed["park"][1]["status"] == "working"
    assert [row.get("plate_number") for row in parsed["park"]].count("256") == 1
    assert not any("Работа на ИССО" in warning for warning in parsed["warnings"])
    assert len(parsed["personnel"]) == 2
    assert len(parsed["stockpiles"]) == 2
    assert parsed["stockpiles"][0]["rounded_pk"] == 2715
    assert len(parsed["piles"]) == 1
    assert parsed["piles"][0]["field_code"] == "5_1 Н"
    assert parsed["piles"][0]["count"] == 4
    assert parsed["piles"][0]["is_composite_complete"] is True
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
