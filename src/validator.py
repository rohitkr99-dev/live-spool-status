"""
validator.py
---------------------------------------------------------
Validates input data before any cleaning or transformation.

Responsibilities
----------------
1. Validate dataframe is not empty.
2. Validate required columns exist.
3. Validate duplicate column names.
4. Validate duplicate spool records.
5. Validate mandatory values.
6. Validate configured date fields.
7. Generate validation report.

The validator NEVER modifies the dataframe.
It only reports errors and warnings.

Recognised dataset identifiers
-------------------------------
fabrication         DPR Detailed Sheet - one row per spool.
planning_master     Master Planning Sheet - one row per spool.
planning_fitup      Fit-Up DB - TRANSACTIONAL, one row per joint.
                    Repeated composite keys are expected here, so
                    the duplicate-spool check is skipped.
planning_welding    Welding DB - TRANSACTIONAL, same as above.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from config_loader import load_schema, load_stages
from logger import logger

# Which schema.json required-columns list applies to each dataset,
# and whether repeated composite keys are expected (transactional
# sheets - one row per joint, not per spool).
DATASET_CONFIG = {
    "fabrication": {
        "required_columns_path": ("fabrication", "required_columns"),
        "is_transactional": False,
    },
    "planning_master": {
        "required_columns_path": (
            "planning", "master_planning_required_columns"
        ),
        "is_transactional": False,
    },
    "planning_fitup": {
        "required_columns_path": ("planning", "fitup_required_columns"),
        "is_transactional": True,
    },
    "planning_welding": {
        "required_columns_path": ("planning", "welding_required_columns"),
        "is_transactional": True,
    },
}


@dataclass
class ValidationResult:
    """
    Stores validation outcome.
    """

    passed: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_error(self, message: str) -> None:
        self.errors.append(message)
        self.passed = False

    def add_warning(self, message: str) -> None:
        self.warnings.append(message)


class DataValidator:
    """
    Performs validation on fabrication
    and planning dataframes.
    """

    def __init__(self) -> None:

        self.schema = load_schema()
        self.stages = load_stages()

        logger.info("Validator initialised.")

    # --------------------------------------------------

    def _dataset_config(self, dataset: str) -> dict | None:
        return DATASET_CONFIG.get(dataset)

    # --------------------------------------------------

    def _required_columns(self, dataset: str) -> list[str]:

        config = self._dataset_config(dataset)

        if config is None:
            return []

        section, key = config["required_columns_path"]
        return self.schema[section][key]

    # --------------------------------------------------

    def validate_dataframe(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
    ) -> ValidationResult:
        """
        Run every validation rule.

        Parameters
        ----------
        dataframe
            Input dataframe.

        dataset
            One of: fabrication, planning_master, planning_fitup,
            planning_welding (see DATASET_CONFIG above).

        Returns
        -------
        ValidationResult
        """

        result = ValidationResult()

        logger.info(f"Starting validation for '{dataset}'.")

        if self._dataset_config(dataset) is None:
            result.add_error(f"Unknown dataset: {dataset}")
            return result

        self.check_empty_dataframe(
            dataframe,
            result,
        )

        if not result.passed:
            return result

        self.check_required_columns(
            dataframe,
            dataset,
            result,
        )

        if not result.passed:
            return result

        self.check_duplicate_columns(
            dataframe,
            result,
        )

        self.check_duplicate_spools(
            dataframe,
            dataset,
            result,
        )

        self.check_missing_values(
            dataframe,
            dataset,
            result,
        )

        self.check_date_columns(
            dataframe,
            result,
        )

        logger.info("Validation completed.")

        return result

    # --------------------------------------------------

    def check_empty_dataframe(
        self,
        dataframe: pd.DataFrame,
        result: ValidationResult,
    ) -> None:

        if dataframe.empty:
            result.add_error(
                "Dataframe contains no records."
            )

    # --------------------------------------------------

    def check_required_columns(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
        result: ValidationResult,
    ) -> None:

        required = self._required_columns(dataset)

        missing = [
            column
            for column in required
            if column not in dataframe.columns
        ]

        if missing:

            for column in missing:
                result.add_error(
                    f"Missing required column: {column}"
                )

    # --------------------------------------------------

    def check_duplicate_columns(
        self,
        dataframe: pd.DataFrame,
        result: ValidationResult,
    ) -> None:

        duplicates = dataframe.columns[
            dataframe.columns.duplicated()
        ]

        for column in duplicates:
            result.add_warning(
                f"Duplicate column detected: {column}"
            )

    # --------------------------------------------------

    def check_duplicate_spools(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
        result: ValidationResult,
    ) -> None:

        config = self._dataset_config(dataset)

        if config is not None and config["is_transactional"]:
            # Fit-Up DB / Welding DB legitimately have one row per
            # joint, so the same composite key repeating is expected,
            # not a duplicate-record problem.
            return

        key = self.schema["composite_key"]

        available = [
            column
            for column in key
            if column in dataframe.columns
        ]

        if len(available) != len(key):
            return

        duplicate_rows = dataframe.duplicated(
            subset=key,
            keep=False,
        )

        duplicate_count = duplicate_rows.sum()

        if duplicate_count > 0:

            result.add_warning(
                f"{duplicate_count} duplicate spool record(s) found."
            )

    # --------------------------------------------------

    def check_missing_values(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
        result: ValidationResult,
    ) -> None:

        mandatory = self._required_columns(dataset)

        for column in mandatory:

            if column not in dataframe.columns:
                continue

            missing = dataframe[column].isna().sum()

            if missing > 0:

                result.add_warning(
                    f"{missing} blank value(s) found in '{column}'."
                )

    # --------------------------------------------------

    def check_date_columns(
        self,
        dataframe: pd.DataFrame,
        result: ValidationResult,
    ) -> None:

        for stage in self.stages["stages"]:

            column = stage["date_field"]

            if column not in dataframe.columns:
                continue

            converted = pd.to_datetime(
                dataframe[column],
                errors="coerce",
            )

            invalid = (
                converted.isna()
                & dataframe[column].notna()
            ).sum()

            if invalid > 0:

                result.add_warning(
                    f"{invalid} invalid date(s) found in '{column}'."
                )

