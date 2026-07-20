"""
Unit tests for merge.py
"""

import pandas as pd
import pytest

from merge import MergeEngine


@pytest.fixture
def engine():
    return MergeEngine()


def test_summarize_first_activity_takes_earliest_date(engine):

    fitup_db = pd.DataFrame([
        {
            "Composite Key": "P001|D001|S001",
            "Activity Date": pd.Timestamp("2026-02-10"),
        },
        {
            "Composite Key": "P001|D001|S001",
            "Activity Date": pd.Timestamp("2026-02-05"),
        },
        {
            "Composite Key": "P001|D002|S002",
            "Activity Date": pd.Timestamp("2026-03-01"),
        },
    ])

    result = engine.summarize_first_activity(
        fitup_db,
        "Activity Date",
        "First Fit-Up",
    )

    result = result.set_index("Composite Key")

    assert (
        result.loc["P001|D001|S001", "First Fit-Up"]
        == pd.Timestamp("2026-02-05")
    )
    assert (
        result.loc["P001|D002|S002", "First Fit-Up"]
        == pd.Timestamp("2026-03-01")
    )


def test_merge_produces_one_row_per_fabrication_spool(engine):

    fabrication = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "PDQC": pd.Timestamp("2026-02-10"),
        },
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S002",
            "PDQC": None,
        },
    ])

    planning_master = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Week": "Week 1",
            "Planned Start": pd.Timestamp("2026-01-01"),
            "Group": "A",
        },
    ])

    fitup_db = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Activity Date": pd.Timestamp("2026-01-10"),
        },
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Activity Date": pd.Timestamp("2026-01-05"),
        },
    ])

    welding_db = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Activity Date": pd.Timestamp("2026-01-15"),
        },
    ])

    result = engine.merge(
        fabrication,
        planning_master,
        fitup_db,
        welding_db,
    )

    assert len(result) == 2

    row_s001 = result[result["Spool No"] == "S001"].iloc[0]
    assert row_s001["Week"] == "Week 1"
    assert row_s001["Planned Start"] == pd.Timestamp("2026-01-01")
    assert row_s001["Group"] == "A"
    assert row_s001["First Fit-Up"] == pd.Timestamp("2026-01-05")
    assert row_s001["First Welding"] == pd.Timestamp("2026-01-15")

    row_s002 = result[result["Spool No"] == "S002"].iloc[0]
    assert pd.isna(row_s002["Week"])
    assert pd.isna(row_s002["First Fit-Up"])
    assert pd.isna(row_s002["First Welding"])


def test_merge_does_not_fan_out_rows_when_no_activity(engine):
    """
    A spool with no fitup/welding activity yet, and no planning row,
    should still produce exactly one row in the master dataset.
    """

    fabrication = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S999",
        },
    ])

    empty = pd.DataFrame(columns=["Project Code", "Drawing No", "Spool No"])

    result = engine.merge(fabrication, empty, empty, empty)

    assert len(result) == 1


# -----------------------------------------------------
# Line History Sheet -> Line History Stage
# -----------------------------------------------------

def _joint_row(**overrides):
    base = {
        "Project Code": "P001",
        "Drawing No": "D001",
        "Spool No": "S001",
        "Joint No": "SW-1",
        "Weld FitUp Date": pd.Timestamp("2026-01-05"),
        "Welding FRun Date": pd.Timestamp("2026-01-06"),
    }
    base.update(overrides)
    return base


def test_summarize_line_history_none_returns_empty(engine):

    result = engine.summarize_line_history(None)

    assert result.empty
    assert list(result.columns) == [
        "Composite Key",
        "Line History Stage",
        "LH Fit-Up Age",
        "LH Welding Age",
        "LH Last Welding FRun Date",
    ]


def test_summarize_line_history_ignores_blank_joint_no(engine):
    """
    A row with a blank Joint No. (the spool-header row that precedes
    the real joint rows in the sheet) must not affect the result -
    and if it's the ONLY row for a key, that key is absent from the
    summary entirely (falls back to the existing logic).
    """

    dataframe = pd.DataFrame([
        _joint_row(**{"Joint No": "", "Weld FitUp Date": None, "Welding FRun Date": None}),
    ])

    result = engine.summarize_line_history(dataframe)

    assert result.empty


def test_summarize_line_history_fitup_when_any_ag_blank(engine):

    dataframe = pd.DataFrame([
        _joint_row(**{"Joint No": "SW-1", "Weld FitUp Date": pd.Timestamp("2026-01-05")}),
        _joint_row(**{"Joint No": "SW-2", "Weld FitUp Date": None, "Welding FRun Date": None}),
    ])

    result = engine.summarize_line_history(dataframe)
    row = result.set_index("Composite Key").loc["P001|D001|S001"]

    assert row["Line History Stage"] == "Fit-Up"


def test_summarize_line_history_welding_when_ag_filled_al_blank(engine):

    dataframe = pd.DataFrame([
        _joint_row(**{"Joint No": "SW-1"}),
        _joint_row(**{"Joint No": "SW-2", "Welding FRun Date": None}),
    ])

    result = engine.summarize_line_history(dataframe)
    row = result.set_index("Composite Key").loc["P001|D001|S001"]

    assert row["Line History Stage"] == "Welding"


def test_summarize_line_history_pdqc_when_all_filled(engine):

    dataframe = pd.DataFrame([
        _joint_row(**{"Joint No": "SW-1"}),
        _joint_row(**{"Joint No": "SW-2"}),
    ])

    result = engine.summarize_line_history(dataframe)
    row = result.set_index("Composite Key").loc["P001|D001|S001"]

    assert row["Line History Stage"] == "PDQC"


def test_summarize_line_history_disabled_returns_empty(engine):

    engine.line_history_enabled = False

    dataframe = pd.DataFrame([_joint_row()])

    result = engine.summarize_line_history(dataframe)

    assert result.empty


def test_merge_attaches_line_history_stage(engine):

    fabrication = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001"},
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S002"},
    ])
    empty = pd.DataFrame(columns=["Project Code", "Drawing No", "Spool No"])
    line_history = pd.DataFrame([_joint_row(**{"Joint No": "SW-2", "Welding FRun Date": None})])

    result = engine.merge(fabrication, empty, empty, empty, line_history=line_history)

    row_s001 = result[result["Spool No"] == "S001"].iloc[0]
    row_s002 = result[result["Spool No"] == "S002"].iloc[0]

    assert row_s001["Line History Stage"] == "Welding"
    assert pd.isna(row_s002["Line History Stage"])
