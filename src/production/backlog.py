"""
src/production/backlog.py
---------------------------------------------------------
Backlog by operation: for spools currently stuck AT a given
tracked stage, how far past that stage's target DATE they now are,
bucketed into 4 groups. Requested by the person, 2026-08-12;
anchoring corrected 2026-08-13 (see below).

Five charts total:
    - "Fit-Up & Welding" (combined) - there's no separate Fit-Up
      target anywhere in config/production_rules.json's target_days
      matrix, only Welding Finish - and SpoolRecord.current_stage
      (production/ageing.py) never distinguishes a spool stuck at
      Fit-Up from one stuck at Welding either, since TRACKED_STAGES'
      first entry is "welding_finish" with nothing before it. A
      single combined chart is therefore the only thing this
      dashboard's existing data model can support - not an
      arbitrary simplification.
    - PDQC, Release for Painting (RFP), PDI Clearance (Painting),
      and Packed, each on their own.

Anchoring rule - CORRECTED 2026-08-13 (given by the person, in their
own words): a stage's target date must be measured from when the
spool actually ARRIVED at that stage (the previous tracked stage's
own actual completion date), not from Planned Start cumulatively.
The first version of backlog.py had every stage's target anchored to
Planned Start + that stage's own cumulative target_days entry - the
same arithmetic already used for this dashboard's is_delayed flag
elsewhere, reused there deliberately for consistency. But that means
a spool delayed upstream (e.g. 25 days late through PDQC/RFP/
Painting) arrives at Packing with a target date ALREADY ~24 days in
the past, before Packing has even started - inheriting and
re-reporting the SAME upstream delay as if it were Packing's own
backlog, which it isn't. The person's own worked example: Planned
Start 1 Aug, cumulative schedule says Packing should be done by 18
Aug: if the spool actually reaches Packing (i.e. PDI Clearance
completes) on 20 Aug and gets packed the next day (21 Aug), that is
NOT a Packing backlog - it packed within its own 1-working-day
allotment of arriving. Only if it's still not packed by, say, 25 Aug
does it start counting (4 calendar days past ITS OWN target of 21
Aug - correctly lands in the 0-7 Days bucket).

So: target_date(stage) = add_working_days(arrival_date(stage),
incremental_target_days(stage)), where:
    - arrival_date(stage) is Planned Start for the FIRST stage in
      that category's own tracked_stages list (config/production_
      rules.json -> category_tracked_stages, defaulting to every
      category tracking the same 5 stages - see TRACKED_STAGES in
      ageing.py), or the ACTUAL date (SpoolRecord.stage_dates) the
      PREVIOUS tracked stage was completed, for every stage after
      the first.
    - incremental_target_days(stage) is that category's target_days
      matrix entry for this stage, minus its entry for the previous
      stage (or the entry for this stage as-is, unchanged, for the
      first stage - matching is_delayed's own definition exactly,
      since Planned Start IS that stage's arrival there).

This makes every chart measure only that specific operation's OWN
turnaround time, never someone else's upstream delay - "I don't want
to put blame of delays of other operations on packing team" (given
by the person, 2026-08-13). Applied uniformly to all 5 charts, per
the person's explicit instruction, not just Packing.

Bucketing rule (unchanged from 2026-08-12): today vs. that target
DATE, compared in plain CALENDAR days (not working days):
    - target date not yet reached (today <= target date):
      "No Backlog"
    - 1-7 calendar days past target: "0-7 Days"
    - 8-30 calendar days past target: "8-30 Days"
    - 31+ calendar days past target: "Beyond 30 Days"

Only spools whose CURRENT position (SpoolRecord.current_stage) is
exactly the stage in question are counted in that stage's chart. A
spool with no Planned Start has no anchor at all and is excluded
from every backlog chart entirely - same "no anchor, no ageing" rule
as the rest of this dashboard (production/ageing.py). A category
that doesn't track a given stage at all (currently just "loose",
which skips both welding_finish and packed) can never have
current_stage equal to that stage, so its spools are correctly,
automatically absent from that chart - no extra filtering needed.

Every bucket reports all four metrics already on SpoolRecord
(matching this dashboard's existing global metric switcher - see
METRICS in summary.py) plus a plain spool count. Each stage also
carries a full per-spool `rows` list (added 2026-08-13) - one row
per spool counted in that chart, with every field the person asked
for (Project, Drawing, Spool, Inch Dia, Weight, Surface Area,
Planned Week, Planned Start Date, every stage's actual crossing
date, and which of the 4 buckets it landed in) - the website's
"Export to Excel" button on each chart reads straight from this,
client-side, no second Python pass needed.
"""

from __future__ import annotations

from typing import Any

from production.ageing import SpoolRecord, TRACKED_STAGES
from utils import add_working_days, today

# (stage key in SpoolRecord.current_stage / target_days, display label)
BACKLOG_STAGES: list[tuple[str, str]] = [
    ("welding_finish", "Fit-Up & Welding"),
    ("pdqc", "PDQC"),
    ("release_for_painting", "Release for Painting"),
    ("pdi_clearance", "PDI Clearance (Painting)"),
    ("packed", "Packing"),
]

BUCKETS: list[str] = ["No Backlog", "0-7 Days", "8-30 Days", "Beyond 30 Days"]

METRIC_FIELDS: list[str] = ["quantity", "inch_dia", "weight", "surface_area"]

