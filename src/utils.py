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

from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd

# The production calendar's Week 1 always starts on 30th March
# (e.g. Week 1 = 30 Mar - 5 Apr), running in 7-day blocks through
# Week 52. Used to label daily activity data for the Fit-Up / Welding
# / Painting activity charts on the dashboard.
FISCAL_WEEK_ANCHOR_MONTH = 3
FISCAL_WEEK_ANCHOR_DAY = 30
FISCAL_WEEKS_PER_CYCLE = 52


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


def days_between(
    start_date: date | None,
    end_date: date | None
) -> int:
    """
    Calculate days between two dates.

    Negative values return zero.
    """

    if start_date is None or end_date is None:
        return 0

    days = (end_date - start_date).days

    return max(days, 0)


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
