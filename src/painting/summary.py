"""
src/painting/summary.py
---------------------------------------------------------
Every aggregate the Painting dashboard needs, computed from the two
row sets reader.py hands back (dpr_rows: RFP-done spools straight off
the DPR, painting_rows: the Painting Weekly Plan workbook's own Spool
List) - nothing here touches Excel or JSON directly.

Day-count convention: every "days between two dates" figure on this
dashboard uses utils.working_day_variance() - the SAME holiday-aware
working-day calculator the Production dashboard's "ideal 4 days,
RFP -> PDI Clearance" target (config/production_rules.json ->
pdi_clearance minus release_for_painting, uniformly 4 across every
category) is itself measured in. Using calendar days here instead
would make the on-page "4-day ideal" comparison read wrong.

Stage order this whole module keys off:
  RFP -> Internal Blasting -> External Blasting -> Primer ->
  (next coat, if any, else PDI Offer) -> PDI Offer -> PDI Clearance

Applicability (2026-09-03, given by the person against real data):
  - Internal Blasting applies only where the workbook's own "Internal
    Blasting Reqd (Yes/No)" flag says Yes - independent of whether the
    spool needs paint at all (confirmed against real data: 192 spools
    need internal blasting with zero paint coats - it's surface prep,
    not part of the paint system).
  - External Blasting and Primer apply only where "No.of Coats" >= 1
    (0 coats -> the workbook's own date cells read literal "NA" for
    both, confirmed 100% correlated on every row of the real file -
    see build_stage_funnel()). A spool with 0 coats gets neither.
  - Pickling has no Reqd flag and no NA convention of its own - it's
    the alternative route for the same "0 coats" (no-paint) group
    (confirmed: every Pickling Date in the real file belongs to a
    Paint System = "NA" row) - so it's reported as an insight
    (is_pickling_route), not gated as strictly applicable/not.
  - PDI Offer/Clearance always apply to every RFP-done spool
    regardless of paint - it's the terminal gate before Packing.
A spool not in the Painting Plan at all has no "No.of Coats"/Reqd
flag to read, so every applicability field is None (unknown) for it,
not True/False - see _build_record().
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from statistics import mean, median
from typing import Any

from utils import today, working_day_variance

IDEAL_CYCLE_DAYS = 4  # config/production_rules.json: pdi_clearance - release_for_painting, every category
STUCK_THRESHOLD_DAYS = 2 * IDEAL_CYCLE_DAYS  # still open, past 2x the ideal - "needs attention now"
EXTREME_THRESHOLD_DAYS = 15  # completed, but the cycle blew well past ideal - worth a root-cause look

CYCLE_BUCKETS = [
    (0, 4, "0–4 days (ideal)"),
    (5, 9, "5–9 days"),
    (10, 14, "10–14 days"),
    (15, 19, "15–19 days"),
    (20, 24, "20–24 days"),
    (25, 29, "25–29 days"),
    (30, None, "30+ days"),
]

# (record field holding the date, output key, display label) - the
# stages build_stage_output_trend() reports per day/week/month.
OUTPUT_TREND_STAGES = [
    ("internal_blasting_date", "internal_blasting", "Internal Blasting"),
    ("external_blasting_date", "external_blasting", "External Blasting"),
    ("primer_date", "primer", "Primer"),
    ("pickling_date", "pickling", "Pickling"),
    ("pdi_offer_date", "pdi_offer", "PDI Offer"),
    ("pdi_clearance_date", "pdi_clearance", "PDI Clearance"),
]


def _d(iso: str | None) -> date | None:
    if not iso:
        return None
    return datetime.strptime(iso, "%Y-%m-%d").date()


def _diff(start_iso: str | None, end_iso: str | None) -> int | None:
    """Signed working-day gap, start -> end. None if either date is missing."""
    return working_day_variance(_d(start_iso), _d(end_iso))


def _bucket_of(days: int) -> str:
    for low, high, label in CYCLE_BUCKETS:
        if high is None:
            if days >= low:
                return label
        elif low <= days <= high:
            return label
    return CYCLE_BUCKETS[-1][2]


def _round1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _iso_week_key(d: date) -> str:
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


# ---------------------------------------------------------------
# Merge
# ---------------------------------------------------------------

def merge_spools(dpr_rows: list[dict], painting_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    One record per RFP-done DPR spool, joined to its Painting Weekly
    Plan row by Composite Key where one exists. dpr_rows is the
    authority for identity/Qty/Weight/Surface Area/Inch Dia/RFP/PDI
    Clearance; painting_rows is the only source for every
    blasting/primer/coat/PDI-Offer date, per the person's own
    instruction to take the former from the DPR and not re-derive it
    from the Painting sheet.

    Returns (merged, excluded_already_packed):
      - merged: every RFP-done spool worth analysing for painting
        cycle time.
      - excluded_already_packed: RFP-done spools that never made it
        into the Painting Plan AND already have a Packing or Dispatch
        date on the DPR - given by the person (2026-09-03): a spool
        already packed/dispatched clearly didn't need painting
        tracked here, so it's dropped from every calculation rather
        than counted as a "missing from plan" gap. Still reported as
        its own list (not silently discarded) so it's auditable.

    A painting_rows entry whose Composite Key has no matching dpr_rows
    entry (RFP not recorded against it in the DPR) is NOT included
    in `merged` either - see build_not_in_dpr(), which reports that
    set separately since it's a data-quality signal, not a spool this
    dashboard should analyse RFP-to-PDI cycle time for.
    """
    painting_by_key = {p["composite_key"]: p for p in painting_rows}

    merged: list[dict] = []
    excluded_already_packed: list[dict] = []
    for d in dpr_rows:
        p = painting_by_key.get(d["composite_key"])
        if p is None and (d.get("packing_date") or d.get("dispatch_date")):
            excluded_already_packed.append({
                "composite_key": d["composite_key"],
                "project_code": d["project_code"],
                "project_name": d.get("project_name"),
                "drawing_no": d["drawing_no"],
                "spool_no": d["spool_no"],
                "rfp_date": d["rfp_date"],
                "packing_date": d.get("packing_date"),
                "dispatch_date": d.get("dispatch_date"),
            })
            continue
        merged.append(_build_record(d, p))
    return merged, excluded_already_packed


