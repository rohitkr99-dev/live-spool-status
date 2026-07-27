"""
src/packing/normalize.py
---------------------------------------------------------
The 7 source workbooks don't share one column layout - each project
team built its own tracker. This module maps every header variant
seen across the workbooks onto one canonical schema, and normalizes
the free-text 'Packing Status' / Summary 'Status' values onto one
fixed vocabulary.

Add a new alias here (never at the call site) if a future workbook
uses yet another header spelling.
"""

from __future__ import annotations

import datetime as dt
from typing import Any


# ---------------------------------------------------------------
# Spool List sheet (row-level, one row per spool) -> canonical field
# ---------------------------------------------------------------
SPOOL_COLUMN_ALIASES: dict[str, list[str]] = {
    "project_code": ["Project Code"],
    "drawing_no": ["Drawing No."],
    "spool_no": ["Final Spool no.", "Spool No", "Spool No."],
    "spool_ext_no": ["Spool Ext no."],
    "box_no": ["Box No.", "Box No", "Box no"],
    "msn_no": ["MSN no."],
    "paint_system": ["Paint System"],
    "description": ["Description"],
    "item_category": [
        "Item Category Code", "Item Category", "Item Category ", "Item ", "Item",
    ],
    "unit_no": ["UNIT NO", "Unit No.", "Unit No"],
    "total_qty": ["Total Qty"],
    "total_wt": ["Total Wt", "Total Wt2", "Total Wt."],
    "pdi_date": ["PDI Date"],
    "packing_date": ["Packing Date"],
    "packing_status": ["Packing Status"],
    "dispatched_date": ["Dispatched Date", "Dispatch Date"],
    "inch_dia": ["Inch Dia"],
    "spool_size": ["Spool Size"],
    "spool_type": ["Spool Type"],
    "surface_area": ["Surface Area Out"],
    "handover_date": ["Handover Date", "Handover Spool "],
    "remark": ["Remark", "REMARK"],
}

# ---------------------------------------------------------------
# Summary sheet (row-level, one row per Box No.) -> canonical field
# ---------------------------------------------------------------
BOX_COLUMN_ALIASES: dict[str, list[str]] = {
    "box_no": ["Box No.", "Box No", "Box no"],
    "status": ["Status"],
    "qty": ["QTY", "Qty", "QTY.", "Qty."],
    "net_wt": ["Net WT.", "Net Wt.", "Net Wt"],
    "item_category": ["Item ", "Item", "Item Category Code"],
    "unit_no": ["UNIT No.", "Unit No.", "Unit No"],
    "dispatch_date": ["Dispatch Date"],
    "container_no": ["Container No.", "Container No"],
    "seal_no": ["Seal No.", "Seal No"],
    "vpi_package_no": ["VPI package no.", "VPI Package no."],
    "packing_list_received": ["Packing List Received "],
    "remark": ["REMARK", "Remark"],
    "lbp_sbp": ["LBP/SBP"],
}


def _clean_header(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_header_index(headers: list[Any], aliases: dict[str, list[str]]) -> dict[str, int]:
    """
    Given a workbook's actual header row and the alias table above,
    return {canonical_field: column_index}. Matching is exact after
    whitespace-trimming (case-sensitive first, then case-insensitive
    fallback) since header casing is inconsistent across workbooks.
    """
    cleaned = [_clean_header(h) for h in headers]
    lowered = [h.lower() for h in cleaned]

    index: dict[str, int] = {}
    for canonical, variants in aliases.items():
        for variant in variants:
            variant_clean = variant.strip()
            if variant_clean in cleaned:
                index[canonical] = cleaned.index(variant_clean)
                break
            if variant_clean.lower() in lowered:
                index[canonical] = lowered.index(variant_clean.lower())
                break
    return index


def normalize_status(raw: Any) -> str:
    """
    Collapse every raw status spelling seen in the source files onto
    one of three canonical buckets:
      - "Pending / Under Packing"  (blank - not yet packed into a box)
      - "Packed"                   (PACKED / COMPLETE PACKED / COMPLETE PACK)
      - "Dispatched"               (DISPATCHED)
    """
    if raw is None:
        return "Pending / Under Packing"
    text = str(raw).strip()
    if text == "" or text.upper() == "N/A":
        return "Pending / Under Packing"
    upper = text.upper()
    if "DISPATCH" in upper:
        return "Dispatched"
    if "PACK" in upper:
        return "Packed"
    return text.title()


def to_date(value: Any) -> str | None:
    """Normalize an Excel cell value to an ISO 'YYYY-MM-DD' string, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value).strip()
    if not text or text.upper() in {"N/A", "#N/A"}:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def to_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text.upper() in {"N/A", "#N/A"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None
