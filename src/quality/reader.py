"""
src/quality/reader.py
---------------------------------------------------------
Loads the source data for the Quality Assurance/Control dashboard.

Like src/production/reader.py, this module does not read Excel
itself - it calls the existing top-level `reader.ExcelReader`,
which already knows how to find, read, and column-map the Rework
Data workbook (data/upload/quality/, config/settings.json ->
input_files.rework).

Also reads the Fabrication (DPR) workbook, best-effort, purely to
look up each Project Code's Project Name for nicer chart labels -
the Rework Data workbook itself has no Project Name column. A
missing/unreadable DPR file only means charts fall back to showing
the bare Project Code instead of "Project Code - Project Name"; it
never blocks the Quality dashboard, which has its own required
input (the Rework Data workbook).

Also reads the Inspection Data workbook (2026-09-02, optional) -
QC's own continuous PDQC log, which src/quality/summary.py now uses
as the sole source for the Overview KPIs + 4 charts (kpis,
first_offer_split, rework_by_project, rework_trend, rework_cycles),
replacing the Rework Data workbook for those specifically. The
Rework Data workbook is untouched everywhere else on this dashboard
(top_rework_types, the Rework Data export, Welder Performance).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from reader import ExcelReader
from quality.logger import logger


@dataclass
class QualitySources:
    rework: pd.DataFrame
    project_names: dict[str, str]
    welder_performance: pd.DataFrame | None
    inspection_data: pd.DataFrame | None


def _build_project_name_lookup(fabrication: pd.DataFrame) -> dict[str, str]:
    if fabrication is None or fabrication.empty:
        return {}
    if "Project Code" not in fabrication.columns or "Project Name" not in fabrication.columns:
        return {}

    lookup: dict[str, str] = {}
    for _, row in fabrication[["Project Code", "Project Name"]].dropna().iterrows():
        code = str(row["Project Code"]).strip()
        name = str(row["Project Name"]).strip()
        if code and name and code not in lookup:
            lookup[code] = name
    return lookup


def load_sources() -> QualitySources:
    """
    Read the Rework Data workbook (required) via the existing
    ExcelReader, plus the Fabrication (DPR) workbook and the Project
    Master workbook (both optional - Project Name lookup only, the
    latter overriding the former per Project Code).

    Raises FileNotFoundError (from ExcelReader) if the Rework Data
    workbook isn't in data/upload/quality/ - it's the one required
    input for this dashboard.
    """

    excel_reader = ExcelReader()

    logger.info("Reading Rework Data workbook ...")
    rework = excel_reader.read_rework()

    if rework is None or rework.empty:
        raise FileNotFoundError(
            "Rework Data workbook not found in data/upload/quality/ "
            "(or config/settings.json -> input_files.rework is "
            "disabled)."
        )

    project_names: dict[str, str] = {}
    try:
        logger.info("Reading Fabrication (DPR) workbook (Project Name lookup, optional) ...")
        fabrication = excel_reader.read_fabrication()
        project_names = _build_project_name_lookup(fabrication)
    except Exception as error:
        logger.warning(
            f"Could not read Fabrication (DPR) workbook for Project "
            f"Name lookup ({error}). Charts will show bare Project "
            "Codes instead of names."
        )

    # The hand-maintained Project Master (data/upload/projects/,
    # 2026-08-17) wins over the DPR-derived lookup above on any
    # conflicting Project Code, since it's the one the person
    # directly maintains and keeps current for projects that have
    # aged out of the DPR export.
    try:
        logger.info("Reading Project Master workbook (Project Name lookup override, optional) ...")
        project_master = excel_reader.read_project_master()
        if project_master:
            project_names = {**project_names, **project_master}
    except Exception as error:
        logger.warning(
            f"Could not read Project Master workbook ({error}). "
            "Falling back to the DPR-derived Project Name lookup alone."
        )

    welder_performance: pd.DataFrame | None = None
    try:
        logger.info("Reading Welder Performance Record workbook (optional) ...")
        welder_performance = excel_reader.read_welder_performance()
    except Exception as error:
        logger.warning(
            f"Could not read Welder Performance Record workbook "
            f"({error}). The Welder Performance section will have "
            "no data to show for this run."
        )

    inspection_data: pd.DataFrame | None = None
    try:
        logger.info("Reading Inspection Data workbook (optional) ...")
        inspection_data = excel_reader.read_inspection_data()
    except Exception as error:
        logger.warning(
            f"Could not read Inspection Data workbook ({error}). "
            "The Quality dashboard's Overview section will have no "
            "data to show for this run."
        )

    return QualitySources(
        rework=rework,
        project_names=project_names,
        welder_performance=welder_performance,
        inspection_data=inspection_data,
    )
