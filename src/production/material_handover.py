"""
src/production/material_handover.py
---------------------------------------------------------
Aggregates the Material Handover workbook (one row per spool -
whether the material needed to fabricate it has been handed over to
Production, and if not, why it's on hold) into the JSON structures
the Production dashboard's Material Handover section charts
against. No chart/rendering logic lives here - only numbers,
computed once in Python so the website only has to display them.

Status model
------------
"MH Current Status" is blank for a spool whose material has been
handed over with no outstanding issue (whether or not it ever had
one - a spool that started "under qc inspection" and later cleared
still ends up with a blank Current Status). A spool with a non-blank
Current Status still has an open issue (on hold, under DCR, awaiting
QC, etc.) as of this workbook's snapshot. That single blank/non-blank
split is treated as "Handed Over" vs. "Pending / On Hold" everywhere
below.

Free-text fields (Current Status, Concern Department) vary in
whitespace and case across rows for what's really the same value
(e.g. "PROJECT " vs "PROJECT", "MNA  BEND PLAN OUTSIDE" with a
double space vs a single one). Grouping uses a whitespace-collapsed,
case-folded key, but the label shown on the chart is the most common
ORIGINAL spelling for that key - same convention as
src/quality/summary.py's Rework Type grouping.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import pandas as pd

from constants import (
    MATERIAL,
    MH_CURRENT_STATUS,
    MH_DEPARTMENT,
    MH_FIRST_STATUS,
    MH_HANDOVER_DATE,
    MH_INCH_DIA,
    PROJECT_CODE,
)
from utils import create_composite_key

SPOOL_KEY_COLUMNS = [PROJECT_CODE, "Drawing No", "Spool No"]


def _normalize_key(raw: Any) -> str | None:
    if pd.isna(raw):
        return None
    text = re.sub(r"\s+", " ", str(raw)).strip()
    return text or None


def _is_pending(current_status: Any) -> bool:
    """
    A blank Current Status means resolved (material handed over,
    nothing outstanding). A Current Status that literally reads
    "HANDOVER" (any case) ALSO means resolved - the shop floor uses
    that value to mark an item that started out on hold (e.g.
    "under qc inspection", "UNDER DCR") as since cleared, rather
    than clearing the cell. Anything else non-blank is a genuinely
    open issue.
    """

    key = _normalize_key(current_status)
    if key is None:
        return False
    return key.casefold() != "handover"


def _group_with_original_labels(values: pd.Series) -> list[dict[str, Any]]:
    """
    Group a free-text column by a whitespace/case-insensitive key,
    label each group with its most common original spelling, and
    return groups sorted by count descending.
    """

    keyed = values.apply(_normalize_key).dropna()
    if keyed.empty:
        return []

    fold_key = keyed.apply(lambda v: v.casefold())
    counts = Counter(fold_key)

    # Most common original spelling per fold-key, for the display label.
    variants_by_key: dict[str, Counter] = {}
    for original, folded in zip(keyed, fold_key):
        variants_by_key.setdefault(folded, Counter()).update([original])
    best_label = {
        folded: variants.most_common(1)[0][0]
        for folded, variants in variants_by_key.items()
    }

    groups = [
        {"label": best_label[folded], "value": int(count)}
        for folded, count in counts.items()
    ]
    groups.sort(key=lambda g: g["value"], reverse=True)
    return groups


def _week_start(dates: pd.Series) -> pd.Series:
    """
    Monday-start week for each date (pandas' default 'W' period,
    which ends on Sunday) - used to bucket every weekly chart in
    this module the same way, so they line up against each other.
    """
    return dates.dt.to_period("W").apply(lambda period: period.start_time)


def _fill_missing_weeks(series: pd.Series) -> pd.Series:
    """
    Reindexes a week-Timestamp-indexed Series across every week
    between its first and last, filling gaps with 0 - so a chart
    doesn't silently skip a quiet week and make the x-axis look like
    consecutive weeks when they aren't (real gap seen in this data:
    a handful of June 2025 rows, then nothing until late March 2026).
    """
    if series.empty:
        return series
    all_weeks = pd.date_range(series.index.min(), series.index.max(), freq="7D")
    return series.reindex(all_weeks, fill_value=0)


def _is_empty(text: Any) -> bool:
    return _normalize_key(text) is None


def _is_available(dataframe: pd.DataFrame | None) -> bool:
    return dataframe is not None and not dataframe.empty





def build_kpis(dataframe: pd.DataFrame) -> dict[str, Any]:

    total = len(dataframe)
    pending_mask = dataframe[MH_CURRENT_STATUS].apply(_is_pending)
    pending = int(pending_mask.sum())
    resolved = total - pending

    pending_projects = set()
    if PROJECT_CODE in dataframe.columns:
        pending_projects = set(
            dataframe.loc[pending_mask, PROJECT_CODE].dropna().astype(str)
        )

    pending_reasons = set()
    if pending:
        pending_reasons = set(
            dataframe.loc[pending_mask, MH_CURRENT_STATUS].apply(_normalize_key).dropna()
        )

    dates = pd.to_datetime(dataframe.get(MH_HANDOVER_DATE), errors="coerce").dropna()

    return {
        "total_items": total,
        "resolved_count": resolved,
        "resolved_pct": round((resolved / total) * 100, 1) if total else 0.0,
        "pending_count": pending,
        "pending_pct": round((pending / total) * 100, 1) if total else 0.0,
        "projects_with_pending_items": len(pending_projects),
        "distinct_pending_reasons": len(pending_reasons),
        "date_range_start": dates.min().date().isoformat() if not dates.empty else None,
        "date_range_end": dates.max().date().isoformat() if not dates.empty else None,
    }


# -----------------------------------------------------


def build_status_overview(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart 1: Handed Over vs. Pending / On Hold (donut)."""

    total = len(dataframe)
    pending = int(dataframe[MH_CURRENT_STATUS].apply(_is_pending).sum())
    resolved = total - pending

    return [
        {"key": "resolved", "label": "Handed Over", "value": resolved},
        {"key": "pending", "label": "Pending / On Hold", "value": pending},
    ]


