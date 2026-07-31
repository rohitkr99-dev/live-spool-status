"""
src/production/welding_finish.py
---------------------------------------------------------
Derives a "Welding Finish" date per spool - the date the LAST joint
finished welding. This is NOT the same as the existing Projects
pipeline's "First Welding" (src/merge.py, First Fit-Up / First
Welding are derived from the EARLIEST Activity Date per spool in the
Weekly workbook's Fit-Up DB / Welding DB - used to mark the START of
the Welding stage). Nothing about that existing logic is touched
here; this is a separate, additive calculation for this dashboard
only.

Confirmed with the project owner against real data (2026-07-30):
the DPR's own "5. Welding" column is 100% blank, so Welding Finish
always has to be derived from elsewhere. Rule, in order:

  For a spool found in the Line History Sheet with >=1 non-blank
  Joint No. row:
    1. Every joint's Welding FRun Date is filled
       -> Welding Finish = the LATEST (max) of those dates.
    2. Some/all of those dates are blank, but the DPR's PDQC date
       is already filled
       -> Welding Finish = PDQC date - 1 day.
    3. Some/all blank, no PDQC yet
       -> welding is still in progress. No Welding Finish date;
          the spool's age is Today - Planned Start (see ageing.py).

  For a spool NOT found in the Line History Sheet (or with no
  non-blank Joint No. row there):
    4. DPR's PDQC (or a later stage) is already filled
       -> Welding Finish = the LATEST Activity Date for that spool
          in the Weekly workbook's Welding DB sheet.
       -> If that spool isn't in Welding DB either (data gap - PDQC
          was reached but no joint-level welding record exists
          anywhere), falls back to PDQC date - 1 day, same as rule 2.
    5. No PDQC/later dates anywhere, and not in Welding DB
       -> welding hasn't started. No Welding Finish date; age is
          Today - Planned Start, same as rule 3.

Every "in progress" / "not started" spool is deliberately treated
the same way for ageing purposes here (Today - Planned Start) - the
project owner confirmed this is a new rule specific to this
dashboard's Production Table, not a change to the existing Projects
pipeline's Stage Age logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from utils import create_composite_key, is_empty, parse_date


@dataclass
class LineHistoryInfo:
    all_frun_filled: bool
    max_frun_date: date | None


def build_line_history_lookup(
    line_history_df: pd.DataFrame | None,
    joint_no_field: str,
    frun_field: str,
) -> dict[str, LineHistoryInfo]:
    """
    One entry per spool (Composite Key) that has at least one
    non-blank Joint No. row in the Line History Sheet. A spool
    absent from this lookup falls straight to rule 4/5 (Welding DB /
    not started) in determine_welding_finish().
    """

    if line_history_df is None or line_history_df.empty:
        return {}

    df = line_history_df.copy()
    df = df[~df[joint_no_field].apply(is_empty)]

    if df.empty:
        return {}

    df["__ck"] = df.apply(
        lambda r: create_composite_key(
            r.get("Project Code"), r.get("Drawing No"), r.get("Spool No")
        ),
        axis=1,
    )

    lookup: dict[str, LineHistoryInfo] = {}
    for ck, group in df.groupby("__ck"):
        frun_series = group[frun_field]
        all_filled = frun_series.notna().all()
        max_value = frun_series.max()
        max_date = parse_date(max_value) if pd.notna(max_value) else None
        lookup[ck] = LineHistoryInfo(
            all_frun_filled=bool(all_filled) and max_date is not None,
            max_frun_date=max_date,
        )

    return lookup


def build_welding_db_lookup(
    welding_db_df: pd.DataFrame,
    activity_date_field: str,
) -> dict[str, date]:
    """
    Composite Key -> latest (max) Activity Date, from the Weekly
    workbook's Welding DB sheet (one row per joint). Fallback source
    for Welding Finish when a spool isn't in the Line History Sheet.
    """

    if welding_db_df is None or welding_db_df.empty:
        return {}

    df = welding_db_df.copy()
    df["__ck"] = df.apply(
        lambda r: create_composite_key(
            r.get("Project Code"), r.get("Drawing No"), r.get("Spool No")
        ),
        axis=1,
    )

    lookup: dict[str, date] = {}
    for ck, group in df.groupby("__ck"):
        max_value = group[activity_date_field].max()
        max_date = parse_date(max_value) if pd.notna(max_value) else None
        if max_date is not None:
            lookup[ck] = max_date

    return lookup


def determine_welding_finish(
    composite_key: str,
    pdqc_value,
    line_history_lookup: dict[str, LineHistoryInfo],
    welding_db_lookup: dict[str, date],
) -> tuple[date | None, str]:
    """
    Returns (welding_finish_date_or_None, status), where status is
    one of:
      "finished_frun"            - rule 1
      "finished_via_pdqc"        - rule 2
      "in_progress"              - rule 3
      "finished_via_weldingdb"   - rule 4
      "finished_via_pdqc_fallback" - rule 4, Welding DB gap
      "not_started"              - rule 5
    """

    pdqc_date = parse_date(pdqc_value)

    info = line_history_lookup.get(composite_key)

    if info is not None:
        if info.all_frun_filled:
            return info.max_frun_date, "finished_frun"
        if pdqc_date is not None:
            return pdqc_date - timedelta(days=1), "finished_via_pdqc"
        return None, "in_progress"

    if pdqc_date is not None:
        welding_db_date = welding_db_lookup.get(composite_key)
        if welding_db_date is not None:
            return welding_db_date, "finished_via_weldingdb"
        return pdqc_date - timedelta(days=1), "finished_via_pdqc_fallback"

    return None, "not_started"
