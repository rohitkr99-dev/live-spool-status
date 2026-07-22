"""
Unit tests for summary.py
"""

import json

import pandas as pd
import pytest

from summary import SummaryEngine


@pytest.fixture
def engine():
    return SummaryEngine()


def _row(**overrides):
    base = {
        "Composite Key": "P001|D001|S001",
        "Project Code": "P001",
        "Drawing No": "D001",
        "Spool No": "S001",
        "Week": "Week 1",
        "Group": "A",
        "Material": "CS",
        "Total Joints": 5,
        "Prod Order Release": "2025-12-28",
        "Planned Start": "2026-01-01",
        "First Fit-Up": "2026-01-05",
        "First Welding": "2026-01-07",
        "PDQC": None,
        "RFP": None,
        "PDI": None,
        "Packing": None,
        "Dispatch": None,
        "First Activity Date": "2026-01-05",
        "Current Stage": "PDQC",
        "Next Stage": "Ready for Painting",
        "Stage Age": 3,
        "Total Age": 10,
        "Completed": False,
        "Planned": True,
        "Status Message": "Waiting for PDQC",
    }
    base.update(overrides)
    return base


@pytest.fixture
def sample_dataframe():
    return pd.DataFrame([
        _row(),
        _row(**{
            "Composite Key": "P001|D001|S002",
            "Spool No": "S002",
            "Week": "Week 2",
            "PDQC": "2026-01-15",
            "RFP": "2026-01-20",
            "PDI": "2026-01-25",
            "Packing": "2026-01-30",
            "Current Stage": "Dispatch",
            "Next Stage": None,
            "Completed": True,
            "Stage Age": 0,
            "Total Age": 29,
        }),
        _row(**{
            "Composite Key": "P002|D002|S001",
            "Project Code": "P002",
            "Drawing No": "D002",
            "Week": None,
            "Planned Start": None,
            "First Fit-Up": None,
            "First Welding": None,
            "First Activity Date": None,
            "Current Stage": "Fit-Up",
            "Next Stage": "Welding",
            "Completed": False,
            "Planned": False,
            "Stage Age": 0,
            "Total Age": 0,
            "Status Message": "Fabrication Yet to Start",
        }),
    ])


# -----------------------------------------------------
# Planning Variance / Completion Date / Last Activity enrichment
# -----------------------------------------------------

def test_planning_variance_uses_first_activity_date(engine):
    """First Fit-Up/First Welding (First Activity Date) wins when present."""

    row = pd.Series(_row())

    assert engine.determine_planning_variance(row) == 4  # Jan 5 - Jan 1


def test_planning_variance_falls_back_to_pdqc(engine):
    """No First Activity Date -> fall back to the PDQC date."""

    row = pd.Series(_row(**{
        "First Fit-Up": None,
        "First Welding": None,
        "First Activity Date": None,
        "PDQC": "2026-01-12",
    }))

    assert engine.determine_planning_variance(row) == 11  # Jan 12 - Jan 1


def test_planning_variance_falls_back_to_today(engine, monkeypatch):
    """No First Activity Date and no PDQC -> fall back to today."""

    from datetime import date

    monkeypatch.setattr("summary.today", lambda: date(2026, 1, 10))

    row = pd.Series(_row(**{
        "First Fit-Up": None,
        "First Welding": None,
        "First Activity Date": None,
        "PDQC": None,
    }))

    assert engine.determine_planning_variance(row) == 9  # Jan 10 - Jan 1


def test_planning_variance_none_when_no_start_date(engine):
    """No Planned Start -> nothing to compare against, so None."""

    row = pd.Series(_row(**{"Planned Start": None}))

    assert engine.determine_planning_variance(row) is None


def test_completion_date_is_packing_date(engine):

    row = pd.Series(_row(**{"Packing": "2026-01-30"}))

    result = engine.determine_completion_date(row)

    assert result.isoformat() == "2026-01-30"


def test_completion_date_blank_when_not_packed(engine):

    row = pd.Series(_row(**{"Packing": None}))

    assert engine.determine_completion_date(row) is None


def test_last_activity_picks_latest_filled_stage(engine):

    row = pd.Series(_row(**{
        "PDQC": "2026-01-10",
        "RFP": "2026-01-20",
    }))

    result = engine.determine_last_activity(row)

    assert result.isoformat() == "2026-01-20"


# -----------------------------------------------------
# master_spools.json
# -----------------------------------------------------

