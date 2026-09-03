"""
Unit tests for the 2026-09-03 fix: a spool currently in Rework has
its PDQC/RFP forced blank by the exact same rule that drives
currently_on_hold (src/rework_pdqc_rule.py treats Rework and Hold
identically for that purpose) - so it looked exactly like a genuine
"stuck at this stage" backlog entry, since only currently_on_hold was
ever excluded from src/production/backlog.py's charts. Confirmed
against the real Production Rework Data workbook (2026-09-03): 49 of
73 spools in the Release for Painting "Beyond 30 Days" bucket were
actually in Rework, not a real backlog - 3x the genuine number.

Covers both halves of the fix: build_backlog_chart() now excludes
Rework the same way it already excludes Hold (test_production_backlog
had no existing coverage of even the Hold exclusion before this file),
and build_rework_by_project_stage() (production/summary.py) shows the
excluded population instead of just dropping it, mirroring
build_hold_by_project_stage() exactly.
"""

from datetime import date, timedelta

from production.ageing import SpoolRecord
from production.backlog import build_backlog_chart
from production.summary import build_rework_by_project_stage


CATEGORY_META = {"le8_cs_ss": {"label": "≤8 Joints (CS/SS)"}}
CATEGORY_TRACKED_STAGES: dict = {}  # falls back to the standard 5 tracked stages

STAGE_LABELS = {
    "welding_finish": "Welding Finish", "pdqc": "PDQC",
    "release_for_painting": "Release for Painting",
    "pdi_clearance": "PDI Clearance", "packed": "Packed",
}


def _record(rework_latest_status=None, currently_on_hold=False, current_stage="welding_finish", planned_start_days_ago=60):
    return SpoolRecord(
        composite_key="P|D|S", project_code="P001", project_name="Project A",
        drawing_no="D001", spool_no="S001", category_key="le8_cs_ss",
        planned_start=date.today() - timedelta(days=planned_start_days_ago),
        current_stage=current_stage,
        target_days={"welding_finish": 5},
        currently_on_hold=currently_on_hold,
        rework_latest_status=rework_latest_status,
    )


# ---------------------------------------------------------------
# build_backlog_chart() - the actual bug: Rework spools must be
# excluded the same way Hold spools already are.
# ---------------------------------------------------------------

def test_rework_spool_excluded_from_backlog():
    records = [_record(rework_latest_status="Rework")]
    result = build_backlog_chart(records, "welding_finish", CATEGORY_META, CATEGORY_TRACKED_STAGES)
    assert result["rows"] == []
    assert all(b["spool_count"] == 0 for b in result["buckets"])


def test_hold_spool_still_excluded_from_backlog():
    records = [_record(currently_on_hold=True)]
    result = build_backlog_chart(records, "welding_finish", CATEGORY_META, CATEGORY_TRACKED_STAGES)
    assert result["rows"] == []


def test_accepted_spool_still_counted_in_backlog():
    records = [_record(rework_latest_status="Accept")]
    result = build_backlog_chart(records, "welding_finish", CATEGORY_META, CATEGORY_TRACKED_STAGES)
    assert len(result["rows"]) == 1
    beyond_30 = next(b for b in result["buckets"] if b["bucket"] == "Beyond 30 Days")
    assert beyond_30["spool_count"] == 1


def test_spool_never_in_rework_workbook_still_counted():
    """rework_latest_status is None (Composite Key not covered by that workbook this run) - unaffected."""
    records = [_record(rework_latest_status=None)]
    result = build_backlog_chart(records, "welding_finish", CATEGORY_META, CATEGORY_TRACKED_STAGES)
    assert len(result["rows"]) == 1


# ---------------------------------------------------------------
# build_rework_by_project_stage() - mirrors
# test_production_hold_summary.py's coverage of
# build_hold_by_project_stage() exactly, for the Rework population.
# ---------------------------------------------------------------

def test_only_rework_spools_are_counted():
    records = [
        _record(rework_latest_status="Rework", current_stage="pdqc"),
        _record(rework_latest_status="Accept", current_stage="pdi_clearance"),  # cleared - excluded
    ]
    result = build_rework_by_project_stage(records, STAGE_LABELS)
    assert result == {"Project A": {"PDQC": 1}}


def test_groups_by_project_and_stage_label():
    records = [
        _record(rework_latest_status="Rework", current_stage="pdqc"),
        _record(rework_latest_status="Rework", current_stage="pdqc"),
        _record(rework_latest_status="Rework", current_stage="release_for_painting"),
    ]
    result = build_rework_by_project_stage(records, STAGE_LABELS)
    assert result == {"Project A": {"PDQC": 2, "Release for Painting": 1}}


def test_no_rework_spools_returns_empty_dict():
    records = [_record(rework_latest_status="Accept")]
    assert build_rework_by_project_stage(records, STAGE_LABELS) == {}


def test_hold_status_is_not_counted_as_rework():
    """Hold and Rework stay distinguishable - a Hold spool never lands in the Rework chart."""
    records = [_record(rework_latest_status="Hold", currently_on_hold=True)]
    assert build_rework_by_project_stage(records, STAGE_LABELS) == {}
