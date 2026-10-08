"""
Material Handover workbook: F11 = P11 (2026-10-08). The thumb rule was only
applied to the DPR's Material column; this workbook has its own, so its
"By Material" chart showed one stray F11.
"""

import openpyxl

from reader import ExcelReader


def test_material_handover_reader_merges_f11_into_p11(tmp_path):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(["Project Code", "Drawing No.", "Spool No", "Mat.", "HANDOVER DATE",
                  "FIRST TIME STATUS", "CURRENT STATUS"])
    sheet.append(["P1", "D1", "S1", "F11", None, "HANDOVER", None])
    sheet.append(["P1", "D2", "S1", "P11", None, "HANDOVER", None])
    sheet.append(["P1", "D3", "S1", "CS", None, "HANDOVER", None])
    workbook.save(tmp_path / "Material Handover.xlsx")

    reader = ExcelReader()
    reader.settings["paths"]["production_upload_folder"] = str(tmp_path)

    frame = reader.read_material_handover()

    assert sorted(frame["Material"]) == ["CS", "P11", "P11"]
