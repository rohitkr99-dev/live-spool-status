"""
activity_metrics.py
---------------------------------------------------------
Activity Metrics Engine for the Live Spool Status & Ageing System.

Responsibilities
----------------
Builds the day-level dataset behind the dashboard's dynamic activity
charts:

    Last Week Fit-Up DB      - Inch Dia, by day, from Fit-Up DB
    Last Week Welding DB     - Inch Dia, by day, from Welding DB
    Last Week Painting       - Surface Area Out, by day, from the
                                DPR fabrication sheet (grouped by PDI
                                / Painting date)

Since 2026-10-16 every record is one day FOR ONE PROJECT
(project_code), so the Projects page's global project filter can show a
single project's activity; the page sums records per bucket, so the
all-projects view is unchanged.

Each day is also tagged with its fiscal week number/label (Week 1 =
30 March, per utils.fiscal_week_info) and calendar month, so the
dashboard can group the same underlying daily numbers by Day, Week,
or Month without recalculating anything - it only re-sums numbers
that are already final.

This module does not read Excel and does not apply fabrication
business rules; it only aggregates already-cleaned per-joint /
per-spool dataframes into a day-level rollup.

Column assumptions (adjust config/column_mapping.json if the source
workbooks use different headers):

    Fit-Up DB / Welding DB : "Activity Date", "Inch Dia"
    DPR fabrication sheet  : "PDI" (Painting date), "Surface Area Out"
"""

from __future__ import annotations

import pandas as pd

from constants import PDI, PROJECT_CODE
from logger import logger
from utils import fiscal_week_info, parse_date, to_json_safe

ACTIVITY_DATE_FIELD = "Activity Date"
INCH_DIA_FIELD = "Inch Dia"
SURFACE_AREA_OUT_FIELD = "Surface Area Out"


class ActivityMetricsEngine:
    """
    Aggregates Fit-Up DB / Welding DB / fabrication (Painting) data
    into a single day-level activity dataset.
    """

    def __init__(self) -> None:
        logger.info("Activity Metrics Engine initialised.")

    # -----------------------------------------------------

    def _daily_sum(
        self,
        dataframe: pd.DataFrame,
        date_field: str,
        value_field: str,
    ) -> dict:
        """
        Sum value_field per calendar day and project (date_field,
        Project Code), skipping rows where either field is missing.
        Returns {(date, project_code): total}; a row with no Project Code
        is kept under "" so the all-projects total still includes it.
        """

        if date_field not in dataframe.columns:
            logger.warning(
                f"'{date_field}' column not found; "
                f"skipping activity rollup for '{value_field}'."
            )
            return {}

        if value_field not in dataframe.columns:
            logger.warning(
                f"'{value_field}' column not found; "
                "activity rollup will report zero for this metric. "
                "Check config/column_mapping.json."
            )
            return {}

        working = dataframe[[date_field, value_field]].copy()
        if PROJECT_CODE in dataframe.columns:
            working["_project"] = dataframe[PROJECT_CODE].fillna("").astype(str).str.strip()
        else:
            working["_project"] = ""
        working["_date"] = working[date_field].apply(parse_date)
        working["_value"] = pd.to_numeric(
            working[value_field], errors="coerce"
        )

        working = working.dropna(subset=["_date", "_value"])

        if working.empty:
            return {}

        totals = working.groupby(["_date", "_project"])["_value"].sum()

        return {key: float(total) for key, total in totals.items()}

    # -----------------------------------------------------

    def generate(
        self,
        fitup_db: pd.DataFrame,
        welding_db: pd.DataFrame,
        fabrication: pd.DataFrame,
    ) -> list[dict]:
        """
        Build the day-level activity dataset.

        Parameters
        ----------
        fitup_db
            Cleaned Fit-Up DB dataframe (one row per joint), with
            Activity Date and Inch Dia columns.

        welding_db
            Cleaned Welding DB dataframe (one row per joint), with
            Activity Date and Inch Dia columns.

        fabrication
            Cleaned DPR fabrication dataframe, with PDI (Painting)
            date and Surface Area Out columns.

        Returns
        -------
        list[dict]
            One record per calendar day and project that has at least
            one of the three metrics, sorted by date, each tagged with
            its fiscal week and month.
        """

        logger.info("Activity Metrics Engine started.")

        fitup_totals = self._daily_sum(
            fitup_db, ACTIVITY_DATE_FIELD, INCH_DIA_FIELD
        )
        welding_totals = self._daily_sum(
            welding_db, ACTIVITY_DATE_FIELD, INCH_DIA_FIELD
        )
        painting_totals = self._daily_sum(
            fabrication, PDI, SURFACE_AREA_OUT_FIELD
        )

        all_keys = sorted(
            set(fitup_totals) | set(welding_totals) | set(painting_totals)
        )

        records = []

        for key in all_keys:

            day, project_code = key
            week_info = fiscal_week_info(day)

            records.append({
                "date": to_json_safe(day),
                "project_code": project_code,
                "week_number": week_info["week_number"],
                "week_label": week_info["week_label"],
                "week_start": to_json_safe(week_info["week_start"]),
                "month_label": day.strftime("%b %Y"),
                "fitup_inch_dia": round(fitup_totals.get(key, 0.0), 2),
                "welding_inch_dia": round(welding_totals.get(key, 0.0), 2),
                "painting_surface_area_out": round(
                    painting_totals.get(key, 0.0), 2
                ),
            })

        logger.info(
            f"Activity Metrics Engine completed. {len(records)} "
            "day/project record(s) with activity data."
        )

        return records
