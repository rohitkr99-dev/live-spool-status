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

from config_loader import (
    load_business_rules,
    load_schema,
    load_settings,
    load_stages,
)
from column_mapper import standardize_columns
from logger import logger
from constants import (
    FABRICATION,
    INSPECTION_DATA,
    INSPECTION_DATA_COLUMNS,
    INSPECTION_REOFFERED_BEFORE_ACCEPT,
    LINE_HISTORY,
    MATERIAL_HANDOVER,
    MH_CURRENT_STATUS,
    MH_EXPECTED_DATE,
    MH_FIRST_STATUS,
    MH_HANDOVER_DATE,
    PLANNING,
    PROJECT_CODE,
    PROJECT_MASTER,
    PROJECT_NAME,
    REWORK,
    REWORK_OFFER_DATE,
    REWORK_PACKING_STATUS,
    SIOP_PLANNED,
    SIOP_PLANNED_START,
    WELDER_MONTH,
    WELDER_PERFORMANCE,
    WELDER_PROCESS,
    WELDER_TOTAL_WELD_JOINT,
)
from utils import (
    convert_excel_serial_dates,
    extract_file_period,
    normalize_month_name,
    resolve_multi_date_text_cells,
)


class ExcelReader:
    """
    Reads configured Excel files.

    Multi-file merge
    -----------------
    Every file_pattern below can now match more than one file - e.g.
    both "DPR_Fabrication_Jobs_July_26.xlsb" and an older
    "DPR_Fabrication_Jobs_June_26.xlsb" sitting in the same upload
    folder. This is deliberate: a project can close and drop out of
    the newest workbook, but its spools should stay visible as long
    as an older workbook that still has them is around. See
    _matching_files_oldest_first() and _merge_latest_wins() below.
    """

    def __init__(self):

        self.settings = load_settings()
        self.stages = load_stages()
        self.business_rules = load_business_rules()
        self.schema = load_schema()

    # -----------------------------------------------------

    def _read_excel_sheet_or_none(
        self,
        file: Path,
        sheet_name: str,
        header: int,
        engine: str,
        source_label: str,
        standardize_key: Optional[str] = None,
        required_columns: Optional[list[str]] = None,
    ) -> Optional[pd.DataFrame]:
        """
        pd.read_excel(), but never raises - used by every OPTIONAL
        source's read loop (read_line_history(), read_siop_planned(),
        read_rework(), read_material_handover()). A workbook whose
        internal sheet has been renamed or restructured (e.g. the
        configured sheet_name no longer exists once a source system
        re-exports the file under a new template) is exactly as
        recoverable as a missing file, per each of those methods'
        own "OPTIONAL and best-effort" contract.

        UPDATED 2026-08-15 (given by the person, in their own words:
        "why is the process searching for Sheet2 and why not just
        consider the data in Line History sheet file? It can be
        named to any sheet but I will ensure the file name is
        correct"): the configured sheet_name is now only ever a
        first guess, never a hard requirement, whenever the caller
        passes standardize_key + required_columns. Every sheet in
        the workbook is cheaply scanned (header row only, via
        nrows=0 - no meaningful cost even on a huge sheet) and run
        through standardize_columns(candidate, standardize_key) -
        the EXACT same column_mapping.json-driven renaming the real
        read uses later, so any already-known raw-header alias (e.g.
        "Joint No." vs "Joint No") is handled automatically by the
        SAME config that handles it everywhere else, nothing
        duplicated here. The configured sheet_name is tried first
        (so the common case - nothing changed - costs one extra
        cheap scan, not a behaviour change); the first sheet (in
        file order) whose standardized columns contain every name in
        required_columns is then read in FULL and returned. A
        source's internal sheet name is therefore free to change
        entirely, as long as its actual columns are still
        recognizable - whichever sheet ends up used is always
        logged, so a rename is never silent even though it's no
        longer fatal either.

        Without standardize_key/required_columns (the original,
        simpler contract - still used by callers that don't need
        this), only the exact configured sheet_name is tried, and a
        miss is a plain skip with a diagnostic of the sheets found.
        """

        if standardize_key is None or required_columns is None:
            try:
                return pd.read_excel(
                    file, sheet_name=sheet_name, header=header, engine=engine
                )
            except Exception as error:
                available_sheets = None
                try:
                    available_sheets = pd.ExcelFile(file, engine=engine).sheet_names
                except Exception:
                    pass
                sheet_detail = (
                    f" Sheets actually found in this file: {available_sheets}."
                    if available_sheets is not None else ""
                )
                logger.warning(
                    f"Could not read sheet '{sheet_name}' from {file.name} "
                    f"for {source_label} ({error}).{sheet_detail} Skipping "
                    "this file for this run."
                )
                return None

        try:
            all_sheet_names = pd.ExcelFile(file, engine=engine).sheet_names
        except Exception as error:
            logger.warning(
                f"Could not open {file.name} at all for {source_label} "
                f"({error}). Skipping this file for this run."
            )
            return None

        ordered_candidates = [sheet_name] + [
            name for name in all_sheet_names if name != sheet_name
        ]

        for candidate in ordered_candidates:
            if candidate not in all_sheet_names:
                continue
            try:
                header_only = pd.read_excel(
                    file, sheet_name=candidate, header=header,
                    engine=engine, nrows=0,
                )
            except Exception:
                continue

            standardized = standardize_columns(header_only, standardize_key)
            if not all(col in standardized.columns for col in required_columns):
                continue

            try:
                frame = pd.read_excel(
                    file, sheet_name=candidate, header=header, engine=engine
                )
            except Exception as error:
                logger.warning(
                    f"{file.name}: sheet '{candidate}' had the expected "
                    f"columns for {source_label} but failed to read in "
                    f"full ({error}). Skipping this file for this run."
                )
                return None

            if candidate != sheet_name:
                logger.warning(
                    f"{file.name}: configured sheet name '{sheet_name}' "
                    f"for {source_label} didn't have the expected columns "
                    f"- found them in sheet '{candidate}' instead, using "
                    "that. No action needed, though config/settings.json "
                    "can be updated to match if this sheet stays renamed."
                )
            return frame

        logger.warning(
            f"Could not find a sheet with the expected columns "
            f"{required_columns} anywhere in {file.name} for "
            f"{source_label} (checked sheets: {all_sheet_names}). "
            "Skipping this file for this run."
        )
        return None

    def _matching_files_oldest_first(
        self, folder: Path, pattern: str
    ) -> list[Path]:
        """
        Every file in `folder` matching `pattern`, oldest first, per
        extract_file_period()'s best guess at each filename's period.
        Files whose period can't be determined sort first (treated as
        oldest) rather than raising - see extract_file_period().
        """

        files = list(folder.glob(pattern))
        files.sort(key=lambda file: extract_file_period(file.name))
        return files

    def _merge_latest_wins(
        self,
        frames_oldest_first: list[pd.DataFrame],
        key_columns: list[str],
    ) -> pd.DataFrame:
        """
        Concatenate multiple files' worth of one-row-per-spool data
        (Fabrication, the Weekly workbook's Master Planning Sheet,
        SIOP Planned Spools) into one dataframe, keeping only the
        most recent file's row for any spool that appears in more
        than one file. A spool that only exists in an older file
        (e.g. a now-closed project dropped from the newest workbook)
        is kept as-is.

        Rows missing one or more key columns (blank filler rows,
        mostly) are left alone rather than being deduplicated
        together - dropping duplicates on an all-blank key would
        otherwise collapse many unrelated blank rows into one before
        cleaner.py's own blank-row removal gets a chance to run.

        If the key columns aren't present at all (shouldn't normally
        happen - standardize_columns() always renames them the same
        way), the frames are simply concatenated with no attempt at
        cross-file deduplication, and downstream duplicate handling
        is left to cleaner.py as before.
        """

        combined = pd.concat(frames_oldest_first, ignore_index=True)

        available_key = [
            column for column in key_columns if column in combined.columns
        ]

        if len(available_key) != len(key_columns):
            return combined

        key_present = pd.Series(True, index=combined.index)
        for column in available_key:
            series = combined[column]
            key_present &= series.notna() & (
                series.astype(str).str.strip() != ""
            )

        keyed = combined[key_present].drop_duplicates(
            subset=available_key, keep="last"
        )
        unkeyed = combined[~key_present]

        return pd.concat([keyed, unkeyed]).sort_index()

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
        Read every matching DPR workbook (oldest to newest - see
        class docstring), merging them so a spool present in more
        than one file uses the newest file's row.
        """

        config = self.settings["input_files"]["fabrication"]

        folder = Path(self.settings["paths"]["upload_folder"])

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            raise FileNotFoundError(
                "Fabrication workbook not found."
            )

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = pd.read_excel(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="pyxlsb"
            )

            frame = standardize_columns(
                frame,
                FABRICATION
            )

            frame = convert_excel_serial_dates(
                frame,
                self._fabrication_date_columns()
            )

            logger.info(
                f"Loaded {len(frame)} fabrication rows from {file.name}."
            )

            frames.append(frame)

        dataframe = self._merge_latest_wins(
            frames, self.schema_composite_key()
        )

        if len(files) > 1:
            logger.info(
                f"Merged {len(files)} fabrication workbook(s): "
                f"{len(dataframe)} spool row(s) after latest-file-wins "
                "de-duplication."
            )

        return dataframe

    def schema_composite_key(self) -> list[str]:
        """
        The Project Code / Drawing No / Spool No columns that
        uniquely identify a spool (config/schema.json's
        composite_key), shared by every one-row-per-spool source
        (Fabrication, the Weekly workbook's Master Planning Sheet,
        SIOP Planned Spools) for the multi-file merge above - same
        key cleaner.py's remove_duplicate_records() uses for
        within-file duplicates.
        """

        return self.schema["composite_key"]

    def read_planning(self) -> dict[str, pd.DataFrame]:
        """
        Read every matching Weekly Production Planning workbook
        (oldest to newest - see class docstring). Each workbook
        contributes all 3 sheets.

        Master Planning Sheet (one row per spool) is merged with
        latest-file-wins: a spool present in more than one workbook
        uses the newest one's row, but a spool only present in an
        older workbook (e.g. a since-closed project) is kept.

        Fit-Up DB / Welding DB are transactional - one row per joint,
        the same spool repeating across many rows is normal, not a
        duplicate - so every workbook's rows are simply concatenated,
        same as reading one workbook has always done.
        """

        config = self.settings["input_files"]["planning"]

        folder = Path(self.settings["paths"]["upload_folder"])

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            raise FileNotFoundError(
                "Planning workbook not found."
            )

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

        frames_by_sheet: dict[str, list[pd.DataFrame]] = {
            key: [] for key in sheet_specs
        }

        for file in files:

            logger.info(f"Reading {file.name}")

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

                frames_by_sheet[key].append(df)

                logger.info(
                    f"{file.name} -> {config[key]} : {len(df)} rows"
                )

        sheets = {
            "master_sheet": self._merge_latest_wins(
                frames_by_sheet["master_sheet"],
                self.schema_composite_key(),
            ),
            "fitup_sheet": pd.concat(
                frames_by_sheet["fitup_sheet"], ignore_index=True
            ),
            "welding_sheet": pd.concat(
                frames_by_sheet["welding_sheet"], ignore_index=True
            ),
        }

        if len(files) > 1:
            logger.info(
                f"Merged {len(files)} planning workbook(s): "
                f"{len(sheets['master_sheet'])} Master Planning Sheet "
                "row(s) after latest-file-wins de-duplication; "
                "Fit-Up DB / Welding DB rows concatenated as-is."
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

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "Line History Sheet not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Every "
                "spool will use the existing date-field-based "
                "Fit-Up/Welding/PDQC logic for this run."
            )
            return None

        business_rules = self.business_rules.get(
            "line_history_override", {}
        )
        date_columns = [
            business_rules.get(
                "fitup_date_field", "Weld FitUp Date"
            ),
            business_rules.get(
                "weld_run_date_field", "Welding FRun Date"
            ),
        ]

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="pyxlsb",
                source_label="Line History Sheet",
                standardize_key=LINE_HISTORY,
                required_columns=[
                    business_rules.get("joint_no_field", "Joint No"),
                    business_rules.get(
                        "fitup_date_field", "Weld FitUp Date"
                    ),
                    business_rules.get(
                        "weld_run_date_field", "Welding FRun Date"
                    ),
                ],
            )
            if frame is None:
                continue

            frame = standardize_columns(
                frame,
                LINE_HISTORY
            )

            frame = convert_excel_serial_dates(
                frame,
                date_columns,
            )

            logger.info(
                f"Loaded {len(frame)} Line History Sheet rows from "
                f"{file.name}."
            )

            frames.append(frame)

        if not frames:
            logger.warning(
                "Line History Sheet: no matching file could be read "
                "successfully this run. Every spool will use the "
                "existing date-field-based Fit-Up/Welding/PDQC logic "
                "for this run."
            )
            return None

        # One row per joint - the same spool (and even the same
        # joint, if an older extract's period overlaps a newer one)
        # repeating across files is expected, same as it already is
        # within a single file, so every file's rows are kept as-is
        # rather than deduplicated - unlike the one-row-per-spool
        # sources above.
        dataframe = pd.concat(frames, ignore_index=True)

        if len(files) > 1:
            logger.info(
                f"Merged {len(files)} Line History Sheet workbook(s): "
                f"{len(dataframe)} row(s) total."
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

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "SIOP Planned Spools workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Every "
                "spool not found in the Weekly Production Planning "
                "workbook will show Planned = No, unchanged."
            )
            return None

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="pyxlsb",
                source_label="SIOP Planned Spools workbook",
                standardize_key=SIOP_PLANNED,
                required_columns=[SIOP_PLANNED_START],
            )
            if frame is None:
                continue

            frame = standardize_columns(
                frame,
                SIOP_PLANNED
            )

            frame = convert_excel_serial_dates(
                frame,
                [SIOP_PLANNED_START],
            )

            logger.info(
                f"Loaded {len(frame)} SIOP Planned Spools rows from "
                f"{file.name}."
            )

            frames.append(frame)

        if not frames:
            logger.warning(
                "SIOP Planned Spools workbook: no matching file could "
                "be read successfully this run. Every spool not found "
                "in the Weekly Production Planning workbook will show "
                "Planned = No, unchanged."
            )
            return None

        dataframe = self._merge_latest_wins(
            frames, self.schema_composite_key()
        )

        if len(files) > 1:
            logger.info(
                f"Merged {len(files)} SIOP Planned Spools workbook(s): "
                f"{len(dataframe)} spool row(s) after latest-file-wins "
                "de-duplication."
            )

        return dataframe

    # -----------------------------------------------------

    def read_rework(self) -> Optional[pd.DataFrame]:
        """
        Read the QA/QC Production Rework Data workbook - one row per
        offer-for-inspection event, so the same spool's Composite
        Key repeating is expected (a spool offered more than once
        after a rework is not a duplicate). Used as the primary
        source of PDQC for any spool it covers everywhere PDQC is
        computed - see src/rework_pdqc_rule.py (ABSOLUTE RULE #1,
        docs/absolute-rules.md) - and as the source data for the
        Quality Assurance/Control dashboard (src/quality/).

        Unlike Fabrication/Planning, this file lives in its own
        folder (config/settings.json -> paths.quality_upload_folder,
        data/upload/quality/ by default) rather than
        paths.upload_folder, since it's synced from Drive
        separately. It's also a plain .xlsx workbook (read via
        openpyxl), not .xlsb like the other sources.

        OPTIONAL and best-effort, same contract as the Line History
        Sheet and SIOP Planned Spools workbook: a missing file (or
        the feature being disabled) only logs a warning and returns
        None - every spool then keeps whatever PDQC the existing
        date-field/Line-History logic already produced, unchanged.
        """

        config = self.settings["input_files"].get("rework", {})

        if not config.get("enabled", False):
            return None

        folder = Path(
            self.settings["paths"].get(
                "quality_upload_folder", "data/upload/quality"
            )
        )

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "Rework workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Every "
                "spool will keep its existing PDQC date for this "
                "run, and the Quality Assurance/Control dashboard "
                "will have no data to refresh from."
            )
            return None

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="openpyxl",
                source_label="Rework workbook",
                standardize_key=REWORK,
                required_columns=[REWORK_OFFER_DATE, REWORK_PACKING_STATUS],
            )
            if frame is None:
                continue

            frame = standardize_columns(
                frame,
                REWORK
            )

            frame = resolve_multi_date_text_cells(
                frame,
                REWORK_OFFER_DATE,
            )

            frame = convert_excel_serial_dates(
                frame,
                [REWORK_OFFER_DATE],
            )

            logger.info(
                f"Loaded {len(frame)} Rework Data rows from "
                f"{file.name}."
            )

            frames.append(frame)

        if not frames:
            logger.warning(
                "Rework workbook: no matching file could be read "
                "successfully this run. Every spool will keep its "
                "existing PDQC date for this run, and the Quality "
                "Assurance/Control dashboard will have no data to "
                "refresh from."
            )
            return None

        dataframe = pd.concat(frames, ignore_index=True)

        if len(files) > 1:
            # Transactional (one row per offer event, not per
            # spool) - every matching file's rows all matter, so
            # they're simply concatenated, same as Fit-Up DB /
            # Welding DB. Exact duplicate rows (the same file synced
            # more than once, or an old file whose date range fully
            # overlaps a newer one) are dropped so they can't double
            # -count in the Quality dashboard's rework percentages.
            before = len(dataframe)
            dataframe = dataframe.drop_duplicates()
            logger.info(
                f"Merged {len(files)} Rework Data workbook(s): "
                f"{len(dataframe)} row(s) after exact-duplicate "
                f"removal (from {before})."
            )

        return dataframe

    def read_material_handover(self) -> Optional[pd.DataFrame]:
        """
        Read the Material Handover workbook - one row per spool,
        showing whether the material required to fabricate it has
        been handed over to Production yet (and, if not, why it's
        on hold). Source data for the Material Handover section of
        the Production dashboard - see src/production/material_handover.py.

        Lives in paths.production_upload_folder (data/upload/
        production/), the folder previously reserved for future
        Production-only charts (see that folder's README.txt). Plain
        .xlsx, read via openpyxl - same as the Rework Data workbook.

        OPTIONAL and best-effort, same contract as the Line History
        Sheet / SIOP Planned Spools / Rework workbooks: a missing
        file (or the feature being disabled) only logs a warning and
        returns None - the Material Handover section is then simply
        omitted from the Production dashboard, nothing else on it is
        affected.
        """

        config = self.settings["input_files"].get("material_handover", {})

        if not config.get("enabled", False):
            return None

        folder = Path(
            self.settings["paths"].get(
                "production_upload_folder", "data/upload/production"
            )
        )

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "Material Handover workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). The "
                "Production dashboard's Material Handover section "
                "will have no data to show for this run."
            )
            return None

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="openpyxl",
                source_label="Material Handover workbook",
                standardize_key=MATERIAL_HANDOVER,
                required_columns=[
                    MH_HANDOVER_DATE, MH_FIRST_STATUS, MH_CURRENT_STATUS,
                ],
            )
            if frame is None:
                continue

            frame = standardize_columns(
                frame,
                MATERIAL_HANDOVER
            )

            frame = convert_excel_serial_dates(
                frame,
                [MH_HANDOVER_DATE, MH_EXPECTED_DATE],
            )

            logger.info(
                f"Loaded {len(frame)} Material Handover rows from "
                f"{file.name}."
            )

            frames.append(frame)

        if not frames:
            logger.warning(
                "Material Handover workbook: no matching file could "
                "be read successfully this run. The Production "
                "dashboard's Material Handover section will have no "
                "data to show for this run."
            )
            return None

        # One row per spool (like Fabrication/Master Planning) - if
        # more than one file is present, the latest file's row wins
        # for any spool appearing in both, same rule as everywhere
        # else multi-file merge applies.
        dataframe = self._merge_latest_wins(
            frames, self.schema_composite_key()
        )

        if len(files) > 1:
            logger.info(
                f"Merged {len(files)} Material Handover workbook(s): "
                f"{len(dataframe)} spool row(s) after latest-file-wins "
                "de-duplication."
            )

        return dataframe

    def read_welder_performance(self) -> Optional[pd.DataFrame]:
        """
        Read the Welder Performance Record workbook - one row per
        welder/job/welding-process entry, NDT'd during that period.
        Source data for the Welder Performance section of the
        Quality dashboard (src/quality/welder_performance.py),
        including its auto-computed "Weld Reject Rate" summary and
        its download button.

        Lives in paths.quality_upload_folder (data/upload/quality/),
        same folder as the Rework Data workbook. Plain .xlsx, read
        via openpyxl.

        OPTIONAL and best-effort, same contract as Rework/Material
        Handover: a missing file only logs a warning and returns
        None - the Quality dashboard's other sections (driven by
        Rework Data) are unaffected.

        Rows whose "Month" value doesn't resolve to a real calendar
        month (e.g. a stray "Total" footer row sitting inside the
        sheet's data range) are dropped rather than silently
        mis-bucketed - see utils.normalize_month_name().
        """

        config = self.settings["input_files"].get("welder_performance", {})

        if not config.get("enabled", False):
            return None

        folder = Path(
            self.settings["paths"].get(
                "quality_upload_folder", "data/upload/quality"
            )
        )

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "Welder Performance workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). The "
                "Quality dashboard's Welder Performance section will "
                "have no data to show for this run."
            )
            return None

        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="openpyxl",
                source_label="Welder Performance workbook",
                standardize_key=WELDER_PERFORMANCE,
                required_columns=[
                    WELDER_MONTH, WELDER_PROCESS, WELDER_TOTAL_WELD_JOINT,
                ],
            )
            if frame is None:
                continue

            frame = standardize_columns(frame, WELDER_PERFORMANCE)

            frame[WELDER_MONTH] = frame[WELDER_MONTH].apply(normalize_month_name)
            before = len(frame)
            frame = frame.dropna(subset=[WELDER_MONTH])
            dropped = before - len(frame)
            if dropped:
                logger.info(
                    f"{file.name}: dropped {dropped} row(s) with an "
                    "unrecognized Month value (e.g. a footer/Total row)."
                )

            numeric_columns = [
                "Total Weld Joint", "Total NDT Joint", "NDT Accept Joint",
                "Rejected Joint", "Total NDT Length", "NDT Accepted Length",
                "NDT Rejected Length",
            ]
            for column in numeric_columns:
                if column in frame.columns:
                    frame[column] = pd.to_numeric(frame[column], errors="coerce")

            logger.info(
                f"Loaded {len(frame)} Welder Performance rows from "
                f"{file.name}."
            )

            frames.append(frame)

        if not frames:
            logger.warning(
                "Welder Performance workbook: no matching file could "
                "be read successfully this run. The Quality "
                "dashboard's Welder Performance section will have no "
                "data to show for this run."
            )
            return None

        dataframe = pd.concat(frames, ignore_index=True)

        if len(files) > 1:
            # Transactional (one row per welder/job/process entry,
            # not per spool) - every matching file's rows all matter,
            # same as the Rework Data workbook. Exact duplicate rows
            # (the same file synced more than once, or an old file
            # whose period fully overlaps a newer one) are dropped so
            # they can't double-count in the summary/charts.
            before = len(dataframe)
            dataframe = dataframe.drop_duplicates()
            logger.info(
                f"Merged {len(files)} Welder Performance workbook(s): "
                f"{len(dataframe)} row(s) after exact-duplicate "
                f"removal (from {before})."
            )

        return dataframe

    def read_project_master(self) -> Optional[dict[str, str]]:
        """
        Read the hand-maintained Project Code -> Project Name master
        list (data/upload/projects/*Project*Master*.xlsx). The
        person updates this file "from time to time" in his own
        words - unlike the DPR-derived lookup the Quality dashboard
        already had, this one exists specifically so a Project Code
        stays resolvable even for an older/completed project that's
        aged out of the current DPR export.

        Multiple files (e.g. a dated snapshot kept alongside a newer
        one) are merged latest-file-wins per Project Code, same
        contract as read_fabrication().

        OPTIONAL: a missing file returns None so callers can fall
        back to the DPR-derived lookup alone (see
        src/quality/reader.py), same as before this source existed.
        """

        config = self.settings["input_files"].get("project_master", {})

        if not config.get("enabled", False):
            return None

        folder = Path(
            self.settings["paths"].get("upload_folder", "data/upload/projects")
        )

        files = self._matching_files_oldest_first(folder, config["file_pattern"])

        if not files:
            logger.warning(
                "Project Master workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). Project "
                "Code -> Name lookups will fall back to the DPR "
                "workbook alone."
            )
            return None

        frames = []

        for file in files:
            logger.info(f"Reading {file.name}")
            frame = self._read_excel_sheet_or_none(
                file,
                sheet_name=config["sheet_name"],
                header=config.get("header_row", 0),
                engine="openpyxl",
                source_label="Project Master workbook",
                standardize_key=PROJECT_MASTER,
                required_columns=[PROJECT_CODE, PROJECT_NAME],
            )
            if frame is None:
                continue
            frame = standardize_columns(frame, PROJECT_MASTER)
            frames.append(frame)

        if not frames:
            logger.warning(
                "Project Master workbook: no matching file could be "
                "read successfully this run. Project Code -> Name "
                "lookups will fall back to the DPR workbook alone."
            )
            return None

        dataframe = self._merge_latest_wins(frames, [PROJECT_CODE])

        lookup: dict[str, str] = {}
        for _, row in dataframe[[PROJECT_CODE, PROJECT_NAME]].dropna().iterrows():
            code = str(row[PROJECT_CODE]).strip()
            name = str(row[PROJECT_NAME]).strip()
            if code and name:
                lookup[code] = name

        logger.info(f"Loaded {len(lookup)} Project Code -> Name entries from Project Master.")
        return lookup

    def read_inspection_data(self) -> Optional[pd.DataFrame]:
        """
        Read QC's continuous PDQC Inspection Data log (2026-09-02) -
        one row per offer-for-inspection event, first-time status
        only (Accept, or the specific rework/defect-type reason as
        free text), going back to 2023. Lives in
        paths.quality_upload_folder (data/upload/quality/), same
        folder as the Rework Data workbook. Sole source for the
        Quality dashboard's Overview KPIs + 4 charts (see
        src/quality/summary.py) - the Rework Data workbook is
        untouched everywhere else, per the person's explicit
        instruction that this has nothing to do with the PDQC/RFP
        Absolute Rules or any other rework calculation.

        Unlike every other source, this workbook has ~150 sheets:
        one per weekly window, plus a couple of hand-built summary/
        tally sheets (e.g. a "TYPE OF REWORK" totals sheet) mixed in
        at ARBITRARY positions - not just the first sheet, and not
        reliably named. So rather than picking one "best" sheet like
        _read_excel_sheet_or_none() does, every sheet in the
        workbook is scanned (header row only, cheap even at this
        sheet count) and standardized the same column_mapping.json-
        driven way; every sheet whose standardized columns contain
        the full required set is read in full and combined into one
        dataframe. A summary/tally sheet never has these columns, so
        it's skipped automatically regardless of its name or
        position - same content-based philosophy as
        _read_excel_sheet_or_none() (2026-08-16), extended here to
        combine ALL matching sheets instead of using only the first.

        Columns present in only some sheets (e.g. "Inch Dia" / "Type"
        on a handful of older 2023 sheets) are dropped; a sheet
        missing "Prod Engineer" entirely just gets a blank column for
        it - every sheet is reindexed to the same fixed shape
        (INSPECTION_DATA_COLUMNS) before combining.

        OPTIONAL and best-effort, same contract as the Rework Data
        workbook: a missing file only logs a warning and returns
        None - the Quality dashboard's Overview section then has no
        data to show for this run, but nothing else is affected.
        """

        config = self.settings["input_files"].get("inspection_data", {})

        if not config.get("enabled", False):
            return None

        folder = Path(
            self.settings["paths"].get(
                "quality_upload_folder", "data/upload/quality"
            )
        )

        files = self._matching_files_oldest_first(
            folder, config["file_pattern"]
        )

        if not files:
            logger.warning(
                "Inspection Data workbook not found (looked for "
                f"'{config['file_pattern']}' in {folder}). The "
                "Quality dashboard's Overview section will have no "
                "data to show for this run."
            )
            return None

        header = config.get("header_row", 0)
        required_columns = [
            "Project Code", "Drawing No", "Spool No",
            "Prod Offer Date", "Final Status",
        ]
        frames = []

        for file in files:

            logger.info(f"Reading {file.name}")

            # Opened ONCE per file and reused for every sheet below
            # (both the header-only peek and the full read) - this
            # workbook can have ~150 sheets, and re-opening/re-
            # parsing the whole file via a fresh pd.read_excel() call
            # per sheet (as a naive per-sheet loop would) is minutes
            # slower than parsing an already-loaded ExcelFile.
            try:
                excel_file = pd.ExcelFile(file, engine="openpyxl")
            except Exception as error:
                logger.warning(
                    f"Could not open {file.name} at all for "
                    f"Inspection Data ({error}). Skipping this file "
                    "for this run."
                )
                continue

            sheets_used = 0
            for sheet_name in excel_file.sheet_names:
                try:
                    header_only = excel_file.parse(
                        sheet_name=sheet_name, header=header, nrows=0,
                    )
                except Exception:
                    continue

                standardized_header = standardize_columns(
                    header_only, INSPECTION_DATA
                )
                if not all(
                    col in standardized_header.columns
                    for col in required_columns
                ):
                    continue

                try:
                    sheet_frame = excel_file.parse(
                        sheet_name=sheet_name, header=header,
                    )
                except Exception as error:
                    logger.warning(
                        f"{file.name}: sheet '{sheet_name}' had the "
                        "expected Inspection Data columns but failed "
                        f"to read in full ({error}). Skipping this "
                        "sheet."
                    )
                    continue

                sheet_frame = standardize_columns(sheet_frame, INSPECTION_DATA)
                sheet_frame = sheet_frame.reindex(columns=INSPECTION_DATA_COLUMNS)
                frames.append(sheet_frame)
                sheets_used += 1

            logger.info(
                f"{file.name}: {sheets_used} of {len(excel_file.sheet_names)} "
                "sheet(s) matched the Inspection Data column shape "
                "and were combined."
            )

        if not frames:
            logger.warning(
                "Inspection Data workbook: no sheet with the "
                "expected columns could be found in any matching "
                "file. The Quality dashboard's Overview section "
                "will have no data to show for this run."
            )
            return None

        dataframe = pd.concat(frames, ignore_index=True)

        # Given by the person (2026-09-02, asked directly about a
        # real example): a multi-date "Prod Offer" cell (see below)
        # whose Final Status is literally "Accept" almost always
        # means the spool needed a real correction before being
        # accepted - confirmed against the real file (e.g. Insp
        # Remark "tag/punching balance, SS tag required" recorded as
        # Accept, dates "17-08-2026/20-08-2026/21-08-2026") - the
        # single Final Status value just doesn't capture that an
        # earlier attempt existed. Flagged here, BEFORE the date gets
        # collapsed below, so summary.py can count these as a genuine
        # rework event rather than a clean first-offer accept. Unlike
        # every other multi-date cell (which keeps resolving to the
        # LATEST date, unchanged - see below), these resolve to the
        # EARLIEST date instead, since what matters for this flag is
        # when the deficiency was first found, not when it was
        # finally cleared.
        def _is_reoffered_before_accept(row) -> bool:
            offer = row["Prod Offer Date"]
            status = row["Final Status"]
            if not isinstance(offer, str) or "/" not in offer:
                return False
            return pd.notna(status) and str(status).strip().casefold() == "accept"

        reoffer_mask = dataframe.apply(_is_reoffered_before_accept, axis=1)
        dataframe[INSPECTION_REOFFERED_BEFORE_ACCEPT] = reoffer_mask

        def _earliest_of_multi_date(value):
            pieces = [p.strip() for p in value.split("/") if p.strip()]
            parsed = [
                pd.to_datetime(p, dayfirst=True, errors="coerce") for p in pieces
            ]
            parsed = [p for p in parsed if pd.notna(p)]
            return min(parsed) if parsed else pd.NaT

        if reoffer_mask.any():
            dataframe.loc[reoffer_mask, "Prod Offer Date"] = (
                dataframe.loc[reoffer_mask, "Prod Offer Date"]
                .apply(_earliest_of_multi_date)
            )
            logger.info(
                f"Inspection Data: {int(reoffer_mask.sum())} row(s) "
                f"flagged {INSPECTION_REOFFERED_BEFORE_ACCEPT!r} "
                "(multi-date offer, Final Status Accept) - dated at "
                "their earliest offer date."
            )

        # Same data-entry pattern already handled for the Rework
        # Data workbook (see resolve_multi_date_text_cells()'s own
        # docstring): a re-offer typed into the SAME "Prod Offer"
        # cell as the first offer, "/"-separated (confirmed against
        # the real workbook: ~1,000 rows, e.g.
        # "17-08-2026/20-08-2026/21-08-2026"). Left alone, dateutil's
        # fuzzy parser mis-reads that text as a date with a bogus
        # timezone offset instead of failing cleanly, which then
        # breaks every sort/compare on this column ("can't compare
        # offset-naive and offset-aware datetimes") - resolving the
        # multi-date text FIRST avoids ever handing that text to the
        # date parser at all. Rows already resolved above (the
        # reoffer_mask ones) are now a plain Timestamp, not text, so
        # this leaves them untouched.
        dataframe = resolve_multi_date_text_cells(dataframe, "Prod Offer Date")
        dataframe = convert_excel_serial_dates(dataframe, ["Prod Offer Date"])

        before = len(dataframe)
        dataframe = dataframe.drop_duplicates()
        if len(dataframe) != before:
            logger.info(
                f"Inspection Data: dropped {before - len(dataframe)} "
                "exact-duplicate row(s) (e.g. an overlapping sheet "
                "re-synced across files)."
            )

        logger.info(
            f"Loaded {len(dataframe)} Inspection Data row(s) from "
            f"{len(files)} file(s) across all matching sheets."
        )

        return dataframe
