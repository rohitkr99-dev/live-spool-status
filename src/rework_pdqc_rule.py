"""
src/rework_pdqc_rule.py
---------------------------------------------------------
ABSOLUTE RULES #1 and #2 (see docs/absolute-rules.md) - apply
identically across every dashboard, no exceptions. This is the
single implementation of both; every pipeline that has PDQC/RFP
fields must call apply_rework_pdqc_rule() on them.

RULE #1 (2026-08-17/18): PDQC is never considered "done" for a spool
the Production Rework Data workbook shows as not cleared by QC
(status Rework), no matter what the DPR Detailed Sheet or Line
History Sheet says - PDQC is forced blank in that case, even
overwriting an existing PDQC value.

RULE #2 (2026-08-19, given by the person in their own words - "for
this, Rework rule is absolute primary... If a spool is showing
rework, PDQC goes blank... Production says a Hold should not affect
their ageing, QC says Hold should not affect their ageing"): a THIRD
Final Status category, Hold, is treated differently from Rework.
Neither Production nor QC consider a Hold their own delay, so a
Hold-affected spool's PDQC is treated as done almost immediately
(anchored near the original offer date, not the eventual clearance
date, however long the hold lasts) and RFP is given the standard
target gap from that anchor rather than the true, hold-inflated gap.
See apply_rework_pdqc_rule()'s docstring for the full rule and
_STATUS_MAP for the exact Final Status text values this maps to
Accept/Rework/Hold (given by the person 2026-08-19 - update this map,
not ad-hoc keyword matching, if a new Final Status value shows up).

Because a spool's Final Status can literally be edited in place in
the Rework Data workbook (a Hold row later hand-edited to Accept,
with no new row added), a spool's Hold history can vanish from the
workbook itself once resolved. Rule #2 therefore needs to remember,
across pipeline runs, which spools were ever seen on Hold and what
their original offer date was - see state/hold_tracking.json and
_load_hold_tracking_store()/_save_hold_tracking_store() below. This
file MUST be committed by every pipeline run (see
.github/workflows/drive-sync.yml's git add step) or Rule #2 loses
its memory between runs and silently stops working correctly.

History: Rule #1 originally lived only inside
src/merge.py -> MergeEngine.apply_rework_pdqc_override(), written for
the Projects/Dashboard pipeline (main.py). Extracted to this shared
module 2026-08-18 after the Production dashboard was found to
compute PDQC completely independently, with no awareness of the
Rework Data workbook at all - producing two different "PDQC done"
counts for what should be the same population of spools (Projects
~400, Production 500+). Rule #2 (Hold handling) was added here
directly 2026-08-19, after the same Rework blanking behavior was
found to ALSO inflate the PDQC-stuck count on both dashboards for
spools that were only on administrative Hold, not genuine rework.

Both src/merge.py -> MergeEngine.apply_rework_pdqc_override() (used
by main.py) and src/production/pipeline.py (used by
production_main.py) call this same function. Do not reintroduce a
second copy of this logic anywhere; if a THIRD pipeline ever needs
PDQC/RFP, it must call this function too.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import pandas as pd

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
from utils import add_working_days, create_composite_key, is_empty

DEFAULT_HOLD_TRACKING_PATH = Path("state/hold_tracking.json")

# Column added to the returned dataframe: True for a spool whose
# Hold history is ambiguous this run (re-entered Hold after a
# previous resolution - see apply_rework_pdqc_rule()). Read by
# src/summary.py -> generate_exceptions() to surface these on the
# Projects dashboard's Exceptions tab, per the person's explicit
# instruction (2026-08-19): "You can flag this spool in Exceptions
# section... I will see and make changes in the actual file manually
# and reupload it."
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
STANDARD_PDQC_TO_RFP_WORKING_DAYS = 4

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


def _load_hold_tracking_store(path: Path) -> dict:
    if not Path(path).exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError) as error:
        logger.warning(
            f"Could not read Hold tracking store at {path} ({error}) "
            "- starting fresh this run. Any spool previously "
            "recorded as Hold will need to be re-detected from the "
            "current Rework workbook, if it's still there."
        )
        return {}


def _save_hold_tracking_store(path: Path, store: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(store, file, indent=2, sort_keys=True)


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

      - Hold (ABSOLUTE RULE #2, 2026-08-19): treated differently
        from Rework, because the delay is administrative, not a
        genuine fabrication/quality problem, and neither Production
        nor QC consider it their own ageing to carry. PDQC is
        treated as done almost immediately: anchored to the EARLIEST
        offer date this spool was ever seen on Hold (not the
        eventual Accept date, however long the hold lasted), then
        set to the LATER of (existing PDQC, that anchor date) - same
        "never moves backwards" protection as the Accept case. RFP
        is set to the LATER of (existing RFP, anchor date +
        STANDARD_PDQC_TO_RFP_WORKING_DAYS working days) rather than
        the true RFP date, which would otherwise still carry almost
        the entire hold-caused delay and unfairly inflate whichever
        team's ageing metric depends on RFP.

    Because a spool's status can change from Hold to Accept by
    editing the SAME row in place (no new row, same offer date) as
    easily as by adding a new later row, the Hold anchor date can't
    always be found by scanning the current file alone once resolved
    - it's persisted in a small JSON store (hold_tracking_path,
    state/hold_tracking.json by default) that survives across
    pipeline runs. Once a spool is first seen on Hold, its anchor
    date is remembered PERMANENTLY (even after it clears) - the
    entire point of the rule is that the hold period never counts,
    not just while the hold is ongoing.

    If a spool that was previously resolved (recorded as no longer
    on Hold) is later seen on Hold AGAIN, that's an ambiguous,
    unexpected pattern - per the person, this should not normally
    happen. Rather than silently re-anchoring or guessing which
    episode matters, that spool is left on its ORIGINAL anchor
    (Hold-anchor treatment is suspended for it this run - it falls
    back to the plain Accept/Rework rule instead) and flagged via the
    REWORK_HOLD_EXCEPTION column so src/summary.py ->
    generate_exceptions() can surface it on the Projects dashboard's
    Exceptions tab for manual review, per the person's explicit
    instruction.

    A spool NOT found in the rework workbook at all (its Composite
    Key isn't there) keeps its existing PDQC/RFP unchanged.

    Also sets/overwrites REWORK_LATEST_STATUS ("Rework Latest
    Status") to Accept/Rework/Hold - Hold-anchored spools always
    report "Hold" here even once their underlying row shows Accept,
    since the anchor treatment still applies to them.

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
        # ---- ABSOLUTE RULE #2: detect/track Hold spools ----
        rework_valid = rework_valid.copy()
        rework_valid["_status"] = rework_valid[status_column].apply(
            _normalize_rework_status
        )
        earliest_hold_this_run = (
            rework_valid[rework_valid["_status"] == "Hold"]
            .groupby(COMPOSITE_KEY)[REWORK_OFFER_DATE]
            .min()
        )
        latest_status_lookup = dict(
            zip(latest_offer[COMPOSITE_KEY], latest_offer[REWORK_LATEST_STATUS])
        )

        store = _load_hold_tracking_store(hold_tracking_path)

        hold_anchor: dict[str, pd.Timestamp] = {}
        exception_keys: set[str] = set()
        new_holds = 0
        resolved_holds = 0

        for key in latest_offer[COMPOSITE_KEY]:
            has_hold_this_run = key in earliest_hold_this_run.index
            stored = store.get(key)
            latest_status_this_run = latest_status_lookup.get(key)

            if stored is None:
                if has_hold_this_run:
                    anchor = earliest_hold_this_run[key]
                    store[key] = {
                        "hold_offer_date": pd.Timestamp(anchor).isoformat(),
                        "still_on_hold": bool(latest_status_this_run == "Hold"),
                    }
                    hold_anchor[key] = pd.Timestamp(anchor)
                    new_holds += 1
                continue

            stored_anchor = pd.Timestamp(stored["hold_offer_date"])

            if stored.get("still_on_hold", False):
                if latest_status_this_run == "Accept":
                    store[key]["still_on_hold"] = False
                    resolved_holds += 1
                hold_anchor[key] = stored_anchor
            else:
                if has_hold_this_run:
                    # Resolved before, on Hold again - ambiguous per
                    # the person: flag, don't silently re-anchor.
                    exception_keys.add(key)
                else:
                    hold_anchor[key] = stored_anchor

        _save_hold_tracking_store(hold_tracking_path, store)

        if new_holds or resolved_holds or exception_keys:
            logger.info(
                f"Rework Hold tracking ({hold_tracking_path}): "
                f"{new_holds} new Hold spool(s) recorded, "
                f"{resolved_holds} Hold spool(s) resolved (now "
                f"Accept), {len(exception_keys)} spool(s) flagged as "
                "a Hold exception (re-entered Hold after a previous "
                "resolution - needs manual review in the Exceptions "
                "tab)."
            )

        held_keys = {k for k in hold_anchor if k not in exception_keys}
        held = matched & master[COMPOSITE_KEY].isin(held_keys)
        exception_mask = master[COMPOSITE_KEY].isin(exception_keys)
        cleared = matched & (master[REWORK_LATEST_STATUS] == "Accept") & ~held

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

        stale_status = matched & ~held & ~cleared & already_progressed
        not_cleared = matched & ~held & ~cleared & ~already_progressed

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

        if held.any():
            anchor_dates = pd.to_datetime(
                master.loc[held, COMPOSITE_KEY].map(hold_anchor)
            )
            new_pdqc.loc[held] = [
                _later_of(existing, anchor)
                for existing, anchor in zip(existing_pdqc[held], anchor_dates)
            ]

            standard_rfp = pd.to_datetime(
                new_pdqc.loc[held].apply(
                    lambda d: add_working_days(
                        d.date(), STANDARD_PDQC_TO_RFP_WORKING_DAYS
                    ) if pd.notna(d) else pd.NaT
                )
            )
            new_rfp.loc[held] = [
                _later_of(existing, standard)
                for existing, standard in zip(existing_rfp[held], standard_rfp)
            ]

            master.loc[held, REWORK_LATEST_STATUS] = "Hold"

        is_exception = exception_mask
        is_stale_status = stale_status

        bumped = cleared & (existing_pdqc.isna() | (new_pdqc != existing_pdqc))
        blanked = not_cleared & ~existing_pdqc.isna()
        rfp_blanked = not_cleared & ~existing_rfp.isna()

        logger.info(
            f"Rework PDQC/RFP rule: {int(matched.sum())} spool(s) "
            f"matched - {int(bumped.sum())} PDQC date(s) set/bumped "
            f"(Accept), {int(blanked.sum())} PDQC and "
            f"{int(rfp_blanked.sum())} RFP date(s) blanked (not "
            "cleared - PDI Clearance/Packed left untouched), "
            f"{int(held.sum())} Hold-anchored (PDQC treated as done "
            "at the original offer date, RFP set to the standard "
            f"target gap), {int(is_exception.sum())} held back as "
            f"Hold exceptions, {int(is_stale_status.sum())} left "
            "untouched as a stale Rework status (already PDI Cleared "
            "or Packed) this run."
        )
    else:
        # Fallback: no Final Status column available this run, so
        # clearance/Hold can't be determined for anyone - keep the
        # plain "later of the two" rule for PDQC only, no RFP change.
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

    master[PDQC] = new_pdqc
    master[RFP] = new_rfp
    master[REWORK_HOLD_EXCEPTION] = is_exception
    master[REWORK_STALE_STATUS_EXCEPTION] = is_stale_status
    master = master.drop(columns=[latest_offer_field])

    return master
