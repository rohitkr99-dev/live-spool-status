"""Turns the daily "Drawing Line List DD-MM-YYYY.xlsx" (BOM) into small per-project JSON files.

Why: the BOM workbook is ~28 MB (about 390 MB of sheet XML), far too big for the web page or for
Google Apps Script. The Material Handover section only needs, per project, the item lines of each spool.

Drive layout (inside the tracker's shared root folder, GDRIVE_FOLDER_ID):
    BOM/                                   <- you upload "Drawing Line List DD-MM-YYYY.xlsx" here
    BOM/data/<project>.json                <- written by this script (private, Drive only - never the public repo)
    BOM/data/_manifest.json                <- which source file the data came from

Run:  python3 scripts/build_bom.py            (needs GDRIVE_SA_KEY + GDRIVE_FOLDER_ID; the service account needs Editor on BOM/)
      python3 scripts/build_bom.py --local FILE.xlsx OUTDIR     (no Drive: convert a local file, for testing)
"""
import base64
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NAME_RE = re.compile(r"^Drawing Line List\s*(\d{2})-(\d{2})-(\d{4})\.xlsx$", re.I)

# BOM column -> short key used in the per-spool item arrays
# item line = [serial, code, description, qty, uom, category, size]
COLS = {
    "project": "Project Code", "drawing": "Drawing No.", "spool": "Spool No", "serial": "S.No.", "icd": "ICD", "aicd": "Current AICD",
    "desc": "Description", "qty": "Quantity", "uom": "Unit of Measure", "cat": "Item Category Code", "size": "Normal Size",
}


def _col_index(ref: str) -> int:
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().rstrip(",")).strip()


def _num(s: str):
    try:
        f = float(s)
    except (TypeError, ValueError):
        return s or ""
    return int(f) if f == int(f) else round(f, 3)


def iter_rows(xlsx_path):
    """Streams the biggest worksheet row by row as lists of strings (handles inline and shared strings)."""
    z = zipfile.ZipFile(xlsx_path)
    sheets = [i for i in z.infolist() if re.match(r"xl/worksheets/sheet\d+\.xml$", i.filename)]
    if not sheets:
        raise RuntimeError("no worksheet found in " + str(xlsx_path))
    sheet = max(sheets, key=lambda i: i.file_size).filename
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        with z.open("xl/sharedStrings.xml") as f:
            for _, el in ET.iterparse(f, events=("end",)):
                if el.tag == NS + "si":
                    shared.append("".join(t.text or "" for t in el.iter(NS + "t")))
                    el.clear()
    with z.open(sheet) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != NS + "row":
                continue
            vals = []
            for c in el.findall(NS + "c"):
                ref = c.get("r")
                pos = _col_index(ref) if ref else len(vals)
                while len(vals) < pos:
                    vals.append("")
                v, is_ = c.find(NS + "v"), c.find(NS + "is")
                if is_ is not None:
                    txt = "".join(t.text or "" for t in is_.iter(NS + "t"))
                elif v is not None and c.get("t") == "s":
                    txt = shared[int(v.text)]
                else:
                    txt = v.text if v is not None and v.text is not None else ""
                vals.append(txt)
            el.clear()
            yield vals


def convert(xlsx_path):
    """-> {project: {"spools": {"<drawing>|<spool>": [item lines]}}} (spool header rows are skipped)."""
    head = None
    out = {}
    for n, vals in enumerate(iter_rows(xlsx_path)):
        if n == 0:
            head = {h: i for i, h in enumerate(vals)}
            missing = [c for c in ("Project Code", "Drawing No.", "Spool No", "Description", "Quantity") if c not in head]
            if missing:
                raise RuntimeError("BOM columns missing: %s" % missing)
            continue
        g = lambda name: vals[head[name]] if name in head and head[name] < len(vals) else ""
        desc = g(COLS["desc"])
        project, drawing, spool = g(COLS["project"]).strip(), g(COLS["drawing"]).strip(), g(COLS["spool"]).strip()
        if not project or not spool or _clean(desc).lower() == "spool":
            continue
        code = (g(COLS["aicd"]) or g(COLS["icd"])).strip()
        line = [g(COLS["serial"]), code, _clean(desc), _num(g(COLS["qty"])), g(COLS["uom"]).strip(), g(COLS["cat"]).strip(), _clean(g(COLS["size"]))]
        out.setdefault(project, {}).setdefault(drawing + "|" + spool, []).append(line)
    return {p: {"spools": s} for p, s in out.items()}


