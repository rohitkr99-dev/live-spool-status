"""
Unit tests for the Material Handover current-fiscal-year filter
(2026-10-08): the charts start from the current FY's Week 1.
"""

import datetime as dt

import pandas as pd

from production.material_handover import (
    build_material_handover_summary,
    restrict_to_current_fiscal_year,
)


def _rows(dates):
    return pd.DataFrame({
        "Project Code": ["P1"] * len(dates),
        "Drawing No": [f"D{i}" for i in range(len(dates))],
        "Spool No": ["S1"] * len(dates),
        "MH Handover Date": dates,
        "MH First Status": ["HANDOVER"] * len(dates),
        "MH Current Status": [None] * len(dates),
        "MH Inch Dia": [10.0] * len(dates),
    })


def test_filter_starts_at_fy_week_1_and_keeps_dateless_open_items():
    frame = _rows([
        pd.Timestamp("2025-06-09"),   # previous FY
        pd.Timestamp("2026-03-27"),   # Friday before FY Week 1
        pd.Timestamp("2026-03-30"),   # FY27 Week 1 Monday
        pd.Timestamp("2026-09-01"),
        pd.NaT,                       # not handed over yet
    ])

    kept, start = restrict_to_current_fiscal_year(frame, dt.date(2026, 10, 8))

    assert start == pd.Timestamp("2026-03-30")
    assert list(kept["Drawing No"]) == ["D2", "D3", "D4"]


def test_filter_follows_the_fiscal_year_for_an_earlier_reference_date():
    frame = _rows([pd.Timestamp("2025-04-07"), pd.Timestamp("2026-04-07")])

    kept, start = restrict_to_current_fiscal_year(frame, dt.date(2025, 10, 1))

    assert start == pd.Timestamp("2025-03-31")
    assert list(kept["Drawing No"]) == ["D0", "D1"]


def test_summary_only_counts_current_fy_and_reports_the_start():
    # 2020 is always before the current FY; 2099 is always inside it.
    frame = _rows([pd.Timestamp("2020-01-06"), pd.Timestamp("2099-01-05"), pd.NaT])

    summary = build_material_handover_summary(frame)

    assert summary["kpis"]["total_items"] == 2
    assert summary["kpis"]["date_range_start"] == "2099-01-05"
    assert [m["month"] for m in summary["monthly_trend"]] == ["2099-01"]
    assert summary["fiscal_year_start"] is not None


def test_summary_without_workbook_still_has_the_key():
    assert build_material_handover_summary(None)["fiscal_year_start"] is None
