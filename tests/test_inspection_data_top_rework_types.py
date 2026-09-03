"""
Unit tests for src/quality/summary.py's build_top_rework_types()
(2026-09-03) - switched from the Rework Data workbook to the
Inspection Data workbook, per the person's explicit instruction
("Yes, replace it"), with defect types consolidated from the raw
Final Status free text via INSPECTION_DEFECT_TYPE_CATEGORIES /
INSPECTION_REMARK_DEFECT_KEYWORDS.
"""

import pandas as pd
import pytest

from constants import INSPECTION_REOFFERED_BEFORE_ACCEPT
from quality.summary import _classify_inspection_defect_type, build_top_rework_types


@pytest.mark.parametrize(
    "final_status,expected",
    [
        ("Dim", "Dimension"),
        ("dim", "Dimension"),
        ("Bend", "Bend"),
        ("Degree", "Degree"),
        ("Bevel", "Bevel"),
        ("Punching Bal", "Punching"),
        ("MSN Punch Bal", "Punching"),
        ("Tag Wrong", "Tag"),
        ("MSN Tag Balance", "Tag"),
        ("Orientation", "Orientation"),
        ("Valve Tilt", "Orientation"),
        ("Hold For Sockolet", "Hold / Query"),
        ("FFW Query", "Hold / Query"),
        ("Inside Cleaning Bal", "Inside Cleaning"),
        ("Not Found", "Not Found"),
        ("Some Brand New Wording Never Seen Before", "Unclassified"),
        ("", "Unclassified"),
        (None, "Unclassified"),
    ],
)
def test_classify_by_final_status(final_status, expected):
    assert _classify_inspection_defect_type(final_status, None, reoffered_before_accept=False) == expected


@pytest.mark.parametrize(
    "remark,expected",
    [
        ("tag/punching balance, SS tag required", "Tag"),
        ("tag balance, SS tag required", "Tag"),
        ("Handwheel not available", "Handwheel / Valve"),
        ("Satisfactory", "Unclassified"),
        ('2" nozzle height required 300 observed 284 / accept as per latest revision', "Dimension"),
        ("scaling inside pipe-need inside blasting / accept as per sony sir", "Inside Cleaning"),
        ("DCR-31 FOR ADD JOINT AND MSN, compound bevel not ok", "Bevel"),
        ("Compound bevel not ok, BEVEL POLISH BALANCE", "Bevel"),
        (
            "valve casting defect 25-02-2026, valve inside visual not ok, "
            "Handwheel in +X direction but need +Y",
            "Orientation",
        ),
        (None, "Unclassified"),
    ],
)
def test_classify_reoffered_before_accept_by_remark(remark, expected):
    """
    Same real remark text from the 15 rows found in the person's
    actual file (2026-09-02/03) - bevel/tag/nozzle keywords are
    checked before the generic "handwheel" keyword, so a remark that
    explicitly names a direction/orientation correction (the valve
    casting example) lands under Orientation, not a generic
    Handwheel/Valve bucket - while a bare "Handwheel not available"
    (no direction wording) still correctly falls through to
    Handwheel / Valve.
    """
    assert _classify_inspection_defect_type(
        "Accept", remark, reoffered_before_accept=True
    ) == expected


def _row(project, spool, status, reoffered=False, remark=None):
    return {
        "Project Code": project,
        "Drawing No": "DRW-01",
        "Spool No": spool,
        "Prod Offer Date": pd.Timestamp("2026-08-01"),
        "Final Status": status,
        "Insp Remark": remark,
        INSPECTION_REOFFERED_BEFORE_ACCEPT: reoffered,
    }


def test_build_top_rework_types_ranks_and_folds_others():
    df = pd.DataFrame([
        _row("TJ/25-26/183", "S1", "Dim"),
        _row("TJ/25-26/183", "S2", "Dim"),
        _row("TJ/25-26/183", "S3", "Dim"),
        _row("TJ/25-26/183", "S4", "Bend"),
        _row("TJ/25-26/183", "S5", "Bend"),
        _row("TJ/25-26/183", "S6", "Degree"),
        _row("TJ/25-26/183", "S7", "Accept"),  # excluded
        _row("TJ/25-26/183", "S8", "Hold"),  # excluded (Other, not Rework)
    ])

    result = build_top_rework_types(df, top_n=2)

    assert result["total_rework_events"] == 6  # Accept + Hold excluded
    assert result["items"] == [
        {"label": "Dimension", "count": 3, "pct": 50.0},
        {"label": "Bend", "count": 2, "pct": 33.3},
        {"label": "Others", "count": 1, "pct": 16.7},
    ]


def test_build_top_rework_types_includes_reoffered_before_accept_rows():
    df = pd.DataFrame([
        _row("TJ/25-26/183", "S1", "Dim"),
        _row(
            "TJ/25-26/183", "S2", "Accept",
            reoffered=True, remark="tag balance, SS tag required",
        ),
    ])

    result = build_top_rework_types(df, top_n=10)

    labels = {item["label"]: item["count"] for item in result["items"]}
    assert labels["Dimension"] == 1
    assert labels["Tag"] == 1
    assert result["total_rework_events"] == 2


def test_build_top_rework_types_no_others_bucket_when_everything_fits():
    df = pd.DataFrame([_row("TJ/25-26/183", "S1", "Dim")])

    result = build_top_rework_types(df, top_n=10)

    assert [item["label"] for item in result["items"]] == ["Dimension"]


def test_build_top_rework_types_empty_dataframe():
    df = pd.DataFrame(columns=[
        "Project Code", "Drawing No", "Spool No", "Prod Offer Date",
        "Final Status", "Insp Remark", INSPECTION_REOFFERED_BEFORE_ACCEPT,
    ])

    result = build_top_rework_types(df, top_n=10)

    assert result == {"items": [], "total_rework_events": 0}
