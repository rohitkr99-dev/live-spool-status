"""
src/production/pipeline.py
---------------------------------------------------------
Orchestrates the Production department dashboard pipeline:

  data/upload/projects/*.xlsb  (same files the Projects pipeline
        |                       already reads - see reader.py)
        v  (reader.py, reusing the top-level ExcelReader)
  fabrication / master_planning / welding_db / line_history frames
        v  (classify.py, welding_finish.py, ageing.py)
  one SpoolRecord per spool - category, Welding Finish, actual days
  per stage vs. target, current position, delayed flag
        v  (summary.py)
  production_data.json
        |
        +--> processed/production_data.json    (always)
        +--> website/data/production_data.json (if publishing enabled)

Entry point: production_main.py (repo root), same pattern as
main.py / packing_main.py. This module makes no changes to, and
does not import from, src/pipeline.py, src/merge.py,
src/business_rules.py or src/ageing.py - the Projects pipeline is
untouched.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from production.logger import logger
from production.reader import load_sources
from production.ageing import build_spool_records
from production.welding_finish import (
    build_line_history_lookup,
    build_welding_db_lookup,
)
from production.summary import (
    build_category_distribution,
    build_category_meta,
    build_ideal_vs_actual,
    build_kpis,
    build_spool_rows,
    build_stage_ageing,
)

PRODUCTION_SETTINGS_PATH = Path("config/production_settings.json")
PRODUCTION_RULES_PATH = Path("config/production_rules.json")


class ProductionPipelineError(Exception):
    pass


def _load_json_from(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ProductionPipelineError(f"Missing config file: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_production_settings() -> dict[str, Any]:
    return _load_json_from(PRODUCTION_SETTINGS_PATH)


def load_production_rules() -> dict[str, Any]:
    return _load_json_from(PRODUCTION_RULES_PATH)


def run(
    settings: dict[str, Any] | None = None,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:

    settings = settings or load_production_settings()
    rules = rules or load_production_rules()

    logger.info("Starting Production dashboard pipeline ...")
    sources = load_sources()

    fields = rules["welding_finish_fields"]

    line_history_lookup = build_line_history_lookup(
        sources.line_history,
        fields["line_history_joint_no_field"],
        fields["line_history_frun_field"],
    )
    welding_db_lookup = build_welding_db_lookup(
        sources.welding_db,
        fields["welding_db_activity_date_field"],
    )

    logger.info(
        f"Line History covers {len(line_history_lookup)} spools; "
        f"Welding DB covers {len(welding_db_lookup)} spools."
    )

    records = build_spool_records(
        sources.fabrication,
        sources.master_planning,
        line_history_lookup,
        welding_db_lookup,
        rules,
    )

    if not records:
        raise ProductionPipelineError(
            "No spool rows were read from the Fabrication (DPR) workbook."
        )

    category_meta = build_category_meta(rules)

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": list(category_meta.values()),
        "category_distribution": build_category_distribution(records, category_meta),
        "stage_ageing": build_stage_ageing(records, category_meta, rules["stage_labels"]),
        "ideal_vs_actual": build_ideal_vs_actual(records, category_meta),
        "kpis": build_kpis(records),
        "spools": build_spool_rows(records, category_meta),
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
        f"Production dashboard: {bundle['kpis']['total_spools']} spools, "
        f"{bundle['kpis']['delayed']} delayed, "
        f"{bundle['kpis']['spools_missing_planned_start']} missing Planned Start."
    )

    return {
        "spool_rows": len(records),
        "kpis": bundle["kpis"],
        "files_written": files_written,
    }
