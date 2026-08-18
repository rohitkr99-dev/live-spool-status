"""
src/quality/welder_performance.py
---------------------------------------------------------
Aggregates the raw Welder Performance Record workbook (one row per
welder/job/welding-process NDT entry) into the JSON structures the
Quality dashboard's Welder Performance section charts against, plus
the raw rows used by its "Download Welder Performance Record"
button (see website/js/quality-charts.js ->
wireWelderPerformanceExportButton()).

This reproduces the person's own manual "Weld Reject Rate - Pipe"
summary sheet (Month Wise NDT Length Summary, Month Wise Joint
Summary, Project Wise Summary, Type of Defect Wise Summary, Welding
Process Summary) from the raw "Welder Performance - Pipe" data
sheet, computed fresh every pipeline run instead of hand-maintained.

Month bucketing
----------------
The raw workbook has no year field for its "Month" column (just
"Jan", "Feb", ...), so - same limitation the person's own manual
sheet had - months are bucketed by bare calendar month name, in
Jan-Dec order, not Year-Month. If the recurring Welder Performance
file ever gains a year, this should switch to Year-Month like
quality/summary.py's rework functions do.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from logger import logger
from utils import MONTH_ORDER, dataframe_to_json_records

RAW_EXPORT_COLUMNS = [
    "Month", "Project Name", "Job No", "Welder ID", "Welding Process",
    "Total Weld Joint", "Total NDT Joint", "NDT Accept Joint",
    "Rejected Joint", "Total NDT Length", "NDT Accepted Length",
    "NDT Rejected Length", "Type of Defect",
]


def _pct(part: float, whole: float) -> float:
    return round((part / whole) * 100, 3) if whole else 0.0


def _sum(dataframe: pd.DataFrame, column: str) -> float:
    if column not in dataframe.columns:
        return 0.0
    return float(dataframe[column].fillna(0).sum())


# -----------------------------------------------------


def build_kpis(dataframe: pd.DataFrame) -> dict[str, Any]:
    total_joints = _sum(dataframe, "Total NDT Joint")
    reject_joints = _sum(dataframe, "Rejected Joint")
    total_length = _sum(dataframe, "Total NDT Length")
    reject_length = _sum(dataframe, "NDT Rejected Length")

    return {
        "total_entries": len(dataframe),
        "distinct_welders": int(dataframe["Welder ID"].nunique()) if "Welder ID" in dataframe.columns else 0,
        "distinct_projects": int(dataframe["Project Name"].nunique()) if "Project Name" in dataframe.columns else 0,
        "total_ndt_joints": int(total_joints),
        "rejected_joints": int(reject_joints),
        "joint_reject_pct": _pct(reject_joints, total_joints),
        "total_ndt_length_mm": round(total_length, 2),
        "rejected_length_mm": round(reject_length, 2),
        "length_reject_pct": _pct(reject_length, total_length),
    }


# -----------------------------------------------------


def build_month_wise_length_summary(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart: "Month Wise NDT Length Summary" - Total/Accept/Reject NDT length (mm) per month."""

    grouped = dataframe.groupby("Month").agg(
        total_length=("Total NDT Length", "sum"),
        accept_length=("NDT Accepted Length", "sum"),
        reject_length=("NDT Rejected Length", "sum"),
    )

    rows = []
    for month in MONTH_ORDER:
        if month not in grouped.index:
            continue
        row = grouped.loc[month]
        total = float(row["total_length"] or 0)
        reject = float(row["reject_length"] or 0)
        rows.append({
            "month": month,
            "total_length_mm": round(total, 2),
            "accept_length_mm": round(float(row["accept_length"] or 0), 2),
            "reject_length_mm": round(reject, 2),
            "reject_pct": _pct(reject, total),
        })
    return rows