STAGE_DATE_EXPORT_LABELS: dict[str, str] = {
    "welding_finish": "Welding Finish Date",
    "pdqc": "PDQC Date",
    "release_for_painting": "Release for Painting Date",
    "pdi_clearance": "PDI Clearance Date",
    "packed": "Packed Date",
}


def _bucket_for(overdue_days: int) -> str:
    if overdue_days <= 0:
        return "No Backlog"
    if overdue_days <= 7:
        return "0-7 Days"
    if overdue_days <= 30:
        return "8-30 Days"
    return "Beyond 30 Days"


def _target_date_for_current_stage(
    record: SpoolRecord,
    stage: str,
    tracked_stages: list[str],
):
    """
    Returns the target DATE for `stage` - which must be
    record.current_stage - anchored to when the spool actually
    arrived at it, per the corrected rule in the module docstring.
    Returns None if that can't be computed (missing an actual date
    that should be present, or a category whose target_days matrix
    doesn't have both entries needed - defensive, shouldn't happen
    in practice given how current_stage itself is derived).
    """

    index = tracked_stages.index(stage)
    this_target = record.target_days.get(stage)
    if this_target is None:
        return None

    if index == 0:
        # First tracked stage for this category - it "arrives" at
        # Planned Start itself, matching is_delayed's own definition
        # exactly (current_age_days = days_between(planned_start,
        # today), compared against target_days[stage] unchanged).
        return add_working_days(record.planned_start, this_target)

    previous_stage = tracked_stages[index - 1]
    arrival_date = record.stage_dates.get(previous_stage)
    previous_target = record.target_days.get(previous_stage)

    if arrival_date is None or previous_target is None:
        return None

    incremental_target = this_target - previous_target
    return add_working_days(arrival_date, incremental_target)


def _export_row(
    record: SpoolRecord,
    category_label: str,
    bucket: str,
) -> dict[str, Any]:

    row: dict[str, Any] = {
        "Project Code": record.project_code,
        "Project Name": record.project_name,
        "Drawing No": record.drawing_no,
        "Spool No": record.spool_no,
        "Category": category_label,
        "Quantity": record.quantity,
        "Inch Dia": record.inch_dia,
        "Weight": record.weight,
        "Surface Area": record.surface_area,
        "Planned Week": record.week,
        "Planned Start Date": (
            record.planned_start.isoformat() if record.planned_start else None
        ),
    }

    for stage in TRACKED_STAGES:
        stage_date = record.stage_dates.get(stage)
        row[STAGE_DATE_EXPORT_LABELS[stage]] = (
            stage_date.isoformat() if stage_date else None
        )

    row["Backlog Category"] = bucket

    return row


def build_backlog_chart(
    records: list[SpoolRecord],
    stage: str,
    category_meta: dict[str, dict[str, Any]],
    category_tracked_stages: dict[str, list[str]],
) -> dict[str, Any]:
    """
    One stage's full result: a 4-bucket breakdown across every
    metric (`buckets`, always all 4 buckets even when empty - zeros,
    not omitted, so the website's chart always has a stable shape),
    plus the full per-spool `rows` list behind it (for the Excel
    export). Built in a single pass so the two can never disagree
    with each other.
    """

    totals = {
        bucket: {
            "spool_count": 0, "quantity": 0.0, "inch_dia": 0.0,
            "weight": 0.0, "surface_area": 0.0,
        }
        for bucket in BUCKETS
    }
    rows: list[dict[str, Any]] = []

    for record in records:

        if record.planned_start is None:
            continue
        if record.current_stage != stage:
            continue

        tracked_stages = category_tracked_stages.get(
            record.category_key, TRACKED_STAGES
        )
        if stage not in tracked_stages:
            continue

        target_date = _target_date_for_current_stage(
            record, stage, tracked_stages
        )
        if target_date is None:
            continue

        overdue_days = (today() - target_date).days
        bucket = _bucket_for(overdue_days)

        totals[bucket]["spool_count"] += 1
        for field in METRIC_FIELDS:
            value = getattr(record, field)
            if value is not None:
                totals[bucket][field] += value

        category_label = category_meta.get(record.category_key, {}).get(
            "label", record.category_key
        )
        rows.append(_export_row(record, category_label, bucket))

    buckets = [
        {
            "bucket": bucket,
            "spool_count": int(totals[bucket]["spool_count"]),
            "quantity": round(totals[bucket]["quantity"], 2),
            "inch_dia": round(totals[bucket]["inch_dia"], 1),
            "weight": round(totals[bucket]["weight"], 1),
            "surface_area": round(totals[bucket]["surface_area"], 2),
        }
        for bucket in BUCKETS
    ]

    return {"buckets": buckets, "rows": rows}


def build_backlog_summary(
    records: list[SpoolRecord],
    category_meta: dict[str, dict[str, Any]],
    category_tracked_stages: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """
    Top-level entry point - src/production/pipeline.py calls this
    and drops the result straight into the bundle under "backlog".
    One entry per BACKLOG_STAGES tuple, keyed by stage key (e.g.
    "welding_finish", "pdqc", ...), each holding its display label,
    4-bucket breakdown, and per-spool export rows.
    """

    category_tracked_stages = category_tracked_stages or {}

    result = {}
    for stage, label in BACKLOG_STAGES:
        chart = build_backlog_chart(
            records, stage, category_meta, category_tracked_stages
        )
        result[stage] = {
            "label": label,
            "buckets": chart["buckets"],
            "rows": chart["rows"],
        }
    return result
