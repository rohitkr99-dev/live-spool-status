"""
config_loader.py
---------------------------------
Loads all configuration files used
throughout the application.

This module is the single source for
reading configuration JSON files.
"""

from pathlib import Path
import json
from typing import Any

from logger import logger


CONFIG_FOLDER = Path("config")


def _load_json(filename: str) -> dict[str, Any]:
    """
    Load a JSON configuration file.

    Parameters
    ----------
    filename : str
        JSON file name.

    Returns
    -------
    dict
        Configuration dictionary.
    """

    filepath = CONFIG_FOLDER / filename

    if not filepath.exists():
        logger.error(f"Configuration file not found: {filepath}")
        raise FileNotFoundError(filepath)

    try:
        with filepath.open(
            "r",
            encoding="utf-8"
        ) as file:

            data = json.load(file)

        logger.info(f"Loaded configuration: {filename}")

        return data

    except json.JSONDecodeError as error:
        logger.error(
            f"Invalid JSON in {filename}: {error}"
        )
        raise


def load_settings() -> dict[str, Any]:
    """Load settings.json"""
    return _load_json("settings.json")


def load_schema() -> dict[str, Any]:
    """Load schema.json"""
    return _load_json("schema.json")


def load_stages() -> dict[str, Any]:
    """Load stages.json"""
    return _load_json("stages.json")


def load_business_rules() -> dict[str, Any]:
    """Load business_rules.json"""
    return _load_json("business_rules.json")
