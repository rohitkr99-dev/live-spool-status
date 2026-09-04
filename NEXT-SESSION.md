# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## Action needed from me (blocking, can't be done from the assistant side)

The Painting dashboard's data has **never** flowed through the automated "Sync from Google Drive" workflow — not a bug introduced this session, a gap that's existed since the Painting dashboard was built. Root cause (full story in `CHANGELOG.md` → "Root cause found" entry, 2026-09-04): the Google Drive sync script (`scripts/sync_drive.py`) only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one, so the Painting Weekly Plan workbook never made it into the repo for the pipeline to read, no matter how many times the workflow ran.

**Fixed the code side already** (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` now both know about a `painting` Drive subfolder and run `painting_main.py`). **Still need to, in Google Drive itself:**
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality` in it.
2. Put the Painting Weekly Plan workbook (filename containing "Painting Weekly Plan", same convention as always) into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run, every 15 min) — it should now actually pull the workbook in and regenerate Painting's data going forward, same as every other department.

Until step 1–2 happen, Painting's data will only ever update via a manual local-run-and-upload bridge, not the automated sync.

## Where things stand otherwise (as of 2026-09-04)

**The 4-part request from this session is fully shipped:**

1. **F11 = P11 thumb rule** (repo-wide data normalization) — `src/utils.py -> normalize_material_grade()`, applied once inside `src/reader.py -> ExcelReader.read_fabrication()`, the single shared method every department's pipeline calls to read the Fabrication (DPR) workbook. Merges F11 into P11 everywhere Material is grouped/filtered/displayed, across all 5 departments, with nothing to keep in sync department-by-department. `production/classify.py`'s own separate AS/Alloy-Steel bucket (F11+P11+P22+P91) is untouched — different mechanism, different purpose.
2. **"Export Excel" button on Painting** — `website/js/painting-excelExport.js`, a 19-sheet workbook (Summary, funnel, bottleneck, histogram, aging, weekly trend, Blasting + 4 individual process output stages, 6 Bay-by-process sheets, project/material insight) built from `PaintingData.store`/`PaintingCharts`'s already-computed state via the vendored SheetJS core build. Verified live and locally: correct headers, correct values, full period range (not the on-screen "last 20" slice).
3. **"Export PDF" button on Production, Quality, Painting** — matching the pattern already on Projects/Packing & Dispatch. New `website/js/{production,quality,painting}-pdfExport.js`.
4. **"Export All Departments PDF" button on Projects** — `website/js/combinedPdfExport.js`. Loads Production/Quality/Painting/Packing & Dispatch one at a time in a hidden iframe, waits for each page's own `is-ready` signal, harvests its chart canvases, assembles one combined jsPDF document (Projects' own charts read straight from the live DOM, no iframe needed). Verified live: all 5 departments come back with real chart content, 39-page combined PDF, no console errors. Two real bugs were found and fixed during verification (stale `iframe.contentDocument` snapshot from an `about:blank` `onload` firing; `requestAnimationFrame` unreliable for an off-screen iframe) — see the CHANGELOG entry for both, worth remembering if this pattern (hidden-iframe cross-page harvesting) is ever reused elsewhere on this site.

All 3 code changes for parts 2–4 were verified in-browser (local scratch preview, monkey-patched `XLSX.writeFile`/`jsPDF.save` to capture output instead of downloading it) before publishing, and Painting's Export PDF/Excel buttons were additionally spot-checked live on the real GitHub Pages site. Production/Quality's per-page Export PDF buttons were verified only by code/object-shape inspection, not independently browser-tested in isolation (though they ARE now exercised indirectly, successfully, as part of the combined-PDF verification above).

Earlier in the same session (all shipped, unrelated to the 4-part request):
- **Production backlog fix** (2026-09-03, corrected same day): "Release for Painting"/PDQC backlog charts no longer wrongly count Rework spools as backlog, except PDQC's own chart (correctly still shows them).
- **Painting "Output by Bay" chart** + **Internal vs External Blasting butterfly chart** (2026-09-04): live and working, DEE brand colors (blue `#4333A5` left / red `#A82E30` right), data labels + combined totals.
- **Fiscal-week sort-order fix**: every "by week" chart on the Painting page now sorts correctly across a fiscal-year boundary (a bare "Week NN" label was sorting alphabetically, putting the prior cycle's Week 50–52 after the current cycle's Week 1–23 instead of before it).

## Known open item

The user said (2026-09-03) "I have some more things to add in Painting" before pivoting to the Production investigation, then the 4-part request above came instead — the original "more things" were never specified. Ask what those are if picking Painting back up.

## Housekeeping note (not urgent)

Local git push doesn't work in this environment (no stored credentials) — all publishing this session was done via GitHub's web "Upload files" UI. The local git branch has also drifted from `origin/main`'s real history (confirmed to be encoding/line-ending noise, not real content differences, the one time it was checked). Don't try to reconcile it unless a task specifically needs local git history — work directly against files and publish via web-upload as this session did. Local `.github/workflows/` and `scripts/` directories didn't exist at all before this session (same drift) — they were pulled fresh from GitHub's raw content this session to make the sync fix.
