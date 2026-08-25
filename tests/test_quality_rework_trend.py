"""
Unit tests for src/quality/summary.py -> build_rework_trend()'s
"week" granularity (2026-08-26 - given by the person: "Better to
show chart from Week 1 onwards", confirmed meaning the fiscal week
system already used for "Week Planned" elsewhere, current cycle
only).
"""

from datetime import date, timedelta

import pandas as pd
import pytest

from quality.summary import build_rework_trend
from utils import week_number_to_start_date, today


def _row(offer_date, status):
    return {"Prod Offer Date": pd.Timestamp(offer_date), "Final Status": status}


def test_week_series_starts_at_week_1_of_current_cycle():
    cycle_start = week_number_to_start_date(1, today())
    df = pd.DataFrame([
        _row(cycle_start, "Accept"),
        _row(cycle_start + timedelta(days=1), "Rework"),
    ])

    trend = build_rework_trend(df)

    assert trend["week"][0]["period"] == "Week 1"
    assert trend["week"][0]["total"] == 2
    assert trend["week"][0]["rework"] == 1
    assert trend["week"][0]["pct"] == 50.0


def test_data_before_current_cycle_is_excluded_from_week_series():
    cycle_start = week_number_to_start_date(1, today())
    before_cycle = cycle_start - timedelta(days=30)
    df = pd.DataFrame([
        _row(before_cycle, "Accept"),
        _row(before_cycle, "Rework"),
    ])

    trend = build_rework_trend(df)

    assert trend["week"] == []


def test_data_before_current_cycle_still_appears_in_day_and_month():
    cycle_start = week_number_to_start_date(1, today())
    before_cycle = cycle_start - timedelta(days=30)
    df = pd.DataFrame([_row(before_cycle, "Accept")])

    trend = build_rework_trend(df)

    assert len(trend["day"]) == 1
    assert len(trend["month"]) == 1
    assert trend["week"] == []


def test_week_numbers_increase_monotonically_and_are_not_string_sorted():
    cycle_start = week_number_to_start_date(1, today())
    df = pd.DataFrame([
        _row(week_number_to_start_date(2, today()), "Accept"),
        _row(week_number_to_start_date(10, today()), "Accept"),
        _row(cycle_start, "Accept"),
    ])

    trend = build_rework_trend(df)
    periods = [row["period"] for row in trend["week"]]

    # Must be Week 1, Week 2, Week 10 in that order - not string-sorted
    # ("Week 10" before "Week 2").
    assert periods == ["Week 1", "Week 2", "Week 10"]


def test_no_offer_dates_gives_empty_week_series():
    df = pd.DataFrame([{"Prod Offer Date": None, "Final Status": "Accept"}])
    trend = build_rework_trend(df)
    assert trend["week"] == []
