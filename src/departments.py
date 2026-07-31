"""
src/departments.py
---------------------------------------------------------
Registry of every department's upload folder - the one place
main.py and watch.py both read from, so adding a new department to
the "python3 main.py runs everything" workflow only ever needs:

  1. One new Department() entry below (upload folder + built=False).
  2. Create data/upload/<key>/ with a placeholder file in it (git
     doesn't track empty folders, so an upload of an empty folder
     through the GitHub web UI silently does nothing - see any
     existing data/upload/<dept>/README.txt for what that placeholder
     looks like).
  3. Once that department's pipeline is actually written (its own
     src/<key>/ package, mirroring src/packing/), flip built=True and
     wire its run function into main.py the same way Production and
     Packing & Dispatch are wired.

Until step 3, main.py and the watcher both still notice files sitting
in that department's folder - they just report it rather than
processing it (see report_unbuilt_departments()), so nothing is
silently ignored while a pipeline is still being built.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# Filenames that don't count as "a real upload" when checking whether
# a department folder has anything to process - just the placeholder
# dropped in so git tracks the empty folder, or OS/Excel noise.
_IGNORED_FILENAMES = {"readme.txt", ".gitkeep"}


@dataclass(frozen=True)
class Department:
    key: str            # folder name under data/upload/, and this department's short id
    label: str           # display name, matches the landing page card where possible
    upload_folder: str   # e.g. "data/upload/production"
    built: bool          # False = folder exists and is watched, but no pipeline processes it yet


DEPARTMENTS: list[Department] = [
    # "Projects" on the landing page (website/dashboard.html) - the DPR /
    # Weekly Production Planning / Line History Sheet pipeline. Folder is
    # "projects", not "production" - see the note on the next entry.
    Department("projects", "Projects", "data/upload/projects", built=True),
    Department("packing", "Packing & Dispatch", "data/upload/packing", built=True),
    # "Production" on the landing page (website/production.html) is now
    # LIVE (see src/production/, production_main.py) - spool ageing by
    # category vs. a target-day matrix. But it's a SEPARATE pipeline
    # from "Projects" above, and it does NOT read this folder - it
    # reuses the same workbooks already in data/upload/projects/. This
    # folder (data/upload/production/) stays built=False: it's still
    # genuinely unwatched/unprocessed, reserved for a later expansion
    # of the Production page with its own, different source workbooks.
    # Easy to conflate since the DPR/Weekly-Planning pipeline is also
    # commonly called "the Production pipeline" in older code comments
    # (src/pipeline.py etc.) - that one's landing-page card is
    # "Projects", not this one. See data/upload/production/README.txt.
    Department("production", "Production", "data/upload/production", built=False),
    Department("quality", "Quality Assurance / Control", "data/upload/quality", built=False),
    Department("painting", "Painting", "data/upload/painting", built=False),
]


def has_uploaded_files(folder: str) -> bool:
    """True if `folder` contains anything besides the placeholder file / OS noise."""
    path = Path(folder)
    if not path.exists():
        return False
    for entry in path.iterdir():
        if not entry.is_file():
            continue
        name = entry.name
        if name.startswith("~$") or name.startswith("."):
            continue
        if name.lower() in _IGNORED_FILENAMES:
            continue
        return True
    return False


def report_unbuilt_departments(log_fn: Callable[[str], None]) -> None:
    """
    Call once per main.py / watcher run, after the built pipelines
    have run. Reports (via log_fn - print or logger.info both work)
    any department whose folder has real files in it but no pipeline
    built yet, so a file never just sits there unprocessed in silence.
    """
    for dept in DEPARTMENTS:
        if dept.built:
            continue
        if has_uploaded_files(dept.upload_folder):
            log_fn(
                f"{dept.label}: file(s) found in {dept.upload_folder}/, "
                "but no pipeline is built for this department yet - skipping."
            )
