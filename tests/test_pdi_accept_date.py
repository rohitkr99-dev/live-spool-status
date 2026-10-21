"""
PDI Accept date (2026-10-21): the "RFP Spools Latest" workbook's PDI Accept
date overrides the DPR's PDI (which held the later Packing release date) for
every spool it has a date for. Multi-date text cells and repeated rows resolve
to the LATEST date; spools it does not cover keep the DPR value.
"""

import pandas as pd

from reader import ExcelReader

KEY = ["Project Code", "Drawing No", "Spool No"]
RAW = ["Project Code", "Drawing No.", "Spool No", "Conc", "RFP", "PDI Accept date"]


def _reader_with_raw(monkeypatch, tmp_path, rows):
    (tmp_path / "RFP Spools Latest.xlsb").write_bytes(b"")
    reader = ExcelReader()
    reader.settings["paths"]["quality_upload_folder"] = str(tmp_path)
    monkeypatch.setattr(
        reader,
        "_read_excel_sheet_or_none",
        lambda *args, **kwargs: pd.DataFrame(rows, columns=RAW),
    )
    return reader


def test_multi_date_cell_takes_latest_day_first(monkeypatch, tmp_path):
    reader = _reader_with_raw(monkeypatch, tmp_path, [
        ["P1", "D1", "S1", "x", 45919, "12-11-2025/14-11-2025/17-11-2025"],
    ])
    frame = reader.read_pdi_accept_dates()
    assert frame["PDI Accept Date"].tolist() == [pd.Timestamp("2025-11-17")]


def test_duplicate_rows_latest_wins_and_blank_or_note_is_no_date(monkeypatch, tmp_path):
    reader = _reader_with_raw(monkeypatch, tmp_path, [
        ["P1", "D1", "S1", "x", 1, "05-03-2026"],
        ["P1", "D1", "S1", "x", 2, "20-03-2026"],
        ["P1", "D1", "S2", "x", 1, None],
        ["P1", "D1", "S3", "x", 1, "Spool deleted"],
        ["P1", "D1", "S4", "x", 1, 46080],
        ["P1", "D1", "S5", "x", 1, "05-03-2026"],
    ])
    frame = reader.read_pdi_accept_dates().set_index("Spool No")["PDI Accept Date"]
    assert frame.to_dict() == {
        "S1": pd.Timestamp("2026-03-20"),
        "S4": pd.Timestamp("2026-02-27"),
        "S5": pd.Timestamp("2026-03-05"),   # day-first: 5 March, not 3 May
    }


def test_file_wins_over_dpr_and_uncovered_spools_keep_dpr(monkeypatch, tmp_path):
    reader = _reader_with_raw(monkeypatch, tmp_path, [
        ["P1", "D1", "S1", "x", 1, "17-11-2025"],
        ["P1", "D1", "S2", "x", 1, None],
    ])
    dpr = pd.DataFrame({
        "Project Code": ["P1", "P1", "P1", "P1"],
        "Drawing No": ["D1", "D1", "D1", "D9"],
        "Spool No": ["S1", "S2", "S3", "S9"],
        "PDI": pd.to_datetime(["2025-11-18", "2025-12-01", None, "2025-10-01"]),
    })
    out = reader._apply_pdi_accept_dates(dpr)
    assert out["PDI"].tolist()[0] == pd.Timestamp("2025-11-17")   # file wins
    assert out["PDI"].tolist()[1] == pd.Timestamp("2025-12-01")   # blank in file: DPR kept
    assert pd.isna(out["PDI"].tolist()[2])                        # not in file, blank in DPR
    assert out["PDI"].tolist()[3] == pd.Timestamp("2025-10-01")   # not in file: DPR kept


def test_file_date_fills_a_blank_dpr_pdi_even_when_later(monkeypatch, tmp_path):
    reader = _reader_with_raw(monkeypatch, tmp_path, [
        ["P1", "D1", "S1", "x", 1, "20-11-2025"],
    ])
    dpr = pd.DataFrame({
        "Project Code": ["P1"], "Drawing No": ["D1"], "Spool No": ["S1"],
        "PDI": pd.to_datetime(["2025-11-18"]),
    })
    assert reader._apply_pdi_accept_dates(dpr)["PDI"].iloc[0] == pd.Timestamp("2025-11-20")


def test_missing_file_leaves_dpr_unchanged(tmp_path):
    reader = ExcelReader()
    reader.settings["paths"]["quality_upload_folder"] = str(tmp_path)
    dpr = pd.DataFrame({
        "Project Code": ["P1"], "Drawing No": ["D1"], "Spool No": ["S1"],
        "PDI": pd.to_datetime(["2025-11-18"]),
    })
    assert reader._apply_pdi_accept_dates(dpr)["PDI"].iloc[0] == pd.Timestamp("2025-11-18")
