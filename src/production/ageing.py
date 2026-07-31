"""
src/production/ageing.py
---------------------------------------------------------
For every spool: which of the 5 target stages (Welding Finish,
PDQC, Release for Painting, PDI Clearance, Packed) it has reached,
how many days that took from Planned Start, and how that compares
to the category's target-day matrix (config/production_rules.json).

This is a separate, purpose-built rule for this dashboard - not a
reuse of the existing Projects pipeline's Stage Age / Total Age
logic (src/ageing.py). Confirmed with the project owner: any spool
that hasn't yet reached its next target stage is aged as
Today - Planned Start (not Today - previous-stage-date), and a
spool with no Planned Start at all is left out of ageing (it has no
anchor to measure from) but still counted in the category
distribution.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from utils import create_composite_key, days_between, parse_date, today
from production.classify import classify_category
from production.welding_finish import determine_welding_finish

# Stages (after Planned Start) walked in order to find each spool's
# "current" (first not-yet-reached) stage.
TRACKED_STAGES = [
    "welding_finish",
    "pdqc",
    "release_for_painting",
    "pdi_clearance",
    "packed",
]


@dataclass
class SpoolRecord:
    composite_key: str
    project_code: str
    drawing_no: str
    spool_no: str
    category_key: str
    planned_start: date | None
    stage_dates: dict[str, date | None] = field(default_factory=dict)
    welding_status: str = ""
    stage_actual_days: dict[str, int | None] = field(default_factory=dict)
    current_stage: str | None = None
    current_age_days: int | None = None
    is_complete: bool = False
    is_delayed: bool = False
    target_days: dict[str, int] = field(default_factory=dict)


def build_spool_records(
    fabrication_df,
    master_planning_df,
    line_history_lookup,
    welding_db_lookup,
    rules: dict,
) -> list[SpoolRecord]:

    fields = rules["welding_finish_fields"]

    planned_start_lookup: dict[str, date] = {}
    for row_dict in master_planning_df.to_dict(orient="records"):
        ck = create_composite_key(
            row_dict.get("Project Code"),
            row_dict.get("Drawing No"),
            row_dict.get("Spool No"),
        )
        planned_start = parse_date(row_dict.get(fields["planned_start_field"]))
        if planned_start is not None:
            planned_start_lookup[ck] = planned_start

    target_matrix = rules["target_days"]
    records: list[SpoolRecord] = []

    for row in fabrication_df.to_dict(orient="records"):

        ck = create_composite_key(
            row.get("Project Code"),
            row.get("Drawing No"),
            row.get("Spool No"),
        )

        category_key = classify_category(row, rules, fields)
        target_days = target_matrix[category_key]

        welding_finish_date, welding_status = determine_welding_finish(
            ck,
            row.get(fields["pdqc_field"]),
            line_history_lookup,
            welding_db_lookup,
        )

        planned_start = planned_start_lookup.get(ck)

        stage_dates: dict[str, date | None] = {
            "welding_finish": welding_finish_date,
            "pdqc": parse_date(row.get(fields["pdqc_field"])),
            "release_for_painting": parse_date(
                row.get(fields["release_for_painting_field"])
            ),
            "pdi_clearance": parse_date(row.get(fields["pdi_clearance_field"])),
            "packed": parse_date(row.get(fields["packed_field"])),
        }

        record = SpoolRecord(
            composite_key=ck,
            project_code=str(row.get("Project Code") or ""),
            drawing_no=str(row.get("Drawing No") or ""),
            spool_no=str(row.get("Spool No") or ""),
            category_key=category_key,
            planned_start=planned_start,
            stage_dates=stage_dates,
            welding_status=welding_status,
            target_days=target_days,
        )

        if planned_start is not None:
            for stage in TRACKED_STAGES:
                stage_date = stage_dates.get(stage)
                record.stage_actual_days[stage] = (
                    days_between(planned_start, stage_date)
                    if stage_date is not None
                    else None
                )

            record.is_complete = stage_dates.get("packed") is not None

            current_stage = None
            for stage in TRACKED_STAGES:
                if stage_dates.get(stage) is None:
                    current_stage = stage
                    break
            record.current_stage = current_stage

            if current_stage is None:
                # Fully packed - use actual Packed days as the final
                # position, no "current age" clock still running.
                record.current_age_days = record.stage_actual_days.get("packed")
                target_for_position = target_days.get("packed")
            else:
                record.current_age_days = days_between(planned_start, today())
                target_for_position = target_days.get(current_stage)

            if target_for_position is not None and record.current_age_days is not None:
                record.is_delayed = record.current_age_days > target_for_position

        records.append(record)

    return records