def safe_name(project: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", project) + ".json"


def write_local(xlsx_path, outdir, source_name=None):
    os.makedirs(outdir, exist_ok=True)
    data = convert(xlsx_path)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"source": source_name or os.path.basename(xlsx_path), "built": built, "projects": {}}
    for project, body in data.items():
        payload = {"project": project, "source": manifest["source"], "built": built, "spools": body["spools"]}
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(outdir, safe_name(project)), "w", encoding="utf-8") as fh:
            fh.write(text)
        manifest["projects"][project] = {"file": safe_name(project), "spools": len(body["spools"]), "items": sum(len(v) for v in body["spools"].values()), "bytes": len(text.encode("utf-8"))}
    with open(os.path.join(outdir, "_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    return manifest


# ---------------------------------------------------------------- Drive (only used by the scheduled job)

def _drive():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    raw = os.environ["GDRIVE_SA_KEY"]   # base64 of the key file, same secret as scripts/sync_drive.py
    info = json.loads(raw if raw.lstrip().startswith("{") else base64.b64decode(raw))
    creds = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/drive"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find(svc, parent, name, folder=False):
    q = "'%s' in parents and trashed = false and name = '%s'" % (parent, name.replace("'", "\\'"))
    if folder:
        q += " and mimeType = 'application/vnd.google-apps.folder'"
    r = svc.files().list(q=q, fields="files(id,name,size,modifiedTime)", pageSize=10, supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
    return r.get("files", [])


def _newest_source(svc, bom_id):
    r = svc.files().list(q="'%s' in parents and trashed = false and name contains 'Drawing Line List'" % bom_id, fields="files(id,name,size)", pageSize=200,
                         supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
    best = None
    for f in r.get("files", []):
        m = NAME_RE.match(f["name"].strip())
        if m:
            d = (int(m.group(3)), int(m.group(2)), int(m.group(1)))
            if best is None or d > best[0]:
                best = (d, f)
    return best[1] if best else None


def _upload(svc, parent, name, text, existing_id=None):
    from googleapiclient.http import MediaIoBaseUpload
    media = MediaIoBaseUpload(io.BytesIO(text.encode("utf-8")), mimetype="application/json", resumable=False)
    if existing_id:
        svc.files().update(fileId=existing_id, media_body=media, supportsAllDrives=True).execute()
    else:
        svc.files().create(body={"name": name, "parents": [parent]}, media_body=media, fields="id", supportsAllDrives=True).execute()


def run_drive():
    from googleapiclient.http import MediaIoBaseDownload
    svc = _drive()
    root = os.environ["GDRIVE_FOLDER_ID"]
    bom = _find(svc, root, "BOM", folder=True)
    if not bom:
        print("Drive folder 'BOM' not found under the shared root - nothing to do.")
        return 0
    bom_id = bom[0]["id"]
    src = _newest_source(svc, bom_id)
    if not src:
        print("No 'Drawing Line List DD-MM-YYYY.xlsx' in BOM/ - nothing to do.")
        return 0
    data_f = _find(svc, bom_id, "data", folder=True)
    data_id = data_f[0]["id"] if data_f else svc.files().create(body={"name": "data", "parents": [bom_id], "mimeType": "application/vnd.google-apps.folder"}, fields="id", supportsAllDrives=True).execute()["id"]
    man = _find(svc, data_id, "_manifest.json")
    if man:
        old = json.loads(svc.files().get_media(fileId=man[0]["id"]).execute().decode("utf-8"))
        if old.get("source") == src["name"] and old.get("size") == src.get("size"):
            print("Up to date: %s (already converted)." % src["name"])
            return 0
    print("Converting %s ..." % src["name"])
    tmp = "/tmp/bom_source.xlsx"
    with open(tmp, "wb") as fh:
        dl = MediaIoBaseDownload(fh, svc.files().get_media(fileId=src["id"]))
        done = False
        while not done:
            _, done = dl.next_chunk()
    data = convert(tmp)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"source": src["name"], "size": src.get("size"), "built": built, "projects": {}}
    for project, body in data.items():
        payload = {"project": project, "source": src["name"], "built": built, "spools": body["spools"]}
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        ex = _find(svc, data_id, safe_name(project))
        _upload(svc, data_id, safe_name(project), text, ex[0]["id"] if ex else None)
        manifest["projects"][project] = {"file": safe_name(project), "spools": len(body["spools"]), "items": sum(len(v) for v in body["spools"].values()), "bytes": len(text.encode("utf-8"))}
        print("  - %s: %d spools, %d items, %.0f KB" % (project, manifest["projects"][project]["spools"], manifest["projects"][project]["items"], len(text.encode("utf-8")) / 1024))
    _upload(svc, data_id, "_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1), man[0]["id"] if man else None)
    print("Done: %d projects." % len(data))
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--local":
        m = write_local(sys.argv[2], sys.argv[3])
        for p, i in m["projects"].items():
            print("%-14s %5d spools %6d items %7.0f KB" % (p, i["spools"], i["items"], i["bytes"] / 1024))
        print("total %.1f MB" % (sum(i["bytes"] for i in m["projects"].values()) / 1048576))
    else:
        sys.exit(run_drive())
