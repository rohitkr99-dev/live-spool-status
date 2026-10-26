"""
excel_compat.py
---------------------------------
Reading Excel workbooks without caring which Excel format they were saved in.

The pipelines find their source files by NAME (e.g. "*DPR*") and by the DATA
inside them (column headers), never by file type: the same workbook can be
saved as .xlsx, .xlsm or .xlsb and is read exactly the same way.

  - glob_excel()        find workbooks in a folder, ignoring the extension
  - excel_engine_for()  the pandas engine that opens a given workbook
  - load_workbook_any() an openpyxl workbook object for any of the formats
"""

import fnmatch
import re
from pathlib import Path

import openpyxl

EXCEL_EXTENSIONS = (".xlsx", ".xlsm", ".xlsb")


def excel_engine_for(path) -> str:
    """pandas engine for a workbook: pyxlsb for .xlsb, openpyxl otherwise."""
    return "pyxlsb" if Path(path).suffix.lower() == ".xlsb" else "openpyxl"


def glob_excel(folder, pattern: str) -> list[Path]:
    """
    Every Excel workbook in `folder` whose name matches `pattern`,
    whatever its extension. Any trailing .xlsx / .xlsb / .xlsm on the
    pattern is ignored, so "*DPR*.xlsb" and "*DPR*" find the same files.
    Matching is case-insensitive; Excel's "~$" lock files are skipped.
    """

    folder = Path(folder)
    if not folder.is_dir():
        return []

    stem_pattern = re.sub(r"\.xls[xbm]?$", "", pattern, flags=re.IGNORECASE).lower()

    return [
        path
        for path in folder.iterdir()
        if path.is_file()
        and not path.name.startswith("~$")
        and path.suffix.lower() in EXCEL_EXTENSIONS
        and fnmatch.fnmatchcase(path.stem.lower(), stem_pattern)
    ]


def load_workbook_any(path) -> openpyxl.Workbook:
    """
    An openpyxl workbook (values only) for an .xlsx / .xlsm / .xlsb file.

    .xlsb is read with pyxlsb and copied cell by cell into an in-memory
    openpyxl workbook, so callers can use one code path for every format.
    pyxlsb returns whole numbers as floats; they are turned back into ints
    (as openpyxl does for .xlsx) so identifiers like "123" do not become
    "123.0". Dates come through as Excel serial numbers.
    """

    path = Path(path)

    if path.suffix.lower() != ".xlsb":
        return openpyxl.load_workbook(path, data_only=True)

    from pyxlsb import open_workbook

    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)

    with open_workbook(str(path)) as source:
        for name in source.sheets:
            sheet = workbook.create_sheet(title=name[:31])
            with source.get_sheet(name) as rows:
                for row in rows.rows():
                    sheet.append([_plain(cell.v) for cell in row])

    return workbook


def _plain(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value
