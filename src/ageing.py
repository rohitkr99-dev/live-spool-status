"""
ageing.py
---------------------------------------------------------
Ageing Engine for the Live Spool Status & Ageing System.

Responsibilities
----------------
1. Calculate Total Age.
2. Calculate Stage Age.

This module does NOT determine Current Stage, Completed, Planned, or
Next Stage - those come from the Business Rule Engine. This module
only calculates ages, reusing those already-computed fields.

Input contract
--------------
This module expects the output of BusinessRuleEngine.apply(): a
dataframe with one row per spool that already has Planned, Current
Stage, and Completed columns, plus the raw stage date fields
referenced by config/stages.json (First Fit-Up, First Welding, PDQC,
RFP, PDI, Packing, Dispatch), the planned start / Prod Order Release
fields referenced by config/business_rules.json.

Business rules (from the Master Specification)
------------------------------------------------
Total Age
    Anchor date (config: business_rules.json -> ageing), in priority
    order:
      1. The EARLIEST date found among total_age_anchor_fields -
         Planned Start / First Fit-Up / First Welding - whichever of
         these actually have a value (not an either/or on a Planned
         flag; all three are compared directly).
      2. If none of those are available: the first field in
         total_age_anchor_fallback_fields that has a value - PDQC,
         then Prod Order Release - a priority fallback, not another
         earliest-of.
      3. If nothing at all is available: no anchor, Total Age is 0.

    Total Age = End Date - Anchor Date, where End Date is the
    completion field's date (Packing) if the spool is packed, else
    Today - once packed, the fabrication ageing clock stops.

    Negative        : 0

Stage Age
    Today - Current Stage Start
    Negative                     : 0
    Completed                    : 0 (config: business_rules.json ->
                                    completed.stage_age_when_completed)

Current Stage Start is the date the spool entered its current
(first incomplete) stage - i.e. the date field of the PREVIOUS stage
in sequence. For the very first stage (Fit-Up), that anchor is the
Planned Start date (planned spools only; unplanned spools have no
anchor yet, so Stage Age is 0 until something happens).

Note: a spool can be Completed=True while Current Stage="Dispatch"
(see business_rules.py). Per the Master Specification, Stage Age is
0 once Completed, regardless of what Current Stage shows.

Nothing about the fabrication workflow is hardcoded in this module -
everything comes from config/stages.json and config/business_rules.json.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

import line_history_ageing
from config_loader import load_business_rules, load_stages
from constants import (
    COMPLETED_FLAG,
    CURRENT_STAGE,
    LH_WELDING_AGE,
    STAGE_AGE,
    TOTAL_AGE,
)
from logger import logger
from utils import days_between, parse_date, today


@dataclass
class Stage:
    """
    A single milestone in the fabrication workflow,
    as defined in config/stages.json.
    """

    sequence: int
    name: str
    date_field: str
    display_name: str


class AgeingEngine:
    """
    Calculates Total Age and Stage Age for a business-rules-applied
    spool dataframe.
    """

    def __init__(self) -> None:

        stages_config = load_stages()
        rules_config = load_business_rules()

        self.stages: list[Stage] = sorted(
            (Stage(**stage) for stage in stages_config["stages"]),
            key=lambda stage: stage.sequence,
        )

        self.stage_index_by_display_name: dict[str, int] = {
            stage.display_name: index
            for index, stage in enumerate(self.stages)
        }

        self.planned_start_field: str = (
            rules_config["planned_spool"]["age_start_field"]
        )

        completed_config = rules_config["completed"]
        self.current_stage_label: str = (
            completed_config["current_stage_label"]
        )
        self.stage_age_when_completed: int = (
            completed_config["stage_age_when_completed"]
        )
        self.completion_field: str = (
            completed_config["completion_field"]
        )

        ageing_config = rules_config["ageing"]
        self.calculate_stage_age_enabled: bool = (
            ageing_config["calculate_stage_age"]
        )
        self.calculate_total_age_enabled: bool = (
            ageing_config["calculate_total_age"]
        )
        self.total_age_anchor_fields: list[str] = (
            ageing_config["total_age_anchor_fields"]
        )
        self.total_age_anchor_fallback_fields: list[str] = (
            ageing_config["total_age_anchor_fallback_fields"]
        )

        logger.info("Ageing Engine initialised.")

    # -----------------------------------------------------

    def apply(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """
        Add Total Age and Stage Age columns to a business-rules-
        applied spool dataframe.
        """

        logger.info("Ageing Engine started.")

        dataframe = dataframe.copy()

        if self.calculate_total_age_enabled:
            dataframe[TOTAL_AGE] = dataframe.apply(
                self.determine_total_age,
                axis=1,
            )

        if self.calculate_stage_age_enabled:
            dataframe[STAGE_AGE] = dataframe.apply(
                self.determine_stage_age,
                axis=1,
            )

        logger.info(
            f"Ageing Engine completed for {len(dataframe)} row(s)."
        )

        return dataframe

    # -----------------------------------------------------

    def determine_total_age_anchor_date(self, row: pd.Series):
        """
        The date fabrication ageing starts counting from, in
        priority order (config: business_rules.json -> ageing):

          1. The EARLIEST date found among total_age_anchor_fields
             (Planned Start / First Fit-Up / First Welding) -
             whichever of these actually have a value. All three are
             compared directly; this is not conditioned on whether
             the spool is "Planned".
          2. If none of those are available: the first field in
             total_age_anchor_fallback_fields that has a value
             (PDQC, then Prod Order Release) - a priority fallback,
             not another earliest-of.

        Returns None if nothing at all is available yet.
        """

        return line_history_ageing.total_age_anchor_date(
            row,
            self.total_age_anchor_fields,
            self.total_age_anchor_fallback_fields,
        )

    # -----------------------------------------------------

    def determine_total_age(self, row: pd.Series) -> int:
        """
        Total Age = End Date - Anchor Date.

        Anchor Date: see determine_total_age_anchor_date().

        End Date: Packing date if the spool is packed, else Today -
        once a spool is packed, its fabrication ageing clock stops.

        Negative, or no anchor available at all: 0.
        """

        anchor = self.determine_total_age_anchor_date(row)

        packed_date = parse_date(row.get(self.completion_field))
        end_date = packed_date if packed_date is not None else today()

        return days_between(anchor, end_date)

    # -----------------------------------------------------

    def determine_stage_start_date(self, row: pd.Series):
        """
        The date the spool entered its current (first incomplete)
        stage: the date field of the previous stage in sequence, or
        Planned Start if the current stage is the first one.

        Returns None if Current Stage isn't recognised, or if the
        anchor date isn't available (e.g. an unplanned spool that
        hasn't started Fit-Up yet).
        """

        current_stage_name = row.get(CURRENT_STAGE)
        index = self.stage_index_by_display_name.get(current_stage_name)

        if index is None:
            return None

        if index == 0:
            return parse_date(row.get(self.planned_start_field))

        previous_stage = self.stages[index - 1]
        return parse_date(row.get(previous_stage.date_field))

    # -----------------------------------------------------

    def determine_stage_age(self, row: pd.Series) -> int:
        """
        Today - Current Stage Start.
        Negative : 0
        Completed: 0 (per Master Specification - Completed spools
        always show Stage Age 0, even if Current Stage still shows
        "Dispatch" pending)

        Welding Age override (per the Master Specification's
        Line-History refinement - see line_history_ageing.py): when
        a spool's Current Stage is "Welding" and the Line History
        Sheet has at least one joint with both a Weld FitUp Date and
        a Welding FRun Date, Stage Age uses that joint-level average
        instead of the plain Today-based count.

        Fit-Up and PDQC do NOT get an equivalent override here: by
        the business rules, a spool can only be currently sitting AT
        Fit-Up or PDQC while its own Fit-Up/PDQC date is still blank
        - exactly the case those two calculations need a value for
        and can never have while "current". Their Line-History
        refinement only ever changes something once the spool has
        moved past them, which is what the historical Stage Ageing
        Summary (summary.py) reports, not this live per-spool value.
        """

        if row.get(COMPLETED_FLAG):
            return self.stage_age_when_completed

        current_stage_name = row.get(CURRENT_STAGE)
        index = self.stage_index_by_display_name.get(current_stage_name)

        if index is not None and self.stages[index].name == "Welding":
            lh_welding_age = row.get(LH_WELDING_AGE)
            if lh_welding_age is not None and not pd.isna(lh_welding_age):
                return max(int(round(lh_welding_age)), 0)

        stage_start = self.determine_stage_start_date(row)

        return days_between(stage_start, today())
