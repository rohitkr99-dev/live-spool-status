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
