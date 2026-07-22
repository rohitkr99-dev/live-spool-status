"""
Unit tests for pipeline.py

Builds a small synthetic .xlsb-equivalent pair of workbooks (via
openpyxl, saved as .xlsx and read through the fabrication/planning
readers with a patched settings config) is overkill for a unit test.
Instead, these tests exercise the pipeline at the level that matters:
validation-failure short-circuiting and validation_report.json
writing, using an already-constructed Pipeline whose sub-engines are
real, driving raw dataframes directly through the same steps run()
would perform.
"""

import json

import pandas as pd
import pytest

from pipeline import Pipeline, PipelineError


@pytest.fixture
def pipeline():
    """
    A real Pipeline, with website publishing switched off by default
    so tests that only redirect paths.processed_folder to tmp_path
    (most of them) don't also write into the real repo's
    website/data/ folder. See test_write_dashboard_bundle_publishes_to_website
    below for a test that explicitly exercises publishing, redirecting
    website_data_folder to tmp_path too.
    """
    instance = Pipeline()
    instance.settings["publishing"]["publish_to_website"] = False
    return instance


@pytest.fixture
def valid_datasets():

    fabrication = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Material": "CS",
            "Total Joints": 4,
            "PDQC": "2026-01-10",
            "RFP": None,
            "PDI": None,
            "Packing": None,
            "Dispatch": None,
        },
    ])

    planning_master = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Week": "Week 1",
            "Group": "A",
            "Planned Start": "2026-01-01",
        },
    ])

    fitup = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Activity Date": "2026-01-05",
        },
    ])

    welding = pd.DataFrame([
        {
            "Project Code": "P001",
            "Drawing No": "D001",
            "Spool No": "S001",
            "Activity Date": "2026-01-06",
        },
    ])

    return {
        "fabrication": fabrication,
        "planning_master": planning_master,
        "planning_fitup": fitup,
        "planning_welding": welding,
    }


# -----------------------------------------------------
# write_validation_report
# -----------------------------------------------------

def test_write_validation_report_creates_valid_json(
    pipeline, valid_datasets, tmp_path,
):

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    validation_results = {
        name: pipeline.validator.validate_dataframe(dataframe, name)
        for name, dataframe in valid_datasets.items()
    }

    filepath = pipeline.write_validation_report(validation_results)

    assert filepath.exists()

    report = json.loads(filepath.read_text())

    assert report["overall_passed"] is True
    assert set(report["datasets"]) == set(valid_datasets)


def test_write_validation_report_records_failure(
    pipeline, valid_datasets, tmp_path,
):

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    broken = dict(valid_datasets)
    broken["fabrication"] = pd.DataFrame()  # empty -> fails validation

    validation_results = {
        name: pipeline.validator.validate_dataframe(dataframe, name)
        for name, dataframe in broken.items()
    }

    filepath = pipeline.write_validation_report(validation_results)
    report = json.loads(filepath.read_text())

    assert report["overall_passed"] is False
    assert report["datasets"]["fabrication"]["passed"] is False
    assert len(report["datasets"]["fabrication"]["errors"]) >= 1


# -----------------------------------------------------
# End-to-end run() using a monkeypatched reader
# -----------------------------------------------------

def test_run_end_to_end_with_valid_data(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: valid_datasets["fabrication"],
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": valid_datasets["planning_fitup"],
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )

    result = pipeline.run()

    assert result["validation_passed"] is True
    assert result["rows_processed"] == 1

    master_spools_path = tmp_path / "master_spools.json"
    assert master_spools_path.exists()

    records = json.loads(master_spools_path.read_text())
    assert len(records) == 1
    assert records[0]["Project Code"] == "P001"


def test_run_stops_on_validation_failure(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    broken_fabrication = valid_datasets["fabrication"].drop(
        columns=["Material"]
    )  # missing a required column -> validation error

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: broken_fabrication,
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": valid_datasets["planning_fitup"],
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )

    with pytest.raises(PipelineError):
        pipeline.run()

    # validation_report.json must still be written even on failure
    report = json.loads((tmp_path / "validation_report.json").read_text())
    assert report["overall_passed"] is False

    # and Merge/Summary must NOT have run
    assert not (tmp_path / "master_spools.json").exists()


def test_transactional_duplicates_survive_the_pipeline(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):
    """
    Regression test: a spool with 3 fit-up joints must still produce
    a correct First Fit-Up (earliest date), not have 2 of the 3 rows
    silently dropped as "duplicates" by the Cleaner.
    """

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    fitup_multi_joint = pd.DataFrame([
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Activity Date": "2026-01-10",
        },
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Activity Date": "2026-01-05",
        },
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Activity Date": "2026-01-15",
        },
    ])

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: valid_datasets["fabrication"],
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": fitup_multi_joint,
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )

    pipeline.run()

    records = json.loads((tmp_path / "master_spools.json").read_text())
    assert records[0]["First Fit-Up"] == "2026-01-05"


