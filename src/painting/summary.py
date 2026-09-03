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
"do you have to blast" and "internal vs external" aren't mutually
exclusive - a spool can have either, both, or neither logged; each
transition is only counted for spools where both its endpoint dates
are actually present ("applicable").
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


# ---------------------------------------------------------------
# Merge
# ---------------------------------------------------------------

def merge_spools(dpr_rows: list[dict], painting_rows: list[dict]) -> list[dict]:
    """
    One record per RFP-done DPR spool, joined to its Painting Weekly
    Plan row by Composite Key where one exists. dpr_rows is the
    authority for identity/Qty/Weight/Surface Area/Inch Dia/RFP/PDI
    Clearance; painting_rows is the only source for every
    blasting/primer/coat/PDI-Offer date, per the person's own
    instruction to take the former from the DPR and not re-derive it
    from the Painting sheet.

    A painting_rows entry whose Composite Key has no matching dpr_rows
    entry (RFP not recorded against it in the DPR) is NOT included
    here - see build_not_in_dpr() below, which reports that set
    separately since it's a data-quality signal, not a spool this
    dashboard should analyse RFP-to-PDI cycle time for.
    """
    painting_by_key = {p["composite_key"]: p for p in painting_rows}

    merged: list[dict] = []
    for d in dpr_rows:
        p = painting_by_key.get(d["composite_key"])
        merged.append(_build_record(d, p))
    return merged


def _build_record(d: dict, p: dict | None) -> dict:
    rfp = d["rfp_date"]
    pdi_clearance = d["pdi_clearance_date"]

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

    # --- stage transitions (signed working days; negative = out of order) ---
    record["rfp_to_internal_blasting_days"] = _diff(rfp, record["internal_blasting_date"])
    record["rfp_to_external_blasting_days"] = _diff(rfp, record["external_blasting_date"])
    record["primer_to_next_days"] = _diff(record["primer_date"], next_coat_date)
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

    reqd = (r["internal_blasting_reqd"] or "").strip().lower()
    has_date = r["internal_blasting_date"] is not None
    if reqd == "yes" and not has_date:
        flags.append("blasting_reqd_but_no_date")
    elif reqd == "no" and has_date:
        flags.append("blasting_date_but_not_reqd")

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

STAGE_FUNNEL_DEFS = [
    ("rfp_done", "RFP Done", lambda r: True),
    ("in_plan", "In Painting Plan", lambda r: r["in_painting_plan"]),
    ("internal_blasting_done", "Internal Blasting Done", lambda r: r["internal_blasting_date"] is not None),
    ("external_blasting_done", "External Blasting Done", lambda r: r["external_blasting_date"] is not None),
    ("primer_done", "Primer Done", lambda r: r["primer_date"] is not None),
    ("pdi_offered", "PDI Offered", lambda r: r["pdi_offer_date"] is not None),
    ("pdi_cleared", "PDI Cleared", lambda r: r["pdi_clearance_date"] is not None),
]


def build_stage_funnel(merged: list[dict]) -> list[dict]:
    total = len(merged)
    out = []
    for key, label, predicate in STAGE_FUNNEL_DEFS:
        count = sum(1 for r in merged if predicate(r))
        out.append({
            "key": key,
            "stage": label,
            "count": count,
            "pct_of_rfp_done": _round1(100 * count / total) if total else 0.0,
        })
    return out


def build_kpi_summary(merged: list[dict], not_in_dpr: list[dict]) -> dict:
    total = len(merged)
    completed = [r for r in merged if r["is_complete"]]
    open_spools = [r for r in merged if not r["is_complete"]]
    cycle_days = [r["total_cycle_days"] for r in completed if r["total_cycle_days"] is not None]
    stuck = [r for r in open_spools if "stuck_long_open" in r["anomalies"]]

    return {
        "total_rfp_done": total,
        "in_plan_count": sum(1 for r in merged if r["in_painting_plan"]),
        "missing_from_plan_count": sum(1 for r in merged if not r["in_painting_plan"]),
        "not_in_dpr_count": len(not_in_dpr),
        "pdi_cleared_count": len(completed),
        "open_count": len(open_spools),
        "stuck_long_open_count": len(stuck),
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
        d = _d(r["rfp_date"])
        iso_year, iso_week, _ = d.isocalendar()
        key = f"{iso_year}-W{iso_week:02d}"
        by_week.setdefault(key, []).append(r["total_cycle_days"])

    return [
        {"week": week, "median_days": _round1(median(days)), "count": len(days)}
        for week, days in sorted(by_week.items())
    ]


# ---------------------------------------------------------------
# Anomalies - spool-level lists for cleanup
# ---------------------------------------------------------------

def build_anomalies(not_in_dpr: list[dict]) -> dict:
    """
    Only "not_in_dpr" needs its own list - it's Painting Plan rows that
    never made it into `merged` at all (see merge_spools()), so there's
    nowhere else for them to live. Every other anomaly category
    (missing_from_plan, blasting_reqd_but_no_date/blasting_date_but_
    not_reqd, out_of_order_dates, dpr_painting_pdi_mismatch,
    stuck_long_open, extreme_cycle_time) is a spool with that flag set
    in its own "anomalies" list inside `spools` - re-emitting a second,
    denormalized copy of those spools here would just double the
    bundle size (this doubled it from ~8.5MB to ~12MB before this
    change) for data the frontend already has; it filters `spools` by
    flag client-side instead (website/js/painting-tables.js).
    """
    return {"not_in_dpr": not_in_dpr}
