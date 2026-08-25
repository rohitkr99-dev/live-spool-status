"""
Unit tests for utils.py's fiscal Week 1 rule (2026-08-27 - given by
the person, correcting an earlier wrong assumption that Week 1 was
always 30th March: it's actually anchored to which weekday 1st April
falls on each year, so it moves - his own two examples:
"1 Apr 2026 is a Wednesday -> Week 1 = 30 Mar 2026 (Monday of that
week)" and "1 Apr 2027 is a Thursday -> that week stays Week 53/52,
new Week 1 (FY28) starts the following Monday, 5 Apr 2027".
"""

from datetime import date

import pytest

from utils import _fiscal_week1_start, fiscal_week_info, week_number_to_start_date


def test_april_1_on_wednesday_keeps_that_weeks_monday():
    assert date(2026, 4, 1).weekday() == 2  # sanity-check: Wednesday
    assert _fiscal_week1_start(2026) == date(2026, 3, 30)


def test_april_1_on_thursday_pushes_to_next_monday():
    assert date(2027, 4, 1).weekday() == 3  # sanity-check: Thursday
    assert _fiscal_week1_start(2027) == date(2027, 4, 5)


def test_april_1_itself_stays_in_previous_cycles_week_52_when_pushed():
    """When 1 April is pushed out (Thu-Sun), that date is still part
    of the OLD fiscal year's last week, not a fresh Week 1."""

    info = fiscal_week_info(date(2027, 4, 1))
    assert info["week_number"] == 52
    assert info["week_start"] == date(2027, 3, 22)


def test_the_following_monday_correctly_starts_the_new_cycle():
    info = fiscal_week_info(date(2027, 4, 5))
    assert info["week_number"] == 1
    assert info["week_start"] == date(2027, 4, 5)


def test_april_1_on_monday_starts_week_1_immediately():
    # 2024-04-01 is a Monday - the boundary case of the <=2 rule.
    assert date(2024, 4, 1).weekday() == 0
    assert _fiscal_week1_start(2024) == date(2024, 4, 1)


def test_april_1_on_saturday_pushes_to_next_monday():
    # 2028-04-01 is a Saturday - the other boundary of the >2 rule.
    assert date(2028, 4, 1).weekday() == 5
    assert _fiscal_week1_start(2028) == date(2028, 4, 3)


def test_week_number_to_start_date_uses_the_correct_years_anchor():
    # A date squarely inside FY27 (started 5 Apr 2027) should resolve
    # Week 1 to that cycle's real anchor, not a naive 30 March guess.
    reference = date(2027, 6, 1)
    assert week_number_to_start_date(1, reference) == date(2027, 4, 5)
