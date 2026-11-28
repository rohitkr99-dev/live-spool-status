import importlib.util
from pathlib import Path

from openpyxl import Workbook

spec = importlib.util.spec_from_file_location("build_bom", Path(__file__).resolve().parents[1] / "scripts" / "build_bom.py")
build_bom = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_bom)


def test_item_lines_carry_the_inch_dia(tmp_path):
    head = ["Project Code", "Drawing No.", "Spool No", "S.No.", "Description", "Quantity", "Unit of Measure", "Inch Dia"]
    book = Workbook()
    sheet = book.active
    sheet.append(head)
    sheet.append(["P1", "D1", "S1", "1", "Spool", 1, "NOS", 8])
    sheet.append(["P1", "D1", "S1", "1.01", "Seamless Pipe", 900, "MM", 0])
    sheet.append(["P1", "D1", "S1", "1.02", "90 Degree Elbow", 1, "NOS", 8])
    path = tmp_path / "bom.xlsx"
    book.save(path)

    lines = build_bom.convert(path)["P1"]["spools"]["D1|S1"]

    assert [line[9] for line in lines] == [0, 8]
