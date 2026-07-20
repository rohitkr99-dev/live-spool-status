"""
tests/test_watch.py
---------------------------------------------------------
Covers the debounce/noise-filtering logic in watch.py directly, plus
one real end-to-end test that drops files into an actual watched
folder and confirms a burst of changes collapses into a single
pipeline run.
"""

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import watch  # noqa: E402


# -----------------------------------------------------
# _is_noise
# -----------------------------------------------------

@pytest.mark.parametrize("path,expected", [
    ("/some/folder/~$DPR.xlsb", True),
    ("/some/folder/.DS_Store", True),
    ("/some/folder/DPR_Report.xlsb", False),
    ("/some/folder/Weekly Production.xlsb", False),
])
def test_is_noise(path, expected):

    assert watch._is_noise(path) == expected


# -----------------------------------------------------
# UploadFolderHandler debouncing
# -----------------------------------------------------

def test_handler_debounces_a_burst_of_events():
    """
    Several events in quick succession must collapse into exactly
    one call once things go quiet.
    """

    watch.DEBOUNCE_SECONDS = 0.15

    calls = []
    handler = watch.UploadFolderHandler(lambda: calls.append(1))

    class FakeEvent:
        def __init__(self, path):
            self.src_path = path
            self.is_directory = False

    handler.on_created(FakeEvent("/tmp/upload/DPR.xlsb"))
    time.sleep(0.05)
    handler.on_modified(FakeEvent("/tmp/upload/DPR.xlsb"))
    time.sleep(0.05)
    handler.on_modified(FakeEvent("/tmp/upload/DPR.xlsb"))

    # Not enough quiet time has passed yet - no call should have
    # landed.
    assert calls == []

    time.sleep(0.3)

    assert calls == [1]


def test_handler_ignores_lock_files():

    watch.DEBOUNCE_SECONDS = 0.1

    calls = []
    handler = watch.UploadFolderHandler(lambda: calls.append(1))

    class FakeEvent:
        def __init__(self, path):
            self.src_path = path
            self.is_directory = False

    handler.on_created(FakeEvent("/tmp/upload/~$DPR.xlsb"))

    time.sleep(0.3)

    assert calls == []


# -----------------------------------------------------
# End-to-end: a real watchdog Observer on a real folder
# -----------------------------------------------------

def test_watcher_collapses_a_real_file_burst_into_one_run(tmp_path):

    from watchdog.observers import Observer

    watch.DEBOUNCE_SECONDS = 0.2

    calls = []
    handler = watch.UploadFolderHandler(lambda: calls.append(1))

    observer = Observer()
    observer.schedule(handler, str(tmp_path), recursive=True)
    observer.start()

    try:
        # Simulate copying in a few files close together, the way a
        # person dragging 2-3 workbooks into the folder would.
        (tmp_path / "DPR.xlsb").write_text("a")
        time.sleep(0.05)
        (tmp_path / "Weekly.xlsb").write_text("b")
        time.sleep(0.05)
        (tmp_path / "DPR.xlsb").write_text("a-updated")

        time.sleep(0.6)  # let the debounce timer fire
    finally:
        observer.stop()
        observer.join()

    assert calls == [1]
