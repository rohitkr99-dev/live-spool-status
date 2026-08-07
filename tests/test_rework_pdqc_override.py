"""
Unit tests for merge.py -> MergeEngine.apply_rework_pdqc_override()
"""

import pandas as pd
import pytest

from merge import MergeEngine


@pytest.fixture
def engine():
    return MergeEngine()


def _master(rows):
    return pd.DataFrame(rows)


def test_rework_none_returns_master_unchanged(engine):

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01"},
    ])

    result = engine.apply_rework_pdqc_override(master, None)

    assert result["PDQC"].tolist() == ["2026-01-01"]


def test_rework_empty_returns_master_unchanged(engine):

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01"},
    ])

    result = engine.apply_rework_pdqc_override(master, pd.DataFrame())

    assert result["PDQC"].tolist() == ["2026-01-01"]


def test_matched_spool_takes_later_offer_date(engine):
    """Rework file's latest offer date is AFTER the existing PDQC ->
    PDQC advances to match it."""

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01"},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-10")},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-01-10")


def test_matched_spool_takes_latest_of_multiple_offer_rows(engine):
    """A spool offered more than once (rework cycles) -> the MAX
    offer date wins, not the first or last row in the file."""

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": None},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-05")},
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-20")},
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-12")},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-01-20")


def test_pdqc_never_regresses_when_file_date_is_earlier(engine):
    """Rework file's latest offer date is BEFORE the existing PDQC ->
    the existing (later) PDQC is kept, not overwritten."""

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-02-01"},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-10")},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-02-01")


def test_unmatched_spool_keeps_existing_pdqc_unchanged(engine):

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01"},
        {"Project Code": "P002", "Drawing No": "D002", "Spool No": "S002",
         "Composite Key": "P002|D002|S002", "PDQC": "2026-03-03"},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-01-15")},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    row_p002 = result[result["Project Code"] == "P002"].iloc[0]
    assert pd.Timestamp(row_p002["PDQC"]) == pd.Timestamp("2026-03-03")


def test_missing_prod_offer_date_column_is_a_noop(engine):

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": "2026-01-01"},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Some Other Column": "x"},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    assert result["PDQC"].tolist() == ["2026-01-01"]


def test_blank_pdqc_gets_filled_from_rework_date(engine):

    master = _master([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Composite Key": "P001|D001|S001", "PDQC": None},
    ])

    rework = pd.DataFrame([
        {"Project Code": "P001", "Drawing No": "D001", "Spool No": "S001",
         "Prod Offer Date": pd.Timestamp("2026-04-04")},
    ])

    result = engine.apply_rework_pdqc_override(master, rework)

    assert pd.Timestamp(result.iloc[0]["PDQC"]) == pd.Timestamp("2026-04-04")