def _yes_no_flag(raw: str | None) -> bool | None:
    if raw is None:
        return None
    text = raw.strip().lower()
    if text == "yes":
        return True
    if text == "no":
        return False
    return None


def _canonical_bay(raw: str | None) -> str | None:
    """
    The real workbook's BAY NO column mixes case ("BAY-4" / "Bay-4") and
    stray trailing spaces (already trimmed by reader.py's clean_text(),
    but the case difference isn't) - confirmed 2026-09-04 against the
    real file: 1720 "BAY-4" + 200 "Bay-4" are the same bay, same for
    "BAY-6"/"Bay-6". Upper-cased here so they group together. "NA"
    (559 rows) means no bay was assigned for that spool - reported as
    None (not applicable), same convention as every other not-
    applicable field in this module, so it's excluded from
    build_bay_output_trend() rather than shown as a fake fourth bay.
    """
    if not raw:
        return None
    text = raw.strip().upper()
    if text in {"NA", "N/A", ""}:
        return None
    return text


def _build_record(d: dict, p: dict | None) -> dict:
    rfp = d["rfp_date"]
    pdi_clearance = d["pdi_clearance_date"]
    no_of_coats = (p or {}).get("no_of_coats")

    record: dict[str, Any] = {
        "composite_key": d["composite_key"],
        "project_code": d["project_code"],
        "project_name": d.get("project_name"),
        "drawing_no": d["drawing_no"],
        "spool_no": d["spool_no"],
        "material": d.get("material"),
        "item_category": (p or {}).get("item_category") or d.get("item_category"),
        "quantity": d.get("quantity"),
        "weight": d.get("weight"),
        "inch_dia": d.get("inch_dia"),
        "surface_area": d.get("surface_area"),
        "rfp_date": rfp,
        "pdi_clearance_date": pdi_clearance,
        "in_painting_plan": p is not None,
        "painting_status": (p or {}).get("status"),
        "paint_system": (p or {}).get("paint_system"),
        "bay_no": _canonical_bay((p or {}).get("bay_no")),
        "no_of_coats": no_of_coats,
        "internal_blasting_reqd": (p or {}).get("internal_blasting_reqd"),
        "internal_blasting_date": (p or {}).get("internal_blasting_date"),
        "external_blasting_date": (p or {}).get("external_blasting_date"),
        "primer_date": (p or {}).get("primer_date"),
        "mid_coat_1_date": (p or {}).get("mid_coat_1_date"),
        "mid_coat_2_date": (p or {}).get("mid_coat_2_date"),
        "top_coat_date": (p or {}).get("top_coat_date"),
        "pickling_date": (p or {}).get("pickling_date"),
        "pdi_offer_date": (p or {}).get("pdi_offer_date"),
        "pdi_status_acceptance_date": (p or {}).get("pdi_status_acceptance_date"),
    }

    # --- applicability (see module docstring) - None when unknown
    # (not in the Painting Plan, so there's no Reqd flag / No.of Coats
    # to read for this spool at all).
    record["internal_blasting_applicable"] = _yes_no_flag(record["internal_blasting_reqd"])
    record["paint_applicable"] = None if no_of_coats is None else bool(no_of_coats >= 1)
    record["is_pickling_route"] = record["paint_applicable"] is False

    # --- next coat: first of Mid Coat 1 / Mid Coat 2 / Top Coat that's
    # filled in; falls back to PDI Offer (per the person's own
    # instruction) when none are - flagged via next_coat_source so the
    # UI can say plainly whether it's showing a real next-coat date or
    # the fallback.
    next_coat_date = None
    next_coat_source = None
    for field, source in (
        ("mid_coat_1_date", "mid_coat_1"),
        ("mid_coat_2_date", "mid_coat_2"),
        ("top_coat_date", "top_coat"),
    ):
        if record[field]:
            next_coat_date = record[field]
            next_coat_source = source
            break
    if next_coat_date is None and record["pdi_offer_date"]:
        next_coat_date = record["pdi_offer_date"]
        next_coat_source = "pdi_offer_fallback"
    record["next_coat_date"] = next_coat_date
    record["next_coat_source"] = next_coat_source

    # --- stage transitions (signed working days; negative = out of
    # order). Explicitly nulled when the stage doesn't apply to this
    # spool at all, on top of the date fields themselves already being
    # None for a not-applicable stage (see reader.py: the workbook's
    # own literal "NA" text already parses to None) - belt and braces,
    # so a stray/mis-keyed date can never sneak into an average for a
    # process this spool never needed (points 2 and 5).
    record["rfp_to_internal_blasting_days"] = (
        _diff(rfp, record["internal_blasting_date"]) if record["internal_blasting_applicable"] is not False else None
    )
    record["rfp_to_external_blasting_days"] = (
        _diff(rfp, record["external_blasting_date"]) if record["paint_applicable"] is not False else None
    )
    record["primer_to_next_days"] = (
        _diff(record["primer_date"], next_coat_date) if record["paint_applicable"] is not False else None
    )
    record["pdi_offer_to_clearance_days"] = _diff(record["pdi_offer_date"], pdi_clearance)

    is_complete = pdi_clearance is not None
    record["is_complete"] = is_complete
    if is_complete:
        record["total_cycle_days"] = _diff(rfp, pdi_clearance)
        record["current_age_days"] = None
    else:
        record["total_cycle_days"] = None
        record["current_age_days"] = working_day_variance(_d(rfp), today())

    record["anomalies"] = _spool_anomalies(record)
    return record


