# Packing & Dispatch dashboard

This repo already has the Packing & Dispatch dashboard built in (see
`website/packing-dispatch.html`, linked as "Live" from the landing page).
This file just documents how it works and how to update its data later —
nothing here needs to be "applied," it's already part of the repo.

`python3 main.py` now refreshes **both** dashboards in one run — the
Production / Spool Ageing dashboard (from whatever's directly in
`data/upload/`) and the Packing & Dispatch dashboard (from whatever's in
`data/upload/packing/`). They're still two independent pipelines under the
hood (see `src/pipeline.py` vs `src/packing/pipeline.py`) — nothing in
`config/settings.json`, `schema.json`, or `business_rules.json` was
touched, and a problem with one (e.g. a missing DPR file, or no Packing &
Dispatch workbooks yet) doesn't stop the other from running or from
updating its own dashboard.

`python3 main.py --watch` also watches both — since
`data/upload/packing/` is a subfolder of `data/upload/`, the same watcher
picks up changes in either place and reprocesses automatically.

If you only ever want to refresh Packing & Dispatch (skip Production
entirely), `python3 packing_main.py` still works on its own too — it's
the exact same code `main.py` calls, just scoped to one pipeline.

## Updating the data

Whenever you have a fresh, complete set of packing/dispatch workbooks:

1. Replace the contents of `data/upload/packing/` with the new workbooks
   (delete the old ones, drop in the new ones — the pipeline reads
   whatever's in that folder each run; it's a full replace, not an
   incremental merge).
2. Run:
   ```
   python3 main.py
   ```
   (this also refreshes the Production dashboard, if its own source files
   are present in `data/upload/`; use `python3 packing_main.py` instead if
   you want to touch only Packing & Dispatch)
3. Commit and push the updated JSON file(s). For a `main.py` run, that's
   typically:
   ```
   git add website/data/packing_dispatch_data.json processed/packing_dispatch_data.json website/data/dashboard_data.json processed/dashboard_data.json
   git commit -m "Update dashboards"
   git push
   ```
   (drop the `dashboard_data.json` paths if Production didn't actually
   change this time)

Everyone visiting the hosted dashboards sees the new data immediately —
no upload needed on their end. There's also an "Upload Data" button on
each dashboard page, for previewing a JSON bundle locally without
publishing it.

## What the pipeline does with your data

- Reads every `.xlsx` in `data/upload/packing/`. Each workbook needs a
  sheet with "Spool" in its name (row-level spool list) and, optionally, a
  sheet named exactly "Summary" (row-level packing list per Box No.).
- `Project Code` + `Drawing No.` + `Spool No.` is read straight out of each
  file — same composite key the Production pipeline uses, kept independent
  for now (no join to `master_spools.json`).
- `TJ-25-26-182` Small Bore / Large Bore are combined into one project
  (`TJ/25-26/182`) automatically.
- Column names vary a lot between workbooks (e.g. `Spool No` vs
  `Final Spool no.`, `Item Category` vs `Item Category Code`) — see
  `src/packing/normalize.py` → `SPOOL_COLUMN_ALIASES` / `BOX_COLUMN_ALIASES`
  for the full mapping. Add a new alias there if a future workbook uses yet
  another header spelling.
- `Packing Status` text (`PACKED`, `COMPLETE PACKED`, `COMPLETE PACK`,
  `DISPATCHED`, blank) is normalized to 3 categories: **Pending / Under
  Packing**, **Packed**, **Dispatched** — see `normalize_status()` in the
  same file. Blank = not yet packed into a box.
- A "shipment" = one Container No. (from the Summary sheet). Weight is
  assumed to already be in kg.
- Logs go to `logs/packing.log`, separate from the Production pipeline's
  `logs/application.log`.

## One thing worth deciding

`data/upload/packing/*.xlsx` are your real project files, committed here
so `packing_main.py` has something to run against out of the box. Whether
you want raw workbooks tracked in git (vs. just the JSON output) is your
call — if not, add `data/upload/` to a `.gitignore` and only commit the
two generated JSON files after each run; the dashboard only ever reads
those, never the source workbooks directly.
