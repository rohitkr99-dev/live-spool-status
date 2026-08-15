"""
merge.py
---------------------------------------------------------
Merge Engine for the Live Spool Status & Ageing System.

Responsibilities
----------------
1. Build the Composite Key for every source dataframe.
2. Collapse the Fit-Up DB and Welding DB - transactional sheets
   with one row per joint - into a single First Fit-Up / First
   Welding date per spool (the earliest Activity Date).
3. Merge the fabrication dataframe (DPR Detailed Sheet - the
   master production database) with the planning dataframe
   (Planned Start, Week, Group) and the aggregated First Fit-Up /
   First Welding dates into a single Master Spool Dataset -
   one row per spool.
4. Backfill PDI / Packing / Dispatch on that Master Spool Dataset
   from the separate Packing & Dispatch workbooks - see
   apply_packing_dates().

This module does not read Excel, validate, clean, apply business
rules, or calculate ageing. It only combines already-cleaned,
per-source dataframes into one dataframe, keyed on the Composite
Key:

    Project Code + Drawing No + Spool No

Design note
-----------
The fabrication dataframe is treated as the master list of spools,
per the Master Specification ("DPR is the master production
database"). Planning-only spools that do not exist in the DPR sheet
are therefore not currently included in the Master Spool Dataset.
"""

from __future__ import annotations

from typing import Optional

import pandas as pd

from config_loader import load_business_rules
from constants import (
    COMPOSITE_KEY,
    DRAWING_NO,
    LH_FITUP_LAST_DATE,
    LH_LAST_WELDING_FRUN,
    LH_WELDING_AGE,
    LINE_HISTORY_STAGE,
    PDQC,
    PLANNED_START,
    PROJECT_CODE,
    REWORK_OFFER_DATE,
    REWORK_FINAL_STATUS,
    REWORK_LATEST_STATUS,
    SIOP_PLANNED_START,
    SPOOL_NO,
    WELDING_FINISH,
)
from welding_finish import (
    build_line_history_lookup,
    build_welding_db_lookup,
    determine_welding_finish,
)
from logger import logger
from utils import create_composite_key, is_empty, parse_date, working_day_variance


def _normalize_rework_status(raw) -> str:
    """
    Same normalization as src/quality/summary.py's _normalize_status
    (kept as a separate small copy here rather than a shared import,
    consistent with how the rest of this module is self-contained) -
    "Final Status" is free text from the shop floor and varies in
    case ("Accept" / "accept" / "ACCEPT") and occasionally means
    something that's neither an accept nor a rework ("Project hold",
    "SPOOL DELETED"), which normalizes to "Other".
    """

    if pd.isna(raw):
        return "Other"
    text = str(raw).strip().upper()
    if text == "ACCEPT":
        return "Accept"
    if text == "REWORK":
        return "Rework"
    return "Other"


