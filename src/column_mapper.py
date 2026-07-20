"""
column_mapper.py
---------------------------------
Standardizes Excel column names
using configuration mappings.
"""

from typing import Any

import pandas as pd

from config_loader import _load_json

_MAPPING = _load_json("column_mapping.json")


def standardize_columns(
    dataframe: pd.DataFrame,
    source: str
) -> pd.DataFrame:
    """
    Rename Excel columns to the
    application's standard names.

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

    return dataframe.rename(columns=mapping)
