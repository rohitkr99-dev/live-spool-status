"""
Unit tests for the data behind the Projects page's global project filter
(2026-10-16): per-project Fabrication Line numbers in dashboard_summary, and
per-project rows in activity_metrics.
"""

import pandas as pd
import pytest

from activity_metrics import ActivityMetricsEngine
from rework_pdqc_rule import CURRENTLY_ON_HOLD
from summary import SummaryEngine


def _row(project, spool, stage, hold=False):
    return {
        "Composite Key": f"{project}|D1|{spool}",
        "Project Code": project, "Project Name": f"Name {project}",
        "Drawing No": "D1", "Spool No": spool,
        "Week": "Week 1", "Group": "A", "Material": "CS", "Total Joints": 1,
        "Prod Order Release": "2025-12-28", "Planned Start": "2026-01-01",
        "First Fit-Up": "2026-01-05", "First Welding": "2026-01-07",
        "PDQC": None, "RFP": None, "PDI": None, "Packing": None, "Dispatch": None,
        "First Activity Date": "2026-01-05",
        "Current Stage": stage, "Next Stage": None,
        "Stage Age": 1, "Total Age": 5,
        "Completed": False, "Planned": True, "Status Message": "x",
        CURRENTLY_ON_HOLD: hold,
    }


@pytest.fixture
def summary():
    engine = SummaryEngine()
    frame = pd.DataFrame([
        _row("P1", "S1", "Fit-Up"),
        _row("P1", "S2", "Fit-Up", hold=True),     # on hold: not in the line
        _row("P1", "S3", "Welding"),
        _row("P2", "S4", "Fit-Up"),
    ])
    return engine.generate_dashboard_summary(engine.enrich(frame))


def test_by_project_has_each_projects_own_line(summary):
    by_project = summary["by_project"]

    assert set(by_project) == {"P1", "P2"}
    p1 = by_project["P1"]["current_stage_distribution"]
    p2 = by_project["P2"]["current_stage_distribution"]
    assert p1["Fit-Up"] == 1 and p1["Welding"] == 1      # the held spool is excluded
    assert p2["Fit-Up"] == 1 and p2["Welding"] == 0


def test_by_project_adds_up_to_the_all_projects_line(summary):
    overall = summary["current_stage_distribution"]
    stages = [s for s in overall if s != "Spools Planned in Next Week"]

    for stage in stages:
        assert overall[stage] == sum(
            p["current_stage_distribution"].get(stage, 0)
            for p in summary["by_project"].values()
        )


def test_activity_records_are_per_day_and_project():
    engine = ActivityMetricsEngine()
    fitup = pd.DataFrame([
        {"Project Code": "P1", "Activity Date": "2026-01-05", "Inch Dia": 10.0},
        {"Project Code": "P2", "Activity Date": "2026-01-05", "Inch Dia": 4.0},
        {"Project Code": "P1", "Activity Date": "2026-01-05", "Inch Dia": 2.0},
    ])
    welding = pd.DataFrame([
        {"Project Code": "P1", "Activity Date": "2026-01-06", "Inch Dia": 3.0},
    ])
    fabrication = pd.DataFrame(columns=["Project Code", "PDI", "Surface Area Out"])

    records = engine.generate(fitup, welding, fabrication)
    by_key = {(r["date"], r["project_code"]): r for r in records}

    assert by_key[("2026-01-05", "P1")]["fitup_inch_dia"] == 12.0
    assert by_key[("2026-01-05", "P2")]["fitup_inch_dia"] == 4.0
    assert by_key[("2026-01-06", "P1")]["welding_inch_dia"] == 3.0
    # Summing every project for a day gives the old all-projects figure.
    assert sum(r["fitup_inch_dia"] for r in records if r["date"] == "2026-01-05") == 16.0
