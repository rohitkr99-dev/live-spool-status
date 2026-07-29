"""
watch.py
---------------------------------------------------------
Watches data/upload/ - every department's subfolder underneath it
(data/upload/projects/, data/upload/packing/, and any future
department added to src/departments.py) - and automatically re-runs
every built pipeline whenever an Excel file is added, replaced, or
removed anywhere in that tree, so the person never has to type a
command after the first one. Start it once (python3 main.py --watch,
or python3 -m watch) and leave it running in the background; from
then on, dropping in a fresh workbook to any department's folder is
enough.

Design notes
------------
- Watches data/upload/ itself (the shared parent), not any single
  department's configured upload_folder - so this one watcher keeps
  covering every department automatically as new ones are added to
  src/departments.py, with no changes needed here.
- Debounced: Excel saves/copies fire several filesystem events in
  quick succession (and some tools write a temp file first). A
  single change waits DEBOUNCE_SECONDS of quiet before triggering a
  run, so a multi-file copy only reprocesses once.
- Ignores noise: Excel's own lock files (~$Book1.xlsb), hidden/temp
  files, and anything outside data/upload/ (in particular processed/
  and logs/, which the pipelines themselves write to) are ignored, so
  a pipeline never ends up triggering itself.
- Runs every built pipeline once immediately on startup, then again
  on every subsequent change - so starting the watcher always leaves
  every dashboard up to date with whatever's in data/upload/ right
  now. Departments are independent: a problem with one (e.g. a
  missing DPR file, or no Packing & Dispatch workbooks yet) doesn't
  stop any other department from running.
- A run that fails (bad/missing file, validation error) is logged
  and the watcher keeps running - one bad drop-in shouldn't require
  restarting it.
- A department with files but no pipeline built yet (see
  src/departments.py -> Department.built) is reported on every run,
  same as a one-off `python3 main.py` - see report_unbuilt_departments().
"""

from __future__ import annotations

import time
from pathlib import Path
from threading import Timer

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from departments import report_unbuilt_departments
from logger import logger
from packing.logger import logger as packing_logger
from packing.pipeline import PackingPipelineError, run as run_packing_pipeline
from pipeline import Pipeline, PipelineError

DEBOUNCE_SECONDS = 3.0
UPLOAD_ROOT = Path("data/upload")


def _is_noise(path: str) -> bool:
    """Excel lock files (~$...) and hidden/temp files - never worth a run."""

    name = Path(path).name
    return name.startswith("~$") or name.startswith(".")


class UploadFolderHandler(FileSystemEventHandler):
    """
    Collapses a burst of filesystem events into a single debounced
    pipeline run.
    """

    def __init__(self, on_change):
        self.on_change = on_change
        self._timer: Timer | None = None

    def _schedule(self, path: str):

        if _is_noise(path):
            return

        if self._timer is not None:
            self._timer.cancel()

        self._timer = Timer(DEBOUNCE_SECONDS, self.on_change)
        self._timer.daemon = True
        self._timer.start()

    def on_created(self, event):
        if not event.is_directory:
            self._schedule(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._schedule(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._schedule(event.dest_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._schedule(event.src_path)


def run_pipelines_once() -> None:
    """
    Run every built pipeline one time, logging (but not raising on)
    any failure - the watcher must survive a bad file drop. Every
    department is independent, so one failing doesn't stop another.
    """

    logger.info("Change detected in data/upload/ - reprocessing...")

    try:
        result = Pipeline().run()
        logger.info(
            f"Production: done - processed {result['rows_processed']} spool(s). "
            "website/data/dashboard_data.json is up to date."
        )
    except PipelineError as error:
        logger.error(f"Production pipeline stopped: {error}")
    except FileNotFoundError as error:
        logger.error(f"Production pipeline stopped: {error}")
    except Exception as error:  # noqa: BLE001 - watcher must not die
        logger.error(f"Production pipeline run failed unexpectedly: {error}")

    try:
        result = run_packing_pipeline()
        packing_logger.info(
            f"Packing & Dispatch: done - processed {result['spool_rows']} spool row(s), "
            f"{result['box_rows']} box row(s) across {result['projects']} project(s). "
            "website/data/packing_dispatch_data.json is up to date."
        )
    except PackingPipelineError as error:
        packing_logger.info(f"Packing & Dispatch: skipped ({error})")
    except Exception as error:  # noqa: BLE001 - watcher must not die
        packing_logger.error(f"Packing & Dispatch pipeline run failed unexpectedly: {error}")

    report_unbuilt_departments(logger.info)


def watch() -> None:
    """
    Run every built pipeline once immediately, then watch data/upload/
    (every department's subfolder) and re-run on every change until
    interrupted (Ctrl+C).
    """

    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

    logger.info(f"Watching {UPLOAD_ROOT} for changes (every department subfolder underneath it). Press Ctrl+C to stop.")

    run_pipelines_once()

    handler = UploadFolderHandler(run_pipelines_once)
    observer = Observer()
    observer.schedule(handler, str(UPLOAD_ROOT), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Stopping watcher.")
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    watch()
