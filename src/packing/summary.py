"""
src/packing/summary.py
---------------------------------------------------------
Turns the normalized spool rows + box rows from reader.py into every
aggregate the dashboard displays. This is the only place any
counting/summing happens - website/js/packing-*.js only ever renders
numbers that already exist in the JSON this module produces.

Units: every weight field in the output bundle is in MT (metric
tons), rounded to 2 decimals, keyed with a `_mt` suffix (e.g.
`total_weight_mt`). Source workbooks record weight in kg - the
conversion (divide by 1000) happens once, right where each field is
emitted, using unrounded kg internally for every sum so rounding
never compounds across thousands of rows. Every count/quantity field
(spools, boxes, pieces) stays a whole number - see `_int()`.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any

STATUS_BALANCE = "Balance in Project"
STATUS_PACKED = "Packed"
STATUS_DISPATCHED = "Dispatched"

# Week 1 of the current fiscal year starts Sunday 30-Mar-2025 (hardcoded
# for FY2025-26 per project decision - not auto-recalculated each year).
# Trend charts (packing_trend / dispatch_trend) only ever plot dates on
# or after this anchor, so stray/erroneous pre-FY dates in the source
# data don't clutter the Day/Week/Month views. Weeks are bucketed in
# fixed 7-day blocks counted forward from this anchor (a "fiscal week"),
# not calendar ISO weeks.
FISCAL_YEAR_START = dt.date(2025, 3, 30)


def _round2(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _int(value: float | None) -> int | None:
    """Round a summed quantity/count field to a whole number."""
    return None if value is None else int(round(value))


def _mt(kg: float | None) -> float | None:
    """kg -> metric tons, rounded to 2 decimals. The only place unit conversion happens."""
    return None if kg is None else round(kg / 1000, 2)


def _fiscal_week_start(d: dt.date) -> dt.date:
    offset_days = (d - FISCAL_YEAR_START).days
    week_index = offset_days // 7
    return FISCAL_YEAR_START + dt.timedelta(days=week_index * 7)


def _week_label(iso_date: str) -> str:
    """Fiscal week bucket key = ISO date of that week's start (see _fiscal_week_start)."""
    d = dt.date.fromisoformat(iso_date)
    return _fiscal_week_start(d).isoformat()


def _month_label(iso_date: str) -> str:
    d = dt.date.fromisoformat(iso_date)
    return f"{d.year}-{d.month:02d}"


def _in_fiscal_year(iso_date: str) -> bool:
    try:
        return dt.date.fromisoformat(iso_date) >= FISCAL_YEAR_START
    except ValueError:
        return False


def build_project_names(workbook_results: list[dict[str, Any]]) -> dict[str, str]:
    """Project Code -> best-known Project Name, preferring names parsed from Summary sheet titles."""
    names: dict[str, str] = {}
    for result in workbook_results:
        name = result.get("project_name")
        if not name:
            continue
        for spool in result["spools"]:
            code = spool["project_code"]
            if code and code not in names:
                names[code] = name
        for box in result["boxes"]:
            code = box.get("project_code")
            if code and code not in names:
                names[code] = name
    return names


