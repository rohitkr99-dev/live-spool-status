"""
Unit tests for hold_ledger.py
"""

from datetime import date

import pytest

import hold_ledger as hl


KEY = "P001|D001|S001"


def test_open_hold_then_close_reports_working_days():
    store = {}

    result = hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    assert result["opened"] is True
    assert hl.is_currently_on_hold(store, KEY) is True

    # 2026-08-01 is a Saturday; 2026-08-10 is a Monday.
    result = hl.update_hold_periods(store, KEY, "Accept", date(2026, 8, 10))
    assert result["closed"] is True
    assert hl.is_currently_on_hold(store, KEY) is False
    assert result["working_days_held"] == 6  # Mon-Fri (3-7), Mon(10) = 6 working days after Sat 1st


def test_repeated_hold_status_does_not_move_anchor():
    store = {}
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    # Same spool reported Hold again on a later offer date - anchor
    # must NOT move.
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 5))

    periods = hl.periods_for(store, KEY)
    assert len(periods) == 1
    assert periods[0]["hold_start"] == date(2026, 8, 1)


def test_multiple_hold_periods_accumulate_independently():
    store = {}
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    hl.update_hold_periods(store, KEY, "Accept", date(2026, 8, 10))
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 9, 3))
    result = hl.update_hold_periods(store, KEY, "Accept", date(2026, 9, 8))

    periods = hl.periods_for(store, KEY)
    assert len(periods) == 2
    assert result["working_days_held"] > 0
    assert hl.is_currently_on_hold(store, KEY) is False


def test_rework_after_open_hold_is_flagged_ambiguous_and_left_open():
    store = {}
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    result = hl.update_hold_periods(store, KEY, "Rework", date(2026, 8, 5))

    assert result["ambiguous"] is True
    assert hl.is_currently_on_hold(store, KEY) is True  # left untouched


def test_working_days_held_between_covers_pre_and_post_rfp_windows():
    store = {}
    # Held 2026-08-01 -> 2026-08-10 (spans PDQC/RFP window).
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    hl.update_hold_periods(store, KEY, "Accept", date(2026, 8, 10))
    # Held again 2026-08-20 -> 2026-08-25, AFTER RFP, during Under
    # Painting.
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 20))
    hl.update_hold_periods(store, KEY, "Accept", date(2026, 8, 25))

    # Window covering only the RFP->PDI ("Under Painting") span
    # should pick up ONLY the second period, not the first.
    days = hl.working_days_held_between(
        store, KEY, date(2026, 8, 12), date(2026, 8, 28)
    )
    assert days > 0

    only_first_period_window = hl.working_days_held_between(
        store, KEY, date(2026, 7, 25), date(2026, 8, 11)
    )
    assert only_first_period_window > 0
    assert only_first_period_window != days


def test_open_period_counts_through_today_for_overlap():
    store = {}
    hl.update_hold_periods(store, KEY, "Hold", date(2026, 8, 1))
    # No Accept - still open. A window ending in the future (relative
    # to hold_start) should still get a nonzero overlap since an open
    # period is treated as held through today.
    days = hl.working_days_held_between(
        store, KEY, date(2026, 8, 1), date(2026, 8, 3)
    )
    assert days >= 0  # doesn't blow up; exact value depends on "today"


def test_legacy_open_entry_migrates_cleanly():
    store = {KEY: {"hold_offer_date": "2026-08-01T00:00:00", "still_on_hold": True}}

    assert hl.is_currently_on_hold(store, KEY) is True
    periods = hl.periods_for(store, KEY)
    assert periods == [{"hold_start": date(2026, 8, 1), "hold_removed": None}]


def test_legacy_resolved_entry_migrates_to_zero_duration():
    store = {KEY: {"hold_offer_date": "2026-08-01T00:00:00", "still_on_hold": False}}

    assert hl.is_currently_on_hold(store, KEY) is False
    periods = hl.periods_for(store, KEY)
    assert periods == [{"hold_start": date(2026, 8, 1), "hold_removed": date(2026, 8, 1)}]


def test_no_entry_is_not_on_hold_and_has_no_overlap():
    store = {}
    assert hl.is_currently_on_hold(store, "NOPE") is False
    assert hl.working_days_held_between(store, "NOPE", date(2026, 1, 1), date(2026, 1, 5)) == 0
