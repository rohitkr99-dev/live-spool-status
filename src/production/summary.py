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


def build_kpis(records: list[SpoolRecord], excluded_not_released: int = 0) -> dict[str, Any]:
    with_anchor = [r for r in records if r.planned_start is not None]
    return {
        "total_spools": len(records),
        "excluded_not_released": excluded_not_released,
        "spools_with_planned_start": len(with_anchor),
        "spools_missing_planned_start": len(records) - len(with_anchor),
        "spools_planned_start_from_siop": sum(
            1 for r in with_anchor if r.planned_start_source == "siop"
        ),
        "completed_packed": sum(1 for r in with_anchor if r.is_complete),
        "delayed": sum(1 for r in with_anchor if r.is_delayed),
        "welding_in_progress": sum(
            1 for r in records if r.welding_status == "in_progress"
        ),
        "welding_not_started": sum(
            1 for r in records if r.welding_status == "not_started"
        ),
    }


def _status_label(record: SpoolRecord, stage_labels: dict[str, str]) -> str:
    if record.planned_start is None:
        return "No Planned Start"
    if record.is_complete:
        return "Packed"
    if record.current_stage is None:
        return "Packed"
    return stage_labels.get(record.current_stage, record.current_stage)


def _delay_status_label(record: SpoolRecord) -> str:
    if record.planned_start is None:
        return "N/A"
    return "Delayed" if record.is_delayed else "On Time"


def _stage_display_days(record: SpoolRecord) -> dict[str, int | None]:
    """
    The 5 stage-day columns for the spool table. Each value is the
    INDIVIDUAL time that stage took - the gap since the previous
    milestone (the stage before it, or Planned Start for the first
    one) - not the cumulative day count from Planned Start.
    src/production/ageing.py's stage_actual_days is cumulative (it
    has to be, to compare against the target-day matrix, which is
    itself a cumulative day-from-Planned-Start table); this
    function's job is to turn that cumulative series into
    individual per-stage durations for display, so e.g. a spool
    whose Packed date lands on cumulative day 105 with PDI Clearance
    reached on cumulative day 100 shows a Packed age of 5 (105 - 100),
    not 105.

    The one stage currently in progress (the "current stage") shows
    a running count since the last-reached milestone (Today minus
    that milestone's date); every stage after that is blank. Every
    value is None (blank) for a spool with no Planned Start - there's
    nothing to count from.
    """
    out: dict[str, int | None] = {}
    previous_cumulative = 0  # Planned Start itself, day 0

    for stage in TRACKED_STAGES:
        actual = record.stage_actual_days.get(stage)

        if actual is not None:
            out[stage] = actual - previous_cumulative
            previous_cumulative = actual
        elif stage == record.current_stage and record.current_age_days is not None:
            out[stage] = record.current_age_days - previous_cumulative
            # Every stage after this one is still un-reached -
            # nothing more to compute, they stay None below.
            for remaining_stage in TRACKED_STAGES[TRACKED_STAGES.index(stage) + 1:]:
                out[remaining_stage] = None
            break
        else:
            out[stage] = None

    return out


def build_spool_rows(
    records: list[SpoolRecord],
    category_meta: dict[str, dict],
    stage_labels: dict[str, str],
) -> list[dict]:
    rows = []
    for r in records:
        rows.append({
            "project_code": r.project_code,
            "drawing_no": r.drawing_no,
            "spool_no": r.spool_no,
            "category": category_meta[r.category_key]["label"],
            "category_key": r.category_key,
            "material": r.material,
            "spool_size": r.spool_size,
            "inch_dia": r.inch_dia,
            "quantity": r.quantity,
            "weight": r.weight,
            "surface_area": r.surface_area,
            "planned_start": r.planned_start.isoformat() if r.planned_start else None,
            "planned_start_source": r.planned_start_source,
            "welding_finish": (
                r.stage_dates.get("welding_finish").isoformat()
                if r.stage_dates.get("welding_finish") else None
            ),
            "welding_status": r.welding_status,
            "current_stage": r.current_stage,
            "current_age_days": r.current_age_days,
            "is_complete": r.is_complete,
            "is_delayed": r.is_delayed,
            "status": _status_label(r, stage_labels),
            "delay_status": _delay_status_label(r),
            "stage_days": _stage_display_days(r),
        })
    return rows


def build_projects_list(records: list[SpoolRecord]) -> list[str]:
    return sorted({r.project_code for r in records if r.project_code})


# Global chart metric switcher - the field on each spool row (above)
# each metric sums/weights by, and its display label + unit. Used
# both to sum the pie chart's category distribution and, for the
# stage/ideal-vs-actual charts, as the WEIGHT in a weighted average
# of each spool's actual days (a spool with a larger metric value
# counts for more of the average) - "Spool Count" is the original,
# unweighted behaviour (every spool weighted equally).
METRICS = [
    {"key": "spool_count", "label": "Spool Count", "field": None, "unit": "spools"},
    {"key": "quantity", "label": "Quantity", "field": "quantity", "unit": "qty"},
    {"key": "inch_dia", "label": "Inch Dia", "field": "inch_dia", "unit": "in"},
    {"key": "weight", "label": "Weight", "field": "weight", "unit": "wt"},
    {"key": "surface_area", "label": "Surface Area", "field": "surface_area", "unit": "sq.ft"},
]
