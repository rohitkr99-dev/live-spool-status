"""
tests/test_production_classify.py
---------------------------------
Covers the two riskiest, most-easily-miscoded rules in the
Production dashboard: which of the 5 categories a spool falls into
(src/production/classify.py) and which of the 5 Welding Finish
rules applies (src/production/welding_finish.py). Both were
confirmed against real DPR/Weekly Planning/Line History data with
the project owner - see docs/production_dashboard.md.
"""

from datetime import date

import pandas as pd

from production.classify import classify_category
from production.welding_finish import (
    LineHistoryInfo,
    build_line_history_lookup,
    build_welding_db_lookup,
    determine_welding_finish,
)

FIELDS = {
    "spool_size_field": "Spool Size",
    "inch_dia_field": "Inch Dia",
    "total_joints_field": "Total Joints",
    "material_field": "Material",
}

RULES = {
    "sb_max_spool_size": 2,
    "zero_size_fallback_category": "le8_cs_ss",
    "joint_threshold": 8,
    "material_groups": {"AS": ["F11", "P11", "P22", "P91"]},
}


def _row(spool_size=None, inch_dia=None, material="CS", total_joints=None):
    return {
        "Spool Size": spool_size,
        "Inch Dia": inch_dia,
        "Material": material,
        "Total Joints": total_joints,
    }


# ---------------------------------------------------------------
# classify_category
# ---------------------------------------------------------------

def test_zero_size_and_zero_dia_falls_back_to_category_1():
    row = _row(spool_size=0, inch_dia=0, material="P91", total_joints=20)
    assert classify_category(row, RULES, FIELDS) == "le8_cs_ss"


def test_blank_size_and_blank_dia_also_falls_back():
    row = _row(spool_size=None, inch_dia=None, material="F11", total_joints=12)
    assert classify_category(row, RULES, FIELDS) == "le8_cs_ss"


def test_small_spool_size_is_sb_regardless_of_material():
    row = _row(spool_size=1.5, inch_dia=1.5, material="P91", total_joints=15)
    assert classify_category(row, RULES, FIELDS) == "sb"


def test_spool_size_exactly_at_threshold_is_sb():
    row = _row(spool_size=2, inch_dia=2, material="CS", total_joints=3)
    assert classify_category(row, RULES, FIELDS) == "sb"


def test_spool_size_just_above_threshold_is_not_sb():
    row = _row(spool_size=2.5, inch_dia=2.5, material="CS", total_joints=3)
    assert classify_category(row, RULES, FIELDS) == "le8_cs_ss"


def test_cs_with_few_joints():
    row = _row(spool_size=8, inch_dia=8, material="CS", total_joints=5)
    assert classify_category(row, RULES, FIELDS) == "le8_cs_ss"


def test_ss_and_duplex_share_the_cs_ss_bucket():
    row_ss = _row(spool_size=8, inch_dia=8, material="SS", total_joints=10)
    row_duplex = _row(spool_size=8, inch_dia=8, material="DUPLEX", total_joints=10)
    assert classify_category(row_ss, RULES, FIELDS) == "gt8_cs_ss"
    assert classify_category(row_duplex, RULES, FIELDS) == "gt8_cs_ss"


def test_as_materials_over_threshold():
    for material in ["F11", "P11", "P22", "P91"]:
        row = _row(spool_size=8, inch_dia=8, material=material, total_joints=9)
        assert classify_category(row, RULES, FIELDS) == "gt8_as"


def test_as_materials_at_or_under_threshold():
    row = _row(spool_size=8, inch_dia=8, material="P22", total_joints=8)
    assert classify_category(row, RULES, FIELDS) == "le8_as"


def test_blank_total_joints_defaults_to_le8():
    row = _row(spool_size=8, inch_dia=8, material="CS", total_joints=None)
    assert classify_category(row, RULES, FIELDS) == "le8_cs_ss"


# ---------------------------------------------------------------
# determine_welding_finish
# ---------------------------------------------------------------

def test_all_frun_filled_uses_max_date():
    lh = {"CK1": LineHistoryInfo(all_frun_filled=True, max_frun_date=date(2026, 3, 10))}
    result, status = determine_welding_finish("CK1", None, lh, {})
    assert result == date(2026, 3, 10)
    assert status == "finished_frun"


