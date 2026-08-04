"""
Unit tests for the multi-file "read every matching workbook, latest
file wins on overlap" behaviour - utils.extract_file_period() and
reader.ExcelReader._merge_latest_wins() /
_matching_files_oldest_first().
"""

from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from reader import ExcelReader
from utils import extract_file_period


@pytest.fixture
def reader():
    """Create a reader instance."""
    return ExcelReader()


# -----------------------------------------------------
# extract_file_period
# -----------------------------------------------------

REFERENCE_DATE = date(2026, 8, 4)


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("1. DPR_Fabrication Jobs_July'26.xlsb", (2026, 7, 1)),
        ("DPR_Fabrication_Jobs_July_26.xlsb", (2026, 7, 1)),
        ("Weekly_Production_Planning_Sheet_July'26.xlsb", (2026, 7, 1)),
        ("Line History Sheet 27-07-2026.xlsb", (2026, 7, 27)),
        ("March_SIOP_Planned_Spools.xlsb", (2026, 3, 1)),
        ("August SIOP Planned Spools.xlsb", (2026, 8, 1)),
        ("DPR_Fabrication_Jobs_December.xlsb", (2025, 12, 1)),
        ("random_no_date.xlsb", (0, 0, 0)),
    ],
)
def test_extract_file_period(filename, expected):
    """Filenames are parsed into a sortable (year, month, day)."""

    assert extract_file_period(filename, REFERENCE_DATE) == expected


def test_extract_file_period_unparseable_sorts_oldest():
    """
    A filename with no recognisable date must sort BEFORE every real
    date, so it's never mistaken for the newest file in a merge.
    """

    unparseable = extract_file_period("random_no_date.xlsb", REFERENCE_DATE)
    dated = extract_file_period("August SIOP Planned Spools.xlsb", REFERENCE_DATE)

    assert unparseable < dated


def test_extract_file_period_full_date_beats_month_only():
    """
    A filename with an exact day (Line History Sheet's DD-MM-YYYY)
    should sort after a month-only filename for the same month, since
    a month-only file could be from any day in that month.
    """

    month_only = extract_file_period("Weekly_July_26.xlsb", REFERENCE_DATE)
    exact_day = extract_file_period("Line History Sheet 27-07-2026.xlsb", REFERENCE_DATE)

    assert month_only < exact_day


# -----------------------------------------------------
# ExcelReader._matching_files_oldest_first
# -----------------------------------------------------

def test_matching_files_oldest_first(reader, tmp_path):
    """Files matching a glob pattern come back oldest-period first."""

    (tmp_path / "DPR_Fabrication_Jobs_August_26.xlsb").touch()
    (tmp_path / "DPR_Fabrication_Jobs_March_26.xlsb").touch()
    (tmp_path / "DPR_Fabrication_Jobs_June_26.xlsb").touch()

    files = reader._matching_files_oldest_first(tmp_path, "*DPR*.xlsb")

    assert [f.name for f in files] == [
        "DPR_Fabrication_Jobs_March_26.xlsb",
        "DPR_Fabrication_Jobs_June_26.xlsb",
        "DPR_Fabrication_Jobs_August_26.xlsb",
    ]


# -----------------------------------------------------
# ExcelReader._merge_latest_wins
# -----------------------------------------------------

def _spool_row(project, drawing, spool, **extra):
    return {
        "Project Code": project,
        "Drawing No": drawing,
        "Spool No": spool,
        **extra,
    }


def test_merge_latest_wins_prefers_newest_file_for_overlap(reader):
    """
    A spool present in both an older and a newer file must end up
    with the NEWER file's row.
    """

    older = pd.DataFrame([
        _spool_row("TJ/25-26/183", "DRW-01", "SPOOL-01", status="Old"),
    ])
    newer = pd.DataFrame([
        _spool_row("TJ/25-26/183", "DRW-01", "SPOOL-01", status="New"),
    ])

    merged = reader._merge_latest_wins(
        [older, newer], reader.schema_composite_key()
    )

    assert len(merged) == 1
    assert merged.iloc[0]["status"] == "New"


def test_merge_latest_wins_keeps_spool_only_in_older_file(reader):
    """
    A spool that only exists in an older file (e.g. a since-closed
    project dropped from the newest workbook) must still be kept.
    """

    older = pd.DataFrame([
        _spool_row("TJ/25-26/999", "CLOSED-DRW", "CLOSED-SPOOL-01"),
    ])
    newer = pd.DataFrame([
        _spool_row("TJ/25-26/200", "NEW-DRW", "NEW-SPOOL-01"),
    ])

    merged = reader._merge_latest_wins(
        [older, newer], reader.schema_composite_key()
    )

    spool_numbers = set(merged["Spool No"])
    assert "CLOSED-SPOOL-01" in spool_numbers
    assert "NEW-SPOOL-01" in spool_numbers
    assert len(merged) == 2


def test_merge_latest_wins_does_not_collapse_blank_key_rows(reader):
    """
    Rows missing one or more key columns (blank filler rows) should
    not be deduplicated against each other just because they share an
    empty key - that would wrongly collapse many unrelated blank rows
    into one before cleaner.py's own blank-row removal runs.
    """

    older = pd.DataFrame([
        _spool_row(None, None, None),
        _spool_row("TJ/25-26/183", "DRW-01", "SPOOL-01"),
    ])
    newer = pd.DataFrame([
        _spool_row(None, None, None),
    ])

    merged = reader._merge_latest_wins(
        [older, newer], reader.schema_composite_key()
    )

    # Both blank rows survive (2), plus the one real spool row.
    assert len(merged) == 3


def test_merge_latest_wins_missing_key_columns_just_concatenates(reader):
    """
    If the key columns aren't present at all, fall back to a plain
    concatenation rather than erroring - downstream duplicate
    handling is left to cleaner.py, same as before this change.
    """

    frame_a = pd.DataFrame([{"Some Column": 1}])
    frame_b = pd.DataFrame([{"Some Column": 2}])

    merged = reader._merge_latest_wins(
        [frame_a, frame_b], reader.schema_composite_key()
    )

    assert len(merged) == 2
