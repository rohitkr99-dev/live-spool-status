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
from typing import Any, Optional

import numpy as np
import pandas as pd
from pandas.errors import OutOfBoundsDatetime

from logger import logger

# The production calendar's fiscal Week 1 always starts on a Monday,
# anchored to 1st April each year (given by the person, 2026-08-27,
# after correcting an earlier wrong assumption that it was always
# 30th March): if 1st April falls on Monday/Tuesday/Wednesday, Week 1
# starts on the Monday of THAT week (on or before 1st April); if it
# falls on Thursday/Friday/Saturday/Sunday, that week stays the tail
# end of the PREVIOUS fiscal year (Week 52/53) and Week 1 starts the
# following Monday instead. His own two examples, both confirmed
# correct against this rule: 1 Apr 2026 is a Wednesday -> Week 1 =
# 30 Mar 2026; 1 Apr 2027 is a Thursday -> Week 1 = 5 Apr 2027 (the
# Monday after, not the one before). See _fiscal_week1_start() below
# - this replaces a fixed "always 30th March" constant that would
# have silently been wrong starting FY28.
FISCAL_WEEKS_PER_CYCLE = 52


def _fiscal_week1_start(year: int) -> date:
    """
    Given by the person, 2026-08-27 - the exact rule behind which
    Monday starts fiscal Week 1 for a given year, per his own two
    worked examples (see the module-level comment above this
    function). `year` is the calendar year 1st April falls in.
    """

    april_first = date(year, 4, 1)
    days_after_monday = april_first.weekday()  # Monday=0 ... Sunday=6

    if days_after_monday <= 2:  # Mon/Tue/Wed - use that week's Monday
        return april_first - timedelta(days=days_after_monday)

    # Thu/Fri/Sat/Sun - 1st April stays part of the PREVIOUS fiscal
    # year; Week 1 starts the following Monday instead.
    return april_first - timedelta(days=days_after_monday) + timedelta(days=7)


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
    for a given calendar date, using the person's own Week-1 rule
    (_fiscal_week1_start() above - anchored to which weekday 1st
    April falls on, NOT a fixed calendar date, so this correctly
    handles the anchor moving year to year - e.g. 30th March in
    FY27, 5th April in FY28).

    Dates that fall in the 365th/366th day of the cycle (i.e. past
    Week 52) are folded into Week 52, per the 52-week cycle.
    """

    anchor_this_cycle = _fiscal_week1_start(value.year)

    if value >= anchor_this_cycle:
        anchor = anchor_this_cycle
    else:
        anchor = _fiscal_week1_start(value.year - 1)

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


def week_number_to_start_date(week_number: int, reference: Optional[date] = None) -> date:
    """
    Inverse of fiscal_week_info(): given a fiscal week number (1-52)
    and a reference date to pick which fiscal cycle it belongs to
    (defaults to today - see below), returns that week's start date
    (same Week-1 rule as fiscal_week_info() - see
    _fiscal_week1_start() - same cycle-selection rule).

    The reference date matters because "Week 12" alone is ambiguous
    across fiscal cycles (each Week-1 Monday starts a new cycle) -
    this resolves it to whichever cycle the reference date falls in,
    which is correct for the common case of converting a CURRENT
    planning workbook's week numbers (both should belong to the
    same, current cycle - see merge.py ->
    apply_material_hold_ageing_reduction(), 2026-08-26, given by the
    person: comparing his workbook's "Week Planned" against "Initial
    Week Planned" to measure how many weeks a spool's schedule
    slipped due to Hold/MNA).
    """

    if reference is None:
        reference = today()

    anchor_this_cycle = _fiscal_week1_start(reference.year)
    if reference >= anchor_this_cycle:
        anchor = anchor_this_cycle
    else:
        anchor = _fiscal_week1_start(reference.year - 1)

    return anchor + timedelta(days=(week_number - 1) * 7)


def material_hold_working_days_lost(
    initial_week_raw: Any,
    current_week_raw: Any,
    reference: Optional[date] = None,
) -> Optional[int]:
    """
    Given the Weekly Production Planning workbook's "Initial Week
    Planned" and "Week Planned" text values (e.g. "Week 10",
    "Week 12"), returns the working-day gap between them, floored at
    0 - or None if either is missing/unparseable.

    Given by the person, 2026-08-26, in his own words: "I keep both
    the columns same when adding the spool for the first time...
    Now if a spool comes under MNA/Hold category and it gets cleared
    after some days/weeks, I change only column BT [Week Planned]
    while keeping column CB [Initial Week Planned] unchanged... if
    initial week is Week 10 and changed week is Week 12, then there
    is a gap of 14 days (or 10 working days). You can reduce the
    ageing days using this method. In case if subtraction results in
    negative, make it zero."

    Uses week_number_to_start_date() (same fiscal week system
    already used everywhere in this repo) and working_day_variance()
    (same holiday calendar as every other ageing figure) - not a
    flat 5-days-per-week estimate, so the result can differ slightly
    from a hand-calculated example if a company holiday
    (config/holidays.json) falls inside that date range.

    Single shared implementation for both dashboards - called from
    src/merge.py (Projects, via MergeEngine.
    apply_material_hold_ageing_reduction()) and
    src/production/ageing.py (Production, via build_spool_records())
    - so a "Week 10 -> Week 12" gap means the same number of days
    lost on both.
    """

    def _week_number(raw) -> Optional[int]:
        if is_empty(raw):
            return None
        match = re.search(r"\d+", str(raw))
        return int(match.group()) if match else None

    initial = _week_number(initial_week_raw)
    current = _week_number(current_week_raw)
    if initial is None or current is None:
        return None

    resolved_reference = reference if reference is not None else today()
    initial_start = week_number_to_start_date(initial, resolved_reference)
    current_start = week_number_to_start_date(current, resolved_reference)
    return max(working_day_variance(initial_start, current_start) or 0, 0)


MATERIAL_GRADE_ALIASES = {"F11": "P11"}


def normalize_material_grade(raw: Any) -> Any:
    """
    Thumb rule (given by the person, 2026-09-04): "Consider F11=P11
    wherever it shows." F11 and P11 are the same alloy steel grade
    (1.25Cr-0.5Mo) - the DPR's own "Item Category Code" column (which
    every department's "Material" field ultimately comes from - see
    docs/decision_log.md, and column_mapping.json's
    "Item Category Code" -> "Material" rename) just spells it
    differently depending on product form (Forging vs Pipe). Applied
    once here, in reader.py -> ExcelReader.read_fabrication() - the
    single shared read every department's own reader calls (Projects,
    Production, Quality, Painting, Packing all go through this same
    DataFrame) - so every downstream chart, table, and filter already
    sees the merged value everywhere, with nothing to keep in sync
    department by department.

    NOT the same thing as production/classify.py's own AS
    (Alloy Steel) bucket, which already groups F11/P11/P22/P91
    together for a different purpose (its own SB/AS/CS-SS 3-way
    classification) - that bucket is unaffected and unchanged by this;
    P22 and P91 stay their own distinct values everywhere else.

    Passes non-string/empty values through unchanged (pandas NaN,
    None) - only ever touches the exact "F11" text, case-insensitive,
    already-trimmed-or-not either way.
    """
    if not isinstance(raw, str):
        return raw
    text = raw.strip()
    return MATERIAL_GRADE_ALIASES.get(text.upper(), raw)


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

    A single corrupted/out-of-range numeric cell (not a real date,
    but something a source file happened to have in a date column)
    can make pandas' normal vectorized conversion raise instead of
    the graceful NaT errors="coerce" is meant to produce - confirmed
    in production (2026-09-02): a DPR workbook's Fabrication date
    column raised FloatingPointError deep inside numpy's internal
    unit-conversion arithmetic, crashing the whole Production
    dashboard pipeline for that run (continue-on-error: true kept it
    from blocking anything else, but Production itself didn't
    refresh). errors="coerce" only catches ordinary per-value parsing
    failures - it can't catch an overflow trap raised from inside
    numpy's C code, which is also platform-dependent (didn't
    reproduce locally on Windows with the same pinned numpy/pandas
    versions that crashed on the Linux GitHub Actions runner). When
    the fast vectorized path raises, this falls back to converting
    the column one value at a time (each wrapped in its own error
    handling and a suppressed numpy error state), so only the
    genuinely bad cell(s) become blank instead of the whole run
    failing.
    """

    dataframe = dataframe.copy()

    for column in columns:

        if column not in dataframe.columns:
            continue

        series = dataframe[column]

        if pd.api.types.is_numeric_dtype(series):
            try:
                dataframe[column] = pd.to_datetime(
                    series,
                    unit="D",
                    origin="1899-12-30",
                    errors="coerce"
                )
            except (OverflowError, FloatingPointError, ValueError) as error:
                logger.warning(
                    f"convert_excel_serial_dates: column {column!r} "
                    f"has a value the fast conversion can't handle "
                    f"({error}) - falling back to a slower, per-value "
                    "conversion so only the actual bad cell(s) become "
                    "blank instead of the whole run failing."
                )
                dataframe[column] = series.apply(_safe_serial_to_datetime)
        else:
            dataframe[column] = pd.to_datetime(
                series,
                errors="coerce"
            )

    return dataframe


def _safe_serial_to_datetime(value):
    """
    Converts a single Excel date-serial value to a Timestamp, never
    raising - used by convert_excel_serial_dates()'s fallback path
    once the fast vectorized conversion has already hit an
    unrecoverable error on that column. np.errstate suppresses the
    same kind of overflow trap that broke the vectorized path, so a
    genuinely bad value here becomes NaT instead of crashing again.
    """

    if pd.isna(value):
        return pd.NaT
    try:
        with np.errstate(all="ignore"):
            return pd.to_datetime(value, unit="D", origin="1899-12-30")
    except (OverflowError, FloatingPointError, ValueError, OutOfBoundsDatetime):
        return pd.NaT


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
