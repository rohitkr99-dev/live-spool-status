"""
src/rework_pdqc_rule.py
---------------------------------------------------------
ABSOLUTE RULE #1 (see docs/absolute-rules.md) - applies identically
across every dashboard, no exceptions: PDQC is never considered
"done" for a spool the Production Rework Data workbook currently
shows as not cleared by QC, no matter what the DPR Detailed Sheet or
Line History Sheet says. This is the single implementation of that
rule; every pipeline that has a PDQC field must call
apply_rework_pdqc_rule() on it.

History: this rule originally lived only inside
src/merge.py -> MergeEngine.apply_rework_pdqc_override(), written for
the Projects/Dashboard pipeline (main.py). Extracted to this shared
module 2026-08-18 after the Production dashboard (production_main.py
-> src/production/reader.py) was found to compute PDQC completely
independently, straight off the raw DPR sheet, with no awareness of
the Rework Data workbook at all - so a spool the Rework workbook
showed as still under rework could count as "PDQC done" on the
Production dashboard while correctly showing as not-yet-PDQC'd on
the Projects dashboard. That produced two different "Ready for
Painting" / RFP-backlog counts for what was supposed to be the same
population of spools (reported by the person: Projects page showed
~400, Production page showed 500+). Per the person, in their own
words: "for this, Rework rule is absolute primary... Same rule needs
to be applied to everywhere."

Both src/merge.py -> MergeEngine.apply_rework_pdqc_override() (used
by main.py) and src/production/pipeline.py (used by
production_main.py) now call this same function - see each call
site's own comment. Do not reintroduce a second copy of this logic
anywhere; if a THIRD pipeline ever needs PDQC, it must call this
function too.
"""

from __future__ import annotations

from typing import Optional

import pandas as pd

from constants import (
    COMPOSITE_KEY,
    DRAWING_NO,
    PDQC,
    PROJECT_CODE,
    REWORK_FINAL_STATUS,
    REWORK_LATEST_STATUS,
    REWORK_OFFER_DATE,
    SPOOL_NO,
)
from logger import logger
from utils import create_composite_key


def _normalize_rework_status(raw) -> str:
    """
    "Final Status" is free text from the shop floor and varies in
    case ("Accept" / "accept" / "ACCEPT") and occasionally means
    something that's neither an accept nor a rework ("Project hold",
    "SPOOL DELETED"), which normalizes to "Other". Same normalization
    as src/quality/summary.py's own copy (kept separate there
    deliberately, since that module has its own self-contained
    design) - this is the copy every PDQC-computing pipeline uses.
    """

    if pd.isna(raw):
        return "Other"
    text = str(raw).strip().upper()
    if text == "ACCEPT":
        return "Accept"
    if text == "REWORK":
        return "Rework"
    return "Other"


def _ensure_composite_key(dataframe: pd.DataFrame) -> pd.DataFrame:
    if COMPOSITE_KEY in dataframe.columns:
        return dataframe
    dataframe = dataframe.copy()
    dataframe[COMPOSITE_KEY] = dataframe.apply(
        lambda row: create_composite_key(
            row.get(PROJECT_CODE), row.get(DRAWING_NO), row.get(SPOOL_NO)
        ),
        axis=1,
    )
    return dataframe


