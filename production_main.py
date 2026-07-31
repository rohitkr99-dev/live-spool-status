#!/usr/bin/env python3
"""
production_main.py
---------------------------------------------------------
Run this to refresh the Production department dashboard
(website/production.html) - spool ageing by category vs. the
target-day matrix:

    processed/production_data.json
    website/data/production_data.json   (if publishing is enabled)

Usage:
    python3 production_main.py

This reads the SAME DPR / Weekly Production Planning / Line History
Sheet workbooks already in data/upload/projects/ - the same files
main.py reads for the Projects dashboard. Run main.py first (or
independently); this script doesn't depend on it having run, but
both expect the same upload folder to be current.

To publish an update to the hosted dashboard:

    python3 production_main.py
    git add website/data/production_data.json
    git commit -m "Update production dashboard data"
    git push

This is a separate, additive pipeline - it does not import from or
modify src/pipeline.py, src/merge.py, src/business_rules.py or
src/ageing.py. See src/production/pipeline.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from production.pipeline import ProductionPipelineError, run  # noqa: E402


def main() -> int:
    try:
        result = run()
    except ProductionPipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1
    except FileNotFoundError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(f"Processed {result['spool_rows']} spool row(s).")
    print(f"KPIs: {result['kpis']}")
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
