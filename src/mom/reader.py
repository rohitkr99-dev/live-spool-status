"""
src/mom/reader.py
---------------------------------------------------------
Reads the SIOP MoM Tracker workbook and hands back plain lists of dicts:

  - read_current_cases(): the "Current Open Cases" sheet - the actions
    discussed in the last meeting, exactly as the sheet shows them.
  - read_log_rows(): the "Weekly Log" sheet - one row per update.

Sheets are found by their column headers (any position, any name), the
file by name only (any Excel format). Cached cell values are read, so no
formula is evaluated here.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

from excel_compat import glob_excel, load_workbook_any
from mom.logger import logger

CURRENT_HEADERS = ("case id", "latest remarks")
LOG_HEADERS = ("meeting date", "remarks / update", "case id", "project")


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def iso_date(value: Any) -> str | None:
    """Excel date / serial number / text date -> 'YYYY-MM-DD', else None."""
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 20000 <= value <= 80000:
            return (dt.date(1899, 12, 30) + dt.timedelta(days=int(value))).isoformat()
        return None
    text = _text(value)
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(text[:11].strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _find_sheet(wb, required: tuple[str, ...]):
    """(sheet, first data row, {label: column}, headers) for the sheet whose header row has every label."""
    for ws in wb.worksheets:
        for row_number, row in enumerate(ws.iter_rows(min_row=1, max_row=12, values_only=True), start=1):
            headers = [_norm(cell) for cell in row]
            columns = {}
            for label in required:
                column = next((i for i, h in enumerate(headers) if h.startswith(label)), None)
                if column is None:
                    break
                columns[label] = column
            else:
                return ws, row_number + 1, columns, headers
    return None


def find_workbook(folder: Path, pattern: str) -> Path | None:
    files = glob_excel(folder, pattern)
    return max(files, key=lambda path: path.stat().st_mtime) if files else None


def _rows(found, extra: dict[str, str]):
    """Yield one dict per data row below the header, keyed by label / extra key."""
    ws, first_row, columns, headers = found
    columns = dict(columns)
    for key, label in extra.items():
        columns[key] = next((i for i, h in enumerate(headers) if h.startswith(label)), None)
    for row in ws.iter_rows(min_row=first_row, values_only=True):
        yield {
            key: (row[column] if column is not None and column < len(row) else None)
            for key, column in columns.items()
        }


def read_current_cases(wb) -> list[dict[str, Any]]:
    found = _find_sheet(wb, CURRENT_HEADERS)
    if not found:
        logger.warning("No 'Current Open Cases' sheet (headers 'Case ID' + 'Latest Remarks') found.")
        return []
    extra = {
        "project": "project",
        "dept": "concerned dept",
        "status": "status",
        "last_updated": "last updated",
        "first_raised": "first raised",
        "updates": "no. of updates",
    }
    cases = []
    for row in _rows(found, extra):
        case_id = _text(row["case id"])
        if not case_id:
            continue
        cases.append({
            "case_id": case_id,
            "project": _text(row["project"]),
            "dept": _text(row["dept"]),
            "status": _text(row["status"]) or "Open",
            "remarks": _text(row["latest remarks"]),
            "last_updated": iso_date(row["last_updated"]),
            "first_raised": iso_date(row["first_raised"]),
            "updates": row["updates"] if isinstance(row["updates"], (int, float)) else None,
        })
    return cases


def read_log_rows(wb) -> list[dict[str, Any]]:
    found = _find_sheet(wb, LOG_HEADERS)
    if not found:
        logger.warning("No 'Weekly Log' sheet (headers 'Meeting Date' + 'Remarks / Update' + 'Case ID') found.")
        return []
    extra = {"follow_up": "follow-up of", "dept": "concerned dept", "status": "status"}
    rows = []
    for row in _rows(found, extra):
        remarks = _text(row["remarks / update"])
        meeting = iso_date(row["meeting date"])
        if not remarks or not meeting:
            continue
        case_id = _text(row["case id"])
        if case_id in ("", "?"):
            case_id = _text(row["follow_up"])[:6]
        rows.append({
            "date": meeting,
            "case_id": case_id,
            "project": _text(row["project"]),
            "dept": _text(row["dept"]),
            "status": _text(row["status"]) or "Open",
            "remarks": remarks,
        })
    return rows


def read_workbook(folder: Path, pattern: str):
    """(file name, current cases, log rows) from the newest matching workbook, or None."""
    path = find_workbook(folder, pattern)
    if path is None:
        return None
    logger.info(f"Reading {path.name}")
    wb = load_workbook_any(path)
    return path.name, read_current_cases(wb), read_log_rows(wb)
