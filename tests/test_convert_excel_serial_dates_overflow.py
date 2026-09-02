"""
Unit tests for utils.convert_excel_serial_dates()'s per-value
fallback (2026-09-02).

Production incident: a DPR workbook's Fabrication date column raised
FloatingPointError deep inside numpy's internal unit-conversion
arithmetic (Run 705 of "Sync from Google Drive", GitHub Actions'
Linux runner), crashing the whole Production dashboard pipeline for
that run - continue-on-error kept it from blocking anything else,
but Production itself didn't refresh. The exact trigger value
couldn't be reproduced locally (Windows, same pinned numpy/pandas
versions) - this is a platform-dependent floating-point overflow
trap, not an ordinary bad-value parsing failure (errors="coerce"
already handles those fine). These tests fake the failure via
monkeypatching pd.to_datetime rather than hunting for a real value
that reproduces it on every platform, since the actual fix is about
HANDLING an unrecoverable vectorized-conversion error generically,
not about any specific numeric value.
"""

import pandas as pd
import pytest

from utils import convert_excel_serial_dates

ORIGINAL_TO_DATETIME = pd.to_datetime


def _install_flaky_to_datetime(monkeypatch, bad_value):
    """
    Simulates the real crash: the vectorized call over the whole
    column always raises (as it did in production), forcing
    convert_excel_serial_dates() into its per-value fallback: each
    scalar conversion succeeds except `bad_value`, which also raises
    - mirroring how the actual bad cell kept failing even outside
    the fast vectorized path.
    """

    def flaky_to_datetime(arg, **kwargs):
        if kwargs.get("unit") == "D":
            if hasattr(arg, "__len__") and not isinstance(arg, str) and len(arg) > 1:
                raise FloatingPointError("overflow encountered in multiply")
            if arg == bad_value:
                raise FloatingPointError("overflow encountered in multiply")
        return ORIGINAL_TO_DATETIME(arg, **kwargs)

    monkeypatch.setattr(pd, "to_datetime", flaky_to_datetime)


def test_falls_back_to_per_value_conversion_when_vectorized_call_raises(monkeypatch):
    """
    Good values in the column still convert correctly via the
    fallback; only the genuinely bad cell becomes NaT - the whole
    run doesn't crash.
    """

    _install_flaky_to_datetime(monkeypatch, bad_value=999999999)

    df = pd.DataFrame({"Prod Order Release": [45000.0, 999999999.0, 45100.0]})

    result = convert_excel_serial_dates(df, ["Prod Order Release"])

    assert result["Prod Order Release"].iloc[0] == pd.Timestamp("2023-03-15")
    assert pd.isna(result["Prod Order Release"].iloc[1])
    assert result["Prod Order Release"].iloc[2] == pd.Timestamp("2023-06-23")


def test_fallback_never_raises_even_for_infinite_value(monkeypatch):
    """
    inf is exactly the kind of value that triggers a hardware
    overflow trap on some platforms - the fallback must swallow it
    (NaT) rather than let a second raise propagate.
    """

    _install_flaky_to_datetime(monkeypatch, bad_value=float("inf"))

    df = pd.DataFrame({"Prod Order Release": [45000.0, float("inf")]})

    result = convert_excel_serial_dates(df, ["Prod Order Release"])

    assert result["Prod Order Release"].iloc[0] == pd.Timestamp("2023-03-15")
    assert pd.isna(result["Prod Order Release"].iloc[1])


def test_normal_path_unaffected_when_nothing_is_flaky():
    """
    No monkeypatching at all - ordinary numeric serial dates convert
    exactly as before, confirming the try/except wrapper adds no
    behavior change to the common case.
    """

    df = pd.DataFrame({"Prod Order Release": [45000.0, None, 45100.0]})

    result = convert_excel_serial_dates(df, ["Prod Order Release"])

    assert result["Prod Order Release"].iloc[0] == pd.Timestamp("2023-03-15")
    assert pd.isna(result["Prod Order Release"].iloc[1])
    assert result["Prod Order Release"].iloc[2] == pd.Timestamp("2023-06-23")
