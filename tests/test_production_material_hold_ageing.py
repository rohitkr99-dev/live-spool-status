"""
Integration tests for production/ageing.py's Material/Hold Status
ageing reduction (2026-08-26 - see utils.material_hold_working_days_
lost() and merge.py -> apply_material_hold_ageing_reduction() for
the Projects-side twin of this logic). Production's build_spool_
records() never goes through MergeEngine.merge() at all, so this
needs its own, separately-verified wiring - same shared utils
function, different call site.
"""

from datetime import timedelta

import pandas as pd
import pytest

from production.ageing import build_spool_records
from utils import today


RULES = {
    "sb_max_spool_size": 2,
    "joint_threshold": 8,
    "loose_fallback_category": "loose",
    "zero_size_fallback_category": "le8_cs_ss",
    "material_groups": {"as": ["F11", "P11", "P22", "P91"]},
    "category_tracked_stages": {"loose": ["pdqc", "release_for_painting", "pdi_clearance"]},
    "target_days": {
        "le8_cs_ss": {
            "welding_finish": 3, "pdqc": 6, "release_for_painting": 10,
            "pdi_clearance": 15, "packed": 20,
        },
    },
    "welding_finish_fields": {
        "spool_size_field": "Spool Size", "inch_dia_field": "Inch Dia",
        "total_joints_field": "Total Joints", "material_field": "Material",
        "planned_start_field": "Planned Start", "siop_planned_start_field": "Start Date",
        "pdqc_field": "PDQC", "release_for_painting_field": "RFP",
        "pdi_clearance_field": "PDI", "packed_field": "Packing",
        "prod_order_release_field": "Prod Order Release",
        "line_history_joint_no_field": "Joint No",
        "line_history_frun_field": "Welding FRun Date",
        "welding_db_activity_date_field": "Activity Date",
        "weight_field": "Total Wt.", "quantity_field": "Total Qty",
        "surface_area_field": "Surface Area Out",
    },
}


def _fabrication_row(**overrides):
    row = {
        "Project Code": "P001", "Project Name": "Project One",
        "Drawing No": "D001", "Spool No": "S001",
        "Spool Size": 0, "Inch Dia": 0, "Total Joints": 5,
        "Material": "CS", "Prod Order Release": "2026-01-01",
        "PDQC": None, "RFP": None, "PDI": None, "Packing": None,
        "Total Wt.": 10, "Total Qty": 1, "Surface Area Out": 1,
        "Week": "W1",
    }
    row.update(overrides)
    return row


def _iso(days_ago: int) -> str:
    return (today() - timedelta(days=days_ago)).isoformat()


def _build(planned_start_iso, week, initial_week):
    fabrication_df = pd.DataFrame([_fabrication_row()])
    master_planning_df = pd.DataFrame([{
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Planned Start": planned_start_iso,
        "Week": week, "Initial Week Planned": initial_week,
    }])

    records, _excluded = build_spool_records(
        fabrication_df, master_planning_df,
        line_history_lookup={}, welding_db_lookup={}, rules=RULES,
    )
    return records[0]


def test_week_gap_reduces_current_age_days():
    no_gap = _build(_iso(60), "Week 12", "Week 12")
    with_gap = _build(_iso(60), "Week 12", "Week 10")

    assert with_gap.material_hold_days_lost > 0
    assert with_gap.current_age_days < no_gap.current_age_days
    assert with_gap.current_age_days == max(
        no_gap.current_age_days - with_gap.material_hold_days_lost, 0
    )


def test_no_week_gap_leaves_ageing_unchanged():
    record = _build(_iso(30), "Week 8", "Week 8")
    assert record.material_hold_days_lost == 0


def test_large_gap_floors_current_age_days_at_zero():
    record = _build(_iso(5), "Week 40", "Week 1")
    assert record.material_hold_days_lost > 0
    assert record.current_age_days == 0


def test_missing_week_columns_are_a_safe_no_op():
    fabrication_df = pd.DataFrame([_fabrication_row()])
    master_planning_df = pd.DataFrame([{
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Planned Start": _iso(30),
    }])
    records, _excluded = build_spool_records(
        fabrication_df, master_planning_df,
        line_history_lookup={}, welding_db_lookup={}, rules=RULES,
    )
    assert records[0].material_hold_days_lost == 0