def _spool_anomalies(r: dict) -> list[str]:
    flags: list[str] = []

    if not r["in_painting_plan"]:
        flags.append("missing_from_plan")
        return flags  # nothing else below is checkable without a plan row

    if r["no_of_coats"] is None:
        flags.append("coats_missing")

    reqd = (r["internal_blasting_reqd"] or "").strip().lower()
    has_date = r["internal_blasting_date"] is not None
    if reqd == "yes" and not has_date:
        flags.append("blasting_reqd_but_no_date")
    elif reqd == "no" and has_date:
        flags.append("blasting_date_but_not_reqd")

    # Point 7: external blasting implies priming. Currently 0 rows in
    # the real file violate this (External Blasting and Primer are
    # 100% correlated) - kept as a live check for future data.
    if r["external_blasting_date"] is not None and r["primer_date"] is None:
        flags.append("external_blasted_no_primer")

    for field in ("rfp_to_internal_blasting_days", "rfp_to_external_blasting_days",
                  "primer_to_next_days", "pdi_offer_to_clearance_days"):
        value = r[field]
        if value is not None and value < 0:
            flags.append("out_of_order_dates")
            break

    if r["pdi_clearance_date"] and r["pdi_status_acceptance_date"]:
        if r["pdi_clearance_date"] != r["pdi_status_acceptance_date"]:
            flags.append("dpr_painting_pdi_mismatch")

    if not r["is_complete"] and (r["current_age_days"] or 0) > STUCK_THRESHOLD_DAYS:
        flags.append("stuck_long_open")

    if r["is_complete"] and (r["total_cycle_days"] or 0) > EXTREME_THRESHOLD_DAYS:
        flags.append("extreme_cycle_time")

    return flags


