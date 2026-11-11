"""
SIOP MoM Tracker (2026-11-11): the Current Open Cases sheet gives the last
meeting's actions as-is; the Weekly Log gives a per-project history. Sheets
are found by their headers, the file by name only.
"""

import datetime as dt

import openpyxl

from mom.pipeline import run
from mom.reader import iso_date, read_current_cases, read_log_rows
from mom.summary import build_history

LOG_HEADERS = [
    "Meeting Date", "Follow-up of (pick an open case)\n- leave EMPTY for a new case",
    "Project\n(new case only)", "Concerned Dept\n(new case only)",
    "Remarks / Update", "Status", "Case ID", "Entry in case",
]
CURRENT_HEADERS = [
    "#", "Case ID", "Project", "Concerned Dept", "Status", "Latest Remarks",
    "Last Updated", "First Raised", "Age (days)", "No. of Updates",
]
D = dt.datetime


def _workbook(path):
    wb = openpyxl.Workbook()
    wb.active.title = "How To Use"
    # Sheet order and names are deliberately not the real ones: found by headers.
    current = wb.create_sheet("Open")
    current.append(["Current Open Cases"])
    current.append([])
    current.append(CURRENT_HEADERS)
    current.append([1, "C-0002", "Siemens", "Production", "Hold", "Waiting for plates",
                    D(2026, 11, 10), D(2026, 10, 12), 29, 2])
    current.append([None, "", "", "", "", "", None, None, None, None])
    log = wb.create_sheet("Log")
    log.append(["Weekly Log"])
    log.append([])
    log.append(LOG_HEADERS)
    log.append([D(2026, 10, 12), None, "Siemens", "Production", "10 spools late", "Open", "C-0002", 1])
    log.append([D(2026, 10, 12), None, "VOGT Bison", "Painting", "Blasting pending", "Open", "C-0001", 1])
    # follow-up row: Project / Dept left blank, Case ID missing -> taken from column B
    log.append([D(2026, 11, 10), "C-0002 | Siemens | 10 spools late", None, None, "Waiting for plates", "Hold", None, 2])
    log.append([D(2026, 11, 10), "C-0001 | VOGT Bison | Blasting pending", None, None, "Done", "Closed", "C-0001", 2])
    log.append([None, None, None, None, None, None, None, None])
    # Case History-style decoy: has 'Meeting Date' + 'Remarks / Update' but no 'Case ID' header
    decoy = wb.create_sheet("Case History")
    decoy.append(["Update #", "Meeting Date", "Status", "Remarks / Update"])
    decoy.append([1, D(2026, 1, 1), "Open", "should never be read"])
    wb.save(path)


def test_current_cases_read_as_shown_and_blank_rows_skipped(tmp_path):
    _workbook(tmp_path / "SIOP MoM Tracker.xlsx")
    wb = openpyxl.load_workbook(tmp_path / "SIOP MoM Tracker.xlsx", data_only=True)
    cases = read_current_cases(wb)
    assert cases == [{
        "case_id": "C-0002", "project": "Siemens", "dept": "Production", "status": "Hold",
        "remarks": "Waiting for plates", "last_updated": "2026-11-10",
        "first_raised": "2026-10-12", "updates": 2,
    }]


def test_log_rows_use_follow_up_when_case_id_blank_and_ignore_decoy_sheet(tmp_path):
    _workbook(tmp_path / "SIOP MoM Tracker.xlsx")
    wb = openpyxl.load_workbook(tmp_path / "SIOP MoM Tracker.xlsx", data_only=True)
    rows = read_log_rows(wb)
    assert len(rows) == 4
    assert [r["case_id"] for r in rows] == ["C-0002", "C-0001", "C-0002", "C-0001"]
    assert all("never be read" not in r["remarks"] for r in rows)


def test_history_groups_by_project_and_borrows_blank_project(tmp_path):
    _workbook(tmp_path / "SIOP MoM Tracker.xlsx")
    wb = openpyxl.load_workbook(tmp_path / "SIOP MoM Tracker.xlsx", data_only=True)
    history = build_history(read_log_rows(wb))
    assert history["meetings"] == ["2026-10-12", "2026-11-10"]
    by_project = {p["project"]: p for p in history["projects"]}
    assert set(by_project) == {"Siemens", "VOGT Bison"}
    siemens = by_project["Siemens"]
    assert (siemens["open"], siemens["closed"]) == (1, 0)  # Hold is still open
    assert siemens["cases"][0]["status"] == "Hold"
    assert [u["date"] for u in siemens["cases"][0]["updates"]] == ["2026-10-12", "2026-11-10"]
    assert by_project["VOGT Bison"]["closed"] == 1
    assert by_project["VOGT Bison"]["cases"][0]["dept"] == "Painting"


def test_dates_accept_excel_serials_and_text():
    assert iso_date(46336) == "2026-11-10"
    assert iso_date("10-Nov-2026") == "2026-11-10"
    assert iso_date("rubbish") is None


def test_pipeline_finds_file_by_name_only_and_writes_bundle(tmp_path):
    upload = tmp_path / "up"
    upload.mkdir()
    _workbook(upload / "Copy of SIOP MoM Tracker (Nov).xlsx")
    result = run({
        "paths": {"upload_folder": str(upload), "processed_folder": str(tmp_path / "out"),
                  "website_data_folder": str(tmp_path / "site")},
        "input_files": {"file_pattern": "*MoM*Tracker*"},
        "output_files": {"bundle": "x.json"},
        "publishing": {"publish_to_website": True},
    })
    assert (result["current_cases"], result["log_rows"], result["projects"]) == (1, 4, 2)
    assert (tmp_path / "out" / "x.json").exists() and (tmp_path / "site" / "x.json").exists()
