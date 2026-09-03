#!/usr/bin/env python3
"""
painting_main.py
---------------------------------------------------------
Run this to refresh the Painting department dashboard
(website/painting.html):

    processed/<filename set in config/painting_settings.json: output_files.bundle>
    website/data/<same filename>   (if publishing is enabled)

Usage:
    python3 painting_main.py

Reads the Painting Weekly Plan workbook(s) from data/upload/painting/,
cross-referenced against the RFP-done spools on the SAME Fabrication
(DPR) workbook data/upload/projects/ already has (see
src/painting/reader.py -> read_dpr_rfp_spools()). Run main.py first
(or independently) to keep data/upload/projects/ current; this script
doesn't depend on main.py having run.

To publish an update to the hosted dashboard:

    python3 painting_main.py
    git add website/data/
    git commit -m "Update painting dashboard data"
    git push

This is a separate, additive pipeline - it does not import from or
modify src/pipeline.py, src/merge.py, src/business_rules.py, or any
other department's package. See src/painting/pipeline.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from painting.pipeline import PaintingPipelineError, run  # noqa: E402


def main() -> int:
    try:
        result = run()
    except PaintingPipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(
        f"Processed {result['spool_rows']} spool row(s) from the Painting "
        f"Weekly Plan; {result['rfp_done_spools']} RFP-done spool(s) found "
        f"in the DPR ({result['missing_from_plan']} not in the Painting Plan)."
    )
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
