"""
Unit tests for the 2026-09-04 thumb rule: "Consider F11=P11 wherever
it shows." F11 and P11 are the same alloy steel grade (1.25Cr-0.5Mo),
just different product forms (Forging vs Pipe) - normalize_material_grade()
(utils.py) merges them, applied once in reader.py ->
ExcelReader.read_fabrication() so every department (Projects,
Production, Quality, Painting, Packing all read the Fabrication
workbook through this one shared method) already sees the merged
value with nothing to keep in sync per department.
"""

import pandas as pd

from utils import normalize_material_grade


def test_f11_becomes_p11():
    assert normalize_material_grade("F11") == "P11"


def test_f11_case_insensitive():
    assert normalize_material_grade("f11") == "P11"


def test_f11_with_stray_whitespace():
    assert normalize_material_grade("  F11  ") == "P11"


def test_p11_unchanged():
    assert normalize_material_grade("P11") == "P11"


def test_other_grades_unchanged():
    for grade in ("CS", "SS", "P22", "P91", "DUPLEX"):
        assert normalize_material_grade(grade) == grade


def test_none_passes_through():
    assert normalize_material_grade(None) is None


def test_nan_passes_through():
    assert pd.isna(normalize_material_grade(float("nan")))


def test_empty_string_passes_through():
    assert normalize_material_grade("") == ""


def test_applies_cleanly_over_a_dataframe_column():
    """The exact shape read_fabrication() uses: dataframe[MATERIAL].apply(normalize_material_grade)."""
    df = pd.DataFrame({"Material": ["F11", "P11", "CS", "f11", None, "P22"]})
    df["Material"] = df["Material"].apply(normalize_material_grade)
    assert list(df["Material"]) == ["P11", "P11", "CS", "P11", None, "P22"]