def test_generate_master_spools_is_json_serialisable(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    records = engine.generate_master_spools(enriched)

    assert len(records) == 3
    json.dumps(records)  # must not raise

    assert records[0]["Composite Key"] == "P001|D001|S001"
    assert records[0]["Current Stage"] == "PDQC"


# -----------------------------------------------------
# dashboard_summary.json
# -----------------------------------------------------

def test_dashboard_summary_kpis(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    summary = engine.generate_dashboard_summary(enriched)

    json.dumps(summary)  # must not raise

    assert summary["kpis"]["total_spools"] == 3
    assert summary["kpis"]["planned"] == 2
    assert summary["kpis"]["completed"] == 1
    assert summary["kpis"]["oldest_spool"]["spool_no"] == "S002"
    assert summary["current_stage_distribution"]["Fit-Up"] == 1
    assert summary["current_stage_distribution"]["Dispatch"] == 1


def test_dashboard_summary_excludes_not_released_from_average_age(engine, sample_dataframe):
    """
    Regression test: a spool whose Production Order hasn't been
    released yet (Current Stage == "Production Order Not Released")
    always has Total Age 0 (no anchor date exists). It must still be
    counted in total_spools, but must NOT drag down average_total_age_days
    or be eligible to "win" oldest_spool.
    """

    dataframe = pd.concat([
        sample_dataframe,
        pd.DataFrame([_row(**{
            "Composite Key": "P001|D001|S099",
            "Spool No": "S099",
            "Planned Start": None,
            "First Fit-Up": None,
            "First Welding": None,
            "First Activity Date": None,
            "Current Stage": "Production Order Not Released",
            "Status Message": "Production Order Not Released",
            "Planned": False,
            "Completed": False,
            "Total Age": 0,
            "Stage Age": 0,
        })]),
    ], ignore_index=True)

    enriched = engine.enrich(dataframe)
    summary = engine.generate_dashboard_summary(enriched)

    # Still counted in the total.
    assert summary["kpis"]["total_spools"] == 4

    # But excluded from the age-based KPIs - same average/oldest
    # spool as the 3-row fixture above, unaffected by the S099 row.
    baseline = engine.generate_dashboard_summary(
        engine.enrich(sample_dataframe)
    )
    assert (
        summary["kpis"]["average_total_age_days"]
        == baseline["kpis"]["average_total_age_days"]
    )
    assert summary["kpis"]["oldest_spool"]["spool_no"] == "S002"


# -----------------------------------------------------
# project / weekly summary
# -----------------------------------------------------

def test_project_summary_groups_correctly(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    records = engine.generate_project_summary(enriched)

    json.dumps(records)  # must not raise

    by_project = {record["Project Code"]: record for record in records}

    assert by_project["P001"]["total_spools"] == 2
    assert by_project["P002"]["total_spools"] == 1


def test_project_summary_breakdown_includes_completed_label(engine):
    """
    Regression test: a group where every spool is Completed must
    still show a non-empty current_stage_breakdown (Completed isn't
    part of the stage list itself - it's the terminal label).
    """

    dataframe = pd.DataFrame([
        _row(**{"Current Stage": "Completed", "Completed": True}),
        _row(**{
            "Composite Key": "P001|D001|S002",
            "Spool No": "S002",
            "Current Stage": "Completed",
            "Completed": True,
        }),
    ])

    enriched = engine.enrich(dataframe)
    records = engine.generate_project_summary(enriched)

    assert records[0]["current_stage_breakdown"] == {"Completed": 2}


def test_weekly_summary_handles_unassigned(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    records = engine.generate_weekly_summary(enriched)

    json.dumps(records)  # must not raise

    weeks = [record["Week"] for record in records]

    assert "Unassigned" in weeks
    assert weeks[-1] == "Unassigned"  # sorts last


def test_group_summary_groups_correctly(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    records = engine.generate_group_summary(enriched)

    json.dumps(records)  # must not raise

    by_group = {record["Group"]: record for record in records}

    assert by_group["A"]["total_spools"] == 3


# -----------------------------------------------------
# stage_ageing_summary
# -----------------------------------------------------

def _ageing_row(**overrides):
    base = {
        "Composite Key": "P001|D001|S001",
        "Project Code": "P001",
        "Drawing No": "D001",
        "Spool No": "S001",
        "Prod Order Release": "2025-12-20",
        "Planned Start": "2025-12-29",    # 3 days before First Fit-Up
        "First Fit-Up": "2026-01-01",
        "First Welding": "2026-01-04",    # 3 days in Welding
        "PDQC": "2026-01-06",             # 8 days in PDQC (from
                                           # Planned Start, the
                                           # earliest Total Age
                                           # Anchor candidate - no
                                           # Line History data here)
        "RFP": None,
        "PDI": None,
        "Packing": None,
        "Dispatch": None,
        "Completed": False,
    }
    base.update(overrides)
    return base


def test_stage_ageing_summary_fitup_uses_planned_start(engine):
    """With no Line History data, Fit-Up Age falls back to First
    Fit-Up - Planned Start (not a gap to the next stage)."""

    dataframe = pd.DataFrame([_ageing_row()])

    records = engine.generate_stage_ageing_summary(dataframe)
    fitup = next(r for r in records if r["Stage"] == "Fit-Up")

    assert fitup["average_days"] == 3.0


def test_stage_ageing_summary_computes_average_dwell_time(engine):
    """Average Welding dwell time across two spools in the same
    project - Welding Age = First Welding - First Fit-Up when there's
    no Line History data for the spool."""

    dataframe = pd.DataFrame([
        _ageing_row(),  # 3 days in Welding
        _ageing_row(**{
            "Spool No": "S002",
            "First Fit-Up": "2026-01-01",
            "First Welding": "2026-01-08",  # 7 days in Welding
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)
    json.dumps(records)  # must not raise

    welding = next(r for r in records if r["Stage"] == "Welding")

    assert welding["Project Code"] == "P001"
    assert welding["spool_count"] == 2
    assert welding["average_days"] == 5.0  # (3 + 7) / 2


def test_stage_ageing_summary_buckets_dwell_time(engine):
    """Dwell times should land in the correct AGEING_BUCKETS bracket."""

    dataframe = pd.DataFrame([
        _ageing_row(),  # 3 days -> "0-7d"
        _ageing_row(**{
            "Spool No": "S002",
            "First Fit-Up": "2026-01-01",
            "First Welding": "2026-01-20",  # 19 days -> "15-30d"
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)
    welding = next(r for r in records if r["Stage"] == "Welding")

    assert welding["bucket_counts"]["0\u20137d"] == 1
    assert welding["bucket_counts"]["15\u201330d"] == 1
    assert sum(welding["bucket_counts"].values()) == welding["spool_count"]


def test_stage_ageing_summary_clamps_negative_gaps_to_zero(engine):
    """A later stage dated BEFORE the earlier one is a data anomaly,
    not a real dwell time, and must be clamped to
    ageing.negative_age_value (0) rather than skew the average -
    and rather than being dropped, per the person's rule."""

    dataframe = pd.DataFrame([
        _ageing_row(**{
            "First Fit-Up": "2026-01-10",
            "First Welding": "2026-01-05",  # before Fit-Up - invalid
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)

    welding_record = next(r for r in records if r["Stage"] == "Welding")
    assert welding_record["spool_count"] == 1
    assert welding_record["average_days"] == 0


def test_stage_ageing_summary_clamps_negative_fitup_gap_to_zero(engine):
    """Same rule for Fit-Up's own (Planned Start-based) gap."""

    dataframe = pd.DataFrame([
        _ageing_row(**{
            "Planned Start": "2026-01-15",  # after First Fit-Up - invalid
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)

    fitup_record = next(r for r in records if r["Stage"] == "Fit-Up")
    assert fitup_record["spool_count"] == 1
    assert fitup_record["average_days"] == 0


def test_stage_ageing_summary_excludes_spools_without_prod_order_release(engine):
    """A spool with no Prod Order Release date at all is not real
    production history yet, and must not be counted in any stage's
    dwell numbers, per the person's rule."""

    dataframe = pd.DataFrame([
        _ageing_row(**{"Prod Order Release": None}),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)

    assert records == []


def test_stage_ageing_summary_pdqc_uses_total_age_anchor_fallback(engine):
    """With no Line History data, PDQC Age falls back to
    PDQC - Total Age Anchor (earliest of Planned Start / First
    Fit-Up / First Welding), not First Welding directly."""

    dataframe = pd.DataFrame([_ageing_row()])

    records = engine.generate_stage_ageing_summary(dataframe)
    pdqc = next(r for r in records if r["Stage"] == "PDQC")

    # PDQC (2026-01-06) - Planned Start (2025-12-29) = 8 days
    assert pdqc["average_days"] == 8.0


def test_stage_ageing_summary_uses_line_history_ages(engine):
    """When the Line-History-derived columns are present (populated
    by merge.py -> summarize_line_history()), they take priority over
    the plain date-field fallback for Fit-Up/Welding/PDQC."""

    dataframe = pd.DataFrame([
        _ageing_row(**{
            "LH Fit-Up Age": 15,
            "LH Welding Age": 4.5,
            "LH Last Welding FRun Date": "2026-01-02",
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)
    by_stage = {r["Stage"]: r for r in records}

    assert by_stage["Fit-Up"]["average_days"] == 15.0
    assert by_stage["Welding"]["average_days"] == 4.5  # not rounded to 4
    # PDQC (2026-01-06) - LH Last Welding FRun Date (2026-01-02) = 4
    assert by_stage["PDQC"]["average_days"] == 4.0


def test_stage_ageing_summary_excludes_dispatch_stage(engine):
    """Dispatch has no next stage to measure a dwell time against, so
    it should never appear as a Stage value in the output."""

    dataframe = pd.DataFrame([
        _ageing_row(**{
            "RFP": "2026-01-10",
            "PDI": "2026-01-15",
            "Packing": "2026-01-20",
            "Dispatch": "2026-01-25",
        }),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)

    assert not any(r["Stage"] == "Dispatch" for r in records)
    assert any(r["Stage"] == "Packing" for r in records)


def test_stage_ageing_summary_includes_completed_spools(engine):
    """Completed/Dispatched spools must still contribute their
    historical per-stage dwell time - this is not filtered by the
    Completed flag."""

    dataframe = pd.DataFrame([
        _ageing_row(**{"Completed": True}),
    ])

    records = engine.generate_stage_ageing_summary(dataframe)

    assert any(r["Stage"] == "Fit-Up" for r in records)


# -----------------------------------------------------
# fitup / welding summary
# -----------------------------------------------------

def test_fitup_summary_progress(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    records = engine.generate_fitup_summary(enriched)

    json.dumps(records)  # must not raise

    week1 = next(r for r in records if r["Week"] == "Week 1")
    assert week1["total_spools"] == 1
    assert week1["done"] == 1
    assert week1["completion_pct"] == 100.0


# -----------------------------------------------------
# exceptions.json
# -----------------------------------------------------

def test_exceptions_detects_out_of_order_stage(engine):

    dataframe = pd.DataFrame([
        _row(**{
            "Current Stage": "Ready for Painting",
            "PDQC": "2026-01-10",
            "RFP": None,
            "PDI": "2026-01-20",  # filled despite RFP being blank
            "Packing": "2026-01-25",
        }),
    ])

    enriched = engine.enrich(dataframe)
    exceptions = engine.generate_exceptions(enriched)

    json.dumps(exceptions)  # must not raise

    assert len(exceptions) == 1
    assert exceptions[0]["type"] == "out_of_order_stage_dates"
    assert "Under Painting" in exceptions[0]["affected_stages"]


def test_exceptions_empty_when_no_anomalies(engine, sample_dataframe):

    enriched = engine.enrich(sample_dataframe)
    exceptions = engine.generate_exceptions(enriched)

    assert exceptions == []


# -----------------------------------------------------
# generate_s_curve_summary
# -----------------------------------------------------

def test_s_curve_summary_empty_dataframe(engine):

    outputs = engine.generate_s_curve_summary(pd.DataFrame())

    assert outputs["total_scope"] == 0
    assert outputs["points"] == []
    assert outputs["cumulative_planned_pct_to_date"] is None
    assert outputs["cumulative_actual_pct_to_date"] is None
    assert outputs["schedule_variance_pct"] is None


def test_s_curve_summary_cumulative_percentages(engine, sample_dataframe):
    """
    Of the 3 sample spools: 2 have a Planned Start (same week), and
    1 has been Packed (Completion Date). All dates are in the past,
    so every point counts toward "to date".
    """

    enriched = engine.enrich(sample_dataframe)
    outputs = engine.generate_s_curve_summary(enriched)

    assert outputs["total_scope"] == 3
    assert outputs["points"], "expected at least one week of data"

    # Every point is JSON-safe and monotonically non-decreasing.
    json.dumps(outputs["points"])
    planned_series = [p["cumulative_planned_pct"] for p in outputs["points"]]
    assert planned_series == sorted(planned_series)

    # 2 of 3 spools have a Planned Start -> 66.7% planned to date.
    assert outputs["cumulative_planned_pct_to_date"] == pytest.approx(66.7)

    # 1 of 3 spools has been Packed -> 33.3% actual to date.
    assert outputs["cumulative_actual_pct_to_date"] == pytest.approx(33.3)

    # Actual trails planned -> negative schedule variance.
    assert outputs["schedule_variance_pct"] < 0


def test_s_curve_summary_actual_stops_at_current_week(engine):
    """
    A Planned Start far in the future (beyond the current fiscal
    week) should still extend the planned line, but must never
    produce an "actual" value for that future week.
    """

    dataframe = pd.DataFrame([
        _row(**{
            "Composite Key": "P003|D003|S001",
            "Planned Start": "2099-01-01",
            "Packing": None,
        }),
    ])

    enriched = engine.enrich(dataframe)
    outputs = engine.generate_s_curve_summary(enriched)

    future_points = [p for p in outputs["points"] if p["planned_count"] > 0]
    assert future_points
    assert all(
        p["cumulative_actual_pct"] is None for p in future_points
    )


# -----------------------------------------------------
# generate_all
# -----------------------------------------------------

def test_generate_all_produces_every_output(engine, sample_dataframe):

    outputs = engine.generate_all(sample_dataframe)

    for key in [
        "master_spools", "dashboard_summary", "project_summary",
        "weekly_summary", "group_summary", "stage_ageing_summary",
        "fitup_summary", "welding_summary", "s_curve_summary",
        "exceptions",
    ]:
        assert key in outputs
        json.dumps(outputs[key])  # every output must be JSON-safe
