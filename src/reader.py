"""
reader.py
---------------------------------
Reads Excel workbooks into pandas
DataFrames.

This module performs no validation
and no business logic. Converting raw
Excel serial numbers into real dates is
considered part of reading correctly
(pyxlsb, used for .xlsb workbooks, does
not do this automatically), so it happens
here.
"""

from pathlib import Path
from typing import Optional

import pandas as pd

from config_loader import load_business_rules, load_settings, load_stages
from column_mapper import standardize_columns
from logger import logger
from constants import (
    FABRICATION,
    LINE_HISTORY,
    PLANNING,
    SIOP_PLANNED,
    SIOP_PLANNED_START,
)
from utils import convert_excel_serial_dates


class ExcelReader:
    """
    Reads configured Excel files.
    """

    def __init__(self):

        self.settings = load_settings()
        self.stages = load_stages()
        self.business_rules = load_business_rules()

    def _fabrication_date_columns(self) -> list[str]:
        """
        Every stage date field that belongs to the fabrication
        source (i.e. every configured stage except Fit-Up / Welding,
        which are derived by the Merge Engine from the planning
        workbook's transactional sheets), plus the Prod Order
        Release field (not a tracked stage, but still an Excel date
        column that needs the same serial-number conversion).
        """

        first_activity_fields = set(
            self.business_rules["unplanned_spool"]["first_activity_fields"]
        )

        date_columns = [
            stage["date_field"]
            for stage in self.stages["stages"]
            if stage["date_field"] not in first_activity_fields
        ]

        prod_order_release_field = self.business_rules.get(
            "prod_order_release", {}
        ).get("field")

        if prod_order_release_field:
            date_columns.append(prod_order_release_field)

        return date_columns

    def read_fabrication(self) -> pd.DataFrame:
        """
        Read DPR workbook.
        """

        config = self.settings["input_files"]["fabrication"]

        folder = Path(self.settings["paths"]["upload_folder"])

        files = list(folder.glob(config["file_pattern"]))

        if not files:
            raise FileNotFoundError(
                "Fabrication workbook not found."
            )

        file = files[0]

        logger.info(f"Reading {file.name}")

        dataframe = pd.read_excel(
            file,
            sheet_name=config["sheet_name"],
            header=config.get("header_row", 0),
            engine="pyxlsb"
        )

        dataframe = standardize_columns(
            dataframe,
            FABRICATION
        )

        dataframe = convert_excel_serial_dates(
            dataframe,
            self._fabrication_date_columns()
        )

        logger.info(
            f"Loaded {len(dataframe)} fabrication rows."
        )

        return dataframe

    def read_planning(self) -> dict[str, pd.DataFrame]:
        """
        Read planning workbook.
        """

        config = self.settings["input_files"]["planning"]

        folder = Path(self.settings["paths"]["upload_folder"])

        files = list(folder.glob(config["file_pattern"]))

        if not files:
            raise FileNotFoundError(
                "Planning workbook not found."
            )

        file = files[0]

        logger.info(f"Reading {file.name}")

        sheets = {}

        planned_start_field = (
            self.business_rules["planned_spool"]["age_start_field"]
        )
        activity_date_field = config["activity_date_field"]

        sheet_specs = {
            "master_sheet": {
                "header_key": "master_sheet_header_row",
                "date_columns": [planned_start_field],
            },
            "fitup_sheet": {
                "header_key": "fitup_sheet_header_row",
                "date_columns": [activity_date_field],
            },
            "welding_sheet": {
                "header_key": "welding_sheet_header_row",
                "date_columns": [activity_date_field],
            },
        }

        for key, spec in sheet_specs.items():

            df = pd.read_excel(
                file,
                sheet_name=config[key],
                header=config.get(spec["header_key"], 0),
                engine="pyxlsb"
            )

            df = standardize_columns(
                df,
                PLANNING
            )

            df = convert_excel_serial_dates(
                df,
                spec["date_columns"]
            )

            sheets[key] = df

            logger.info(
                f"{config[key]} : {len(df)} rows"
            )

        return sheets

    def read_line_history(self) -> Optional[pd.DataFrame]:
        """
        Read the Line History Sheet workbook - joint-level Weld
        FitUp Date / Welding FRun Date, used to override the
        Fit-Up/Welding/PDQC status (see config/business_rules.json
        -> line_history_override, merge.py ->
        summarize_line_history()).

        Unlike Fabrication/Planning, this file is OPTIONAL: if it
        isn't present in the upload folder (or the feature is
        disabled in config/settings.json ->
        input_files.line_history.enabled), every spool simply falls
        back to the existing date-field-based Fit-Up/Welding/PDQC
        logic - so a missing file is a warning, not a pipeline-
        stopping error, and this method returns None instead of
        raising.
        """

        config = self.settings["input_files"].get("line_history", {})

        if not config.get("enabled", False):
            return None

        folder = Path(self.settings["paths"]["upload_folder"])

        files = list(folder.glob(config["file_pattern"]))

        if not files:
            logger.warning(
                "Line History Sheet not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Every "
                "spool will use the existing date-field-based "
                "Fit-Up/Welding/PDQC logic for this run."
            )
            return None

        file = files[0]

        logger.info(f"Reading {file.name}")

        dataframe = pd.read_excel(
            file,
            sheet_name=config["sheet_name"],
            header=config.get("header_row", 0),
            engine="pyxlsb"
        )

        dataframe = standardize_columns(
            dataframe,
            LINE_HISTORY
        )

        business_rules = self.business_rules.get(
            "line_history_override", {}
        )

        dataframe = convert_excel_serial_dates(
            dataframe,
            [
                business_rules.get(
                    "fitup_date_field", "Weld FitUp Date"
                ),
                business_rules.get(
                    "weld_run_date_field", "Welding FRun Date"
                ),
            ],
        )

        logger.info(
            f"Loaded {len(dataframe)} Line History Sheet rows."
        )

        return dataframe

    def read_siop_planned(self) -> Optional[pd.DataFrame]:
        """
        Read the SIOP Planned Spools workbook - a secondary,
        fallback source of Planned Start dates. merge.py ->
        apply_siop_fallback() only ever uses this to fill in a
        Planned Start that the Weekly Production Planning workbook
        left blank; it never overwrites a Planned Start that
        workbook already provided.

        The filename is not consistent - config/settings.json ->
        input_files.siop_planned.file_pattern matches loosely
        (looking only for "SIOP" ... "Planned" ... "Spools" in
        order, wherever else the name varies).

        Like the Line History Sheet, this file is OPTIONAL and
        best-effort: a missing file (or the feature being disabled)
        only logs a warning and returns None - every spool then
        falls back to the existing Weekly-file-only Planned logic,
        unchanged.
        """

        config = self.settings["input_files"].get("siop_planned", {})

        if not config.get("enabled", False):
            return None

        folder = Path(self.settings["paths"]["upload_folder"])

        files = list(folder.glob(config["file_pattern"]))

        if not files:
            logger.warning(
                "SIOP Planned Spools workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Every "
                "spool not found in the Weekly Production Planning "
                "workbook will show Planned = No, unchanged."
            )
            return None

        file = files[0]

        logger.info(f"Reading {file.name}")

        dataframe = pd.read_excel(
            file,
            sheet_name=config["sheet_name"],
            header=config.get("header_row", 0),
            engine="pyxlsb"
        )

        dataframe = standardize_columns(
            dataframe,
            SIOP_PLANNED
        )

        dataframe = convert_excel_serial_dates(
            dataframe,
            [SIOP_PLANNED_START],
        )

        logger.info(
            f"Loaded {len(dataframe)} SIOP Planned Spools rows."
        )

        return dataframe
