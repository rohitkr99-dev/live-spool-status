"""
Unit tests for the Spool Traveler stage dates (2026-10-08): the FQC
column read by Excel column letter, and the Material Handover date
joined onto the master spool dataset.
"""

import pandas as pd
import pytest

from merge import MergeEngine
from reader import extract_column_by_letter


@pytest.fixture
def engine():
    return MergeEngine()


def _wide_frame(columns: int = 60) -> pd.DataFrame:
    frame = pd.DataFrame([[i for i in range(columns)]], columns=[f"c{i}" for i in range(columns)])
    return frame


def test_extract_column_by_letter_reads_the_right_position():
    frame = _wide_frame()

    result = extract_column_by_letter(frame, "BE", "FQC", "dpr.xlsb")

    # BE is the 57th column, i.e. index 56.
    assert result.iloc[0] == 56
    assert result.name == "c56"


def test_extract_column_by_letter_handles_narrow_sheet_and_no_letter():
    frame = _wide_frame(columns=20)

    assert extract_column_by_letter(frame, "BE", "FQC", "dpr.xlsb") is None
    assert extract_column_by_letter(frame, None, "FQC", "dpr.xlsb") is None
    assert extract_column_by_letter(frame, "", "FQC", "dpr.xlsb") is None


def _master() -> pd.DataFrame:
    return pd.DataFrame([
        {"Composite Key": "P1|D1|S1", "Project Code": "P1", "Drawing No": "D1", "Spool No": "S1"},
        {"Composite Key": "P1|D2|S1", "Project Code": "P1", "Drawing No": "D2", "Spool No": "S1"},
        {"Composite Key": "P2|D1|S9", "Project Code": "P2", "Drawing No": "D1", "Spool No": "S9"},
    ])


def test_material_handover_is_joined_per_full_spool_key(engine):
    mh = pd.DataFrame([
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1", "MH Handover Date": pd.Timestamp("2026-06-01")},
        # Same spool number on another drawing must not pick this up.
        {"Project Code": "P1", "Drawing No": "D2", "Spool No": "S1", "MH Handover Date": pd.NaT},
    ])

    result = engine.apply_material_handover(_master(), mh).set_index("Composite Key")

    assert result.loc["P1|D1|S1", "Material Handover"] == pd.Timestamp("2026-06-01")
    assert pd.isna(result.loc["P1|D2|S1", "Material Handover"])
    assert pd.isna(result.loc["P2|D1|S9", "Material Handover"])
    assert len(result) == 3


def test_material_handover_duplicate_rows_use_latest_date(engine):
    mh = pd.DataFrame([
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1", "MH Handover Date": pd.Timestamp("2026-06-01")},
        {"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1", "MH Handover Date": pd.Timestamp("2026-06-09")},
    ])

    result = engine.apply_material_handover(_master(), mh).set_index("Composite Key")

    assert result.loc["P1|D1|S1", "Material Handover"] == pd.Timestamp("2026-06-09")
    assert len(result) == 3


def test_material_handover_is_a_no_op_without_usable_data(engine):
    master = _master()

    assert engine.apply_material_handover(master, None).equals(master)
    assert engine.apply_material_handover(master, pd.DataFrame()).equals(master)
    no_date_column = pd.DataFrame([{"Project Code": "P1", "Drawing No": "D1", "Spool No": "S1"}])
    assert engine.apply_material_handover(master, no_date_column).equals(master)
