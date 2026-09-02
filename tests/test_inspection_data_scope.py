"""
Unit tests for src/quality/summary.py's
scope_inspection_data_to_current_cycle() (2026-09-02).

Correcting an earlier mistake this same session: the person's actual
instruction was "current fiscal cycle only, EXCEPT these 8 named
projects, which should reach back into older sheets too" - an
earlier pass applied full history to every project instead of just
the named ones, confirmed by the person directly ("But I think you
have considered every sheet from this excel. Am I right?").

Uses the real fiscal-cycle start (utils.week_number_to_start_date(1,
today())) rather than a hardcoded date, so these tests keep passing
after the cycle rolls over to FY27/28.
"""

from datetime import timedelta

import pandas as pd
import pytest

from quality.summary import (
    NAMED_PROJECT_CODES_WITH_FULL_HISTORY,
    scope_inspection_data_to_current_cycle,
)
from utils import today, week_number_to_start_date

CYCLE_START = pd.Timestamp(week_number_to_start_date(1, today()))
BEFORE_CYCLE = CYCLE_START - timedelta(days=30)
NAMED_PROJECT = NAMED_PROJECT_CODES_WITH_FULL_HISTORY[0]


def _row(project, spool, offer_date):
    return {
        "Project Code": project,
        "Drawing No": "DRW-01",
        "Spool No": spool,
        "Prod Offer Date": offer_date,
        "Final Status": "Accept",
    }


def test_non_named_project_before_cycle_is_excluded():
    df = pd.DataFrame([_row("TJ/22-23/099", "SPOOL-OLD", BEFORE_CYCLE)])

    result = scope_inspection_data_to_current_cycle(df)

    assert result.empty


def test_non_named_project_on_or_after_cycle_start_is_kept():
    df = pd.DataFrame([_row("TJ/22-23/099", "SPOOL-NEW", CYCLE_START)])

    result = scope_inspection_data_to_current_cycle(df)

    assert len(result) == 1
    assert result.iloc[0]["Spool No"] == "SPOOL-NEW"


def test_named_project_before_cycle_is_kept():
    df = pd.DataFrame([_row(NAMED_PROJECT, "SPOOL-OLD", BEFORE_CYCLE)])

    result = scope_inspection_data_to_current_cycle(df)

    assert len(result) == 1
    assert result.iloc[0]["Spool No"] == "SPOOL-OLD"


def test_named_project_with_unparseable_date_is_still_kept():
    """
    A named project's row passes through regardless of date, even
    one the date parser can't make sense of at all.
    """

    df = pd.DataFrame([_row(NAMED_PROJECT, "SPOOL-BADDATE", None)])

    result = scope_inspection_data_to_current_cycle(df)

    assert len(result) == 1


def test_non_named_project_with_unparseable_date_is_excluded():
    df = pd.DataFrame([_row("TJ/22-23/099", "SPOOL-BADDATE", None)])

    result = scope_inspection_data_to_current_cycle(df)

    assert result.empty


def test_mixed_dataframe_keeps_only_the_correct_rows():
    df = pd.DataFrame([
        _row("TJ/22-23/099", "OLD-NON-NAMED", BEFORE_CYCLE),
        _row("TJ/22-23/099", "NEW-NON-NAMED", CYCLE_START),
        _row(NAMED_PROJECT, "OLD-NAMED", BEFORE_CYCLE),
        _row(NAMED_PROJECT, "NEW-NAMED", CYCLE_START),
    ])

    result = scope_inspection_data_to_current_cycle(df)

    assert set(result["Spool No"]) == {"NEW-NON-NAMED", "OLD-NAMED", "NEW-NAMED"}


def test_empty_dataframe_passes_through_unchanged():
    df = pd.DataFrame(columns=["Project Code", "Prod Offer Date"])

    result = scope_inspection_data_to_current_cycle(df)

    assert result.empty