def build_not_in_dpr(dpr_rows: list[dict], painting_rows: list[dict]) -> list[dict]:
    """Painting Plan rows whose Composite Key has no RFP-done match in the DPR - see merge_spools()."""
    dpr_keys = {d["composite_key"] for d in dpr_rows}
    out = []
    for p in painting_rows:
        if p["composite_key"] in dpr_keys:
            continue
        out.append({
            "composite_key": p["composite_key"],
            "project_code": p["project_code"],
            "drawing_no": p["drawing_no"],
            "spool_no": p["spool_no"],
            "status": p.get("status"),
            "qc_rfp_date": p.get("qc_rfp_date"),
        })
    return out


# ---------------------------------------------------------------
# KPIs + stage funnel
# ---------------------------------------------------------------

# (key, label, applicable predicate, done predicate) - applicable_count
# is the real denominator for that stage (points 2, 5, 6, 7 - never
# the full RFP-done population), done_count/applicable_count is the
# percentage actually shown.
STAGE_FUNNEL_DEFS = [
    ("rfp_done", "RFP Done", lambda r: True, lambda r: True),
    ("in_plan", "In Painting Plan", lambda r: True, lambda r: r["in_painting_plan"]),
    ("internal_blasting_done", "Internal Blasting",
     lambda r: r["internal_blasting_applicable"] is True, lambda r: r["internal_blasting_date"] is not None),
    ("external_blasting_done", "External Blasting",
     lambda r: r["paint_applicable"] is True, lambda r: r["external_blasting_date"] is not None),
    ("primer_done", "Primer",
     lambda r: r["paint_applicable"] is True, lambda r: r["primer_date"] is not None),
    ("pickling_done", "Pickling (no-paint route)",
     lambda r: r["is_pickling_route"], lambda r: r["pickling_date"] is not None),
    ("pdi_offered", "PDI Offered",
     lambda r: r["in_painting_plan"], lambda r: r["pdi_offer_date"] is not None),
    ("pdi_cleared", "PDI Cleared", lambda r: True, lambda r: r["pdi_clearance_date"] is not None),
]


def build_stage_funnel(merged: list[dict]) -> list[dict]:
    out = []
    for key, label, applicable_fn, done_fn in STAGE_FUNNEL_DEFS:
        applicable = [r for r in merged if applicable_fn(r)]
        done = sum(1 for r in applicable if done_fn(r))
        out.append({
            "key": key,
            "stage": label,
            "applicable_count": len(applicable),
            "done_count": done,
            "pct_of_applicable": _round1(100 * done / len(applicable)) if applicable else None,
        })
    return out


def build_kpi_summary(merged: list[dict], not_in_dpr: list[dict], excluded_already_packed: list[dict]) -> dict:
    total = len(merged)
    completed = [r for r in merged if r["is_complete"]]
    open_spools = [r for r in merged if not r["is_complete"]]
    cycle_days = [r["total_cycle_days"] for r in completed if r["total_cycle_days"] is not None]
    stuck = [r for r in open_spools if "stuck_long_open" in r["anomalies"]]
    pickling_eligible = [r for r in merged if r["is_pickling_route"]]
    pickling_done = [r for r in pickling_eligible if r["pickling_date"] is not None]

    return {
        "total_rfp_done": total,
        "in_plan_count": sum(1 for r in merged if r["in_painting_plan"]),
        "missing_from_plan_count": sum(1 for r in merged if not r["in_painting_plan"]),
        "excluded_already_packed_count": len(excluded_already_packed),
        "not_in_dpr_count": len(not_in_dpr),
        "pdi_cleared_count": len(completed),
        "open_count": len(open_spools),
        "stuck_long_open_count": len(stuck),
        "pickling_eligible_count": len(pickling_eligible),
        "pickling_done_count": len(pickling_done),
        "ideal_cycle_days": IDEAL_CYCLE_DAYS,
        "median_total_cycle_days": _round1(median(cycle_days)) if cycle_days else None,
        "avg_total_cycle_days": _round1(mean(cycle_days)) if cycle_days else None,
        "pct_within_ideal": _round1(100 * sum(1 for d in cycle_days if d <= IDEAL_CYCLE_DAYS) / len(cycle_days)) if cycle_days else None,
    }


# ---------------------------------------------------------------
# Stage duration breakdown - the bottleneck view
# ---------------------------------------------------------------

