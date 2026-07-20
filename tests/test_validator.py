"""
Unit tests for validator.py
"""

import pandas as pd
import pytest

from validator import DataValidator, ValidationResult


@pytest.fixture
def validator():
    """
    Create a validator instance.
    """
    return DataValidator()


@pytest.fixture
def fabrication_dataframe():
    """
    Create a valid fabrication dataframe based on schema.json.
    """

    return pd.DataFrame(
        {
            "Project Code": ["P001"],
            "Drawing No": ["D001"],
            "Spool No": ["S001"],
            "Material": ["CS"],
            "Total Joints": [6],
            "PDQC": ["2026-07-01"],
            "RFP": ["2026-07-02"],
            "PDI": ["2026-07-03"],
            "Packing": ["2026-07-04"],
            "Dispatch": ["2026-07-05"],
        }
    )


def test_validation_result_defaults():

    result = ValidationResult()

    assert result.passed is True
    assert result.errors == []
    assert result.warnings == []


def test_empty_dataframe(validator):

    dataframe = pd.DataFrame()

    result = validator.validate_dataframe(
        dataframe,
        "fabrication",
    )

    assert result.passed is False
    assert len(result.errors) == 1


def test_unknown_dataset(validator, fabrication_dataframe):

    result = validator.validate_dataframe(
        fabrication_dataframe,
        "unknown",
    )

    assert result.passed is False
    assert "Unknown dataset" in result.errors[0]


def test_duplicate_columns(validator):

    dataframe = pd.DataFrame(
        columns=[
            "Project Code",
            "Project Code",
            "Drawing No",
            "Spool No",
        ]
    )

    result = ValidationResult()

    validator.check_duplicate_columns(
        dataframe,
        result,
    )

    assert len(result.warnings) == 1


def test_duplicate_spools(validator):

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1"],
            "Drawing No": ["D1", "D1"],
            "Spool No": ["S1", "S1"],
        }
    )

    result = ValidationResult()

    validator.check_duplicate_spools(
        dataframe,
        "fabrication",
        result,
    )

    assert len(result.warnings) == 1


def test_duplicate_spools_skipped_for_transactional_dataset(validator):
    """
    Fit-Up DB / Welding DB legitimately have one row per joint - the
    same composite key repeating must NOT be flagged as a duplicate.
    """

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1", "P1"],
            "Drawing No": ["D1", "D1", "D1"],
            "Spool No": ["S1", "S1", "S1"],
        }
    )

    result = ValidationResult()

    validator.check_duplicate_spools(
        dataframe,
        "planning_fitup",
        result,
    )

    assert len(result.warnings) == 0


def test_missing_values(validator):

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1"],
            "Drawing No": [None],
            "Spool No": ["S1"],
            "Material": ["CS"],
            "Total Joints": [3],
            "PDQC": [None],
            "RFP": [None],
            "PDI": [None],
            "Packing": [None],
            "Dispatch": [None],
        }
    )

    result = ValidationResult()

    validator.check_missing_values(
        dataframe,
        "fabrication",
        result,
    )

    assert len(result.warnings) >= 1


def test_invalid_dates(validator):

    dataframe = pd.DataFrame(
        {
            "PDQC": [
                "2026-07-01",
                "INVALID DATE",
            ]
        }
    )

    result = ValidationResult()

    validator.check_date_columns(
        dataframe,
        result,
    )

    assert len(result.warnings) == 1


def test_validation_passes_for_valid_dataframe(
    validator,
    fabrication_dataframe,
):

    result = validator.validate_dataframe(
        fabrication_dataframe,
        "fabrication",
    )

    assert isinstance(
        result,
        ValidationResult,
    )
    assert result.passed is True


def test_validation_planning_fitup_required_columns(validator):
    """
    planning_fitup must be validated against fitup_required_columns
    (Activity Date), not master_planning_required_columns (Week,
    Group, Planned Start) - those don't exist in Fit-Up DB.
    """

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1"],
            "Drawing No": ["D1"],
            "Spool No": ["S1"],
            "Activity Date": ["2026-01-01"],
        }
    )

    result = validator.validate_dataframe(
        dataframe,
        "planning_fitup",
    )

    assert result.passed is True


def test_validation_planning_master_missing_week(validator):

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1"],
            "Drawing No": ["D1"],
            "Spool No": ["S1"],
            "Planned Start": ["2026-01-01"],
        }
    )

    result = validator.validate_dataframe(
        dataframe,
        "planning_master",
    )

    assert result.passed is False
    assert any("Week" in error for error in result.errors)
