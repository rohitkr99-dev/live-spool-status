"""
utils.py
---------------------------------
Common helper functions used
throughout the application.

These functions should not contain
business logic. They provide reusable
utilities for handling text, dates,
keys, and common validations.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

# The production calendar's Week 1 always starts on 30th March
# (e.g. Week 1 = 30 Mar - 5 Apr), running in 7-day blocks through
# Week 52. Used to label daily activity data for the Fit-Up / Welding
# / Painting activity charts on the dashboard.
FISCAL_WEEK_ANCHOR_MONTH = 3
FISCAL_WEEK_ANCHOR_DAY = 30
FISCAL_WEEKS_PER_CYCLE = 52


# ---------------------------------------------------------------
# Working-day calendar (weekends + company holidays), used by
# days_between() and working_day_variance() below - the single
# shared day-counting logic behind every ageing calculation on the
# site (Projects dashboard: ageing.py; Production dashboard:
# production/ageing.py). Confirmed with the project owner
# (2026-08-06) against the DEE Piping Systems (Thailand) company
# calendar: weekends are Saturday+Sunday, and holiday dates live in
# config/holidays.json (empty for now - see that file's comments).
# ---------------------------------------------------------------

# Python's date.weekday(): Monday=0 ... Sunday=6.
WEEKEND_WEEKDAYS = {5, 6}

_HOLIDAYS_CACHE: set[date] | None = None


def _load_holidays() -> set[date]:
    """
    config/holidays.json -> a set of holiday dates, cached after the
    first read (same lifetime as a single pipeline run - there's no
    scenario where this file changes mid-run). Missing file, missing
    key, or a bad date string all fail soft to "no extra holidays"
    (weekends are still always excluded regardless) rather than
    crashing the whole pipeline over a calendar typo.
    """

    global _HOLIDAYS_CACHE
    if _HOLIDAYS_CACHE is not None:
        return _HOLIDAYS_CACHE

    holidays: set[date] = set()
    filepath = Path("config") / "holidays.json"

    try:
        with filepath.open("r", encoding="utf-8") as file:
            data = json.load(file)
        for raw in data.get("dates", []):
            try:
                holidays.add(datetime.strptime(raw, "%Y-%m-%d").date())
            except (TypeError, ValueError):
                pass
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _HOLIDAYS_CACHE = holidays
    return holidays


def _working_days_delta(start_date: date, end_date: date) -> int:
    """
    Signed count of working days (excludes Saturdays, Sundays, and
    config/holidays.json dates) strictly after start_date, up to and
    including end_date - e.g. Mon->Tue = 1, Fri->Mon = 1 (weekend
    skipped), Mon->Mon = 0. Negative when end_date is before
    start_date (walks the other direction and negates), matching
    plain (end - start).days's sign convention.

    A day-by-day walk, not a vectorised one - simplest to verify
    correct against a printed calendar, and every span in this
    codebase (a spool's age, a gap between two stages) is at most a
    few hundred days, so the loop cost is not worth trading
    readability for.
    """

    if end_date == start_date:
        return 0

    forward = end_date > start_date
    lo, hi = (start_date, end_date) if forward else (end_date, start_date)
    holidays = _load_holidays()

    count = 0
    current = lo + timedelta(days=1)
    while current <= hi:
        if current.weekday() not in WEEKEND_WEEKDAYS and current not in holidays:
            count += 1
        current += timedelta(days=1)

    return count if forward else -count


def working_day_variance(
    start_date: date | None,
    end_date: date | None,
) -> int | None:
    """
    Signed working-day gap between two dates (positive = end_date is
    later, negative = end_date is earlier) - None if either date is
    missing. Use this (not days_between() below) wherever a negative
    result is meaningful, e.g. Planning Variance ("ahead of" vs.
    "behind" plan) or a stage-to-stage gap where the two dates might
    legitimately be out of the expected order in the source data.
    """

    if start_date is None or end_date is None:
        return None

    return _working_days_delta(start_date, end_date)


def add_working_days(start_date: date, working_days: int) -> date:
    """
    The calendar date reached after `working_days` working days from
    start_date (excludes Saturdays, Sundays, and config/holidays.json
    dates, same rules as _working_days_delta()/days_between() above)
    - i.e. the inverse of those functions: add_working_days(start,
    working_day_variance(start, end)) == end, when end is itself a
    working day. working_days <= 0 returns start_date unchanged
    (matching days_between()'s own "negative means zero" clamping -
    there's no such thing as a target date before Planned Start).

    Used by production/backlog.py to turn a category's target_days
    matrix entry (a WORKING-day count from Planned Start - the same
    number and the same working-day arithmetic already used for this
    dashboard's is_delayed flag, see production/ageing.py) into an
    actual calendar target DATE.
    """

    if working_days <= 0:
        return start_date

    holidays = _load_holidays()
    current = start_date
    counted = 0
    while counted < working_days:
        current += timedelta(days=1)
        if current.weekday() not in WEEKEND_WEEKDAYS and current not in holidays:
            counted += 1
    return current


def fiscal_week_info(value: date) -> dict[str, Any]:
    """
    Return the fiscal week number (1-52) and week start/end dates
    for a given calendar date, using the 30th March Week-1 anchor.

    Dates that fall in the 365th/366th day of the cycle (i.e. past
    Week 52) are folded into Week 52, per the 52-week cycle.
    """

    anchor_this_cycle = date(
        value.year, FISCAL_WEEK_ANCHOR_MONTH, FISCAL_WEEK_ANCHOR_DAY
    )

    if value >= anchor_this_cycle:
        anchor = anchor_this_cycle
    else:
        anchor = date(
            value.year - 1,
            FISCAL_WEEK_ANCHOR_MONTH,
            FISCAL_WEEK_ANCHOR_DAY,
        )

    days_since_anchor = (value - anchor).days
    week_number = min(
        (days_since_anchor // 7) + 1,
        FISCAL_WEEKS_PER_CYCLE,
    )
    week_start = anchor + timedelta(days=(week_number - 1) * 7)
    week_end = week_start + timedelta(days=6)

    return {
        "week_number": week_number,
        "week_label": f"Week {week_number}",
        "week_start": week_start,
        "week_end": week_end,
    }


def is_empty(value: Any) -> bool:
    """
    Return True if a value is considered empty.
    """

    if value is None:
        return True

    if pd.isna(value):
        return True

    if isinstance(value, str):
        return value.strip() == ""

    return False


def safe_string(value: Any) -> str:
    """
    Convert any value to a cleaned string.
    """

    if is_empty(value):
        return ""

    return str(value).strip()


def parse_date(value: Any) -> date | None:
    """
    Convert Excel values into a Python date.
    Returns None when conversion is not possible.

    Handles raw Excel serial numbers (e.g. 45947.0), which some
    Excel engines - notably pyxlsb, used for .xlsb workbooks - return
    instead of parsed datetimes.
    """

    if is_empty(value):
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if isinstance(value, (int, float)):
        try:
            return (
                pd.to_datetime(value, unit="D", origin="1899-12-30")
                .date()
            )
        except Exception:
            return None

    try:
        return pd.to_datetime(value).date()
    except Exception:
        return None


def resolve_multi_date_text_cells(
    dataframe: pd.DataFrame,
    column: str,
) -> pd.DataFrame:
    """
    Handles a data-entry pattern seen in the Rework Data workbook's
    "Prod offer" column: a re-offer typed into the SAME cell as the
    first offer, "/"-separated (e.g. "24-07-2026/07-08-2026"),
    instead of a new row. Left alone, pd.to_datetime() turns a value
    like that into NaT (unparseable), which silently drops that row
    from the PDQC override and every Quality dashboard chart that
    reads this column.

    For any cell that's text containing "/", this parses every
    piece as a date (day-first, matching the rest of the sheet) and
    keeps the LATEST one - confirmed with the project owner
    (2026-08-10): the date after the "/" is the current one, so the
    row's effective offer date is always the max of whatever's in
    the cell, however many dates got typed into it.

    Must run BEFORE convert_excel_serial_dates() on the same column
    - that function's own pd.to_datetime(errors="coerce") pass would
    otherwise turn these strings into NaT first, leaving nothing for
    this function to recover. Cells that are already a single real
    date (the overwhelming majority) pass through unchanged.
    """

    if column not in dataframe.columns:
        return dataframe

    dataframe = dataframe.copy()

    def resolve(value):
        if not isinstance(value, str) or "/" not in value:
            return value
        pieces = [p.strip() for p in value.split("/") if p.strip()]
        parsed = [
            pd.to_datetime(p, dayfirst=True, errors="coerce") for p in pieces
        ]
        parsed = [p for p in parsed if pd.notna(p)]
        return max(parsed) if parsed else pd.NaT

    dataframe[column] = dataframe[column].apply(resolve)
    return dataframe


def convert_excel_serial_dates(
    dataframe: pd.DataFrame,
    columns: list[str]
) -> pd.DataFrame:
    """
    Convert the given columns of a dataframe into proper dates.

    Excel workbooks read through the pyxlsb engine (.xlsb files)
    return raw numeric serial values for date cells instead of
    parsed datetimes. This converts those columns correctly using
    Excel's date system (1899-12-30 origin, day units).

    Columns that are already datetime-like are parsed normally.
    Columns not present in the dataframe are skipped.
    """

    dataframe = dataframe.copy()

    for column in columns:

        if column not in dataframe.columns:
            continue

        series = dataframe[column]

        if pd.api.types.is_numeric_dtype(series):
            dataframe[column] = pd.to_datetime(
                series,
                unit="D",
                origin="1899-12-30",
                errors="coerce"
            )
        else:
            dataframe[column] = pd.to_datetime(
                series,
                errors="coerce"
            )

    return dataframe


def today() -> date:
    """
    Return today's date.
    """

    return date.today()


_MONTH_NAMES = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

# Longest names first, so e.g. "september" matches whole rather than
# stopping at "sep" - matters because both are valid alternatives.
_MONTH_PATTERN = "|".join(
    sorted(_MONTH_NAMES, key=len, reverse=True)
)


def extract_file_period(
    filename: str,
    reference_date: date | None = None,
) -> tuple[int, int, int]:
    """
    Best-effort guess at which real-world period a workbook filename
    refers to, so that when more than one file of the same type is
    present in the upload folder (e.g. two DPR workbooks - a project
    can close and drop out of the newest file, but its spools should
    still be visible from an older one still sitting in Drive), the
    pipeline can tell which file is more recent - see reader.py's
    multi-file merge helpers.

    Returns a (year, month, day) tuple that sorts oldest-first.
    Tries, in order:

      1. A full numeric date in the name (DD-MM-YYYY, DD/MM/YYYY, or
         YYYY-MM-DD, with '-', '/' or '.' as the separator) - most
         reliable, since it names an exact day (e.g. the Line History
         Sheet's "27-07-2026").
      2. A month name (full or abbreviated), optionally followed by a
         2- or 4-digit year (e.g. "July'26", "July_26", "August" with
         no year at all). A month with no year defaults to the
         current year - or the previous year, if that would make the
         file look like it's from the future - since these workbooks
         are essentially always recent. A filename that spells out
         the year is always more reliable than this guess.

    Returns (0, 0, 0) - sorting before every real date, i.e. treated
    as the OLDEST - when nothing recognisable is found, so a file
    whose period can't be determined never accidentally wins a
    latest-file-wins merge over one that can be dated.
    """

    if reference_date is None:
        reference_date = today()

    name = filename.lower()

    match = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", name)
    if match:
        day, month, year = (int(group) for group in match.groups())
        if 1 <= month <= 12 and 1 <= day <= 31:
            return (year, month, day)

    match = re.search(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", name)
    if match:
        year, month, day = (int(group) for group in match.groups())
        if 1 <= month <= 12 and 1 <= day <= 31:
            return (year, month, day)

    match = re.search(
        rf"({_MONTH_PATTERN})[\s_'\-]*?(\d{{4}}|\d{{2}})?(?!\d)",
        name,
    )
    if match:
        month = _MONTH_NAMES[match.group(1)]
        year_text = match.group(2)

        if year_text:
            year = int(year_text)
            if year < 100:
                year += 2000
        else:
            year = reference_date.year
            if (year, month, 1) > (
                reference_date.year,
                reference_date.month,
                reference_date.day,
            ):
                year -= 1

        return (year, month, 1)

    return (0, 0, 0)


def days_between(
    start_date: date | None,
    end_date: date | None
) -> int:
    """
    Working days between two dates (excludes Saturdays, Sundays, and
    config/holidays.json dates - see working_day_variance() above).

    Negative values return zero - use working_day_variance() instead
    if a negative ("ahead of plan") result should be preserved.
    """

    variance = working_day_variance(start_date, end_date)

    return max(variance, 0) if variance is not None else 0


def create_composite_key(
    project_code: Any,
    drawing_no: Any,
    spool_no: Any
) -> str:
    """
    Create the unique spool identifier.
    """

    return "|".join([
        safe_string(project_code),
        safe_string(drawing_no),
        safe_string(spool_no)
    ])


def clean_text(value: Any) -> str:
    """
    Normalize text for comparisons.
    """

    return safe_string(value).upper()


def to_json_safe(value: Any) -> Any:
    """
    Convert a single value into a JSON-serialisable native Python
    value.

    Handles pandas Timestamp/NaT, numpy scalar types (int64,
    float64, bool_), and plain NaN/None - anything pandas is likely
    to hand back from a dataframe cell.
    """

    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()

    if isinstance(value, (date, datetime)):
        return value.isoformat()

    if isinstance(value, bool):
        return value

    # numpy scalar types (int64, float64, bool_) all expose .item(),
    # which converts them to their native Python equivalent.
    if hasattr(value, "item"):
        return value.item()

    return value


def dataframe_to_json_records(
    dataframe: pd.DataFrame,
    columns: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Convert a dataframe into a list of JSON-safe dictionaries.

    Parameters
    ----------
    dataframe
        Source dataframe.

    columns
        Optional subset/order of columns to include. Columns not
        present in the dataframe are skipped. If None, every column
        is included in dataframe order.
    """

    if columns is not None:
        columns = [column for column in columns if column in dataframe.columns]
        dataframe = dataframe[columns]

    records = dataframe.to_dict(orient="records")

    return [
        {key: to_json_safe(value) for key, value in record.items()}
        for record in records
    ]


MONTH_ORDER: list[str] = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

_MONTH_LOOKUP: dict[str, str] = {
    name[:3].lower(): name for name in MONTH_ORDER
} | {name.lower(): name for name in MONTH_ORDER} | {"sept": "September"}


def normalize_month_name(value: Any) -> str | None:
    """
    Map a free-text month value ("Jan", "jan", "January", "Sept",
    with stray whitespace) to its canonical full name ("January").
    Returns None for anything unrecognized (e.g. a "Total" footer
    row sitting inside a data range) so callers can drop those rows
    rather than silently mis-bucket them.
    """

    if pd.isna(value):
        return None
    key = str(value).strip().lower()
    return _MONTH_LOOKUP.get(key)
