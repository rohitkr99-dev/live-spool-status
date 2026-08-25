"""
Unit tests for merge.py -> MergeEngine.apply_material_hold_status()
(2026-08-26 - Weekly Production Planning workbook's Master Planning
Sheet column BJ, "Material/Hold Status").
"""

import pandas as pd
import pytest

from merge import MergeEngine
from constants import MATERIAL_HOLD_STATUS, MATERIAL_HOLD_STATUS_RAW


@pytest.fixture
def engine():
    return MergeEngine()


def _master(raw_values):
    return pd.DataFrame({MATERIAL_HOLD_STATUS_RAW: raw_values})


def test_hold_spool_normalizes_to_hold(engine):
    result = engine.apply_material_hold_status(_master(["3. Hold Spool"]))
    assert result.iloc[0][MATERIAL_HOLD_STATUS] == "Hold"


def test_mna_spool_normalizes_to_mna(engine):
    result = engine.apply_material_hold_status(_master(["2. MNA Spool"]))
    assert result.iloc[0][MATERIAL_HOLD_STATUS] == "MNA"


def test_confirm_from_production_normalizes_to_none(engine):
    result = engine.apply_material_hold_status(_master(["1. Confirm from Production"]))
    assert result.iloc[0][MATERIAL_HOLD_STATUS] is None


def test_blank_normalizes_to_none(engine):
    result = engine.apply_material_hold_status(_master([None]))
    assert result.iloc[0][MATERIAL_HOLD_STATUS] is None


def test_missing_raw_column_is_a_safe_no_op(engine):
    master = pd.DataFrame({"Some Other Column": [1, 2]})
    result = engine.apply_material_hold_status(master)
    assert MATERIAL_HOLD_STATUS not in result.columns


def test_mixed_batch(engine):
    result = engine.apply_material_hold_status(_master([
        "1. Confirm from Production", "2. MNA Spool", "3. Hold Spool", None,
    ]))
    values = [v if pd.notna(v) else None for v in result[MATERIAL_HOLD_STATUS]]
    assert values == [None, "MNA", "Hold", None]
