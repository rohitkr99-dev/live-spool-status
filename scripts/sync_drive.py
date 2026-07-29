#!/usr/bin/env python3
"""
scripts/sync_drive.py
---------------------------------------------------------
Mirrors workbooks from a shared Google Drive folder into data/upload/,
so the GitHub Action can run the existing pipeline (main.py) against
whatever the latest files in Drive are.

Expected Drive layout - one root folder shared with the service
account (its ID goes in the GDRIVE_FOLDER_ID secret), containing one
subfolder per *built* department (see src/departments.py):

    <root folder>/
      projects/   -> mirrors data/upload/projects/  (DPR / Weekly / Line History / SIOP workbooks)
      packing/    -> mirrors data/upload/packing/    (one .xlsx per project)

When a currently-unbuilt department (production / quality / painting)
gets its pipeline wired into main.py later, add a matching line to
DEPARTMENT_DRIVE_SUBFOLDERS below and create the matching Drive
subfolder - nothing else about this script needs to change.

Auth: a Google Cloud service account. Its JSON key, base64-encoded,
goes in the GDRIVE_SA_KEY secret. The service account's email (the
"client_email" field in that JSON key) must be added as a Viewer on
the root Drive folder.

IMPORTANT Drive setting: in Drive's Settings (gear icon), turn OFF
"Convert uploads to Google Docs editor format". If left on, uploaded
.xlsb/.xlsx files get silently converted to native Google Sheets,
which this script cannot download as the original binary file.

Writes changed=true/false to $GITHUB_OUTPUT so the workflow can skip
running the pipeline and committing when nothing actually changed.
"""

import base64
import io
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Drive subfolder name -> local upload folder. Must match the `key` /
# `upload_folder` of each *built* Department in src/departments.py.
DEPARTMENT_DRIVE_SUBFOLDERS = {
    "projects": Path("data/upload/projects"),
    "packing": Path("data/upload/packing"),
}

# Local placeholder files that must survive even when Drive has nothing
# in the matching subfolder (git doesn't track empty folders).
KEEP_FILES = {"readme.txt", ".gitkeep"}


def get_drive_service():
    key_b64 = os.environ["GDRIVE_SA_KEY"]
    info = json.loads(base64.b64decode(key_b64))
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def find_subfolder(service, parent_id: str, name: str):
    query = (
        f"'{parent_id}' in parents and name = '{name}' "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    resp = service.files().list(q=query, fields="files(id, name)").execute()
    files = resp.get("files", [])
    return files[0]["id"] if files else None


def list_files(service, folder_id: str):
    files = []
    page_token = None
    query = (
        f"'{folder_id}' in parents and trashed = false "
        "and mimeType != 'application/vnd.google-apps.folder'"
    )
    while True:
        resp = (
            service.files()
            .list(
                q=query,
                fields="nextPageToken, files(id, name, size, mimeType)",
                pageToken=page_token,
            )
            .execute()
        )
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


def download_file(service, file_id: str, dest: Path) -> None:
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    dest.write_bytes(buf.getvalue())


def sync_folder(service, drive_folder_id: str, local_dir: Path) -> bool:
    """Mirrors drive_folder_id into local_dir. Returns True if anything changed."""
    local_dir.mkdir(parents=True, exist_ok=True)
    drive_files = list_files(service, drive_folder_id)

    skipped_native = [f["name"] for f in drive_files if "size" not in f]
    for name in skipped_native:
        print(
            f"  ! skipping '{name}' - no binary size reported (likely converted to a "
            "native Google Sheet). Turn off Drive's auto-convert-on-upload setting."
        )
    drive_files = [f for f in drive_files if "size" in f]
    drive_names = {f["name"] for f in drive_files}
    changed = False

    for existing in local_dir.iterdir():
        if not existing.is_file():
            continue
        if existing.name.lower() in KEEP_FILES or existing.name.startswith("."):
            continue
        if existing.name not in drive_names:
            print(f"  - removing (no longer in Drive): {existing}")
            existing.unlink()
            changed = True

    for f in drive_files:
        dest = local_dir / f["name"]
        drive_size = int(f["size"])
        if dest.exists() and dest.stat().st_size == drive_size:
            continue
        print(f"  - downloading: {f['name']}")
        download_file(service, f["id"], dest)
        changed = True

    return changed


def main() -> int:
    folder_id = os.environ["GDRIVE_FOLDER_ID"]
    service = get_drive_service()

    any_changed = False
    for subfolder_name, local_dir in DEPARTMENT_DRIVE_SUBFOLDERS.items():
        sub_id = find_subfolder(service, folder_id, subfolder_name)
        if sub_id is None:
            print(
                f"Drive subfolder '{subfolder_name}' not found under the shared "
                "root folder - skipping (create it in Drive if this department "
                "should be synced)."
            )
            continue
        print(f"Syncing Drive/'{subfolder_name}' -> {local_dir}/")
        if sync_folder(service, sub_id, local_dir):
            any_changed = True

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as fh:
            fh.write(f"changed={'true' if any_changed else 'false'}\n")

    print(f"\nDone. changed={any_changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
