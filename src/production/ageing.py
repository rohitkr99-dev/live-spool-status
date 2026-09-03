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

from utils import (
    create_composite_key,
    days_between,
    is_empty,
    material_hold_working_days_lost,
    parse_date,
    today,
)
import hold_ledger
from production.classify import classify_category
from rework_pdqc_rule import REWORK_LATEST_STATUS
from welding_finish import determine_welding_finish

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
    currently_on_hold: bool = False

    # "Accept" / "Rework" / "Hold" / None, straight off the
    # Fabrication dataframe's "Rework Latest Status" column - set by
    # rework_pdqc_rule.apply_rework_pdqc_rule() (called in
    # production/pipeline.py before build_spool_records() runs) from
    # the Production Rework Data workbook's latest offer event for
    # this spool. None means the workbook didn't cover this spool at
    # all (its PDQC/RFP are untouched by that rule). See backlog.py -
    # a spool with "Rework" here is excluded from every backlog chart
    # the exact same way currently_on_hold spools already are (both
    # mean "blocked by QC, not a genuine stage delay") - confirmed
    # 2026-09-03: 49 of 73 spools in the Release for Painting "Beyond
    # 30 Days" bucket were actually in Rework, not a real backlog.
    rework_latest_status: str | None = None

    # From the Weekly Production Planning workbook's "Week Planned"
    # vs "Initial Week Planned" gap (2026-08-26, given by the
    # person) - see utils.material_hold_working_days_lost(). Already
    # subtracted from current_age_days/stage_actual_days below;
    # exposed here too so it's visible on the record itself, same
    # spirit as currently_on_hold.
    material_hold_days_lost: int = 0
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
    hold_tracking_path=hold_ledger.DEFAULT_HOLD_LEDGER_PATH,
) -> tuple[list[SpoolRecord], int]:
    """
    Returns (records, excluded_not_released_count). See Rule 0 in
    the module docstring above - excluded_not_released_count is how
    many DPR rows were dropped for having no Prod Order Release
    date, purely for KPI transparency.

    Hold handling (2026-08-21, given by the person - see
    hold_ledger.py and src/rework_pdqc_rule.py): a spool with an
    open Hold period is excluded from delayed/backlog status
    (is_delayed forced False regardless of the target comparison -
    src/production/backlog.py additionally excludes it from the
    backlog chart entirely) and every stage/current age is reduced
    by however many WORKING days it has genuinely spent on Hold, per
    the Hold ledger - wherever that Hold period's dates overlap the
    age window being measured, whether that's before or after RFP.
    """

    hold_store = hold_ledger.load_ledger(hold_tracking_path)

    fields = rules["welding_finish_fields"]

    planned_start_lookup: dict[str, date] = {}
    planned_start_source: dict[str, str] = {}
    material_hold_days_lost_lookup: dict[str, int] = {}
    reference_today = today()
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

        days_lost = material_hold_working_days_lost(
            row_dict.get("Initial Week Planned"),
            row_dict.get("Week"),
            reference_today,
        )
        if days_lost:
            material_hold_days_lost_lookup[ck] = days_lost

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

        record.currently_on_hold = hold_ledger.is_currently_on_hold(hold_store, ck)
        record.material_hold_days_lost = material_hold_days_lost_lookup.get(ck, 0)
        record.rework_latest_status = row.get(REWORK_LATEST_STATUS) or None

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
                if stage_date is not None:
                    raw = days_between(planned_start, stage_date)
                    held = hold_ledger.working_days_held_between(
                        hold_store, ck, planned_start, stage_date
                    )
                    record.stage_actual_days[stage] = max(raw - held, 0)
                else:
                    record.stage_actual_days[stage] = None

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
                right_now = today()
                raw_current_age = days_between(planned_start, right_now)
                held_current = hold_ledger.working_days_held_between(
                    hold_store, ck, planned_start, right_now
                )
                record.current_age_days = max(raw_current_age - held_current, 0)
                target_for_position = target_days.get(current_stage)

            # Material/Hold Status ageing reduction (2026-08-26, given
            # by the person - see utils.material_hold_working_days_lost()).
            # Unlike the Rework Hold ledger above, this is a single flat
            # number with no real start/end dates behind it, so it can
            # only reduce the overall current_age_days figure - it can't
            # be attributed to one specific stage's stage_actual_days the
            # way a real dated Hold period can.
            if record.current_age_days is not None and record.material_hold_days_lost:
                record.current_age_days = max(
                    record.current_age_days - record.material_hold_days_lost, 0
                )

            if target_for_position is not None and record.current_age_days is not None:
                record.is_delayed = record.current_age_days > target_for_position

            if record.currently_on_hold:
                # Given by the person (2026-08-21): "The hold spools
                # should not be visible as backlog at any stage" -
                # never show as delayed while a Hold is open, no
                # matter what the (already Hold-day-adjusted)
                # current_age_days vs target comparison says.
                record.is_delayed = False

        records.append(record)

    return records, excluded_not_released
