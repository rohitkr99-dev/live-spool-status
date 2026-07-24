"""
tests/test_column_mapper.py
---------------------------------
Column headers in real-world workbooks drift in small, harmless ways
(case, extra spaces) between uploads. standardize_columns() should
still recognise them rather than silently dropping the column - a
dropped column shows up downstream as every row displaying a dash,
which is confusing to debug from the dashboard alone.
"""

import pandas as pd

from column_mapper import standardize_columns


def test_exact_header_still_maps():

    df = pd.DataFrame({"Total Wt": [1, 2], "Project Code": ["A", "B"]})

    result = standardize_columns(df, "fabrication")

    assert "Total Wt." in result.columns
    assert "Project Code" in result.columns


def test_different_case_still_maps():

    df = pd.DataFrame({"TOTAL WT": [1, 2], "total wt.": [3, 4]})

    # Only one of these can survive the rename (both normalize to the
    # same canonical column), but neither should be left unrenamed.
    result = standardize_columns(df, "fabrication")

    assert "Total Wt." in result.columns
    assert "TOTAL WT" not in result.columns
    assert "total wt." not in result.columns


def test_extra_internal_whitespace_still_maps():

    df = pd.DataFrame({"Total   Wt": [1, 2]})

    result = standardize_columns(df, "fabrication")

    assert "Total Wt." in result.columns


def test_leading_trailing_whitespace_still_maps():

    df = pd.DataFrame({"  Total Wt.  ": [1, 2]})

    result = standardize_columns(df, "fabrication")

    assert "Total Wt." in result.columns


def test_unrecognized_header_passes_through_unrenamed():

    df = pd.DataFrame({"Some Unmapped Column": [1, 2]})

    result = standardize_columns(df, "fabrication")

    assert "Some Unmapped Column" in result.columns
