"""
Oldest Spool KPI (2026-11-16): the card shows the oldest spool that is still IN
THE PROCESS - some work done, not packed yet. Packed spools, spools not even
released, and loose items with no work at all (e.g. "JACKSCREW &PLUG") never
headline it. The oldest spool including packed ones is kept as a second figure.
"""

import pandas as pd
import pytest

from summary import SummaryEngine


@pytest.fixture
def engine():
    return SummaryEngine()


def _row(spool, age, stage="Fit-Up", completed=False, **dates):
    base = {
        "Composite Key": f"P1|D1|{spool}",
        "Project Code": "P1",
        "Project Name": "Project One",
        "Drawing No": "D1",
        "Spool No": spool,
        "Current Stage": stage,
        "Total Age": age,
        "Completed": completed,
        "Planned": True,
        "Planning Variance": 0,
        "First Fit-Up": None,
        "First Welding": None,
        "Welding Finish": None,
        "PDQC": None,
        "RFP": None,
        "PDI": None,
        "Packing": None,
        "Dispatch": None,
        "Line History Stage": None,
    }
    base.update(dates)
    return base


def _kpis(engine, *rows):
    return engine._kpis(pd.DataFrame(rows))


def test_card_shows_oldest_in_process_spool_not_the_oldest_packed_one(engine):
    kpis = _kpis(
        engine,
        _row("PACKED-OLD", 153, "Dispatch", completed=True, **{"First Fit-Up": "2026-03-01", "Packing": "2026-03-30"}),
        _row("IN-PROCESS", 101, "Packing", **{"First Fit-Up": "2026-06-24", "PDI": "2026-11-16"}),
        _row("YOUNGER", 40, "Welding", **{"First Fit-Up": "2026-10-01"}),
    )
    assert kpis["oldest_spool"]["spool_no"] == "IN-PROCESS"
    assert kpis["oldest_spool"]["total_age"] == 101
    assert kpis["oldest_spool"]["current_stage"] == "Packing"
    assert kpis["oldest_spool_overall"]["spool_no"] == "PACKED-OLD"
    assert kpis["oldest_spool_overall"]["total_age"] == 153


def test_loose_item_with_no_work_never_headlines_the_card(engine):
    kpis = _kpis(
        engine,
        _row("JACKSCREW &PLUG", 103, "Fit-Up"),
        _row("REAL", 60, "Fit-Up", **{"First Fit-Up": "2026-09-10"}),
    )
    assert kpis["oldest_spool"]["spool_no"] == "REAL"
    assert kpis["oldest_spool_overall"]["spool_no"] == "REAL"


def test_released_but_not_started_by_stage_label_is_left_out(engine):
    kpis = _kpis(
        engine,
        _row("NOT-RELEASED", 300, "Production Order Not Released"),
        _row("REAL", 60, "Fit-Up", **{"First Fit-Up": "2026-09-10"}),
    )
    assert kpis["oldest_spool"]["spool_no"] == "REAL"


def test_line_history_counts_as_work_done(engine):
    kpis = _kpis(
        engine,
        _row("LINE-HISTORY-ONLY", 80, "Partial Fit-Up/Welding", **{"Line History Stage": "Fit-Up"}),
    )
    assert kpis["oldest_spool"]["spool_no"] == "LINE-HISTORY-ONLY"


def test_packed_spool_without_stage_dates_still_counts_in_the_overall_figure(engine):
    kpis = _kpis(
        engine,
        _row("DISPATCHED-ONLY", 120, "Dispatch", completed=True, Dispatch="2026-08-01"),
        _row("REAL", 60, "Fit-Up", **{"First Fit-Up": "2026-09-10"}),
    )
    assert kpis["oldest_spool"]["spool_no"] == "REAL"
    assert kpis["oldest_spool_overall"]["spool_no"] == "DISPATCHED-ONLY"


def test_nothing_in_process_gives_no_card_spool_but_keeps_the_overall_one(engine):
    kpis = _kpis(
        engine,
        _row("PACKED", 90, "Dispatch", completed=True, Packing="2026-09-01"),
    )
    assert kpis["oldest_spool"] is None
    assert kpis["oldest_spool_overall"]["spool_no"] == "PACKED"
