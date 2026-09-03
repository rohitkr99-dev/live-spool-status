"""
src/quality/pipeline.py
---------------------------------------------------------
Orchestrates the Quality Assurance/Control dashboard pipeline:

  data/upload/quality/*Rework*.xlsx
  data/upload/quality/*INSPECTION*DATA*.xlsx
        v  (reader.py, reusing the top-level ExcelReader)
  rework dataframe + inspection_data dataframe (one row per offer-
  for-inspection event each) + Project Name lookup (from the DPR,
  optional)
        v  (summary.py)
  quality_data.json
        |
        +--> processed/quality_data.json    (always)
        +--> website/data/quality_data.json (if publishing enabled)

Entry point: quality_main.py (repo root), same pattern as
production_main.py / packing_main.py. This module makes no changes
to, and does not import from, src/pipeline.py, src/merge.py,
src/business_rules.py or src/ageing.py - the Projects pipeline
(including its own separate use of the Rework Data workbook, for
the PDQC override) is untouched.

2026-09-02/03: the Overview KPIs + all 5 charts (kpis,
rework_by_project, first_offer_split, rework_trend, rework_cycles,
top_rework_types) now source from the Inspection Data workbook
instead of the Rework Data workbook, per the person's explicit
instruction - see src/quality/summary.py's module docstring. The
Rework Data export/Welder Performance sections are untouched, still
sourced from sources.rework as before.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from constants import INSPECTION_DATA_COLUMNS
from quality.logger import logger
from quality.reader import load_sources
from quality.summary import (
    build_first_offer_split,
    build_kpis,
    build_rework_by_project,
    build_rework_cycles,
    build_rework_status_monthly,
    build_rework_trend,
    build_rework_type_monthly,
    build_top_rework_types,
    scope_inspection_data_to_current_cycle,
)
from quality.welder_performance import build_bundle as build_welder_performance_bundle
from utils import dataframe_to_json_records

QUALITY_SETTINGS_PATH = Path("config/quality_settings.json")


class QualityPipelineError(Exception):
    pass


def load_quality_settings() -> dict[str, Any]:
    if not QUALITY_SETTINGS_PATH.exists():
        raise QualityPipelineError(f"Missing config file: {QUALITY_SETTINGS_PATH}")
    with QUALITY_SETTINGS_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def run(settings: dict[str, Any] | None = None) -> dict[str, Any]:

    settings = settings or load_quality_settings()

    logger.info("Starting Quality Assurance/Control dashboard pipeline ...")

    sources = load_sources()

    top_n = settings.get("top_rework_types_count", 10)

    # Overview KPIs + 4 charts source from the Inspection Data
    # workbook (2026-09-02) - see summary.py's module docstring. A
    # missing/unsynced file (sources.inspection_data is None) falls
    # back to an empty, correctly-shaped dataframe rather than
    # crashing the pipeline - every build_* function below already
    # handles an empty input by returning zeroed/empty results, same
    # as any other optional source having nothing to show yet.
    inspection_data = (
        sources.inspection_data
        if sources.inspection_data is not None
        else pd.DataFrame(columns=INSPECTION_DATA_COLUMNS)
    )
    if sources.inspection_data is None:
        logger.warning(
            "Inspection Data workbook not available this run - "
            "Overview KPIs and charts will show as empty until it's "
            "synced."
        )

    # Current fiscal cycle only, except the named projects that keep
    # their full history - see summary.py's
    # scope_inspection_data_to_current_cycle() docstring. Applied
    # once here so every build_* function below already receives a
    # correctly-scoped dataframe.
    before_scope = len(inspection_data)
    inspection_data = scope_inspection_data_to_current_cycle(inspection_data)
    if before_scope:
        logger.info(
            f"Inspection Data: scoped to the current fiscal cycle "
            f"(+ named-project full history) - {len(inspection_data)} "
            f"of {before_scope} row(s) kept."
        )

    cycles = build_rework_cycles(inspection_data)

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kpis": build_kpis(inspection_data, cycles),
        "top_rework_types": build_top_rework_types(inspection_data, top_n=top_n),
        "rework_by_project": build_rework_by_project(inspection_data, sources.project_names),
        "first_offer_split": build_first_offer_split(inspection_data),
        "rework_trend": build_rework_trend(inspection_data),
        "rework_cycles": cycles,
        # Feeds the "Download Production Rework Data" button - raw
        # rows + the two auto-computed summary blocks, so the
        # exported .xlsx never needs a second Python pass at click
        # time (see website/js/quality-charts.js).
        "rework_export": {
            "raw_rows": dataframe_to_json_records(
                sources.rework,
                columns=[
                    "Project Code", "Drawing No", "Spool No",
                    "Rework Material", "Rework Size", "Prod Offer Date",
                    "Prod Engineer", "QC Observation", "Final Status",
                    "Rework Type",
                ],
            ),
            "status_monthly": build_rework_status_monthly(sources.rework),
            "type_monthly": build_rework_type_monthly(sources.rework),
        },
        # Optional - None if the Welder Performance Record workbook
        # hasn't been synced this run; the website hides that
        # section and disables its download button when null.
        "welder_performance": (
            build_welder_performance_bundle(sources.welder_performance, sources.project_names)
            if sources.welder_performance is not None
            and not sources.welder_performance.empty
            else None
        ),
    }

    processed_folder = Path(settings["paths"]["processed_folder"])
    website_data_folder = Path(settings["paths"]["website_data_folder"])
    bundle_filename = settings["output_files"]["bundle"]

    processed_folder.mkdir(parents=True, exist_ok=True)
    output_path = processed_folder / bundle_filename
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=None)
    logger.info(f"Wrote {output_path}")

    files_written = [str(output_path)]

    if settings.get("publishing", {}).get("publish_to_website", False):
        website_data_folder.mkdir(parents=True, exist_ok=True)
        published_path = website_data_folder / bundle_filename
        with published_path.open("w", encoding="utf-8") as f:
            json.dump(bundle, f, ensure_ascii=False, indent=None)
        logger.info(f"Published {published_path}")
        files_written.append(str(published_path))

    logger.info(
        f"Quality dashboard: {bundle['kpis']['total_spools']} spool(s), "
        f"{bundle['kpis']['rework_events']} rework event(s), "
        f"{bundle['kpis']['overall_rework_rate_pct']}% overall rework rate."
    )

    return {
        "kpis": bundle["kpis"],
        "files_written": files_written,
    }
