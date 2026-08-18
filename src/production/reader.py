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
  rework              Production Rework Data workbook - one row per
                      offer-for-inspection event. Optional; used only
                      to apply the ABSOLUTE RULE #1 PDQC rule (see
                      src/rework_pdqc_rule.py and
                      docs/absolute-rules.md) - src/production/
                      pipeline.py applies it to `fabrication`'s PDQC
                      column right after load_sources() returns.
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
    material_handover: pd.DataFrame | None
    rework: pd.DataFrame | None


def load_sources() -> ProductionSources:
    """
    Read every workbook this dashboard needs, via the existing
    ExcelReader. Raises FileNotFoundError (from ExcelReader) if the
    DPR or Weekly Production Planning workbook isn't in
    data/upload/projects/ - both are required. The Line History
    Sheet, SIOP Planned Spools, and Material Handover workbooks are
    all optional; see welding_finish.py for what happens to Welding
    Finish when Line History is missing, and material_handover.py
    for what happens when the Material Handover workbook is missing.
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

    material_handover = None
    try:
        logger.info("Reading Material Handover workbook (optional) ...")
        material_handover = excel_reader.read_material_handover()
    except Exception as error:
        logger.warning(
            f"Could not read Material Handover workbook ({error}). "
            "The Production dashboard's Material Handover section "
            "will be omitted for this run."
        )

    # ABSOLUTE RULE #1 (docs/absolute-rules.md, 2026-08-18): PDQC
    # must reflect the Production Rework Data workbook's clearance
    # status everywhere, not just on the Projects dashboard - see
    # src/rework_pdqc_rule.py. Optional/best-effort, same contract as
    # the Quality dashboard's own read of this workbook: a missing
    # file just means this rule has nothing to apply, not a pipeline
    # failure.
    rework = None
    try:
        logger.info("Reading Production Rework Data workbook (optional, PDQC rule) ...")
        rework = excel_reader.read_rework()
    except Exception as error:
        logger.warning(
            f"Could not read Production Rework Data workbook ({error}). "
            "PDQC will be taken as-is from the DPR sheet for this run, "
            "without the Rework Cleared/Not-Cleared rule applied."
        )

    return ProductionSources(
        fabrication=fabrication,
        master_planning=planning_sheets["master_sheet"],
        welding_db=planning_sheets["welding_sheet"],
        line_history=line_history,
        siop_planned=siop_planned,
        material_handover=material_handover,
        rework=rework,
    )
