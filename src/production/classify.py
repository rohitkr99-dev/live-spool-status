"""
src/production/classify.py
---------------------------------------------------------
Classifies each spool into one of the 6 categories from the target-
day matrix (config/production_rules.json -> categories), in the
order confirmed with the project owner:

  1. Total Joints == 0 (or blank) AND Inch Dia == 0 (or blank)
     -> always the standalone "loose" category, exclusive of every
        other rule below (a spool matching this is never also
        counted in any of the other 5 categories).
  2. Spool Size == 0 (or blank) AND Inch Dia == 0 (or blank)
     -> always the 1st category (<=8 Joint Single Spool - CS/SS),
        regardless of actual material or joint count. A DIFFERENT
        rule/field than #1 above - confirmed with the project owner
        these are deliberately separate.
  3. Spool Size <= sb_max_spool_size (default 2)
     -> SB, regardless of material or joint count.
  4. Otherwise, by Material and Total Joints:
       Material in the configured AS list (F11/P11/P22/P91) -> AS
       bucket; everything else (CS, SS, DUPLEX, or unrecognised)
       -> the combined CS/SS bucket (the target-day table gives CS
       and SS identical targets).
       Total Joints <= joint_threshold (default 8) -> "<=8 Joint",
       else ">8 Joint". A blank/unreadable Total Joints defaults to
       "<=8 Joint" (the smaller, safer target).

Returns the category KEY (e.g. "le8_cs_ss"), not the display label -
see config/production_rules.json -> categories for the label lookup.
"""

from __future__ import annotations

from typing import Any

from utils import is_empty, clean_text


def _to_float(value: Any) -> float | None:
    if is_empty(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def classify_category(
    row: dict[str, Any],
    rules: dict[str, Any],
    fields: dict[str, str],
) -> str:
    """
    Parameters
    ----------
    row
        A single spool's data (dict-like - a pandas Series works).
    rules
        The loaded config/production_rules.json.
    fields
        rules["welding_finish_fields"] - the raw column names to
        read from `row` (kept as a config lookup rather than
        hardcoded strings so a future header rename is a config
        edit, not a code change).
    """

    inch_dia = _to_float(row.get(fields["inch_dia_field"]))
    dia_is_zero = inch_dia is None or inch_dia == 0

    total_joints = _to_float(row.get(fields["total_joints_field"]))
    joints_are_zero = total_joints is None or total_joints == 0

    if joints_are_zero and dia_is_zero:
        return rules["loose_fallback_category"]

    spool_size = _to_float(row.get(fields["spool_size_field"]))
    size_is_zero = spool_size is None or spool_size == 0

    if size_is_zero and dia_is_zero:
        return rules["zero_size_fallback_category"]

    if spool_size is not None and spool_size <= rules["sb_max_spool_size"]:
        return "sb"

    material = clean_text(row.get(fields["material_field"]))
    as_materials = {
        clean_text(m) for m in rules["material_groups"].get("AS", [])
    }
    is_as = material in as_materials

    is_over_threshold = (
        total_joints is not None and total_joints > rules["joint_threshold"]
    )

    if is_as:
        return "gt8_as" if is_over_threshold else "le8_as"

    return "gt8_cs_ss" if is_over_threshold else "le8_cs_ss"