def apply_rework_pdqc_rule(
    master: pd.DataFrame,
    rework: Optional[pd.DataFrame],
) -> pd.DataFrame:
    """
    The Production Rework Data workbook - QC's own record of every
    offer-for-inspection event per spool - is the primary source of
    truth for PDQC on any spool it covers, replacing whatever PDQC
    value `master` already has (from a DPR date field, Line History,
    or any other source). A spool can appear more than once in that
    workbook (offered again after a rework); its PDQC is driven by
    the LATEST "Prod offer" date across all of its rows - but only
    when that latest offer event was actually cleared:

      - Latest offer event's Final Status is Accept (cleared):
        PDQC becomes the LATER of (existing PDQC, that latest offer
        date) - PDQC must never move backwards, even if the rework
        workbook's latest offer date happens to be earlier than the
        existing one (e.g. a stale rework file, or a spool that has
        since progressed further via the normal DPR fields).

      - Latest offer event's Final Status is anything else (Rework,
        or a normalized "Other" like "Project hold") - NOT cleared:
        PDQC is forced BLANK, even overwriting an existing PDQC
        value from DPR/Line History - the most recent QC event says
        this spool hasn't actually passed QC yet, so any earlier
        PDQC on record is now stale and would overstate progress.
        This is a deliberate exception to the "never move backwards"
        rule above: that rule protects against a stale/earlier
        ACCEPT overriding a genuine advance; it was never meant to
        protect a false PDQC clearance.

    A spool NOT found in the rework workbook at all (its Composite
    Key isn't there) keeps its existing PDQC unchanged - this rule
    only applies to spools the rework file actually has an opinion
    on.

    Also sets/overwrites REWORK_LATEST_STATUS ("Rework Latest
    Status") on every row `master` has - the Final Status normalized
    to Accept/Rework/Other from THAT SAME latest-dated row. Always
    takes the status from the latest-dated row, never an earlier
    one, regardless of how many rows the spool has in the rework
    workbook.

    `master` needs Project Code, Drawing No, and Spool No columns
    (or an existing Composite Key column) to be matched against the
    rework workbook - both dataframes get a Composite Key added if
    they don't already have one, so this works whether or not the
    caller has already built it.

    If the rework workbook has no usable Final Status column at all
    this run, clearance can't be determined for anyone, so this
    falls back to the simpler "always take the later of the two
    dates" behavior for every matched spool rather than blanking
    PDQC everywhere on a missing-column edge case - logged clearly
    either way.

    No-op (returns `master` unchanged) if the rework workbook wasn't
    uploaded/readable this run - callers should already treat that
    workbook as optional, same as Line History and SIOP Planned
    Spools.
    """

    if rework is None or rework.empty:
        return master

    if REWORK_OFFER_DATE not in rework.columns:
        logger.warning(
            "Rework workbook has no usable Prod Offer Date "
            "column; skipping the PDQC rule for this run."
        )
        return master

    master = _ensure_composite_key(master)
    rework = _ensure_composite_key(rework)

    latest_offer_field = "Rework Latest Offer Date"

    rework_valid = rework.dropna(subset=[REWORK_OFFER_DATE])

    if rework_valid.empty:
        logger.warning(
            "Rework workbook had no usable Prod Offer Date "
            "values; skipping the PDQC rule for this run."
        )
        return master

    # idxmax (not a plain groupby().max()) so the row that wins for
    # the date ALSO supplies the status for that same spool - the
    # two must always come from the same offer event, not be
    # independently maxed (a spool's highest-ever status could
    # otherwise get paired with an unrelated later date).
    latest_row_index = (
        rework_valid.groupby(COMPOSITE_KEY)[REWORK_OFFER_DATE].idxmax()
    )
    status_column = (
        REWORK_FINAL_STATUS if REWORK_FINAL_STATUS in rework_valid.columns
        else None
    )
    columns_to_take = [COMPOSITE_KEY, REWORK_OFFER_DATE]
    if status_column:
        columns_to_take.append(status_column)

    latest_offer = rework_valid.loc[latest_row_index, columns_to_take].rename(
        columns={REWORK_OFFER_DATE: latest_offer_field}
    )

    if status_column:
        latest_offer[REWORK_LATEST_STATUS] = latest_offer[status_column].apply(
            _normalize_rework_status
        )
        latest_offer = latest_offer.drop(columns=[status_column])
    else:
        latest_offer[REWORK_LATEST_STATUS] = None

    master = master.merge(latest_offer, on=COMPOSITE_KEY, how="left")

    if PDQC not in master.columns:
        master[PDQC] = None

    existing_pdqc = pd.to_datetime(master[PDQC], errors="coerce")
    rework_date = pd.to_datetime(
        master[latest_offer_field], errors="coerce"
    )

    def later_of(existing: pd.Timestamp, latest: pd.Timestamp):
        if pd.isna(latest):
            return existing
        if pd.isna(existing):
            return latest
        return max(existing, latest)

    matched = ~rework_date.isna()

    if status_column:
        # Normal path: gate the override on clearance. Only an
        # Accept-status latest offer event is allowed to set/bump
        # PDQC; anything else (Rework, Other) forces it blank - see
        # the docstring above.
        cleared = matched & (master[REWORK_LATEST_STATUS] == "Accept")
        not_cleared = matched & ~cleared

        new_pdqc = pd.Series(existing_pdqc, index=master.index).copy()
        new_pdqc[cleared] = [
            later_of(existing, latest)
            for existing, latest in zip(
                existing_pdqc[cleared], rework_date[cleared]
            )
        ]
        new_pdqc[not_cleared] = pd.NaT

        bumped = cleared & (
            existing_pdqc.isna() | (new_pdqc != existing_pdqc)
        )
        blanked = not_cleared & ~existing_pdqc.isna()

        logger.info(
            f"Rework PDQC rule: {int(matched.sum())} spool(s) matched "
            f"in the rework workbook - {int(bumped.sum())} PDQC "
            f"date(s) set/bumped (latest offer event Accept), "
            f"{int(blanked.sum())} PDQC date(s) blanked (latest "
            "offer event not Accept, so not yet cleared by QC)."
        )
    else:
        # Fallback: no Final Status column available this run, so
        # clearance can't be determined for anyone - keep the plain
        # "later of the two" rule rather than blanking PDQC for
        # every matched spool.
        logger.warning(
            "Rework workbook has no usable Final Status column this "
            "run; the Cleared/Not-Cleared PDQC rule can't be applied. "
            "Falling back to the plain 'latest offer date wins if "
            "later' rule for every matched spool."
        )

        new_pdqc = pd.Series(
            [
                later_of(existing, latest)
                for existing, latest in zip(existing_pdqc, rework_date)
            ],
            index=master.index,
        )
        changed = matched & (
            existing_pdqc.isna() | (new_pdqc != existing_pdqc)
        )
        logger.info(
            f"Rework PDQC rule: {int(matched.sum())} spool(s) matched "
            f"in the rework workbook, {int(changed.sum())} PDQC "
            "date(s) updated."
        )

    master[PDQC] = new_pdqc
    master = master.drop(columns=[latest_offer_field])

    return master