def test_partial_frun_with_pdqc_uses_pdqc_minus_one():
    lh = {"CK1": LineHistoryInfo(all_frun_filled=False, max_frun_date=date(2026, 3, 5))}
    result, status = determine_welding_finish("CK1", date(2026, 3, 12), lh, {})
    assert result == date(2026, 3, 11)
    assert status == "finished_via_pdqc"


def test_partial_frun_no_pdqc_is_in_progress():
    lh = {"CK1": LineHistoryInfo(all_frun_filled=False, max_frun_date=None)}
    result, status = determine_welding_finish("CK1", None, lh, {})
    assert result is None
    assert status == "in_progress"


def test_not_in_line_history_but_pdqc_present_uses_welding_db():
    wdb = {"CK2": date(2026, 4, 1)}
    result, status = determine_welding_finish("CK2", date(2026, 4, 5), {}, wdb)
    assert result == date(2026, 4, 1)
    assert status == "finished_via_weldingdb"


def test_not_in_line_history_pdqc_present_no_welding_db_falls_back():
    result, status = determine_welding_finish("CK3", date(2026, 4, 5), {}, {})
    assert result == date(2026, 4, 4)
    assert status == "finished_via_pdqc_fallback"


def test_not_in_line_history_no_pdqc_is_not_started():
    result, status = determine_welding_finish("CK4", None, {}, {})
    assert result is None
    assert status == "not_started"


def test_build_line_history_lookup_filters_blank_joint_no():
    df = pd.DataFrame({
        "Project Code": ["P1", "P1", "P1"],
        "Drawing No": ["D1", "D1", "D1"],
        "Spool No": ["S1", "S1", "S1"],
        "Joint No": ["1", "2", None],
        "Welding FRun Date": [pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-05"), None],
    })
    lookup = build_line_history_lookup(df, "Joint No", "Welding FRun Date")
    assert "P1|D1|S1" in lookup
    info = lookup["P1|D1|S1"]
    assert info.all_frun_filled is True
    assert info.max_frun_date == date(2026, 1, 5)


def test_build_welding_db_lookup_takes_max_activity_date():
    df = pd.DataFrame({
        "Project Code": ["P1", "P1"],
        "Drawing No": ["D1", "D1"],
        "Spool No": ["S1", "S1"],
        "Activity Date": [pd.Timestamp("2026-02-01"), pd.Timestamp("2026-02-09")],
    })
    lookup = build_welding_db_lookup(df, "Activity Date")
    assert lookup["P1|D1|S1"] == date(2026, 2, 9)


# ---------------------------------------------------------------
# build_spool_records - Planned Start / SIOP fallback
# ---------------------------------------------------------------

def _minimal_rules():
    return {
        "sb_max_spool_size": 2,
        "zero_size_fallback_category": "le8_cs_ss",
        "joint_threshold": 8,
        "material_groups": {"AS": ["F11", "P11", "P22", "P91"]},
        "target_days": {
            "le8_cs_ss": {"welding_finish": 5, "pdqc": 6, "release_for_painting": 10,
                          "pdi_clearance": 14, "packed": 15},
        },
        "welding_finish_fields": {
            "spool_size_field": "Spool Size",
            "inch_dia_field": "Inch Dia",
            "total_joints_field": "Total Joints",
            "material_field": "Material",
            "planned_start_field": "Planned Start",
            "siop_planned_start_field": "Start Date",
            "pdqc_field": "PDQC",
            "release_for_painting_field": "RFP",
            "pdi_clearance_field": "PDI",
            "packed_field": "Packing",
            "prod_order_release_field": "Prod Order Release",
            "quantity_field": "Total Qty",
            "weight_field": "Total Wt",
            "surface_area_field": "Surface Area Out",
        },
    }


def test_siop_fills_gap_but_never_overrides_weekly_planned_start():
    from production.ageing import build_spool_records

    fabrication_df = pd.DataFrame([
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1",
         "Material": "CS", "Spool Size": 8, "Inch Dia": 8, "Total Joints": 3,
         "Prod Order Release": "2026-01-01",
         "PDQC": None, "RFP": None, "PDI": None, "Packing": None},
        {"Project Code": "P1", "Drawing No": "D2", "Spool No": "S2",
         "Material": "CS", "Spool Size": 8, "Inch Dia": 8, "Total Joints": 3,
         "Prod Order Release": "2026-01-01",
         "PDQC": None, "RFP": None, "PDI": None, "Packing": None},
        {"Project Code": "P1", "Drawing No": "D3", "Spool No": "S3",
         "Material": "CS", "Spool Size": 8, "Inch Dia": 8, "Total Joints": 3,
         "Prod Order Release": "2026-01-01",
         "PDQC": None, "RFP": None, "PDI": None, "Packing": None},
        {"Project Code": "P1", "Drawing No": "D4", "Spool No": "S4",
         "Material": "CS", "Spool Size": 8, "Inch Dia": 8, "Total Joints": 3,
         "Prod Order Release": None,
         "PDQC": None, "RFP": None, "PDI": None, "Packing": None},
    ])

    # Weekly workbook only has S1.
    master_planning_df = pd.DataFrame([
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1",
         "Planned Start": pd.Timestamp("2026-01-01")},
    ])

    # SIOP has both S1 (should be ignored - Weekly already covers it)
    # and S2 (should fill the gap). S3 is in neither.
    siop_df = pd.DataFrame([
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1",
         "Start Date": pd.Timestamp("2026-06-01")},
        {"Project Code": "P1", "Drawing No": "D2", "Spool No": "S2",
         "Start Date": pd.Timestamp("2026-02-15")},
    ])

    records, excluded_not_released = build_spool_records(
        fabrication_df, master_planning_df, {}, {}, _minimal_rules(),
        siop_planned_df=siop_df,
    )
    by_spool = {r.spool_no: r for r in records}

    assert excluded_not_released == 1
    assert "S4" not in by_spool  # no Prod Order Release -> excluded entirely

    assert by_spool["S1"].planned_start == date(2026, 1, 1)
    assert by_spool["S1"].planned_start_source == "weekly"

    assert by_spool["S2"].planned_start == date(2026, 2, 15)
    assert by_spool["S2"].planned_start_source == "siop"

    assert by_spool["S3"].planned_start is None
    assert by_spool["S3"].planned_start_source is None


