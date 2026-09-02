"""
Unit tests for src/quality/summary.py's Inspection Data classifier
(_normalize_inspection_status / _with_inspection_status, 2026-09-02)
and the 5 Overview functions that now read from it: build_kpis,
build_first_offer_split, build_rework_by_project, build_rework_trend,
build_rework_cycles.

Per the person's explicit rule: "accept" -> Accept, "hold" -> Other,
anything else (a specific defect-type reason, blank, ...) -> Rework.
This is deliberately independent of src/rework_pdqc_rule.py, which
must be unaffected by anything here - see module docstring in
summary.py.
"""

import pandas as pd
import pytest

from constants import INSPECTION_REOFFERED_BEFORE_ACCEPT
from quality.summary import (
    _normalize_inspection_status,
    _with_inspection_status,
    build_first_offer_split,
    build_kpis,
    build_rework_by_project,
    build_rework_cycles,
)

SPOOL_KEY_COLUMNS = ["Project Code", "Drawing No", "Spool No"]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Accept", "Accept"),
        ("accept", "Accept"),
        (" ACCEPT ", "Accept"),
        ("Hold", "Other"),
        ("hold", "Other"),
        (" HOLD ", "Other"),
        ("Rework", "Rework"),
        ("Bend", "Rework"),
        ("Not Found", "Rework"),
        ("Punching", "Rework"),
        (None, "Rework"),
        (float("nan"), "Rework"),
        ("", "Rework"),
        ("   ", "Rework"),
    ],
)
def test_normalize_inspection_status(raw, expected):
    assert _normalize_inspection_status(raw) == expected


def _row(project, drawing, spool, offer_date, status):
    return {
        "Project Code": project,
        "Drawing No": drawing,
        "Spool No": spool,
        "Prod Offer Date": pd.Timestamp(offer_date),
        "Final Status": status,
    }


def _sample_dataframe():
    return pd.DataFrame([
        _row("TJ/25-26/183", "DRW-01", "SPOOL-01", "2026-08-01", "Accept"),
        _row("TJ/25-26/183", "DRW-02", "SPOOL-02", "2026-08-01", "Bend"),
        _row("TJ/25-26/183", "DRW-02", "SPOOL-02", "2026-08-05", "Accept"),
        _row("TJ/25-26/183", "DRW-03", "SPOOL-03", "2026-08-02", "Hold"),
        _row("TJ/25-26/184", "DRW-04", "SPOOL-04", "2026-08-03", "Not Found"),
    ])


def test_build_kpis_buckets_accept_rework_and_hold_as_other():
    df = _sample_dataframe()
    cycles = build_rework_cycles(df)
    kpis = build_kpis(df, cycles)

    assert kpis["total_spools"] == 4
    assert kpis["total_offer_events"] == 5
    assert kpis["rework_events"] == 2  # Bend, Not Found
    assert kpis["other_status_events"] == 1  # Hold
    assert kpis["overall_rework_rate_pct"] == 40.0


def test_first_offer_split_uses_earliest_offer_per_spool():
    df = _sample_dataframe()
    split = build_first_offer_split(df)

    # SPOOL-02's FIRST offer was "Bend" (2026-08-01), even though it
    # was later accepted on 2026-08-05 - first-offer outcome must
    # reflect the original disposition, not the eventual one.
    assert split["total_spools"] == 4
    assert split["needed_rework"] == 2  # SPOOL-02 (Bend), SPOOL-04 (Not Found)
    assert split["accepted_first_offer"] == 1  # SPOOL-01
    assert split["other"] == 1  # SPOOL-03 (Hold)


def test_rework_by_project_counts_reworked_spools_and_events():
    df = _sample_dataframe()
    by_project = build_rework_by_project(df, {})
    row_183 = next(r for r in by_project if r["project_code"] == "TJ/25-26/183")

    assert row_183["total_spools"] == 3
    assert row_183["reworked_spools"] == 1  # only SPOOL-02 ever hit Rework
    assert row_183["total_events"] == 4
    assert row_183["rework_events"] == 1


def test_reoffered_before_accept_overrides_literal_accept_to_rework():
    """
    A row flagged INSPECTION_REOFFERED_BEFORE_ACCEPT counts as
    Rework even though its literal Final Status is "Accept" - a plain
    Accept row (no flag/column at all) is unaffected.
    """

    df = pd.DataFrame([
        {**_row("TJ/25-26/183", "DRW-01", "SPOOL-01", "2026-08-17", "Accept"),
         INSPECTION_REOFFERED_BEFORE_ACCEPT: True},
        {**_row("TJ/25-26/183", "DRW-02", "SPOOL-02", "2026-08-01", "Accept"),
         INSPECTION_REOFFERED_BEFORE_ACCEPT: False},
    ])

    result = _with_inspection_status(df)

    assert result.loc[result["Spool No"] == "SPOOL-01", "_status"].iloc[0] == "Rework"
    assert result.loc[result["Spool No"] == "SPOOL-02", "_status"].iloc[0] == "Accept"


def test_with_inspection_status_works_without_the_flag_column():
    """
    A dataframe with no INSPECTION_REOFFERED_BEFORE_ACCEPT column at
    all (e.g. pipeline.py's empty fallback frame) doesn't crash -
    every row just uses the plain Final Status classification.
    """

    df = pd.DataFrame([_row("TJ/25-26/183", "DRW-01", "SPOOL-01", "2026-08-17", "Accept")])

    result = _with_inspection_status(df)

    assert result["_status"].iloc[0] == "Accept"


def test_rework_cycles_buckets_repeat_offenders():
    df = _sample_dataframe()
    cycles = build_rework_cycles(df)
    by_bucket = {c["bucket"]: c["count"] for c in cycles}

    # SPOOL-01: 0 rework events. SPOOL-02: 1 (Bend). SPOOL-03: 0
    # (Hold is Other, not Rework). SPOOL-04: 1 (Not Found).
    assert by_bucket["0"] == 2
    assert by_bucket["1"] == 2
    assert by_bucket["2"] == 0
    assert by_bucket["3+"] == 0