class MergeEngine:
    """
    Combines fabrication and planning dataframes into a single
    Master Spool Dataset.
    """

    def __init__(self) -> None:

        rules = load_business_rules()

        first_activity_fields: list[str] = (
            rules["unplanned_spool"]["first_activity_fields"]
        )

        # config-driven: whichever fields are configured as the
        # unplanned-spool first activity fields are exactly the
        # fields this engine must derive from the transactional
        # planning sheets (Fit-Up DB / Welding DB).
        if len(first_activity_fields) != 2:
            logger.warning(
                "Expected exactly 2 first_activity_fields "
                "(Fit-Up, Welding) in business_rules.json; "
                f"found {len(first_activity_fields)}."
            )

        self.first_fitup_field = first_activity_fields[0]
        self.first_welding_field = first_activity_fields[1]

        # Line History Sheet override (config/business_rules.json ->
        # line_history_override) - see summarize_line_history().
        line_history_config = rules.get("line_history_override", {})
        self.line_history_enabled: bool = line_history_config.get(
            "enabled", False
        )
        self.line_history_joint_no_field: str = line_history_config.get(
            "joint_no_field", "Joint No"
        )
        self.line_history_fitup_date_field: str = line_history_config.get(
            "fitup_date_field", "Weld FitUp Date"
        )
        self.line_history_weld_run_date_field: str = (
            line_history_config.get(
                "weld_run_date_field", "Welding FRun Date"
            )
        )
        self.line_history_stage_order: list[str] = line_history_config.get(
            "override_stage_order", ["Fit-Up", "Welding", "PDQC"]
        )

        # Packing & Dispatch backfill (config/business_rules.json ->
        # packing_dispatch_merge) - see apply_packing_dates().
        packing_merge_config = rules.get("packing_dispatch_merge", {})
        self.packing_merge_enabled: bool = packing_merge_config.get(
            "enabled", False
        )
        self.packing_field_mapping: dict[str, str] = (
            packing_merge_config.get(
                "field_mapping",
                {
                    "pdi_date": "PDI",
                    "packing_date": "Packing",
                    "dispatched_date": "Dispatch",
                },
            )
        )

        logger.info("Merge Engine initialised.")

    # -----------------------------------------------------

    def add_composite_key(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """
        Add the Composite Key column to a dataframe that already
        has Project Code, Drawing No, and Spool No.
        """

        dataframe = dataframe.copy()

        dataframe[COMPOSITE_KEY] = dataframe.apply(
            lambda row: create_composite_key(
                row.get(PROJECT_CODE),
                row.get(DRAWING_NO),
                row.get(SPOOL_NO),
            ),
            axis=1,
        )

        return dataframe

    # -----------------------------------------------------

    def summarize_first_activity(
        self,
        dataframe: pd.DataFrame,
        activity_date_field: str,
        target_field: str,
    ) -> pd.DataFrame:
        """
        Collapse a transactional DB (one row per joint) into one
        row per spool, using the earliest Activity Date.

        Parameters
        ----------
        dataframe
            Fit-Up DB or Welding DB, already column-standardised
            and with Composite Key already present.

        activity_date_field
            Name of the per-joint date column (e.g. "Activity Date").

        target_field
            "First Fit-Up" or "First Welding".

        Returns
        -------
        pandas.DataFrame
            Two columns: Composite Key, target_field.
        """

        if activity_date_field not in dataframe.columns:
            logger.warning(
                f"'{activity_date_field}' column not found; "
                f"cannot compute {target_field}."
            )
            return pd.DataFrame(columns=[COMPOSITE_KEY, target_field])

        summary = (
            dataframe.groupby(COMPOSITE_KEY)[activity_date_field]
            .min()
            .reset_index()
            .rename(columns={activity_date_field: target_field})
        )

        return summary

    # -----------------------------------------------------

    # -----------------------------------------------------

    def summarize_line_history(
        self,
        line_history: Optional[pd.DataFrame],
    ) -> pd.DataFrame:
        """
        Collapse the Line History Sheet (one row per joint) into one
        row per spool with:

            Line History Stage        - see config/business_rules.json
                                         -> line_history_override, and
                                         business_rules.py ->
                                         is_stage_reached_with_line_
                                         history(), which is what
                                         actually consumes this
                                         column.
            LH Fit-Up Last Date       - see fitup_last_date below
            LH Welding Age            - see welding_age below
            LH Last Welding FRun Date - see last_welding_frun below

        Rule (as given by the person, in their own words, updated
        2026-08-10 to add a mid-stage):
            - Rows with a blank Joint No. are ignored.
            - If a spool ends up with no non-blank-Joint-No. rows at
              all (including if it isn't in the sheet at all), it is
              simply absent from the returned summary - the existing
              date-field-based Fit-Up/Welding/PDQC logic is used for
              it unchanged.
            - Otherwise, per joint, an "effective" Weld FitUp Date is
              that joint's own Weld FitUp Date, or - only when that's
              blank - its Welding FRun Date used in its place (you
              cannot weld a joint that hasn't been fit up, so a
              logged weld run date is itself evidence the fit-up
              happened even if that field wasn't separately filled
              in - the same substitution already used for LH Fit-Up
              Last Date below, now also driving this classification).
              Welding presence itself is checked RAW (no later field
              within this pair to infer it from). Then:
                - no joint has an effective Fit-Up date and no joint
                  has a Welding FRun Date at all -> "Fit-Up" (nothing
                  started)
                - every joint has an effective Fit-Up date, but at
                  least one is still missing its Welding FRun Date
                  -> "Welding" (status message "Waiting for
                  Welding" - unchanged from before this update)
                - every joint has both -> "PDQC" (whether the spool
                  has progressed past PDQC is then decided by the
                  normal date-based walk over PDQC/RFP/PDI/Packing/
                  Dispatch, unchanged)
                - anything else (a genuine mix that's neither of the
                  above - e.g. some joints fully done and others not
                  started, or some joints only fit-up while others
                  aren't even that) -> "Partial Fit-Up/Welding"

        Per-spool ages (as given by the person, in their own words -
        consumed by ageing.py / summary.py via line_history_ageing.py,
        which apply the fallback when these come back blank):

            fitup_last_date
                The LATEST "effective" Weld FitUp Date across every
                joint - where a joint's effective date is its own
                Weld FitUp Date, or (only when THAT is blank) its
                Welding FRun Date used in its place - reported only
                when every joint ends up with an effective date this
                way. line_history_ageing.py -> fitup_age() then
                measures the Fit-Up Age as this date minus the
                spool's Planned Start (see that module's docstring
                for the full cascade, including its PDQC-date and
                today-based fallbacks for spools that don't clear
                this bar).

            welding_age
                Average, across every joint that has BOTH a Weld
                FitUp Date and a Welding FRun Date, of (that joint's
                Welding FRun Date - that joint's Weld FitUp Date).
                Joints missing either date are simply skipped, not
                counted as zero.

            last_welding_frun
                Only when EVERY joint has BOTH dates filled (i.e.
                the spool is "PDQC" per the rule above): the LATEST
                Welding FRun Date. This is deliberately not reported
                at all when any joint is incomplete - a partial
                "latest" from an incomplete joint list isn't the
                real end of Welding, so callers must fall back to
                something else instead of trusting it (see
                line_history_ageing.py -> pdqc_age()).

        Returns
        -------
        pandas.DataFrame
            Columns: Composite Key, Line History Stage, LH Fit-Up
            Age, LH Welding Age, LH Last Welding FRun Date. Empty
            (but correctly-shaped) if the feature is disabled, no
            file was uploaded, or nothing in it was usable.
        """

        result_columns = [
            COMPOSITE_KEY,
            LINE_HISTORY_STAGE,
            LH_FITUP_LAST_DATE,
            LH_WELDING_AGE,
            LH_LAST_WELDING_FRUN,
        ]
        empty_result = pd.DataFrame(columns=result_columns)

        if not self.line_history_enabled:
            return empty_result

        if line_history is None or line_history.empty:
            return empty_result

        required_columns = [
            self.line_history_joint_no_field,
            self.line_history_fitup_date_field,
            self.line_history_weld_run_date_field,
        ]

        missing = [
            column for column in required_columns
            if column not in line_history.columns
        ]

        if missing:
            logger.warning(
                "Line History Sheet is missing expected column(s) "
                f"{missing}; skipping the Fit-Up/Welding/PDQC "
                "override for this run."
            )
            return empty_result

        fitup_stage, partial_stage, welding_stage, pdqc_stage = (
            self.line_history_stage_order[:4]
        )

        dataframe = self.add_composite_key(line_history)

        joints = dataframe[
            ~dataframe[self.line_history_joint_no_field].apply(is_empty)
        ]

        if joints.empty:
            return empty_result

        records = []

        for composite_key, group in joints.groupby(COMPOSITE_KEY):

            fitup_values = group[self.line_history_fitup_date_field]
            weldrun_values = group[self.line_history_weld_run_date_field]

            # Effective Fit-Up presence per joint (2026-08-10 - see
            # the rule above): a joint's Welding FRun Date being
            # present substitutes for a blank Weld FitUp Date on
            # that SAME joint. Welding presence itself stays RAW.
            effective_fitup_present = [
                (not is_empty(fitup_value)) or (not is_empty(weldrun_value))
                for fitup_value, weldrun_value
                in zip(fitup_values, weldrun_values)
            ]
            weldrun_present = [
                not is_empty(weldrun_value) for weldrun_value in weldrun_values
            ]

            fitup_all_present = all(effective_fitup_present)
            fitup_any_present = any(effective_fitup_present)
            weldrun_all_present = all(weldrun_present)
            weldrun_any_present = any(weldrun_present)

            if not fitup_any_present and not weldrun_any_present:
                stage = fitup_stage
            elif fitup_all_present and weldrun_all_present:
                stage = pdqc_stage
            elif fitup_all_present and not weldrun_all_present:
                stage = welding_stage
            else:
                stage = partial_stage

            record = {
                COMPOSITE_KEY: composite_key,
                LINE_HISTORY_STAGE: stage,
                LH_FITUP_LAST_DATE: None,
                LH_WELDING_AGE: None,
                LH_LAST_WELDING_FRUN: None,
            }

            # LH Fit-Up Last Date (as given by the person, in their
            # own words): for each joint, use its own Weld FitUp
            # Date - or, only when that's blank, its Welding FRun
            # Date instead. Reported only when EVERY joint ends up
            # with an effective date this way (a joint missing BOTH
            # dates means coverage is incomplete, and this stays
            # None - line_history_ageing.py -> fitup_age() then
            # falls back to PDQC or today, not to this partial
            # data). This is deliberately a separate, looser check
            # than fitup_all_present above, which drives the Line
            # History Stage classification, not this age.
            effective_fitup_dates = []
            fitup_coverage_complete = True

            for fitup_value, weldrun_value in zip(
                fitup_values, weldrun_values
            ):
                effective_date = parse_date(fitup_value)
                if effective_date is None:
                    effective_date = parse_date(weldrun_value)
                if effective_date is None:
                    fitup_coverage_complete = False
                    break
                effective_fitup_dates.append(effective_date)

            if fitup_coverage_complete and effective_fitup_dates:
                record[LH_FITUP_LAST_DATE] = max(effective_fitup_dates)

            # LH Welding Age: mean of (Welding FRun - Weld FitUp),
            # in working days (see utils.py -> working_day_variance()),
            # over joints with BOTH dates present.
            joint_durations = [
                working_day_variance(fitup_date, weld_run_date)
                for fitup_date, weld_run_date in zip(
                    fitup_values.apply(parse_date),
                    weldrun_values.apply(parse_date),
                )
                if fitup_date is not None and weld_run_date is not None
            ]
            if joint_durations:
                record[LH_WELDING_AGE] = (
                    sum(joint_durations) / len(joint_durations)
                )

            # LH Last Welding FRun Date: only trustworthy once every
            # joint has both dates (stage == pdqc_stage already
            # confirms this).
            if fitup_all_present and weldrun_all_present:
                weldrun_dates = [
                    date for date in weldrun_values.apply(parse_date)
                    if date is not None
                ]
                if weldrun_dates:
                    record[LH_LAST_WELDING_FRUN] = max(weldrun_dates)

            records.append(record)

        summary = pd.DataFrame.from_records(records, columns=result_columns)

        logger.info(
            f"Line History Sheet: {len(summary)} spool(s) with "
            "joint-level Fit-Up/Welding/PDQC data."
        )

        return summary

    # -----------------------------------------------------

    def apply_siop_fallback(
        self,
        master: pd.DataFrame,
        siop_planned: Optional[pd.DataFrame],
    ) -> pd.DataFrame:
        """
        Planned Start fallback source (as given by the person, in
        their own words): the Weekly Production Planning workbook is
        still the primary source of Planned Start. For any spool
        whose Planned Start is still blank after that merge (its
        Composite Key wasn't found there, or was found with a blank
        Start Date), look the spool up in the SIOP Planned Spools
        workbook instead, by the same Composite Key, and use ITS
        "Planned Start Date" column if present. A spool found in
        neither file simply keeps a blank Planned Start, which
        business_rules.py -> determine_planned_flag() already
        reports as Planned = No - no change needed there, since it
        only checks whether Planned Start ended up with a value,
        wherever that value came from.

        This can only ever ADD a Planned Start date that was
        missing, never overwrite one the Weekly file already
        provided.

        No-op (returns master unchanged) if the SIOP workbook wasn't
        uploaded this run, or didn't yield a usable Planned Start
        column - see reader.py -> read_siop_planned(), which already
        treats a missing/unreadable file as optional, same as the
        Line History Sheet.
        """

        if siop_planned is None or siop_planned.empty:
            return master

        if SIOP_PLANNED_START not in siop_planned.columns:
            logger.warning(
                "SIOP Planned Spools workbook has no usable Planned "
                "Start Date column; skipping the Planned Start "
                "fallback for this run."
            )
            return master

        if PLANNED_START not in master.columns:
            master = master.copy()
            master[PLANNED_START] = None

        siop_planned = self.add_composite_key(siop_planned)

        siop_lookup = (
            siop_planned[[COMPOSITE_KEY, SIOP_PLANNED_START]]
            .dropna(subset=[SIOP_PLANNED_START])
            .drop_duplicates(subset=[COMPOSITE_KEY], keep="first")
        )

        master = master.merge(
            siop_lookup,
            on=COMPOSITE_KEY,
            how="left",
        )

        needs_fallback = master[PLANNED_START].apply(is_empty)
        has_siop_value = ~master[SIOP_PLANNED_START].apply(is_empty)
        fillable = needs_fallback & has_siop_value

        master.loc[fillable, PLANNED_START] = master.loc[
            fillable, SIOP_PLANNED_START
        ]

        filled = int(fillable.sum())

        master = master.drop(columns=[SIOP_PLANNED_START])

        if filled:
            logger.info(
                f"SIOP Planned Spools fallback: filled Planned "
                f"Start for {filled} spool(s) not found (or blank) "
                "in the Weekly Production Planning workbook."
            )

        return master

    # -----------------------------------------------------

    def apply_welding_finish(
        self,
        master: pd.DataFrame,
        welding_db: pd.DataFrame,
        line_history: Optional[pd.DataFrame],
        activity_date_field: str,
    ) -> pd.DataFrame:
        """
        Adds a "Welding Finish" column to master - the date the LAST
        joint finished welding, using the EXACT same calculation the
        Production dashboard already used (src/welding_finish.py,
        promoted to this shared top-level location 2026-08-15) -
        both dashboards now agree, computed from the same source
        data through the same function, rather than two
        independently-built definitions of "Welding done".

        Added 2026-08-15 (given by the person, in their own words:
        "the rules under Production pages are actual and Projects
        numbers should have been updated as per that only").
        config/stages.json's "Welding" stage now points its
        date_field at this column instead of the looser "First
        Welding" (still computed and left on master unchanged - see
        summarize_first_activity() above - in case anything else
        still reads it; nothing for stage-gating does any more).

        Deliberately called BEFORE apply_rework_pdqc_override() in
        merge() below, so this reads the SAME raw DPR PDQC value the
        Production pipeline's own welding_finish.py call does (which
        has no rework-PDQC-override concept of its own) - not the
        rework-corrected PDQC the rest of THIS pipeline's stage walk
        uses everywhere else. Using the post-override PDQC here would
        reintroduce a small residual mismatch between the two
        dashboards for exactly the spools that override touches.
        """

        if WELDING_FINISH not in master.columns:
            master[WELDING_FINISH] = None

        line_history_lookup = build_line_history_lookup(
            line_history,
            self.line_history_joint_no_field,
            self.line_history_weld_run_date_field,
        )
        welding_db_lookup = build_welding_db_lookup(
            welding_db,
            activity_date_field,
        )

        results = master.apply(
            lambda row: determine_welding_finish(
                row[COMPOSITE_KEY],
                row.get(PDQC),
                line_history_lookup,
                welding_db_lookup,
            )[0],
            axis=1,
        )
        master[WELDING_FINISH] = results

        logger.info(
            f"Welding Finish (all-joints-done) computed for "
            f"{int(results.notna().sum())} of {len(master)} spool(s)."
        )

        return master

    def apply_rework_pdqc_override(
        self,
        master: pd.DataFrame,
        rework: Optional[pd.DataFrame],
    ) -> pd.DataFrame:
        """
        QA/QC Rework Report PDQC override (as given by the person,
        in their own words): the Production Rework Data workbook -
        QC's own record of every offer-for-inspection event per
        spool - becomes the primary source of truth for PDQC on any
        spool it covers, replacing the existing DPR-date-field/Line-
        History-derived PDQC. A spool can appear more than once in
        that workbook (offered again after a rework); its PDQC
        becomes the LATEST "Prod offer" date across all of its rows.

        That latest offer date is then compared against whatever
        PDQC value the logic above already produced for the spool,
        and the LATER of the two wins - PDQC must never move
        backwards, even if the rework workbook's latest offer date
        happens to be earlier than the existing one (e.g. a stale
        rework file, or a spool that has since progressed further
        via the normal DPR fields).

        Also adds REWORK_LATEST_STATUS ("Rework Latest Status") -
        the Final Status normalized to Accept/Rework/Other (same
        normalization as src/quality/summary.py) from THAT SAME ROW,
        i.e. whichever offer event has the latest Prod Offer Date
        for that spool. This always stays paired with the latest
        date, however many times a spool has been re-offered in the
        workbook - confirmed with the project owner (2026-08-10):
        always take the status from the latest-dated row, never an
        earlier one, regardless of how many rows the spool has.

        A spool not found in the rework workbook (its Composite Key
        isn't there) keeps its existing PDQC unchanged and gets no
        REWORK_LATEST_STATUS value (stays absent/NaN).

        No-op (returns master unchanged) if the workbook wasn't
        uploaded this run - see reader.py -> read_rework(), which
        already treats a missing/unreadable file as optional, same
        as the Line History Sheet and SIOP Planned Spools workbook.
        """

        if rework is None or rework.empty:
            return master

        if REWORK_OFFER_DATE not in rework.columns:
            logger.warning(
                "Rework workbook has no usable Prod Offer Date "
                "column; skipping the PDQC override for this run."
            )
            return master

        rework = self.add_composite_key(rework)

        latest_offer_field = "Rework Latest Offer Date"

        rework_valid = rework.dropna(subset=[REWORK_OFFER_DATE])

        if rework_valid.empty:
            logger.warning(
                "Rework workbook had no usable Prod Offer Date "
                "values; skipping the PDQC override for this run."
            )
            return master

        # idxmax (not a plain groupby().max()) so the row that wins
        # for the date ALSO supplies the status for that same spool
        # - the two must always come from the same offer event, not
        # be independently maxed (a spool's highest-ever status
        # could otherwise get paired with an unrelated later date).
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

        new_pdqc = pd.Series(
            [
                later_of(existing, latest)
                for existing, latest in zip(existing_pdqc, rework_date)
            ],
            index=master.index,
        )

        matched = ~rework_date.isna()
        changed = matched & (
            existing_pdqc.isna() | (new_pdqc != existing_pdqc)
        )

        master[PDQC] = new_pdqc
        master = master.drop(columns=[latest_offer_field])

        logger.info(
            f"Rework PDQC override: {int(matched.sum())} spool(s) "
            f"matched in the rework workbook, {int(changed.sum())} "
            "PDQC date(s) updated."
        )

        return master

    # -----------------------------------------------------

    def _base_spool_no(self, row: pd.Series) -> Optional[str]:
        """
        The Packing & Dispatch workbook's own spool_no is prefixed
        with the drawing revision (its spool_ext_no), e.g.
        "1-V17565-PIND-0086-03" for drawing revision "1-". The DPR
        master dataset's Spool No does not carry that prefix. Strip
        it off before building the Composite Key so the two datasets
        match.
        """

        spool_no = row.get("spool_no")
        ext = row.get("spool_ext_no")

        if is_empty(spool_no):
            return None

        if not is_empty(ext) and str(spool_no).startswith(str(ext)):
            return str(spool_no)[len(str(ext)):]

        return spool_no

    # -----------------------------------------------------

    def apply_packing_dates(
        self,
        master: pd.DataFrame,
        packing_spools: Optional[list[dict]],
    ) -> pd.DataFrame:
        """
        Packing & Dispatch backfill (as given by the person, in
        their own words): the DPR/Weekly Production Planning
        workbooks don't track PDI, Packing, or Dispatch dates at all
        - those 3 columns come entirely from the separate Packing &
        Dispatch workbooks (data/upload/packing/), matched to this
        dataset by Composite Key (see _base_spool_no() for how the
        packing workbook's spool number is matched against this
        dataset's Spool No).

        Rule: a spool's PDI / Packing / Dispatch date is overwritten
        with the Packing & Dispatch workbook's value WHENEVER that
        value is present (non-blank) - even if this dataset already
        had a different value there, since the packing workbook is
        the current, authoritative source for these 3 fields. If the
        packing workbook's value for a field is blank, the existing
        value in this dataset is left completely untouched (not
        cleared) - a blank in a new upload must never erase data
        that's already known.

        Config: see config/business_rules.json ->
        packing_dispatch_merge.field_mapping, which maps each
        packing workbook field to the DPR master field it feeds -
        not hardcoded here.

        No-op (returns master unchanged) if the feature is disabled,
        no Packing & Dispatch workbook was uploaded this run, or none
        of its rows had a usable Composite Key.
        """

        if not self.packing_merge_enabled:
            return master

        if not packing_spools:
            return master

        packing_df = pd.DataFrame(packing_spools)

        required = {"project_code", "drawing_no", "spool_no", "spool_ext_no"}
        missing = required - set(packing_df.columns)
        if missing:
            logger.warning(
                "Packing & Dispatch data is missing expected "
                f"column(s) {sorted(missing)}; skipping the "
                "PDI/Packing/Dispatch backfill for this run."
            )
            return master

        source_fields = [
            field for field in self.packing_field_mapping
            if field in packing_df.columns
        ]
        if not source_fields:
            logger.warning(
                "None of the configured packing_dispatch_merge "
                "field_mapping source fields "
                f"{list(self.packing_field_mapping)} were found in "
                "the Packing & Dispatch data; skipping the backfill "
                "for this run."
            )
            return master

        packing_df[COMPOSITE_KEY] = packing_df.apply(
            lambda row: create_composite_key(
                row.get("project_code"),
                row.get("drawing_no"),
                self._base_spool_no(row),
            ),
            axis=1,
        )

        def _first_present(series: pd.Series):
            for value in series:
                if not is_empty(value):
                    return value
            return None

        packing_lookup = (
            packing_df.groupby(COMPOSITE_KEY)[source_fields]
            .agg(_first_present)
            .reset_index()
        )

        master = master.merge(
            packing_lookup,
            on=COMPOSITE_KEY,
            how="left",
        )

        filled_counts: dict[str, int] = {}

        for source_field in source_fields:

            target_field = self.packing_field_mapping[source_field]

            if target_field not in master.columns:
                master[target_field] = None

            has_packing_value = ~master[source_field].apply(is_empty)
            master.loc[has_packing_value, target_field] = master.loc[
                has_packing_value, source_field
            ]
            filled_counts[target_field] = int(has_packing_value.sum())

        master = master.drop(columns=source_fields)

        logger.info(
            "Packing & Dispatch backfill: "
            + ", ".join(
                f"{field}={count}" for field, count in filled_counts.items()
            )
            + " spool(s) updated from the Packing & Dispatch "
            "workbook(s)."
        )

        return master

    # -----------------------------------------------------

    def merge(
        self,
        fabrication: pd.DataFrame,
        planning_master: pd.DataFrame,
        fitup_db: pd.DataFrame,
        welding_db: pd.DataFrame,
        activity_date_field: str = "Activity Date",
        line_history: Optional[pd.DataFrame] = None,
        siop_planned: Optional[pd.DataFrame] = None,
        packing_spools: Optional[list[dict]] = None,
        rework: Optional[pd.DataFrame] = None,
    ) -> pd.DataFrame:
        """
        Build the Master Spool Dataset.

        Parameters
        ----------
        fabrication
            Cleaned DPR Detailed Sheet dataframe.

        planning_master
            Cleaned Master Planning Sheet dataframe.

        fitup_db
            Cleaned Fit-Up DB dataframe (one row per joint).

        welding_db
            Cleaned Welding DB dataframe (one row per joint).

        activity_date_field
            Name of the per-joint date column shared by fitup_db
            and welding_db (config: input_files.planning.activity_date_field).

        line_history
            Cleaned Line History Sheet dataframe (one row per
            joint), or None if it wasn't uploaded this run - see
            summarize_line_history().

        siop_planned
            Cleaned SIOP Planned Spools dataframe (one row per
            spool), or None if it wasn't uploaded this run - see
            apply_siop_fallback(). Used only to fill in Planned
            Start for spools the Weekly Production Planning
            workbook doesn't have.

        packing_spools
            Raw spool rows read from the Packing & Dispatch
            workbook(s) (packing.reader.read_all_workbooks() output,
            one dict per spool), or None/empty if none were uploaded
            this run - see apply_packing_dates(). Used to backfill
            PDI / Packing / Dispatch on the Master Spool Dataset.

        rework
            Cleaned Rework Data dataframe (one row per offer-for-
            inspection event), or None if it wasn't uploaded this
            run - see apply_rework_pdqc_override(). Used to replace
            PDQC with the latest "Prod offer" date per spool.

        Returns
        -------
        pandas.DataFrame
            One row per spool - the Master Spool Dataset.
        """

        logger.info("Merge Engine started.")

        fabrication = self.add_composite_key(fabrication)
        planning_master = self.add_composite_key(planning_master)
        fitup_db = self.add_composite_key(fitup_db)
        welding_db = self.add_composite_key(welding_db)

        first_fitup = self.summarize_first_activity(
            fitup_db,
            activity_date_field,
            self.first_fitup_field,
        )
        first_welding = self.summarize_first_activity(
            welding_db,
            activity_date_field,
            self.first_welding_field,
        )
        line_history_summary = self.summarize_line_history(line_history)

        planning_columns = [
            COMPOSITE_KEY,
            "Week",
            "Planned Start",
            "Group",
        ]
        planning_columns = [
            column for column in planning_columns
            if column in planning_master.columns
        ]

        master = fabrication.merge(
            planning_master[planning_columns],
            on=COMPOSITE_KEY,
            how="left",
        )

        master = self.apply_siop_fallback(master, siop_planned)

        master = master.merge(
            first_fitup,
            on=COMPOSITE_KEY,
            how="left",
        )

        master = master.merge(
            first_welding,
            on=COMPOSITE_KEY,
            how="left",
        )

        master = master.merge(
            line_history_summary,
            on=COMPOSITE_KEY,
            how="left",
        )

        master = self.apply_packing_dates(master, packing_spools)

        master = self.apply_welding_finish(
            master, welding_db, line_history, activity_date_field
        )

        master = self.apply_rework_pdqc_override(master, rework)

        logger.info(
            f"Merge Engine completed. {len(master)} spool(s) in "
            "Master Spool Dataset."
        )

        return master
