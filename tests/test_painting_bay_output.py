"""
Unit tests for the 2026-09-04 "Output by Bay" addition to the Painting
dashboard (per the person's request): compare each bay's (Bay-4 /
Bay-6 / Bay-6 Auto) output per day/week/month, one process at a time.

Covers both halves:
  - _canonical_bay(): the real workbook's BAY NO column mixes case
    ("BAY-4" vs "Bay-4") and uses literal "NA" for spools with no bay
    assigned - confirmed against the real Painting Weekly Plan file
    (2026-09-04): 1720 "BAY-4" + 200 "Bay-4", 1392 "BAY-6" + 446
    "BAY-6 " + 9 "Bay-6 ", 685 "BAY-6 AUTO", 559 "NA".
  - build_bay_output_trend(): groups merged spool records by bay and
    period for each of the six OUTPUT_TREND_STAGES processes, mirroring
    build_stage_output_trend()'s own grouping exactly, just split by
    bay instead of totalled.
"""

from painting.summary import _canonical_bay, build_bay_output_trend


def _record(bay_no=None, internal_blasting_date=None, primer_date=None, surface_area=1.0):
    return {
        "bay_no": bay_no,
        "internal_blasting_date": internal_blasting_date,
        "external_blasting_date": None,
        "primer_date": primer_date,
        "pickling_date": None,
        "pdi_offer_date": None,
        "pdi_clearance_date": None,
        "surface_area": surface_area,
    }


# ---------------------------------------------------------------
# _canonical_bay()
# ---------------------------------------------------------------

def test_canonical_bay_normalizes_case():
    assert _canonical_bay("BAY-4") == "BAY-4"
    assert _canonical_bay("Bay-4") == "BAY-4"


def test_canonical_bay_trims_whitespace():
    assert _canonical_bay("BAY-6 ") == "BAY-6"
    assert _canonical_bay(" Bay-6 ") == "BAY-6"


def test_canonical_bay_keeps_auto_distinct():
    assert _canonical_bay("BAY-6 AUTO") == "BAY-6 AUTO"
    assert _canonical_bay("BAY-6 AUTO") != _canonical_bay("BAY-6")


def test_canonical_bay_na_is_none():
    assert _canonical_bay("NA") is None
    assert _canonical_bay("na") is None


def test_canonical_bay_blank_or_missing_is_none():
    assert _canonical_bay(None) is None
    assert _canonical_bay("") is None


# ---------------------------------------------------------------
# build_bay_output_trend()
# ---------------------------------------------------------------

def test_bays_list_is_sorted_and_excludes_unassigned():
    merged = [
        _record(bay_no="BAY-6", internal_blasting_date="2026-01-05"),
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05"),
        _record(bay_no=None, internal_blasting_date="2026-01-05"),  # unassigned - not a bay
    ]
    result = build_bay_output_trend(merged)
    assert result["bays"] == ["BAY-4", "BAY-6"]


def test_daily_counts_split_by_bay():
    merged = [
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05"),
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05"),
        _record(bay_no="BAY-6", internal_blasting_date="2026-01-05"),
    ]
    result = build_bay_output_trend(merged)
    daily = result["stages"]["internal_blasting"]["daily"]
    assert len(daily) == 1
    row = daily[0]
    assert row["period"] == "2026-01-05"
    assert row["BAY-4"]["count"] == 2
    assert row["BAY-6"]["count"] == 1


def test_every_period_row_has_an_entry_for_every_bay_even_if_zero():
    merged = [
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05"),
        _record(bay_no="BAY-6", internal_blasting_date="2026-01-06"),
    ]
    result = build_bay_output_trend(merged)
    daily = result["stages"]["internal_blasting"]["daily"]
    for row in daily:
        assert set(row.keys()) == {"period", "BAY-4", "BAY-6"}


def test_surface_area_summed_per_bay():
    merged = [
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05", surface_area=2.5),
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05", surface_area=1.5),
    ]
    result = build_bay_output_trend(merged)
    row = result["stages"]["internal_blasting"]["daily"][0]
    assert row["BAY-4"]["surface_area"] == 4.0


def test_spool_with_no_date_for_stage_not_counted():
    merged = [_record(bay_no="BAY-4", internal_blasting_date=None)]
    result = build_bay_output_trend(merged)
    assert result["stages"]["internal_blasting"]["daily"] == []


def test_each_process_grouped_independently():
    merged = [
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05", primer_date="2026-01-10"),
    ]
    result = build_bay_output_trend(merged)
    assert result["stages"]["internal_blasting"]["daily"][0]["period"] == "2026-01-05"
    assert result["stages"]["primer"]["daily"][0]["period"] == "2026-01-10"


def test_no_bays_returns_empty_list_and_no_rows():
    merged = [_record(bay_no=None, internal_blasting_date="2026-01-05")]
    result = build_bay_output_trend(merged)
    assert result["bays"] == []
    assert result["stages"]["internal_blasting"]["daily"] == []


def test_weekly_and_monthly_also_split_by_bay():
    merged = [
        _record(bay_no="BAY-4", internal_blasting_date="2026-01-05"),
        _record(bay_no="BAY-6", internal_blasting_date="2026-01-06"),
    ]
    result = build_bay_output_trend(merged)
    weekly = result["stages"]["internal_blasting"]["weekly"]
    monthly = result["stages"]["internal_blasting"]["monthly"]
    assert len(weekly) == 1  # same ISO week
    assert weekly[0]["BAY-4"]["count"] == 1
    assert weekly[0]["BAY-6"]["count"] == 1
    assert len(monthly) == 1
    assert monthly[0]["BAY-4"]["count"] == 1
    assert monthly[0]["BAY-6"]["count"] == 1
