# Changelog

A running, human-readable log of what changed in this repo and why - kept
separate from git history because changes are applied by hand through
GitHub's web UI (no local git/push access), so there's no commit log to
read instead.

---

## For Claude: read this first, every session

If you're Claude, working on this repo in a NEW conversation with no
memory of past sessions, start here:

1. **Read this whole file before touching any code.** It's the only
   record of the project's history and the reasoning behind decisions
   that aren't obvious from the code alone (e.g. why two dashboards
   compute the same thing differently, or why a field is deliberately
   left unused).
2. **At the end of your session** (once you've delivered a working zip),
   append a new dated entry below, under "## Session Log", following the
   exact format already used there: a `### YYYY-MM-DD - <short title>`
   heading, then a few bullet points covering what was asked, what you
   changed (file by file if it's substantial), and why - written for a
   human skimming months later, not a full transcript. Keep entries
   proportional to the change; a one-line fix gets one line.
3. **Include the updated CHANGELOG.md in that session's delivery zip.**
   The person applies it through GitHub's web UI same as every other
   changed file - it doesn't update itself.
4. Never rewrite or delete past entries. If something you documented
   earlier turns out to be wrong or gets reversed, add a new entry
   saying so - don't edit history.
5. This file is for the PROJECT's record. It's a different thing from
   Claude's own cross-session memory (if you have one) - that's for
   your own continuity; this is for anyone (human or Claude) reading
   the repo itself.

---

## Session Log

### 2026-08-16 - Sheet detection is now content-based, not name-based

The Line History Sheet crash-resilience fix from 2026-08-15 stopped the
pipeline from crashing when a workbook's internal sheet got renamed, but
didn't actually fix the underlying problem - the sheet was still being
silently skipped every run since, which (confirmed by inspecting the
live published data directly) was quietly degrading `Welding Finish`
for nearly the entire dataset, since its per-joint Line History data
source was unavailable and it was falling through to a much cruder
fallback rule for almost every spool.

Asked: "why is the process searching for Sheet2 and why not just
consider the data in Line History sheet file? It can be named to any
sheet." Redesigned `ExcelReader._read_excel_sheet_or_none()`
(`src/reader.py`) to stop trusting the configured sheet name as
anything more than a first guess: when a caller passes
`standardize_key` + `required_columns`, every sheet in the workbook is
cheaply scanned (header row only, `nrows=0`) and run through the exact
same `standardize_columns()` / `column_mapping.json` machinery the real
read uses later - so a known raw-header alias is handled automatically,
nothing duplicated. The first sheet whose standardized columns contain
everything required is read in full and used, whatever it's actually
named. Wired into all 4 optional readers (Line History, SIOP Planned
Spools, Rework, Material Handover), each with its own distinctive
required-columns marker. Verified against a synthetic file reproducing
the real failure exactly (two decoy sheets + the real data under a
completely different name) - correctly found and used the right sheet,
and correctly still fails gracefully when truly nothing matches.

The person no longer needs to keep `config/settings.json`'s configured
sheet names in sync with whatever their export tool calls them this
month - only the FILE name pattern still needs to stay recognizable.

### 2026-08-15 - Welding Finish unified across both dashboards; pipeline crash resilience; this file

**Cross-dashboard number mismatch (the main fix this session).** The
person compared the Projects dashboard's Fabrication Line widget against
the Production dashboard's new Backlog charts and found the numbers for
Fit-Up/Welding/PDQC didn't match, sometimes by a lot. Root cause: the two
dashboards had always computed "is Welding done?" two different ways.
Projects used the DPR's own `First Welding` field (needs just the FIRST
joint welded). Production had its own `src/production/welding_finish.py`,
built back on 2026-07-30 specifically because the DPR's real completion
column was blank - it derives a stricter `Welding Finish` requiring
EVERY joint welded, with fallbacks through the Line History Sheet and
Welding DB. These were never reconciled; RFP/Painting/Packing matched
closely because those are single spool-level dates, not joint-level, so
the "first vs. last joint" ambiguity never applied to them.

Instructed: "the rules under Production pages are actual and Projects
numbers should have been updated as per that only." Fix:
- Moved `src/production/welding_finish.py` to shared `src/welding_finish.py`
  - both dashboards now import the identical function.
- `src/merge.py` (Projects' merge engine) gained `apply_welding_finish()`,
  called during `merge()` before the Rework PDQC override, writing a new
  `Welding Finish` column onto the master dataset. Deliberately uses the
  RAW (pre-rework-override) PDQC, matching what Production's own
  pipeline reads, for full consistency.
- `config/stages.json`: the "Welding" stage's `date_field` changed from
  `First Welding` to `Welding Finish`. `First Welding` itself is left
  computed and on the dataset unchanged, in case anything else still
  reads it - nothing for stage-gating does any more.
- `src/constants.py`: added `WELDING_FINISH = "Welding Finish"`.
- Verified against all 6 of `determine_welding_finish()`'s branches with
  synthetic data, re-ran the full 7-case Partial Fit-Up/Welding
  regression suite (unaffected, still passes), and confirmed Stage
  Ageing Summary / Stage Age calculations pick up the stricter field
  correctly downstream.

**Pipeline crash resilience.** A GitHub Actions run of `production_main.py`
crashed entirely (`ValueError: Worksheet named 'Sheet2' not found`) because
that month's Line History Sheet had been re-exported with a renamed
internal sheet, and the file-not-found path was the only failure mode
that had ever been handled gracefully for the 4 "optional" readers
(Line History, SIOP Planned Spools, Rework, Material Handover). Added
`ExcelReader._read_excel_sheet_or_none()` (`src/reader.py`) - wraps the
actual `pd.read_excel()` call, and on any failure logs the sheet names
actually found in the file (a direct diagnostic) and returns `None`
instead of raising, so the affected FILE is skipped rather than crashing
the entire pipeline. Wired into all 4 readers. Verified with a
synthetic wrong-sheet-name file - confirmed no crash, and confirmed the
warning message correctly surfaces the real sheet names.

**Data label / gridline chart fixes** (from screenshots the person sent
of doubled/overlapping label text). Root cause: `chartTheme.js`'s
existing `spoolGradientBars` plugin (bar shadow effect) used the plural
`beforeDatasetsDraw`/`afterDatasetsDraw` hooks for its shadow save/restore,
which only avoided colliding with the newer `chartjs-plugin-datalabels`
plugin by accident of registration order - once datalabels was added,
every label got drawn while the shadow was still active, producing
ghosted double text. Fixed by moving the shadow save/restore to the
SINGULAR `beforeDatasetDraw`/`afterDatasetDraw` hooks (once per dataset,
guaranteed to complete before the plural "after all datasets" phase
where datalabels draws) - not order-dependent any more. Also fixed a
separate, unrelated bug in the same file: the original datalabels setup
used `Chart.defaults.set("bar", {...})` trying to scope labels to bar
charts only - this silently did nothing, since Chart.js v4 keeps
per-chart-type defaults in a completely different object,
`Chart.overrides[type]`, not under `Chart.defaults`. Fixed to merge into
`Chart.overrides.bar.plugins.datalabels` directly. Also removed
remaining Y-axis gridlines from every bar chart across all 4 dashboards
(18 occurrences across 6 JS files) - line/curve charts (S-curve,
Rework Rate Over Time) deliberately left alone, gridlines still help
read a trend line's value at a glance.

**This file created.** See "For Claude" section above for how to keep it
updated.

### 2026-08-16 - Welder Performance section + auto-filled downloadable summaries (Quality dashboard)

Asked for two things: (1) automate the "Weld Reject Rate - Pipe"
summary sheet in his Welder Performance Record workbook from its raw
data sheet, add charts for it, and a download button in the Quality
section; (2) add a download button in the Quality section for the
Production Rework data + its "Compare Rework Status Monthly" /
"Rework Type Monthly" summaries, auto-filled from the SAME Rework
Data workbook the Quality dashboard already reads (no new source for
that one). Both new/changed data sources confirmed as recurring
Drive-synced inputs (latest-file-wins, like the rest of the
pipeline), and both download buttons regenerate live from whatever
data is currently loaded on the page (client-side, via the vendored
SheetJS build) rather than serving a static cached file.

New source - Welder Performance Record workbook (data/upload/
quality/*Welder*Performance*.xlsx, "Welder Performance - Pipe"
sheet): config/settings.json + config/column_mapping.json gain a
`welder_performance` entry; src/reader.py -> read_welder_performance()
(multi-file, transactional concat + exact-dup drop, same contract as
read_rework()); src/utils.py -> normalize_month_name()/MONTH_ORDER
(the raw sheet has no year field, so months are bucketed by bare
calendar name, Jan-Dec order - same limitation his own manual sheet
had). New src/quality/welder_performance.py recomputes his 5 manual
summary blocks (Month Wise NDT Length, Month Wise Joint, Project
Wise, Type of Defect, Welding Process) straight from the raw data -
verified against his real uploaded file, reproduces his manual
numbers exactly (e.g. January: 648 total / 635 accept / 13 reject
joints, defect/process breakdowns all matched). Optional/best-effort:
a missing file just hides the new Welder Performance section.

Rework export - src/quality/summary.py gains build_rework_status_
monthly() (Year-Month, not bare month name - the live workbook spans
multiple years, unlike his one-year manual sheet, so bare "April"
would otherwise conflate every year's April) and build_rework_type_
monthly(), which classifies each Rework row into his 7 template
categories (Punching/Orientation/Dimension/Visual/Damage Material-
Bend/Wrong Material/Incomplete) by keyword-matching the free-text QC
Observation column, per his explicit instruction - flagged to him
that real shop-floor remarks are messy enough that a large share
lands in a catch-all "Other" bucket rather than force a bad match;
the keyword lists (REWORK_TYPE_CATEGORIES) are meant to be tuned
against his real data once he's reviewed it. Verified against his
real uploaded Production_Final_Dimension file's "Projetc Name" sheet
(mapped to the standard Rework Data column names) - reproduces his
manual April total (1,585) exactly.

Both wired into src/quality/pipeline.py's existing bundle (rework_
export + welder_performance keys) - no new pipeline/workflow needed,
quality_main.py already runs on every Drive sync.

Website (website/quality.html, quality-data.js, quality-config.js,
quality-charts.js, quality.css): new "Welder Performance" section (5
charts: month-wise joint reject bar, month-wise NDT-length-reject %
line, project-wise reject % bar, defect-type pie, process-wise
rejected-joints bar) that stays hidden when the source workbook isn't
in the current bundle; a "Download Welder Performance Record" button
next to it and a "Download Production Rework Data" button on the
Overview section header - both client-side exports via the vendored
SheetJS build (website/vendor/xlsx.core.min.js, same one Production's
Backlog export buttons already use), 2 sheets each (raw data + a
multi-block summary sheet recreating the person's manual layout).
Added .btn-export to quality.css (previously only in production.css,
which quality.html doesn't load).

Not yet done / open for him to confirm: the Rework Type keyword
categories above should be reviewed against his real, larger Rework
Data workbook (only tested against a ~1,800-row 1-month sample) -
the "Other" bucket size there will show whether the categories need
adjusting.
