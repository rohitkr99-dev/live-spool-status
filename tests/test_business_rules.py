"""
Unit tests for business_rules.py
"""

import pandas as pd
import pytest

from business_rules import BusinessRuleEngine


@pytest.fixture
def engine():
    """Create a Business Rule Engine instance."""
    return BusinessRuleEngine()


def _row(**overrides):
    """
    Build a single spool row with sensible blank defaults,
    overridden by whatever the test needs.
    """

    base = {
        "Project Code": "P001",
        "Drawing No": "D001",
        "Spool No": "S001",
        "Prod Order Release": "2026-01-01",
        "Planned Start": None,
        "First Fit-Up": None,
        "First Welding": None,
        "PDQC": None,
        "RFP": None,
        "PDI": None,
        "Packing": None,
        "Dispatch": None,
    }
    base.update(overrides)
    return pd.Series(base)


# -----------------------------------------------------
# Planned flag
# -----------------------------------------------------

def test_planned_flag_true_when_planned_start_present(engine):

    row = _row(**{"Planned Start": "2026-01-01"})

    assert engine.determine_planned_flag(row) is True


def test_planned_flag_false_when_planned_start_blank(engine):

    row = _row()

    assert engine.determine_planned_flag(row) is False


def test_planned_flag_true_when_packed_but_no_planned_start(engine):
    """
    A spool with no Planned Start but a Packing date has clearly
    already been fabricated - it should count as Planned, not
    Unplanned, even though it's missing from the planning sheet.
    """

    row = _row(**{"Packing": "2026-02-01"})

    assert engine.determine_planned_flag(row) is True


def test_planned_flag_true_when_dispatched_but_no_planned_start(engine):

    row = _row(**{"Dispatch": "2026-02-05"})

    assert engine.determine_planned_flag(row) is True


# -----------------------------------------------------
# First Activity Date
# -----------------------------------------------------

def test_first_activity_date_none_when_not_started(engine):

    row = _row()

    assert engine.determine_first_activity_date(row) is None


def test_first_activity_date_picks_earliest_of_fitup_and_welding(engine):

    row = _row(**{
        "First Fit-Up": "2026-02-10",
        "First Welding": "2026-02-05",
    })

    result = engine.determine_first_activity_date(row)

    assert result.isoformat() == "2026-02-05"


def test_first_activity_date_uses_whichever_field_is_present(engine):

    row = _row(**{"First Fit-Up": "2026-02-10"})

    result = engine.determine_first_activity_date(row)

    assert result.isoformat() == "2026-02-10"


# -----------------------------------------------------
# Production Order Release
# -----------------------------------------------------

def test_blank_prod_order_release_shows_not_released(engine):

    row = _row(**{"Prod Order Release": None})

    result = engine.evaluate_row(row)

    assert result.current_stage == "Production Order Not Released"
    assert result.next_stage == "Fit-Up"
    assert result.completed is False
    assert result.status_message == "Production Order Not Released"