STAGE_SEGMENTS = [
    ("rfp_to_internal_blasting_days", "RFP → Internal Blasting"),
    ("rfp_to_external_blasting_days", "RFP → External Blasting"),
    ("primer_to_next_days", "Primer → Next Coat / PDI Offer"),
    ("pdi_offer_to_clearance_days", "PDI Offer → PDI Clearance"),
    ("total_cycle_days", "RFP → PDI Clearance (total)"),
]


def build_stage_duration_stats(merged: list[dict]) -> list[dict]:
    out = []
    for field, label in STAGE_SEGMENTS:
        values = [r[field] for r in merged if r[field] is not None and r[field] >= 0]
        negative = sum(1 for r in merged if r[field] is not None and r[field] < 0)
        out.append({
            "segment": label,
            "applicable_count": len(values),
            "out_of_order_count": negative,
            "median_days": _round1(median(values)) if values else None,
            "avg_days": _round1(mean(values)) if values else None,
            "p90_days": _round1(sorted(values)[int(0.9 * (len(values) - 1))]) if values else None,
            "max_days": max(values) if values else None,
        })
    return out


def build_cycle_time_histogram(merged: list[dict]) -> list[dict]:
    completed = [r for r in merged if r["total_cycle_days"] is not None and r["total_cycle_days"] >= 0]
    counts = Counter(_bucket_of(r["total_cycle_days"]) for r in completed)
    return [{"bucket": label, "count": counts.get(label, 0)} for _, _, label in CYCLE_BUCKETS]


def build_aging_buckets(merged: list[dict]) -> list[dict]:
    open_spools = [r for r in merged if not r["is_complete"] and (r["current_age_days"] or 0) >= 0]
    counts = Counter(_bucket_of(r["current_age_days"]) for r in open_spools)
    return [{"bucket": label, "count": counts.get(label, 0)} for _, _, label in CYCLE_BUCKETS]


def build_weekly_trend(merged: list[dict]) -> list[dict]:
    """Median total cycle time (completed spools only) grouped by the ISO week their RFP date fell in."""
    by_week: dict[str, list[int]] = {}
    for r in merged:
        if r["total_cycle_days"] is None or r["total_cycle_days"] < 0 or not r["rfp_date"]:
            continue
        key = _iso_week_key(_d(r["rfp_date"]))
        by_week.setdefault(key, []).append(r["total_cycle_days"])

    return [
        {"week": week, "median_days": _round1(median(days)), "count": len(days)}
        for week, days in sorted(by_week.items())
    ]


# ---------------------------------------------------------------
# Process output over time (point 3) - how many spools completed each
# stage per day/week/month, plus the surface area that represents -
# volume of WORK, not cycle time. Every stage groups on its own date
# field; a spool with no date for that stage just isn't counted for
# it, same as every other aggregate in this module.
# ---------------------------------------------------------------

def _period_keys(d: date) -> tuple[str, str, str]:
    return d.isoformat(), _iso_week_key(d), f"{d.year}-{d.month:02d}"


def _group_output(merged: list[dict], date_field: str) -> dict:
    daily: dict[str, dict] = {}
    weekly: dict[str, dict] = {}
    monthly: dict[str, dict] = {}

    for r in merged:
        iso = r.get(date_field)
        if not iso:
            continue
        d = _d(iso)
        day_key, week_key, month_key = _period_keys(d)
        for bucket, key in ((daily, day_key), (weekly, week_key), (monthly, month_key)):
            entry = bucket.setdefault(key, {"count": 0, "surface_area": 0.0})
            entry["count"] += 1
            entry["surface_area"] += r.get("surface_area") or 0.0

    def to_list(bucket: dict) -> list[dict]:
        return [
            {"period": key, "count": v["count"], "surface_area": round(v["surface_area"], 2)}
            for key, v in sorted(bucket.items())
        ]

    return {"daily": to_list(daily), "weekly": to_list(weekly), "monthly": to_list(monthly)}


def build_stage_output_trend(merged: list[dict]) -> dict:
    return {key: _group_output(merged, field) for field, key, _label in OUTPUT_TREND_STAGES}


