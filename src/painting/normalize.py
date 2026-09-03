"""
src/painting/normalize.py
---------------------------------------------------------
Column-name aliases for the Painting Weekly Plan workbook's "Spool
List" sheet, plus the same to_date()/to_number() cell-cleaning
helpers every other department package (src/packing/normalize.py)
carries its own copy of - no shared state between departments.

Add a new alias here (never at the call site) if a future workbook
uses yet another header spelling.
"""

from __future__ import annotations

import datetime as dt
from typing import Any


# ---------------------------------------------------------------
# "Spool List" sheet (row-level, one row per spool) -> canonical field
# ---------------------------------------------------------------
SPOOL_COLUMN_ALIASES: dict[str, list[str]] = {
    "project_code": ["Project Code"],
    "drawing_no": ["Drawing No.", "Drawing No"],
    "spool_no": ["Spool No", "Spool No."],
    "paint_system": ["Paint System"],
    "item_category": ["Item Category Code", "Item Category"],
    "quantity": ["Quantity", "Total Qty"],
    "weight": ["Total Wt", "Total Wt."],
    "inch_dia": ["Inch Dia"],
    "surface_area": ["Surface Area Out"],
    "spool_size": ["Spool Size"],
    "qc_rfp": ["QC_RFP"],
    "painting_plan": ["Painting Plan"],
    "status": ["Status"],
    "final_remark": ["Final Remark"],
    "bay_no": ["BAY NO"],
    "no_of_coats": ["No.of Coats", "No. of Coats"],
    "internal_blasting_reqd": ["Internal Blasting Reqd (Yes/No)"],
    "internal_blasting_date": ["Internal Blasting Date"],
    "external_blasting_date": ["External Blasting Date"],
    "primer_date": ["Primer Coat Date"],
    "mid_coat_1_date": ["Mid Coat 1 Date"],
    "mid_coat_2_date": ["Mid Coat 2 Date"],
    "top_coat_date": ["Top Coat Date"],
    "pickling_date": ["Pickling Date"],
    "pdi_offer_date": ["PDI Offer Date"],
    "pdi_status_acceptance_date": ["PDI Status Acceptance Date"],
}


def _clean_header(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_header_index(headers: list[Any], aliases: dict[str, list[str]]) -> dict[str, int]:
    """
    Given the workbook's actual header row and the alias table above,
    return {canonical_field: column_index}. Matching is exact after
    whitespace-trimming (case-sensitive first, then case-insensitive
    fallback).
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


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def composite_key(project_code: Any, drawing_no: Any, spool_no: Any) -> str:
    """
    Same construction as src/utils.py -> create_composite_key(): the
    site-wide unique spool identifier. Duplicated here (rather than
    imported) to keep this package self-contained like src/packing/ -
    both must stay byte-for-byte identical to line up with the
    Composite Key already stamped onto the DPR master dataset.
    """
    def safe(v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()

    return "|".join([safe(project_code), safe(drawing_no), safe(spool_no)])