# ---------------------------------------------------------------
# _stage_display_days - individual (incremental) durations
# ---------------------------------------------------------------

def test_stage_display_days_are_individual_not_cumulative():
    from production.summary import _stage_display_days
    from production.ageing import SpoolRecord

    # Mirrors the real spool the project owner flagged: cumulative
    # actual days were 16 / 16 / 18 / 100 / 105 - individual gaps
    # should be 16 / 0 / 2 / 82 / 5.
    record = SpoolRecord(
        composite_key="P1|D1|S1", project_code="P1", drawing_no="D1", spool_no="S1",
        category_key="le8_cs_ss", planned_start=date(2025, 9, 29),
        stage_actual_days={
            "welding_finish": 16, "pdqc": 16, "release_for_painting": 18,
            "pdi_clearance": 100, "packed": 105,
        },
        current_stage=None,
    )
    days = _stage_display_days(record)
    assert days == {
        "welding_finish": 16, "pdqc": 0, "release_for_painting": 2,
        "pdi_clearance": 82, "packed": 5,
    }


def test_stage_display_days_current_stage_is_individual_running_count():
    from production.summary import _stage_display_days
    from production.ageing import SpoolRecord

    record = SpoolRecord(
        composite_key="P1|D1|S1", project_code="P1", drawing_no="D1", spool_no="S1",
        category_key="le8_cs_ss", planned_start=date(2025, 9, 29),
        stage_actual_days={
            "welding_finish": 16, "pdqc": 16, "release_for_painting": None,
            "pdi_clearance": None, "packed": None,
        },
        current_stage="release_for_painting",
        current_age_days=25,  # Today - Planned Start = 25
    )
    days = _stage_display_days(record)
    # release_for_painting is running since PDQC's cumulative day (16):
    # 25 - 16 = 9. Nothing after it is reached yet.
    assert days == {
        "welding_finish": 16, "pdqc": 0, "release_for_painting": 9,
        "pdi_clearance": None, "packed": None,
    }


def test_stage_display_days_no_planned_start_is_all_blank():
    from production.summary import _stage_display_days
    from production.ageing import SpoolRecord

    record = SpoolRecord(
        composite_key="P1|D1|S1", project_code="P1", drawing_no="D1", spool_no="S1",
        category_key="le8_cs_ss", planned_start=None,
    )
    days = _stage_display_days(record)
    assert all(v is None for v in days.values())
