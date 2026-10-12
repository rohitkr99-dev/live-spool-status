"""
Unit tests for ageing.py's Total Age (excl. Hold Period) / Stage Age
(excl. Hold Period) columns (2026-08-26 - given by the person,
explicitly the Material/Hold Status Week-gap figure only, NOT the
Rework Data workbook's Hold ledger - see _exclude_material_hold_days()).
"""

from datetime import timedelta

import pandas as pd
import pytest

from ageing import AgeingEngine
from constants import MATERIAL_HOLD_WORKING_DAYS_LOST
from utils import today


@pytest.fixture
def engine():
    e = AgeingEngine()
    e._hold_store = {}  # no Rework Hold ledger entries in these tests
    return e


def _iso(days_ago: int) -> str:
    return (today() - timedelta(days=days_ago)).isoformat()


def test_total_age_excl_hold_subtracts_material_hold_days_lost(engine):
    row = pd.Series({
        "Planned": True, "Current Stage": "Fit-Up",
        "Planned Start": _iso(50),
        "Composite Key": "P001|D001|S001",
        MATERIAL_HOLD_WORKING_DAYS_LOST: 15,
    })

    raw_total_age = engine.determine_total_age(row)
    excl_hold = engine._exclude_material_hold_days(row, raw_total_age)

    assert excl_hold == raw_total_age - 15


def test_stage_age_excl_hold_ignores_material_hold_days_lost(engine):
    # 2026-10-12, option A: a spool that lost a lot of weeks to material
    # hold earlier must not have its CURRENT stage age wiped to 0.
    dataframe = pd.DataFrame([{
        "Planned": True, "Current Stage": "Under Painting",
        "Completed": False,
        "Planned Start": _iso(120),
        "Composite Key": "P001|D001|S001",
        MATERIAL_HOLD_WORKING_DAYS_LOST: 67,
        "First Fit-Up": _iso(110), "First Welding": _iso(100),
        "PDQC": _iso(40), "RFP": _iso(27), "PDI": None, "Packing": None,
        "Prod Order Release": _iso(130), "First Activity Date": _iso(110),
    }])

    result = engine.apply(dataframe).iloc[0]

    assert result["Stage Age"] > 0
    assert result["Stage Age (excl. Hold Period)"] == result["Stage Age"]
    # Total Age still gets the reduction.
    assert result["Total Age (excl. Hold Period)"] == max(result["Total Age"] - 67, 0)


def test_floors_at_zero_when_days_lost_exceeds_raw_age(engine):
    row = pd.Series({MATERIAL_HOLD_WORKING_DAYS_LOST: 999})
    assert engine._exclude_material_hold_days(row, 5) == 0


def test_no_material_hold_column_leaves_age_unchanged(engine):
    row = pd.Series({"Planned Start": _iso(10)})
    assert engine._exclude_material_hold_days(row, 10) == 10


def test_none_raw_age_stays_none(engine):
    row = pd.Series({MATERIAL_HOLD_WORKING_DAYS_LOST: 5})
    assert engine._exclude_material_hold_days(row, None) is None


def test_apply_adds_both_new_columns_to_dataframe(engine):
    dataframe = pd.DataFrame([{
        "Planned": True, "Current Stage": "Fit-Up",
        "Completed": False,
        "Planned Start": _iso(20),
        "Composite Key": "P001|D001|S001",
        MATERIAL_HOLD_WORKING_DAYS_LOST: 5,
        "First Fit-Up": None, "First Welding": None,
        "PDQC": None, "RFP": None, "PDI": None, "Packing": None,
        "Prod Order Release": None, "First Activity Date": None,
    }])

    result = engine.apply(dataframe)

    assert "Total Age (excl. Hold Period)" in result.columns
    assert "Stage Age (excl. Hold Period)" in result.columns
    assert result.iloc[0]["Total Age (excl. Hold Period)"] == result.iloc[0]["Total Age"] - 5
    assert result.iloc[0]["Stage Age (excl. Hold Period)"] == result.iloc[0]["Stage Age"]
