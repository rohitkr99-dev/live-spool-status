"""
Unit tests for ageing.py
"""

from datetime import timedelta

import pandas as pd
import pytest

from ageing import AgeingEngine
from utils import today


@pytest.fixture
def engine():
    return AgeingEngine()


def _iso(days_ago: int) -> str:
    return (today() - timedelta(days=days_ago)).isoformat()


def _row(**overrides):
    base = {
        "Planned": False,
        "Completed": False,
        "Current Stage": "Fit-Up",
        "First Activity Date": None,
        "Planned Start": None,
        "First Fit-Up": None,
        "First Welding": None,
        "PDQC": None,
        "RFP": None,
        "PDI": None,
        "Packing": None,
        "Dispatch": None,
        "Prod Order Release": None,
    }
    base.update(overrides)
    return pd.Series(base)


# -----------------------------------------------------
# Total Age
# -----------------------------------------------------

def test_total_age_uses_planned_start_when_only_anchor_available(engine):

    row = _row(**{
        "Planned Start": _iso(10),
    })

    assert engine.determine_total_age(row) == 10


def test_total_age_uses_first_fitup_when_no_planned_start(engine):

    row = _row(**{
        "First Fit-Up": _iso(7),
    })

    assert engine.determine_total_age(row) == 7


def test_total_age_uses_earliest_of_planned_start_and_first_fitup(engine):
    """
    Regression test: Total Age must compare Planned Start against
    First Fit-Up / First Welding directly and take whichever is
    EARLIEST - not an either/or based on whether the spool is
    "Planned". Here First Fit-Up (20 days ago) is earlier than
    Planned Start (5 days ago), so it must win.
    """

    row = _row(**{
        "Planned": True,
        "Planned Start": _iso(5),
        "First Fit-Up": _iso(20),
    })

    assert engine.determine_total_age(row) == 20


def test_total_age_uses_earliest_of_all_three_anchor_fields(engine):

    row = _row(**{
        "Planned Start": _iso(5),
        "First Fit-Up": _iso(3),
        "First Welding": _iso(12),
    })

    assert engine.determine_total_age(row) == 12


def test_total_age_falls_back_to_pdqc_when_no_start_dates(engine):
    """
    If none of Planned Start / First Fit-Up / First Welding are
    available, fall back to the PDQC date.
    """

    row = _row(**{
        "PDQC": _iso(9),
    })

    assert engine.determine_total_age(row) == 9


def test_total_age_falls_back_to_prod_order_release_last(engine):
    """
    If PDQC isn't available either, fall back to Prod Order
    Release date as the final fallback.
    """

    row = _row(**{
        "Prod Order Release": _iso(14),
    })

    assert engine.determine_total_age(row) == 14


def test_total_age_negative_returns_zero(engine):
    """
    A Planned Start in the future (data entry ahead of schedule)
    must not produce a negative age.
    """

    row = _row(**{
        "Planned Start": _iso(-5),
    })

    assert engine.determine_total_age(row) == 0


def test_total_age_no_anchor_returns_zero(engine):

    row = _row()  # every anchor/fallback field is None

    assert engine.determine_total_age(row) == 0


def test_total_age_packed_spool_uses_packed_date_not_today(engine):
    """
    Once a spool is packed, Total Age is frozen as Packed Date -
    Anchor Date, instead of continuing to grow against Today.
    """

    row = _row(**{
        "Planned Start": _iso(40),
        "Packing": _iso(10),
    })

    assert engine.determine_total_age(row) == 30


# -----------------------------------------------------
# Stage Age
# -----------------------------------------------------

def test_stage_age_first_stage_planned_uses_planned_start(engine):

    row = _row(**{
        "Planned": True,
        "Current Stage": "Fit-Up",
        "Planned Start": _iso(4),
    })

    assert engine.determine_stage_age(row) == 4


def test_stage_age_first_stage_unplanned_no_anchor_returns_zero(engine):

    row = _row(**{
        "Planned": False,
        "Current Stage": "Fit-Up",
    })

    assert engine.determine_stage_age(row) == 0


def test_stage_age_uses_previous_stage_date(engine):
    """
    Current Stage = PDQC means Welding is done and PDQC is pending.
    Stage Age should count from the Welding date.
    """

    row = _row(**{
        "Current Stage": "PDQC",
        "First Fit-Up": _iso(20),
        "First Welding": _iso(15),
    })

    assert engine.determine_stage_age(row) == 15


def test_stage_age_zero_when_completed_even_if_dispatch_pending(engine):
    """
    Completed spools always show Stage Age 0, even if Current Stage
    is still "Dispatch" (post-completion tracking).
    """

    row = _row(**{
        "Completed": True,
        "Current Stage": "Dispatch",
        "Packing": _iso(30),
    })

    assert engine.determine_stage_age(row) == 0


def test_stage_age_negative_returns_zero(engine):
    """
    A previous-stage date recorded in the future must not produce
    a negative stage age.
    """

    row = _row(**{
        "Current Stage": "PDQC",
        "First Welding": _iso(-3),
    })

    assert engine.determine_stage_age(row) == 0


# -----------------------------------------------------
# apply() - full dataframe
# -----------------------------------------------------

def test_apply_adds_total_age_and_stage_age(engine):

    dataframe = pd.DataFrame([
        _row(**{
            "Planned": True,
            "Current Stage": "Fit-Up",
            "Planned Start": _iso(6),
        }).to_dict(),
        _row(**{
            "Completed": True,
            "Current Stage": "Completed",
            "Planned": True,
            "Planned Start": _iso(40),
        }).to_dict(),
    ])

    result = engine.apply(dataframe)

    assert "Total Age" in result.columns
    assert "Stage Age" in result.columns

    assert result.loc[0, "Total Age"] == 6
    assert result.loc[0, "Stage Age"] == 6

    assert result.loc[1, "Total Age"] == 40
    assert result.loc[1, "Stage Age"] == 0
