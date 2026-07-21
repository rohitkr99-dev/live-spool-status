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
    PLANNED_START,
    PROJECT_CODE,
    SIOP_PLANNED_START,
    SPOOL_NO,
)
from logger import logger
from utils import create_composite_key, is_empty, parse_date


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

        Rule (as given by the person, in their own words):
            - Rows with a blank Joint No. are ignored.
            - If a spool ends up with no non-blank-Joint-No. rows at
              all (including if it isn't in the sheet at all), it is
              simply absent from the returned summary - the existing
              date-field-based Fit-Up/Welding/PDQC logic is used for
              it unchanged.
            - Otherwise: if any joint's Weld FitUp Date (AG) is
              blank -> "Fit-Up". Else if any joint's Welding FRun
              Date (AL) is blank -> "Welding". Else -> "PDQC" (i.e.
              every joint is both fit-up and welded; whether the
              spool has progressed past PDQC is then decided by the
              normal date-based walk over PDQC/RFP/PDI/Packing/
              Dispatch, unchanged).

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

        fitup_stage, welding_stage, pdqc_stage = (
            self.line_history_stage_order[:3]
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

            fitup_all_present = not fitup_values.apply(is_empty).any()
            weldrun_all_present = not weldrun_values.apply(is_empty).any()

            if not fitup_all_present:
                stage = fitup_stage
            elif not weldrun_all_present:
                stage = welding_stage
            else:
                stage = pdqc_stage

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

            # LH Welding Age: mean of (Welding FRun - Weld FitUp)
            # over joints with BOTH dates present.
            joint_durations = [
                (weld_run_date - fitup_date).days
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

    def merge(
        self,
        fabrication: pd.DataFrame,
        planning_master: pd.DataFrame,
        fitup_db: pd.DataFrame,
        welding_db: pd.DataFrame,
        activity_date_field: str = "Activity Date",
        line_history: Optional[pd.DataFrame] = None,
        siop_planned: Optional[pd.DataFrame] = None,
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

        logger.info(
            f"Merge Engine completed. {len(master)} spool(s) in "
            "Master Spool Dataset."
        )

        return master
