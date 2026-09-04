"""
Unit tests for the 2026-09-04 "Internal vs External Blasting" combined
chart (per the person: "Internal & External blasting are both done at
same machines, I want to show some chart showing those together").

build_blasting_output_trend() merges the same per-day/week/month
grouping build_stage_output_trend() already does for
internal_blasting_date/external_blasting_date into one row per period,
with each side's own count/surface_area plus a combined total - the
frontend renders it as a single diverging ("butterfly") chart instead
of two separate ones.
"""

from painting.summary import build_blasting_output_trend


def _record(internal_blasting_date=None, external_blasting_date=None, surface_area=1.0):
    return {
        "internal_blasting_date": internal_blasting_date,
        "external_blasting_date": external_blasting_date,
        "surface_area": surface_area,
    }


def test_periods_present_in_only_one_side_still_appear():
    merged = [
        _record(internal_blasting_date="2026-01-05"),
        _record(external_blasting_date="2026-01-12"),
    ]
    result = build_blasting_output_trend(merged)
    daily = result["daily"]
    assert [r["period"] for r in daily] == ["2026-01-05", "2026-01-12"]


def test_missing_side_defaults_to_zero_not_missing_key():
    merged = [_record(internal_blasting_date="2026-01-05")]
    row = build_blasting_output_trend(merged)["daily"][0]
    assert row["internal_blasting"]["count"] == 1
    assert row["external_blasting"]["count"] == 0
    assert row["external_blasting"]["surface_area"] == 0.0


def test_total_sums_both_sides():
    merged = [
        _record(internal_blasting_date="2026-01-05", surface_area=2.0),
        _record(internal_blasting_date="2026-01-05", surface_area=3.0),
        _record(external_blasting_date="2026-01-05", surface_area=1.5),
    ]
    row = build_blasting_output_trend(merged)["daily"][0]
    assert row["internal_blasting"]["count"] == 2
    assert row["external_blasting"]["count"] == 1
    assert row["total"]["count"] == 3
    assert row["total"]["surface_area"] == 6.5


def test_spool_with_both_dates_counted_on_both_sides_same_period():
    merged = [_record(internal_blasting_date="2026-01-05", external_blasting_date="2026-01-05")]
    row = build_blasting_output_trend(merged)["daily"][0]
    assert row["internal_blasting"]["count"] == 1
    assert row["external_blasting"]["count"] == 1
    assert row["total"]["count"] == 2


def test_periods_sorted_ascending():
    merged = [
        _record(internal_blasting_date="2026-02-01"),
        _record(external_blasting_date="2026-01-01"),
        _record(internal_blasting_date="2026-01-15"),
    ]
    daily = build_blasting_output_trend(merged)["daily"]
    assert [r["period"] for r in daily] == ["2026-01-01", "2026-01-15", "2026-02-01"]


def test_no_activity_returns_empty_lists():
    result = build_blasting_output_trend([])
    assert result["daily"] == []
    assert result["weekly"] == []
    assert result["monthly"] == []


def test_weekly_and_monthly_also_merged():
    merged = [
        _record(internal_blasting_date="2026-01-05"),
        _record(external_blasting_date="2026-01-06"),
    ]
    result = build_blasting_output_trend(merged)
    assert len(result["weekly"]) == 1  # same ISO week
    assert result["weekly"][0]["internal_blasting"]["count"] == 1
    assert result["weekly"][0]["external_blasting"]["count"] == 1
    assert len(result["monthly"]) == 1
    assert result["monthly"][0]["total"]["count"] == 2
