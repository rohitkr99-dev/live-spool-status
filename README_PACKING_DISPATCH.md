# Packing & Dispatch dashboard

This repo already has the Packing & Dispatch dashboard built in (see
`website/packing-dispatch.html`, linked as "Live" from the landing page).
This file just documents how it works and how to update its data later —
nothing here needs to be "applied," it's already part of the repo.

It's a self-contained, independent pipeline — it does not share code or
state with the Production pipeline (`main.py` / `src/pipeline.py`), and
nothing in `config/settings.json`, `schema.json`, or `business_rules.json`
was touched.

## Updating the data

Whenever you have a fresh, complete set of packing/dispatch workbooks:

1. Replace the contents of `data/upload/packing/` with the new workbooks
   (delete the old ones, drop in the new ones — the pipeline reads
   whatever's in that folder each run; it's a full replace, not an
   incremental merge).
2. Run:
   ```
   python3 packing_main.py
   ```
3. Commit and push the two updated JSON files:
   ```
   git add website/data/packing_dispatch_data.json processed/packing_dispatch_data.json
   git commit -m "Update packing & dispatch data"
   git push
   ```

Everyone visiting the hosted dashboard sees the new data immediately —
no upload needed on their end. There's also an "Upload Data" button on
the page itself, for previewing a `packing_dispatch_data.json` locally
without publishing it (same pattern as the Projects dashboard).

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
