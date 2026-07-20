#!/usr/bin/env python3
"""
main.py
---------------------------------------------------------
Run this to process the Excel files currently in data/upload/ and
refresh every JSON file in processed/ - including
processed/dashboard_data.json, the single file you upload into the
dashboard.

Usage:
    python3 main.py            # process once and exit
    python3 main.py --watch    # keep running: reprocess automatically
                                # every time a file in data/upload/
                                # changes, so you never have to run
                                # this command again - just drop in
                                # a new DPR / Weekly Production /
                                # Line History Sheet workbook and it
                                # picks it up on its own within a
                                # few seconds.

Requires the DPR workbook and Weekly Production Planning workbook to
already be in data/upload/ (see config/settings.json ->
input_files -> file_pattern for the filename patterns expected). The
Line History Sheet is optional - see config/business_rules.json ->
line_history_override.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from pipeline import Pipeline, PipelineError  # noqa: E402


def main() -> int:

    if "--watch" in sys.argv:
        from watch import watch  # noqa: E402 (deferred: only needed here)
        watch()
        return 0

    pipeline = Pipeline()

    try:
        result = pipeline.run()
    except PipelineError as error:
        print(f"Pipeline stopped: {error}")
        return 1
    except FileNotFoundError as error:
        print(f"Pipeline stopped: {error}")
        return 1

    print(f"Processed {result['rows_processed']} spool(s).")
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