def test_blank_prod_order_release_overrides_other_progress(engine):
    """
    Even if later stages already have dates, a blank Prod Order
    Release still reports "Production Order Not Released" - this
    check happens before anything else.
    """

    row = _row(**{
        "Prod Order Release": None,
        "First Fit-Up": "2026-02-01",
        "Packing": "2026-02-25",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Production Order Not Released"


def test_filled_prod_order_release_applies_existing_rules(engine):

    row = _row(**{"Prod Order Release": "2026-01-01"})

    result = engine.evaluate_row(row)

    assert result.current_stage == "Fit-Up"


# -----------------------------------------------------
# Current Stage / Next Stage / Completed / Status Message
# -----------------------------------------------------

def test_nothing_started_shows_fabrication_yet_to_start(engine):

    row = _row()

    result = engine.evaluate_row(row)

    assert result.current_stage == "Fit-Up"
    assert result.next_stage == "Welding"
    assert result.completed is False
    assert result.status_message == "Fabrication Yet to Start"


def test_fitup_done_welding_pending_requires_both(engine):
    """
    Fit-Up and Welding are two separate required milestones.
    Completing Fit-Up alone must not advance past Welding.
    """

    row = _row(**{"First Fit-Up": "2026-02-01"})

    result = engine.evaluate_row(row)

    assert result.current_stage == "Welding"
    assert result.status_message == "Waiting for Welding"
    assert result.completed is False


def test_latest_filled_stage_precedes_earlier_gap(engine):
    """
    PDQC complete, RFP blank, but PDI/Packing (later stages) are
    filled in. Per the latest-stage-precedes-the-previous-one rule,
    RFP counts as "reached" because a later stage already has a
    date - Current Stage advances to the first stage genuinely
    without a date anywhere at or after it (here, Dispatch), instead
    of getting stuck reporting "waiting for RFP".

    Completed is a separate, decoupled check (Packing has a date),
    so it is True here regardless.
    """

    row = _row(**{
        "First Fit-Up": "2026-02-01",
        "First Welding": "2026-02-02",
        "PDQC": "2026-02-10",
        "PDI": "2026-02-20",
        "Packing": "2026-02-25",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Dispatch"
    assert result.next_stage is None
    assert result.status_message == "Waiting for Dispatch"
    assert result.completed is True


def test_dispatch_filled_with_earlier_gap_is_treated_as_dispatched(engine):
    """
    A Dispatch date with a blank Packing date must be treated as
    Dispatched (fully reached), not "waiting for Packing".
    """

    row = _row(**{
        "First Fit-Up": "2026-02-01",
        "First Welding": "2026-02-02",
        "PDQC": "2026-02-10",
        "RFP": "2026-02-15",
        "PDI": "2026-02-20",
        "Dispatch": "2026-02-28",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Completed"
    assert result.next_stage is None
    assert result.status_message == "Spool Dispatched"


def test_packing_done_dispatch_pending_is_completed_but_shows_dispatch(engine):
    """
    Completed is gated on Packing only. Dispatch is tracked after
    Packing but does not block the Completed flag.
    """

    row = _row(**{
        "First Fit-Up": "2026-02-01",
        "First Welding": "2026-02-02",
        "PDQC": "2026-02-10",
        "RFP": "2026-02-15",
        "PDI": "2026-02-20",
        "Packing": "2026-02-25",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Dispatch"
    assert result.next_stage is None
    assert result.completed is True
    assert result.status_message == "Waiting for Dispatch"


def test_dispatch_filled_without_packing_is_still_completed(engine):
    """
    config/business_rules.json -> completed.also_completed_if_any_filled
    includes "Dispatch": a spool with a Dispatch date but a blank
    Packing date (a DPR data-entry gap) is still counted Completed,
    not just spools where Packing itself is filled.
    """

    row = _row(**{
        "First Fit-Up": "2026-02-01",
        "First Welding": "2026-02-02",
        "PDQC": "2026-02-10",
        "RFP": "2026-02-15",
        "PDI": "2026-02-20",
        "Dispatch": "2026-02-28",
    })

    result = engine.evaluate_row(row)

    assert result.completed is True


def test_all_stages_complete_marks_completed(engine):

    row = _row(**{
        "First Fit-Up": "2026-02-01",
        "First Welding": "2026-02-02",
        "PDQC": "2026-02-10",
        "RFP": "2026-02-15",
        "PDI": "2026-02-20",
        "Packing": "2026-02-25",
        "Dispatch": "2026-02-28",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Completed"
    assert result.next_stage is None
    assert result.completed is True
    assert result.status_message == "Spool Dispatched"


# -----------------------------------------------------
# Line History Sheet override (Fit-Up / Welding / PDQC)
# -----------------------------------------------------

def test_line_history_absent_uses_existing_logic_unchanged(engine):
    """
    No "Line History Stage" value for this spool (key not in the
    sheet, or no non-blank Joint No. rows there) - Rule 1 alone
    applies, exactly as before.
    """

    row = _row(**{"First Fit-Up": "2026-02-01"})

    result = engine.evaluate_row(row)

    assert result.current_stage == "Welding"


def test_line_history_advances_fitup_when_dpr_fields_are_blank(engine):
    """
    Line History Sheet shows every joint fit-up but not yet fully
    welded ("Welding"), while the DPR's own First Fit-Up/First
    Welding fields haven't been filled in yet - the joint-level data
    still correctly advances Current Stage to Welding (catching a
    DPR update that hasn't happened yet).
    """

    row = _row(**{"Line History Stage": "Welding"})

    result = engine.evaluate_row(row)

    assert result.current_stage == "Welding"


def test_line_history_cannot_hold_back_a_spool_dpr_already_dispatched(engine):
    """
    Regression test for the real bug report: a spool with a genuine
    gap in the Line History Sheet (e.g. one repair/re-weld joint
    missing its Weld FitUp Date) must NOT be pinned at Fit-Up when
    the DPR/Weekly data already shows it Dispatched. The Line
    History Sheet can only ADD evidence of progress, never take it
    away - Rule 1's own "latest stage precedes" logic always wins
    when it shows more progress than the joint-level data does.
    """

    row = _row(**{
        "Line History Stage": "Fit-Up",  # one joint's AG is blank
        "Packing": "2026-02-28",
        "Dispatch": "2026-03-01",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Completed"
    assert result.completed is True


def test_line_history_cannot_hold_back_welding_when_dpr_already_packed(engine):
    """
    Same regression, but for the Welding stage specifically (a
    joint with a blank Welding FRun Date) against a Packing date -
    matches the exact real-world case reported (spool
    241535-1A-LP-119-04: joint SW-11A had no weld run date, but the
    spool was already Dispatched in the DPR data).
    """

    row = _row(**{
        "Line History Stage": "Welding",  # one joint's AL is blank
        "Packing": "2026-03-01",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Dispatch"


def test_line_history_pdqc_stays_at_pdqc_when_no_later_dates(engine):
    """
    Line History says every joint is fit-up and welded (PDQC) - and
    none of PDQC/RFP/PDI/Packing/Dispatch have a date in the DPR/
    Weekly Production data - so Current Stage stays PDQC.
    """

    row = _row(**{"Line History Stage": "PDQC"})

    result = engine.evaluate_row(row)

    assert result.current_stage == "PDQC"


def test_line_history_pdqc_lets_original_logic_continue_when_later_dates_exist(engine):
    """
    Line History says PDQC (every joint fit-up + welded) - and RFP/
    PDI/Packing DO have dates in the DPR data - so the normal
    date-based walk continues past PDQC exactly as before.
    """

    row = _row(**{
        "Line History Stage": "PDQC",
        "PDQC": "2026-02-10",
        "RFP": "2026-02-15",
        "PDI": "2026-02-20",
        "Packing": "2026-02-25",
    })

    result = engine.evaluate_row(row)

    assert result.current_stage == "Dispatch"
    assert result.completed is True


def test_line_history_disabled_ignores_the_column(engine):

    engine.line_history_override_enabled = False

    row = _row(**{"Line History Stage": "Welding"})  # would normally advance to Welding

    result = engine.evaluate_row(row)

    assert result.current_stage == "Fit-Up"


# -----------------------------------------------------
# apply() - full dataframe
# -----------------------------------------------------

def test_apply_adds_all_expected_columns(engine):

    dataframe = pd.DataFrame([
        _row().to_dict(),
        _row(**{
            "Planned Start": "2026-01-01",
            "First Fit-Up": "2026-02-01",
            "First Welding": "2026-02-02",
            "PDQC": "2026-02-10",
            "RFP": "2026-02-15",
            "PDI": "2026-02-20",
            "Packing": "2026-02-25",
        }).to_dict(),
    ])

    result = engine.apply(dataframe)

    for column in [
        "Planned",
        "First Activity Date",
        "Current Stage",
        "Next Stage",
        "Completed",
        "Status Message",
    ]:
        assert column in result.columns

    assert bool(result.loc[0, "Planned"]) is False
    assert bool(result.loc[1, "Planned"]) is True

    assert bool(result.loc[0, "Completed"]) is False
    assert bool(result.loc[1, "Completed"]) is True
