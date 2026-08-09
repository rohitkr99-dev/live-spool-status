"""
tests/test_production_stage_display_days.py
---------------------------------------------------------
Covers src/production/summary.py -> _stage_display_days(): the
per-stage "days" columns shown in the Production dashboard's spool
table must never be negative (2026-08-08 decision, applies site-
wide - see docs/ageing-and-project-naming-conventions.md), even
when a later milestone's cumulative day count is chronologically
BEFORE the one before it (e.g. PDQC overridden earlier than the
recorded Welding Finish date - a real data-quality situation this
dashboard has to display gracefully, not a bug to reproduce).
"""

from datetime import date

from production.ageing import SpoolRecord
from production.summary import _stage_display_days


def _record(stage_actual_days, current_stage=None, current_age_days=None):
    return SpoolRecord(
        composite_key="P001|D001|S001",
        project_code="P001",
        drawing_no="D001",
        spool_no="S001",
        category_key="le8_cs_ss",
        planned_start=date(2026, 1, 1),
        stage_actual_days=stage_actual_days,
        current_stage=current_stage,
        current_age_days=current_age_days,
    )


def test_normal_increasing_cumulative_days_stay_positive():
    """Sanity check: the ordinary, well-ordered case is untouched."""

    record = _record({
        "welding_finish": 10,
        "pdqc": 15,
        "release_for_painting": 20,
        "pdi_clearance": 25,
        "packed": 30,
    })

    result = _stage_display_days(record)

    assert result == {
        "welding_finish": 10,
        "pdqc": 5,
        "release_for_painting": 5,
        "pdi_clearance": 5,
        "packed": 5,
    }


def test_out_of_order_milestone_clamps_to_zero_not_negative():
    """The screenshot bug: PDQC's cumulative day count (17) is LESS
    than Welding Finish's (51) -> the naive 17 - 51 = -34 must
    become 0, not stay negative."""

    record = _record({
        "welding_finish": 51,
        "pdqc": 17,
        "release_for_painting": 36,
        "pdi_clearance": 49,
        "packed": None,
    }, current_stage="packed", current_age_days=None)

    result = _stage_display_days(record)

    assert result["pdqc"] == 0
    assert all(v is None or v >= 0 for v in result.values())


def test_clamp_does_not_distort_the_next_stage():
    """previous_cumulative must keep tracking the TRUE (unclamped)
    cumulative value even after a clamp, so the stage AFTER the
    out-of-order one is still computed correctly against the real
    milestone date, not the clamped display value."""

    record = _record({
        "welding_finish": 51,
        "pdqc": 17,       # clamped to 0 for display
        "release_for_painting": 36,  # should be 36 - 17 = 19, not 36 - 0
        "pdi_clearance": None,
        "packed": None,
    })

    result = _stage_display_days(record)

    assert result["pdqc"] == 0
    assert result["release_for_painting"] == 19


def test_current_stage_running_count_also_clamps():

    record = _record({
        "welding_finish": 51,
        "pdqc": 17,  # earlier than welding_finish -> clamps to 0
    }, current_stage="release_for_painting", current_age_days=10)

    result = _stage_display_days(record)

    # current_age_days (10) - previous_cumulative (17, the TRUE PDQC
    # cumulative, unclamped) = -7 -> clamps to 0.
    assert result["release_for_painting"] == 0
    assert result["pdi_clearance"] is None
    assert result["packed"] is None


def test_no_stages_reached_yet_all_none():

    record = _record({}, current_stage="welding_finish", current_age_days=None)

    result = _stage_display_days(record)

    assert result["welding_finish"] is None
