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

import re
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


def _normalize_project_key(value: Any) -> str:
    """
    Whitespace/case normalization for matching a raw Welder
    Performance "Project Name" value (informal, hyphenated -
    "Vogt-CB") against a Project Master "Project Name" (formal,
    space-separated - "VOGT CB"). Hyphens are treated the same as
    whitespace here so the two styles line up; see
    build_project_wise_summary().
    """

    if pd.isna(value):
        return ""
    text = str(value).strip().upper()
    text = re.sub(r"[-\s]+", " ", text)
    return text.strip()


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

    UPDATED 2026-08-17 (per the person, after reviewing the first
    version of this chart): the workbook's own "Project Name" column
    actually holds an informal short NAME ("Vogt-CB", "NE-Legend"),
    not a Project Code - confirmed against his Project Master
    workbook (config/settings.json -> input_files.project_master),
    which is the authoritative Project Code -> Project Name list.
    So matching now goes the other way round from the first version:
    each raw value is normalized (case/hyphen-spacing/whitespace)
    and looked up against the master's NAMES, not its codes, to find
    the Project Code to anchor the bar on. Chart label is Project
    Name on top, "(Project Code)" below - same as the Project
    Progress chart on the main dashboard.

    Three outcomes per raw value:
      - Matches exactly ONE Project Code's name -> resolved, shown
        as Name/(Code).
      - Matches a name shared by MULTIPLE Project Codes (normal -
        several PO line items can share one project name in the
        master) -> can't tell which specific code this NDT data
        belongs to, so the bar is grouped by NAME alone, shown
        without a code. Logged as info, not an error.
      - No match at all -> kept as its own bar under the raw text,
        no name. Logged as a warning - likely a typo in the Welder
        Performance file, or a project not yet in the master.

    Deliberately does NOT fuzzy-guess close-but-not-exact spellings
    (e.g. "VO-BISION" / "Vogt-Bision" are NOT auto-matched to
    "VOGT Bison" even though they look like likely typos) - a wrong
    guess would silently merge two different projects' reject rates.
    Unmatched values are logged with their normalized form so those
    can be confirmed and fixed by hand (either in the Welder
    Performance file or the Project Master).
    """

    project_names = project_names or {}

    name_to_codes: dict[str, list[str]] = {}
    name_original: dict[str, str] = {}
    for code, name in project_names.items():
        key = _normalize_project_key(name)
        name_to_codes.setdefault(key, []).append(code)
        name_original.setdefault(key, name)

    def resolve(raw_value: Any) -> tuple[str, str | None, str | None]:
        """Returns (group_key, project_code_or_None, project_name_or_None)."""

        key = _normalize_project_key(raw_value)
        codes = name_to_codes.get(key)
        if not codes:
            # No match at all - group under the raw text as typed.
            return (str(raw_value).strip(), None, None)
        if len(codes) == 1:
            return (codes[0], codes[0], name_original[key])
        # Ambiguous - one name, several Project Codes in the master
        # (normal - several PO line items can share a project name).
        # Group by the name; no single code to anchor on.
        return (key, None, name_original[key])

    df = dataframe.copy()
    resolved = df["Project Name"].apply(resolve)
    df["_group_key"] = resolved.apply(lambda t: t[0])
    df["_code"] = resolved.apply(lambda t: t[1])
    df["_name"] = resolved.apply(lambda t: t[2])

    grouped = df.groupby("_group_key").agg(
        total_joint=("Total NDT Joint", "sum"),
        accept_joint=("NDT Accept Joint", "sum"),
        reject_joint=("Rejected Joint", "sum"),
        code=("_code", lambda s: s.iloc[0]),
        name=("_name", lambda s: s.iloc[0]),
    )

    unmatched = sorted(
        key for key, row in grouped.iterrows()
        if pd.isna(row["code"]) and pd.isna(row["name"])
    )
    if unmatched:
        logger.warning(
            "Welder Performance: no Project Master entry found for "
            f"{len(unmatched)} project name(s) (shown as typed in the "
            f"file): {', '.join(unmatched)}. Their bars will show that "
            "text only, no Project Code - check for a typo in the "
            "Welder Performance file, or add the project to the "
            "Project Master."
        )

    ambiguous = sorted(
        row["name"] for key, row in grouped.iterrows()
        if pd.isna(row["code"]) and not pd.isna(row["name"])
    )
    if ambiguous:
        logger.info(
            "Welder Performance: "
            f"{len(ambiguous)} project name(s) match more than one "
            f"Project Code in the master, so can't be anchored on a "
            f"single code: {', '.join(ambiguous)}."
        )

    rows = []
    for key, row in grouped.iterrows():
        total = float(row["total_joint"] or 0)
        reject = float(row["reject_joint"] or 0)
        code = None if pd.isna(row["code"]) else row["code"]
        name = None if pd.isna(row["name"]) else row["name"]
        rows.append({
            "project_code": code if code else (key if name is None else None),
            "project_name": name,
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