def build_kpi_summary(spools: list[dict], boxes: list[dict]) -> dict[str, Any]:
    total_spools = len(spools)
    total_qty = sum(s["total_qty"] or 0 for s in spools)
    total_wt = sum(s["total_wt"] or 0 for s in spools)

    spools_by_status = defaultdict(int)
    wt_by_status = defaultdict(float)
    for s in spools:
        spools_by_status[s["packing_status"]] += 1
        wt_by_status[s["packing_status"]] += s["total_wt"] or 0

    box_nos_all = {(b["project_code"], b["box_no"]) for b in boxes if b["box_no"]}
    box_nos_packed = {
        (b["project_code"], b["box_no"]) for b in boxes
        if b["box_no"] and b["status"] in (STATUS_PACKED, STATUS_DISPATCHED)
    }
    box_nos_dispatched = {
        (b["project_code"], b["box_no"]) for b in boxes if b["box_no"] and b["status"] == STATUS_DISPATCHED
    }
    # Boxes referenced by spools but with no matching Summary row yet
    # (i.e. assigned to a box yet still shown as pending at spool level)
    box_nos_from_spools = {
        (s["project_code"], s["box_no"]) for s in spools if s["box_no"]
    }
    box_nos_pending = (box_nos_all | box_nos_from_spools) - box_nos_packed

    containers = {b["container_no"] for b in boxes if b["container_no"]}
    total_shipment_weight = sum(
        b["net_wt"] or 0 for b in boxes if b["container_no"]
    )

    # Actual weight of each real, packed box (Net Wt. from the Summary
    # sheet) - NOT total spool weight divided by box count, which would
    # wrongly pull in the weight of spools not yet packed into any box
    # (see the bug this replaced: total_wt included every spool's
    # weight, including "Balance in Project" ones with no box_no at
    # all, while the denominator only counted actual boxes).
    completed_box_weights = [
        b["net_wt"] for b in boxes
        if b["box_no"] and b["net_wt"] is not None and b["status"] in (STATUS_PACKED, STATUS_DISPATCHED)
    ]

    return {
        "total_projects": len({s["project_code"] for s in spools} | {b["project_code"] for b in boxes if b["project_code"]}),
        "total_spools": total_spools,
        "total_qty_pieces": _int(total_qty),
        "total_weight_mt": _mt(total_wt),

        "spools_pending": spools_by_status.get(STATUS_BALANCE, 0),
        "spools_packed": spools_by_status.get(STATUS_PACKED, 0),
        "spools_dispatched": spools_by_status.get(STATUS_DISPATCHED, 0),

        "weight_pending_mt": _mt(wt_by_status.get(STATUS_BALANCE, 0)),
        "weight_packed_mt": _mt(wt_by_status.get(STATUS_PACKED, 0)),
        "weight_dispatched_mt": _mt(wt_by_status.get(STATUS_DISPATCHED, 0)),

        "total_boxes": len(box_nos_all | box_nos_from_spools),
        "boxes_packed": len(box_nos_packed),
        "boxes_dispatched": len(box_nos_dispatched),
        "boxes_pending": len(box_nos_pending),

        "total_shipments": len(containers),
        "avg_weight_per_box_mt": _mt((sum(completed_box_weights) / len(completed_box_weights)) if completed_box_weights else None),
        "avg_weight_per_shipment_mt": _mt((total_shipment_weight / len(containers)) if containers else None),
        "avg_boxes_per_shipment": _round2((len(box_nos_dispatched) / len(containers)) if containers else None),
    }


def build_status_breakdown(spools: list[dict]) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, float]] = defaultdict(lambda: {"spool_count": 0, "qty": 0.0, "weight": 0.0})
    for s in spools:
        bucket = agg[s["packing_status"]]
        bucket["spool_count"] += 1
        bucket["qty"] += s["total_qty"] or 0
        bucket["weight"] += s["total_wt"] or 0

    order = [STATUS_BALANCE, STATUS_PACKED, STATUS_DISPATCHED]
    result = []
    for status in order:
        if status in agg:
            b = agg.pop(status)
            result.append({"status": status, "spool_count": _int(b["spool_count"]), "qty": _int(b["qty"]), "weight_mt": _mt(b["weight"])})
    for status, b in agg.items():  # any unexpected leftover status
        result.append({"status": status, "spool_count": _int(b["spool_count"]), "qty": _int(b["qty"]), "weight_mt": _mt(b["weight"])})
    return result


