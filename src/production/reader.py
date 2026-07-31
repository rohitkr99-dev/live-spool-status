"""
src/production/reader.py
---------------------------------------------------------
Loads the source data for the Production department dashboard.

This dashboard is a DIFFERENT VIEW of the same DPR / Weekly
Production Planning / Line History Sheet workbooks the Projects
dashboard (src/pipeline.py, website/dashboard.html) already uses -
not a new data source. So this module does not read Excel itself;
it just calls the existing top-level `reader.ExcelReader`, which
already:

  - finds the right file in data/upload/projects/ (config/settings.json)
  - reads the right sheet at the right header row
  - renames columns via config/column_mapping.json
  - converts Excel serial-number dates to real dates

"Spool Size" and "Total Joints" needed no new mapping - column_mapper
.standardize_columns() only renames columns it recognises and leaves
everything else untouched, and both of those raw DPR headers already
match the names this module (and config/production_rules.json) uses
directly.

Returns four dataframes:

  fabrication        DPR Detailed Sheet - one row per spool. Material,
                      Spool Size, Total Joints, PDQC, RFP, PDI,
                      Packing dates.
  master_planning     Weekly workbook's Master Planning Sheet - one
                      row per spool. Planned Start.
  welding_db          Weekly workbook's Welding DB sheet - one row
                      per joint. Activity Date. Fallback source for
                      Welding Finish when a spool isn't in the Line
                      History Sheet.
  line_history        Line History Sheet - one row per joint. Joint
                      No, Welding FRun Date. Primary source for
                      Welding Finish. None if the file isn't present
                      (optional, same as the Projects pipeline).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from reader import ExcelReader
from production.logger import logger


@dataclass
class ProductionSources:
    fabrication: pd.DataFrame
    master_planning: pd.DataFrame
    welding_db: pd.DataFrame
    line_history: pd.DataFrame | None
    siop_planned: pd.DataFrame | None


def load_sources() -> ProductionSources:
    """
    Read every workbook this dashboard needs, via the existing
    ExcelReader. Raises FileNotFoundError (from ExcelReader) if the
    DPR or Weekly Production Planning workbook isn't in
    data/upload/projects/ - both are required. The Line History
    Sheet is optional; see welding_finish.py for what happens to
    Welding Finish when it's missing.
    """

    excel_reader = ExcelReader()

    logger.info("Reading Fabrication (DPR) workbook ...")
    fabrication = excel_reader.read_fabrication()

    logger.info("Reading Weekly Production Planning workbook ...")
    planning_sheets = excel_reader.read_planning()

    logger.info("Reading Line History Sheet (optional) ...")
    line_history = excel_reader.read_line_history()

    logger.info("Reading SIOP Planned Spools workbook (optional, Planned Start fallback) ...")
    siop_planned = excel_reader.read_siop_planned()

    return ProductionSources(
        fabrication=fabrication,
        master_planning=planning_sheets["master_sheet"],
        welding_db=planning_sheets["welding_sheet"],
        line_history=line_history,
        siop_planned=siop_planned,
    )
