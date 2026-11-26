"""Turns the newest "Drawing Line List" workbook (BOM) in the Drive BOM folder, whatever its file name, into small per-project JSON files.

Why: the BOM workbook is ~28 MB (about 390 MB of sheet XML), far too big for the web page or for
Google Apps Script. The Material Handover section only needs, per project, the item lines of each spool.

Drive layout (inside the tracker's shared root folder, GDRIVE_FOLDER_ID):
    BOM/                                   <- you upload the Drawing Line List here (any file name; see _newest_source)
    BOM/data/<project>.json                <- written by this script (private, Drive only - never the public repo)
    BOM/data/_manifest.json                <- which source file the data came from
    BOM/Item Master DD-MM-YY.xlsb          <- optional: master of all item codes; Description, Item Category Code, Normal Size and
                                              Schedule of every BOM item code are taken from the newest one (see read_master)

Run:  python3 scripts/build_bom.py            (needs GDRIVE_SA_KEY + GDRIVE_FOLDER_ID; the service account needs Editor on BOM/)
      python3 scripts/build_bom.py --local FILE.xlsx OUTDIR [ITEM_MASTER]     (no Drive: convert local files, for testing)
"""
import base64
import io
import json
import os
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
FORMAT = 4   # 4 = each project file also carries qty {drawing|spool: N} for spools made N times; 3 = item lines also carry the Schedule; (2 = surface area); bump it to force a rebuild of every project file
EXT_RE = re.compile(r"\.xls[xmb]$", re.I)                                  # any Excel format
BOM_NAME_RE = re.compile(r"line[\s_.-]*list|bom", re.I)                          # "Drawing Line List ...", "Drawing_Line_List", "BOM ..." - the exact wording does not matter
MASTER_NAME_RE = re.compile(r"item[\s_.-]*master", re.I)                    # "Item Master DD-MM-YY.xlsb"
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[-./_ ](\d{1,2})[-./_ ](\d{4}|\d{2})(?!\d)")   # first date in the name: 06-11-2026, 6.11.26, 06_11_26 ...


def _name_date(name):
    """The date written in a file name (DD-MM-YYYY or DD-MM-YY), or None."""
    from datetime import date
    m = DATE_RE.search(name)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y = y + 2000 if y < 100 else y
    try:
        return date(y, mo, d)
    except ValueError:
        return None

