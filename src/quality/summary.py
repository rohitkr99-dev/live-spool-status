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
"Final Status" is free text from the shop floor and varies in case
("Accept" / "accept" / "ACCEPT") and occasionally means something
that's neither an accept nor a rework ("Project hold",
"SPOOL DELETED"). Every function below normalizes it the same way:

    ACCEPT-family  -> "Accept"
    REWORK-family  -> "Rework"
    anything else  -> "Other" (held/deleted rows - excluded from the
                       rework-rate charts, since they're not a QC
                       accept/reject outcome)

"Type of Rework" is similarly free text (case/whitespace variants of
the same defect - "C ID" vs " C ID", "Serration damage" vs
"SERRATION DAMAGE"). Grouping uses a stripped+uppercased key, but
the label shown on the chart is the most common ORIGINAL spelling
for that key, so acronyms like "RT" don't get mangled by a blanket
.title() call.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import pandas as pd

SPOOL_KEY_COLUMNS = ["Project Code", "Drawing No", "Spool No"]


def _normalize_status(raw: Any) -> str:
    if pd.isna(raw):
        return "Other"
    text = str(raw).strip().upper()
    if text == "ACCEPT":
        return "Accept"
    if text == "REWORK":
        return "Rework"
    return "Other"


def _with_status(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.copy()
    dataframe["_status"] = dataframe["Final Status"].apply(_normalize_status)
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
    week_start = (dates - pd.to_timedelta(dates.dt.weekday, unit="D")).dt.date.astype(str)
    month = dates.dt.strftime("%Y-%m")
    return pd.DataFrame({"day": day, "week": week_start, "month": month})


def build_rework_trend(dataframe: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    """
    Chart 4: rework rate over time, at 3 granularities (the website
    lets the person switch between them). Rate = rework events /
    total offer events within that period - a spool offered more
    than once (rework cycle) contributes one event per offer, same
    denominator logic as build_kpis()'s overall_rework_rate_pct.
    """

    df = _with_status(dataframe)
    df = df.dropna(subset=["Prod Offer Date"])
    df["Prod Offer Date"] = pd.to_datetime(df["Prod Offer Date"], errors="coerce")
    df = df.dropna(subset=["Prod Offer Date"])

    periods = _period_labels(df["Prod Offer Date"])
    df = pd.concat([df.reset_index(drop=True), periods.reset_index(drop=True)], axis=1)

    out: dict[str, list[dict[str, Any]]] = {}
    for granularity in ("day", "week", "month"):
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
