"""
Unit tests for production/summary.py -> build_hold_by_project_stage()
(2026-08-21 - the "currently on Hold, by Project and stage" chart
the person asked for).
"""

from production.ageing import SpoolRecord
from production.summary import build_hold_by_project_stage


STAGE_LABELS = {
    "welding_finish": "Welding Finish", "pdqc": "PDQC",
    "release_for_painting": "Release for Painting",
    "pdi_clearance": "PDI Clearance", "packed": "Packed",
}


def _record(project_name, current_stage, currently_on_hold):
    return SpoolRecord(
        composite_key="P|D|S", project_code="P001", drawing_no="D001",
        spool_no="S001", category_key="le8_cs_ss", planned_start=None,
        project_name=project_name, current_stage=current_stage,
        currently_on_hold=currently_on_hold,
    )


def test_only_currently_held_spools_are_counted():
    records = [
        _record("Project A", "pdqc", True),
        _record("Project A", "pdi_clearance", False),  # not on hold - excluded
    ]

    result = build_hold_by_project_stage(records, STAGE_LABELS)

    assert result == {"Project A": {"PDQC": 1}}


def test_groups_by_project_and_stage_label():
    records = [
        _record("Project A", "pdqc", True),
        _record("Project A", "pdqc", True),
        _record("Project A", "pdi_clearance", True),
        _record("Project B", "release_for_painting", True),
    ]

    result = build_hold_by_project_stage(records, STAGE_LABELS)

    assert result == {
        "Project A": {"PDQC": 2, "PDI Clearance": 1},
        "Project B": {"Release for Painting": 1},
    }


def test_no_held_spools_returns_empty_dict():
    records = [_record("Project A", "pdqc", False)]
    assert build_hold_by_project_stage(records, STAGE_LABELS) == {}


def test_missing_current_stage_falls_back_to_placeholder_label():
    records = [_record("Project A", None, True)]
    result = build_hold_by_project_stage(records, STAGE_LABELS)
    assert result == {"Project A": {"(Stage Unknown)": 1}}
