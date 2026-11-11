#!/usr/bin/env python3
"""
mom_main.py
---------------------------------------------------------
Run this to refresh the SIOP Meeting Tracker page (website/mom.html):

    python3 mom_main.py

Reads the SIOP MoM Tracker workbook from data/upload/projects/ and writes
processed/<config/mom_settings.json: output_files.bundle> plus the same
file under website/data/. Separate and additive: it does not touch any
other department's pipeline. See src/mom/pipeline.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from mom.pipeline import MomPipelineError, run  # noqa: E402


def main() -> int:
    try:
        result = run()
    except MomPipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(
        f"Read {result['current_cases']} current open case(s) and "
        f"{result['log_rows']} Weekly Log row(s) across {result['projects']} project(s)."
    )
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
