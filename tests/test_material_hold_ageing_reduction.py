"""
Unit tests for merge.py -> MergeEngine.apply_material_hold_ageing_reduction()
(2026-08-26 - Weekly Production Planning workbook's "Week Planned" /
"Initial Week Planned" gap, given by the person).
"""

from datetime import date

import pandas as pd
import pytest

from merge import MergeEngine
from constants import INITIAL_WEEK_PLANNED, MATERIAL_HOLD_WORKING_DAYS_LOST


@pytest.fixture
def engine():
    return MergeEngine()


def _master(week, initial_week):
    return pd.DataFrame({"Week": [week], INITIAL_WEEK_PLANNED: [initial_week]})


def test_two_week_gap_computes_working_days(engine):
    result = engine.apply_material_hold_ageing_reduction(_master("Week 12", "Week 10"))
    value = result.iloc[0][MATERIAL_HOLD_WORKING_DAYS_LOST]
    assert value is not None
    assert value >= 0
    # Two full weeks apart - somewhere around 9-10 working days
    # depending on holidays in that span (see utils.working_day_variance).
    assert 8 <= value <= 10


def test_same_week_gives_zero(engine):
    result = engine.apply_material_hold_ageing_reduction(_master("Week 5", "Week 5"))
    assert result.iloc[0][MATERIAL_HOLD_WORKING_DAYS_LOST] == 0


def test_earlier_week_planned_floors_at_zero(engine):
    """A spool whose Week Planned somehow precedes its Initial Week
    Planned (shouldn't normally happen) never produces a negative -
    given by the person: "In case if subtraction results in
    negative, make it zero."."""

    result = engine.apply_material_hold_ageing_reduction(_master("Week 5", "Week 10"))
    assert result.iloc[0][MATERIAL_HOLD_WORKING_DAYS_LOST] == 0


def test_missing_week_columns_are_a_safe_no_op(engine):
    master = pd.DataFrame({"Some Other Column": [1, 2]})
    result = engine.apply_material_hold_ageing_reduction(master)
    assert MATERIAL_HOLD_WORKING_DAYS_LOST not in result.columns


def test_blank_initial_week_gives_none(engine):
    result = engine.apply_material_hold_ageing_reduction(_master("Week 12", None))
    assert pd.isna(result.iloc[0][MATERIAL_HOLD_WORKING_DAYS_LOST])
