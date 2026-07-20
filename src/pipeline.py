"""
pipeline.py
---------------------------------------------------------
Pipeline orchestrator for the Live Spool Status & Ageing System.

Runs the full processing pipeline in order, matching the Master
Specification's architecture (section 14), with Cleaning slotted in
between Validation and Merge (Validator's own docstring: "Validates
input data before any cleaning or transformation" - so raw data is
validated first, then cleaned, then merged):

    Excel -> Reader -> Validator -> Cleaner -> Merge Engine ->
    Business Rule Engine -> Ageing Engine -> Summary Engine ->
    Processed JSON -> Dashboard (+ published copy for a hosted site,
    see write_dashboard_bundle())

This module contains no business logic of its own - it only
sequences calls to the other modules and handles pipeline-level
concerns: stopping on validation errors, and writing
validation_report.json (the one output file Summary Engine
deliberately does not produce - see src/summary.py docstring).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from ageing import AgeingEngine
from activity_metrics import ActivityMetricsEngine
from business_rules import BusinessRuleEngine
from cleaner import DataCleaner
from config_loader import load_settings
from logger import logger
from merge import MergeEngine
from reader import ExcelReader
from summary import SummaryEngine
from validator import DataValidator, ValidationResult

# Which of the 4 raw dataframes are transactional (one row per
# joint, not per spool) - used to tell both the Validator and the
# Cleaner to skip the duplicate-spool check for these sheets.
TRANSACTIONAL_DATASETS = {"planning_fitup", "planning_welding"}


class PipelineError(Exception):
    """
    Raised when the pipeline cannot continue - e.g. a source
    dataframe fails validation with errors (not just warnings).
    See validation_report.json for details.
    """


class Pipeline:
    """
    Orchestrates Reader -> Validator -> Cleaner -> Merge Engine ->
    Business Rule Engine -> Ageing Engine -> Summary Engine.
    """

    def __init__(self) -> None:

        self.settings = load_settings()

        self.reader = ExcelReader()
        self.validator = DataValidator()
        self.cleaner = DataCleaner()
        self.merge_engine = MergeEngine()
        self.business_rule_engine = BusinessRuleEngine()
        self.ageing_engine = AgeingEngine()
        self.activity_metrics_engine = ActivityMetricsEngine()
        self.summary_engine = SummaryEngine()

        logger.info("Pipeline initialised.")

    # -----------------------------------------------------

    def run(self) -> dict:
        """
        Run the full pipeline once.

        Returns
        -------
        dict
            {
                "rows_processed": int,
                "files_written": list[str],
                "validation_passed": bool,
            }

        Raises
        ------
        PipelineError
            If any source dataframe fails validation (errors, not
            just warnings). validation_report.json is still written
            before the exception is raised, so the failure reason is
            always available on disk.
        """

        logger.info("Pipeline run started.")

        # ---- Read -------------------------------------------------

        fabrication = self.reader.read_fabrication()
        planning = self.reader.read_planning()

        raw_datasets = {
            "fabrication": fabrication,
            "planning_master": planning["master_sheet"],
            "planning_fitup": planning["fitup_sheet"],
            "planning_welding": planning["welding_sheet"],
        }

        # ---- Validate (on raw data, before any cleaning) -----------

        validation_results = {
            name: self.validator.validate_dataframe(dataframe, name)
            for name, dataframe in raw_datasets.items()
        }

        validation_report_path = self.write_validation_report(
            validation_results
        )

        failed = {
            name: result
            for name, result in validation_results.items()
            if not result.passed
        }

        if failed:
            for name, result in failed.items():
                for error in result.errors:
                    logger.error(f"[{name}] {error}")
            raise PipelineError(
                "Validation failed for: " + ", ".join(failed) + ". "
                f"See {validation_report_path} for details. "
                "Pipeline stopped before cleaning/merge."
            )

        # ---- Clean --------------------------------------------------

        cleaned_datasets = {}

        for name, dataframe in raw_datasets.items():
            cleaned, _ = self.cleaner.clean_dataframe(
                dataframe,
                name,
                is_transactional=name in TRANSACTIONAL_DATASETS,
            )
            cleaned_datasets[name] = cleaned

        # ---- Line History Sheet (optional) -----------------------
        # Fit-Up/Welding/PDQC override (config/business_rules.json
        # -> line_history_override). Unlike the 4 datasets above,
        # this one is best-effort: any problem reading/cleaning it
        # only logs a warning and falls back to the existing
        # date-field-based logic for every spool - it never raises
        # PipelineError, since it's an enhancement, not a required
        # input.

        line_history_cleaned = self.read_and_clean_line_history()

        # ---- Merge -> Business Rules -> Ageing -----------------------

        master = self.merge_engine.merge(
            cleaned_datasets["fabrication"],
            cleaned_datasets["planning_master"],
            cleaned_datasets["planning_fitup"],
            cleaned_datasets["planning_welding"],
            line_history=line_history_cleaned,
        )

        with_rules = self.business_rule_engine.apply(master)
        final = self.ageing_engine.apply(with_rules)

        # ---- Summary --------------------------------------------------

        summary_outputs = self.summary_engine.generate_all(final)
        written_files = self.summary_engine.write_json_files(final)

        activity_metrics = self.activity_metrics_engine.generate(
            cleaned_datasets["planning_fitup"],
            cleaned_datasets["planning_welding"],
            cleaned_datasets["fabrication"],
        )
        activity_metrics_path = self.write_activity_metrics(
            activity_metrics
        )
        written_files.append(str(activity_metrics_path))

        written_files.append(str(validation_report_path))

        # ---- Dashboard bundle -----------------------------------------
        # Writes processed/dashboard_data.json (the file "Upload Data"
        # accepts for local previewing) and, if config/settings.json
        # -> publishing.publish_to_website is true, also publishes the
        # same bundle to website/data/dashboard_data.json - the file a
        # hosted copy of website/ (e.g. GitHub Pages) auto-loads for
        # every viewer. See write_dashboard_bundle() below.

        bundle_path = self.write_dashboard_bundle(
            summary_outputs,
            activity_metrics,
        )
        written_files.append(str(bundle_path))

        logger.info("Pipeline run completed.")

        return {
            "rows_processed": len(final),
            "files_written": written_files,
            "validation_passed": True,
        }

    # -----------------------------------------------------

    def _validation_report_path(self) -> Path:

        processed_folder = Path(
            self.settings["paths"]["processed_folder"]
        )
        filename = self.settings["output_files"]["validation_report"]

        return processed_folder / filename

    # -----------------------------------------------------

    # -----------------------------------------------------

    def read_and_clean_line_history(self):
        """
        Best-effort read + clean of the Line History Sheet. Returns
        None (never raises) if the file is missing, disabled, or
        fails to read/parse for any reason - see reader.py ->
        read_line_history() and merge.py -> summarize_line_history(),
        both of which already treat None as "use the existing
        Fit-Up/Welding/PDQC logic, unchanged".
        """

        try:
            raw = self.reader.read_line_history()
        except Exception as error:
            logger.warning(
                f"Could not read Line History Sheet ({error}). "
                "Falling back to the existing date-field-based "
                "Fit-Up/Welding/PDQC logic for every spool this run."
            )
            return None

        if raw is None:
            return None

        cleaned, _ = self.cleaner.clean_dataframe(
            raw,
            "line_history",
            is_transactional=True,
        )

        return cleaned

    # -----------------------------------------------------

    def write_activity_metrics(self, records: list) -> Path:
        """
        Serialise the day-level activity dataset (Inch Dia for
        Fit-Up/Welding, Surface Area Out for Painting) to
        activity_metrics.json, for the dashboard's dynamic
        Day/Week/Month activity charts.
        """

        processed_folder = Path(
            self.settings["paths"]["processed_folder"]
        )
        processed_folder.mkdir(parents=True, exist_ok=True)

        filename = self.settings["output_files"]["activity_metrics"]
        filepath = processed_folder / filename

        with filepath.open("w", encoding="utf-8") as file:
            json.dump(records, file, indent=2)

        logger.info(f"Wrote {filepath}")

        return filepath

    # -----------------------------------------------------

    def write_dashboard_bundle(
        self,
        summary_outputs: dict,
        activity_metrics: list,
    ) -> Path:
        """
        Combine every summary output plus activity_metrics into a
        single dashboard_data.json file (config/settings.json ->
        output_files.dashboard_bundle), written to
        processed/dashboard_data.json.

        If config/settings.json -> publishing.publish_to_website is
        true (the default), the same bundle is ALSO copied to
        paths.website_data_folder (website/data/dashboard_data.json
        by default). That copy is what a hosted copy of website/
        (e.g. GitHub Pages) auto-loads for every viewer on page load
        - see website/js/data.js -> fetchPublished(). Commit and push
        that file whenever you want everyone's dashboard to update;
        the person running this pipeline doesn't need to do anything
        beyond that push. The local "Upload Data" button still works
        independently of this, for previewing a different file
        without publishing it.
        """

        processed_folder = Path(
            self.settings["paths"]["processed_folder"]
        )
        processed_folder.mkdir(parents=True, exist_ok=True)

        filename = self.settings["output_files"]["dashboard_bundle"]
        filepath = processed_folder / filename

        bundle = {
            "generated_at": datetime.now().isoformat(),
            "master_spools": summary_outputs["master_spools"],
            "dashboard_summary": summary_outputs["dashboard_summary"],
            "project_summary": summary_outputs["project_summary"],
            "weekly_summary": summary_outputs["weekly_summary"],
            "group_summary": summary_outputs["group_summary"],
            "stage_ageing_summary": summary_outputs["stage_ageing_summary"],
            "exceptions": summary_outputs["exceptions"],
            "activity_metrics": activity_metrics,
        }

        serialised = json.dumps(bundle, indent=2, default=str)

        with filepath.open("w", encoding="utf-8") as file:
            file.write(serialised)

        logger.info(f"Wrote {filepath}")

        publishing_config = self.settings.get("publishing", {})

        if publishing_config.get("publish_to_website", False):

            website_data_folder = Path(
                self.settings["paths"]["website_data_folder"]
            )
            website_data_folder.mkdir(parents=True, exist_ok=True)

            published_path = website_data_folder / filename

            with published_path.open("w", encoding="utf-8") as file:
                file.write(serialised)

            logger.info(f"Published {published_path}")

        return filepath

    # -----------------------------------------------------

    def write_validation_report(
        self,
        validation_results: dict[str, ValidationResult],
    ) -> Path:
        """
        Serialise every dataset's ValidationResult into
        validation_report.json. Written regardless of pass/fail, so
        the failure reason is always available on disk.
        """

        processed_folder = Path(
            self.settings["paths"]["processed_folder"]
        )
        processed_folder.mkdir(parents=True, exist_ok=True)

        report = {
            "generated_at": datetime.now().isoformat(),
            "overall_passed": all(
                result.passed for result in validation_results.values()
            ),
            "datasets": {
                name: {
                    "passed": result.passed,
                    "errors": result.errors,
                    "warnings": result.warnings,
                }
                for name, result in validation_results.items()
            },
        }

        filepath = self._validation_report_path()

        with filepath.open("w", encoding="utf-8") as file:
            json.dump(report, file, indent=2)

        logger.info(f"Wrote {filepath}")

        return filepath
