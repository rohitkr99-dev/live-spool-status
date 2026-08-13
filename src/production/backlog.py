"""
src/production/backlog.py
---------------------------------------------------------
Backlog by operation: for spools currently stuck AT a given
tracked stage, how far past that stage's target DATE they now are,
bucketed into 4 groups. Requested by the person, 2026-08-12.

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

Bucketing rule (given by the person, in their own words): a spool's
target DATE for its current stage is Planned Start plus that
category's target_days[stage] WORKING days - reusing the exact same
number and the exact same working-day arithmetic already used for
this dashboard's own is_delayed flag (production/ageing.py), via the
new add_working_days() in utils.py, so a spool counted "on time"
here is on time by the same definition as everywhere else on this
page. Today vs. that target DATE is then compared in plain CALENDAR
days (not working days) to decide the bucket - simpler and more
intuitive for "how many days overdue", matching the person's own
worked example (target 10-08-26 -> 12-08-26 is 2 days overdue, no
weekend-skipping implied by their count):
    - target date not yet reached (today <= target date):
      "No Backlog"
    - 1-7 calendar days past target: "0-7 Days"
    - 8-30 calendar days past target: "8-30 Days"
    - 31+ calendar days past target: "Beyond 30 Days"

Only spools whose CURRENT position (SpoolRecord.current_stage) is
exactly the stage in question are counted in that stage's chart - a
spool that has already moved on isn't "stuck" there any more, and a
spool that hasn't reached an earlier stage yet isn't there yet
either (it shows up in that EARLIER stage's chart instead). A spool
with no Planned Start has no target date to compare against and is
excluded from every backlog chart entirely - same "no anchor, no
ageing" rule as the rest of this dashboard (production/ageing.py).
A category that doesn't track a given stage at all (currently just
"loose", which skips both welding_finish and packed - see
config/production_rules.json -> category_tracked_stages) can never
have current_stage equal to that stage, so its spools are correctly,
automatically absent from that chart - no extra filtering needed.

Every bucket reports all four metrics already on SpoolRecord
(matching this dashboard's existing global metric switcher - see
METRICS in summary.py) plus a plain spool count, so the website can
switch between them without a second Python pass.
"""

from __future__ import annotations

from typing import Any

from production.ageing import SpoolRecord
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


def _bucket_for(overdue_days: int) -> str:
    if overdue_days <= 0:
        return "No Backlog"
    if overdue_days <= 7:
        return "0-7 Days"
    if overdue_days <= 30:
        return "8-30 Days"
    return "Beyond 30 Days"


def _empty_bucket_totals() -> dict[str, float]:
    return {
        "spool_count": 0,
        "quantity": 0.0,
        "inch_dia": 0.0,
        "weight": 0.0,
        "surface_area": 0.0,
    }


def build_backlog_chart(
    records: list[SpoolRecord], stage: str
) -> list[dict[str, Any]]:
    """
    One stage's 4-bucket breakdown across every metric. Always
    returns all 4 buckets in BUCKETS order, even when a bucket is
    empty (zeros, not omitted) - so the website's stacked bar always
    has a consistent, stable shape to render.
    """

    totals = {bucket: _empty_bucket_totals() for bucket in BUCKETS}

    for record in records:

        if record.planned_start is None:
            continue
        if record.current_stage != stage:
            continue

        target_days = record.target_days.get(stage)
        if target_days is None:
            continue

        target_date = add_working_days(record.planned_start, target_days)
        overdue_days = (today() - target_date).days
        bucket = _bucket_for(overdue_days)

        totals[bucket]["spool_count"] += 1
        for field in METRIC_FIELDS:
            value = getattr(record, field)
            if value is not None:
                totals[bucket][field] += value

    return [
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


def build_backlog_summary(records: list[SpoolRecord]) -> dict[str, Any]:
    """
    Top-level entry point - src/production/pipeline.py calls this
    and drops the result straight into the bundle under "backlog".
    One entry per BACKLOG_STAGES tuple, keyed by stage key (e.g.
    "welding_finish", "pdqc", ...), each holding its display label
    and 4-bucket build_backlog_chart() result.
    """

    return {
        stage: {
            "label": label,
            "buckets": build_backlog_chart(records, stage),
        }
        for stage, label in BACKLOG_STAGES
    }
