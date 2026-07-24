"""
business_rules.py
---------------------------------------------------------
Business Rule Engine for the Live Spool Status & Ageing System.

Responsibilities
----------------
1. Determine the Planned / Unplanned flag for each spool.
2. Determine the First Activity Date
   (earliest of the configured "unplanned spool" date fields,
   e.g. First Fit-Up / First Welding).
3. Determine the Current Stage
   (the first incomplete milestone, in configured stage order).
4. Determine the Next Stage.
5. Determine the Completed flag.
6. Determine the Status Message.

This module does NOT calculate ageing (Stage Age / Total Age).
Ageing is the responsibility of the Ageing Engine, which runs after
this module and reuses the fields produced here (Current Stage,
First Activity Date, Completed Flag).

This module does NOT contain any dashboard or presentation code.

Completed vs. Dispatch
-----------------------
Per the Master Specification, a spool is "Completed" once Packing
is done. Dispatch is tracked as a stage after Packing in the
sequence, but does NOT gate the Completed flag - a spool can be
Completed=True with Current Stage="Dispatch" if Packing is done and
Dispatch isn't yet.

Input contract
--------------
This module expects a dataframe with one row per spool, already
containing the combined fabrication + planning fields (i.e. the
output of the Merge Engine). It does not read Excel and it does not
merge data itself.

Every stage name, stage order, and status message used here comes
from configuration:

    config/stages.json
    config/business_rules.json

Nothing about the fabrication workflow is hardcoded in this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

import pandas as pd

from config_loader import load_business_rules, load_stages
from constants import (
    COMPLETED_FLAG,
    CURRENT_STAGE,
    FIRST_ACTIVITY_DATE,
    LINE_HISTORY_STAGE,
    NEXT_STAGE,
    PLANNED_FLAG,
    STATUS_MESSAGE,
)
from logger import logger
from utils import is_empty, parse_date


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


@dataclass
class StageResult:
    """
    Result of evaluating the stage-related business rules
    for a single spool.
    """

    current_stage: str
    next_stage: Optional[str]
    completed: bool
    status_message: str


class BusinessRuleEngine:
    """
    Applies configured business rules to a merged spool dataframe.
    """

    def __init__(self) -> None:

        stages_config = load_stages()
        rules_config = load_business_rules()

        self.stages: list[Stage] = sorted(
            (Stage(**stage) for stage in stages_config["stages"]),
            key=lambda stage: stage.sequence,
        )

        completed_config = rules_config["completed"]

        # The stage whose completion marks the spool as "Completed",
        # independent of whether later-tracked stages (e.g. Dispatch)
        # are done. Per the Master Specification, completion is tied
        # to Packing; Dispatch is tracked separately as a post-
        # completion logistics milestone.
        self.completion_field: str = completed_config["completion_field"]
        # See config/business_rules.json -> completed.also_completed_if_any_filled:
        # a spool with no Packing date is still counted as Completed if
        # it has already been Dispatched - it clearly was packed and
        # shipped, it's just missing that one field on the DPR.
        self.also_completed_if_any_filled: list[str] = (
            completed_config.get("also_completed_if_any_filled", [])
        )
        self.current_stage_label: str = (
            completed_config["current_stage_label"]
        )

        self.planned_start_field: str = (
            rules_config["planned_spool"]["age_start_field"]
        )
        # See config/business_rules.json -> planned_spool.also_planned_if_any_filled:
        # a spool with no Planned Start is still counted as Planned if
        # it has already been Packed and/or Dispatched - it clearly
        # was worked, it's just missing from the planning sheet.
        self.also_planned_if_any_filled: list[str] = (
            rules_config["planned_spool"].get(
                "also_planned_if_any_filled", []
            )
        )
        self.first_activity_fields: list[str] = (
            rules_config["unplanned_spool"]["first_activity_fields"]
        )
        self.status_messages: dict[str, str] = (
            rules_config["status_messages"]
        )
        self.completed_message: str = self.status_messages.get(
            self.current_stage_label,
            "Completed",
        )

        # Rule: a spool whose Production Order Release date/flag
        # (DPR column 1) is blank has not even been released to
        # production yet - it is reported as "Production Order Not
        # Released" and every other stage/status rule is skipped for
        # it. If the field is filled, all existing rules apply as
        # before.
        prod_order_release_config = rules_config.get(
            "prod_order_release", {}
        )
        self.prod_order_release_field: Optional[str] = (
            prod_order_release_config.get("field")
        )
        self.not_released_label: str = prod_order_release_config.get(
            "not_released_label",
            "Production Order Not Released",
        )
        self.not_released_message: str = self.status_messages.get(
            "Not Released",
            self.not_released_label,
        )

        # Line History Sheet override (config/business_rules.json ->
        # line_history_override) - see
        # is_stage_reached_with_line_history(). override_stage_order
        # is a rank list, e.g. ["Fit-Up", "Welding", "PDQC"]: every
        # stage EXCEPT the last one is gated by the joint-level
        # Line History Stage (when present for a spool) instead of
        # its own date field; the last entry (PDQC by default) is
        # where the override stops and the normal date-based walk
        # takes back over.
        line_history_config = rules_config.get(
            "line_history_override", {}
        )
        self.line_history_override_enabled: bool = (
            line_history_config.get("enabled", False)
        )
        override_stage_order: list[str] = line_history_config.get(
            "override_stage_order", []
        )
        self.line_history_stage_rank: dict[str, int] = {
            name: rank for rank, name in enumerate(override_stage_order)
        }

        logger.info("Business Rule Engine initialised.")

    # -----------------------------------------------------

    def apply(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """
        Apply all business rules to every row of the dataframe.

        Parameters
        ----------
        dataframe
            Merged spool dataframe. Must contain the columns
            referenced by config/stages.json and
            config/business_rules.json.

        Returns
        -------
        pandas.DataFrame
            A copy of the input dataframe with the following
            columns added:

                Planned
                First Activity Date
                Current Stage
                Next Stage
                Completed
                Status Message
        """

        logger.info("Applying business rules to master dataset.")

        dataframe = dataframe.copy()

        dataframe[PLANNED_FLAG] = dataframe.apply(
            self.determine_planned_flag,
            axis=1,
        )

        dataframe[FIRST_ACTIVITY_DATE] = dataframe.apply(
            self.determine_first_activity_date,
            axis=1,
        )

        stage_results = dataframe.apply(
            self.evaluate_row,
            axis=1,
        )

        dataframe[CURRENT_STAGE] = [
            result.current_stage for result in stage_results
        ]
        dataframe[NEXT_STAGE] = [
            result.next_stage for result in stage_results
        ]
        dataframe[COMPLETED_FLAG] = [
            result.completed for result in stage_results
        ]
        dataframe[STATUS_MESSAGE] = [
            result.status_message for result in stage_results
        ]

        logger.info(
            f"Business rules applied to {len(dataframe)} row(s)."
        )

        return dataframe

    # -----------------------------------------------------

    def determine_planned_flag(self, row: pd.Series) -> bool:
        """
        A spool is Planned if it has a value in the configured
        planned-start field (config/business_rules.json ->
        planned_spool.age_start_field).

        A spool that's missing a Planned Start is ALSO counted as
        Planned if it has already reached one of the configured
        "also planned if any filled" fields - by default Packing
        and/or Dispatch (config/business_rules.json -> planned_spool.
        also_planned_if_any_filled). Such a spool has clearly already
        been fabricated and shipped; it's simply absent from the
        planning sheet, and reporting it as "Unplanned" would
        overstate how much genuinely unplanned backlog exists.
        """

        if not is_empty(row.get(self.planned_start_field)):
            return True

        return any(
            not is_empty(row.get(field))
            for field in self.also_planned_if_any_filled
        )

    # -----------------------------------------------------

    def determine_first_activity_date(
        self,
        row: pd.Series,
    ) -> Optional[date]:
        """
        The First Activity Date is the earliest date found among
        the configured "unplanned spool" fields
        (config/business_rules.json -> unplanned_spool.first_activity_fields).

        Returns None if none of those fields have a value yet.
        """

        candidate_dates = [
            parse_date(row.get(field))
            for field in self.first_activity_fields
        ]

        candidate_dates = [
            candidate for candidate in candidate_dates
            if candidate is not None
        ]

        if not candidate_dates:
            return None

        return min(candidate_dates)

    # -----------------------------------------------------

    def is_stage_complete(self, row: pd.Series, stage: Stage) -> bool:
        """
        A stage is complete when its configured date field
        has a value.
        """

        return not is_empty(row.get(stage.date_field))

    # -----------------------------------------------------

    def is_stage_reached(self, row: pd.Series, stage_index: int) -> bool:
        """
        A stage counts as "reached" if its own date is filled, OR
        any LATER stage's date is already filled.

        Per the Master Specification's latest-stage-precedes rule:
        the most recent (highest sequence) filled date always wins.
        If, say, Dispatch has a date but Packing is still blank, the
        spool should be treated as having already passed Packing
        (and Dispatch), not as "waiting for Packing" - the later
        activity is trusted over the earlier gap.
        """

        for index in range(stage_index, len(self.stages)):
            if self.is_stage_complete(row, self.stages[index]):
                return True

        return False

    # -----------------------------------------------------

    def is_stage_reached_with_line_history(
        self,
        row: pd.Series,
        stage_index: int,
    ) -> bool:
        """
        Same contract as is_stage_reached(), but for spools where
        the Line History Sheet provided joint-level data (see
        merge.py -> summarize_line_history(), which sets the "Line
        History Stage" column to "Fit-Up", "Welding", or "PDQC"),
        the Fit-Up and Welding stages (everything ranked before the
        last entry in config/business_rules.json ->
        line_history_override.override_stage_order) get a SECOND
        vote alongside the normal date-based one - and the more
        advanced of the two wins.

        This must never be able to hold a spool back: if the DPR/
        Weekly Production data already shows real progress past a
        stage (its own date filled, or any later stage's), that
        stands even if a single joint's Weld FitUp Date or Welding
        FRun Date is missing in the Line History Sheet (a common,
        genuine data gap - e.g. a repair/re-weld joint that only got
        its run date logged, or one joint whose fit-up simply wasn't
        recorded there). The Line History Sheet can only ever ADD
        evidence that a stage is reached (catching cases where the
        DPR data hasn't been updated yet but the joint-level sheet
        shows the work is actually done) - never take evidence away.

        The last-ranked stage (PDQC, by default) is deliberately
        never gated here at all - once every joint has been fit-up
        and welded, whether the spool has progressed further is
        decided purely by the normal date-based walk over PDQC's own
        field and every stage after it (is_stage_reached()), exactly
        as before. This is also what happens for every spool whose
        Composite Key isn't in the Line History Sheet at all (or has
        no non-blank Joint No. rows there): "Line History Stage" is
        blank for them, so this falls straight through to the
        original logic, unchanged.
        """

        stage = self.stages[stage_index]

        original_reached = self.is_stage_reached(row, stage_index)

        if original_reached:
            return True

        if self.line_history_override_enabled:

            line_history_stage = row.get(LINE_HISTORY_STAGE)

            if (
                not is_empty(line_history_stage)
                and stage.name in self.line_history_stage_rank
                and line_history_stage in self.line_history_stage_rank
            ):
                last_rank = len(self.line_history_stage_rank) - 1
                stage_rank = self.line_history_stage_rank[stage.name]

                if stage_rank < last_rank:
                    return (
                        self.line_history_stage_rank[line_history_stage]
                        > stage_rank
                    )

        return False

    # -----------------------------------------------------

    def determine_completed_flag(self, row: pd.Series) -> bool:
        """
        A spool is Completed once its configured completion field
        (config/business_rules.json -> completed.completion_field,
        currently "Packing") has a value - regardless of whether
        stages tracked after it (e.g. Dispatch) are done yet.

        A spool is ALSO counted as Completed if any of the configured
        also_completed_if_any_filled fields (currently "Dispatch")
        has a value, even when Packing itself is blank - it clearly
        was packed and shipped, it's just missing that one DPR field
        (see config/business_rules.json -> completed.also_completed_if_any_filled_comment).
        This mirrors the equivalent also_planned_if_any_filled rule
        for the Planned flag.
        """

        if not is_empty(row.get(self.completion_field)):
            return True

        return any(
            not is_empty(row.get(field))
            for field in self.also_completed_if_any_filled
        )

    # -----------------------------------------------------

    def evaluate_row(self, row: pd.Series) -> StageResult:
        """
        Determine Current Stage, Next Stage, Completed flag,
        and Status Message for a single spool.

        Rule 0 - Production Order Not Released
            If the configured Prod Order Release field (DPR column
            1) is blank, the spool hasn't even been released to
            production. It is reported as "Production Order Not
            Released" and no other rule below applies. Once that
            field has a value, every rule below applies exactly as
            before.

        Rule 1 - latest stage precedes the previous one
            Current Stage is the first stage (in configured order)
            that is NOT "reached" - and a stage counts as reached if
            its own date is filled OR any LATER stage's date is
            already filled (see is_stage_reached). This means a
            spool with, say, a Dispatch date but a blank Packing
            date is correctly treated as having passed Packing (and
            being effectively Dispatched), instead of "waiting for
            Packing".

        Rule 1.5 - Line History Sheet override (Fit-Up/Welding/PDQC)
            For a spool whose Composite Key is found in the uploaded
            Line History Sheet with at least one non-blank Joint No.
            row, the Fit-Up and Welding stages above get a second,
            joint-level vote (see merge.py ->
            summarize_line_history(), is_stage_reached_with_line_
            history()) - and whichever of the two (the normal
            date-based check, or the joint-level one) shows MORE
            progress wins. This can only advance a stage, never hold
            one back: a spool already showing real progress in the
            DPR/Weekly data (e.g. a Packing or Dispatch date) is
            never pinned at an earlier stage just because one joint
            is missing a date in the Line History Sheet - a common,
            genuine gap (a repair/re-weld joint, a row that hasn't
            been updated yet, etc.), not evidence the spool actually
            regressed. PDQC onward still uses Rule 1 alone. If the
            spool isn't in the sheet (or has no non-blank Joint No.
            rows there), Rule 1 alone applies, exactly as before.

        The Completed flag is evaluated independently of the
        Current Stage walk (see determine_completed_flag): a spool
        can be Completed=True and still show Current Stage=
        "Dispatch" if Packing is done but Dispatch isn't - Dispatch
        is a tracked post-completion logistics milestone, not a
        condition for completion.
        """

        if self.prod_order_release_field and is_empty(
            row.get(self.prod_order_release_field)
        ):
            return StageResult(
                current_stage=self.not_released_label,
                next_stage=(
                    self.stages[0].display_name if self.stages else None
                ),
                completed=False,
                status_message=self.not_released_message,
            )

        completed = self.determine_completed_flag(row)

        for index, stage in enumerate(self.stages):

            if self.is_stage_reached_with_line_history(row, index):
                continue

            current_stage = stage.display_name

            next_stage = (
                self.stages[index + 1].display_name
                if index + 1 < len(self.stages)
                else None
            )

            status_message = self.status_messages.get(
                stage.name,
                f"Waiting for {stage.display_name}",
            )

            return StageResult(
                current_stage=current_stage,
                next_stage=next_stage,
                completed=completed,
                status_message=status_message,
            )

        # Every configured stage - including any tracked after the
        # completion field, such as Dispatch - is reached.
        return StageResult(
            current_stage=self.current_stage_label,
            next_stage=None,
            completed=completed,
            status_message=self.completed_message,
        )
