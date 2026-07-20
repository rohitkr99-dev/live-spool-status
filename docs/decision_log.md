# Decision Log

This file records decisions and fixes made during development that are not
obvious from the Master Specification alone. Read this before modifying
`stages.json`, `business_rules.json`, or `business_rules.py`.

---

## 1. Config file bugs fixed

- **`config/settings.json`** was invalid JSON (missing commas after
  `"file_pattern"` in both `input_files.fabrication` and
  `input_files.planning`). Fixed.
- **`config/schema.json`** was invalid JSON (contained stray ``` ``` ```
  markdown code-fence characters pasted into the `planning` block). Fixed —
  no fields were changed, only the invalid fence characters were removed.

---

## 2. Fit-Up and Welding are two separate required stages

The Master Specification's Age Flow diagram shows a single step
"First Fit-Up OR First Welding", which could be read as one combined
milestone. **Confirmed with the project owner: they are two separate,
sequential, required stages.** A spool is not considered past this point
in the workflow until **both** `First Fit-Up` and `First Welding` have a
date. `stages.json` lists them as sequence 1 and 2 accordingly.

Note: this is separate from **First Activity Date**, which is still the
*earliest* of the two dates (used only for the Unplanned ageing start
point, per `business_rules.json -> unplanned_spool.first_activity_fields`).
Both rules co-exist without conflict:

- **First Activity Date** = `min(First Fit-Up, First Welding)` — used for
  ageing.
- **Current Stage** = stays at "Fit-Up" until it has a date, then "Welding"
  until *it* has a date — used for stage tracking.

---

## 3. "Planning" is not a Current Stage

Originally `stages.json` included a "Planning" stage (date field
`Planned Start`) as the first milestone in the sequence. **Confirmed with
the project owner: removed.** `Planned Start` is only used for:

- The `Planned` flag (`Planned = True` if `Planned Start` has a value).
- The Total Age calculation for planned spools (Ageing Engine, not yet
  built).

It is **not** part of the Current Stage milestone sequence. The sequence
now starts at Fit-Up.

When a spool hasn't started production yet (neither Fit-Up nor Welding
done), Current Stage = `"Fit-Up"` and the Status Message shown is
**"Fabrication Yet to Start"** (not "Waiting for Fit-Up") — see
`business_rules.json -> status_messages`.

---

## 4. Business Rule Engine input contract

`src/business_rules.py` expects a dataframe that already has one row per
spool with fabrication + planning fields combined (Project Code, Drawing
No, Spool No, Planned Start, First Fit-Up, First Welding, PDQC, RFP, PDI,
Packing). **It does not merge data itself** — that is the Merge Engine's
job, which has not been built yet. The Merge Engine should run before the
Business Rule Engine's `apply()` is called, and must guarantee those
columns exist (even if blank) on every row.

---

## 5. Known pre-existing issue (not fixed in this session)

`tests/test_cleaner.py` and `tests/test_validator.py` contain fixtures
using column names like `"Project"` / `"Job No"` instead of the actual
schema names `"Project Code"` / `"Drawing No"`. 5 tests currently fail
as a result (`test_standardize_dates`, `test_remove_duplicate_records`,
`test_duplicate_spools`, `test_missing_values`, `test_invalid_dates`).
This predates the Business Rule Engine work and was out of scope for this
session — flagging for the next session to fix the fixtures.

---

## 6. Merge Engine + real-data field mapping (session 2)

Built `src/merge.py` after inspecting the real uploaded workbooks. Key
findings, all confirmed empirically or with the project owner:

**Sheet-name vs. field-name translation.** `Fit-Up DB` / `Welding DB` use
different column names than the DPR and Master Planning sheets for the
same composite key:

| Canonical field | DPR / Master Planning | Fit-Up DB / Welding DB |
|---|---|---|
| Project Code | `Project Code` | `Job Order No.` |
| Drawing No | `Drawing No.` | `Document No.` |
| Spool No | `Spool No` | `Item No.` |

**First Fit-Up / First Welding are derived, not read directly.** The DPR
Detailed Sheet's own `4. Fit-Up` / `5. Welding` columns are 100% blank
(0 of 8,236 rows) in the real data. `MergeEngine` derives them instead by
grouping `Fit-Up DB` / `Welding DB` (one row per joint) by Composite Key
and taking the earliest `Activity Date` per spool.

**DPR stage-column mapping** (confirmed with project owner):

| Canonical stage | Real DPR column |
|---|---|
| PDQC | `6. PDQC` |
| RFP | `11. Ready for Painting Date` |
| PDI | `8. Painting` |
| Packing | `9. Packing` |
| Dispatch | `10. Dispatch` (newly added as a tracked stage) |

`7. FQC` is intentionally not tracked (not in the stage model).

**Dispatch is tracked but does not gate Completed.** Per the Master
Spec, Completed = Packing done. Dispatch was added as stage 7 (after
Packing) for visibility, but `business_rules.py`'s
`determine_completed_flag` checks the configured `completion_field`
("Packing") directly, independent of the Current Stage walk. A spool can
show `Completed=True` and `Current Stage="Dispatch"` at the same time —
this is intentional, not a bug.

**Material** comes from `Item Category Code` in the DPR sheet (values:
CS, P22, P11, SS, P91, F11, DUPLEX — these are material grades). There is
no column literally named "Material" in the real DPR sheet.

**Group** comes from `Alloted Group` in the Master Planning Sheet. Two
other group-like columns (`Group`, `Current Group`) exist in that sheet
but are 100% blank in the real data — unused.

**Planned Start / Week** come from the Master Planning Sheet's
`Start Date` / `Week Planned` columns.

**Header row bug**: the Master Planning Sheet's real header row is row 2
(index 1), not row 1 (index 0) — row 1 is a stray totals row. Configured
via `settings.json -> input_files.planning.master_sheet_header_row`.

**Column name collisions**: both the DPR sheet and the Master Planning
Sheet contain their own always-blank `Group` column (unrelated to
`Alloted Group`). These are renamed to `Group (Raw - Unused)` in
`column_mapping.json` so they don't collide with the real `Group` field
during the merge (pandas would otherwise silently produce `Group_x` /
`Group_y` columns).

**Excel serial dates**: `.xlsb` files read through `pyxlsb` return raw
numeric serial values for date cells (e.g. `45947.0`), not parsed dates.
`utils.convert_excel_serial_dates()` and the numeric branch added to
`utils.parse_date()` convert these correctly using Excel's date system
(`unit="D", origin="1899-12-30"`). This is applied in `reader.py`
immediately after column standardization, for every known date column
(driven by `stages.json` + `business_rules.json`, not hardcoded).

**Merge join type**: the DPR Detailed Sheet (fabrication) is treated as
the master list of spools (per Master Spec: "master production
database"). `MergeEngine.merge()` left-joins planning data onto it.
Planning-only spools not yet in the DPR sheet are currently excluded from
the Master Spool Dataset — flag if this needs to change.

---

## 7. Ageing Engine (session 2)

Built `src/ageing.py`, run after Business Rule Engine's `apply()`.

**Total Age**: `Planned Start` (if Planned) or `First Activity Date` (if
Unplanned), subtracted from today. Missing anchor or negative result → 0.

**Stage Age**: today minus the date the spool entered its *current*
stage, i.e. the previous stage's date field in sequence (e.g. if Current
Stage = PDQC, Stage Age counts from the Welding date). For the very
first stage (Fit-Up), the anchor is Planned Start; unplanned spools that
haven't started yet have no anchor, so Stage Age = 0.

**Completed spools always show Stage Age = 0** — including when Current
Stage is still "Dispatch" (Packing done, Dispatch pending). This follows
the Master Spec's literal rule ("Completed → Stage Age = 0") and is
consistent with the Completed/Dispatch decoupling from §6. One
consequence: how long a spool has been waiting on Dispatch specifically
isn't currently tracked as its own number — only Total Age (from Planned
Start / First Activity) keeps growing. If dispatch-wait time turns out to
matter for KPIs, a separate "Dispatch Age" field can be added later
without changing this module's core logic.

Verified against the real DPR + Weekly Planning workbooks (8,236 spools):
no negative ages, all Completed rows have Stage Age = 0, Total Age median
37 days / max 344 days, Stage Age median 0 / max 118 days.

---

## 8. Summary Engine (session 2)

Built `src/summary.py`, run after Ageing Engine's `apply()`. Produces
7 of the 8 JSON files from §16 of the Master Spec: `master_spools.json`,
`dashboard_summary.json`, `project_summary.json`, `weekly_summary.json`,
`fitup_summary.json`, `welding_summary.json`, `exceptions.json`.

**`validation_report.json` is intentionally NOT produced by this
module.** It's the Validator's own output, not a Summary Engine
aggregation — should be written directly by whatever pipeline
orchestrator script eventually calls Reader → Validator → Merge →
Business Rules → Ageing → Summary in sequence (that orchestrator script
doesn't exist yet either — flagging for next session).

**Two fields with no definition anywhere in the Master Spec** — I
defined them and flagged for confirmation, did not block on them:

- **`Delay`** (listed as a Master Spool Dataset field, never defined) =
  `First Activity Date − Planned Start`, in days. Only computed for
  Planned spools that have started. `None` otherwise. Positive = started
  late, negative = started early.
- **`Planning Variance`** (dashboard KPI, never defined) = average
  `Delay` across all planned + started spools. Real data: -1.7 days
  (started slightly early on average).

**`Last Activity`** (also listed as a field, not a business rule) = the
most recent date among all filled stage date fields — "the last thing
that actually happened" to a spool. This is a plain reporting
aggregate, not new stage-sequence logic.

**`exceptions.json` design**: flags spools where a *later* stage has a
date filled in while an *earlier* one (the current, first-incomplete
stage) is still blank — the out-of-order data-quality scenario first
identified during Business Rule Engine testing. Real data: **307 of
8,236 spools (3.7%)** have this inconsistency — worth a look, this
wasn't synthetic. Not currently flagged: negative raw ages before
flooring to 0 (e.g. Planned Start recorded in the future), duplicate
composite keys (already handled by the Cleaner), or partial-fill
weirdness in Fit-Up/Welding order. Good candidates for a future
`exceptions.json` v2 if useful.

**`fitup_summary.json` / `welding_summary.json` design**: per-week
completion progress (spools with First Fit-Up / First Welding done vs.
pending, grouped by Week), computed from the merged master dataset —
not from the raw Fit-Up DB / Welding DB joint-level transactions (those
aren't in this module's input). If joint-level throughput (e.g. "joints
welded per week") is wanted, that needs a different input (the raw DBs
themselves) and would be a reasonable v2 addition.

**Bug found + fixed during real-data testing**: `current_stage_breakdown`
in `project_summary.json` / `weekly_summary.json` came back as an empty
`{}` for any group where every spool was `Completed`, because
"Completed" is a terminal label, not one of the entries in
`stages.json`'s stage list. Fixed by including it in the breakdown's
name set, same pattern already used in `dashboard_summary.json`.
Regression test added.

Verified against the real DPR + Weekly Planning workbooks (8,236 spools):
all 7 JSON files valid, `master_spools.json` round-trips through
`json.dumps` cleanly (Timestamps/NaT/numpy types all converted via
`utils.to_json_safe`), KPI numbers match the business-rules/ageing
session-2 sanity check exactly.

---

## 9. Validation, Cleaning wired in + Pipeline orchestrator (session 2)

Built `src/pipeline.py` (orchestrator class) and `main.py` (CLI entry
point: `python3 main.py`). Full sequence, matching the Master Spec's
architecture with Cleaning slotted in between Validation and Merge
(per Validator's own docstring - "Validates input data before any
cleaning or transformation" - raw data is validated first, then
cleaned, then merged):

    Reader -> Validator -> Cleaner -> Merge -> Business Rules ->
    Ageing -> Summary -> processed/*.json (8 files, including
    validation_report.json)

**Real bug found and fixed: `validator.py` and `cleaner.py` didn't
know about 3 of the 4 real dataframes.** Both only ever branched on
`"fabrication"` vs a single generic `"planning"`, so calling either on
the Master Planning Sheet, Fit-Up DB, or Welding DB used the wrong
required-columns list (Fit-Up DB doesn't have Week/Group/Planned
Start - it has Activity Date). Fixed by extending both modules to
recognise 4 dataset identifiers: `fabrication`, `planning_master`,
`planning_fitup`, `planning_welding`, each mapped to its own
`required_columns` list in `schema.json`.

**Real bug found and fixed: duplicate-spool removal would have
silently destroyed the Fit-Up DB / Welding DB.** Both sheets
legitimately have one row per joint - the same spool's composite key
repeating 3+ times is correct data, not a duplicate. `remove_duplicate_records`
(Cleaner) and `check_duplicate_spools` (Validator) both unconditionally
treated repeated composite keys as duplicates before this session. Added
an `is_transactional` flag (Cleaner) / dataset-config lookup (Validator)
that skips this check for `planning_fitup` / `planning_welding`. Covered
by a regression test that runs a 3-joint fit-up spool through the full
pipeline and confirms all 3 survive and First Fit-Up is still the
earliest of the 3 dates.

**Fixed the 5 pre-existing test failures flagged in session 1**
(stale `"Project"`/`"Job No"` fixtures in `test_cleaner.py` /
`test_validator.py` that didn't match the real schema). All 61 tests
across the whole suite now pass - zero known failures.

**Pipeline stops on validation errors, not warnings.** If any dataset
fails validation (e.g. a required column is missing), `Pipeline.run()`
raises `PipelineError` before Cleaner/Merge run - but
`validation_report.json` is written first regardless, so the failure
reason is always on disk even when the run fails.

Verified against the real DPR + Weekly Planning workbooks via
`python3 main.py`: **8,233 spools** in the final output (8,236 minus
the 3 genuine duplicate pairs the Cleaner now correctly removes - this
was previously untested since Cleaner had never been wired into an
actual run). `validation_report.json` correctly shows 0 errors and the
expected in-progress-stage blank-value warnings.

---

## 10. Dashboard (session 3)

Built `website/` — static HTML/CSS/vanilla JS per Master Spec §4's tech
stack (Chart.js + DataTables), reading only `processed/*.json`. No
calculations happen in the browser: KPIs, chart data, and table values
are all pre-computed in Python and just displayed/filtered/sorted here.

**Two backend additions made before starting the frontend**, both
confirmed against real data rather than guessed:
- **`Remarks` field**: your DPR sheet has a `Remark` column (79 rows of
  real content: "BOX SIZE EXCEED", etc.) which wasn't previously mapped
  into `master_spools.json`, despite your spec explicitly listing
  Remarks as searchable (§18). Mapped `Remark` → canonical `Remarks`,
  and (same collision pattern as `Group` in session 2) renamed the
  separate always-empty raw `Remarks` column to avoid a clash.
- **`group_summary.json`**: your spec's dashboard design (§17) calls for
  a "Department Progress" chart, but there's no `Department` field
  anywhere in the data. The closest real equivalent is `Group` (Alloted
  Group) — added this output using the same generic `_group_summary()`
  helper already built for project/weekly. Flagging in case "Department"
  meant something more specific (e.g. `Job Leader`, also present in the
  Master Planning Sheet).

**Deployment fix — important**: `.gitignore` had `processed/` excluded
entirely. Since the dashboard fetches those JSON files directly at
runtime, committing the repo as-is would have published a dashboard
with nothing to load (every fetch 404s) once pushed to GitHub Pages.
Removed that line — `processed/*.json` must be committed for the site
to work. Also added `data/upload/*.xlsb` to `.gitignore` instead
(large, frequently-changing source files shouldn't bloat the repo;
`.gitkeep` keeps the folder itself tracked).

**Libraries are vendored locally**, not loaded from CDN
(`website/vendor/`: jQuery, DataTables + Buttons, JSZip, Chart.js —
~590KB total). More reliable for a shop-floor tool than depending on
external CDN uptime, and means the dashboard works even if the
deployment network is locked down. Google Fonts (Space Grotesk, Inter,
IBM Plex Mono) are still loaded from `fonts.googleapis.com` with a full
system-font fallback stack if that's blocked.

**Signature visual — the "Fabrication Line"**: a literal shop-floor
pipeline strip, one block per stage in sequence, block width
proportional to spool count, so the widest block is visibly where work
is piling up. The busiest non-Completed stage gets an explicit
"Bottleneck" badge, not just a color hint (initial version used only a
subtle background-color difference, tested as too easy to miss — fixed
after browser-testing this in Playwright and eyeballing the actual
render).

**Real bug caught and fixed via automated browser testing before
delivery**: the status-pill and Yes/No cells (Current Stage, Planned,
Completed) render as HTML for display, but DataTables filters against
whatever the column's render function returns for the *filter* type -
not necessarily the same string. The dropdown filters (anchored regex
match, e.g. `^Completed$`) were initially matching against the raw
`<span class="status-pill">Completed</span>` HTML and silently
returning zero rows. Fixed with a `typeAware()` render wrapper: pretty
HTML for `display`, plain text for `filter`/`sort`/`type`. Would not
have been caught without actually running the filters in a real
browser and checking the row counts, not just checking that the page
loaded.

**Verified via Playwright (headless Chromium), not just "should work"**:
- Zero console/page errors across desktop (1600px) and mobile (390px)
  viewports
- All three tables (All Spools, Oldest Spools, Exceptions) render with
  correct row counts against the real 8,233-spool dataset
- Every filter (Project, Week, Group, Material, Current Stage, Planning,
  Status) and the global search box produce internally-consistent
  numbers cross-checked against the KPI cards (e.g. Stage=Dispatch
  filter → 1,438 rows, exactly matching the Fabrication Line's Dispatch
  count)
- Clear Filters correctly resets to the full 8,233
- Export to Excel produces a real, valid `.xlsx` (opened and verified
  with openpyxl - correct headers, all rows present)
- All three charts (Project/Weekly/Department Progress) render with the
  correct underlying numbers (verified via both direct chart-instance
  inspection and canvas screenshots)

**Not built**: authentication/roles (§24 Future Roadmap - explicitly
future work), server-side folder watching for true auto-refresh (the
dashboard re-fetches JSON every 5 minutes client-side, which reflects a
fresh `python3 main.py` run automatically, but doesn't trigger that run
itself - see main.py's docstring for the manual command; a real
"watches data/upload/" auto-refresh needs a long-running process, e.g.
`watchdog`, which is a different deployment shape than a static GitHub
Pages site).

---

## 11. Business rule change request (session 4)

Eight change requests came in from the project owner in one batch.
**Three of them introduce field names that have not yet been verified
against a real workbook** (unlike every field in sections 6/9/10 above,
which was confirmed against the actual 8,236-row DPR/Weekly Planning
files before being wired in). Flagging clearly so the next session with
access to a real file checks these before trusting the new charts/rule:

- **`Prod Order Release`** (rule 1). Assumed DPR column header
  `"1. Prod Order Release"`, following the same `"N. Name"` numbering
  pattern as `6. PDQC` / `8. Painting` / `9. Packing` / `10. Dispatch`
  (all confirmed in session 2). **Not yet confirmed** - if the real
  header differs, update the `"fabrication"` block in
  `config/column_mapping.json` (two entries already added defensively:
  the numbered form and the bare `"Prod Order Release"` form).
- **`Inch Dia`** (rule 5). Assumed present as-is on `Fit-Up DB` /
  `Welding DB` (the same sheets `Activity Date` already comes from,
  confirmed in session 2). **Not yet confirmed.**
- **`Surface Area Out`** (rule 5). Assumed present on the DPR Detailed
  Sheet, aggregated by the existing `PDI` (`8. Painting`) date since
  there is no separate "Painting DB" sheet in the source data.
  **Not yet confirmed** - if Surface Area Out actually lives on a
  different sheet/date, `src/activity_metrics.py`'s `generate()` call
  in `pipeline.py` needs to point at that dataframe/date field instead.

Changes made, one per request:

1. **Production Order Not Released.** New rule, evaluated before
   everything else in `business_rules.py -> evaluate_row()`: if
   `Prod Order Release` is blank, Current Stage / Status Message both
   report `"Production Order Not Released"` and no other rule runs for
   that row. Configurable via `business_rules.json ->
   prod_order_release`.

2. **Latest stage precedes the previous one.** Replaced the "first
   incomplete stage in configured order" walk with a look-ahead: a
   stage counts as "reached" if its own date is filled **or any later
   stage's date is already filled** (`is_stage_reached()`). A spool
   with a Dispatch date but a blank Packing date now correctly shows
   as fully reached (Completed / "Spool Dispatched") instead of
   "waiting for Packing". This subsumes the old out-of-order test case
   - rewritten in `tests/test_business_rules.py` rather than removed.
   The existing `exceptions.json` out-of-order data-quality report
   (`summary.py`) is intentionally untouched - it still flags these
   gaps for cleanup, it just no longer drives Current Stage.

3. **PDI renamed to "Under Painting".** `stages.json ->
   display_name` and the matching `website/js/config.js` stage
   order/colour maps updated. The internal stage key (`"PDI"`) and
   DPR date field (`8. Painting`) are unchanged - display-only rename.

4. **Planning Variance is not a bug.** It's
   `average(First Activity Date - Planned Start)` across planned spools
   that have started (`summary.py -> _calculate_planning_variance`,
   pre-existing). Negative means spools are, on average, starting
   *before* their planned start date (ahead of schedule) - that's why
   it renders green, not red. Added a tooltip + clearer sub-label on
   the dashboard KPI card rather than changing the metric itself.

5/6. **New activity charts (Fit-Up DB / Welding DB Inch Dia, Painting
   Surface Area Out), dynamic Day/Week/Month filter.** New module
   `src/activity_metrics.py` (`ActivityMetricsEngine`), wired into
   `pipeline.py` right after Summary Engine, writes day-level rollups
   to `processed/activity_metrics.json`. Every day is tagged with its
   fiscal week (see below) and calendar month at generation time, so
   the frontend (`website/js/charts.js -> aggregateActivity()`) only
   re-sums already-final daily numbers when the user switches Day/
   Week/Month - it doesn't derive anything new, consistent with the
   "no calculation in the browser" rule from session 3.
   **Custom fiscal week calendar**: `utils.fiscal_week_info()` - Week 1
   is always 30 March - 5 April, 7-day blocks through Week 52,
   re-anchoring off the nearest 30 March on/before the date. Verified
   against the request's own example (`2026-03-30` -> Week 1) and the
   day-before/day-after boundary (`2026-04-05` -> Week 1,
   `2026-04-06` -> Week 2).

7. **Project Progress / Weekly Progress charts now stack by stage**,
   not just Completed/In-progress. Both already had a
   `current_stage_breakdown` field per record in `project_summary.json`
   / `weekly_summary.json` (built for the Fabrication Line, session 3)
   - reused directly rather than adding a new backend field.
   `website/js/charts.js -> stageDatasets()` builds one dataset per
   stage present in the data, coloured via the same
   `SPOOL_STATUS_CONFIG.stageColor` map the Fabrication Line uses
   (given each stage its own distinct colour instead of the old
   shared "grey progress / blue late-stage" scheme).

8. **Packed spools freeze Total Age at Packed Date - Start Date**
   (`ageing.py -> determine_total_age`), instead of continuing to
   count up against Today once a spool is packed. **Status Message
   "Spool Dispatched" when Current Stage is "Completed"** - simpler
   than it sounds: this is just the `status_messages.Completed` config
   value in `business_rules.json`, changed from
   `"Fabrication Completed"` to `"Spool Dispatched"`; no code change
   needed since Current Stage already reaches `"Completed"` exactly
   when every configured stage (including Dispatch) is reached.

All 67 existing tests pass after updating fixtures/expectations for the
above (7 tests touched the old "first incomplete stage" and
"Fabrication Completed" assumptions directly); 4 new tests added for
Prod Order Release and the packed-spool Total Age rule.
