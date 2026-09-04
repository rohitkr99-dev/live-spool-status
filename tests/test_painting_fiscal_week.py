"""
Unit tests for the Painting dashboard's fiscal week handling,
2026-09-04, two rounds:

1. Every "by week" chart was grouping by Python's isocalendar() week
   (calendar ISO 8601, Monday-anchored to the actual new year) instead
   of DEE's own fiscal week calendar used everywhere else on this site
   (utils.py -> fiscal_week_info(), Week 1 anchored to 1st April - see
   that function's own docstring for the exact rule). Caught by the
   person: "the week number showing here are wrong... Week 1 started
   from 30th March till 5th April."

2. Fixing (1) with a bare "Week N" label broke sort order once real
   data crosses a fiscal-year boundary - caught by the person against
   a real example (spools RFP'd 9-26 March 2026, the tail end of
   FY25-26, landing in Week 50/51/52): "please fix the sort order,
   please see this should be fixed for every chart of that page."
   _fiscal_week_sort_key() (that week's own fiscal Monday, ISO date
   form) is what every "by week" bucket now actually groups and sorts
   on; _fiscal_week_label() ("Week N") is swapped in via
   _relabel_weekly() only as the very last step, after sorting -  see
   both functions' own docstrings in src/painting/summary.py.
"""

from datetime import date

from painting.summary import (
    _fiscal_week_label,
    _fiscal_week_sort_key,
    _group_output,
    _period_keys,
    _relabel_weekly,
    build_bay_output_trend,
    build_blasting_output_trend,
    build_weekly_trend,
)


def test_week_1_starts_march_30_2026():
    assert _fiscal_week_label(date(2026, 3, 30)) == "Week 1"


def test_week_1_ends_april_5_2026():
    assert _fiscal_week_label(date(2026, 4, 5)) == "Week 1"


def test_week_2_starts_april_6_2026():
    assert _fiscal_week_label(date(2026, 4, 6)) == "Week 2"


def test_day_before_week_1_is_the_prior_cycles_week_52():
    assert _fiscal_week_label(date(2026, 3, 29)) == "Week 52"


def test_not_iso_calendar_week():
    """March 30 2026 is ISO week 14 (Mon of that calendar week) - fiscal Week 1, not 14."""
    assert date(2026, 3, 30).isocalendar()[1] == 14
    assert _fiscal_week_label(date(2026, 3, 30)) == "Week 1"


def test_period_keys_weekly_slot_is_a_sort_key_not_a_label():
    _, week_key, _ = _period_keys(date(2026, 4, 1))
    assert week_key == "2026-03-30"  # that week's own fiscal Monday - not "Week 1"


def test_build_weekly_trend_labels_use_fiscal_week():
    merged = [
        {"total_cycle_days": 5, "rfp_date": "2026-04-01"},
        {"total_cycle_days": 7, "rfp_date": "2026-04-02"},
    ]
    result = build_weekly_trend(merged)
    assert result == [{"week": "Week 1", "median_days": 6, "count": 2}]


# ---------------------------------------------------------------
# Sort order across a fiscal-year boundary - the actual bug reported
# ("please fix the sort order... for every chart on that page").
# ---------------------------------------------------------------

def test_prior_cycle_week_52_sorts_before_this_cycles_week_1():
    """The exact scenario the person traced: 26 March 2026 (Week 52 of FY25-26) must land before 1 April 2026 (Week 1 of FY26-27), not after by alphabetical accident."""
    merged = [
        {"total_cycle_days": 10, "rfp_date": "2026-03-26"},  # prior cycle's Week 52
        {"total_cycle_days": 20, "rfp_date": "2026-04-01"},  # this cycle's Week 1
    ]
    result = build_weekly_trend(merged)
    assert [row["week"] for row in result] == ["Week 52", "Week 1"]


def test_prior_cycle_week_50_sorts_before_this_cycles_week_23():
    """A wider gap, same real-world shape as what the person found (Week 50/51/52 sorting after Week 23)."""
    merged = [
        {"total_cycle_days": 5, "rfp_date": "2026-09-01"},  # this cycle's Week 23
        {"total_cycle_days": 5, "rfp_date": "2026-03-10"},  # prior cycle's Week 50
    ]
    result = build_weekly_trend(merged)
    assert [row["week"] for row in result] == ["Week 50", "Week 23"]


def test_stage_output_trend_weekly_relabeled_and_ordered():
    merged = [
        {"internal_blasting_date": "2026-03-26", "surface_area": 1.0},
        {"internal_blasting_date": "2026-04-01", "surface_area": 2.0},
    ]
    grouped = _group_output(merged, "internal_blasting_date")
    weekly = _relabel_weekly(grouped["weekly"])
    assert [row["period"] for row in weekly] == ["Week 52", "Week 1"]


def test_blasting_output_trend_weekly_ordered_across_boundary():
    merged = [
        {"internal_blasting_date": "2026-03-26", "external_blasting_date": None, "surface_area": 1.0},
        {"internal_blasting_date": None, "external_blasting_date": "2026-04-01", "surface_area": 1.0},
    ]
    result = build_blasting_output_trend(merged)
    assert [row["period"] for row in result["weekly"]] == ["Week 52", "Week 1"]


def test_bay_output_trend_weekly_ordered_across_boundary():
    merged = [
        {"bay_no": "BAY-4", "internal_blasting_date": "2026-03-26", "surface_area": 1.0},
        {"bay_no": "BAY-4", "internal_blasting_date": "2026-04-01", "surface_area": 1.0},
    ]
    result = build_bay_output_trend(merged)
    weekly = result["stages"]["internal_blasting"]["weekly"]
    assert [row["period"] for row in weekly] == ["Week 52", "Week 1"]


def test_sort_key_and_label_agree_on_which_week():
    d = date(2026, 9, 4)
    sort_key = _fiscal_week_sort_key(d)
    label = _fiscal_week_label(d)
    assert sort_key == "2026-08-31"  # the Monday of d's own fiscal week
    assert label == "Week 23"
