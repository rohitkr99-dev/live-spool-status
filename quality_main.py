#!/usr/bin/env python3
"""
quality_main.py
---------------------------------------------------------
Run this to refresh the Quality Assurance/Control dashboard
(website/quality.html) - rework charts from the Production Rework
Data workbook:

    processed/<filename set in config/quality_settings.json: output_files.bundle>
    website/data/<same filename>   (if publishing is enabled)

Usage:
    python3 quality_main.py

This reads the SAME Production Rework Data workbook in
data/upload/quality/ that main.py also reads for the PDQC override
(see src/merge.py -> apply_rework_pdqc_override()). Run main.py
first (or independently); this script doesn't depend on it having
run, but both expect that upload folder to be current.

To publish an update to the hosted dashboard:

    python3 quality_main.py
    git add website/data/
    git commit -m "Update quality dashboard data"
    git push

This is a separate, additive pipeline - it does not import from or
modify src/pipeline.py, src/merge.py, src/business_rules.py or
src/ageing.py. See src/quality/pipeline.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from quality.pipeline import QualityPipelineError, run  # noqa: E402


def main() -> int:
    try:
        result = run()
    except QualityPipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1
    except FileNotFoundError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(f"KPIs: {result['kpis']}")
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
