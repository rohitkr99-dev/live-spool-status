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

Exception (2026-08-18): this pipeline DOES call
src/rework_pdqc_rule.py -> apply_rework_pdqc_rule() on
sources.fabrication right after load_sources() returns, below -
the shared, single implementation of ABSOLUTE RULE #1
(docs/absolute-rules.md): PDQC must reflect the Production Rework
Data workbook's clearance status identically on every dashboard.
That module is NOT src/merge.py (which itself now also just calls
the same shared function) - importing it does not reintroduce a
dependency on the Projects pipeline.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from production.logger import logger
from production.reader import load_sources
from production.ageing import build_spool_records, TRACKED_STAGES
from rework_pdqc_rule import apply_rework_pdqc_rule
from welding_finish import (
    build_line_history_lookup,
    build_welding_db_lookup,
)
from production.summary import (
    build_category_distribution,
    build_category_meta,
    build_category_stages,
    build_hold_by_project_stage,
    build_ideal_vs_actual,
    build_kpis,
    build_projects_list,
    build_spool_rows,
    build_stage_ageing,
    METRICS,
)
from production.material_handover import build_material_handover_summary
from production.backlog import build_backlog_summary

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

    # ABSOLUTE RULE #1 (docs/absolute-rules.md) - must run before
    # build_spool_records() below reads PDQC off sources.fabrication,
    # so every downstream computation (current stage, backlog,
    # ageing) sees the corrected value, never the raw DPR one.
    sources.fabrication = apply_rework_pdqc_rule(
        sources.fabrication, sources.rework
    )

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

    records, excluded_not_released = build_spool_records(
        sources.fabrication,
        sources.master_planning,
        line_history_lookup,
        welding_db_lookup,
        rules,
        siop_planned_df=sources.siop_planned,
    )

    if not records:
        raise ProductionPipelineError(
            "No spool rows were read from the Fabrication (DPR) workbook."
        )

    category_meta = build_category_meta(rules)
    category_stages = build_category_stages(rules)

    # Planned Start per spool (Weekly Production Planning workbook's
    # own field, falling back to the SIOP Planned Spools workbook
    # only where the Weekly workbook has a gap - see ageing.py's
    # build_spool_records()) - reused as-is for the Material
    # Handover "timeliness" split below, rather than reading a
    # second copy of the Weekly workbook just for that. Given by
    # the person, 2026-08-12: "the program is saving Week in
    # Projects Dashboard Spool list... it also has the SIOP planned
    # start date" - this IS that same value, already computed here
    # for this dashboard's own ageing, keyed by the same Composite
    # Key used everywhere else in the repo.
    planned_start_lookup = {
        record.composite_key: record.planned_start
        for record in records
        if record.planned_start is not None
    }

    try:
        material_handover = build_material_handover_summary(
            sources.material_handover, planned_start_lookup
        )
    except Exception as error:
        # Best-effort, same contract as reader.py's own read - a
        # problem here only means the Material Handover section is
        # empty for this run, never that the rest of the Production
        # dashboard fails to build.
        logger.warning(f"Could not build Material Handover summary ({error}).")
        material_handover = build_material_handover_summary(None, {})

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": list(category_meta.values()),
        "category_distribution": build_category_distribution(records, category_meta),
        "category_stages": category_stages,
        "stage_ageing": build_stage_ageing(records, category_meta, rules["stage_labels"]),
        "ideal_vs_actual": build_ideal_vs_actual(records, category_meta),
        "kpis": build_kpis(records, excluded_not_released),
        "spools": build_spool_rows(records, category_meta, rules["stage_labels"], category_stages),
        "target_days": rules["target_days"],
        "stage_order": TRACKED_STAGES,
        "stage_labels": rules["stage_labels"],
        "metrics": METRICS,
        "projects": build_projects_list(records),
        "material_handover": material_handover,
        "backlog": build_backlog_summary(
            records, category_meta, rules.get("category_tracked_stages", {})
        ),
        "hold_by_project_stage": build_hold_by_project_stage(records, rules["stage_labels"]),
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
