"""
column_mapper.py
---------------------------------
Standardizes Excel column names
using configuration mappings.
"""

import re
from typing import Any

import pandas as pd

from config_loader import _load_json

_MAPPING = _load_json("column_mapping.json")


def _normalize(name: Any) -> str:
    """
    Loosen a header down to something comparable across small
    formatting differences that don't change its meaning: leading/
    trailing whitespace, repeated internal spaces, and case (e.g.
    "Total Wt", "total wt", "Total  Wt", "TOTAL WT" should all match
    the same configured mapping key). Punctuation is left alone,
    since some configured variants deliberately differ only by a
    trailing "." (e.g. "Total Wt." vs "Total Wt").
    """

    return re.sub(r"\s+", " ", str(name).strip()).casefold()


def standardize_columns(
    dataframe: pd.DataFrame,
    source: str
) -> pd.DataFrame:
    """
    Rename Excel columns to the
    application's standard names.

    Matching is case/whitespace-insensitive against
    config/column_mapping.json, so a workbook header that only
    differs from a configured variant by case or extra spaces
    (e.g. "Total WT." vs "Total Wt.") still resolves correctly
    instead of silently passing through unrenamed and disappearing
    from the dashboard.

    Parameters
    ----------
    dataframe
        Input DataFrame.

    source
        fabrication
        or
        planning

    Returns
    -------
    pandas.DataFrame
    """

    mapping: dict[str, Any] = _MAPPING.get(source, {})
    normalized_mapping = {_normalize(key): value for key, value in mapping.items()}

    rename_map = {}
    for column in dataframe.columns:
        canonical = normalized_mapping.get(_normalize(column))
        if canonical is not None:
            rename_map[column] = canonical

    return dataframe.rename(columns=rename_map)
