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
    MH_HANDOVER_DATE,
    PROJECT_CODE,
)

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


def _is_available(dataframe: pd.DataFrame | None) -> bool:
    return dataframe is not None and not dataframe.empty


# -----------------------------------------------------


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


# -----------------------------------------------------


def build_material_handover_summary(dataframe: pd.DataFrame | None) -> dict[str, Any]:
    """
    Top-level entry point - src/production/pipeline.py calls this
    and drops the result straight into the bundle under
    "material_handover". Always returns a dict (never raises); if
    the workbook wasn't available this run, `available` is False and
    every chart-data field is empty, so the website can simply hide
    the whole section rather than special-case a missing key.
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
        }

    return {
        "available": True,
        "kpis": build_kpis(dataframe),
        "status_overview": build_status_overview(dataframe),
        "pending_breakdown": build_pending_breakdown(dataframe),
        "department_breakdown": build_department_breakdown(dataframe),
        "material_breakdown": build_material_breakdown(dataframe),
        "monthly_trend": build_monthly_trend(dataframe),
    }
