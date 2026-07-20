"""
cleaner.py
---------------------------------------------------------
Data cleaning module for the Live Spool Status & Ageing System.

Responsibilities
----------------
1. Remove completely blank rows.
2. Trim whitespace from text fields.
3. Replace blank strings with pandas.NA.
4. Convert configured date columns.
5. Remove duplicate spool records (keeping the most complete row
   per spool, not just the first one in sheet order).
6. Reset dataframe index.
7. Produce a cleaning summary.

This module modifies the dataframe but does not apply
business rules or calculate KPIs.

Transactional datasets
-----------------------
Fit-Up DB and Welding DB legitimately have one row per joint, so the
same spool's composite key repeating is expected, not a duplicate
record. Pass is_transactional=True (to clean_dataframe or directly to
remove_duplicate_records) for those sheets so real transactional rows
are never dropped.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from config_loader import load_schema, load_stages
from logger import logger


@dataclass
class CleaningResult:
    """
    Summary of dataframe cleaning.
    """

    original_rows: int = 0
    final_rows: int = 0
    blank_rows_removed: int = 0
    duplicate_rows_removed: int = 0
    invalid_dates_found: int = 0
    text_fields_trimmed: int = 0


class DataCleaner:
    """
    Cleans raw fabrication and planning data.
    """

    def __init__(self) -> None:

        self.schema = load_schema()
        self.stages = load_stages()

        logger.info("Cleaner initialised.")

    # -----------------------------------------------------

    def clean_dataframe(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
        is_transactional: bool = False,
    ) -> tuple[pd.DataFrame, CleaningResult]:

        logger.info("Starting dataframe cleaning.")

        result = CleaningResult()
        result.original_rows = len(dataframe)

        dataframe = dataframe.copy()

        dataframe, removed = self.remove_blank_rows(dataframe)
        result.blank_rows_removed = removed

        dataframe, trimmed = self.trim_text_columns(dataframe)
        result.text_fields_trimmed = trimmed

        dataframe = self.replace_blank_strings(dataframe)

        dataframe, invalid = self.standardize_dates(dataframe)
        result.invalid_dates_found = invalid

        if is_transactional:
            # Fit-Up DB / Welding DB: one row per joint. The same
            # composite key repeating is expected, not a duplicate.
            removed = 0
        else:
            dataframe, removed = self.remove_duplicate_records(
                dataframe,
                dataset,
            )

        result.duplicate_rows_removed = removed

        dataframe.reset_index(
            drop=True,
            inplace=True,
        )

        result.final_rows = len(dataframe)

        logger.info(
            "Cleaning completed. "
            f"Rows: {result.original_rows} -> {result.final_rows}"
        )

        return dataframe, result

    # -----------------------------------------------------

    def remove_blank_rows(
        self,
        dataframe: pd.DataFrame,
    ) -> tuple[pd.DataFrame, int]:

        before = len(dataframe)

        dataframe = dataframe.dropna(
            how="all"
        )

        removed = before - len(dataframe)

        if removed:
            logger.info(
                f"Removed {removed} blank row(s)."
            )

        return dataframe, removed

    # -----------------------------------------------------

    def trim_text_columns(
        self,
        dataframe: pd.DataFrame,
    ) -> tuple[pd.DataFrame, int]:
        """
        Strip leading/trailing whitespace from every text (object
        dtype) column - WITHOUT touching blank cells.

        IMPORTANT: this must never do a blanket `.astype(str)` on
        the column. object columns very often mix real strings with
        genuinely blank cells (NaN/None) - e.g. a Remarks column
        where only some spools have a note, or a Prod Order Release
        column that isn't uniformly a date. `.astype(str)` turns
        those blanks into the literal text "nan"/"None", which is
        NOT considered blank by is_empty() - silently breaking every
        "is this field filled in?" check downstream (Rule 0's
        Production Order Not Released check, the Line History Sheet
        override's blank-Joint-No./blank-date checks, etc.) for any
        row where trimming happened to run on a mixed column. Only
        actual string values are stripped; everything else (NaN,
        None, numbers, dates that ended up in an object column) is
        left completely untouched.
        """

        trimmed = 0

        # NOTE: "object" alone is correct and sufficient here - every
        # text column coming out of openpyxl/pyxlsb reads in as
        # object dtype. Do NOT add "str" to this list: pandas 2.x
        # raises TypeError("string dtypes are not allowed...") the
        # moment "str" appears in select_dtypes(include=...), with
        # or without "object" alongside it.
        object_columns = dataframe.select_dtypes(
            include=["object"]
        ).columns

        for column in object_columns:

            original = dataframe[column].copy()

            dataframe[column] = dataframe[column].apply(
                lambda value: (
                    value.strip() if isinstance(value, str) else value
                )
            )

            trimmed += sum(
                1
                for before, after in zip(original, dataframe[column])
                if isinstance(before, str)
                and isinstance(after, str)
                and before != after
            )

        return dataframe, int(trimmed)

    # -----------------------------------------------------

    def replace_blank_strings(
        self,
        dataframe: pd.DataFrame,
    ) -> pd.DataFrame:

        dataframe.replace(
            "",
            pd.NA,
            inplace=True,
        )

        dataframe.replace(
            "nan",
            pd.NA,
            inplace=True,
        )

        return dataframe

    # -----------------------------------------------------

    def standardize_dates(
        self,
        dataframe: pd.DataFrame,
    ) -> tuple[pd.DataFrame, int]:

        invalid_dates = 0

        for stage in self.stages["stages"]:

            column = stage["date_field"]

            if column not in dataframe.columns:
                continue

            original = dataframe[column]

            converted = pd.to_datetime(
                original,
                errors="coerce",
            )

            invalid_dates += (
                converted.isna()
                & original.notna()
            ).sum()

            dataframe[column] = converted

        if invalid_dates:
            logger.warning(
                f"{invalid_dates} invalid date(s) converted to NaT."
            )

        return dataframe, int(invalid_dates)

    # -----------------------------------------------------

    def remove_duplicate_records(
        self,
        dataframe: pd.DataFrame,
        dataset: str,
    ) -> tuple[pd.DataFrame, int]:
        """
        Collapse rows sharing the same Composite Key down to one row
        per spool.

        When a spool's Composite Key appears more than once (e.g. an
        early, mostly-blank snapshot row left in the sheet ahead of
        the spool's later, fully-updated record), the row with the
        FEWEST blank cells - i.e. the most complete snapshot of that
        spool - is kept, not simply whichever row happens to appear
        first. Keeping "first" by sheet order previously meant a
        spool with real fabrication progress could have that data
        silently discarded in favour of an earlier, near-empty
        duplicate that just happened to be listed first - reporting
        e.g. "Fabrication Yet to Start" for a spool that was actually
        fully dispatched.

        Ties (rows with equally many blank cells) fall back to sheet
        order, keeping the first of the tied rows - the same
        behaviour as before for genuinely equivalent duplicates.
        """

        key = self.schema["composite_key"]

        available = [
            column
            for column in key
            if column in dataframe.columns
        ]

        if len(available) != len(key):

            logger.warning(
                "Composite key not available. "
                "Duplicate removal skipped."
            )

            return dataframe, 0

        before = len(dataframe)

        # Rank every row by how complete it is (most non-blank cells
        # first), preserving original order among ties, then keep the
        # first (= most complete) row per Composite Key. Restoring the
        # original row order afterwards keeps this a pure "drop some
        # rows" operation from the caller's point of view.
        completeness_order = (
            dataframe.notna().sum(axis=1)
            .sort_values(ascending=False, kind="stable")
            .index
        )

        dataframe = dataframe.loc[completeness_order]
        dataframe = dataframe.drop_duplicates(subset=key, keep="first")
        dataframe = dataframe.sort_index()

        removed = before - len(dataframe)

        if removed:
            logger.info(
                f"Removed {removed} duplicate record(s) - kept the "
                "most complete row per spool."
            )

        return dataframe, removed

  
