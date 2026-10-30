"""
Week fallback (2026-10-30): a spool the Weekly Production Planning workbook does not
have (or has with a blank Week) takes its Week from the SIOP Planned Spools workbook's
"Week No." column. A Week the Weekly workbook provided is never overwritten.
"""

import pandas as pd

from merge import MergeEngine

KEY = ["Project Code", "Drawing No", "Spool No"]


def _master():
    return pd.DataFrame({
        "Project Code": ["P1"] * 4, "Drawing No": ["D1"] * 4,
        "Spool No": ["S1", "S2", "S3", "S4"],
        "Week": ["Week 5", None, None, None],
        "Planned Start": pd.to_datetime(["2026-01-05", None, None, None]),
    })


def _siop():
    return pd.DataFrame({
        "Project Code": ["P1"] * 3, "Drawing No": ["D1"] * 3,
        "Spool No": ["S1", "S2", "S3"],
        "SIOP Planned Start": pd.to_datetime(["2026-02-02", "2026-11-02", "2026-11-09"]),
        "SIOP Week": ["Week 9", "Week 45", 46],
    })


def test_week_comes_from_siop_only_when_the_weekly_file_has_none():
    out = MergeEngine().apply_siop_fallback(MergeEngine().add_composite_key(_master()), _siop())
    weeks = dict(zip(out["Spool No"], out["Week"]))
    assert weeks["S1"] == "Week 5"        # Weekly file wins
    assert weeks["S2"] == "Week 45"       # missing in Weekly -> SIOP
    assert weeks["S3"] == "Week 46"       # bare number is written like the Weekly file
    assert pd.isna(weeks["S4"])           # in neither file
    starts = dict(zip(out["Spool No"], out["Planned Start"]))
    assert starts["S1"] == pd.Timestamp("2026-01-05")     # unchanged behaviour
    assert starts["S2"] == pd.Timestamp("2026-11-02")


def test_week_is_created_when_the_weekly_file_has_no_week_column():
    master = MergeEngine().add_composite_key(_master().drop(columns=["Week"]))
    out = MergeEngine().apply_siop_fallback(master, _siop())
    assert dict(zip(out["Spool No"], out["Week"]))["S2"] == "Week 45"


def test_siop_without_week_column_still_fills_planned_start():
    siop = _siop().drop(columns=["SIOP Week"])
    out = MergeEngine().apply_siop_fallback(MergeEngine().add_composite_key(_master()), siop)
    assert "Week" in out.columns and pd.isna(dict(zip(out["Spool No"], out["Week"]))["S2"])
    assert dict(zip(out["Spool No"], out["Planned Start"]))["S2"] == pd.Timestamp("2026-11-02")


def test_a_file_named_for_next_month_is_the_newest():
    from datetime import date
    from utils import extract_file_period

    today = date(2026, 10, 30)
    november = extract_file_period("November SIOP Planned Spools.xlsb", today)
    october = extract_file_period("October SIOP Planned Spools.xlsb", today)
    march = extract_file_period("March SIOP Planned Spools.xlsb", today)
    assert november == (2026, 11, 1)
    assert november > october > march
    # more than two months ahead is still read as last year
    assert extract_file_period("November Plan.xlsb", date(2026, 1, 15))[0] == 2025