def build_pending_breakdown(dataframe: pd.DataFrame, top_n: int = 8) -> list[dict[str, Any]]:
    """Chart 2: top N open-issue reasons among currently pending items, rest grouped as Others."""

    pending_mask = dataframe[MH_CURRENT_STATUS].apply(_is_pending)
    groups = _group_with_original_labels(dataframe.loc[pending_mask, MH_CURRENT_STATUS])

    if len(groups) <= top_n:
        return groups

    top = groups[:top_n]
    others_total = sum(g["value"] for g in groups[top_n:])
    top.append({"label": "Others", "value": others_total})
    return top


def build_department_breakdown(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart 3: item count by Concern Department."""

    if MH_DEPARTMENT not in dataframe.columns:
        return []
    return _group_with_original_labels(dataframe[MH_DEPARTMENT])


def build_material_breakdown(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart 4: item count by material group (CS/SS/P91/...)."""

    if MATERIAL not in dataframe.columns:
        return []
    return _group_with_original_labels(dataframe[MATERIAL])


def build_monthly_trend(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart 5: handover activity volume by month (Handover Date)."""

    if MH_HANDOVER_DATE not in dataframe.columns:
        return []

    dates = pd.to_datetime(dataframe[MH_HANDOVER_DATE], errors="coerce").dropna()
    if dates.empty:
        return []

    months = dates.dt.to_period("M")
    counts = months.value_counts().sort_index()

    return [
        {"month": str(period), "label": period.strftime("%b %Y"), "value": int(count)}
        for period, count in counts.items()
    ]


def build_weekly_inch_dia(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Chart 6: total Inch Dia handed over per week (by Handover Date) -
    the industry-standard inch-dia throughput measure, not just a
    spool count, so a week with fewer but larger-bore spools doesn't
    read as quieter than it actually was.
    """

    if MH_HANDOVER_DATE not in dataframe.columns or MH_INCH_DIA not in dataframe.columns:
        return []

    working = dataframe[[MH_HANDOVER_DATE, MH_INCH_DIA]].copy()
    working[MH_HANDOVER_DATE] = pd.to_datetime(
        working[MH_HANDOVER_DATE], errors="coerce"
    )
    working = working.dropna(subset=[MH_HANDOVER_DATE])
    if working.empty:
        return []

    working["week"] = _week_start(working[MH_HANDOVER_DATE])
    weekly = _fill_missing_weeks(working.groupby("week")[MH_INCH_DIA].sum())

    return [
        {
            "week": week.date().isoformat(),
            "label": week.strftime("%d %b"),
            "value": round(float(value), 1),
        }
        for week, value in weekly.items()
    ]


def build_weekly_first_time_split(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Chart 7: of the items actually HANDED OVER in a given week, how
    many went through cleanly on the first check (FIRST TIME STATUS
    = "HANDOVER") vs. needed an issue resolved first (any other
    FIRST TIME STATUS) before that handover could happen. Stacked
    bar input - "clean_first_time" + "issue_first_time" per week.

    Bucketed by Handover Date (the only date this workbook has), so
    an item that had an issue but was resolved is counted in the
    week it was FINALLY handed over, not the week the issue was
    originally found (there's no "first checked" date to bucket by
    instead). A currently pending item (no Handover Date at all yet)
    hasn't been handed over in any week, so it's naturally excluded
    here - it already appears in the Pending/On Hold side of the
    status donut and the pending-reasons chart.
    """

    if (
        MH_HANDOVER_DATE not in dataframe.columns
        or MH_FIRST_STATUS not in dataframe.columns
    ):
        return []

    working = dataframe[[MH_HANDOVER_DATE, MH_FIRST_STATUS]].copy()
    working[MH_HANDOVER_DATE] = pd.to_datetime(
        working[MH_HANDOVER_DATE], errors="coerce"
    )
    working = working.dropna(subset=[MH_HANDOVER_DATE])
    if working.empty:
        return []

    working["week"] = _week_start(working[MH_HANDOVER_DATE])
    working["clean_first_time"] = working[MH_FIRST_STATUS].apply(
        lambda v: (not _is_empty(v)) and _normalize_key(v).casefold() == "handover"
    )

    weekly = working.groupby("week")["clean_first_time"].agg(["sum", "size"])
    weekly = weekly.reindex(
        pd.date_range(weekly.index.min(), weekly.index.max(), freq="7D"),
        fill_value=0,
    )

    result = []
    for week, row in weekly.iterrows():
        clean = int(row["sum"])
        total = int(row["size"])
        result.append({
            "week": week.date().isoformat(),
            "label": week.strftime("%d %b"),
            "clean_first_time": clean,
            "issue_first_time": total - clean,
        })
    return result


def build_weekly_first_pass_yield(
    weekly_split: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Chart 8: derived from build_weekly_first_time_split()'s own
    output - the % of that week's handovers that went through
    cleanly on the first check. A rate trend line surfaces a slipping
    first-pass quality even in a week whose raw issue COUNT looks
    small just because total volume was also low that week.
    """

    result = []
    for row in weekly_split:
        total = row["clean_first_time"] + row["issue_first_time"]
        pct = round((row["clean_first_time"] / total) * 100, 1) if total else None
        result.append({"week": row["week"], "label": row["label"], "value": pct})
    return result


def build_timeliness_split(
    dataframe: pd.DataFrame,
    planned_start_lookup: dict[str, Any],
) -> tuple[list[dict[str, Any]], int]:
    """
    Chart 9 (added 2026-08-12, replacing the removed "By Group"
    chart): of the items actually HANDED OVER, splits them into
    three buckets by comparing Handover Date against the spool's own
    Planned Start - reusing the SAME Planned Start already computed
    for this dashboard's own ageing (Weekly Production Planning
    workbook, falling back to the SIOP Planned Spools workbook only
    where that has a gap - see production/ageing.py ->
    build_spool_records()), passed in here rather than re-reading a
    second copy of that workbook. Given by the person (2026-08-12):
    Planned Date must come from the Weekly Progress file only, never
    from anything in the Material Handover workbook itself.

    - "Timely": Handover Date <= Planned Start (material was in
      hand by the time production was due to start on this spool)
    - "Delayed - Issue Found": Handover Date > Planned Start, and
      First Time Status shows a tracked material issue (a delay with
      a logged, explainable cause)
    - "Delayed - No Issue": Handover Date > Planned Start, but First
      Time Status was clean (a delay with no tracked cause - worth
      more scrutiny than the "Issue Found" bucket, since there's no
      recorded reason for it)

    A handed-over item whose spool isn't found in the lookup (no
    Planned Start anywhere - Weekly workbook nor SIOP fallback) has
    no anchor to compare against and is excluded from all three
    buckets, same "no anchor, no ageing" principle already used for
    this dashboard's other Planned-Start-based calculations. Returns
    (buckets, unmatched_count) so the caller can surface that count
    for transparency rather than silently dropping those items.
    """

    required = [MH_HANDOVER_DATE, MH_FIRST_STATUS, PROJECT_CODE, "Drawing No", "Spool No"]
    if any(col not in dataframe.columns for col in required):
        return [], 0

    working = dataframe[required].copy()
    working[MH_HANDOVER_DATE] = pd.to_datetime(
        working[MH_HANDOVER_DATE], errors="coerce"
    )
    working = working.dropna(subset=[MH_HANDOVER_DATE])
    if working.empty:
        return [], 0

    working["composite_key"] = working.apply(
        lambda row: create_composite_key(
            row[PROJECT_CODE], row["Drawing No"], row["Spool No"]
        ),
        axis=1,
    )
    working["planned_start"] = working["composite_key"].map(planned_start_lookup)

    unmatched = int(working["planned_start"].isna().sum())
    working = working.dropna(subset=["planned_start"])

    if working.empty:
        # Structurally fine (required columns exist), but nothing
        # matched a Planned Start this run - return real zero-valued
        # buckets (not an empty list) so the website can still show
        # the chart with the unmatched-count hint explaining why,
        # rather than just silently hiding the whole card.
        return (
            [
                {"key": "timely", "label": "Timely", "value": 0},
                {
                    "key": "delayed_issue",
                    "label": "Delayed - Issue Found",
                    "value": 0,
                },
                {
                    "key": "delayed_no_issue",
                    "label": "Delayed - No Issue",
                    "value": 0,
                },
            ],
            unmatched,
        )

    working["handover_date_only"] = working[MH_HANDOVER_DATE].dt.date
    working["is_late"] = working["handover_date_only"] > working["planned_start"]
    working["had_issue"] = working[MH_FIRST_STATUS].apply(
        lambda v: (not _is_empty(v)) and _normalize_key(v).casefold() != "handover"
    )

    timely = int((~working["is_late"]).sum())
    delayed_issue = int((working["is_late"] & working["had_issue"]).sum())
    delayed_no_issue = int((working["is_late"] & ~working["had_issue"]).sum())

    return (
        [
            {"key": "timely", "label": "Timely", "value": timely},
            {
                "key": "delayed_issue",
                "label": "Delayed - Issue Found",
                "value": delayed_issue,
            },
            {
                "key": "delayed_no_issue",
                "label": "Delayed - No Issue",
                "value": delayed_no_issue,
            },
        ],
        unmatched,
    )


# -----------------------------------------------------


def build_material_handover_summary(
    dataframe: pd.DataFrame | None,
    planned_start_lookup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Top-level entry point - src/production/pipeline.py calls this
    and drops the result straight into the bundle under
    "material_handover". Always returns a dict (never raises); if
    the workbook wasn't available this run, `available` is False and
    every chart-data field is empty, so the website can simply hide
    the whole section rather than special-case a missing key.

    planned_start_lookup: Composite Key -> Planned Start date, from
    this SAME pipeline run's own spool records (see pipeline.py) -
    used only by build_timeliness_split(). Optional/defaults to
    empty so this function still works standalone (e.g. in tests)
    without needing the full Production pipeline wired up.
    """

    if not _is_available(dataframe):
        return {
            "available": False,
            "kpis": None,
            "status_overview": [],
            "pending_breakdown": [],
            "department_breakdown": [],
            "material_breakdown": [],
            "monthly_trend": [],
            "weekly_inch_dia": [],
            "weekly_first_time_split": [],
            "weekly_first_pass_yield": [],
            "timeliness_split": [],
            "timeliness_unmatched_count": 0,
        }

    weekly_first_time_split = build_weekly_first_time_split(dataframe)
    timeliness_split, timeliness_unmatched = build_timeliness_split(
        dataframe, planned_start_lookup or {}
    )

    return {
        "available": True,
        "kpis": build_kpis(dataframe),
        "status_overview": build_status_overview(dataframe),
        "pending_breakdown": build_pending_breakdown(dataframe),
        "department_breakdown": build_department_breakdown(dataframe),
        "material_breakdown": build_material_breakdown(dataframe),
        "monthly_trend": build_monthly_trend(dataframe),
        "weekly_inch_dia": build_weekly_inch_dia(dataframe),
        "weekly_first_time_split": weekly_first_time_split,
        "weekly_first_pass_yield": build_weekly_first_pass_yield(
            weekly_first_time_split
        ),
        "timeliness_split": timeliness_split,
        "timeliness_unmatched_count": timeliness_unmatched,
    }