def _group_output_by_bay(merged: list[dict], date_field: str, bays: list[str]) -> dict:
    """Same grouping as _group_output(), plus a per-bay split within each period - a spool with no bay assigned (see _canonical_bay()) is simply left out, same as a spool with no date for that stage."""
    daily: dict[str, dict] = {}
    weekly: dict[str, dict] = {}
    monthly: dict[str, dict] = {}

    for r in merged:
        bay = r.get("bay_no")
        iso = r.get(date_field)
        if not bay or not iso:
            continue
        d = _d(iso)
        day_key, week_key, month_key = _period_keys(d)
        for bucket, key in ((daily, day_key), (weekly, week_key), (monthly, month_key)):
            by_bay = bucket.setdefault(key, {})
            entry = by_bay.setdefault(bay, {"count": 0, "surface_area": 0.0})
            entry["count"] += 1
            entry["surface_area"] += r.get("surface_area") or 0.0

    def to_list(bucket: dict) -> list[dict]:
        rows = []
        for key, by_bay in sorted(bucket.items()):
            row: dict[str, Any] = {"period": key}
            for bay in bays:
                v = by_bay.get(bay, {"count": 0, "surface_area": 0.0})
                row[bay] = {"count": v["count"], "surface_area": round(v["surface_area"], 2)}
            rows.append(row)
        return rows

    return {"daily": to_list(daily), "weekly": to_list(weekly), "monthly": to_list(monthly)}


def build_bay_output_trend(merged: list[dict]) -> dict:
    """
    Point (2026-09-04): compare each bay's output (Bay-4 vs Bay-6 vs
    Bay-6 Auto) per day/week/month, one process at a time - same 6
    processes as build_stage_output_trend(), just split by bay instead
    of totalled. `bays` is the sorted list of bays actually present, so
    the frontend can build one dataset per bay without hardcoding names.
    """
    bays = sorted({r["bay_no"] for r in merged if r.get("bay_no")})
    return {
        "bays": bays,
        "stages": {key: _group_output_by_bay(merged, field, bays) for field, key, _label in OUTPUT_TREND_STAGES},
    }


# ---------------------------------------------------------------
# More insights (point 8) - where cycle time differs by project or by
# material/paint category, so a slow project or a slow paint system
# doesn't get averaged away in the single site-wide median.
# ---------------------------------------------------------------

def _cycle_stats_for(rows: list[dict]) -> dict:
    completed = [r for r in rows if r["total_cycle_days"] is not None and r["total_cycle_days"] >= 0]
    days = [r["total_cycle_days"] for r in completed]
    stuck = sum(1 for r in rows if "stuck_long_open" in r["anomalies"])
    return {
        "spool_count": len(rows),
        "pdi_cleared_count": len(completed),
        "stuck_long_open_count": stuck,
        "median_cycle_days": _round1(median(days)) if days else None,
        "pct_within_ideal": _round1(100 * sum(1 for d in days if d <= IDEAL_CYCLE_DAYS) / len(days)) if days else None,
    }


def build_project_insight(merged: list[dict]) -> list[dict]:
    by_project: dict[str, list[dict]] = {}
    names: dict[str, str | None] = {}
    for r in merged:
        by_project.setdefault(r["project_code"], []).append(r)
        names.setdefault(r["project_code"], r.get("project_name"))

    out = [
        {"project_code": code, "project_name": names.get(code), **_cycle_stats_for(rows)}
        for code, rows in by_project.items()
    ]
    return sorted(out, key=lambda x: -(x["median_cycle_days"] or 0))


def build_anomalies(not_in_dpr: list[dict], excluded_already_packed: list[dict]) -> dict:
    """
    Only "not_in_dpr" and "excluded_already_packed" need their own
    lists here - both are spools that never made it into `merged` at
    all (see merge_spools()), so there's nowhere else for them to
    live. Every other anomaly category (missing_from_plan,
    coats_missing, blasting_reqd_but_no_date/blasting_date_but_not_
    reqd, external_blasted_no_primer, out_of_order_dates,
    dpr_painting_pdi_mismatch, stuck_long_open, extreme_cycle_time) is
    a spool with that flag set in its own "anomalies" list inside
    `spools` - re-emitting a second, denormalized copy of those spools
    here would double the bundle size for data the frontend already
    has; it filters `spools` by flag client-side instead
    (website/js/painting-tables.js).
    """
    return {
        "not_in_dpr": not_in_dpr,
        "excluded_already_packed": excluded_already_packed,
    }


def build_material_insight(merged: list[dict]) -> list[dict]:
    by_material: dict[str, list[dict]] = {}
    for r in merged:
        key = r.get("material") or "Unknown"
        by_material.setdefault(key, []).append(r)

    out = [{"material": material, **_cycle_stats_for(rows)} for material, rows in by_material.items()]
    return sorted(out, key=lambda x: -(x["median_cycle_days"] or 0))
