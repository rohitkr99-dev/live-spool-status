#!/usr/bin/env python3
"""
main.py
---------------------------------------------------------
Run this to process every source workbook currently sitting in any
department's upload folder under data/upload/ and refresh every JSON
file in processed/ - currently:

  - Production / Spool Ageing, aka "Projects" on the landing page
    (data/upload/projects/)
    -> processed/<name from config/settings.json: output_files.dashboard_bundle>
  - Packing & Dispatch (data/upload/packing/)
    -> processed/<name from config/packing_settings.json: output_files.bundle>

  The actual filenames are deliberately non-descriptive (set in the
  config files above) so a casual visitor to the public GitHub repo
  can't guess the published data URL from the name alone. This is a
  minor deterrent, not real access control - see the note in
  config/settings.json.

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
run - every other department still processes normally. The Packing &
Dispatch workbooks are read TWICE per run: once here (best-effort,
before the Projects pipeline runs) purely to backfill PDI / Packing /
Dispatch on the Projects master dataset - see
read_packing_spools_for_merge() and config/business_rules.json ->
packing_dispatch_merge - and once inside run_packing() below, which
builds the Packing & Dispatch department's own dashboard bundle. The
two are independent; a problem with the first (e.g. the folder is
empty) never stops the second, and vice versa.

Adding a new department
------------------------
data/upload/ has one subfolder per department (see src/departments.py
for the full registry - it's also what the file-watcher and the
"file dropped but no pipeline yet" message below both read from).
Folders that don't have a pipeline built yet (currently: Production,
Painting) still get watched and reported on, they're just not
processed - dropping files in early doesn't do any harm, and doesn't
go unnoticed either. Building a new department's pipeline follows the
same shape as src/packing/ (reader -> normalize -> summary -> pipeline
-> its own JSON bundle -> its own dashboard page) - once it's ready,
wire it into main.py the same way run_production()/run_packing() are
wired below, and flip that department's `built` flag to True in
src/departments.py. Quality Assurance / Control (src/quality/) is
built, but - like Production (src/production/) - its own dashboard
bundle is refreshed by its own standalone entry point
(quality_main.py), not from inside main.py; what main.py DOES do for
Quality is read data/upload/quality/'s Rework Data workbook
best-effort as part of the Projects pipeline above, purely for the
PDQC override (see src/merge.py -> apply_rework_pdqc_override()).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from departments import report_unbuilt_departments  # noqa: E402
from pipeline import Pipeline, PipelineError  # noqa: E402
from packing.pipeline import PackingPipelineError, run as run_packing_pipeline  # noqa: E402


def read_packing_spools_for_merge() -> list[dict]:
    """
    Best-effort read of the Packing & Dispatch workbook(s), purely to
    backfill PDI / Packing / Dispatch on the Projects (DPR) master
    dataset - see src/merge.py -> MergeEngine.apply_packing_dates()
    and config/business_rules.json -> packing_dispatch_merge.

    Returns an empty list (never raises) if the packing config or
    upload folder is missing, or if nothing could be read - that's a
    normal state (e.g. no Packing & Dispatch workbook uploaded yet),
    not an error. The 3 fields are then simply left as the DPR/Weekly
    data has them, exactly as before this feature existed.
    """

    try:
        from packing.pipeline import load_config as load_packing_config
        from packing.reader import read_all_workbooks

        config = load_packing_config()
        upload_folder = Path(config["paths"]["upload_folder"])
        file_pattern = config["input_files"]["file_pattern"]

        if not upload_folder.exists():
            return []

        workbook_results = read_all_workbooks(upload_folder, file_pattern)

        spools: list[dict] = []
        for result in workbook_results:
            spools.extend(result["spools"])

        return spools

    except Exception as error:
        print(
            "PDI/Packing/Dispatch backfill: could not read the "
            f"Packing & Dispatch workbook(s) ({error}). Projects will "
            "process normally without it this run."
        )
        return []


def run_production() -> int:
    """Runs the Production / Spool Ageing pipeline. Returns a process exit code."""

    pipeline = Pipeline()

    packing_spools = read_packing_spools_for_merge()

    try:
        result = pipeline.run(packing_spools=packing_spools)
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
