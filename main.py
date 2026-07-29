#!/usr/bin/env python3
"""
main.py
---------------------------------------------------------
Run this to process every source workbook currently sitting in any
department's upload folder under data/upload/ and refresh every JSON
file in processed/ - currently:

  - Production / Spool Ageing, aka "Projects" on the landing page
    (data/upload/projects/)
    -> processed/dashboard_data.json
  - Packing & Dispatch (data/upload/packing/)
    -> processed/packing_dispatch_data.json

Usage:
    python3 main.py            # process every built department once and exit
    python3 main.py --watch    # keep running: reprocess automatically
                                # whenever a file changes anywhere
                                # under data/upload/ (any department's
                                # subfolder), so you never have to run
                                # this command again - just drop in an
                                # updated workbook and it's picked up
                                # within a few seconds.

Every department is independent - a problem with one workbook (e.g. a
missing DPR file, or no Packing & Dispatch workbooks yet) doesn't stop
any other department from running. See src/pipeline.py (this is the
"Projects" pipeline internally - see the note in src/departments.py
for why the code still says "Production" in places) and
src/packing/pipeline.py (Packing & Dispatch).

The DPR / Weekly Production Planning workbooks belong in
data/upload/projects/ (see config/settings.json -> input_files ->
file_pattern for the filename patterns expected). The Line History
Sheet is optional - see config/business_rules.json ->
line_history_override. Note this is NOT data/upload/production/ - that
folder is reserved for a different, separate department (the landing
page's "Production" card, still unbuilt) - see
data/upload/production/README.txt and src/departments.py.

Packing & Dispatch requires at least one .xlsx workbook in
data/upload/packing/ (see config/packing_settings.json). If that
folder is empty or missing, Packing & Dispatch is skipped for this
run - every other department still processes normally.

Adding a new department
------------------------
data/upload/ has one subfolder per department (see src/departments.py
for the full registry - it's also what the file-watcher and the
"file dropped but no pipeline yet" message below both read from).
Folders that don't have a pipeline built yet (currently: Production,
Quality, Painting) still get watched and reported on, they're just
not processed - dropping files in early doesn't do any harm, and
doesn't go unnoticed either. Building a new department's pipeline
follows the same shape as src/packing/ (reader -> normalize -> summary
-> pipeline -> its own JSON bundle -> its own dashboard page) - once
it's ready, wire it into main.py the same way
run_production()/run_packing() are wired below, and flip that
department's `built` flag to True in src/departments.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from departments import report_unbuilt_departments  # noqa: E402
from pipeline import Pipeline, PipelineError  # noqa: E402
from packing.pipeline import PackingPipelineError, run as run_packing_pipeline  # noqa: E402


def run_production() -> int:
    """Runs the Production / Spool Ageing pipeline. Returns a process exit code."""

    pipeline = Pipeline()

    try:
        result = pipeline.run()
    except PipelineError as error:
        print(f"Production pipeline stopped: {error}")
        return 1
    except FileNotFoundError as error:
        print(f"Production pipeline stopped: {error}")
        return 1

    print(f"Production: processed {result['rows_processed']} spool(s).")
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")

    return 0


def run_packing() -> None:
    """
    Runs the Packing & Dispatch pipeline. Best-effort: an empty/missing
    data/upload/packing/ folder (nothing uploaded yet) is reported and
    skipped rather than treated as a failure of the whole `main.py` run.
    """

    try:
        result = run_packing_pipeline()
    except PackingPipelineError as error:
        print(f"Packing & Dispatch: skipped ({error})")
        return

    print(
        f"Packing & Dispatch: processed {result['spool_rows']} spool row(s) "
        f"and {result['box_rows']} box row(s) across {result['projects']} project(s)."
    )
    print("Files written:")
    for filepath in result["files_written"]:
        print(f"  {filepath}")


def main() -> int:

    if "--watch" in sys.argv:
        from watch import watch  # noqa: E402 (deferred: only needed here)
        watch()
        return 0

    exit_code = run_production()
    print()
    run_packing()
    print()
    report_unbuilt_departments(print)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
