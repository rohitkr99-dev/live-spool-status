"""
src/quality/summary.py
---------------------------------------------------------
Aggregates the raw Rework Data workbook (one row per offer-for-
inspection event) into the JSON structures the Quality Assurance/
Control dashboard (website/quality.html) charts against. No chart/
rendering logic lives here - only numbers, computed once in Python
so the website only has to display them.

Status normalization
---------------------
"Packing Release Date" (column K) is free text from QC recording the
outcome of each offer event - despite the column name, it is not a
date. It varies in case ("Packing Release" / "RFP" / "FQC Accept")
and occasionally means something that's neither an accept nor a
rework ("Project Hold", "Query", "Hold"). Every function below
normalizes it the same way, reusing the single shared classification
in src/rework_pdqc_rule.py (Accept/Hold/Rework) so this dashboard
can never drift out of sync with the Projects/Production pipelines:

    Accept category  -> "Accept"
    Rework category   -> "Rework"
    anything else (QC Hold, or unrecognized) -> "Other" (excluded
                       from the rework-rate charts, since it's not a
                       QC accept/reject outcome - same role this
                       bucket has always played here)

"Type of Rework" (column J) is similarly free text (case/whitespace
variants of the same defect - "C ID" vs " C ID", "Serration damage"
vs "SERRATION DAMAGE"). Grouping uses a stripped+uppercased key, but
the label shown on the chart is the most common ORIGINAL spelling
for that key, so acronyms like "RT" don't get mangled by a blanket
.title() call.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import pandas as pd

from rework_pdqc_rule import normalize_rework_status
from utils import fiscal_week_info, today, week_number_to_start_date

SPOOL_KEY_COLUMNS = ["Project Code", "Drawing No", "Spool No"]


def _normalize_status(raw: Any) -> str:
    status = normalize_rework_status(raw)
    # Collapse the shared Accept/Hold/Rework classification down to
    # this dashboard's existing Accept/Rework/Other shape - "Other"
    # is the same bucket it always was here, unchanged in meaning or
    # in every chart/field name built on top of it below.
    if status == "Accept":
        return "Accept"
    if status == "Rework":
        return "Rework"
    return "Other"


def _with_status(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.copy()
    dataframe["_status"] = dataframe["Packing Release Date"].apply(_normalize_status)
    return dataframe


def _round1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _pct(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


# -----------------------------------------------------


def build_kpis(dataframe: pd.DataFrame, cycles: list[dict]) -> dict[str, Any]:

    df = _with_status(dataframe)

    total_spools = df[SPOOL_KEY_COLUMNS].drop_duplicates().shape[0]
    total_offer_events = len(df)
    rework_events = int((df["_status"] == "Rework").sum())
    other_events = int((df["_status"] == "Other").sum())

    needing_2plus = sum(
        bucket["count"] for bucket in cycles if bucket["bucket"] in ("2", "3+")
    )

    dates = pd.to_datetime(df["Prod Offer Date"], errors="coerce").dropna()

    return {
        "total_spools": total_spools,
        "total_offer_events": total_offer_events,
        "rework_events": rework_events,
        "other_status_events": other_events,
        "overall_rework_rate_pct": _pct(rework_events, total_offer_events),
        "spools_needing_2plus_rework": int(needing_2plus),
        "date_range_start": dates.min().date().isoformat() if not dates.empty else None,
        "date_range_end": dates.max().date().isoformat() if not dates.empty else None,
    }


# -----------------------------------------------------


def build_top_rework_types(dataframe: pd.DataFrame, top_n: int = 10) -> dict[str, Any]:
    """
    Chart 1: top N "Type of Rework" values (by rework event count),
    with everything else outside the top N collapsed into "Others".
    Only rows whose Final Status normalizes to "Rework" are counted -
    "Accept" rows (including any stray "Accept" value under Type of
    Rework itself) never contribute here.
    """

    df = _with_status(dataframe)
    rework_rows = df[df["_status"] == "Rework"].copy()

    rework_rows["_type_key"] = rework_rows["Rework Type"].apply(
        lambda v: None if pd.isna(v) or not str(v).strip() else str(v).strip().upper()
    )
    rework_rows = rework_rows.dropna(subset=["_type_key"])
    # Guard: a row genuinely tagged Rework but with Type of Rework
    # literally "Accept" is a data-entry inconsistency, not a real
    # defect type - excluded from this chart either way.
    rework_rows = rework_rows[rework_rows["_type_key"] != "ACCEPT"]

    total = len(rework_rows)

    if total == 0:
        return {"items": [], "total_rework_events": 0}

    label_by_key: dict[str, str] = {}
    for key, group in rework_rows.groupby("_type_key"):
        originals = [str(v).strip() for v in group["Rework Type"] if str(v).strip()]
        label_by_key[key] = Counter(originals).most_common(1)[0][0]

    counts = rework_rows["_type_key"].value_counts()

    ranked = [
        {"label": label_by_key[key], "count": int(count)}
        for key, count in counts.items()
    ]
    ranked.sort(key=lambda item: item["count"], reverse=True)

    top = ranked[:top_n]
    rest = ranked[top_n:]

    items = [
        {"label": item["label"], "count": item["count"], "pct": _pct(item["count"], total)}
        for item in top
    ]

    if rest:
        others_count = sum(item["count"] for item in rest)
        items.append({
            "label": "Others",
            "count": others_count,
            "pct": _pct(others_count, total),
        })

    return {"items": items, "total_rework_events": total}


# -----------------------------------------------------


def build_rework_by_project(
    dataframe: pd.DataFrame,
    project_names: dict[str, str],
) -> list[dict[str, Any]]:
    """
    Chart 2: per project, how many distinct spools needed at least
    one rework, and what share of that project's inspected spools
    that is. rework_events / total_events (per-row, not per-spool)
    is included alongside as the secondary figure.
    """

    df = _with_status(dataframe)

    spool_status = (
        df.groupby(SPOOL_KEY_COLUMNS)["_status"]
        .apply(lambda statuses: "Rework" in set(statuses))
        .reset_index(name="_reworked")
    )

    per_project_spools = spool_status.groupby("Project Code").agg(
        total_spools=("_reworked", "size"),
        reworked_spools=("_reworked", "sum"),
    )

    per_project_events = df.groupby("Project Code").agg(
        total_events=("_status", "size"),
        rework_events=("_status", lambda s: int((s == "Rework").sum())),
    )

    merged = per_project_spools.join(per_project_events, how="outer").fillna(0)

    results = []
    for project_code, row in merged.iterrows():
        total_spools = int(row["total_spools"])
        reworked_spools = int(row["reworked_spools"])
        results.append({
            "project_code": project_code,
            "project_name": project_names.get(project_code, project_code),
            "total_spools": total_spools,
            "reworked_spools": reworked_spools,
            "reworked_spool_pct": _pct(reworked_spools, total_spools),
            "total_events": int(row["total_events"]),
            "rework_events": int(row["rework_events"]),
            "rework_event_pct": _pct(int(row["rework_events"]), int(row["total_events"])),
        })

    results.sort(key=lambda item: item["reworked_spool_pct"], reverse=True)

    return results


# -----------------------------------------------------


def build_first_offer_split(dataframe: pd.DataFrame) -> dict[str, Any]:
    """
    Chart 3: of every spool with at least one offer event, what
    share was accepted on its FIRST (earliest-dated) offer, vs.
    needed at least one rework before acceptance.
    """

    df = _with_status(dataframe)
    df = df.dropna(subset=["Prod Offer Date"])

    first_rows = (
        df.sort_values("Prod Offer Date")
        .groupby(SPOOL_KEY_COLUMNS, as_index=False)
        .first()
    )

    total = len(first_rows)
    counts = first_rows["_status"].value_counts()

    accepted = int(counts.get("Accept", 0))
    reworked = int(counts.get("Rework", 0))
    other = int(counts.get("Other", 0))

    return {
        "total_spools": total,
        "accepted_first_offer": accepted,
        "accepted_first_offer_pct": _pct(accepted, total),
        "needed_rework": reworked,
        "needed_rework_pct": _pct(reworked, total),
        "other": other,
        "other_pct": _pct(other, total),
    }


# -----------------------------------------------------


def _period_labels(dates: pd.Series) -> pd.DataFrame:
    day = dates.dt.date.astype(str)
    month = dates.dt.strftime("%Y-%m")
    return pd.DataFrame({"day": day, "month": month})


def build_rework_trend(dataframe: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    """
    Chart 4: rework rate over time, at 3 granularities (the website
    lets the person switch between them). Rate = rework events /
    total offer events within that period - a spool offered more
    than once (rework cycle) contributes one event per offer, same
    denominator logic as build_kpis()'s overall_rework_rate_pct.

    "week" granularity (2026-08-26, given by the person - "Better to
    show chart from Week 1 onwards", confirmed meaning the SAME
    fiscal week system already used for "Week Planned" elsewhere -
    utils.fiscal_week_info(), a 52-week cycle anchored 30th March
    each year) is DIFFERENT from "day"/"month": it only covers the
    CURRENT fiscal cycle (from its own Week 1 onward), not the whole
    history, and labels periods "Week 1", "Week 2", etc. instead of
    calendar dates. Deliberately not "Monday-of-that-ISO-week" (what
    this used to do) - that's a different, unrelated week concept
    from the one used everywhere else "Week" appears in this app,
    and mixing calendar-week labels with the previous fiscal cycle's
    Week 1-52 the moment the chart crosses 30th March would look like
    the week numbers reset partway through, which is why this
    genuinely needs its own cycle-scoped grouping rather than just a
    label rename. "day" and "month" are unaffected - full history,
    calendar dates, same as before.
    """

    df = _with_status(dataframe)
    df = df.dropna(subset=["Prod Offer Date"])
    df["Prod Offer Date"] = pd.to_datetime(df["Prod Offer Date"], errors="coerce")
    df = df.dropna(subset=["Prod Offer Date"])

    periods = _period_labels(df["Prod Offer Date"])
    df = pd.concat([df.reset_index(drop=True), periods.reset_index(drop=True)], axis=1)

    out: dict[str, list[dict[str, Any]]] = {}
    for granularity in ("day", "month"):
        grouped = df.groupby(granularity).agg(
            total=("_status", "size"),
            rework=("_status", lambda s: int((s == "Rework").sum())),
        ).reset_index().rename(columns={granularity: "period"})

        grouped = grouped.sort_values("period")

        out[granularity] = [
            {
                "period": row["period"],
                "total": int(row["total"]),
                "rework": int(row["rework"]),
                "pct": _pct(int(row["rework"]), int(row["total"])),
            }
            for _, row in grouped.iterrows()
        ]

    cycle_start = week_number_to_start_date(1, today())
    week_df = df[df["Prod Offer Date"] >= pd.Timestamp(cycle_start)].copy()
    if week_df.empty:
        out["week"] = []
    else:
        week_df["week_number"] = week_df["Prod Offer Date"].apply(
            lambda d: fiscal_week_info(d.date())["week_number"]
        )
        grouped = week_df.groupby("week_number").agg(
            total=("_status", "size"),
            rework=("_status", lambda s: int((s == "Rework").sum())),
        ).reset_index().sort_values("week_number")

        out["week"] = [
            {
                "period": f"Week {int(row['week_number'])}",
                "total": int(row["total"]),
                "rework": int(row["rework"]),
                "pct": _pct(int(row["rework"]), int(row["total"])),
            }
            for _, row in grouped.iterrows()
        ]

    return out


# -----------------------------------------------------


def build_rework_cycles(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Chart 5 (additional): how many rework cycles each spool needed
    before acceptance - i.e. how many of its offer events were
    status "Rework". Surfaces repeat-offender spools that the other
    4 charts (which look at events or first-offer-only) don't show
    on their own.
    """

    df = _with_status(dataframe)

    rework_counts = (
        df[df["_status"] == "Rework"]
        .groupby(SPOOL_KEY_COLUMNS)
        .size()
    )

    all_spools = df[SPOOL_KEY_COLUMNS].drop_duplicates()
    all_spools = all_spools.set_index(SPOOL_KEY_COLUMNS)
    all_spools["cycles"] = rework_counts
    all_spools["cycles"] = all_spools["cycles"].fillna(0).astype(int)

    def bucket(n: int) -> str:
        if n == 0:
            return "0"
        if n == 1:
            return "1"
        if n == 2:
            return "2"
        return "3+"

    all_spools["bucket"] = all_spools["cycles"].apply(bucket)

    total = len(all_spools)
    counts = all_spools["bucket"].value_counts()

    order = ["0", "1", "2", "3+"]
    return [
        {
            "bucket": label,
            "count": int(counts.get(label, 0)),
            "pct": _pct(int(counts.get(label, 0)), total),
        }
        for label in order
    ]


