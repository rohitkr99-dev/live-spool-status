"""
src/production/ageing.py
---------------------------------------------------------
For every spool: which of its category's target stages it has
reached, how many days that took from Planned Start, and how that
compares to the category's target-day matrix (config/production_
rules.json). Most categories track the same 5 stages (Welding
Finish, PDQC, Release for Painting, PDI Clearance, Packed); "loose"
tracks only 3 (see config/production_rules.json ->
category_tracked_stages) - which stages apply to a given spool is
looked up per-category below, not assumed to be the same list for
everyone.

This is a separate, purpose-built rule for this dashboard - not a
reuse of the existing Projects pipeline's Stage Age / Total Age
logic (src/ageing.py). Confirmed with the project owner: any spool
that hasn't yet reached its next target stage is aged as
Today - Planned Start (not Today - previous-stage-date), and a
spool with no Planned Start at all is left out of ageing (it has no
anchor to measure from) but still counted in the category
distribution.

Rule 0 (checked first, same principle as business_rules.py's
"Production Order Not Released" rule for the Projects pipeline): a
spool whose Prod Order Release date is blank hasn't been released
to production yet and is excluded from this dashboard entirely -
not counted in the category distribution, ageing, or any chart.
Confirmed with the project owner: this dashboard should only ever
cover released spools; a released-but-Planned-Start-missing spool
is a real gap worth surfacing, an unreleased spool with no Planned
Start is expected and not a gap at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from utils import create_composite_key, days_between, is_empty, parse_date, today
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


def _to_float(value) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if result != result else result  # NaN check without importing math/pandas


@dataclass
class SpoolRecord:
    composite_key: str
    project_code: str
    drawing_no: str
    spool_no: str
    category_key: str
    planned_start: date | None
    planned_start_source: str | None = None
    stage_dates: dict[str, date | None] = field(default_factory=dict)
    welding_status: str = ""
    stage_actual_days: dict[str, int | None] = field(default_factory=dict)
    project_name: str = ""
    current_stage: str | None = None
    current_age_days: int | None = None
    is_complete: bool = False
    is_delayed: bool = False
    target_days: dict[str, int] = field(default_factory=dict)
    material: str = ""
    spool_size: float | None = None
    inch_dia: float | None = None
    quantity: float | None = None
    weight: float | None = None
    surface_area: float | None = None
    week: str = ""


def build_spool_records(
    fabrication_df,
    master_planning_df,
    line_history_lookup,
    welding_db_lookup,
    rules: dict,
    siop_planned_df=None,
) -> tuple[list[SpoolRecord], int]:
    """
    Returns (records, excluded_not_released_count). See Rule 0 in
    the module docstring above - excluded_not_released_count is how
    many DPR rows were dropped for having no Prod Order Release
    date, purely for KPI transparency.
    """

    fields = rules["welding_finish_fields"]

    planned_start_lookup: dict[str, date] = {}
    planned_start_source: dict[str, str] = {}
    for row_dict in master_planning_df.to_dict(orient="records"):
        ck = create_composite_key(
            row_dict.get("Project Code"),
            row_dict.get("Drawing No"),
            row_dict.get("Spool No"),
        )
        planned_start = parse_date(row_dict.get(fields["planned_start_field"]))
        if planned_start is not None:
            planned_start_lookup[ck] = planned_start
            planned_start_source[ck] = "weekly"

    # SIOP fallback: only fills a gap the Master Planning Sheet left
    # blank, never overrides it - see config/production_rules.json ->
    # welding_finish_fields.siop_comment.
    if siop_planned_df is not None and not siop_planned_df.empty:
        for row_dict in siop_planned_df.to_dict(orient="records"):
            ck = create_composite_key(
                row_dict.get("Project Code"),
                row_dict.get("Drawing No"),
                row_dict.get("Spool No"),
            )
            if ck in planned_start_lookup:
                continue
            siop_start = parse_date(row_dict.get(fields["siop_planned_start_field"]))
            if siop_start is not None:
                planned_start_lookup[ck] = siop_start
                planned_start_source[ck] = "siop"

    target_matrix = rules["target_days"]
    category_tracked_stages = rules.get("category_tracked_stages", {})
    records: list[SpoolRecord] = []

    release_field = fields["prod_order_release_field"]
    total_rows = len(fabrication_df)
    fabrication_df = fabrication_df[
        ~fabrication_df[release_field].apply(is_empty)
    ]
    excluded_not_released = total_rows - len(fabrication_df)

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
            project_name=str(row.get("Project Name") or ""),
            drawing_no=str(row.get("Drawing No") or ""),
            spool_no=str(row.get("Spool No") or ""),
            category_key=category_key,
            planned_start=planned_start,
            planned_start_source=planned_start_source.get(ck),
            stage_dates=stage_dates,
            welding_status=welding_status,
            target_days=target_days,
            material=str(row.get(fields["material_field"]) or ""),
            spool_size=_to_float(row.get(fields["spool_size_field"])),
            inch_dia=_to_float(row.get(fields["inch_dia_field"])),
            quantity=_to_float(row.get(fields["quantity_field"])),
            weight=_to_float(row.get(fields["weight_field"])),
            surface_area=_to_float(row.get(fields["surface_area_field"])),
            week=str(row.get("Week") or ""),
        )

        # Which stages actually apply to this spool's category - the 5
        # standard ones for every category except an entry in
        # category_tracked_stages (currently just "loose", which skips
        # welding_finish entirely and has no separate "packed" milestone -
        # see config/production_rules.json for why).
        tracked_stages = category_tracked_stages.get(category_key, TRACKED_STAGES)
        last_stage = tracked_stages[-1]

        if planned_start is not None:
            for stage in tracked_stages:
                stage_date = stage_dates.get(stage)
                record.stage_actual_days[stage] = (
                    days_between(planned_start, stage_date)
                    if stage_date is not None
                    else None
                )

            record.is_complete = stage_dates.get(last_stage) is not None

            current_stage = None
            for stage in tracked_stages:
                if stage_dates.get(stage) is None:
                    current_stage = stage
                    break
            record.current_stage = current_stage

            if current_stage is None:
                # Fully through its last tracked stage - use that
                # stage's actual days as the final position, no
                # "current age" clock still running.
                record.current_age_days = record.stage_actual_days.get(last_stage)
                target_for_position = target_days.get(last_stage)
            else:
                record.current_age_days = days_between(planned_start, today())
                target_for_position = target_days.get(current_stage)

            if target_for_position is not None and record.current_age_days is not None:
                record.is_delayed = record.current_age_days > target_for_position

        records.append(record)

    return records, excluded_not_released
