"""
Integration tests for production/ageing.py's Hold handling
(2026-08-21 - see hold_ledger.py). Builds a minimal but complete set
of inputs for build_spool_records() so it runs the real pipeline
code end to end, with an isolated Hold ledger passed in (never the
repo's real state/hold_tracking.json).
"""

from datetime import date, timedelta

import pandas as pd
import pytest

import hold_ledger
from config_loader import load_business_rules as _unused  # noqa: F401  (ensures config/ resolves from repo root)
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

KEY = "P001|D001|S001"


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


def _master_planning_row(planned_start_iso: str):
    return {
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Planned Start": planned_start_iso,
    }


def _iso(days_ago: int) -> str:
    return (today() - timedelta(days=days_ago)).isoformat()


def _build(fabrication_row, planned_start_iso, hold_store, tmp_path):
    ledger_path = tmp_path / "hold.json"
    hold_ledger.save_ledger(hold_store, ledger_path)

    fabrication_df = pd.DataFrame([fabrication_row])
    master_planning_df = pd.DataFrame([_master_planning_row(planned_start_iso)])

    records, _excluded = build_spool_records(
        fabrication_df,
        master_planning_df,
        line_history_lookup={},
        welding_db_lookup={},
        rules=RULES,
        hold_tracking_path=ledger_path,
    )
    return records[0]


def test_currently_on_hold_flag_set_from_ledger(tmp_path):
    store = {KEY: {"hold_periods": [{"hold_start": _iso(5), "hold_removed": None}]}}
    record = _build(_fabrication_row(), _iso(20), store, tmp_path)

    assert record.currently_on_hold is True


def test_open_hold_forces_is_delayed_false_even_if_overdue(tmp_path):
    # 20 working days back with no PDQC yet would normally blow past
    # the target_days (6) for pdqc and be flagged delayed.
    store = {KEY: {"hold_periods": [{"hold_start": _iso(3), "hold_removed": None}]}}
    record = _build(_fabrication_row(), _iso(20), store, tmp_path)

    assert record.current_stage == "welding_finish" or record.current_stage == "pdqc"
    assert record.is_delayed is False


def test_no_hold_can_still_be_delayed(tmp_path):
    record = _build(_fabrication_row(), _iso(20), {}, tmp_path)
    assert record.is_delayed is True


def test_closed_hold_reduces_current_age_days(tmp_path):
    no_hold = _build(_fabrication_row(), _iso(20), {}, tmp_path)

    store = {
        KEY: {"hold_periods": [
            {"hold_start": _iso(15), "hold_removed": _iso(10)}
        ]}
    }
    with_hold = _build(_fabrication_row(), _iso(20), store, tmp_path)

    assert with_hold.current_age_days < no_hold.current_age_days
    assert with_hold.current_age_days >= 0


def test_post_rfp_hold_reduces_pdi_clearance_stage_age(tmp_path):
    """
    Given by the person: a Hold that happens AFTER RFP (during Under
    Painting) must still be excluded, from the PDI Clearance stage's
    actual-days figure specifically - not just from current_age_days.
    """

    row = _fabrication_row(PDQC=_iso(18), RFP=_iso(15), PDI=_iso(2))
    no_hold = _build(row, _iso(20), {}, tmp_path)

    store = {
        KEY: {"hold_periods": [{"hold_start": _iso(12), "hold_removed": _iso(7)}]}
    }
    with_hold = _build(row, _iso(20), store, tmp_path)

    assert with_hold.stage_actual_days["pdi_clearance"] < no_hold.stage_actual_days["pdi_clearance"]
