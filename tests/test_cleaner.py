"""
Unit tests for cleaner.py
"""

import pandas as pd
import pytest

from cleaner import CleaningResult, DataCleaner


@pytest.fixture
def cleaner():
    """Create a cleaner instance."""
    return DataCleaner()


@pytest.fixture
def sample_dataframe():
    """Return a sample dataframe for cleaning tests."""

    return pd.DataFrame(
        {
            "Project Code": [" P001 ", "P001", None],
            "Drawing No": ["D001", "D001", None],
            "Spool No": ["S001", "S001", None],
            "PDQC": [
                "2026-07-01",
                "INVALID DATE",
                None,
            ],
        }
    )


def test_cleaning_result_defaults():
    """CleaningResult should initialise correctly."""

    result = CleaningResult()

    assert result.original_rows == 0
    assert result.final_rows == 0
    assert result.blank_rows_removed == 0
    assert result.duplicate_rows_removed == 0
    assert result.invalid_dates_found == 0
    assert result.text_fields_trimmed == 0


def test_remove_blank_rows(cleaner):
    """Completely blank rows should be removed."""

    dataframe = pd.DataFrame(
        [
            ["P1", "D1"],
            [None, None],
            ["P2", "D2"],
        ],
        columns=["Project Code", "Drawing No"],
    )

    cleaned, removed = cleaner.remove_blank_rows(dataframe)

    assert removed == 1
    assert len(cleaned) == 2


def test_trim_text_columns(cleaner):
    """Leading and trailing spaces should be removed."""

    dataframe = pd.DataFrame(
        {
            "Project Code": [" P001 "],
            "Drawing No": [" D001 "],
        }
    )

    cleaned, trimmed = cleaner.trim_text_columns(dataframe)

    assert cleaned.loc[0, "Project Code"] == "P001"
    assert cleaned.loc[0, "Drawing No"] == "D001"
    assert trimmed > 0


def test_trim_text_columns_does_not_stringify_none(cleaner):
    """
    Regression test: trim_text_columns must never turn a blank cell
    into the literal text "None" - that silently breaks every
    is_empty() check downstream (Rule 0's Production Order Not
    Released, the Line History Sheet override's blank-date checks,
    etc.) for any column that mixes real strings with genuinely
    blank cells - which is most real-world text columns.
    """

    dataframe = pd.DataFrame(
        {
            "Remarks": ["  hello  ", None, "world"],
        }
    )

    cleaned, trimmed = cleaner.trim_text_columns(dataframe)

    assert cleaned.loc[0, "Remarks"] == "hello"
    assert cleaned.loc[1, "Remarks"] is None
    assert cleaned.loc[2, "Remarks"] == "world"
    assert trimmed == 1  # only the row that actually had whitespace


def test_trim_text_columns_does_not_stringify_nan(cleaner):
    """Same regression, but for float NaN (what pandas normally uses
    for a blank cell read out of Excel), not python None."""

    dataframe = pd.DataFrame(
        {
            "Remarks": ["  hello  ", float("nan"), "world"],
        }
    )

    cleaned, trimmed = cleaner.trim_text_columns(dataframe)

    assert cleaned.loc[0, "Remarks"] == "hello"
    assert pd.isna(cleaned.loc[1, "Remarks"])
    assert cleaned.loc[2, "Remarks"] == "world"
    assert trimmed == 1


def test_replace_blank_strings(cleaner):
    """Blank strings should become pandas.NA."""

    dataframe = pd.DataFrame(
        {
            "Project Code": [""],
            "Drawing No": ["D001"],
        }
    )

    cleaned = cleaner.replace_blank_strings(dataframe)

    assert pd.isna(cleaned.loc[0, "Project Code"])


def test_standardize_dates(cleaner):
    """Invalid dates in a configured stage date field should become NaT."""

    dataframe = pd.DataFrame(
        {
            "PDQC": [
                "2026-07-01",
                "INVALID DATE",
            ]
        }
    )

    cleaned, invalid = cleaner.standardize_dates(dataframe)

    assert invalid == 1
    assert pd.isna(cleaned.loc[1, "PDQC"])


def test_remove_duplicate_records(cleaner):
    """Duplicate spool records should be removed."""

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1"],
            "Drawing No": ["D1", "D1"],
            "Spool No": ["S1", "S1"],
        }
    )

    cleaned, removed = cleaner.remove_duplicate_records(
        dataframe,
        "fabrication",
    )

    assert removed == 1
    assert len(cleaned) == 1


def test_remove_duplicate_records_keeps_most_complete_row(cleaner):
    """
    Regression test: when a spool's Composite Key appears twice - an
    early, mostly-blank snapshot row followed by its later, fully
    updated record - the COMPLETE row must be kept, even though it
    isn't the first one in sheet order. Previously keep="first" kept
    whichever row came first regardless of completeness, which could
    silently report a fully-dispatched spool as e.g. "Fabrication Yet
    to Start" because the near-empty duplicate happened to be listed
    first.
    """

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1"],
            "Drawing No": ["D1", "D1"],
            "Spool No": ["S1", "S1"],
            "Prod Order Release": ["2025-09-16", "2025-09-16"],
            "First Fit-Up": [None, "2025-09-30"],
            "PDQC": [None, "2025-10-17"],
            "Packing": [None, "2026-01-19"],
        }
    )

    cleaned, removed = cleaner.remove_duplicate_records(
        dataframe,
        "fabrication",
    )

    assert removed == 1
    assert len(cleaned) == 1
    assert cleaned.iloc[0]["Packing"] == "2026-01-19"
    assert cleaned.iloc[0]["First Fit-Up"] == "2025-09-30"


def test_remove_duplicate_records_ties_keep_first(cleaner):
    """When duplicate rows are equally (in)complete, sheet order still
    decides, same as the old behaviour."""

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1"],
            "Drawing No": ["D1", "D1"],
            "Spool No": ["S1", "S1"],
            "Remarks": ["first row", "second row"],
        }
    )

    cleaned, removed = cleaner.remove_duplicate_records(
        dataframe,
        "fabrication",
    )

    assert removed == 1
    assert cleaned.iloc[0]["Remarks"] == "first row"


def test_clean_dataframe(cleaner, sample_dataframe):
    """Complete cleaning pipeline should execute."""

    cleaned, result = cleaner.clean_dataframe(
        sample_dataframe,
        "fabrication",
    )

    assert isinstance(result, CleaningResult)
    assert len(cleaned) <= len(sample_dataframe)
    assert result.original_rows == len(sample_dataframe)
    assert result.final_rows == len(cleaned)


def test_clean_dataframe_transactional_skips_duplicate_removal(cleaner):
    """
    Fit-Up DB / Welding DB legitimately have one row per joint - the
    same spool's composite key repeating must NOT be treated as a
    duplicate and dropped.
    """

    dataframe = pd.DataFrame(
        {
            "Project Code": ["P1", "P1", "P1"],
            "Drawing No": ["D1", "D1", "D1"],
            "Spool No": ["S1", "S1", "S1"],
            "Activity Date": [
                "2026-01-01", "2026-01-02", "2026-01-03",
            ],
        }
    )

    cleaned, result = cleaner.clean_dataframe(
        dataframe,
        "planning_fitup",
        is_transactional=True,
    )

    assert len(cleaned) == 3
    assert result.duplicate_rows_removed == 0
