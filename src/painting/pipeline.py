"""
src/painting/pipeline.py
---------------------------------------------------------
Orchestrates the Painting pipeline:

  data/upload/painting/*.xlsx  ---\
                                    +--> (summary.py) --> painting bundle
  Fabrication (DPR) workbook   ---/                         |
                                                              +--> processed/<bundle>   (always)
                                                              +--> website/data/<bundle> (if publishing enabled)

Every run replaces the bundle from scratch - same contract as
src/packing/pipeline.py.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from painting.logger import logger
from painting.reader import read_all_workbooks, read_dpr_rfp_spools
from painting.summary import (
    build_anomalies,
    build_aging_buckets,
    build_bay_output_trend,
    build_blasting_output_trend,
    build_cycle_time_histogram,
    build_kpi_summary,
    build_material_insight,
    build_not_in_dpr,
    build_project_insight,
    build_stage_duration_stats,
    build_stage_funnel,
    build_stage_output_trend,
    build_weekly_trend,
    merge_spools,
)

CONFIG_PATH = Path("config/painting_settings.json")


class PaintingPipelineError(Exception):
    pass


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise PaintingPipelineError(f"Missing config file: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def run(config: dict[str, Any] | None = None, dpr_rows: list[dict] | None = None) -> dict[str, Any]:
    """
    dpr_rows is normally left as None, which reads the real
    Fabrication (DPR) workbook via reader.read_dpr_rfp_spools() - see
    that function's docstring for why this pipeline is allowed to
    read the DPR directly. The parameter exists so tests (and one-off
    local runs against an already-published DPR export) can inject a
    pre-built list instead of needing the real .xlsb workbook on disk.
    """
    config = config or load_config()

    upload_folder = Path(config["paths"]["upload_folder"])
    processed_folder = Path(config["paths"]["processed_folder"])
    website_data_folder = Path(config["paths"]["website_data_folder"])
    file_pattern = config["input_files"]["file_pattern"]
    bundle_filename = config["output_files"]["bundle"]

    if not upload_folder.exists():
        raise PaintingPipelineError(
            f"Upload folder not found: {upload_folder}. "
            "Create it and drop the Painting Weekly Plan workbook(s) into it."
        )

    logger.info(f"Reading Painting Weekly Plan workbook(s) from {upload_folder} ...")
    painting_rows = read_all_workbooks(upload_folder, file_pattern)

    if not painting_rows:
        raise PaintingPipelineError(
            f"No spool rows were read from any workbook in {upload_folder}. "
            "Check the file is there and has a 'Spool List' sheet."
        )

    if dpr_rows is None:
        dpr_rows = read_dpr_rfp_spools()

    if not dpr_rows:
        logger.warning(
            "No RFP-done spools were read from the Fabrication (DPR) "
            "workbook - the bundle will show zero RFP-done spools this run."
        )

    merged, excluded_already_packed = merge_spools(dpr_rows, painting_rows)
    not_in_dpr = build_not_in_dpr(dpr_rows, painting_rows)

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_files": {
            "painting_workbooks": sorted({r["source_file"] for r in painting_rows}),
            "dpr_rfp_spool_count": len(dpr_rows),
        },
        "kpi_summary": build_kpi_summary(merged, not_in_dpr, excluded_already_packed),
        "stage_funnel": build_stage_funnel(merged),
        "stage_duration_stats": build_stage_duration_stats(merged),
        "cycle_time_histogram": build_cycle_time_histogram(merged),
        "aging_buckets": build_aging_buckets(merged),
        "weekly_trend": build_weekly_trend(merged),
        "stage_output_trend": build_stage_output_trend(merged),
        "blasting_output_trend": build_blasting_output_trend(merged),
        "bay_output_trend": build_bay_output_trend(merged),
        "project_insight": build_project_insight(merged),
        "material_insight": build_material_insight(merged),
        "anomalies": build_anomalies(not_in_dpr, excluded_already_packed),
        "spools": merged,
    }

    processed_folder.mkdir(parents=True, exist_ok=True)
    output_path = processed_folder / bundle_filename
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=None)
    logger.info(f"Wrote {output_path}")

    files_written = [str(output_path)]

    if config.get("publishing", {}).get("publish_to_website", False):
        website_data_folder.mkdir(parents=True, exist_ok=True)
        published_path = website_data_folder / bundle_filename
        with published_path.open("w", encoding="utf-8") as f:
            json.dump(bundle, f, ensure_ascii=False, indent=None)
        logger.info(f"Published {published_path}")
        files_written.append(str(published_path))

    return {
        "spool_rows": len(painting_rows),
        "rfp_done_spools": len(merged),
        "missing_from_plan": bundle["kpi_summary"]["missing_from_plan_count"],
        "files_written": files_written,
    }
