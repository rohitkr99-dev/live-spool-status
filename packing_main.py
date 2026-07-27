#!/usr/bin/env python3
"""
packing_main.py
---------------------------------------------------------
Run this to process the Packing & Dispatch workbooks currently in
data/upload/packing/ and refresh:

    processed/packing_dispatch_data.json
    website/data/packing_dispatch_data.json   (if publishing is enabled)

Usage:
    python3 packing_main.py

Drop every project's packing/dispatch workbook (Spool List sheet +
Summary sheet) into data/upload/packing/, then run this. Each run
replaces the bundle from scratch using whatever workbooks are
currently in that folder - there's no partial/incremental update, so
always drop in the complete, current set of workbooks before running.

To publish an update to the hosted dashboard:

    python3 packing_main.py
    git add website/data/packing_dispatch_data.json
    git commit -m "Update packing & dispatch data"
    git push

This is a separate pipeline from main.py (Production / Spool
Ageing) - different source workbooks, different output bundle, no
shared state. See src/packing/pipeline.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from packing.pipeline import PackingPipelineError, run  # noqa: E402


def main() -> int:
    try:
        result = run()
    except PackingPipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(f"Processed {result['spool_rows']} spool row(s) and {result['box_rows']} box row(s) across {result['projects']} project(s).")
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
