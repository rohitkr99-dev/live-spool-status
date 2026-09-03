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


def build_category_stages(rules: dict) -> dict[str, list[dict[str, str]]]:
    """
    Per category, the ordered list of {key, label} stages its chart
    should plot - e.g. "loose" only shows 3 of the 6 possible stages,
    under different labels for 2 of them (see config/production_
    rules.json -> category_tracked_stages / category_stage_labels).
    Every other category falls back to the full standard 5-stage list
    (after Planned Start) under the shared stage_labels, unchanged
    from before this per-category override existed.
    """
    tracked_by_category = rules.get("category_tracked_stages", {})
    label_overrides = rules.get("category_stage_labels", {})
    default_stages = [s for s in rules["stage_order"] if s != "planned_start"]
    shared_labels = rules["stage_labels"]

    out: dict[str, list[dict[str, str]]] = {}
    for cat in rules["categories"]:
        key = cat["key"]
        stages = tracked_by_category.get(key, default_stages)
        overrides = label_overrides.get(key, {})
        out[key] = [
            {"key": stage, "label": overrides.get(stage, shared_labels.get(stage, stage))}
            for stage in stages
        ]
    return out


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


def _trustworthy_actual_days(record, tracked_stages: list[str]) -> dict[str, int | None]:
    """
    A record's own stage_actual_days, but with any stage whose value
    is LESS than an earlier tracked stage's value excluded (None) -
    a raw date reversal (e.g. RFP dated before PDQC for the same
    spool) makes that stage's "how long did this take" figure
    untrustworthy, so it shouldn't be allowed to corrupt that
    stage's average.

    Added 2026-08-20 after the person reported "Stage-wise Ageing by
    Category" showing PDQC's average actual days HIGHER than RFP's
    in some categories - structurally impossible, since RFP requires
    PDQC first. Confirmed via the Projects dashboard's new
    reversed_stage_dates Exception check that real spools in his data
    do have this kind of reversed date pair. Rather than guess at
    what the "correct" date should have been (silently rewriting a
    date this module has no way to actually know), the untrustworthy
    stage is simply excluded from ITS OWN average - not from every
    stage, and the underlying raw date is untouched everywhere else
    (current_stage, ageing, exports all still see the real value).

    Comparison uses the running maximum of RAW recorded values seen
    so far (not previously-excluded ones), so one bad stage doesn't
    cascade into flagging every stage after it as untrustworthy too.
    """

    result: dict[str, int | None] = {}
    running_max: int | None = None

    for stage in tracked_stages:
        value = record.stage_actual_days.get(stage)

        if value is None:
            result[stage] = None
            continue

        if running_max is not None and value < running_max:
            result[stage] = None
        else:
            result[stage] = value

        running_max = value if running_max is None else max(running_max, value)

    return result


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

    A spool whose stage_actual_days aren't in non-decreasing order
    (a raw date reversal - e.g. RFP dated before its own PDQC) is
    excluded from the affected stage's average specifically - see
    _trustworthy_actual_days() above.
    """

    by_category: dict[str, Any] = {}

    for key, meta in category_meta.items():
        cat_records = [
            r for r in records if r.category_key == key and r.planned_start
        ]

        trustworthy_by_record = [
            _trustworthy_actual_days(r, TRACKED_STAGES) for r in cat_records
        ]

        stages_out = []
        for stage in TRACKED_STAGES:
            actual_days = [
                trustworthy.get(stage)
                for trustworthy in trustworthy_by_record
                if trustworthy.get(stage) is not None
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


def build_hold_by_project_stage(
    records: list[SpoolRecord], stage_labels: dict[str, str]
) -> dict[str, dict[str, int]]:
    """
    Given by the person (2026-08-21): "insert a separate chart for
    only Hold spools, where we can show Project wise stage wise
    current Hold quantity." A spool with an open Hold period
    (currently_on_hold - see hold_ledger.py) is excluded from every
    other backlog chart entirely (src/production/backlog.py), so
    this is the only place they're counted - grouped by Project Name
    and current_stage's display label (the stage the spool is stuck
    at while the Hold is open).

    Returns {project_name: {stage_label: count}} - every project
    that has at least one currently-held spool, every stage label
    that has at least one (no forced-zero entries, unlike the 4-
    bucket backlog charts, since the set of held projects/stages is
    inherently sparse and this is a simpler cross-tab, not a fixed-
    shape chart).
    """

    result: dict[str, dict[str, int]] = {}
    for record in records:
        if not record.currently_on_hold:
            continue

        project = record.project_name or record.project_code or "(Unknown Project)"
        stage_label = stage_labels.get(record.current_stage, record.current_stage) \
            if record.current_stage else "(Stage Unknown)"

        result.setdefault(project, {})
        result[project][stage_label] = result[project].get(stage_label, 0) + 1

    return result


def build_rework_by_project_stage(
    records: list[SpoolRecord], stage_labels: dict[str, str]
) -> dict[str, dict[str, int]]:
    """
    Same shape and same reasoning as build_hold_by_project_stage()
    above, for spools currently in Rework instead of Hold - added
    2026-09-03 after confirming against the real Production Rework
    Data workbook that 49 of the 73 spools in the Release for
    Painting "Beyond 30 Days" backlog bucket were actually in Rework,
    not a genuine backlog (see src/production/backlog.py, which now
    excludes both). Kept as its own separate chart/function rather
    than merged into the Hold one - REWORK_LATEST_STATUS
    (rework_pdqc_rule.py) deliberately keeps Hold and Rework
    distinguishable everywhere else in this codebase, and merging
    them here would lose that distinction right where a person is
    most likely to want it (are these spools QC-blocked because of a
    genuine defect, or because of an administrative/material Hold?).

    Returns {project_name: {stage_label: count}} - every project with
    at least one spool whose Rework Latest Status is "Rework" right
    now, cross-tabbed by current_stage's display label.
    """

    result: dict[str, dict[str, int]] = {}
    for record in records:
        if record.rework_latest_status != "Rework":
            continue

        project = record.project_name or record.project_code or "(Unknown Project)"
        stage_label = stage_labels.get(record.current_stage, record.current_stage) \
            if record.current_stage else "(Stage Unknown)"

        result.setdefault(project, {})
        result[project][stage_label] = result[project].get(stage_label, 0) + 1

    return result


def _status_label(record: SpoolRecord, stage_labels: dict[str, str], category_stages: dict) -> str:
    if record.planned_start is None:
        return "No Planned Start"
    if record.is_complete or record.current_stage is None:
        # The label of this category's own LAST tracked stage - e.g.
        # "Packed" for every standard category, but "Release for
        # Packing" for "loose", which never has a separate Packed
        # milestone (see config/production_rules.json).
        stages = category_stages.get(record.category_key) or []
        return stages[-1]["label"] if stages else "Packed"
    return stage_labels.get(record.current_stage, record.current_stage)


def _delay_status_label(record: SpoolRecord) -> str:
    if record.planned_start is None:
        return "N/A"
    return "Delayed" if record.is_delayed else "On Time"


def _stage_display_days(record: SpoolRecord) -> dict[str, int | None]:
    """
    The 5 stage-day columns for the spool TABLE. Each value is the
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

    IMPORTANT: this is for the table only. The CHARTS (production-
    filters.js -> ProductionAggregate) need the CUMULATIVE version
    instead, since the target-day matrix they compare against is
    itself cumulative from Planned Start - see _stage_cumulative_days()
    below, exposed as the bundle's "stage_days_cumulative" field. A
    2026-08-03 regression mixed these two up (charts briefly read the
    individual-duration field, making every "Actual" bar look tiny
    next to the correctly-cumulative Target bar) - keep them separate.

    Ageing can never be negative (2026-08-08 decision, applies site-
    wide - see docs/ageing-and-project-naming-conventions.md): each
    stage's cumulative day count (record.stage_actual_days /
    current_age_days) is already >= 0 - see utils.days_between() -
    but the INDIVIDUAL duration computed here is a subtraction of two
    such values, and that subtraction can still go negative when a
    later milestone's date lands chronologically before the one
    before it (e.g. a spool whose PDQC date - especially now that
    some are overridden from the QA/QC rework report, see
    merge.py -> apply_rework_pdqc_override() - falls before its
    recorded Welding Finish date; a real data-quality situation, not
    a bug). That's clamped to 0 below. previous_cumulative keeps
    tracking the true (unclamped) cumulative day count regardless, so
    a clamp on one stage doesn't distort the next stage's duration.
    """
    out: dict[str, int | None] = {}
    previous_cumulative = 0  # Planned Start itself, day 0

    for stage in TRACKED_STAGES:
        actual = record.stage_actual_days.get(stage)

        if actual is not None:
            out[stage] = max(actual - previous_cumulative, 0)
            previous_cumulative = actual
        elif stage == record.current_stage and record.current_age_days is not None:
            out[stage] = max(record.current_age_days - previous_cumulative, 0)
            # Every stage after this one is still un-reached -
            # nothing more to compute, they stay None below.
            for remaining_stage in TRACKED_STAGES[TRACKED_STAGES.index(stage) + 1:]:
                out[remaining_stage] = None
            break
        else:
            out[stage] = None

    return out


def _stage_cumulative_days(record: SpoolRecord) -> dict[str, int | None]:
    """
    The CUMULATIVE (days-from-Planned-Start) counterpart to
    _stage_display_days() above - for the CHARTS, not the table. A
    reached stage shows its actual cumulative day count; the current
    stage shows a running Today - Planned Start count; every stage
    after that is blank. This is directly comparable to the target-
    day matrix, which is itself cumulative.
    """
    out: dict[str, int | None] = {}
    for stage in TRACKED_STAGES:
        actual = record.stage_actual_days.get(stage)
        if actual is not None:
            out[stage] = actual
        elif stage == record.current_stage and record.current_age_days is not None:
            out[stage] = record.current_age_days
        else:
            out[stage] = None
    return out


def build_spool_rows(
    records: list[SpoolRecord],
    category_meta: dict[str, dict],
    stage_labels: dict[str, str],
    category_stages: dict,
) -> list[dict]:
    rows = []
    for r in records:
        rows.append({
            "project_code": r.project_code,
            "project_name": r.project_name,
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
            "status": _status_label(r, stage_labels, category_stages),
            "delay_status": _delay_status_label(r),
            "stage_days": _stage_display_days(r),
            "stage_days_cumulative": _stage_cumulative_days(r),
        })
    return rows


def build_projects_list(records: list[SpoolRecord]) -> list[dict]:
    """
    One entry per distinct project, {code, name} - sorted by code.
    name is "" if no fabrication row for that code had a Project
    Name (matches SpoolRecord.project_name's own empty-string
    default). The website shows Name (Code) in the project filter -
    see website/js/production-app.js -> populateGlobalFilters() -
    but filters BY code (option.value), so this shape change is
    display-only; no filtering logic needed updating.
    """
    names: dict[str, str] = {}
    for r in records:
        if r.project_code and r.project_code not in names:
            names[r.project_code] = r.project_name or ""
    return [
        {"code": code, "name": names[code]}
        for code in sorted(names)
    ]


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
