"""
src/production/summary.py
---------------------------------------------------------
Aggregates the per-spool records (ageing.SpoolRecord) built by
build_spool_records() into the JSON structures website/production.js
charts against. No chart/rendering logic lives here - only numbers.
"""

from __future__ import annotations

from statistics import mean
from typing import Any

from production.ageing import SpoolRecord, TRACKED_STAGES


def _round1(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def build_category_meta(rules: dict) -> dict[str, dict[str, Any]]:
    return {c["key"]: c for c in rules["categories"]}


def build_category_distribution(
    records: list[SpoolRecord], category_meta: dict[str, dict]
) -> list[dict[str, Any]]:
    counts = {key: 0 for key in category_meta}
    for record in records:
        counts[record.category_key] = counts.get(record.category_key, 0) + 1

    return [
        {
            "key": key,
            "label": category_meta[key]["label"],
            "short_label": category_meta[key]["short_label"],
            "count": counts.get(key, 0),
        }
        for key in category_meta
    ]


def build_stage_ageing(
    records: list[SpoolRecord],
    category_meta: dict[str, dict],
    stage_labels: dict[str, str],
) -> dict[str, Any]:
    """
    Per category, per tracked stage: the target day-count and the
    average ACTUAL days taken by spools that have already reached
    that stage (a completed-cycle-time average - spools still short
    of a stage simply aren't counted in that stage's average, so it
    never mixes "still running" clocks into a completion average).
    Also the count still short of that stage, and their average
    current age (Today - Planned Start), so a stalled backlog shows
    up even before any of them finish the stage.
    """

    by_category: dict[str, Any] = {}

    for key, meta in category_meta.items():
        cat_records = [
            r for r in records if r.category_key == key and r.planned_start
        ]

        stages_out = []
        for stage in TRACKED_STAGES:
            actual_days = [
                r.stage_actual_days.get(stage)
                for r in cat_records
                if r.stage_actual_days.get(stage) is not None
            ]
            pending_ages = [
                r.current_age_days
                for r in cat_records
                if r.current_stage == stage and r.current_age_days is not None
            ]
            target = (
                cat_records[0].target_days.get(stage) if cat_records else None
            )

            stages_out.append({
                "stage": stage,
                "label": stage_labels.get(stage, stage),
                "target_days": target,
                "avg_actual_days": _round1(mean(actual_days)) if actual_days else None,
                "reached_count": len(actual_days),
                "pending_count": len(pending_ages),
                "avg_pending_age_days": _round1(mean(pending_ages)) if pending_ages else None,
            })

        by_category[key] = {
            "key": key,
            "label": meta["label"],
            "short_label": meta["short_label"],
            "spool_count": len(cat_records),
            "stages": stages_out,
        }

    return by_category


def build_ideal_vs_actual(
    records: list[SpoolRecord], category_meta: dict[str, dict]
) -> list[dict[str, Any]]:
    """
    One row per category: target total cycle time (Planned Start ->
    Packed, per the config matrix) vs. the average ACTUAL total for
    spools that have actually been Packed, plus - separately - the
    average current age of spools still open, so a category with
    zero completions yet still shows something meaningful.
    """

    out = []
    for key, meta in category_meta.items():
        cat_records = [
            r for r in records if r.category_key == key and r.planned_start
        ]
        completed = [
            r.stage_actual_days.get("packed")
            for r in cat_records
            if r.stage_actual_days.get("packed") is not None
        ]
        open_ages = [
            r.current_age_days for r in cat_records if not r.is_complete
            and r.current_age_days is not None
        ]
        target_total = cat_records[0].target_days.get("packed") if cat_records else None

        out.append({
            "key": key,
            "label": meta["label"],
            "short_label": meta["short_label"],
            "target_total_days": target_total,
            "avg_actual_total_days": _round1(mean(completed)) if completed else None,
            "completed_count": len(completed),
            "avg_open_age_days": _round1(mean(open_ages)) if open_ages else None,
            "open_count": len(open_ages),
        })

    return out


def build_kpis(records: list[SpoolRecord]) -> dict[str, Any]:
    with_anchor = [r for r in records if r.planned_start is not None]
    return {
        "total_spools": len(records),
        "spools_with_planned_start": len(with_anchor),
        "spools_missing_planned_start": len(records) - len(with_anchor),
        "completed_packed": sum(1 for r in with_anchor if r.is_complete),
        "delayed": sum(1 for r in with_anchor if r.is_delayed),
        "welding_in_progress": sum(
            1 for r in records if r.welding_status == "in_progress"
        ),
        "welding_not_started": sum(
            1 for r in records if r.welding_status == "not_started"
        ),
    }


def build_spool_rows(records: list[SpoolRecord], category_meta: dict[str, dict]) -> list[dict]:
    rows = []
    for r in records:
        rows.append({
            "project_code": r.project_code,
            "drawing_no": r.drawing_no,
            "spool_no": r.spool_no,
            "category": category_meta[r.category_key]["label"],
            "category_key": r.category_key,
            "planned_start": r.planned_start.isoformat() if r.planned_start else None,
            "welding_finish": (
                r.stage_dates.get("welding_finish").isoformat()
                if r.stage_dates.get("welding_finish") else None
            ),
            "welding_status": r.welding_status,
            "current_stage": r.current_stage,
            "current_age_days": r.current_age_days,
            "is_complete": r.is_complete,
            "is_delayed": r.is_delayed,
        })
    return rows
