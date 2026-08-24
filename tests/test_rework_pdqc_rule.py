"""
Unit tests for rework_pdqc_rule.py's Hold handling (2026-08-21
rewrite - see hold_ledger.py). Calls apply_rework_pdqc_rule()
directly (not via MergeEngine's thin wrapper) so each test can pass
its own isolated hold_tracking_path (tmp_path) instead of touching
the repo's real state/hold_tracking.json.
"""

import pandas as pd
import pytest

from rework_pdqc_rule import (
    CURRENTLY_ON_HOLD,
    REWORK_HOLD_EXCEPTION,
    apply_rework_pdqc_rule,
)


def _master(rows):
    return pd.DataFrame(rows)


def _spool(pdqc=None, rfp=None):
    return {
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Composite Key": "P001|D001|S001", "PDQC": pdqc, "RFP": rfp,
    }


def _rework_row(status, offer_date):
    return {
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Prod Offer Date": pd.Timestamp(offer_date),
        "Final Status": status,
    }


def test_open_hold_blanks_pdqc_and_rfp_no_fake_anchor(tmp_path):
    """
    Old Rule 2 would have set PDQC to the offer date immediately.
    The new rule treats an open Hold exactly like Rework for
    PDQC/RFP purposes - both stay blank.
    """

    master = _master([_spool(pdqc="2025-12-01", rfp="2025-12-05")])
    rework = pd.DataFrame([_rework_row("Project Hold", "2026-08-01")])

    result = apply_rework_pdqc_rule(
        master, rework, hold_tracking_path=tmp_path / "hold.json"
    )

    assert pd.isna(result.iloc[0]["PDQC"])
    assert pd.isna(result.iloc[0]["RFP"])
    assert bool(result.iloc[0][CURRENTLY_ON_HOLD]) is True
    assert result.iloc[0]["Rework Latest Status"] == "Hold"


def test_hold_resolved_to_accept_gets_real_pdqc_and_clears_flag(tmp_path):
    ledger_path = tmp_path / "hold.json"
    master = _master([_spool()])

    rework_hold = pd.DataFrame([_rework_row("Project Hold", "2026-08-01")])
    apply_rework_pdqc_rule(master, rework_hold, hold_tracking_path=ledger_path)

    # Same spool, later run: resolved to Accept.
    master2 = _master([_spool()])
    rework_accept = pd.DataFrame([_rework_row("Accept", "2026-08-10")])
    result = apply_rework_pdqc_rule(
        master2, rework_accept, hold_tracking_path=ledger_path
    )

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-08-10")
    assert bool(result.iloc[0][CURRENTLY_ON_HOLD]) is False


def test_hold_ledger_persists_working_days_across_runs(tmp_path):
    import hold_ledger

    ledger_path = tmp_path / "hold.json"
    master = _master([_spool()])
    apply_rework_pdqc_rule(
        master,
        pd.DataFrame([_rework_row("Project Hold", "2026-08-01")]),
        hold_tracking_path=ledger_path,
    )
    apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Accept", "2026-08-10")]),
        hold_tracking_path=ledger_path,
    )

    store = hold_ledger.load_ledger(ledger_path)
    periods = hold_ledger.periods_for(store, "P001|D001|S001")
    assert len(periods) == 1
    assert periods[0]["hold_removed"] is not None


def test_hold_then_rework_without_accept_is_flagged_ambiguous(tmp_path):
    ledger_path = tmp_path / "hold.json"
    apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Project Hold", "2026-08-01")]),
        hold_tracking_path=ledger_path,
    )

    result = apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Rework", "2026-08-05")]),
        hold_tracking_path=ledger_path,
    )

    assert bool(result.iloc[0][REWORK_HOLD_EXCEPTION]) is True
    # Still shows as open on Hold - untouched, not silently resolved.
    assert bool(result.iloc[0][CURRENTLY_ON_HOLD]) is True


def test_repeat_hold_after_resolution_is_no_longer_an_exception(tmp_path):
    """
    Unlike the old single-anchor rule, re-entering Hold after a
    previous resolution is now just a second period - not an
    ambiguous case needing manual review.
    """

    ledger_path = tmp_path / "hold.json"
    apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Project Hold", "2026-08-01")]),
        hold_tracking_path=ledger_path,
    )
    apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Accept", "2026-08-10")]),
        hold_tracking_path=ledger_path,
    )
    result = apply_rework_pdqc_rule(
        _master([_spool()]),
        pd.DataFrame([_rework_row("Project Hold", "2026-09-01")]),
        hold_tracking_path=ledger_path,
    )

    assert bool(result.iloc[0][REWORK_HOLD_EXCEPTION]) is False
    assert bool(result.iloc[0][CURRENTLY_ON_HOLD]) is True


def test_stale_rework_status_with_pdi_cleared_leaves_hold_flag_false(tmp_path):
    master = _master([{
        "Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
        "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01",
        "RFP": "2026-01-05", "PDI": "2026-01-10",
    }])
    rework = pd.DataFrame([_rework_row("Rework", "2026-08-01")])

    result = apply_rework_pdqc_rule(
        master, rework, hold_tracking_path=tmp_path / "hold.json"
    )

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-01-01")
    assert bool(result.iloc[0][CURRENTLY_ON_HOLD]) is False


def test_same_date_tie_picks_the_later_sheet_row_not_the_first(tmp_path):
    """
    Given by the person, 2026-08-22 (real data): Drawing
    2-V17565-PIND-0092 / Spool V17565-PIND-0092-01 had a Rework row
    and an Accept row both dated the same day, identical QC
    Observation text - QC appended the Accept row after review
    without back-dating it. groupby().idxmax() used to silently keep
    whichever row came FIRST in the sheet on a tie (here, the stale
    Rework row) - fixed to keep whichever row was entered LAST
    instead. 156 spools in his real workbook were misclassified this
    way, all in the harmful direction (blocked from PDQC clearance
    despite QC's real final answer being Accept).
    """

    master = _master([_spool()])
    rework = pd.DataFrame([
        _rework_row("Rework", "2026-06-25"),
        _rework_row("Accept", "2026-06-25"),
    ])

    result = apply_rework_pdqc_rule(
        master, rework, hold_tracking_path=tmp_path / "hold.json"
    )

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-06-25")
    assert result.iloc[0]["Rework Latest Status"] == "Accept"


def test_same_date_tie_reverse_order_also_picks_the_later_sheet_row(tmp_path):
    """Same as above, but the Accept row happens to come first in the
    sheet and Rework second - the later ROW (not later status) must
    still win, since a real re-Hold/re-Rework entered after an Accept
    on the same date is exactly as real as the reverse."""

    master = _master([_spool()])
    rework = pd.DataFrame([
        _rework_row("Accept", "2026-06-25"),
        _rework_row("Rework", "2026-06-25"),
    ])

    result = apply_rework_pdqc_rule(
        master, rework, hold_tracking_path=tmp_path / "hold.json"
    )

    assert pd.isna(result.iloc[0]["PDQC"])
    assert result.iloc[0]["Rework Latest Status"] == "Rework"