def build_project_summary(spools: list[dict], boxes: list[dict], project_names: dict[str, str]) -> list[dict[str, Any]]:
    codes = sorted({s["project_code"] for s in spools} | {b["project_code"] for b in boxes if b["project_code"]})
    result = []
    for code in codes:
        proj_spools = [s for s in spools if s["project_code"] == code]
        proj_boxes = [b for b in boxes if b["project_code"] == code]

        box_all = {b["box_no"] for b in proj_boxes if b["box_no"]} | {s["box_no"] for s in proj_spools if s["box_no"]}
        box_packed = {b["box_no"] for b in proj_boxes if b["box_no"] and b["status"] in (STATUS_PACKED, STATUS_DISPATCHED)}
        box_dispatched = {b["box_no"] for b in proj_boxes if b["box_no"] and b["status"] == STATUS_DISPATCHED}
        containers = {b["container_no"] for b in proj_boxes if b["container_no"]}

        dispatch_dates = [b["dispatch_date"] for b in proj_boxes if b["dispatch_date"]] + \
                          [s["dispatched_date"] for s in proj_spools if s["dispatched_date"]]

        total_wt = sum(s["total_wt"] or 0 for s in proj_spools)
        dispatched_wt = sum(s["total_wt"] or 0 for s in proj_spools if s["packing_status"] == STATUS_DISPATCHED)

        pending = sum(1 for s in proj_spools if s["packing_status"] == STATUS_BALANCE)
        packed = sum(1 for s in proj_spools if s["packing_status"] == STATUS_PACKED)
        dispatched = sum(1 for s in proj_spools if s["packing_status"] == STATUS_DISPATCHED)

        result.append({
            "project_code": code,
            "project_name": project_names.get(code),
            "total_spools": len(proj_spools),
            "spools_pending": pending,
            "spools_packed": packed,
            "spools_dispatched": dispatched,
            "pct_dispatched": _round2((dispatched / len(proj_spools) * 100) if proj_spools else 0),
            "total_boxes": len(box_all),
            "boxes_packed": len(box_packed),
            "boxes_dispatched": len(box_dispatched),
            "total_shipments": len(containers),
            "total_qty_pieces": _int(sum(s["total_qty"] or 0 for s in proj_spools)),
            "total_weight_mt": _mt(total_wt),
            "weight_dispatched_mt": _mt(dispatched_wt),
            "last_dispatch_date": max(dispatch_dates) if dispatch_dates else None,
        })
    return sorted(result, key=lambda r: r["project_code"])


def _date_series(records: list[dict], date_field: str, qty_field: str, wt_field: str) -> dict[str, list[dict]]:
    daily: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight": 0.0})
    for r in records:
        date_value = r.get(date_field)
        if not date_value or not _in_fiscal_year(date_value):
            continue
        bucket = daily[date_value]
        bucket["count"] += 1
        bucket["qty"] += r.get(qty_field) or 0
        bucket["weight"] += r.get(wt_field) or 0

    daily_rows = [
        {"date": date, "count": v["count"], "qty": _int(v["qty"]), "weight_mt": _mt(v["weight"])}
        for date, v in sorted(daily.items())
    ]

    weekly: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight": 0.0})
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight": 0.0})
    for date, v in sorted(daily.items()):
        wk = _week_label(date)
        mo = _month_label(date)
        for target, key in ((weekly, wk), (monthly, mo)):
            b = target[key]
            b["count"] += v["count"]
            b["qty"] += v["qty"] or 0
            b["weight"] += v["weight"] or 0

    weekly_rows = [
        {"period": k, "count": v["count"], "qty": _int(v["qty"]), "weight_mt": _mt(v["weight"])}
        for k, v in sorted(weekly.items())
    ]
    monthly_rows = [
        {"period": k, "count": v["count"], "qty": _int(v["qty"]), "weight_mt": _mt(v["weight"])}
        for k, v in sorted(monthly.items())
    ]
    return {"daily": daily_rows, "weekly": weekly_rows, "monthly": monthly_rows}


def build_packing_trend(spools: list[dict]) -> dict[str, list[dict]]:
    return _date_series(spools, "packing_date", "total_qty", "total_wt")


def build_dispatch_trend(spools: list[dict]) -> dict[str, list[dict]]:
    return _date_series(spools, "dispatched_date", "total_qty", "total_wt")


def build_shipments(boxes: list[dict], project_names: dict[str, str]) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = {}
    for b in boxes:
        container = b.get("container_no")
        if not container:
            continue
        entry = agg.setdefault(container, {
            "container_no": container,
            "seal_no": b.get("seal_no"),
            "project_code": b.get("project_code"),
            "dispatch_date": b.get("dispatch_date"),
            "box_count": 0,
            "qty_total": 0.0,
            "weight": 0.0,
        })
        entry["box_count"] += 1
        entry["qty_total"] += b.get("qty") or 0
        entry["weight"] += b.get("net_wt") or 0

    result = []
    for entry in agg.values():
        entry["qty_total"] = _int(entry["qty_total"])
        entry["weight_mt"] = _mt(entry.pop("weight"))
        entry["project_name"] = project_names.get(entry["project_code"])
        result.append(entry)
    return sorted(result, key=lambda r: (r["dispatch_date"] or "", r["container_no"]))
