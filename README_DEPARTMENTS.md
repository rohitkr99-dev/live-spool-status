# Department upload folders

Every department has its own subfolder under `data/upload/`:

```
data/upload/
  projects/       <- "Projects" on the landing page: DPR, Weekly Planning, Line History workbooks
  packing/        <- Packing & Dispatch workbooks
  production/     <- reserved for "Production" on the landing page (no pipeline built yet)
  quality/        <- Quality Assurance / Control: Production Rework Data workbook
  painting/       <- reserved for Painting (no pipeline built yet)
```

**Note the "Projects" vs "Production" naming** - these are two
*different* landing-page cards (`website/dashboard.html` vs
`website/production.html`). The DPR / Weekly Production Planning /
Line History pipeline is internally called "Production" in a lot of
code comments and function names (`run_production()`, `src/pipeline.py`,
etc. - that naming predates this folder structure) but its landing
page card is **"Projects"**, so its upload folder is
`data/upload/projects/`. `data/upload/production/` is a separate,
still-unbuilt department. If you're looking for where to put DPR
files, it's `projects/`, not `production/`.

`python3 main.py` looks inside every one of these, runs whichever
department already has a pipeline built, and tells you (without
erroring out) if it finds files sitting in a folder that doesn't have
a pipeline yet:

```
python3 main.py
```

**Quality Assurance / Control** (`data/upload/quality/`) is a special
case worth calling out: its workbook (Production Rework Data) is read
TWICE. `python3 main.py` reads it best-effort as part of the Projects
pipeline, purely to override PDQC for any spool it covers (see
`src/merge.py -> apply_rework_pdqc_override()`) - PDQC becomes the
later of the spool's existing PDQC and the latest "Prod offer" date
in the workbook, never regressing. Separately, `python3 quality_main.py`
reads the same workbook to build the Quality dashboard itself
(`website/quality.html`) - top rework types, rework rate by project,
first-offer acceptance, and trend over time. The two reads are
independent; a problem with one never blocks the other.

`python3 main.py --watch` does the same thing continuously - it
watches the whole `data/upload/` tree and reprocesses automatically
whenever a file changes anywhere under it, in any department's
folder, current or future.

The full list of departments, their upload folder, and whether a
pipeline exists for them yet lives in one place:
**`src/departments.py`**.

## If you're migrating an existing checkout

DPR / Weekly Production Planning / Line History Sheet workbooks used
to live directly in `data/upload/` (no subfolder). They now belong in
**`data/upload/projects/`** - move your existing workbooks into that
folder, or the pipeline won't find them
(`config/settings.json -> paths.upload_folder` now points there
instead of `data/upload/`).

## Why the placeholder README.txt files

Git doesn't track empty folders, and GitHub's browser upload/drag-
and-drop won't create one either - so `data/upload/production/` and
`data/upload/painting/` each have a `README.txt` in them purely so
the empty folder exists and can be uploaded/tracked at all.
`data/upload/quality/` has one too, but it's no longer a placeholder
for an empty folder - it documents what actually belongs there now
that the Quality pipeline is built (see below). Once you drop a real
workbook into `production/` or `painting/`, their placeholders become
irrelevant (the pipeline ignores them either way) - delete them
whenever, or leave them, it doesn't matter.

## Adding a new department

1. Add one `Department(...)` entry to `src/departments.py` - folder
   name, display label, `built=False`.
2. Create `data/upload/<key>/` with a `README.txt` placeholder in it
   (copy the wording from `data/upload/painting/README.txt`) so it can
   be uploaded through GitHub's web UI like the others.
3. Once you're ready to actually build that department's dashboard,
   its pipeline follows the same shape as Packing & Dispatch:
   - `src/<key>/` package: `reader.py` (parse the workbook(s)) ->
     `normalize.py` (column-name aliases + any status normalization)
     -> `summary.py` (every aggregate the dashboard needs) ->
     `pipeline.py` (orchestrates the above, writes the JSON bundle)
   - `config/<key>_settings.json` for its paths/file patterns
   - `<key>_main.py` at the repo root as a standalone entry point
     (optional, but matches `packing_main.py`)
   - a dashboard page in `website/` + its own `website/js/<key>-*.js`
     modules, following `packing-dispatch.html` /
     `website/js/packing-*.js` as the template
   - wire a `run_<key>()` function into `main.py` the same way
     `run_production()` / `run_packing()` are wired, and flip that
     department's `built` flag to `True` in `src/departments.py`

See `src/packing/` end to end as the concrete reference for all of
the above - it's a complete, working example of exactly this shape.
