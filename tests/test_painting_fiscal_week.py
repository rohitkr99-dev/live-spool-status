"""
Unit tests for the 2026-09-04 fix: every "by week" chart on the
Painting dashboard was grouping by Python's isocalendar() week
(calendar ISO 8601, Monday-anchored to the actual new year) instead of
DEE's own fiscal week calendar used everywhere else on this site
(utils.py -> fiscal_week_info(), Week 1 anchored to 1st April - see
that function's own docstring for the exact rule). Caught by the
person: "the week number showing here are wrong... Week 1 started
from 30th March till 5th April."
"""

from datetime import date

from painting.summary import _fiscal_week_key, _period_keys, build_weekly_trend


def test_week_1_starts_march_30_2026():
    assert _fiscal_week_key(date(2026, 3, 30)) == "Week 01"


def test_week_1_ends_april_5_2026():
    assert _fiscal_week_key(date(2026, 4, 5)) == "Week 01"


def test_week_2_starts_april_6_2026():
    assert _fiscal_week_key(date(2026, 4, 6)) == "Week 02"


def test_day_before_week_1_is_the_prior_cycles_week_52():
    assert _fiscal_week_key(date(2026, 3, 29)) == "Week 52"


def test_not_iso_calendar_week():
    """March 30 2026 is ISO week 14 (Mon of that calendar week) - fiscal Week 1, not 14."""
    assert date(2026, 3, 30).isocalendar()[1] == 14
    assert _fiscal_week_key(date(2026, 3, 30)) == "Week 01"


def test_period_keys_weekly_slot_uses_fiscal_week():
    _, week_key, _ = _period_keys(date(2026, 4, 1))
    assert week_key == "Week 01"


def test_build_weekly_trend_labels_use_fiscal_week():
    merged = [
        {"total_cycle_days": 5, "rfp_date": "2026-04-01"},
        {"total_cycle_days": 7, "rfp_date": "2026-04-02"},
    ]
    result = build_weekly_trend(merged)
    assert result == [{"week": "Week 01", "median_days": 6, "count": 2}]