def test_line_history_sheet_cannot_hold_back_stage_when_dpr_shows_dispatch_end_to_end(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):
    """
    Regression test for the real bug report: a spool already
    Dispatched in the DPR/Weekly data must not be reported stuck at
    Welding just because the (optional) Line History Sheet shows one
    joint with a blank Welding FRun Date - that's a common, genuine
    gap (e.g. a repair/re-weld joint that only got its run date
    logged), not evidence the spool actually regressed. The Line
    History Sheet can only ADD evidence of progress, never take it
    away.
    """

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    fabrication_with_release = valid_datasets["fabrication"].copy()
    fabrication_with_release["Prod Order Release"] = "2026-01-01"
    fabrication_with_release["Packing"] = "2026-01-18"
    fabrication_with_release["Dispatch"] = "2026-01-20"

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: fabrication_with_release,
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": valid_datasets["planning_fitup"],
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )

    line_history = pd.DataFrame([
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Joint No": "SW-1",
            "Weld FitUp Date": "2026-01-05",
            "Welding FRun Date": "2026-01-06",
        },
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Joint No": "SW-2",
            "Weld FitUp Date": "2026-01-05",
            "Welding FRun Date": None,  # e.g. a repair joint gap
        },
    ])
    monkeypatch.setattr(
        pipeline.reader, "read_line_history",
        lambda: line_history,
    )

    pipeline.run()

    records = json.loads((tmp_path / "master_spools.json").read_text())
    assert records[0]["Current Stage"] == "Completed"
    assert records[0]["Completed"] is True
    assert records[0]["Line History Stage"] == "Welding"


def test_line_history_sheet_advances_stage_ahead_of_dpr_end_to_end(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):
    """
    Complementary case: when the DPR/Weekly data hasn't caught up
    yet (no PDQC/RFP/etc dates), the Line History Sheet's joint-level
    data can still correctly advance a spool past Welding to PDQC.
    """

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    fabrication_with_release = valid_datasets["fabrication"].copy()
    fabrication_with_release["Prod Order Release"] = "2026-01-01"
    fabrication_with_release["PDQC"] = None  # DPR hasn't recorded PDQC yet

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: fabrication_with_release,
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": valid_datasets["planning_fitup"],
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )

    line_history = pd.DataFrame([
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Joint No": "SW-1",
            "Weld FitUp Date": "2026-01-05",
            "Welding FRun Date": "2026-01-06",
        },
        {
            "Project Code": "P001", "Drawing No": "D001",
            "Spool No": "S001", "Joint No": "SW-2",
            "Weld FitUp Date": "2026-01-05",
            "Welding FRun Date": "2026-01-06",  # every joint welded
        },
    ])
    monkeypatch.setattr(
        pipeline.reader, "read_line_history",
        lambda: line_history,
    )

    pipeline.run()

    records = json.loads((tmp_path / "master_spools.json").read_text())
    assert records[0]["Current Stage"] == "PDQC"
    assert records[0]["Line History Stage"] == "PDQC"


def test_missing_line_history_sheet_falls_back_gracefully(
    pipeline, valid_datasets, tmp_path, monkeypatch,
):
    """
    No Line History Sheet uploaded this run (read_line_history
    returns None, as it does when no matching file is found) - the
    pipeline must complete normally using the existing date-field
    logic, not raise.
    """

    pipeline.settings["paths"]["processed_folder"] = str(tmp_path)
    pipeline.summary_engine.settings["paths"]["processed_folder"] = str(tmp_path)

    monkeypatch.setattr(
        pipeline.reader, "read_fabrication",
        lambda: valid_datasets["fabrication"],
    )
    monkeypatch.setattr(
        pipeline.reader, "read_planning",
        lambda: {
            "master_sheet": valid_datasets["planning_master"],
            "fitup_sheet": valid_datasets["planning_fitup"],
            "welding_sheet": valid_datasets["planning_welding"],
        },
    )
    monkeypatch.setattr(
        pipeline.reader, "read_line_history",
        lambda: None,
    )

    result = pipeline.run()

    assert result["validation_passed"] is True

    records = json.loads((tmp_path / "master_spools.json").read_text())
    assert records[0]["Project Code"] == "P001"


# -----------------------------------------------------
# write_dashboard_bundle - website publishing
# -----------------------------------------------------

def test_write_dashboard_bundle_publishes_to_website(pipeline, tmp_path):
    """
    When publishing.publish_to_website is true, the bundle must be
    written BOTH to processed/dashboard_data.json AND to
    website_data_folder/dashboard_data.json (byte-for-byte the same
    content) - the second copy is what a hosted site auto-loads for
    every viewer.
    """

    processed_folder = tmp_path / "processed"
    website_data_folder = tmp_path / "website_data"

    pipeline.settings["paths"]["processed_folder"] = str(processed_folder)
    pipeline.settings["paths"]["website_data_folder"] = str(website_data_folder)
    pipeline.settings["publishing"]["publish_to_website"] = True

    summary_outputs = {
        "master_spools": [{"Spool No": "S001"}],
        "dashboard_summary": {"kpis": {"total_spools": 1}},
        "project_summary": [],
        "weekly_summary": [],
        "group_summary": [],
        "stage_ageing_summary": [],
        "s_curve_summary": {},
        "exceptions": [],
    }

    processed_path = pipeline.write_dashboard_bundle(summary_outputs, [])
    published_path = website_data_folder / "dashboard_data.json"

    assert processed_path.exists()
    assert published_path.exists()
    assert processed_path.read_text() == published_path.read_text()

    published = json.loads(published_path.read_text())
    assert published["master_spools"][0]["Spool No"] == "S001"


def test_write_dashboard_bundle_skips_publishing_when_disabled(pipeline, tmp_path):
    """publish_to_website: false must leave website_data_folder untouched."""

    processed_folder = tmp_path / "processed"
    website_data_folder = tmp_path / "website_data"

    pipeline.settings["paths"]["processed_folder"] = str(processed_folder)
    pipeline.settings["paths"]["website_data_folder"] = str(website_data_folder)
    pipeline.settings["publishing"]["publish_to_website"] = False

    pipeline.write_dashboard_bundle({
        "master_spools": [], "dashboard_summary": {}, "project_summary": [],
        "weekly_summary": [], "group_summary": [], "stage_ageing_summary": [],
        "s_curve_summary": {}, "exceptions": [],
    }, [])

    assert not website_data_folder.exists()