# BOM column -> short key used in the per-spool item arrays
# item line = [serial, code, description, qty, uom, category, size, surface area m2 (for all copies of the spool, as in the BOM), schedule]
COLS = {
    "project": "Project Code", "drawing": "Drawing No.", "spool": "Spool No", "serial": "S.No.", "icd": "ICD", "aicd": "Current AICD",
    "desc": "Description", "qty": "Quantity", "uom": "Unit of Measure", "cat": "Item Category Code", "size": "Normal Size", "area": "Surface Area Out", "sched": "Schedule",
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


def _cell_text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def iter_rows_xlsb(path, key="Project Code"):
    """The same rows from an .xlsb workbook: the first sheet whose header row has the key column."""
    from pyxlsb import open_workbook
    with open_workbook(str(path)) as wb:
        for name in wb.sheets:
            with wb.get_sheet(name) as sheet:
                rows = sheet.rows()
                first = next(rows, None)
                if first is None or key not in [_cell_text(c.v).strip() for c in first]:
                    continue
                yield [_cell_text(c.v) for c in first]
                for row in rows:
                    yield [_cell_text(c.v) for c in row]
                return
    raise RuntimeError("no sheet with a '%s' column found in %s" % (key, path))


def iter_rows(xlsx_path, key="Project Code"):
    """Streams the biggest worksheet row by row as lists of strings (handles inline and shared strings)."""
    if str(xlsx_path).lower().endswith(".xlsb"):
        yield from iter_rows_xlsb(xlsx_path, key)
        return
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


def read_master(path):
    """Item Master -> {ITEM CODE: (description, category, normal size, schedule)}. Only these four fields are read (never costs)."""
    head, out = None, {}
    for vals in iter_rows(path, key="No."):
        if head is None:
            head = {h.strip(): i for i, h in enumerate(vals)}
            missing = [c for c in ("No.", "Description", "Item Category Code", "Normal Size", "Schedule") if c not in head]
            if missing:
                raise RuntimeError("Item Master columns missing: %s" % missing)
            continue
        g = lambda name: _clean(vals[head[name]]) if head[name] < len(vals) else ""
        if g("No."):
            out[g("No.").upper()] = (g("Description"), g("Item Category Code"), g("Normal Size"), g("Schedule"))
    return out


def convert(xlsx_path, master=None):
    """-> {project: {"spools": {"<drawing>|<spool>": [item lines]}}} (spool header rows are skipped).
    master (from read_master): its non-empty values replace the BOM's description, category, size and schedule of the same item code."""
    used, unknown = set(), set()
    head = None
    out = {}
    qtys = {}        # project -> {"drawing|spool": N} for spools made more than once (the Quantity of the spool's own header row)
    hdr_seen = {}    # the header quantities found, only to print an overview (a wrong column would show up here)
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
        if not project or not spool:
            continue
        if _clean(desc).lower() == "spool":
            q = _num(g(COLS["qty"]))
            hdr_seen[q] = hdr_seen.get(q, 0) + 1
            if isinstance(q, (int, float)) and q >= 2 and float(q).is_integer():
                qtys.setdefault(project, {})[drawing + "|" + spool] = int(q)
            continue
        code = (g(COLS["aicd"]) or g(COLS["icd"])).strip()
        line = [g(COLS["serial"]), code, _clean(desc), _num(g(COLS["qty"])), g(COLS["uom"]).strip(), g(COLS["cat"]).strip(), _clean(g(COLS["size"])), _num(g(COLS["area"])), _clean(g(COLS["sched"]))]
        if master is not None and code:
            m = master.get(code.upper())
            if m:
                used.add(code.upper())
                for pos, value in zip((2, 5, 6, 8), m):
                    if value:
                        line[pos] = value
            else:
                unknown.add(code.upper())
        out.setdefault(project, {}).setdefault(drawing + "|" + spool, []).append(line)
    print("Spool header quantities (value: number of spools): " + ", ".join("%s: %d" % (k if k != "" else "(empty)", v) for k, v in sorted(hdr_seen.items(), key=lambda kv: -kv[1])[:8]))
    if master is not None:
        print("Item Master: %d item codes of the BOM found, %d not in the master (BOM values kept)%s" % (len(used), len(unknown), ": " + ", ".join(sorted(unknown)[:10]) if unknown else ""))
    return {p: ({"spools": s, "qty": qtys[p]} if qtys.get(p) else {"spools": s}) for p, s in out.items()}


def safe_name(project: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", project) + ".json"


def write_local(xlsx_path, outdir, source_name=None, master_path=None):
    os.makedirs(outdir, exist_ok=True)
    data = convert(xlsx_path, read_master(master_path) if master_path else None)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = {"source": source_name or os.path.basename(xlsx_path), "built": built, "projects": {}}
    for project, body in data.items():
        payload = {"project": project, "source": manifest["source"], "built": built, "spools": body["spools"]}
        if body.get("qty"): payload["qty"] = body["qty"]
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


def _newest_source(svc, bom_id, name_re=BOM_NAME_RE, label="BOM"):
    """The newest BOM workbook in BOM/, whatever it is called. Any Excel file whose name mentions "Line List" or "BOM" counts (temporary
    "~$" files and anything that is not Excel are ignored). Newest = the date written in the name; a file without a readable date counts
    from the day it was last modified in Drive; ties go to the file modified last. Every file seen is printed so a surprise is visible."""
    r = svc.files().list(q="'%s' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'" % bom_id,
                         fields="files(id,name,size,modifiedTime)", pageSize=200, supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
    cands, skipped = [], []
    for f in r.get("files", []):
        name = f["name"].strip()
        if name.startswith("~$") or not EXT_RE.search(name) or not name_re.search(name):
            skipped.append(name)
            continue
        mod = f.get("modifiedTime") or ""
        nd = _name_date(name)
        eff = nd or (datetime.strptime(mod[:10], "%Y-%m-%d").date() if mod[:10] else None)
        if eff is None:
            skipped.append(name)
            continue
        cands.append(((eff, mod), f, nd))
    cands.sort(key=lambda c: c[0])
    for key, f, nd in cands:
        print("  %s file: %-50s date %s (%s)" % (label, f["name"].strip(), key[0], "from the name" if nd else "from the Drive modified date"))
    if skipped and label == "BOM":
        print("  ignored (not a BOM workbook): " + ", ".join(skipped))
    return cands[-1][1] if cands else None


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
        print("ACTION NEEDED: no BOM workbook (an Excel file with 'Line List' or 'BOM' in its name) found in the Drive BOM folder.")
        return 1
    mst = _newest_source(svc, bom_id, MASTER_NAME_RE, "Item Master")
    if not mst:
        print("No Item Master in BOM/ - descriptions come from the BOM file only.")
    mst_id = "%s|%s|%s" % (mst["name"], mst.get("size"), mst.get("modifiedTime")) if mst else None
    data_f = _find(svc, bom_id, "data", folder=True)
    data_id = data_f[0]["id"] if data_f else svc.files().create(body={"name": "data", "parents": [bom_id], "mimeType": "application/vnd.google-apps.folder"}, fields="id", supportsAllDrives=True).execute()["id"]
    man = _find(svc, data_id, "_manifest.json")
    old = {}
    if man:
        old = json.loads(svc.files().get_media(fileId=man[0]["id"]).execute().decode("utf-8"))
        if old.get("source") == src["name"] and old.get("size") == src.get("size") and old.get("modified") == src.get("modifiedTime") and old.get("format") == FORMAT and old.get("master") == mst_id:
            print("Up to date: %s (already converted)." % src["name"])
            return 0
    print("Converting %s ..." % src["name"])
    def fetch(f, stem):
        path = os.path.join(tempfile.gettempdir(), stem + os.path.splitext(f["name"].strip())[1].lower())
        with open(path, "wb") as fh:
            dl = MediaIoBaseDownload(fh, svc.files().get_media(fileId=f["id"]))
            done = False
            while not done:
                _, done = dl.next_chunk()
        return path

    data = convert(fetch(src, "bom_source"), read_master(fetch(mst, "item_master")) if mst else None)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Projects missing from today's BOM are left exactly as they are: their files are never deleted or changed, and they stay in the
    # manifest (project list of the page) with the source/date of the BOM they came from. Only projects present in the BOM are updated.
    old_projects = old.get("projects") if isinstance(old.get("projects"), dict) else {}
    manifest = {"source": src["name"], "size": src.get("size"), "modified": src.get("modifiedTime"), "format": FORMAT, "master": mst_id, "built": built, "projects": dict(old_projects)}
    missing = []
    for project, body in data.items():
        payload = {"project": project, "source": src["name"], "built": built, "spools": body["spools"]}
        if body.get("qty"): payload["qty"] = body["qty"]
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        ex = _find(svc, data_id, safe_name(project))
        if not ex:   # a service account cannot create files in a personal Drive (no storage quota); it can only update files that exist
            missing.append(safe_name(project))
            continue
        _upload(svc, data_id, safe_name(project), text, ex[0]["id"])
        manifest["projects"][project] = {"file": safe_name(project), "spools": len(body["spools"]), "items": sum(len(v) for v in body["spools"].values()), "bytes": len(text.encode("utf-8")), "source": src["name"], "built": built}
        print("  - %s: %d spools, %d items, %.0f KB" % (project, manifest["projects"][project]["spools"], manifest["projects"][project]["items"], len(text.encode("utf-8")) / 1024))
    if missing or not man:
        print("\nACTION NEEDED: create an EMPTY text file with each of these names inside Drive BOM/data (as a normal user, e.g. upload a file containing {}), then run this job again:")
        for m in (["_manifest.json"] if not man else []) + missing:
            print("   " + m)
        return 1
    _upload(svc, data_id, "_manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1), man[0]["id"])
    kept = [p for p in old_projects if p not in data]
    print("Done: %d projects updated%s." % (len(data), ("; kept untouched (not in this BOM): " + ", ".join(kept)) if kept else ""))
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--local":
        m = write_local(sys.argv[2], sys.argv[3], master_path=sys.argv[4] if len(sys.argv) > 4 else None)
        for p, i in m["projects"].items():
            print("%-14s %5d spools %6d items %7.0f KB" % (p, i["spools"], i["items"], i["bytes"] / 1024))
        print("total %.1f MB" % (sum(i["bytes"] for i in m["projects"].values()) / 1048576))
    else:
        sys.exit(run_drive())
