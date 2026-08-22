"""
Unit tests for ageing.py's Hold-day subtraction (2026-08-21 - see
hold_ledger.py). Uses AgeingEngine._hold_store directly (already
populated the way apply() populates it) rather than going through a
real hold_tracking.json file, so these stay fast and isolated.
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


def test_total_age_subtracts_closed_hold_period(engine):
    row = pd.Series({
        "Planned": True, "Current Stage": "Fit-Up",
        "Planned Start": _iso(20),
        "Composite Key": "P001|D001|S001",
    })

    without_hold = AgeingEngine()
    without_hold._hold_store = {}
    baseline = without_hold.determine_total_age(row)

    engine._hold_store = {
        "P001|D001|S001": {
            "hold_periods": [
                {
                    "hold_start": (today() - timedelta(days=15)).isoformat(),
                    "hold_removed": (today() - timedelta(days=10)).isoformat(),
                }
            ]
        }
    }
    with_hold = engine.determine_total_age(row)

    assert with_hold < baseline
    assert with_hold >= 0


def test_total_age_ignores_hold_period_outside_window(engine):
    row = pd.Series({
        "Planned": True, "Current Stage": "Fit-Up",
        "Planned Start": _iso(5),
        "Composite Key": "P001|D001|S001",
    })

    engine._hold_store = {
        "P001|D001|S001": {
            "hold_periods": [
                # Hold happened well before this spool's anchor date
                # even started - no overlap, no subtraction.
                {
                    "hold_start": (today() - timedelta(days=60)).isoformat(),
                    "hold_removed": (today() - timedelta(days=50)).isoformat(),
                }
            ]
        }
    }

    no_hold_engine = AgeingEngine()
    no_hold_engine._hold_store = {}

    assert engine.determine_total_age(row) == no_hold_engine.determine_total_age(row)


def test_total_age_subtracts_open_hold_through_today(engine):
    row = pd.Series({
        "Planned": True, "Current Stage": "Fit-Up",
        "Planned Start": _iso(20),
        "Composite Key": "P001|D001|S001",
    })

    no_hold_engine = AgeingEngine()
    no_hold_engine._hold_store = {}
    baseline = no_hold_engine.determine_total_age(row)

    engine._hold_store = {
        "P001|D001|S001": {
            "hold_periods": [
                {"hold_start": (today() - timedelta(days=5)).isoformat(), "hold_removed": None}
            ]
        }
    }

    assert engine.determine_total_age(row) < baseline


def test_missing_composite_key_leaves_age_unchanged(engine):
    row = pd.Series({
        "Planned": True, "Current Stage": "Fit-Up",
        "Planned Start": _iso(10),
    })
    engine._hold_store = {"SOME|OTHER|KEY": {"hold_periods": []}}

    no_hold_engine = AgeingEngine()
    no_hold_engine._hold_store = {}

    assert engine.determine_total_age(row) == no_hold_engine.determine_total_age(row)