def build_month_wise_joint_summary(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart: "Month Wise Joint Summary" - Total/Accept/Reject NDT joints per month."""

    grouped = dataframe.groupby("Month").agg(
        total_joint=("Total NDT Joint", "sum"),
        accept_joint=("NDT Accept Joint", "sum"),
        reject_joint=("Rejected Joint", "sum"),
    )

    rows = []
    for month in MONTH_ORDER:
        if month not in grouped.index:
            continue
        row = grouped.loc[month]
        total = float(row["total_joint"] or 0)
        reject = float(row["reject_joint"] or 0)
        rows.append({
            "month": month,
            "total_joint": int(total),
            "accept_joint": int(row["accept_joint"] or 0),
            "reject_joint": int(reject),
            "reject_pct": _pct(reject, total),
        })
    return rows


def build_project_wise_summary(
    dataframe: pd.DataFrame, project_names: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """
    Chart: "Project Wise Summary" - Total/Accept/Reject NDT joints
    per project.

    REWRITTEN 2026-08-18 (third attempt at this chart, per the
    person - the first two both guessed at the wrong source column).
    The workbook has an actual Project Code column all along - it's
    just labeled "Job No" in the raw header, holding values like
    "TJ/25-26/170" that match the Project Master's Project Code
    format exactly (confirmed against his real files: all 9 distinct
    Job No values in his Welder Performance file matched a Project
    Master entry with no typos at all - unlike the "Project Name"
    column, which was hand-typed and inconsistent). Per his explicit
    instruction, grouping is now by this Job No/Project Code column
    ONLY, with an exact (no fuzzy, no normalization) lookup against
    the Project Code -> Project Name master (project_names, already
    merged from the Project Master workbook over the DPR-derived
    lookup in src/quality/reader.py). The workbook's own "Project
    Name" column is no longer read for this chart at all.

    A Job No value with no matching Project Master entry keeps its
    own bar (code only, no name) and is logged as a warning - so it
    can be fixed at the source (added to the Project Master, or a
    typo in the Welder Performance file) rather than silently
    guessed at.
    """

    project_names = project_names or {}

    df = dataframe.copy()
    df["_code"] = df["Job No"].apply(
        lambda v: str(v).strip() if pd.notna(v) and str(v).strip() else None
    )
    df = df.dropna(subset=["_code"])

    grouped = df.groupby("_code").agg(
        total_joint=("Total NDT Joint", "sum"),
        accept_joint=("NDT Accept Joint", "sum"),
        reject_joint=("Rejected Joint", "sum"),
    )

    unresolved = sorted(code for code in grouped.index if code not in project_names)
    if unresolved:
        logger.warning(
            "Welder Performance: no Project Master entry found for "
            f"{len(unresolved)} project code(s) (from the file's Job "
            f"No column): {', '.join(unresolved)}. Their bars will "
            "show the code only - add these to the Project Master."
        )

    rows = []
    for code, row in grouped.iterrows():
        total = float(row["total_joint"] or 0)
        reject = float(row["reject_joint"] or 0)
        rows.append({
            "project_code": code,
            "project_name": project_names.get(code),
            "total_joint": int(total),
            "accept_joint": int(row["accept_joint"] or 0),
            "reject_joint": int(reject),
            "reject_pct": _pct(reject, total),
        })

    rows.sort(key=lambda r: r["reject_pct"], reverse=True)
    return rows


def _defect_rows(dataframe: pd.DataFrame) -> pd.DataFrame:
    df = dataframe.copy()
    df["_defect"] = df["Type of Defect"].apply(
        lambda v: None if pd.isna(v) or not str(v).strip() else str(v).strip()
    )
    return df.dropna(subset=["_defect"])


def build_defect_type_summary(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart: "Type of Defect Wise Summary" - count of defect-flagged joints per defect code."""

    df = _defect_rows(dataframe)
    if df.empty:
        return []

    counts = df["_defect"].value_counts()
    total = len(df)
    return [
        {"defect": defect, "count": int(count), "pct": _pct(count, total)}
        for defect, count in counts.items()
    ]


def build_process_wise_summary(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Chart: "Welding Process Summary" - rejected joint count per
    welding process, counted the same way the person's manual sheet
    did (only rows that were actually flagged with a Type of
    Defect), summed by Rejected Joint.
    """

    df = _defect_rows(dataframe)
    if df.empty:
        return []

    grouped = df.groupby("Welding Process")["Rejected Joint"].sum()
    return [
        {"process": process, "rejected_joint": int(count or 0)}
        for process, count in grouped.sort_values(ascending=False).items()
    ]


# -----------------------------------------------------


def build_bundle(
    dataframe: pd.DataFrame, project_names: dict[str, str] | None = None
) -> dict[str, Any]:
    return {
        "kpis": build_kpis(dataframe),
        "month_wise_length": build_month_wise_length_summary(dataframe),
        "month_wise_joint": build_month_wise_joint_summary(dataframe),
        "project_wise": build_project_wise_summary(dataframe, project_names),
        "defect_type": build_defect_type_summary(dataframe),
        "process_wise": build_process_wise_summary(dataframe),
        "raw_rows": dataframe_to_json_records(dataframe, columns=RAW_EXPORT_COLUMNS),
    }
