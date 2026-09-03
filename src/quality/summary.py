"""
src/quality/summary.py
---------------------------------------------------------
Aggregates raw QC workbooks into the JSON structures the Quality
Assurance/Control dashboard (website/quality.html) charts against.
No chart/rendering logic lives here - only numbers, computed once in
Python so the website only has to display them.

Two independent data sources feed this file - deliberately never
mixed:

  Inspection Data workbook (2026-09-02, extended 2026-09-03) ->
  build_kpis(), build_first_offer_split(), build_rework_by_project(),
  build_rework_trend(), build_rework_cycles(), build_top_rework_types()
  - the Overview KPI cards + all 5 charts. See
  _normalize_inspection_status() below.

  Rework Data workbook (unchanged) -> build_rework_status_monthly(),
  build_rework_type_monthly() - still uses src/rework_pdqc_rule.py's
  Accept/Hold/Rework classification, same as the PDQC/RFP Absolute
  Rules. See _normalize_status() below.

Per the person's explicit instruction (2026-09-02): the Overview
section now reflects the Inspection Data workbook - QC's own
continuous PDQC log - instead of the Rework Data workbook, but this
is a dashboard-display-only change. It does not touch, and must
never be made to touch, src/rework_pdqc_rule.py or anything the
PDQC/RFP Absolute Rules depend on.

Date scope
-----------
The Inspection Data dataframe passed into every build_* function
below has already been through scope_inspection_data_to_current_cycle()
(called once in pipeline.py) - current fiscal cycle only, except the
named projects in NAMED_PROJECT_CODES_WITH_FULL_HISTORY, which keep
their full history. See that function's docstring.

Inspection Data status normalization
-------------------------------------
"Final Status" is free text QC enters per offer event - almost
always either the literal word "Accept", or the specific rework/
defect-type reason itself (e.g. "Bend", "Degree", "Not Found",
"Punching") rather than a generic "Rework" label. Per the person:

    "accept" (any case/whitespace)      -> "Accept"
    "hold" (any case/whitespace)        -> "Other" (excluded from
                                            the rework-rate charts,
                                            same role this bucket has
                                            always played here)
    anything else (a specific defect-
    type reason, "Rework", blank, ...)  -> "Rework"

One override on top of that rule (2026-09-02, given by the person
after spotting a real example): a row whose Prod Offer cell held
multiple "/"-separated dates (a re-offer) AND whose Final Status is
literally "Accept" counts as Rework anyway - confirmed against the
real file (956 multi-date cells total, 262 of them Accept, e.g. Insp
Remark "tag/punching balance, SS tag required" recorded as Accept)
that this combination almost always means a real deficiency was
found and corrected before acceptance, which the single Final Status
value alone doesn't capture. See reader.py -> read_inspection_data()
(INSPECTION_REOFFERED_BEFORE_ACCEPT) and _with_inspection_status()
below - these rows are also dated at their EARLIEST offer date
(when the deficiency was first found), unlike every other multi-date
cell, which keeps resolving to the latest date.

Rework Data status normalization (unchanged)
----------------------------------------------
"Packing Release Date" (column K) is free text from QC recording the
outcome of each offer event - despite the column name, it is not a
date. It varies in case ("Packing Release" / "RFP" / "FQC Accept")
and occasionally means something that's neither an accept nor a
rework ("Project Hold", "Query", "Hold"). The two monthly export
functions normalize it the same way, reusing the single shared
classification in src/rework_pdqc_rule.py (Accept/Hold/Rework) so
they can never drift out of sync with the Projects/Production
pipelines - "Other" plays the same excluded role as above.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from constants import INSPECTION_REOFFERED_BEFORE_ACCEPT
from quality.logger import logger
from rework_pdqc_rule import normalize_rework_status
from utils import fiscal_week_info, today, week_number_to_start_date

SPOOL_KEY_COLUMNS = ["Project Code", "Drawing No", "Spool No"]

# 2026-09-02, given by the person: the Overview should only cover
# the current fiscal cycle (30 March 2026 onward, same Week 1 anchor
# fiscal_week_info()/week_number_to_start_date() already use
# elsewhere - rolls forward on its own each year, e.g. 5 April 2027
# for FY27/28) - EXCEPT these specific projects, which should keep
# their full history regardless of date, since their own inspection
# activity mostly happened before this cycle started. Caught and
# corrected the same day: an earlier pass applied full history to
# every project instead of just these - see CHANGELOG.md.
NAMED_PROJECT_CODES_WITH_FULL_HISTORY = [
    "TJ/25-26/172", "TJ/25-26/184", "TJ/25-26/182", "TJ/25-26/183",
    "TJ/25-26/188", "TJ/25-26/189", "TJ/25-26/206", "TE/25-26/196",
]


def scope_inspection_data_to_current_cycle(dataframe: pd.DataFrame) -> pd.DataFrame:
    """
    Restricts the Inspection Data dataframe to the current fiscal
    cycle (Prod Offer Date on/after this cycle's Week 1) before it
    reaches any Overview KPI/chart function - except rows belonging
    to NAMED_PROJECT_CODES_WITH_FULL_HISTORY above, which pass
    through untouched regardless of date. A row with an unparseable/
    missing Prod Offer Date is excluded unless its project is on the
    named list (same as any other out-of-cycle row).

    Applied once here, in one place, rather than inside each of the
    5 Overview functions - they all just receive an already-scoped
    dataframe, same as before this existed.
    """

    if dataframe.empty or "Prod Offer Date" not in dataframe.columns:
        return dataframe

    cycle_start = pd.Timestamp(week_number_to_start_date(1, today()))
    offer_dates = pd.to_datetime(dataframe["Prod Offer Date"], errors="coerce")
    in_current_cycle = offer_dates >= cycle_start
    named_project = dataframe["Project Code"].isin(NAMED_PROJECT_CODES_WITH_FULL_HISTORY)

    return dataframe[in_current_cycle | named_project]


def _normalize_inspection_status(raw: Any) -> str:
    """
    Classifies one Inspection Data "Final Status" cell into Accept /
    Rework / Other - see the module docstring above. This is
    deliberately separate from _normalize_status()/
    normalize_rework_status() below: a different workbook, with a
    free-text vocabulary of ~150 defect-type values rather than a
    small controlled status list, so reusing the Rework Data
    workbook's classifier here would misfire its "unrecognized
    status" warning on nearly every rework row.
    """
    if pd.isna(raw) or not str(raw).strip():
        return "Rework"
    text = str(raw).strip().casefold()
    if text == "accept":
        return "Accept"
    if text == "hold":
        return "Other"
    return "Rework"


def _with_inspection_status(dataframe: pd.DataFrame) -> pd.DataFrame:
    dataframe = dataframe.copy()
    dataframe["_status"] = dataframe["Final Status"].apply(_normalize_inspection_status)

    # 2026-09-02, given by the person: a row flagged
    # INSPECTION_REOFFERED_BEFORE_ACCEPT (reader.py -
    # read_inspection_data() - a multi-date Prod Offer cell whose
    # Final Status is literally "Accept") counts as Rework here
    # regardless of that literal status - confirmed against the real
    # file that this combination almost always means a deficiency was
    # found and corrected before acceptance, which "Accept" alone
    # doesn't capture.
    if INSPECTION_REOFFERED_BEFORE_ACCEPT in dataframe.columns:
        reoffer_mask = dataframe[INSPECTION_REOFFERED_BEFORE_ACCEPT].fillna(False).astype(bool)
        dataframe.loc[reoffer_mask, "_status"] = "Rework"

    return dataframe


def _normalize_status(raw: Any) -> str:
    status = normalize_rework_status(raw)
    # Collapse the shared Accept/Hold/Rework classification down to
    # this dashboard's existing Accept/Rework/Other shape - "Other"
    # is the same bucket it always was here, unchanged in meaning or
    # in every chart/field name built on top of it below. Used only
    # by build_top_rework_types()/the monthly export functions now -
    # see module docstring.
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
    """
    Overview KPI cards. `dataframe` is the Inspection Data workbook
    (2026-09-02) - see module docstring.
    """

    df = _with_inspection_status(dataframe)

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


# Chart 1's categorization (2026-09-03, given by the person - "use
# your knowledge to categorize them"). Maps a normalized (stripped,
# uppercased) Inspection Data "Final Status" value to a defect-type
# category, consolidating obvious spelling/wording variants of the
# SAME defect (e.g. "MSN TAG BAL" / "TAG BALANCE" / "TAG WRONG" all
# -> Tag; "PUNCH BAL" / "MSN PUNCHING BAL" / "PUNCH WRONG" all ->
# Punching). "Degree" is kept separate from "Orientation" on
# purpose: the shop's own Sheet2 tally in the Inspection Data
# workbook already treats them as distinct categories, and nothing
# here should second-guess that. Built and verified against the
# person's real Aug-2026 file (105 distinct values, all mapped, 0
# fell through to "Unclassified") - a genuinely new defect-type
# wording in a future sync will fall through to "Unclassified"
# (folded into "Others" on the chart) and gets logged so it can be
# added here, same as REWORK_TYPE_CATEGORIES below.
INSPECTION_DEFECT_TYPE_CATEGORIES: dict[str, str] = {
    # Dimension
    "DIM": "Dimension", "DIMENSION": "Dimension", "ELBOW HEIGHT LESS": "Dimension",
    "THICKNESS LESS": "Dimension", "WELDING BOSS DIA LESS": "Dimension",
    "HC DIA MORE THAN ID": "Dimension",
    # Bend
    "BEND": "Bend", "HANDWHEEL BEND": "Bend",
    # Degree (kept separate from Orientation - see above)
    "DEGREE": "Degree",
    # Bevel
    "BEVEL": "Bevel", "THICKNESS LESS ON BEVEL": "Bevel", "BEVEL DAMAGE": "Bevel",
    "PIPE REQ. PLAIN END & FOUND BEVEL": "Bevel", "REQ BEVEL FOUND PLAIN END": "Bevel",
    # Punching
    "PUNCHING BAL": "Punching", "PUNCHING": "Punching", "PUNCH BAL": "Punching",
    "MSN PUNCHING BAL": "Punching", "C.NO. PUNCH BAL": "Punching", "MSN PUNCH BAL": "Punching",
    "HOLE DIRECTION PUNCH BAL": "Punching", "PUNCH WRONG": "Punching",
    # Welding
    "WELDING LESS": "Welding", "WELD SIZE LESS": "Welding",
    "WELD REQ. 2 SIDE FOUND ALL AROUND": "Welding", "WELD LESS": "Welding",
    "SUPPORT WELD INCOMPLETE": "Welding", "WELD INCOMPLETE": "Welding",
    "WELD VISUAL NOT OKAY": "Welding", "WELD BAL": "Welding", "TACKING ON ELBOW": "Welding",
    "TACKING BAL": "Welding", "ARC STRIKE": "Welding", "SPATTER": "Welding",
    "TACK WELD GRINDING REQ.": "Welding",
    # Tag
    "TAG WRONG": "Tag", "MSN TAG BALANCE": "Tag", "MSN TAG WRONG": "Tag", "TAG": "Tag",
    "TAG DAMAGE": "Tag", "TAG BALANCE": "Tag", "MSN TAG BAL": "Tag",
    # Orientation
    "ORIENTATION": "Orientation", "VALVE TILT": "Orientation", "ORIENTATION WRONG": "Orientation",
    "VALVE HANDLE ORIENTATION": "Orientation", "WRONG ORIENTATION": "Orientation",
    "PLATE ORIENTATION WRONG": "Orientation",
    # Hold / Query - administrative, not a technical defect
    "HOLD FOR SOCKOLET": "Hold / Query", "PROJECT HOLD": "Hold / Query", "FFW QUERY": "Hold / Query",
    "PLATE QUERY": "Hold / Query", "DESIGN QUERY": "Hold / Query", "RT PLUG QUERY": "Hold / Query",
    "ENGINEERING HOLD": "Hold / Query",
    # Inside Cleaning
    "INSIDE CLEANING": "Inside Cleaning", "INSIDE CLEANING BALANCE": "Inside Cleaning",
    "INSIDE CLEANING BAL": "Inside Cleaning",
    # Hardness
    "HARDNESS HIGH": "Hardness", "HIGH HARDNESS": "Hardness",
    # PWHT (Post Weld Heat Treatment)
    "PWHT BAL": "PWHT", "RE-PWHT": "PWHT",
    # Material / Grade Wrong
    "PIPE GRADE REQ. C & FOUND B": "Material / Grade Wrong", "REQ. P11 FOUND CS": "Material / Grade Wrong",
    "WELD REQ P22 FOUND CS": "Material / Grade Wrong", "SPOOL WRONG": "Material / Grade Wrong",
    "WRONG SPOOL": "Material / Grade Wrong", "PIPE REQ. NPT & FOUND PLAIN END": "Material / Grade Wrong",
    "REQ PLAIN FOUND THREAD END": "Material / Grade Wrong", "SCHEDULE WRONG": "Material / Grade Wrong",
    # ID / Marking
    "C ID": "ID / Marking", "ID": "ID / Marking",
    "OVALITY": "Ovality",
    "SERRATION DAMAGE": "Serration Damage",
    "NOT FOUND": "Not Found",
    # Thread
    "THREAD BAL": "Thread", "THREAD DAMAGE": "Thread", "THREAD LENGTH REQ 14MM": "Thread",
    "DENT": "Dent",
    # Cut Mark
    "CUT MARK": "Cut Mark", "GAS CUT MARK": "Cut Mark", "CHUCK MARK": "Cut Mark",
    # Blasting
    "BLAST DONE": "Blasting", "BLASTING DONE": "Blasting",
    # Root Flush
    "ROOT FLUSH BAL": "Root Flush", "ROOT FLUSH BAL FLANGE": "Root Flush",
    "HC ROOT FLUSH BALANCE": "Root Flush",
    # Burr / Deburring
    "BURRS IN HOLE": "Burr / Deburring", "BURR": "Burr / Deburring", "HOLE DEBURRING BAL": "Burr / Deburring",
    # Vent Hole
    "VENT HOLE BAL": "Vent Hole", "WEEP HOLE BAL": "Vent Hole",
    "ORIFICE ASSEMBLY": "Orifice Assembly",
    # Support
    "SUPPORT HOLE BALANCE": "Support", "SUPPORT HOLE NOT IN BOTTOM": "Support",
    "WB FINISHING BAL": "WB Finishing",
    # Incomplete Spool (the whole spool, distinct from a specific weld being incomplete)
    "INCOMPLETE": "Incomplete Spool", "INCOMPLETE SPOOL": "Incomplete Spool",
    # Handwheel / Valve misc (orientation-specific handwheel issues stay under Orientation)
    "HANDWHEEL BALANCE": "Handwheel / Valve", "VALVE HANDLE DAMAGE": "Handwheel / Valve",
    # True one-offs with nothing else to group under
    "FACE OUT": "Unclassified", "SLOPE NOT MAINTAINED": "Unclassified", "TRIM BAL": "Unclassified",
    "RT PLUG NOT TIGHT": "Unclassified", "FL HOLE OUT": "Unclassified",
}

# Fallback classification for rows flagged
# INSPECTION_REOFFERED_BEFORE_ACCEPT (Final Status literally "Accept",
# so there's no defect word to look up above) - keyword-matched
# against the free-text Insp Remark instead, first match wins. Order
# matters: "direction"/"orientation" is checked before the generic
# "handwheel" keyword so a remark like "Handwheel in +X direction but
# need +Y" lands under Orientation (the actual correction needed),
# not a generic Handwheel/Valve bucket - while a bare "Handwheel not
# available" (no direction/orientation wording) still falls through
# to Handwheel/Valve correctly. Verified against all 15 real
# 2026-09-02 examples before this was written.
INSPECTION_REMARK_DEFECT_KEYWORDS: list[tuple[str, list[str]]] = [
    ("Bevel", ["bevel"]),
    ("Tag", ["tag"]),
    ("Dimension", ["nozzle", "height required", "dimension"]),
    ("Orientation", ["direction", "orientation"]),
    ("Handwheel / Valve", ["handwheel", "valve handle"]),
    ("Inside Cleaning", ["scal", "inside clean", "blast"]),
]


def _classify_inspection_defect_type(
    final_status: Any,
    insp_remark: Any,
    reoffered_before_accept: bool,
) -> str:
    if reoffered_before_accept:
        text = f" {str(insp_remark).strip().lower()} " if pd.notna(insp_remark) else ""
        for label, keywords in INSPECTION_REMARK_DEFECT_KEYWORDS:
            if any(keyword in text for keyword in keywords):
                return label
        return "Unclassified"

    key = str(final_status).strip().upper() if pd.notna(final_status) else ""
    return INSPECTION_DEFECT_TYPE_CATEGORIES.get(key, "Unclassified")


def build_top_rework_types(dataframe: pd.DataFrame, top_n: int = 10) -> dict[str, Any]:
    """
    Chart 1: top N defect-type categories (by rework event count,
    from the Inspection Data workbook - see
    INSPECTION_DEFECT_TYPE_CATEGORIES/INSPECTION_REMARK_DEFECT_KEYWORDS
    above), with everything else outside the top N collapsed into
    "Others". Only rows whose status normalizes to "Rework" are
    counted - "Accept"/"Other" (Hold) rows never contribute here.
    `dataframe` is the Inspection Data workbook - see module
    docstring.
    """

    df = _with_inspection_status(dataframe)
    rework_rows = df[df["_status"] == "Rework"].copy()

    total = len(rework_rows)

    if total == 0:
        return {"items": [], "total_rework_events": 0}

    has_reoffer_column = INSPECTION_REOFFERED_BEFORE_ACCEPT in rework_rows.columns

    def _row_category(row) -> str:
        reoffered = (
            bool(row[INSPECTION_REOFFERED_BEFORE_ACCEPT])
            if has_reoffer_column and pd.notna(row[INSPECTION_REOFFERED_BEFORE_ACCEPT])
            else False
        )
        return _classify_inspection_defect_type(
            row["Final Status"], row.get("Insp Remark"), reoffered
        )

    rework_rows["_defect_category"] = rework_rows.apply(_row_category, axis=1)

    unclassified = rework_rows[rework_rows["_defect_category"] == "Unclassified"]
    if not unclassified.empty:
        sample = sorted(set(str(v).strip() for v in unclassified["Final Status"]))[:10]
        logger.warning(
            f"build_top_rework_types: {len(unclassified)} row(s) didn't "
            "match any known defect-type category (folded into "
            f"'Others') - sample unmapped Final Status value(s): {sample}. "
            "Add these to INSPECTION_DEFECT_TYPE_CATEGORIES if they're "
            "a genuine new defect type."
        )

    counts = rework_rows["_defect_category"].value_counts()

    ranked = [
        {"label": label, "count": int(count)}
        for label, count in counts.items()
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
    is included alongside as the secondary figure. `dataframe` is
    the Inspection Data workbook - see module docstring.
    """

    df = _with_inspection_status(dataframe)

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
    needed at least one rework before acceptance. `dataframe` is the
    Inspection Data workbook - see module docstring.
    """

    df = _with_inspection_status(dataframe)
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

    `dataframe` is the Inspection Data workbook - see module
    docstring.
    """

    df = _with_inspection_status(dataframe)
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
    on their own. `dataframe` is the Inspection Data workbook - see
    module docstring.
    """

    df = _with_inspection_status(dataframe)

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
