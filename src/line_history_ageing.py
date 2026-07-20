"""
line_history_ageing.py
---------------------------------------------------------
Shared Fit-Up / Welding / PDQC age calculations.

These three ages have their own, more precise rule (given by the
person, in their own words) that overrides the plain "one date field
minus another" calculation used for every other stage - see
summary.py -> generate_stage_ageing_summary() and ageing.py ->
AgeingEngine.determine_stage_age(), the two callers.

Master Specification
---------------------
Fit-Up Age
    If EVERY joint for a spool has a non-blank Weld FitUp Date in
    the Line History Sheet (merge.py -> summarize_line_history() ->
    LH Fit-Up Age): the last Weld FitUp Date minus the first one.
    Otherwise: fall back to the plain spool-level calculation,
    First Fit-Up - Planned Start.

Welding Age
    The average, across the spool's joints in the Line History
    Sheet, of (Welding FRun Date - Weld FitUp Date) for every joint
    where BOTH dates are present (merge.py -> LH Welding Age).
    Otherwise (no joint has both dates): fall back to the plain
    spool-level calculation, First Welding - First Fit-Up.

PDQC Age
    PDQC date minus the LAST (max) Welding FRun Date across the
    spool's joints - but only once every joint has both a Weld
    FitUp Date and a Welding FRun Date, i.e. the spool is "PDQC" per
    the Line History Sheet (merge.py -> LH Last Welding FRun Date).
    Otherwise - any joint's Fit-Up or Welding date is blank, or the
    spool isn't in the Line History Sheet at all - fall back to
    PDQC date minus the Total Age Anchor (the spool's overall start
    date: earliest of Planned Start / First Fit-Up / First Welding,
    falling back to PDQC / Prod Order Release - see
    config/business_rules.json -> ageing, and ageing.py ->
    AgeingEngine.determine_total_age_anchor_date(), which this
    module's total_age_anchor_date() mirrors exactly so the two
    never drift apart). This is the one case with a DIFFERENT
    fallback (the spool's start date, not a plain Welding date),
    because a partial "last Welding FRun date" computed from an
    incomplete joint list can't be trusted as the true end of
    Welding.

Every function below returns the raw (possibly negative) day count,
or None when it genuinely cannot be computed for that spool (a
missing date somewhere, on both the Line-History path and the
fallback path). Callers decide what to do with None/negative
themselves - the real-time Ageing Engine clamps to 0 like every
other age in the app, while the historical Summary Engine excludes
the spool from that stage's average entirely, exactly as it already
does for ordinary stage-to-stage gaps.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

from constants import (
    FIRST_FITUP,
    FIRST_WELDING,
    LH_FITUP_AGE,
    LH_LAST_WELDING_FRUN,
    LH_WELDING_AGE,
    PDQC,
)
from utils import parse_date


def _lh_value(row: pd.Series, field: str) -> Optional[float]:
    """A Line-History-derived numeric/date field, or None if blank."""

    value = row.get(field)

    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    return value


def _day_gap(
    start: Optional[date],
    end: Optional[date],
) -> Optional[int]:
    """(end - start).days, or None if either date is missing."""

    if start is None or end is None:
        return None

    return (end - start).days


def total_age_anchor_date(
    row: pd.Series,
    anchor_fields: list[str],
    fallback_fields: list[str],
) -> Optional[date]:
    """
    The spool's overall start date - see ageing.py ->
    AgeingEngine.determine_total_age_anchor_date() for the
    authoritative rule. Duplicated here as a standalone function (no
    engine instance required) so the Summary Engine's PDQC Age
    fallback can reuse exactly the same anchor without depending on
    the Ageing Engine.
    """

    candidate_dates = [
        parse_date(row.get(field)) for field in anchor_fields
    ]
    candidate_dates = [
        candidate for candidate in candidate_dates
        if candidate is not None
    ]

    if candidate_dates:
        return min(candidate_dates)

    for field in fallback_fields:
        fallback_date = parse_date(row.get(field))
        if fallback_date is not None:
            return fallback_date

    return None


def fitup_age(row: pd.Series, planned_start_field: str) -> Optional[int]:
    """Fit-Up Age - see module docstring."""

    lh_age = _lh_value(row, LH_FITUP_AGE)
    if lh_age is not None:
        return int(round(lh_age))

    return _day_gap(
        parse_date(row.get(planned_start_field)),
        parse_date(row.get(FIRST_FITUP)),
    )


def welding_age(row: pd.Series) -> Optional[float]:
    """
    Welding Age - see module docstring.

    Unlike Fit-Up Age and PDQC Age (both plain date differences, so
    always a whole number of days), this is an AVERAGE of several
    joints' day counts and is deliberately not rounded to a whole
    day - e.g. 5 joints at 1/3/2/4/2 days average to 2.4, not 2.
    """

    lh_age = _lh_value(row, LH_WELDING_AGE)
    if lh_age is not None:
        return float(lh_age)

    fallback = _day_gap(
        parse_date(row.get(FIRST_FITUP)),
        parse_date(row.get(FIRST_WELDING)),
    )
    return None if fallback is None else float(fallback)


def pdqc_age(
    row: pd.Series,
    anchor_fields: list[str],
    fallback_fields: list[str],
) -> Optional[int]:
    """PDQC Age - see module docstring."""

    pdqc_date = parse_date(row.get(PDQC))

    last_weld_frun = _lh_value(row, LH_LAST_WELDING_FRUN)
    if last_weld_frun is not None:
        return _day_gap(parse_date(last_weld_frun), pdqc_date)

    anchor = total_age_anchor_date(row, anchor_fields, fallback_fields)
    return _day_gap(anchor, pdqc_date)
