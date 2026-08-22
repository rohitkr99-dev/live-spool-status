"""
Unit tests for summary.py -> generate_dashboard_summary()'s Hold
handling (2026-08-21): currently-held spools excluded from
current_stage_distribution, counted instead in the new
hold_by_project_stage cross-tab.
"""

import pandas as pd
import pytest

from summary import SummaryEngine
from rework_pdqc_rule import CURRENTLY_ON_HOLD, REWORK_LATEST_STATUS


@pytest.fixture
def engine():
    return SummaryEngine()


def _row(**overrides):
    base = {
        "Composite Key": "P001|D001|S001", "Project Code": "P001",
        "Project Name": "Project One", "Drawing No": "D001", "Spool No": "S001",
        "Current Stage": "PDQC", "Total Age": 10, "Planning Variance": None,
        "Completed": False, "Planned": True,
        CURRENTLY_ON_HOLD: False, REWORK_LATEST_STATUS: "Accept",
    }
    base.update(overrides)
    return base


def test_held_spool_excluded_from_stage_distribution(engine):
    dataframe = pd.DataFrame([
        _row(),
        _row(**{
            "Composite Key": "P001|D001|S002", "Spool No": "S002",
            "Current Stage": "PDQC", CURRENTLY_ON_HOLD: True,
            REWORK_LATEST_STATUS: "Hold",
        }),
    ])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["current_stage_distribution"]["PDQC"] == 1
    assert result["hold_by_project_stage"] == {"Project One": {"PDQC": 1}}


def test_no_held_spools_gives_empty_hold_breakdown(engine):
    dataframe = pd.DataFrame([_row()])
    result = engine.generate_dashboard_summary(dataframe)

    assert result["hold_by_project_stage"] == {}
    assert result["current_stage_distribution"]["PDQC"] == 1


def test_multiple_projects_and_stages_grouped_correctly(engine):
    dataframe = pd.DataFrame([
        _row(**{
            "Composite Key": "P001|D001|S001", "Project Name": "Project One",
            "Current Stage": "PDQC", CURRENTLY_ON_HOLD: True, REWORK_LATEST_STATUS: "Hold",
        }),
        _row(**{
            "Composite Key": "P001|D001|S002", "Spool No": "S002",
            "Project Name": "Project One", "Current Stage": "PDQC",
            CURRENTLY_ON_HOLD: True, REWORK_LATEST_STATUS: "Hold",
        }),
        _row(**{
            "Composite Key": "P002|D002|S001", "Project Code": "P002",
            "Project Name": "Project Two", "Drawing No": "D002",
            "Current Stage": "Under Painting", CURRENTLY_ON_HOLD: True,
            REWORK_LATEST_STATUS: "Hold",
        }),
    ])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["hold_by_project_stage"] == {
        "Project One": {"PDQC": 2},
        "Project Two": {"Under Painting": 1},
    }
    # All 3 excluded from the normal distribution.
    assert sum(result["current_stage_distribution"].values()) == 0


def test_missing_currently_on_hold_column_is_safe(engine):
    """
    Backward-compat: a dataframe that hasn't gone through
    rework_pdqc_rule.py at all (no Rework workbook this run) should
    not blow up - everything just isn't on hold.
    """

    dataframe = pd.DataFrame([{
        "Composite Key": "P001|D001|S001", "Project Code": "P001",
        "Project Name": "Project One", "Drawing No": "D001", "Spool No": "S001",
        "Current Stage": "PDQC", "Total Age": 10, "Planning Variance": None,
        "Completed": False, "Planned": True,
    }])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["hold_by_project_stage"] == {}
    assert result["current_stage_distribution"]["PDQC"] == 1
