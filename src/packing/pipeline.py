"""
src/packing/pipeline.py
---------------------------------------------------------
Orchestrates the Packing & Dispatch pipeline:

  data/upload/packing/*.xlsx
        |  (reader.py)
        v
  normalized spool rows + box rows
        |  (summary.py)
        v
  packing_dispatch_data.json
        |
        +--> processed/packing_dispatch_data.json   (always)
        +--> website/data/packing_dispatch_data.json (if publishing enabled)

Every run replaces the bundle from scratch - there is no incremental
merge with a previous run. That matches how these workbooks are
produced: each one is a full, current export, not a delta.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from packing.logger import logger
from packing.reader import read_all_workbooks
from packing.summary import (
    _int,
    _mt,
    build_dispatch_trend,
    build_kpi_summary,
    build_packing_trend,
    build_project_names,
    build_project_summary,
    build_shipments,
    build_status_breakdown,
)

CONFIG_PATH = Path("config/packing_settings.json")


class PackingPipelineError(Exception):
    pass


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise PackingPipelineError(f"Missing config file: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _finalize_spool_rows(spools: list[dict]) -> list[dict]:
    """
    Convert each spool row's weight to MT (2dp) and its qty to a whole
    number for display, right before it's embedded in the bundle - all
    aggregation (build_kpi_summary etc.) already ran against the
    unrounded kg values, so this has no effect on any total.
    """
    out = []
    for s in spools:
        row = dict(s)
        row["total_wt_mt"] = _mt(row.pop("total_wt"))
        row["total_qty"] = _int(row["total_qty"])
        out.append(row)
    return out


def _finalize_box_rows(boxes: list[dict]) -> list[dict]:
    out = []
    for b in boxes:
        row = dict(b)
        row["net_wt_mt"] = _mt(row.pop("net_wt"))
        row["qty"] = _int(row["qty"])
        out.append(row)
    return out


def run(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config()

    upload_folder = Path(config["paths"]["upload_folder"])
    processed_folder = Path(config["paths"]["processed_folder"])
    website_data_folder = Path(config["paths"]["website_data_folder"])
    file_pattern = config["input_files"]["file_pattern"]
    bundle_filename = config["output_files"]["bundle"]

    if not upload_folder.exists():
        raise PackingPipelineError(
            f"Upload folder not found: {upload_folder}. "
            "Create it and drop the Packing & Dispatch workbooks into it."
        )

    logger.info(f"Reading workbooks from {upload_folder} ...")
    workbook_results = read_all_workbooks(upload_folder, file_pattern)

    spools: list[dict] = []
    boxes: list[dict] = []
    source_files: list[dict] = []
    for result in workbook_results:
        spools.extend(result["spools"])
        boxes.extend(result["boxes"])
        source_files.append({
            "file": result["source_file"],
            "spool_rows": len(result["spools"]),
            "box_rows": len(result["boxes"]),
        })

    if not spools and not boxes:
        raise PackingPipelineError(
            "No spool or box rows were read from any workbook in "
            f"{upload_folder}. Check the files are there and match "
            f"the expected sheet names ('*Spool*', 'Summary')."
        )

    project_names = build_project_names(workbook_results)

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_files": source_files,
        "kpi_summary": build_kpi_summary(spools, boxes),
        "status_breakdown": build_status_breakdown(spools),
        "project_summary": build_project_summary(spools, boxes, project_names),
        "packing_trend": build_packing_trend(spools),
        "dispatch_trend": build_dispatch_trend(spools),
        "shipments": build_shipments(boxes, project_names),
        # Every aggregate above ran against unrounded kg values - only
        # now, for the embedded row-level tables, do individual rows
        # get converted to MT (2dp) for display. See _finalize_*_rows().
        "spools": _finalize_spool_rows(spools),
        "boxes": _finalize_box_rows(boxes),
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
        "spool_rows": len(spools),
        "box_rows": len(boxes),
        "projects": len(bundle["project_summary"]),
        "files_written": files_written,
    }
