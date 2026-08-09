"""
tests/test_packing_project_names.py
---------------------------------------------------------
Covers src/packing/pipeline.py -> _merge_project_names(): the DPR
(Fabrication workbook)'s Project Name is the site-wide canonical
source (2026-08-09 decision - see
docs/ageing-and-project-naming-conventions.md); Packing's own
Summary-sheet-title-parsed name is only a fallback for a project the
DPR doesn't have.
"""

from packing.pipeline import _merge_project_names


def test_canonical_name_overrides_parsed_name_for_matching_code():

    parsed = {"TJ/25-26/188": "Vogt Power ( Bison )"}
    canonical = {"TJ/25-26/188": "VOGT Bison"}

    result = _merge_project_names(parsed, canonical)

    assert result["TJ/25-26/188"] == "VOGT Bison"


def test_code_missing_from_dpr_keeps_parsed_name():

    parsed = {"TJ/25-26/999": "Some New Project"}
    canonical = {"TJ/25-26/188": "VOGT Bison"}

    result = _merge_project_names(parsed, canonical)

    assert result["TJ/25-26/999"] == "Some New Project"
    assert result["TJ/25-26/188"] == "VOGT Bison"


def test_empty_canonical_leaves_parsed_names_untouched():

    parsed = {"TJ/25-26/188": "Vogt Power ( Bison )"}

    result = _merge_project_names(parsed, {})

    assert result == parsed


def test_empty_parsed_still_gets_canonical_names():

    canonical = {"TJ/25-26/188": "VOGT Bison"}

    result = _merge_project_names({}, canonical)

    assert result == canonical