# -----------------------------------------------------
# Downloadable "Production Rework" export
#
# The two functions below feed the Quality dashboard's "Download
# Production Rework Data" button (website/js/quality-charts.js),
# which re-creates the two summary blocks from the person's manual
# template (Sheet2 in his uploaded Production Final Dimension file:
# "Compare Rework Status Monthly" and "REWORK TYPE MONTHLY") from
# live data, client-side, via SheetJS - see wireReworkExportButton()
# for the sheet layout. Nothing here writes an .xlsx file; these
# just compute the numbers.
# -----------------------------------------------------


def build_rework_status_monthly(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    """
    "Compare Rework Status Monthly": per calendar month (by Prod
    Offer Date), total offer events, Accept count, Rework count, and
    Rework %.

    Grouped by Year-Month ("2023-04"), not bare month name - unlike
    the person's original one-year manual sheet, this recomputes
    from the recurring live Rework Data workbook, which spans
    multiple years, so a bare "April" would otherwise conflate every
    April on record.
    """

    df = _with_status(dataframe)
    df = df.dropna(subset=["Prod Offer Date"])
    df["_month"] = pd.to_datetime(df["Prod Offer Date"], errors="coerce").dt.strftime("%Y-%m")
    df = df.dropna(subset=["_month"])

    rows = []
    for month, group in df.groupby("_month"):
        total = len(group)
        rework = int((group["_status"] == "Rework").sum())
        accept = int((group["_status"] == "Accept").sum())
        rows.append({
            "month": month,
            "total_final_inspection_spool": total,
            "acceptable": accept,
            "rework": rework,
            "rework_pct": _pct(rework, total),
        })

    rows.sort(key=lambda r: r["month"])
    return rows


REWORK_TYPE_CATEGORIES: list[tuple[str, list[str]]] = [
    # (label, keywords) - first keyword found in the row's QC
    # Observation text wins; a row is counted in exactly ONE
    # category even if its remark mentions more than one issue.
    # Order matters: "Wrong Material" is checked before "Damage
    # Material/Bend" so a remark like "spool material wrong / bend"
    # lands under Wrong Material, not Damage/Bend. This priority
    # order is a judgment call on free-text shop-floor remarks -
    # adjust the keyword lists below if it misclassifies real data.
    ("Wrong Material", ["wrong material", "material wrong", "wrong mat"]),
    ("Dimension", ["dimension", " dim "]),
    ("Punching", ["punch"]),
    ("Orientation", ["orient"]),
    ("Visual", ["visual"]),
    ("Damage Material/Bend", ["damage", "bend"]),
    ("Incomplete", ["incomplete", "missing", "short"]),
]


def _classify_rework_type(observation: Any) -> str:
    if pd.isna(observation) or not str(observation).strip():
        return "Other"
    text = f" {str(observation).strip().lower()} "
    for label, keywords in REWORK_TYPE_CATEGORIES:
        if any(keyword in text for keyword in keywords):
            return label
    return "Other"


def build_rework_type_monthly(dataframe: pd.DataFrame) -> dict[str, Any]:
    """
    "REWORK TYPE MONTHLY": per calendar month, a count of Rework-
    status rows in each of the 7 categories from the person's
    template, classified from the free-text QC Observation column
    via _classify_rework_type() - plus an "Other" column for rows
    that don't match any keyword, so nothing is silently dropped.
    Rows with a blank/unmatched Observation report as "Other" too.
    """

    df = _with_status(dataframe)
    df = df[df["_status"] == "Rework"].copy()
    df = df.dropna(subset=["Prod Offer Date"])
    df["_month"] = pd.to_datetime(df["Prod Offer Date"], errors="coerce").dt.strftime("%Y-%m")
    df = df.dropna(subset=["_month"])
    df["_category"] = df["QC Observation"].apply(_classify_rework_type)

    columns = [label for label, _ in REWORK_TYPE_CATEGORIES] + ["Other"]

    rows = []
    for month, group in df.groupby("_month"):
        counts = group["_category"].value_counts()
        row = {"month": month}
        for column in columns:
            row[column] = int(counts.get(column, 0))
        rows.append(row)

    rows.sort(key=lambda r: r["month"])
    return {"columns": columns, "rows": rows}
