"""
src/rework_pdqc_rule.py
---------------------------------------------------------
ABSOLUTE RULE #1 (see docs/absolute-rules.md) - apply identically
across every dashboard, no exceptions. This is the single
implementation; every pipeline that has PDQC/RFP fields must call
apply_rework_pdqc_rule() on them.

RULE #1 (2026-08-17/18): PDQC is never considered "done" for a spool
the Production Rework Data workbook shows as not cleared by QC
(status Rework OR Hold - see below), no matter what the DPR Detailed
Sheet or Line History Sheet says - PDQC is forced blank in that
case, even overwriting an existing PDQC value.

REWORK-VS-HOLD DISTINCTION (2026-08-21 rewrite - see
docs/absolute-rules.md for the full history of the rule this
replaced): a Hold spool's PDQC/RFP are no longer faked to an
artificial "done almost immediately" anchor date - they're left
exactly as blank/real as a genuine Rework spool's, driven by the
SAME latest-offer-event logic. What actually distinguishes Hold from
Rework now:

  1. REWORK_LATEST_STATUS still reports "Hold" (not "Rework") for
     these spools, so the Exceptions tab / dashboards can still tell
     the two apart.
  2. Every Hold episode (open or closed) is recorded in the Hold
     ledger (see hold_ledger.py, state/hold_tracking.json) with its
     real start/removal dates. Ageing engines (src/ageing.py,
     src/production/ageing.py) subtract the WORKING days a spool
     spent on Hold from whatever age window they're computing -
     Total Age, a single stage's age, or the current-vs-target-quota
     comparison - wherever that window overlaps a Hold period,
     including a Hold that happens after RFP (Under Painting).
     That's what actually keeps Hold time from counting against
     Production/QC's ageing now, instead of a fabricated date.
  3. CURRENTLY_ON_HOLD (this module) flags any spool with an open
     Hold period right now. Both backlog engines exclude these
     entirely from their charts (per the person, 2026-08-21: "The
     hold spools should not be visible as backlog at any stage") -
     they get their own dedicated "currently on Hold, by Project and
     stage" chart instead (src/summary.py /
     src/production/summary.py -> *_hold_by_project_stage()).

Because a spool's Final Status can literally be edited in place in
the Rework Data workbook (a Hold row later hand-edited to Accept,
with no new row added), a spool's Hold history can vanish from the
workbook itself once resolved - hold_ledger.py's persisted store is
how that history survives across runs. This file MUST be committed
by every pipeline run (see .github/workflows/drive-sync.yml's git
add step) or Hold-day tracking loses its memory between runs and
silently stops working correctly.

History: Rule #1 originally lived only inside
src/merge.py -> MergeEngine.apply_rework_pdqc_override(), written for
the Projects/Dashboard pipeline (main.py). Extracted to this shared
module 2026-08-18 after the Production dashboard was found to
compute PDQC completely independently, with no awareness of the
Rework Data workbook at all - producing two different "PDQC done"
counts for what should be the same population of spools (Projects
~400, Production 500+). A Hold-specific anchoring rule (RULE #2)
lived here 2026-08-19 through 2026-08-20, replaced 2026-08-21 by the
ledger-based day-subtraction approach described above, per the
person's own request to track real Hold start/removal dates and
subtract exact working days from ageing instead.

Both src/merge.py -> MergeEngine.apply_rework_pdqc_override() (used
by main.py) and src/production/pipeline.py (used by
production_main.py) call this same function. Do not reintroduce a
second copy of this logic anywhere; if a THIRD pipeline ever needs
PDQC/RFP, it must call this function too.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

import hold_ledger
from constants import (
    COMPOSITE_KEY,
    DRAWING_NO,
    PACKING,
    PDI,
    PDQC,
    PROJECT_CODE,
    REWORK_FINAL_STATUS,
    REWORK_LATEST_STATUS,
    REWORK_OFFER_DATE,
    RFP,
    SPOOL_NO,
)
from logger import logger
from utils import create_composite_key, is_empty

DEFAULT_HOLD_TRACKING_PATH = hold_ledger.DEFAULT_HOLD_LEDGER_PATH

# Column added to the returned dataframe: True for a spool with an
# open, unresolved Hold period at the end of this run. Read by both
# backlog engines to exclude these spools from every backlog/overdue
# chart, and by the new *_hold_by_project_stage() aggregations to
# build the dedicated Hold chart.
CURRENTLY_ON_HOLD = "Currently On Hold"

# Column added to the returned dataframe: True for a spool whose
# open Hold period was followed by a "Rework" status with no Accept
# in between - ambiguous (see hold_ledger.update_hold_periods()),
# left untouched rather than guessed at. Read by
# src/summary.py -> generate_exceptions() to surface these on the
# Projects dashboard's Exceptions tab.
REWORK_HOLD_EXCEPTION = "Rework Hold Exception"

# Column added to the returned dataframe: True for a spool whose
# latest Rework Data status is Rework, but which already has a PDI
# Clearance or Packed date recorded - per the person (2026-08-20):
# "if the spool has already been PDI cleared, that means its rework
# has already been cleared". Treated as a stale Rework Data workbook
# entry rather than a genuine active rework - PDQC/RFP are NOT
# blanked for these spools (see apply_rework_pdqc_rule()). Read by
# src/summary.py -> generate_exceptions() to surface these on the
# Projects dashboard's Exceptions tab (type "rework_status_stale"),
# so the person can find and correct the source workbook, per his
# stated workflow ("I'll correct the Rework Excel file").
REWORK_STALE_STATUS_EXCEPTION = "Rework Stale Status Exception"

# Derived from config/production_rules.json -> target_days: the gap
# between the "pdqc" and "release_for_painting" entries is exactly 4
# working days for every one of the 6 categories in that table as of
# 2026-08-19 (le8_cs_ss 6->10, gt8_cs_ss 11->15, le8_as 12->16,
# gt8_as 16->20, sb 9->13, loose 4->8). Hardcoded here as a plain
# constant rather than a live per-category lookup, since this
# module (used by both the Projects and Production pipelines) has no
# access to Production's category-classification logic and the
# Projects pipeline has no equivalent concept at all. IF THE
# CATEGORIES EVER STOP SHARING THIS SAME 4-DAY GAP, THIS CONSTANT
# NEEDS A MANUAL UPDATE (or this module needs to become category-
# aware) - it will not pick up a change to target_days on its own.
# Exact Final Status text values, given by the person (2026-08-19),
# case-insensitively matched after collapsing internal whitespace.
# Any value NOT in this map is treated conservatively as "Rework"
# (not cleared) rather than silently assumed Accept or Hold, and
# logs a warning so a genuinely new status value gets noticed and
# added here deliberately.
_STATUS_MAP = {
    "ACCEPT": "Accept",
    "NOT FOUND": "Rework",
    "PROJECT HOLD": "Hold",
    "REWORK": "Rework",
    "REWORK/SAME RW": "Rework",
    "SPOOL DELETED": "Rework",
}


def _normalize_rework_status(raw) -> str:
    if pd.isna(raw):
        return "Rework"
    text = " ".join(str(raw).strip().upper().split())
    mapped = _STATUS_MAP.get(text)
    if mapped is None:
        logger.warning(
            f"Rework workbook: unrecognized Final Status value "
            f"{raw!r} - treating conservatively as Rework (not "
            "cleared), not Accept or Hold. If this is a genuine new "
            "category, add it to _STATUS_MAP in "
            "src/rework_pdqc_rule.py."
        )
        return "Rework"
    return mapped


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

def _later_of(existing: pd.Timestamp, latest: pd.Timestamp):
    if pd.isna(latest):
        return existing
    if pd.isna(existing):
        return latest
    return max(existing, latest)


def apply_rework_pdqc_rule(
    master: pd.DataFrame,
    rework: Optional[pd.DataFrame],
    hold_tracking_path: Path | str = DEFAULT_HOLD_TRACKING_PATH,
) -> pd.DataFrame:
    """
    The Production Rework Data workbook - QC's own record of every
    offer-for-inspection event per spool - is the primary source of
    truth for PDQC (and, for Hold spools only, RFP too) on any spool
    it covers, replacing whatever value `master` already has from a
    DPR date field, Line History, or any other source.

    For a spool this workbook covers, look at whichever row has the
    LATEST Prod Offer Date (its "latest offer event") to determine
    its current Final Status - Accept / Rework / Hold, per
    _STATUS_MAP:

      - Accept (cleared): PDQC becomes the LATER of (existing PDQC,
        that latest offer date). PDQC never moves backwards on a
        genuine clearance.

      - Rework (not cleared, genuine rework in progress): PDQC AND
        RFP are both forced BLANK, even overwriting existing values
        (updated 2026-08-20 - previously PDQC only). PDI Clearance
        and Packed are deliberately left untouched: a spool that's
        already been PDI-cleared is itself evidence its rework was
        actually resolved, even if the Rework Data workbook hasn't
        caught up to say so yet - per the person, he corrects those
        stale workbook entries directly rather than have the
        pipeline guess. (He's also said he wants a different overall
        approach to Rework handling in a future session; this is the
        interim rule.)

      - Hold (rewritten 2026-08-21 - see hold_ledger.py): treated the
        SAME as Rework for PDQC/RFP purposes (both forced blank,
        subject to the same PDI/Packed staleness exemption below) -
        no more artificial "done almost immediately" anchor. What
        actually protects Production/QC's ageing from a Hold delay
        now happens downstream: hold_ledger.update_hold_periods()
        records the real Hold start/removal dates for every spool
        this run touches, and src/ageing.py /
        src/production/ageing.py subtract those working days from
        whatever age window they compute. REWORK_LATEST_STATUS still
        reports "Hold" (not "Rework") for these spools so the two
        remain distinguishable everywhere downstream.

    A spool with an OPEN Hold period (CURRENTLY_ON_HOLD - see module
    docstring) is excluded from both dashboards' backlog charts
    entirely and shown instead on a dedicated "currently on Hold, by
    Project and stage" chart (src/summary.py /
    src/production/summary.py -> *_hold_by_project_stage()).

    Because a spool's status can change from Hold to Accept by
    editing the SAME row in place (no new row, same offer date) as
    easily as by adding a new later row, Hold history can vanish
    from the workbook itself once resolved - it's persisted in
    hold_ledger.py's JSON store (hold_tracking_path, state/
    hold_tracking.json by default) that survives across pipeline
    runs. A spool can go through any number of Hold episodes; each
    is recorded as its own period rather than needing a single
    anchor, so re-entering Hold after a previous resolution is no
    longer an ambiguous case (see hold_ledger.py's module docstring
    for the one case that IS still flagged: Hold jumping straight to
    Rework with no Accept in between - REWORK_HOLD_EXCEPTION).

    A spool NOT found in the rework workbook at all (its Composite
    Key isn't there) keeps its existing PDQC/RFP unchanged.

    Also sets/overwrites REWORK_LATEST_STATUS ("Rework Latest
    Status") to Accept/Rework/Hold, and CURRENTLY_ON_HOLD to whether
    the spool has an open Hold period as of this run (see above).

    `master` needs Project Code, Drawing No, and Spool No columns
    (or an existing Composite Key column). Both dataframes get a
    Composite Key added if they don't already have one.

    If the rework workbook has no usable Final Status column at all
    this run, clearance/Hold can't be determined for anyone, so this
    falls back to the simpler "always take the later of the two
    dates" behavior for PDQC only (no RFP change) - logged clearly.

    No-op (returns `master` unchanged) if the rework workbook wasn't
    uploaded/readable this run, or had no usable Prod Offer Date
    values.
    """

    if rework is None or rework.empty:
        return master

    if REWORK_OFFER_DATE not in rework.columns:
        logger.warning(
            "Rework workbook has no usable Prod Offer Date "
            "column; skipping the PDQC/RFP rule for this run."
        )
        return master

    master = _ensure_composite_key(master)
    rework = _ensure_composite_key(rework)

    latest_offer_field = "Rework Latest Offer Date"

    rework_valid = rework.dropna(subset=[REWORK_OFFER_DATE])

    if rework_valid.empty:
        logger.warning(
            "Rework workbook had no usable Prod Offer Date "
            "values; skipping the PDQC/RFP rule for this run."
        )
        return master

    # idxmax (not a plain groupby().max()) so the row that wins for
    # the date ALSO supplies the status for that same spool - the
    # two must always come from the same offer event.
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
    if RFP not in master.columns:
        master[RFP] = None

    existing_pdqc = pd.to_datetime(master[PDQC], errors="coerce")
    existing_rfp = pd.to_datetime(master[RFP], errors="coerce")
    rework_date = pd.to_datetime(master[latest_offer_field], errors="coerce")

    matched = ~rework_date.isna()

    new_pdqc = pd.Series(existing_pdqc, index=master.index).copy()
    new_rfp = pd.Series(existing_rfp, index=master.index).copy()
    is_exception = pd.Series(False, index=master.index)
    is_stale_status = pd.Series(False, index=master.index)

    if status_column:
        # ---- Advance the Hold ledger for every matched spool ----
        # (see hold_ledger.py). Done first, independent of the
        # cleared/not-cleared split below, so the ledger always
        # reflects this run's latest offer event even for a spool
        # whose Rework Data status is stale (see stale_status
        # below) - the ledger cares about Hold<->Accept transitions
        # only, which are unaffected by that separate concern.
        store = hold_ledger.load_ledger(hold_tracking_path)

        opened = 0
        closed = 0
        exception_keys: set[str] = set()

        for key, offer_date, status in zip(
            latest_offer[COMPOSITE_KEY],
            latest_offer[latest_offer_field],
            latest_offer[REWORK_LATEST_STATUS],
        ):
            outcome = hold_ledger.update_hold_periods(
                store, key, status, offer_date
            )
            if outcome["opened"]:
                opened += 1
            if outcome["closed"]:
                closed += 1
            if outcome["ambiguous"]:
                exception_keys.add(key)

        hold_ledger.save_ledger(store, hold_tracking_path)

        currently_on_hold = master[COMPOSITE_KEY].apply(
            lambda key: hold_ledger.is_currently_on_hold(store, key)
        )

        if opened or closed or exception_keys:
            logger.info(
                f"Hold ledger ({hold_tracking_path}): {opened} Hold "
                f"period(s) opened, {closed} closed (working days "
                f"held now recorded), {len(exception_keys)} spool(s) "
                "flagged as a Hold exception (Hold jumped straight "
                "to Rework with no Accept in between - needs manual "
                "review in the Exceptions tab)."
            )

        exception_mask = master[COMPOSITE_KEY].isin(exception_keys)
        cleared = matched & (master[REWORK_LATEST_STATUS] == "Accept")

        # UPDATED 2026-08-20 (per the person, in his own words: "if
        # the spool has already been PDI cleared, that means its
        # rework has already been cleared"): a spool whose latest
        # Rework Data status is Rework but which ALREADY has a PDI
        # Clearance or Packed date on record is treated as a stale
        # workbook entry, not genuine active rework - PDQC/RFP are
        # NOT blanked for it (left exactly as they already are).
        # Without this, such a spool's PDQC gets blanked while PDI/
        # Packed stay filled, and since "current stage" is always the
        # FIRST blank stage in order, it would permanently show as
        # "stuck at PDQC" - which is exactly the wrong/misleading
        # spools the person reported still appearing in the
        # Production dashboard's PDQC Backlog chart after the
        # PDQC+RFP blanking change alone.
        pdi_field = PDI if PDI in master.columns else None
        packing_field = PACKING if PACKING in master.columns else None
        already_progressed = pd.Series(False, index=master.index)
        if pdi_field:
            already_progressed |= ~master[pdi_field].apply(is_empty)
        if packing_field:
            already_progressed |= ~master[packing_field].apply(is_empty)

        stale_status = matched & ~cleared & already_progressed
        not_cleared = matched & ~cleared & ~already_progressed

        new_pdqc[cleared] = [
            _later_of(existing, latest)
            for existing, latest in zip(existing_pdqc[cleared], rework_date[cleared])
        ]
        new_pdqc[not_cleared] = pd.NaT

        # UPDATED 2026-08-20 (per the person, in his own words: "you
        # blank only PDQC and RFP dates for Rework Spools" - PDI
        # Clearance and Packed are deliberately left untouched, since
        # a spool that's already been PDI-cleared is itself evidence
        # its rework was actually resolved, even if the Rework Data
        # workbook hasn't caught up to say so yet. Narrower than
        # blanking every downstream stage, and the person plans to
        # correct stale entries in the Rework Data workbook directly
        # rather than have the pipeline guess at it. He's also said
        # he wants a different overall approach to Rework handling
        # in a future session - this is the interim fix for now.
        new_rfp[not_cleared] = pd.NaT

        is_exception = exception_mask
        is_stale_status = stale_status

        bumped = cleared & (existing_pdqc.isna() | (new_pdqc != existing_pdqc))
        blanked = not_cleared & ~existing_pdqc.isna()
        rfp_blanked = not_cleared & ~existing_rfp.isna()
        held_count = int((matched & currently_on_hold).sum())

        logger.info(
            f"Rework PDQC/RFP rule: {int(matched.sum())} spool(s) "
            f"matched - {int(bumped.sum())} PDQC date(s) set/bumped "
            f"(Accept), {int(blanked.sum())} PDQC and "
            f"{int(rfp_blanked.sum())} RFP date(s) blanked (not "
            "cleared - PDI Clearance/Packed left untouched), "
            f"{held_count} currently on an open Hold (excluded from "
            "backlog charts, working days held tracked in the Hold "
            f"ledger), {int(is_exception.sum())} held back as Hold "
            f"exceptions, {int(is_stale_status.sum())} left untouched "
            "as a stale Rework status (already PDI Cleared or "
            "Packed) this run."
        )
        currently_on_hold_final = currently_on_hold
    else:
        # Fallback: no Final Status column available this run, so
        # clearance/Hold can't be determined for anyone - keep the
        # plain "later of the two" rule for PDQC only, no RFP change.
        # The Hold ledger is left untouched (no status to advance it
        # with), so CURRENTLY_ON_HOLD still reflects whatever the
        # ledger already knew from a previous run.
        logger.warning(
            "Rework workbook has no usable Final Status column this "
            "run; the Cleared/Not-Cleared/Hold rules can't be "
            "applied. Falling back to the plain 'latest offer date "
            "wins if later' rule for PDQC only, every matched spool."
        )

        new_pdqc = pd.Series(
            [
                _later_of(existing, latest)
                for existing, latest in zip(existing_pdqc, rework_date)
            ],
            index=master.index,
        )
        changed = matched & (existing_pdqc.isna() | (new_pdqc != existing_pdqc))
        logger.info(
            f"Rework PDQC rule: {int(matched.sum())} spool(s) matched "
            f"in the rework workbook, {int(changed.sum())} PDQC "
            "date(s) updated."
        )

        store = hold_ledger.load_ledger(hold_tracking_path)
        currently_on_hold_final = master[COMPOSITE_KEY].apply(
            lambda key: hold_ledger.is_currently_on_hold(store, key)
        )

    master[PDQC] = new_pdqc
    master[RFP] = new_rfp
    master[REWORK_HOLD_EXCEPTION] = is_exception
    master[REWORK_STALE_STATUS_EXCEPTION] = is_stale_status
    master[CURRENTLY_ON_HOLD] = currently_on_hold_final
    master = master.drop(columns=[latest_offer_field])

    return master
