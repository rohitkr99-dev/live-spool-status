"""
Unit tests for summary.py -> generate_dashboard_summary()'s
material_hold_by_project (2026-08-26 - "Hold & MNA data project
wise" chart on the Projects dashboard, from the Weekly Production
Planning workbook's Material/Hold Status column).
"""

import pandas as pd
import pytest

from summary import SummaryEngine
from constants import MATERIAL_HOLD_STATUS


@pytest.fixture
def engine():
    return SummaryEngine()


def _row(**overrides):
    base = {
        "Composite Key": "P001|D001|S001", "Project Code": "P001",
        "Project Name": "Project One", "Drawing No": "D001", "Spool No": "S001",
        "Current Stage": "PDQC", "Total Age": 10, "Planning Variance": None,
        "Completed": False, "Planned": True, MATERIAL_HOLD_STATUS: None,
    }
    base.update(overrides)
    return base


def test_groups_hold_and_mna_by_project(engine):
    dataframe = pd.DataFrame([
        _row(**{MATERIAL_HOLD_STATUS: "Hold"}),
        _row(**{"Spool No": "S002", MATERIAL_HOLD_STATUS: "MNA"}),
        _row(**{"Spool No": "S003", MATERIAL_HOLD_STATUS: "Hold"}),
        _row(**{"Project Code": "P002", "Project Name": "Project Two",
                 "Spool No": "S001", MATERIAL_HOLD_STATUS: "MNA"}),
    ])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["material_hold_by_project"] == {
        "Project One": {"Hold": 2, "MNA": 1},
        "Project Two": {"Hold": 0, "MNA": 1},
    }


def test_unflagged_spools_excluded_and_projects_with_none_omitted(engine):
    dataframe = pd.DataFrame([
        _row(),
        _row(**{"Spool No": "S002", "Project Name": "Project Two"}),
    ])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["material_hold_by_project"] == {}


def test_missing_column_is_safe(engine):
    dataframe = pd.DataFrame([{
        "Composite Key": "P001|D001|S001", "Project Code": "P001",
        "Project Name": "Project One", "Drawing No": "D001", "Spool No": "S001",
        "Current Stage": "PDQC", "Total Age": 10, "Planning Variance": None,
        "Completed": False, "Planned": True,
    }])

    result = engine.generate_dashboard_summary(dataframe)

    assert result["material_hold_by_project"] == {}
