"""
src/mom/pipeline.py
---------------------------------------------------------
SIOP MoM Tracker workbook (Drive Projects folder)
        |
        +--> reader: Current Open Cases sheet --> current_cases (last meeting's actions)
        +--> reader: Weekly Log sheet ---------> summary.build_history (per project)
                                                    |
                                                    +--> processed/<bundle>    (always)
                                                    +--> website/data/<bundle> (if publishing enabled)

Every run replaces the bundle from scratch. Same contract as
src/painting/pipeline.py; additive - it imports nothing from the other
departments' packages.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mom.logger import logger
from mom.reader import read_workbook
from mom.summary import build_history

CONFIG_PATH = Path("config/mom_settings.json")


class MomPipelineError(Exception):
    pass


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise MomPipelineError(f"Missing config file: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def run(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or load_config()

    upload_folder = Path(config["paths"]["upload_folder"])
    processed_folder = Path(config["paths"]["processed_folder"])
    website_data_folder = Path(config["paths"]["website_data_folder"])
    bundle_filename = config["output_files"]["bundle"]
    pattern = config["input_files"]["file_pattern"]

    result = read_workbook(upload_folder, pattern)
    if result is None:
        raise MomPipelineError(f"No MoM Tracker workbook matching {pattern!r} in {upload_folder}.")
    source_file, current_cases, log_rows = result

    if not log_rows:
        raise MomPipelineError(f"No Weekly Log rows were read from {source_file}.")

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_file": source_file,
        "current_cases": current_cases,
        "history": build_history(log_rows),
    }

    folders = [processed_folder]
    if config.get("publishing", {}).get("publish_to_website", False):
        folders.append(website_data_folder)

    files_written = []
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / bundle_filename
        with path.open("w", encoding="utf-8") as f:
            json.dump(bundle, f, ensure_ascii=False, indent=None)
        logger.info(f"Wrote {path}")
        files_written.append(str(path))

    return {
        "current_cases": len(current_cases),
        "log_rows": len(log_rows),
        "projects": len(bundle["history"]["projects"]),
        "files_written": files_written,
    }
