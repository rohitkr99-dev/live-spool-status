"""
watch.py
---------------------------------------------------------
Watches data/upload/ and automatically re-runs the pipeline
whenever an Excel file is added, replaced, or removed there - so
the person never has to type a command after the first one. Start
it once (python3 main.py --watch, or python3 -m watch) and leave it
running in the background; from then on, dropping in a fresh DPR /
Weekly Production / Line History Sheet workbook is enough.

Design notes
------------
- Debounced: Excel saves/copies fire several filesystem events in
  quick succession (and some tools write a temp file first). A
  single change waits DEBOUNCE_SECONDS of quiet before triggering a
  run, so a multi-file copy only reprocesses once.
- Ignores noise: Excel's own lock files (~$Book1.xlsb) and anything
  outside data/upload/ (in particular processed/ and logs/, which
  the pipeline itself writes to) are ignored, so the pipeline never
  ends up triggering itself.
- Runs once immediately on startup, then again on every subsequent
  change - so starting the watcher always leaves the dashboard
  bundle up to date with whatever's in data/upload/ right now.
- A run that fails (bad/missing file, validation error) is logged
  and the watcher keeps running - one bad drop-in shouldn't require
  restarting it.
"""

from __future__ import annotations

import time
from pathlib import Path
from threading import Timer

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from config_loader import load_settings
from logger import logger
from pipeline import Pipeline, PipelineError

DEBOUNCE_SECONDS = 3.0


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


def run_pipeline_once() -> None:
    """
    Run the pipeline one time, logging (but not raising on) any
    failure - the watcher must survive a bad file drop.
    """

    logger.info("Change detected in data/upload/ - reprocessing...")

    try:
        result = Pipeline().run()
    except PipelineError as error:
        logger.error(f"Pipeline stopped: {error}")
        return
    except FileNotFoundError as error:
        logger.error(f"Pipeline stopped: {error}")
        return
    except Exception as error:  # noqa: BLE001 - watcher must not die
        logger.error(f"Pipeline run failed unexpectedly: {error}")
        return

    logger.info(
        f"Done - processed {result['rows_processed']} spool(s). "
        "Upload processed/dashboard_data.json into the dashboard "
        "to see it."
    )


def watch() -> None:
    """
    Run the pipeline once immediately, then watch data/upload/ and
    re-run on every change until interrupted (Ctrl+C).
    """

    settings = load_settings()
    upload_folder = Path(settings["paths"]["upload_folder"])
    upload_folder.mkdir(parents=True, exist_ok=True)

    logger.info(f"Watching {upload_folder} for changes. Press Ctrl+C to stop.")

    run_pipeline_once()

    handler = UploadFolderHandler(run_pipeline_once)
    observer = Observer()
    observer.schedule(handler, str(upload_folder), recursive=True)
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
