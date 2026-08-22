"""
src/hold_ledger.py
---------------------------------------------------------
Replaces the single-anchor Hold handling that used to live inside
src/rework_pdqc_rule.py (ABSOLUTE RULE #2, 2026-08-19 - see
docs/absolute-rules.md's history section). That version faked PDQC/
RFP to a near-immediate anchor date so Hold time wouldn't count
against Production/QC's ageing. This module instead keeps PDQC/RFP
as their real, on-the-ground dates and records exactly how many
WORKING days each spool actually spent on Hold, so ageing engines
can subtract that many days from whatever window (Total Age, a
single stage's age, the current-vs-target-quota comparison) the Hold
period overlaps - including a Hold that happens AFTER RFP, during
Under Painting, which the old anchor-based rule had no way to handle
at all (given by the person, 2026-08-21: "there might be a
possibility of spool being Hold even after RFP... we need to remove
those days from Under Painting as well").

Data model - state/hold_tracking.json (same filename/commit path as
before, see .github/workflows/drive-sync.yml - only the SCHEMA
inside it changed):

    {
      "<composite key>": {
        "hold_periods": [
          {"hold_start": "2026-08-01", "hold_removed": "2026-08-10"},
          {"hold_start": "2026-09-03", "hold_removed": null}
        ]
      }
    }

A spool can have any number of periods - re-entering Hold after a
previous resolution is now just another entry in the list, not an
ambiguous case needing manual review (that was only ambiguous under
the old single-anchor design, which could only remember ONE hold
episode). `hold_removed: null` means the period is still open (the
spool is on Hold right now). Every closed period's "working days
held" is DERIVED on demand from hold_start/hold_removed via
utils.working_day_variance() (same weekend/holiday calendar as every
other ageing calculation in this repo) rather than stored - so a
correction to config/holidays.json retroactively applies correctly
if this file is ever regenerated from scratch.

The only genuinely ambiguous case left: a spool with an OPEN Hold
period whose latest Rework Data status flips straight to "Rework"
without ever passing through "Accept". That's flagged (see
update_hold_periods()'s returned `ambiguous` flag) for manual review
on the Exceptions tab, same spirit as the old REWORK_HOLD_EXCEPTION
column, just a narrower trigger now.

Migration: an old-format entry (bare `hold_offer_date` /
`still_on_hold` keys, no `hold_periods` list) is converted the first
time it's touched - see _migrate_entry(). A previously-RESOLVED
legacy entry has no recorded removal date (the old code never stored
one), so it migrates to a zero-duration closed period rather than
guessing - meaning Hold time that had already been resolved before
this feature shipped won't retroactively earn a day-credit. A
previously-OPEN legacy entry migrates cleanly (its real start date
IS known), so still-open Holds carry over with no loss of accuracy
going forward.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from logger import logger
from utils import working_day_variance, today

DEFAULT_HOLD_LEDGER_PATH = Path("state/hold_tracking.json")


def _parse_date(value) -> Optional[date]:
    """
    Normalizes any of the date-ish things this module might be
    handed (a plain date, a datetime, a pandas Timestamp, an ISO
    string, pandas NaT/NaN) down to a plain datetime.date - so every
    date stored in or returned from this module compares safely
    against plain date objects elsewhere (a datetime/Timestamp
    compared directly against a date raises TypeError in Python,
    which pd.Timestamp's date-subclass status would otherwise risk).
    """

    if value is None:
        return None
    try:
        if value != value:  # NaN / pandas NaT safety, no pandas import needed
            return None
    except Exception:
        pass
    date_method = getattr(value, "date", None)
    if callable(date_method):
        try:
            return date_method()
        except Exception:
            pass
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _migrate_entry(entry: dict) -> list[dict]:
    """
    Returns a list of {"hold_start": date, "hold_removed": date|None}
    period dicts (parsed, not serialized) for one spool's stored
    entry, converting the old single-anchor format if that's what's
    found. See module docstring for the migration rules.
    """

    if "hold_periods" in entry:
        periods = []
        for period in entry["hold_periods"]:
            periods.append({
                "hold_start": _parse_date(period.get("hold_start")),
                "hold_removed": _parse_date(period.get("hold_removed")),
            })
        return periods

    # Legacy single-anchor format.
    anchor = _parse_date(entry.get("hold_offer_date"))
    if anchor is None:
        return []

    still_on_hold = bool(entry.get("still_on_hold", False))
    if still_on_hold:
        return [{"hold_start": anchor, "hold_removed": None}]

    logger.info(
        "hold_ledger: migrating a legacy resolved Hold entry with no "
        "recorded removal date - recorded as a zero-duration period "
        "(pre-migration Hold time isn't retroactively credited)."
    )
    return [{"hold_start": anchor, "hold_removed": anchor}]


def _serialize_periods(periods: list[dict]) -> dict:
    return {
        "hold_periods": [
            {
                "hold_start": period["hold_start"].isoformat(),
                "hold_removed": (
                    period["hold_removed"].isoformat()
                    if period["hold_removed"] is not None else None
                ),
            }
            for period in periods
        ]
    }


def load_ledger(path: Path | str = DEFAULT_HOLD_LEDGER_PATH) -> dict:
    path = Path(path)
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError) as error:
        logger.warning(
            f"Could not read Hold ledger at {path} ({error}) - "
            "starting fresh this run. Every spool's Hold history "
            "will need to be re-detected from the current Rework "
            "workbook, if it's still there."
        )
        return {}


def save_ledger(store: dict, path: Path | str = DEFAULT_HOLD_LEDGER_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(store, file, indent=2, sort_keys=True)


def periods_for(store: dict, composite_key: str) -> list[dict]:
    """Parsed (date objects, not strings) list of periods for one spool."""
    entry = store.get(composite_key)
    if not entry:
        return []
    return _migrate_entry(entry)


def is_currently_on_hold(store: dict, composite_key: str) -> bool:
    periods = periods_for(store, composite_key)
    return bool(periods) and periods[-1]["hold_removed"] is None


def update_hold_periods(
    store: dict,
    composite_key: str,
    status: str,
    offer_date: date,
) -> dict:
    """
    Advances one spool's Hold ledger by one run, given its latest
    offer event's normalized status ("Accept" / "Rework" / "Hold")
    and that event's date. Mutates `store` in place (adds/updates
    `store[composite_key]`). Returns a dict describing what
    happened, for logging and the Exceptions tab:

        {"opened": bool, "closed": bool, "working_days_held": int|None,
         "ambiguous": bool}

    - status == "Hold" and no period is currently open: opens a new
      one anchored at `offer_date`. If a period is already open,
      this is a no-op (the anchor never moves once set - same
      "remembered permanently" principle as the old rule).
    - status == "Accept" and a period IS open: closes it at
      `offer_date` and reports its working-day duration
      (utils.working_day_variance(), same calendar as everywhere
      else). No-op if nothing was open.
    - status == "Rework" while a period is open: ambiguous (Hold
      resolved without ever going through Accept) - left untouched,
      flagged for manual review rather than guessed at.
    """

    if offer_date is None:
        return {"opened": False, "closed": False, "working_days_held": None, "ambiguous": False}

    offer_date = _parse_date(offer_date)
    periods = periods_for(store, composite_key)
    open_period = periods[-1] if periods and periods[-1]["hold_removed"] is None else None

    result = {"opened": False, "closed": False, "working_days_held": None, "ambiguous": False}

    if status == "Hold":
        if open_period is None:
            periods.append({"hold_start": offer_date, "hold_removed": None})
            result["opened"] = True
    elif status == "Accept":
        if open_period is not None:
            open_period["hold_removed"] = offer_date
            result["closed"] = True
            result["working_days_held"] = max(
                working_day_variance(open_period["hold_start"], offer_date) or 0, 0
            )
    else:  # Rework
        if open_period is not None:
            result["ambiguous"] = True

    if periods:
        store[composite_key] = _serialize_periods(periods)

    return result


def working_days_held_between(
    store: dict,
    composite_key: str,
    window_start: Optional[date],
    window_end: Optional[date],
) -> int:
    """
    Total working days this spool spent on Hold that overlap
    [window_start, window_end] (inclusive of window_end, matching
    utils.working_day_variance()'s own "day after start, up to and
    including end" convention - so subtracting this from
    days_between(window_start, window_end) never double-counts or
    off-by-ones). A still-open Hold period is treated as held
    through TODAY for this purpose. Returns 0 if either bound is
    missing or nothing overlaps.
    """

    if window_start is None or window_end is None:
        return 0

    periods = periods_for(store, composite_key)
    if not periods:
        return 0

    right_now = today()
    total = 0
    for period in periods:
        hold_start = period["hold_start"]
        hold_end = period["hold_removed"] if period["hold_removed"] is not None else right_now
        if hold_start is None or hold_end is None:
            continue

        overlap_start = max(window_start, hold_start)
        overlap_end = min(window_end, hold_end)
        if overlap_start >= overlap_end:
            continue

        total += max(working_day_variance(overlap_start, overlap_end) or 0, 0)

    return total
