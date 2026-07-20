"""
summary.py
---------------------------------------------------------
Summary Engine for the Live Spool Status & Ageing System.

Responsibilities
----------------
Turns the final per-spool dataframe (the output of Reader -> Merge ->
Business Rules -> Ageing) into the JSON files the dashboard reads.

Per the Master Specification's Rule 2 and Rule 3, the dashboard never
calculates anything and only reads JSON - every number the dashboard
displays must already exist in one of these files. This module does
not introduce new *stage/ageing* business rules; the two derived
fields it does add (Delay, Last Activity) are plain reporting
aggregates, not new fabrication-workflow logic.

Produces (config/settings.json -> output_files):
    master_spools.json       - one record per spool
    dashboard_summary.json   - top-level KPIs + stage distribution
    project_summary.json     - per-project rollup
    weekly_summary.json      - per-week rollup
    group_summary.json       - per-group rollup
    stage_ageing_summary.json - per-project, per-stage dwell time
                                 (average + bucketed distribution)
    fitup_summary.json       - fit-up progress by week
    welding_summary.json     - welding progress by week
    exceptions.json          - data-quality anomalies for review

validation_report.json is NOT produced here - it is the Validator's
own output and is written directly by the pipeline orchestrator.

Two fields are not defined anywhere in the Master Specification's
business rules sections, despite being listed as Master Spool Dataset
fields / dashboard KPIs. This module defines them as follows:

    Planning Variance
        How far a spool's actual fabrication start drifted from its
        planned start, in days. Computed as (Reference Date -
        Planned Start), where Reference Date is the earliest
        available of, in order:

            1. First Activity Date (earliest of First Fit-Up /
               First Welding - see business_rules.py)
            2. PDQC date
            3. Today (if fabrication hasn't visibly started yet,
               this shows how far behind plan the spool already is)

        Only computed for spools that have a Planned Start date -
        None otherwise, since there is nothing to compare against.
        Positive = behind plan, negative = ahead of plan.

    Planning Variance (dashboard KPI)
        Average Planning Variance across every spool where it could
        be computed (i.e. every spool with a Planned Start date).

    Completion Date (not a business rule - a reporting convenience)
        The Packing date, i.e. when the spool was actually packed.
        Blank/None if the spool has not been packed yet. Packing is
        the Master Specification's completion field (see
        business_rules.py / config/business_rules.json ->
        completed.completion_field), so this is simply that date
        surfaced under a friendlier name for the dashboard.

    Last Activity (not a business rule - a reporting convenience)
        The most recent date among all filled stage date fields for
        a spool - i.e. "the last thing that actually happened".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

import line_history_ageing
from config_loader import load_business_rules, load_settings, load_stages
from constants import (
    COMPLETED_FLAG,
    COMPLETION_DATE,
    COMPOSITE_KEY,
    CURRENT_STAGE,
    DRAWING_NO,
    FIRST_ACTIVITY_DATE,
    GROUP,
    LAST_ACTIVITY_DATE,
    NEXT_STAGE,
    PACKING,
    PDQC,
    PLANNED_FLAG,
    PLANNED_START,
    PLANNING_VARIANCE,
    PROJECT_CODE,
    REMARKS,
    SPOOL_NO,
    STAGE_AGE,
    STATUS_MESSAGE,
    TOTAL_AGE,
    TOTAL_JOINTS,
    WEEK,
)
from logger import logger
from utils import (
    dataframe_to_json_records,
    is_empty,
    parse_date,
    to_json_safe,
    today,
)

UNASSIGNED = "Unassigned"

# Age buckets for the ageing-distribution style summaries - mirrors
# website/js/config.js -> SPOOL_STATUS_CONFIG.ageingBuckets exactly
# (same boundaries and labels), so the two stay visually consistent.
AGEING_BUCKETS: list[tuple[int, "int | None", str]] = [
    (0, 7, "0\u20137d"),
    (8, 14, "8\u201314d"),
    (15, 30, "15\u201330d"),
    (31, 60, "31\u201360d"),
    (61, None, "60d+"),
]


def _ageing_bucket(days: float) -> str:
    """Which AGEING_BUCKETS bracket a day count falls into."""

    for low, high, label in AGEING_BUCKETS:
        if days >= low and (high is None or days <= high):
            return label

    return AGEING_BUCKETS[-1][2]


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


def _week_sort_key(week_label: str):
    """
    Sort "Week 1", "Week 2", ... "Week 14" numerically instead of
    alphabetically (which would put "Week 14" before "Week 2").
    Unassigned always sorts last.
    """

    if week_label == UNASSIGNED:
        return (1, 0, week_label)

    match = re.search(r"\d+", str(week_label))

    if match:
        return (0, int(match.group()), week_label)

    return (0, float("inf"), week_label)


class SummaryEngine:
    """
    Aggregates the final per-spool dataframe into dashboard-ready
    JSON structures.
    """

    def __init__(self) -> None:

        stages_config = load_stages()
        self.settings = load_settings()
        rules_config = load_business_rules()

        self.stages: list[Stage] = sorted(
            (Stage(**stage) for stage in stages_config["stages"]),
            key=lambda stage: stage.sequence,
        )

        self.stage_date_fields: list[str] = [
            stage.date_field for stage in self.stages
        ]

        self.stage_display_order: list[str] = [
            stage.display_name for stage in self.stages
        ]

        self.not_released_label: str = (
            rules_config["prod_order_release"]["not_released_label"]
        )
        self.prod_order_release_field: str = (
            rules_config["prod_order_release"]["field"]
        )

        # Needed for the Fit-Up/Welding/PDQC Line-History-aware age
        # calculations in generate_stage_ageing_summary() - see
        # line_history_ageing.py.
        self.planned_start_field: str = (
            rules_config["planned_spool"]["age_start_field"]
        )
        ageing_config = rules_config["ageing"]
        self.total_age_anchor_fields: list[str] = (
            ageing_config["total_age_anchor_fields"]
        )
        self.total_age_anchor_fallback_fields: list[str] = (
            ageing_config["total_age_anchor_fallback_fields"]
        )
        self.negative_age_value: int = ageing_config["negative_age_value"]

        logger.info("Summary Engine initialised.")

    # -----------------------------------------------------
    # Enrichment (reporting-only derived fields)
    # -----------------------------------------------------

    def determine_planning_variance(self, row: pd.Series):
        """
        Planning Variance = Reference Date - Planned Start, in days.

        Reference Date is the earliest available of:
            1. First Activity Date (First Fit-Up / First Welding)
            2. PDQC date
            3. Today

        None if there is no Planned Start date to compare against.
        Positive = behind plan, negative = ahead of plan.
        """

        planned_start = parse_date(row.get(PLANNED_START))

        if planned_start is None:
            return None

        reference_date = parse_date(row.get(FIRST_ACTIVITY_DATE))

        if reference_date is None:
            reference_date = parse_date(row.get(PDQC))

        if reference_date is None:
            reference_date = today()

        return (reference_date - planned_start).days

    # -----------------------------------------------------

    def determine_completion_date(self, row: pd.Series):
        """
        Completion Date = the Packing date (the Master
        Specification's completion field). None/blank if the spool
        hasn't been packed yet.
        """

        return parse_date(row.get(PACKING))

    # -----------------------------------------------------

    def determine_last_activity(self, row: pd.Series):
        """
        The most recent date among all filled stage date fields.
        """

        dates = [
            parse_date(row.get(field))
            for field in self.stage_date_fields
        ]

        dates = [candidate for candidate in dates if candidate is not None]

        if not dates:
            return None

        return max(dates)

    # -----------------------------------------------------

    def enrich(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """
        Add Planning Variance, Completion Date and Last Activity to
        the dataframe. These are reporting aggregates, not
        fabrication-workflow business rules - see module docstring.
        """

        dataframe = dataframe.copy()

        dataframe[PLANNING_VARIANCE] = dataframe.apply(
            self.determine_planning_variance,
            axis=1,
        )
        dataframe[COMPLETION_DATE] = dataframe.apply(
            self.determine_completion_date,
            axis=1,
        )
        dataframe[LAST_ACTIVITY_DATE] = dataframe.apply(
            self.determine_last_activity,
            axis=1,
        )

        return dataframe

    # -----------------------------------------------------
    # master_spools.json
    # -----------------------------------------------------

    def generate_master_spools(self, dataframe: pd.DataFrame) -> list[dict]:
        """
        One curated record per spool, matching the Master Spool
        Dataset field list (Master Spec section 9).
        """

        columns = (
            [COMPOSITE_KEY, PROJECT_CODE, DRAWING_NO, SPOOL_NO,
             WEEK, GROUP, PLANNED_START, COMPLETION_DATE, TOTAL_JOINTS]
            + self.stage_date_fields
            + [FIRST_ACTIVITY_DATE, LAST_ACTIVITY_DATE,
               CURRENT_STAGE, NEXT_STAGE, STAGE_AGE, TOTAL_AGE,
               COMPLETED_FLAG, PLANNED_FLAG, PLANNING_VARIANCE,
               STATUS_MESSAGE, REMARKS]
        )

        # Material may already be present under its canonical name.
        if "Material" in dataframe.columns:
            columns.insert(9, "Material")

        # Newly-tracked per-spool fields: only added if the source
        # workbook actually provided them, so this stays safe to run
        # against older data without these columns.
        for optional_field in (
            "Prod Order Release", "Inch Dia", "Surface Area Out",
            "Total Wt.", "Line History Stage",
        ):
            if optional_field in dataframe.columns:
                columns.append(optional_field)

        return dataframe_to_json_records(dataframe, columns)

    # -----------------------------------------------------
    # dashboard_summary.json
    # -----------------------------------------------------

    def generate_dashboard_summary(self, dataframe: pd.DataFrame) -> dict:

        total_spools = len(dataframe)
        planned = int(dataframe[PLANNED_FLAG].sum())
        completed = int(dataframe[COMPLETED_FLAG].sum())

        # Average Age and Oldest Spool exclude spools whose
        # Production Order hasn't even been released yet (Current
        # Stage == "Production Order Not Released"). Those spools
        # have no anchor date at all yet, so Total Age is always 0
        # for them - including them here would drag the average down
        # and understate how old the spools actually in progress
        # really are. Every OTHER KPI/breakdown below still covers
        # every spool, released or not.
        ageable = dataframe[
            dataframe[CURRENT_STAGE] != self.not_released_label
        ]

        average_total_age = (
            round(ageable[TOTAL_AGE].mean(), 1) if len(ageable) else 0
        )

        oldest_spool = None
        if len(ageable):
            oldest_row = ageable.loc[ageable[TOTAL_AGE].idxmax()]
            oldest_spool = {
                "composite_key": to_json_safe(oldest_row.get(COMPOSITE_KEY)),
                "project_code": to_json_safe(oldest_row.get(PROJECT_CODE)),
                "drawing_no": to_json_safe(oldest_row.get(DRAWING_NO)),
                "spool_no": to_json_safe(oldest_row.get(SPOOL_NO)),
                "total_age": to_json_safe(oldest_row.get(TOTAL_AGE)),
                "current_stage": to_json_safe(oldest_row.get(CURRENT_STAGE)),
            }

        variances = dataframe[PLANNING_VARIANCE].dropna()
        planning_variance_days = (
            round(variances.mean(), 1) if len(variances) else None
        )

        stage_counts = (
            dataframe[CURRENT_STAGE]
            .value_counts()
            .to_dict()
        )
        ordered_stage_names = self.stage_display_order + [
            name for name in stage_counts
            if name not in self.stage_display_order
        ]
        current_stage_distribution = {
            name: int(stage_counts.get(name, 0))
            for name in ordered_stage_names
        }

        return {
            "generated_at": datetime.now().isoformat(),
            "kpis": {
                "total_spools": total_spools,
                "planned": planned,
                "unplanned": total_spools - planned,
                "completed": completed,
                "average_total_age_days": average_total_age,
                "oldest_spool": oldest_spool,
                "planning_variance_days": planning_variance_days,
            },
            "current_stage_distribution": current_stage_distribution,
        }

    # -----------------------------------------------------
    # Grouped summaries (project / weekly)
    # -----------------------------------------------------

    def _group_summary(
        self,
        dataframe: pd.DataFrame,
        group_field: str,
    ) -> list[dict]:
        """
        Shared rollup logic for project_summary.json and
        weekly_summary.json: total / planned / unplanned / completed
        / average age / current-stage breakdown, per group value.
        """

        working = dataframe.copy()
        working[group_field] = (
            working[group_field].fillna(UNASSIGNED)
        )
        if working[group_field].dtype == object:
            working[group_field] = working[group_field].replace(
                "", UNASSIGNED,
            )

        records = []

        for group_value, group_df in working.groupby(group_field):

            total = len(group_df)
            planned = int(group_df[PLANNED_FLAG].sum())
            completed = int(group_df[COMPLETED_FLAG].sum())

            stage_counts = (
                group_df[CURRENT_STAGE].value_counts().to_dict()
            )
            ordered_stage_names = self.stage_display_order + [
                name for name in stage_counts
                if name not in self.stage_display_order
            ]
            current_stage_breakdown = {
                name: int(stage_counts.get(name, 0))
                for name in ordered_stage_names
                if stage_counts.get(name, 0) > 0
            }

            records.append({
                group_field: group_value,
                "total_spools": total,
                "planned": planned,
                "unplanned": total - planned,
                "completed": completed,
                "average_total_age_days": (
                    round(group_df[TOTAL_AGE].mean(), 1)
                    if total else 0
                ),
                "current_stage_breakdown": current_stage_breakdown,
            })

        return records

    # -----------------------------------------------------

    def generate_project_summary(self, dataframe: pd.DataFrame) -> list[dict]:

        records = self._group_summary(dataframe, PROJECT_CODE)

        return sorted(records, key=lambda record: record[PROJECT_CODE])

    # -----------------------------------------------------

    def generate_weekly_summary(self, dataframe: pd.DataFrame) -> list[dict]:

        records = self._group_summary(dataframe, WEEK)

        return sorted(
            records,
            key=lambda record: _week_sort_key(record[WEEK]),
        )

    # -----------------------------------------------------

    def generate_group_summary(self, dataframe: pd.DataFrame) -> list[dict]:
        """
        Rollup by fabrication Group (Master Planning Sheet's
        "Alloted Group" field) - the closest real-data equivalent to
        the Master Spec's "Department Progress" dashboard chart.
        """

        records = self._group_summary(dataframe, GROUP)

        return sorted(records, key=lambda record: str(record[GROUP]))

    # -----------------------------------------------------
    # stage_ageing_summary.json
    # -----------------------------------------------------

    def _stage_dwell_age(
        self,
        row: pd.Series,
        stage_index: int,
    ):
        """
        Raw (possibly negative) day count for a single spool having
        completed one configured stage (Fit-Up through Packing), or
        None if it can't be computed for this spool.

        Fit-Up, Welding, and PDQC use the Line-History-aware
        calculations from line_history_ageing.py, per the Master
        Specification's refinement (given by the person, in their
        own words - see that module's docstring). Every other stage
        uses the plain gap between ITS OWN date and the PREVIOUS
        stage's date - i.e. the time actually spent arriving at
        this stage, not the time spent leaving it for the next one.
        This mirrors exactly how ageing.py's real-time Stage Age is
        defined (Today - previous stage's date), so the historical
        and live numbers can never drift apart on what "time at
        stage X" means.
        """

        stage = self.stages[stage_index]

        if stage.name == "Fit-Up":
            return line_history_ageing.fitup_age(
                row, self.planned_start_field
            )

        if stage.name == "Welding":
            return line_history_ageing.welding_age(row)

        if stage.name == "PDQC":
            return line_history_ageing.pdqc_age(
                row,
                self.total_age_anchor_fields,
                self.total_age_anchor_fallback_fields,
            )

        previous_stage = self.stages[stage_index - 1]
        start = parse_date(row.get(previous_stage.date_field))
        end = parse_date(row.get(stage.date_field))

        if start is None or end is None:
            return None

        return (end - start).days

    # -----------------------------------------------------

    def generate_stage_ageing_summary(
        self, dataframe: pd.DataFrame
    ) -> list[dict]:
        """
        How many days spools typically spend AT each stage, per
        project - the gap between the PREVIOUS stage's date and a
        stage's OWN date (i.e. how long it took to arrive at this
        stage, not how long the spool then took to reach the next
        one). This is NOT Stage Age (which only tracks time in the
        spool's CURRENT stage) - it is a historical dwell time,
        computed for every stage transition a spool has actually
        completed, so a fully Dispatched spool contributes its full
        stage-by-stage history, not just its (now zero) Stage Age.

        Fit-Up, Welding, and PDQC use the Line-History-aware
        calculations in line_history_ageing.py instead of the plain
        date gap - see _stage_dwell_age() above and that module's
        docstring for the exact rule.

        Every spool is included regardless of Completed status - a
        finished spool's per-stage dwell time is exactly what this
        answers. A spool IS excluded from every stage's numbers here
        if it has no Prod Order Release date at all - an unreleased
        spool's dates are not meaningful production history yet.

        One record per (Project Code, Stage) with at least one spool
        whose dwell time at that stage could be computed:

            spool_count    - how many spools' transitions this covers
            average_days   - mean dwell time, in days
            bucket_counts  - dwell time of those spools bucketed per
                              AGEING_BUCKETS (0-7d / 8-14d / etc.)

        Dispatch is not included, since - like Fit-Up needing a
        Planned Start anchor instead of a "previous stage" date -
        it would need its own special-cased anchor the person hasn't
        specified; only Fit-Up through Packing (the current 7-stage
        configuration in config/stages.json, minus Dispatch) are
        reported, matching what the dashboard already displays.

        A transition with a negative gap (a later date earlier than
        the one before it) is a data-entry anomaly - see
        generate_exceptions() - and is clamped to
        config/business_rules.json's ageing.negative_age_value
        (currently 0) rather than skewing the average with a
        negative day count. A spool that hasn't reached a stage at
        all (no date to compute from, on either the Line-History
        path or its fallback) is excluded from that stage's numbers
        rather than counted as 0, since there is nothing to clamp.
        """

        working = dataframe.copy()
        working[PROJECT_CODE] = working[PROJECT_CODE].fillna(UNASSIGNED)

        if (
            self.prod_order_release_field
            and self.prod_order_release_field in working.columns
        ):
            working = working[
                ~working[self.prod_order_release_field].apply(is_empty)
            ]

        records = []

        for index in range(len(self.stages) - 1):

            stage = self.stages[index]

            ages = working.apply(
                lambda row, stage_index=index: self._stage_dwell_age(
                    row, stage_index
                ),
                axis=1,
            )

            stage_frame = pd.DataFrame({
                PROJECT_CODE: working[PROJECT_CODE],
                "_days": pd.to_numeric(ages, errors="coerce"),
            })
            stage_frame = stage_frame[stage_frame["_days"].notna()]
            stage_frame["_days"] = stage_frame["_days"].clip(
                lower=self.negative_age_value
            )

            if stage_frame.empty:
                continue

            for project_code, project_df in stage_frame.groupby(
                PROJECT_CODE
            ):

                bucket_counts = {
                    label: 0 for _, _, label in AGEING_BUCKETS
                }
                for days in project_df["_days"]:
                    bucket_counts[_ageing_bucket(days)] += 1

                records.append({
                    PROJECT_CODE: project_code,
                    "Stage": stage.display_name,
                    "spool_count": int(len(project_df)),
                    "average_days": round(
                        float(project_df["_days"].mean()), 1
                    ),
                    "bucket_counts": bucket_counts,
                })

        stage_rank = {
            stage.display_name: stage.sequence for stage in self.stages
        }

        return sorted(
            records,
            key=lambda record: (
                str(record[PROJECT_CODE]),
                stage_rank.get(record["Stage"], 999),
            ),
        )

    # -----------------------------------------------------
    # fitup_summary.json / welding_summary.json
    # -----------------------------------------------------

    def _activity_progress_summary(
        self,
        dataframe: pd.DataFrame,
        activity_field: str,
    ) -> list[dict]:
        """
        Per-week progress for a single stage field (First Fit-Up or
        First Welding): how many spools scheduled for that week have
        reached this milestone.
        """

        working = dataframe.copy()
        working[WEEK] = working[WEEK].fillna(UNASSIGNED)
        if working[WEEK].dtype == object:
            working[WEEK] = working[WEEK].replace("", UNASSIGNED)

        records = []

        for week_value, week_df in working.groupby(WEEK):

            total = len(week_df)
            done = int(week_df[activity_field].notna().sum())

            records.append({
                WEEK: week_value,
                "total_spools": total,
                "done": done,
                "pending": total - done,
                "completion_pct": (
                    round((done / total) * 100, 1) if total else 0
                ),
            })

        return sorted(records, key=lambda record: _week_sort_key(record[WEEK]))

    # -----------------------------------------------------

    def generate_fitup_summary(self, dataframe: pd.DataFrame) -> list[dict]:

        first_fitup_field = self.stages[0].date_field
        return self._activity_progress_summary(dataframe, first_fitup_field)

    # -----------------------------------------------------

    def generate_welding_summary(self, dataframe: pd.DataFrame) -> list[dict]:

        first_welding_field = self.stages[1].date_field
        return self._activity_progress_summary(dataframe, first_welding_field)

    # -----------------------------------------------------
    # exceptions.json
    # -----------------------------------------------------

    def _out_of_order_stages(self, row: pd.Series) -> list[str]:
        """
        Stages that are filled in even though an EARLIER stage
        (Current Stage) is still blank - a data-quality anomaly
        worth a human look, not something the Business Rule Engine
        should silently paper over.
        """

        current_stage_name = row.get(CURRENT_STAGE)

        try:
            current_index = self.stage_display_order.index(
                current_stage_name
            )
        except ValueError:
            return []

        out_of_order = []

        for stage in self.stages[current_index + 1:]:
            if parse_date(row.get(stage.date_field)) is not None:
                out_of_order.append(stage.display_name)

        return out_of_order

    # -----------------------------------------------------

    def generate_exceptions(self, dataframe: pd.DataFrame) -> list[dict]:

        exceptions = []

        for _, row in dataframe.iterrows():

            out_of_order = self._out_of_order_stages(row)

            if not out_of_order:
                continue

            exceptions.append({
                "composite_key": to_json_safe(row.get(COMPOSITE_KEY)),
                "project_code": to_json_safe(row.get(PROJECT_CODE)),
                "drawing_no": to_json_safe(row.get(DRAWING_NO)),
                "spool_no": to_json_safe(row.get(SPOOL_NO)),
                "current_stage": to_json_safe(row.get(CURRENT_STAGE)),
                "type": "out_of_order_stage_dates",
                "detail": (
                    f"Current Stage is '{row.get(CURRENT_STAGE)}' "
                    "but later stage(s) already have dates: "
                    + ", ".join(out_of_order)
                ),
                "affected_stages": out_of_order,
            })

        return exceptions

    # -----------------------------------------------------
    # Orchestration
    # -----------------------------------------------------

    def generate_all(self, dataframe: pd.DataFrame) -> dict[str, object]:
        """
        Run every summary and return a dict keyed the same way as
        config/settings.json -> output_files, ready to be written to
        disk by write_json_files() or a pipeline orchestrator.
        """

        logger.info("Summary Engine started.")

        enriched = self.enrich(dataframe)

        outputs = {
            "master_spools": self.generate_master_spools(enriched),
            "dashboard_summary": self.generate_dashboard_summary(enriched),
            "project_summary": self.generate_project_summary(enriched),
            "weekly_summary": self.generate_weekly_summary(enriched),
            "group_summary": self.generate_group_summary(enriched),
            "stage_ageing_summary": self.generate_stage_ageing_summary(
                enriched
            ),
            "fitup_summary": self.generate_fitup_summary(enriched),
            "welding_summary": self.generate_welding_summary(enriched),
            "exceptions": self.generate_exceptions(enriched),
        }

        logger.info("Summary Engine completed.")

        return outputs

    # -----------------------------------------------------

    def write_json_files(self, dataframe: pd.DataFrame) -> list[str]:
        """
        Generate every summary and write each one to the configured
        processed folder (config/settings.json -> paths.processed_folder
        / output_files). Returns the list of file paths written.
        """

        import json
        from pathlib import Path

        outputs = self.generate_all(dataframe)

        processed_folder = Path(
            self.settings["paths"]["processed_folder"]
        )
        processed_folder.mkdir(parents=True, exist_ok=True)

        output_files = self.settings["output_files"]

        written = []

        for key, data in outputs.items():

            filename = output_files.get(key)

            if filename is None:
                logger.warning(
                    f"No output filename configured for '{key}'; skipping."
                )
                continue

            filepath = processed_folder / filename

            with filepath.open("w", encoding="utf-8") as file:
                json.dump(data, file, indent=2, default=str)

            logger.info(f"Wrote {filepath}")

            written.append(str(filepath))

        return written
