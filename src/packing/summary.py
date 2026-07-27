"""
src/packing/summary.py
---------------------------------------------------------
Turns the normalized spool rows + box rows from reader.py into every
aggregate the dashboard displays. This is the only place any
counting/summing happens - website/js/packing-*.js only ever renders
numbers that already exist in the JSON this module produces.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any


def _round2(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _week_label(iso_date: str) -> str:
    d = dt.date.fromisoformat(iso_date)
    year, week, _ = d.isocalendar()
    monday = d - dt.timedelta(days=d.weekday())
    return f"{year}-W{week:02d} (wk of {monday.isoformat()})"


def _month_label(iso_date: str) -> str:
    d = dt.date.fromisoformat(iso_date)
    return f"{d.year}-{d.month:02d}"


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
    qty_by_status = defaultdict(float)
    wt_by_status = defaultdict(float)
    for s in spools:
        spools_by_status[s["packing_status"]] += 1
        qty_by_status[s["packing_status"]] += s["total_qty"] or 0
        wt_by_status[s["packing_status"]] += s["total_wt"] or 0

    box_nos_all = {(b["project_code"], b["box_no"]) for b in boxes if b["box_no"]}
    box_nos_packed = {
        (b["project_code"], b["box_no"]) for b in boxes
        if b["box_no"] and b["status"] in ("Packed", "Dispatched")
    }
    box_nos_dispatched = {
        (b["project_code"], b["box_no"]) for b in boxes if b["box_no"] and b["status"] == "Dispatched"
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

    return {
        "total_projects": len({s["project_code"] for s in spools} | {b["project_code"] for b in boxes if b["project_code"]}),
        "total_spools": total_spools,
        "total_qty_pieces": _round2(total_qty),
        "total_weight_kg": _round2(total_wt),

        "spools_pending": spools_by_status.get("Pending / Under Packing", 0),
        "spools_packed": spools_by_status.get("Packed", 0),
        "spools_dispatched": spools_by_status.get("Dispatched", 0),

        "weight_pending_kg": _round2(wt_by_status.get("Pending / Under Packing", 0)),
        "weight_packed_kg": _round2(wt_by_status.get("Packed", 0)),
        "weight_dispatched_kg": _round2(wt_by_status.get("Dispatched", 0)),

        "total_boxes": len(box_nos_all | box_nos_from_spools),
        "boxes_packed": len(box_nos_packed),
        "boxes_dispatched": len(box_nos_dispatched),
        "boxes_pending": len(box_nos_pending),

        "total_shipments": len(containers),
        "avg_weight_per_box_kg": _round2((total_wt / len(box_nos_all)) if box_nos_all else None),
        "avg_weight_per_shipment_kg": _round2((total_shipment_weight / len(containers)) if containers else None),
        "avg_boxes_per_shipment": _round2((len(box_nos_dispatched) / len(containers)) if containers else None),
    }


def build_status_breakdown(spools: list[dict]) -> list[dict[str, Any]]:
    agg: dict[str, dict[str, float]] = defaultdict(lambda: {"spool_count": 0, "qty": 0.0, "weight_kg": 0.0})
    for s in spools:
        bucket = agg[s["packing_status"]]
        bucket["spool_count"] += 1
        bucket["qty"] += s["total_qty"] or 0
        bucket["weight_kg"] += s["total_wt"] or 0

    order = ["Pending / Under Packing", "Packed", "Dispatched"]
    result = []
    for status in order:
        if status in agg:
            b = agg.pop(status)
            result.append({"status": status, "spool_count": b["spool_count"], "qty": _round2(b["qty"]), "weight_kg": _round2(b["weight_kg"])})
    for status, b in agg.items():  # any unexpected leftover status
        result.append({"status": status, "spool_count": b["spool_count"], "qty": _round2(b["qty"]), "weight_kg": _round2(b["weight_kg"])})
    return result


def build_project_summary(spools: list[dict], boxes: list[dict], project_names: dict[str, str]) -> list[dict[str, Any]]:
    codes = sorted({s["project_code"] for s in spools} | {b["project_code"] for b in boxes if b["project_code"]})
    result = []
    for code in codes:
        proj_spools = [s for s in spools if s["project_code"] == code]
        proj_boxes = [b for b in boxes if b["project_code"] == code]

        box_all = {b["box_no"] for b in proj_boxes if b["box_no"]} | {s["box_no"] for s in proj_spools if s["box_no"]}
        box_packed = {b["box_no"] for b in proj_boxes if b["box_no"] and b["status"] in ("Packed", "Dispatched")}
        box_dispatched = {b["box_no"] for b in proj_boxes if b["box_no"] and b["status"] == "Dispatched"}
        containers = {b["container_no"] for b in proj_boxes if b["container_no"]}

        dispatch_dates = [b["dispatch_date"] for b in proj_boxes if b["dispatch_date"]] + \
                          [s["dispatched_date"] for s in proj_spools if s["dispatched_date"]]

        total_wt = sum(s["total_wt"] or 0 for s in proj_spools)
        dispatched_wt = sum(s["total_wt"] or 0 for s in proj_spools if s["packing_status"] == "Dispatched")

        pending = sum(1 for s in proj_spools if s["packing_status"] == "Pending / Under Packing")
        packed = sum(1 for s in proj_spools if s["packing_status"] == "Packed")
        dispatched = sum(1 for s in proj_spools if s["packing_status"] == "Dispatched")

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
            "total_qty_pieces": _round2(sum(s["total_qty"] or 0 for s in proj_spools)),
            "total_weight_kg": _round2(total_wt),
            "weight_dispatched_kg": _round2(dispatched_wt),
            "last_dispatch_date": max(dispatch_dates) if dispatch_dates else None,
        })
    return sorted(result, key=lambda r: r["project_code"])


def _date_series(records: list[dict], date_field: str, qty_field: str, wt_field: str) -> dict[str, list[dict]]:
    daily: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight_kg": 0.0})
    for r in records:
        date_value = r.get(date_field)
        if not date_value:
            continue
        bucket = daily[date_value]
        bucket["count"] += 1
        bucket["qty"] += r.get(qty_field) or 0
        bucket["weight_kg"] += r.get(wt_field) or 0

    daily_rows = [
        {"date": date, "count": v["count"], "qty": _round2(v["qty"]), "weight_kg": _round2(v["weight_kg"])}
        for date, v in sorted(daily.items())
    ]

    weekly: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight_kg": 0.0})
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"count": 0, "qty": 0.0, "weight_kg": 0.0})
    for row in daily_rows:
        wk = _week_label(row["date"])
        mo = _month_label(row["date"])
        for target, key in ((weekly, wk), (monthly, mo)):
            b = target[key]
            b["count"] += row["count"]
            b["qty"] += row["qty"] or 0
            b["weight_kg"] += row["weight_kg"] or 0

    weekly_rows = [
        {"period": k, "count": v["count"], "qty": _round2(v["qty"]), "weight_kg": _round2(v["weight_kg"])}
        for k, v in sorted(weekly.items())
    ]
    monthly_rows = [
        {"period": k, "count": v["count"], "qty": _round2(v["qty"]), "weight_kg": _round2(v["weight_kg"])}
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
            "weight_kg": 0.0,
        })
        entry["box_count"] += 1
        entry["qty_total"] += b.get("qty") or 0
        entry["weight_kg"] += b.get("net_wt") or 0

    result = []
    for entry in agg.values():
        entry["qty_total"] = _round2(entry["qty_total"])
        entry["weight_kg"] = _round2(entry["weight_kg"])
        entry["project_name"] = project_names.get(entry["project_code"])
        result.append(entry)
    return sorted(result, key=lambda r: (r["dispatch_date"] or "", r["container_no"]))
