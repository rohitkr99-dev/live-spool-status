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

### 2026-09-04 - New thumb rule (F11=P11) + Export PDF on Production/Quality/Painting

Asked, alongside a bigger multi-part request (Excel export and a
combined-PDF button - both still in progress, see the entries above
this one once they land): "Make a thumb rule for this repo. Consider
F11=P11 wherever it shows... in the projects tab there is a export
PDF button at the top, I want that button for each page as well."
Confirmed via `AskUserQuestion` before building: merge repo-wide,
display as "P11"; and the per-page buttons should cover all 5
department pages (Packing & Dispatch already had its own, from an
earlier session - see `website/js/packing-pdfExport.js`).

**F11 = P11 thumb rule.** F11 and P11 are the same alloy steel grade
(1.25Cr-0.5Mo) - the DPR's "Item Category Code" column (which every
department's "Material" field ultimately comes from -
`column_mapping.json`'s `"Item Category Code": "Material"` rename,
see `docs/decision_log.md`) just spells it differently depending on
product form (Forging vs Pipe).
- `src/utils.py`: new `normalize_material_grade()` - maps "F11"
  (case-insensitive) to "P11", passes everything else through
  unchanged (including P22/P91, which stay distinct - this is NOT the
  same thing as `production/classify.py`'s own AS/Alloy-Steel bucket,
  which already groups F11+P11+P22+P91 together for a different
  purpose, its own SB/AS/CS-SS 3-way split; that bucket is unaffected).
- `src/reader.py` -> `ExcelReader.read_fabrication()`: applies it to
  the `Material` column once, right before returning the DataFrame.
  This is the single shared method every department's own reader
  calls to read the Fabrication (DPR) workbook (`src/pipeline.py` for
  Projects, `production/reader.py`, `quality/reader.py`,
  `painting/reader.py`, `packing/pipeline.py`) - so the merge applies
  everywhere "Material" is grouped, filtered, or displayed
  (Painting's Material Insight chart and its spool-table Material
  filter, included) with nothing to keep in sync department by
  department.
- `tests/test_material_grade_normalization.py` (new, 9 cases).

**Export PDF on Production, Quality, Painting.** New
`website/js/{production,quality,painting}-pdfExport.js`, each adapted
from the Projects dashboard's own `website/js/pdfExport.js` (same
technique: every chart is already a live Chart.js `<canvas>`, exports
its own current pixels via `toDataURL()` - no html2canvas / page-
screenshot needed) - swapped in each page's own `{Dept}Data`/
`{Dept}App` globals, cover title, and output filename; dropped the
Projects-only "Stage Ageing Summary" project-note special case, which
doesn't apply anywhere else. Added the matching "Export PDF" button
to each page's header (same markup as Projects/Packing) and the
`vendor/jspdf.umd.min.js` script tag each page was missing. Verified
directly in the browser (not just re-read the code): patched
`jsPDF.save()` to intercept rather than trigger a real download,
called `PaintingPdfExport.export()`, confirmed it completed with no
errors and would have saved `painting-charts-2026-09-04.pdf`, and
separately confirmed `collectSections()` picked up all 5 chart
sections / 13 charts on the page. Production and Quality weren't
independently browser-tested (identical code path, `ProductionApp`/
`ProductionData` and `QualityApp`/`QualityData` confirmed to exist
with the same shape by direct inspection first) - worth a quick check
if either misbehaves.

### 2026-09-04 - Every "by week" chart: fixed sort order across a fiscal-year boundary

Asked (after the person traced through the Week 50/51/52 example
themselves): "Yes, please fix the sort order, please see this should
be fixed for every chart of that page."

The earlier same-day fix (`_fiscal_week_key()` -> bare `"Week NN"`)
correctly matched DEE's fiscal calendar, but a plain string sort
still can't tell that Week 52 of last cycle needs to land BEFORE
Week 1 of this one - "Week 52" > "Week 01" alphabetically, same as
it would `> "Week 23"`, `> "Week 01"`, etc. Confirmed against real
data (147/127/162 spools RFP'd 9-26 March 2026, `TJ/25-26/...`
project codes) landing in Week 50/51/52 and sorting after Week 21
instead of before Week 1, where they belong.

Fix, in `src/painting/summary.py` - split the one function into two,
and added a third to bridge them:
- `_fiscal_week_key()` renamed `_fiscal_week_sort_key()` - now returns
  that week's own fiscal Monday as an ISO date string (e.g.
  `"2026-03-30"` for Week 1), not a label. An ISO date sorts correctly
  across any number of fiscal-year boundaries, the same way the
  existing daily/monthly keys already do - this is what every
  "weekly" bucket now actually groups AND sorts on internally.
- `_fiscal_week_label()` (new) - the human `"Week N"` text, now
  **not** zero-padded (was `"Week 01"`, now `"Week 1"`) - sorting no
  longer depends on this string's own characters, so there's no
  reason left to pad it; it also now matches the rest of the site's
  own "Week N" convention exactly, a small side benefit of the fix.
- `_relabel_weekly()` (new) - swaps the sort key for the display label
  in a `"period"`/`"week"` field, called as the LAST step before each
  of the four producers (`build_weekly_trend()`,
  `build_stage_output_trend()`, `build_blasting_output_trend()`,
  `build_bay_output_trend()`) hands its weekly list back - critically,
  `build_blasting_output_trend()` relabels only AFTER
  `_merge_period_rows()` has already merged and sorted both sides on
  their raw sort keys; relabeling any earlier would have thrown away
  the very ordering the fix depends on.
- No frontend changes needed - the "period"/"week" field the JSON
  bundle sends was always just echoed directly onto the chart's axis;
  fixing the VALUE and ORDER on the Python side was sufficient.
- `tests/test_painting_fiscal_week.py` rewritten (13 cases, up from 7) -
  the four new ones reproduce the exact reported scenario (a
  prior-cycle Week 50/52 record alongside a current-cycle Week 1/23
  one) for `build_weekly_trend()`, `build_stage_output_trend()`,
  `build_blasting_output_trend()`, and `build_bay_output_trend()` each,
  asserting the prior-cycle week comes first in every one.
- Verified against the real data before publishing: `weekly_trend`
  now reads `['Week 50', 'Week 51', 'Week 52', 'Week 1', 'Week 2', ...
  'Week 21']`; both `blasting_output_trend` and `bay_output_trend`'s
  weekly lists read `['Week 52', 'Week 1', 'Week 2', ... 'Week 23']` -
  confirmed correct on all three independently-computed chart
  families, not just the one the person happened to point at.
- Side effect worth knowing: the Blasting/Bay charts' own "last 20
  periods" default range picker was ALSO silently wrong before this
  fix, for the same underlying reason - with Week 52 misplaced at the
  END of a 24-week array, "last 20" would have kept that stale
  straggler while dropping a legitimately recent week to make room.
  Fixed for free by the same change, no separate code needed.

### 2026-09-04 - Output by Bay: data labels + a combined-total badge

Asked: "In Output by Bay chart, can you add data labels to each bar
and a combined total at the top?"

- `website/js/painting-charts.js` -> `renderBayOutputTrend()`: per-bar
  labels just needed the pre-existing `datalabels: { display: false }`
  removed (same one-line fix as every other chart on this page that
  got labels earlier today) - a formatter that hides the zero case was
  added alongside it for consistency with the rest of the page's
  convention, since the global bar-chart default alone would print a
  bare "0" instead of leaving it blank.
- Combined total: unlike the Blasting butterfly chart, these bars are
  GROUPED side by side per period (not stacked), so there's no single
  "top of stack" pixel to hang a total label off. New `groupTotalPlugin`
  finds the tallest bar in each period's group and draws the total
  just above it - same dark-pill visual language as the Blasting
  chart's own sum badge (`PAINTING_CONFIG.blastingColors.sumLabelBg`),
  so "combined total" reads the same way everywhere it appears on this
  page.
  - Caught the exact same bug as the Blasting chart while verifying
    live in the browser: the first offset chosen (14px above the
    tallest bar) collided with THAT bar's own per-bar label - visually
    identical symptom, a number peeking out from behind the pill.
    Fixed by pushing the pill further out (28px) and increasing the
    chart's own top layout padding (26px -> 42px) so the tallest
    pill still has room and isn't clipped by the canvas edge. Verified
    the fix directly (zoomed screenshot, both numbers fully legible,
    no overlap) before publishing, not just re-read the code.

### 2026-09-04 - Painting's "by week" charts were using calendar ISO weeks, not DEE's fiscal week

Asked: "I think the week number showing here are wrong. You remember
Week 1 started from 30th March till 5th April and then onwards?"
Correct - `utils.py` already has DEE's own fiscal week calendar
(`fiscal_week_info()`, Week 1 anchored to 1st April, given by the
person 2026-08-27) and it's what the rest of the site already uses
(e.g. dashboard.html's Weekly Progress chart, via the master dataset's
own "Week" column) - but the Painting pipeline's own weekly grouping
(`src/painting/summary.py` -> the old `_iso_week_key()`) used Python's
`isocalendar()` instead, a completely different calendar-ISO-8601
week numbering nobody asked for. This affected every "by week" chart
on the page, not just today's new ones: Process Output Over Time (all
6 processes, plus today's Blasting/Bay charts), and the original
"Median Cycle Time by RFP Week" trend chart from the very first build.

Fixed: renamed to `_fiscal_week_key()`, now calls the shared
`utils.fiscal_week_info()` and returns `"Week {week_number:02d}"`
(zero-padded so the plain-string `sorted()` every call site already
uses keeps working unchanged - no other line needed to change).
Verified against the person's own two dates directly:
`fiscal_week_info(date(2026,3,30))` and `(2026,4,5)` both -> Week 1;
`(2026,3,29)` -> Week 52 (previous cycle); `(2026,4,6)` -> Week 2.
`tests/test_painting_fiscal_week.py` (new, 7 cases) locks this in,
including one asserting March 30 2026 is ISO week 14 but fiscal
Week 1, so a future regression back to `isocalendar()` fails loudly.

**Known limitation, not fixed (matches an existing site-wide gap, not
a new one):** a handful of real spools (5, out of 5,348 - all dated
2026-03-27, 3 days before this fiscal year's Week 1 starts) fall in
"Week 52" of the PRIOR cycle. Since the week key carries no
fiscal-year prefix, plain-string sort puts "Week 52" after "Week 23"
(the current week) instead of before "Week 01" where it chronologically
belongs. Confirmed this isn't a new problem: `website/js/charts.js`'s
own Weekly Progress chart (`renderWeeklyChart()`) sorts purely by
week NUMBER (`parseInt` then numeric sort) with no fiscal-year
disambiguation either - the whole site has never handled a
fiscal-year boundary in its "Week N" charts. Left as-is rather than
inventing a fix nobody asked for; flagged to the person directly
rather than shipped silently.

Republished `website/data/b3f7e6a1d4.json` (`generated_at:
2026-09-04T02:26:42`) with the corrected week labels - same manual
regeneration technique as the entries above, still pending the Drive
`painting` subfolder for this to self-sustain automatically.

### 2026-09-04 - Blasting chart: Internal's own label was hiding behind the sum badge

Caught once real data was actually visible (the manual bundle republish
in the entry below this one) - with the global bar-chart datalabels
default (`anchor:"end", align:"end"` - `chartTheme.js`), Internal
Blasting's per-bar value label wasn't at the bar's far/outer (left)
tip as intended - it was sitting right at the zero line, directly
under the combined-total pill, mostly obscured (only a sliver of the
number visible peeking out from behind the pill). External's own
label was fine already.

Root cause: for indexAxis:"y" (horizontal bars), Chart.js's stacked-
segment "end" anchor for a NEGATIVE-valued dataset resolves to the
segment's near/base tip (at zero), not its far tip - the opposite of
what "end" means for External's POSITIVE segment, where the global
default's far-tip behavior is correct as-is. Confirmed live in the
browser before touching any file: temporarily overrode Internal's
`datalabels.anchor` to `"start"` on the running chart instance and
watched the label jump from behind the pill to the bar's actual far
tip, matching every one of its real values (37, 65, 89, 154...).

Fixed: `website/js/painting-charts.js` -> `renderBlastingOutputTrend()`
- Internal's dataset now sets `datalabels: { anchor: "start", align:
"start", ... }` explicitly (External is untouched, its default
"end"/"end" was always correct). Verified the same way, live in the
browser, before publishing.

### 2026-09-04 - Root cause found: Painting was never wired into "Sync from Google Drive" at all

The person ran "Sync from Google Drive" themselves and reported the
Blasting/Bay charts (and the whole page) still showed stale Sep-3 data
afterward: "You do the sync please. I synced the data already still it
is not showing here." Checked the live bundle directly
(`fetch('data/b3f7e6a1d4.json')` in the browser console against the
person's own already-open tab) - still `generated_at:
2026-09-03T09:22:51`, no `blasting_output_trend`/`bay_output_trend`
keys, confirming the sync genuinely hadn't touched Painting's data,
not a caching illusion.

Checked GitHub Actions: the person's manual "Sync from Google Drive"
run (#722) had completed successfully. So the workflow ran fine - it
just never had anything to do for Painting. Root cause, in
`.github/workflows/drive-sync.yml` and `scripts/sync_drive.py`:

1. `drive-sync.yml` runs `main.py` (Projects), `production_main.py`,
   and `quality_main.py` after every sync - but never
   `painting_main.py`. It was simply never added when the Painting
   dashboard was built earlier this session.
2. Even fixing (1) wouldn't have been enough: `sync_drive.py`'s own
   `DEPARTMENT_DRIVE_SUBFOLDERS` dict (which Drive subfolder mirrors
   into which `data/upload/` folder) only had `projects` / `packing` /
   `quality` - no `painting` entry, so the Painting Weekly Plan
   workbook was never even downloaded from Drive into
   `data/upload/painting/` in the first place. The script's own
   docstring had flagged this as a known gap ("When a currently-
   unbuilt department (production / painting) gets its pipeline wired
   into main.py later, add a matching line...") but it was never
   circled back to.

Fixed both:
- `.github/workflows/drive-sync.yml`: added a "Run the Painting
  dashboard pipeline" step (`python3 painting_main.py`), same
  `continue-on-error: true` pattern as the Production/Quality steps -
  a temporarily-missing Painting workbook should never block the
  Projects dashboard's own commit/push.
- `scripts/sync_drive.py`: added `"painting":
  Path("data/upload/painting")` to `DEPARTMENT_DRIVE_SUBFOLDERS`.
  Rewrote the module docstring's Drive-layout example and the
  now-stale "currently-unbuilt department (production / painting)"
  sentence - both Production and Painting are built now; Production
  still deliberately has no subfolder of its own since its real
  inputs (DPR/Weekly/Line History/SIOP, Rework Data/Material
  Handover) already arrive via the `projects`/`quality` subfolders,
  so that's not a gap, just Painting's own separate workbook was.

**Still needed from the person** (can't be done from here - no Drive
access): create a `painting` subfolder under the same shared Drive
root folder as the existing `projects`/`packing`/`quality`
subfolders, and put the Painting Weekly Plan workbook in it. Until
that subfolder exists, `sync_drive.py` logs "Drive subfolder
'painting' not found... skipping" and Painting's data stays exactly
as stale as it's been all along - the code fix alone isn't sufficient
without the matching Drive folder.

**Immediate unblock, not waiting on the Drive folder**: regenerated
the Painting bundle locally (same technique used earlier this session -
the real Painting Weekly Plan workbook plus a DPR stand-in built from
the previously-published bundle's own `spools`, since the real DPR
workbook isn't available outside the Drive-synced CI environment) and
republished `website/data/b3f7e6a1d4.json` directly - `generated_at`
now `2026-09-04T02:08:48`, both new trend fields present and
populated. This is a one-time manual bridge; the code fix above is
what makes it self-sustaining from the next real Drive sync once the
subfolder exists.

### 2026-09-04 - Painting: Blasting chart corrected to a real left/right butterfly, DEE brand colours

The chart shipped earlier the same day (next entry down) got "butterfly"
wrong - it drew Internal/External as vertical bars going up/down from a
zero line, not two horizontal wings. Caught by the person: "I think you
got wrong idea, please make the chart in butterfly format, left and
right wings. By vertical I meant make it long enough to accommodate
about 20 rows." (i.e. "vertical" meant the CHART's shape - tall enough
for ~20 rows - not the bars' own orientation.) Confirmed the corrected
direction against a quick chat sketch first, then asked to flip sides
and use "the color code of DEE logo and some complementing color for
the opposite side": Internal on the left, External on the right, using
the DEE logo's own two brand colours (`--ice` #4333A5 / `--ember`
#A82E30 - see css/styles.css's "DEE red and DEE blue as the two brand"
comment) instead of the original teal.

- `website/js/painting-charts.js` -> `renderBlastingOutputTrend()`:
  `indexAxis: "y"` (horizontal bars); Internal now renders as a
  negative value (extends left), External as positive (extends
  right) - the exact opposite sign convention from the version this
  replaces. `sumLabelPlugin` reworked to draw the combined-total pill
  at each row's center (x=0) instead of each column's zero line - same
  technique, x/y roles swapped. Canvas wrapper height is now set
  per-render from the row count
  (`Math.max(340, rows.length * 34 + 90)` px) so a 20-row default (or
  a widened From/To range) actually gets the vertical room to read,
  instead of being squeezed into a fixed box.
  - Bug caught while verifying this in the browser: setting
    `.style.height` on `.chart-card__body` did nothing (confirmed via
    `clientHeight` staying at 380 regardless of what height was set) -
    that element is `flex: 1` (css/styles.css), which resolves to
    `flex-basis: 0%`, and a 0-basis flex child ignores a plain
    `height` outright. Only `min-height` actually grows it (the same
    property the static CSS fallback was already relying on for its
    own 380px default) - fixed by setting `.style.minHeight` instead.
- `website/js/painting-config.js`: `blastingColors.external` changed
  from the teal placeholder to `#A82E30` (DEE red/`--ember`) -
  `internal` was already `#4333A5` (DEE blue/`--ice`) from the start,
  so only External needed to change once the palette became "the DEE
  logo's two colours" instead of a generic non-alarming pair. Noted
  in-line that this happens to be the exact same hex as
  `overIdealColor` elsewhere on the page - deliberate reuse of the
  brand colour, not a shared meaning; this one doesn't mean "over the
  ideal" here.
- Verified in the browser (not just re-read the code): dataset sign
  confirmed Internal bars render left of x=0 and External right of it;
  `dataset.__spoolBaseColor` (the pre-gradient hex chartTheme.js's
  spoolGradientBars plugin stores before converting to a canvas
  gradient) confirmed `#4333A5`/`#A82E30` exactly; canvas wrapper
  height confirmed 770px for the default 20-row view after the
  min-height fix (770 before the fix too, but that number was the
  inline `.style.height` being silently ignored - `clientHeight` was
  actually still 380 until the min-height fix, which is what caught
  the bug above).

### 2026-09-04 - Painting: Internal/External Blasting combined into a butterfly chart, data labels added to Process Output Over Time

Asked: "since Internal & External blasting are both done at same
machines, I want to show some chart showing those together itself in
a single chart... Use Butterfly chart for better view, make it
vertical, add data labels both side but also add a data label of
showing sum together. Show around 20 lines by default and add range
filter to select as per wish... Also, please add data labels to all
these charts."

- `src/painting/summary.py`: added `build_blasting_output_trend()` -
  reuses `_group_output()` (same grouping `build_stage_output_trend()`
  already does for `internal_blasting_date`/`external_blasting_date`)
  and merges the two fields' period lists via new `_merge_period_rows()`
  helper, so a period with activity on only one side still gets a zero
  entry for the other and both series line up on the same x-axis
  categories. Each row carries both sides' own count/surface-area plus
  a combined `total`.
- `src/painting/pipeline.py`: bundle gained `blasting_output_trend`.
- `website/js/painting-charts.js`: `renderBlastingOutputTrend()` - a
  vertical diverging ("butterfly") Chart.js bar chart: Internal
  Blasting renders as a positive (upward) bar, External Blasting as a
  negative (downward) bar, both `stacked: true` on the same x category
  so they sit directly opposite each other from a shared zero line.
  Each bar gets its own value label (the plugin-wide bar-chart default
  from `chartTheme.js`, with a per-dataset `formatter` override on the
  External side so it shows the magnitude, not the negative number
  used internally for rendering). A new `sumLabelPlugin` (same
  chart-local-plugin technique as the existing `idealLinePlugin`) draws
  a small dark pill with the period's combined total directly at the
  zero line - a label that isn't tied to either dataset. Removed
  `internal_blasting`/`external_blasting` from `outputStages` (the
  loop that renders the section's single-series charts) - they're
  covered by this one chart now instead of two separate ones.
- Range filter: added `blasting-range-from`/`-to` `<select>`s - same
  UI pattern and wiring as `dashboard.html`'s existing Weekly Progress
  chart range control (`website/js/charts.js` ->
  `setupWeeklyRangeFilter()`/`refreshWeeklyRangeOptions()`), replicated
  here as `setupBlastingRangeFilter()`/`refreshBlastingRangeOptions()`.
  Defaults to the most recent 20 periods; an explicit choice survives
  metric/granularity toggles as long as both ends are still present in
  the new period list, otherwise resets to the last 20 of whatever's
  available (exactly the existing Weekly Progress chart's own
  last-N-then-preserve behavior, just N=20 instead of N=8).
- `website/painting.html`: the two single-process Blasting cards
  replaced with one `chart-card--full` card (spans the section's full
  3-column width) carrying the new chart + range control; Primer/
  Pickling/PDI Offer/PDI Clearance's remaining 4 cards reflow after it
  unchanged. `website/css/painting.css` gained an
  `.activity-charts-grid .chart-card--full` rule - the existing
  `--full` rule only covered `.charts-grid`, a different grid class
  this section doesn't use.
- Data labels on the other 4 Process Output Over Time charts
  (`renderOutputTrend()`): previously explicitly set
  `datalabels: { display: false }`. `chartTheme.js` already turns
  datalabels ON by default for every bar chart
  (`Chart.overrides.bar.plugins.datalabels`) - these four were opting
  out individually, so simply not opting out any more was enough
  (kept a `formatter` that hides the zero-value case, matching the
  global default's own convention).
- `tests/test_painting_blasting_output.py` (new, 7 cases) - covers
  `build_blasting_output_trend()`'s period-union merge, the total sum,
  and that a period present on only one side still appears with a
  zero entry for the other.
- Verified against the real workbook (same DPR stand-in technique as
  the Bay chart above): real weekly totals for both bars, the combined
  total, and the default 20-of-24-week window all confirmed correct;
  the From/To selects confirmed re-narrowing the chart live, and both
  the metric (Spools/Surface Area) and granularity (Day/Week/Month)
  toggles confirmed correctly resetting the range to the new period
  list's last 20 - via the same scratch-only auth-guard-stripped local
  copy as before, never the real `website/` files.
- `bay_output_trend` and `blasting_output_trend` both still need the
  next "Sync from Google Drive" run to appear with real data on the
  live site - the person noted the Bay chart was showing blank, which
  is expected until that next sync (no code issue).

### 2026-09-04 - Painting: "Output by Bay" chart

Asked: "Did you see something related to Bay No. in the painting
file? I also want to show output based on Bay No. per day/week/month.
Better to show as a comparison." The Painting Weekly Plan's BAY NO
column was already being read into every spool record
(`src/painting/reader.py`/`normalize.py` - `bay_no`) but nothing
downstream ever consumed it. Confirmed against the real file
(2026-09-04): values are `BAY-4`, `Bay-4`, `BAY-6`, `BAY-6 ` (trailing
space), `Bay-6 `, `BAY-6 AUTO`, and `NA` (no bay assigned) - case and
whitespace variants of the same 3 real bays, only whitespace-trimmed
before this, not case-normalized.

Asked which layout to build (one new standalone chart vs. splitting
the existing 6 process charts vs. both) - chose the standalone option.

- `src/painting/summary.py`: added `_canonical_bay()` (upper-cases and
  trims, maps `NA`/blank to `None`) and stamped `bay_no` onto every
  merged record. Added `build_bay_output_trend()` - same per-
  day/week/month grouping as the existing `build_stage_output_trend()`,
  across the same 6 processes, just split by bay instead of totalled;
  a spool with no bay assigned is left out, same convention as every
  other not-applicable field in this module.
- `src/painting/pipeline.py`: bundle gained `bay_output_trend`.
- `website/painting.html` / `painting-data.js` / `painting-charts.js`:
  new "Output by Bay" section - its own process/metric/day-week-month
  selectors, one Chart.js dataset per bay so they compare side by side
  rather than sum.
- `tests/test_painting_bay_output.py` (new, 13 cases) - covers
  `_canonical_bay()`'s case/whitespace/NA handling and
  `build_bay_output_trend()`'s per-bay, per-period grouping.
- Verified against the real workbook (no DPR access locally, so a
  Fabrication-shaped stand-in was built from the already-published
  bundle's own `spools` for the merge step): canonical bays come out
  as `BAY-4` (1920), `BAY-6` (1847), `BAY-6 AUTO` (685), 578
  unassigned - matches the raw value counts exactly once case/
  whitespace variants are collapsed. Chart verified rendering with
  real weekly totals per bay across all 6 processes, and the process/
  metric/period toggles all confirmed switching correctly, via a
  scratch-only copy of the site with `auth-guard.js` stripped (never
  committed) served on localhost - the real `website/` files are
  untouched by that.
- Not yet reflected on the live site: `bay_output_trend` only appears
  once the next "Sync from Google Drive" run regenerates the Painting
  bundle, same as the Production fix below.

### 2026-09-03 - Painting department dashboard built; Production "Release for Painting"/PDQC backlog Rework-exclusion fix

**Painting dashboard, built from scratch.** Last remaining department
without a dashboard. Cross-references DPR RFP-done spools against the
Painting Weekly Plan workbook (`config/painting_settings.json` ->
`file_pattern: "*Painting Weekly Plan*.xlsx"`, since the exact filename
varies run to run), computing RFP -> Internal Blasting / External
Blasting / Primer -> next coat (or PDI Offer fallback) / PDI Offer ->
PDI Clearance stage gaps, against a 4-day ideal cycle. New package
`src/painting/` (`reader.py`, `normalize.py`, `summary.py`,
`pipeline.py`), `painting_main.py`, `website/painting.html` +
`painting-{config,data,kpi,charts,tables,app}.js`. Then an 8-point
correction round from the person, against real data:
1. A spool not found in the Painting Plan but already packed/
   dispatched per the DPR is excluded from "missing from plan" -
   `merge_spools()`'s `excluded_already_packed`.
2. Respect the workbook's own "NA" per-process applicability (Internal
   Blasting Reqd flag; External Blasting/Primer gated on `No.of Coats
   >= 1`) rather than averaging every spool into every process.
3. Process Output Over Time - spools/surface-area completed per
   day/week/month, per process (`build_stage_output_trend()`).
4. Pickling info surfaced (the alternative route for the 0-coats/no-
   paint group).
5/6/7. No.of Coats drives primer applicability (0 = no primer); a
   spool with External Blasting implies Primer should exist too
   (flagged as an anomaly if not, `external_blasted_no_primer`).
8. More insights: median cycle time by project and by material
   (`build_project_insight()` / `build_material_insight()`).
Later split the single Process Output chart (with a stage dropdown)
into 6 separate charts, one per process, and added a Projects-style
filter bar (multi-select/numeric-range/sort/Selection-Summary) to the
"All RFP-Done Spools" table.

**Production: "Release for Painting" backlog was 3x too high because
Rework spools weren't excluded.** Asked: "The Ready for Painting
Backlog has 73 spools beyond 30 days, but QC says some are Rework or
Hold. Check why and fix it." Cross-referenced the real
`Production Rework Data.xlsx` workbook (the ABSOLUTE-RULE-#1
authority for PDQC/RFP status, `src/rework_pdqc_rule.py`) against the
published backlog: 49 of the 73 "Beyond 30 Days" spools were actually
in Rework (real backlog = 24). Root cause: Rework forces PDQC/RFP
blank the same way an open Hold does, but only Hold spools were ever
excluded from the backlog charts (`src/production/backlog.py`) - a
Rework spool looked exactly like a genuine stuck-at-this-stage entry
at every downstream stage.
- `src/production/ageing.py`: `SpoolRecord` gained
  `rework_latest_status`, populated from `rework_pdqc_rule.py`'s
  `REWORK_LATEST_STATUS` alongside the existing `currently_on_hold`.
- `src/production/backlog.py`: exclude a record from a stage's backlog
  chart when `rework_latest_status == "Rework"` - **except at PDQC
  itself.** First shipped as a uniform exclusion across every stage;
  the person caught it: "why is PDQC beyond 30 zero now?" then gave a
  real example (offered ~83 days ago, still in Rework) that should
  have shown up there and didn't. Corrected same day: PDQC's own chart
  IS that spool's not-yet-resolved verdict, not an unrelated blocker
  the way Hold is - excluding it there was hiding exactly the spools
  the chart most needs to surface. The exclusion now only applies
  downstream of PDQC (Release for Painting, PDI Clearance, Packed) and
  to Welding Finish.
- `src/production/summary.py` / `pipeline.py`: added
  `build_rework_by_project_stage()`, mirroring the existing
  `build_hold_by_project_stage()`, so the excluded population is shown
  in its own chart rather than silently dropped.
- `website/production.html` / `production-{data,charts}.js`: new
  "Currently in Rework" section, same layout as the existing Hold one.
- `tests/test_production_rework_exclusion.py` (new, 10 cases) -
  includes the specific PDQC-exception regression case.
- Verified: the person re-ran the real pipeline after the fix and
  confirmed the RFP-side backlog was corrected; the PDQC-exception
  correction landed the same session, still awaiting the person's next
  "Sync from Google Drive" run to confirm on real data.

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

### 2026-08-17 - Welder Performance: DPR-matched project labels + secondary-axis month chart

Two fixes on the Welder Performance section added yesterday, both
per his review of the live charts:

1. "Project Wise Reject %" was grouping by the raw "Project Name"
   column, which is really a hand-entered Project Code and
   inconsistent (e.g. "NE-VB" vs "NE- VB" showed as two separate
   bars). src/quality/welder_performance.py -> build_project_wise_
   summary() now takes the same DPR (Fabrication workbook) Project
   Code -> Project Name lookup the Rework charts already use
   (sources.project_names), normalizes each raw value (whitespace/
   hyphen-spacing/case only - verified "NE-VB" and "NE- VB" now
   merge into one bar) and resolves the DPR Project Name for
   display. Deliberately does NOT fuzzy-guess beyond that (e.g.
   won't merge "NE-VE" into "NE-VB") since a wrong guess would
   silently combine two different projects' reject rates - anything
   that doesn't match a known DPR code keeps its own bar (code only)
   and logs a warning so it can be fixed at the source. Chart label
   now matches the Project Progress chart's "Name on top / (Code)
   below" style - ported website/js/charts.js's twoPartYLabelsPlugin
   into quality-charts.js (duplicated, not shared - the two
   dashboards don't share a JS bundle).

2. "Month Wise Joint Reject Rate" plotted Total NDT Joints and
   Rejected Joints as two same-axis bars, which made the reject bar
   nearly invisible next to the much larger total. Rejected Joints
   is now a line on a secondary (right-hand) y-axis instead.

Bumped quality.html's cache-busting query strings for quality-
config.js and quality-charts.js (?v=20260817) - see the 2026-08-16
entry above for why this matters.

### 2026-08-17 (cont'd) - Project Master workbook (Code -> Name lookup) + corrected Welder Performance project matching

Turned out the "Project Wise Reject %" fix earlier today matched the
wrong direction: the Welder Performance file's raw "Project Name"
column holds an informal NAME ("Vogt-CB", "NE-Legend"), not a
Project Code as first assumed - confirmed once he shared his real
Project Master workbook (Project Code + Project Name, 70 rows). Also
caught that several Project Names in the master are shared by
multiple Project Codes (e.g. "TNS Duplex 4" across 4 codes) - normal
for multiple PO line items under one named project, not a data error.

New source - Project Master workbook (data/upload/projects/
*Project*Master*.xlsx, hand-maintained, updated "from time to time"
per the person - config/settings.json -> input_files.project_master):
src/reader.py -> read_project_master() (multi-file latest-wins per
Project Code, same contract as read_fabrication()); wired into
src/quality/reader.py, where it's merged on top of the existing
DPR-derived Project Code -> Name lookup, Project Master winning any
conflict (it's the one he directly maintains and keeps current for
projects that have aged out of the DPR export) - this same merged
lookup already feeds the Rework charts, so no separate change needed
there.

src/quality/welder_performance.py -> build_project_wise_summary()
rewritten to match by NAME (normalize + look up against the master's
Project Names) instead of by Code. Verified against his real files:
6 of 13 raw project values now resolve cleanly (NE-Delta, NE-Legend,
NE-Gregory, Tilenga, Vogt-CB, Vogt-FP); the other 7 (NE-VB/NE- VB,
NE-FF, NE-VE, VO-BISION, Vogt-Bision, VPI-CB, VPI-FP) don't match
anything in the master and are logged by name so he can confirm
whether each is a typo to fix or a project to add - not auto-guessed,
per the same "don't silently merge" reasoning as the Code-matching
attempt this morning. Also handles the "one Name, several Codes"
case (groups by Name, shows no single Code, logged separately from
the "no match at all" case).

Along the way, fixed a normalization bug from this morning's first
attempt (_normalize_project_key kept hyphens as literal hyphens
instead of treating them as word separators, so "NE-Legend" never
matched "NE Legend") and a pandas quirk where an unmatched group's
None values were coming out as float NaN instead of null in the JSON
bundle.

### 2026-08-17 (cont'd) - PDQC override: blank PDQC when not yet cleared by QC

The Rework PDQC override (added 2026-08-10) always set a spool's
PDQC to the later of (existing PDQC, latest Prod Offer Date in the
Rework Data workbook) - regardless of what that latest offer event's
Final Status actually said. The person flagged a gap in his own
original rule: he'd meant for that override to only apply when the
spool was actually cleared by QC, and forgot to say so at the time.

src/merge.py -> apply_rework_pdqc_override() now branches on the
Final Status of whichever row has the latest Prod Offer Date for a
spool (same "always take the latest-dated row's status" rule as
Rework Latest Status, confirmed 2026-08-10):

  - Accept (cleared): unchanged behavior - PDQC becomes the later of
    (existing, latest offer date), never moves backwards.
  - Anything else (Rework, or an "Other" like "Project hold") - NOT
    cleared: PDQC is forced BLANK, even overwriting an existing PDQC
    value from DPR/Line History - a stale earlier PDQC would
    otherwise overstate progress once the latest QC event says the
    spool is back in rework.

A spool not covered by the Rework Data workbook at all keeps its
existing PDQC untouched, same as before - confirmed with the person
this rule is only for spools the rework file has an opinion on. If
the workbook is ever missing its Final Status column entirely (he
confirmed he'll keep it populated, and will flag it if that ever
changes), this falls back to the pre-2026-08-17 unconditional
"later of the two" behavior rather than blanking every matched
spool's PDQC on a missing-column edge case - logged clearly either
way.

Verified with synthetic cases covering every branch: bump-forward,
protect-existing-later-date, set-from-blank, blank-on-not-cleared
(even overwriting an existing PDQC), unmatched-spool-untouched, and
the missing-Final-Status fallback - all behaved exactly as intended.

Expected downstream effect (per the person, and consistent with how
PDQC/RFP feed Ageing): average PDQC age will go up (spools that were
wrongly counted as QC-cleared now correctly show as still pending)
and average RFP age will go down, since fewer spools are wrongly
past the PDQC gate.

### 2026-08-17 (cont'd) - "Project Wise Reject %" reported blank + defensive hardening

Reported the "Project Wise Reject %" chart rendering completely
blank (card title/subtitle visible, canvas empty). Extensively
tested the exact chart config against his real pipeline-computed
data (14 project rows, all valid) using the real vendored Chart.js
4.5.1 build plus the site's full theme/datalabels/gradient-bar
plugins - rendered correctly every time, no exceptions, no blank
canvas. Couldn't reproduce locally, so this is most likely the same
class of issue as the 2026-08-16 cache-busting bug (a stale
JS/HTML/data-bundle mismatch on his end) rather than a code defect.

Bumped quality-charts.js's cache-busting version again (?v=20260817c)
regardless, and hardened website/js/quality-charts.js so this class
of problem is diagnosable if it recurs: each of the 5 Welder
Performance charts now renders inside its own try/catch (one
throwing no longer silently blocks the rest from rendering, which an
uncaught exception earlier in the render() sequence would have
done), and an empty/missing-data case now logs a console.warn with
the actual data received instead of failing silently. Asked him to
check the browser console (F12) if this recurs after a hard refresh.

### 2026-08-18 - Project Wise Reject %: use the real Project Code column, not name-matching

Third attempt at this chart. Both earlier attempts guessed at the
wrong source column - the workbook actually has a genuine Project
Code column all along, just labeled "Job No" in the raw header
(values like "TJ/25-26/170" - exactly the Project Master's format).
Confirmed against his real file: all 9 distinct Job No values match
a Project Master entry exactly, no typos at all - unlike the
"Project Name" column, which was hand-typed and inconsistent (the
source of both previous attempts' problems).

src/quality/welder_performance.py -> build_project_wise_summary()
rewritten again: groups by the Job No/Project Code column directly,
exact lookup only against the Project Code -> Name master (no
normalization, no fuzzy matching, no name-based reverse lookup -
all of that machinery, including _normalize_project_key(), removed
entirely as unnecessary). The workbook's "Project Name" column is no
longer read for this chart at all, per his explicit instruction.
Verified against his real files: all 9 projects now resolve cleanly
with zero unmatched codes (NE Legend, NE Gregory, VOGT CB, NE
Vicksburg, NE Delta, NE Franklin Farms, VOGT FP, Tilenga, VOGT
Bison) - a big improvement over the previous name-matching attempt's
6-of-13 resolved with several typo'd/unmatched bars.

### 2026-08-18 - Absolute Rules doc + Rework PDQC rule now applies everywhere

Diagnosed a real mismatch the person reported: Projects page showed
~400 spools "Ready for Painting", Production page showed 500+ for
what should be the same population. Root cause: the Rework PDQC rule
(latest Rework Data offer event overrides PDQC; blanked entirely if
not cleared - added 2026-08-10, corrected 2026-08-17) only ever
existed in src/merge.py, used by the Projects pipeline (main.py).
The Production pipeline (production_main.py -> src/production/
reader.py) read PDQC straight off the raw DPR sheet with zero
knowledge of the Rework Data workbook - so a spool still under
rework could count as "PDQC done" there while correctly showing as
not-yet-PDQC'd on Projects.

Per the person, in his own words: "Rework rule is absolute primary
... Same rule needs to be applied to everywhere." Two things done:

1. New docs/absolute-rules.md - a permanent, cross-dashboard rules
   document (distinct from docs/decision_log.md, which stays scoped
   to single-pipeline decisions). Every future Claude session must
   read this before touching PDQC or adding a new pipeline. Rule 1
   is this PDQC rule, in full.

2. Extracted the rule's entire implementation out of src/merge.py
   into a new shared module, src/rework_pdqc_rule.py ->
   apply_rework_pdqc_rule() - the single implementation every
   pipeline must call. src/merge.py -> MergeEngine.apply_rework_
   pdqc_override() is now a thin wrapper around it (verified
   byte-for-byte identical behavior against the same test cases used
   when the rule was first built - no regression). src/production/
   reader.py now also reads the Rework Data workbook (optional,
   same contract as Line History/SIOP), and src/production/
   pipeline.py -> run() calls the shared function on sources.
   fabrication's PDQC column immediately after load_sources(),
   before any stage/backlog/ageing computation reads it - so
   current_stage, the backlog charts, and ageing on the Production
   dashboard all now agree with the Projects dashboard on which
   spools are actually PDQC-cleared.

Verified the shared function directly and via the merge.py wrapper
against the full set of branch cases (bump-forward, protect-later-
existing, set-from-blank, blank-on-not-cleared, unmatched-untouched,
missing-Final-Status-column fallback) - all correct, matching the
original 2026-08-17 test results exactly. Could not run production_
main.py fully end-to-end in this environment (no real DPR/Weekly
Planning sample file available here) - recommend running it for real
after applying this and spot-checking a few spools that were
previously miscounted.

### 2026-08-19 - Absolute Rule #2: Hold is not Rework (PDQC/RFP anchoring)

Following up on Rule #1 (2026-08-17/18: PDQC blanked for spools not
cleared by QC), the person reported that this was inflating the
PDQC-stuck count on both dashboards for spools that were only on
administrative Hold, not genuine rework - "Production says a Hold
should not affect their ageing, QC says Hold should not affect
their ageing." Per his explicit instruction, added as Absolute Rule
#2 in docs/absolute-rules.md, implemented in the same shared
src/rework_pdqc_rule.py -> apply_rework_pdqc_rule() that implements
Rule #1, so both Projects and Production pick it up automatically
with no new call sites needed.

The Rework Data workbook's Final Status column maps to exactly 3
categories now (given by the person, his exact 6 raw text values):
Accept -> Accept; Rework, Rework/same RW, Not found, SPOOL DELETED
-> Rework; Project hold -> Hold (new). Any unrecognized value
defaults conservatively to Rework and logs a warning, rather than
being silently assumed Accept or Hold.

For a Hold-classified spool: PDQC is anchored to the EARLIEST offer
date it was ever seen on Hold (not the eventual Accept date,
however long the hold lasted) - later of that anchor vs. existing
DPR PDQC. RFP is set to the anchor + a standard 4-working-day gap
(STANDARD_PDQC_TO_RFP_WORKING_DAYS, derived from config/production_
rules.json's target_days table, confirmed uniform across all 6
categories as of today - flagged in code as needing a manual update
if that ever stops being true) rather than the true RFP date, which
would otherwise still carry almost the entire hold-caused delay.
Verified against the person's own worked example (offered 1 Aug,
held, cleared 11 Aug) exactly: PDQC anchors to 1 Aug, not 11 Aug.

Persistent memory: since a Hold row can be edited in place to Accept
(no new row added), the fact a spool was ever on Hold can vanish
from the workbook once resolved. Added state/hold_tracking.json,
committed by every pipeline run (.github/workflows/drive-sync.yml's
git add step updated to include state/) - loses this memory and
silently breaks Rule #2 if that ever stops being committed. A spool
that re-enters Hold after being previously resolved (an ambiguous
pattern the person said shouldn't normally happen) is NOT
auto-re-anchored - it's flagged via a new Exceptions tab entry
(src/summary.py -> generate_exceptions(), type "rework_hold_reentry")
per his explicit instruction to review and fix the source file by
hand rather than have the system guess.

Verified extensively with synthetic multi-run scenarios simulating
real GitHub Actions runs across time: fresh Hold detected while
still on hold (PDQC/RFP correctly anchored); resolution to Accept in
a later run via the SAME row edited in place (anchor correctly
preserved, not reset to the Accept date); full 6-value status
mapping; re-entering Hold after resolution (correctly flagged as an
exception, not silently re-anchored, verified it flows all the way
through to generate_exceptions()'s output); and a full mixed-batch
regression against every existing Rule #1 branch (bump-forward,
protect-later-existing, set-from-blank, blank-on-not-cleared,
unmatched-untouched) alongside the new Hold case in the same run,
confirming zero regression.

Could not run this against the person's real, larger Rework Data
workbook in this environment (only synthetic test data available
here) - recommended he run the real pipelines and spot-check a few
Hold-affected spools, and watch the Exceptions tab for any
rework_hold_reentry entries after the first run.

### 2026-08-20 - Drive-sync interval back to hourly; new "reversed stage dates" exception check

Changed .github/workflows/drive-sync.yml's cron schedule from every
15 minutes back to hourly ("0 * * * *"), per the person's request.

Separately, the person reported the Production dashboard's "Stage-
wise Ageing by Category" chart showing a HIGHER average actual
day-count for PDQC than for RFP in some categories - structurally
backwards, since RFP requires PDQC to have happened first. Confirmed
this could NOT be caused by the Rework PDQC/RFP rule
(src/rework_pdqc_rule.py) - verified directly that rule always sets
RFP to at least PDQC + 4 working days for any spool it touches, so
it can't invert the two for an individual spool. Also confirmed
Rule #1 (added 2026-08-17/18) has run successfully many times on the
Production pipeline since - the person confirmed this directly - and
verified separately that when it does run, it correctly wipes a
stale PDQC date for a spool that's since bounced back into active
rework, which would otherwise be the classic mechanism for exactly
this kind of inversion (an old PDQC date counted in that stage's
average while the spool never actually reached RFP for real).

Found the actual gap instead: the existing Exceptions check
(src/summary.py -> _out_of_order_stages()) only catches a LATER
stage being unexpectedly filled while an EARLIER one is still blank
- it says nothing about two stages that are BOTH filled but land in
the wrong chronological order relative to each other (e.g. an RFP
date earlier than the same spool's PDQC date). Those sail through
completely undetected today, since by the time both are filled,
Current Stage has already moved past both and there's nothing left
for that check to flag.

Added a new check, _reversed_stage_pairs(), covering every
consecutive pair in the stage list (not just PDQC/RFP - Fit-Up/
Welding, PDQC/RFP, RFP/PDI, etc.) - if both dates are present and
the later stage's date is earlier than the earlier stage's, it's now
surfaced on the Projects dashboard's Exceptions tab as a new
"reversed_stage_dates" exception type, naming the exact stage pair
and both dates. Verified it correctly fires on a synthetic PDQC-
after-RFP spool and produces zero false positives on a normal,
correctly-ordered one.

This surfaces the underlying data rather than guessing at or
silently "fixing" it - consistent with how Rework Type/Project
Master mismatches have been handled throughout this project.
Recommended the person run the pipeline and check the Exceptions
tab for any reversed_stage_dates entries - if there are real ones,
that will name the exact spools responsible for the chart anomaly he
reported, which he can then trace back to the source DPR/Rework data.

### 2026-08-20 (cont'd) - Fixed the actual chart: exclude untrustworthy spools from a stage's average

Following up on the reversed_stage_dates Exceptions check added
earlier today - the person's specific example (Under Painting
2026-05-29 -> Packing 2025-06-02) turned out to be a real 11-month
reversal, confirmed by him after re-reading the years (he'd initially
misread it as a normal 4-day gap). So the check itself is correctly
catching genuine data problems, not false-flagging normal backward-
cycling.

For the actual chart fix ("Stage-wise Ageing by Category" showing
PDQC's average higher than RFP's) - considered and rejected silently
"correcting" the bad dates (no way to know what the true date should
have been). Instead, src/production/summary.py gains
_trustworthy_actual_days(): for each spool, walks its own
stage_actual_days in TRACKED_STAGES order: if a stage's value is
LESS than an earlier tracked stage's own raw value (i.e. a date
reversal, same underlying condition the new Exceptions check
catches, computed independently here since Production doesn't use
the Projects pipeline's exception logic), that stage's value is
excluded from THAT STAGE'S average only - not from other stages, and
the underlying raw stage_actual_days/dates are untouched everywhere
else (current_stage, ageing, exports). build_stage_ageing() now
builds each stage's average from this filtered/trustworthy view
instead of the raw one.

Verified with a synthetic mixed case (one normal spool, one with a
genuine PDQC>RFP reversal): the reversal is correctly excluded from
RFP's average specifically (reached_count drops from 2 to 1 for that
stage), while PDQC's own average is untouched (nothing wrong with
its own value relative to earlier stages).

Important honest caveat, explained to the person: this guarantees
the averages are built only from internally-consistent (possible)
data - it does NOT mathematically guarantee PDQC's average will
always compute lower than RFP's forever, since the two are now
legitimately computed over slightly different trustworthy
sub-populations (a spool excluded from RFP's average for being
untrustworthy there may still validly count toward PDQC's). It
should substantially shrink or eliminate the inversion to the extent
it was driven by corrupted/reversed dates, which was the reported
symptom - but any small residual gap after this fix reflects genuine
sampling variance across real data, not a remaining calculation bug.

### 2026-08-20 (cont'd) - Packing & Dispatch backfill: flipped to DPR-wins

Root cause of the earlier "my DPR correction isn't showing up"
report: PDI/Packing/Dispatch were being unconditionally overwritten
by the separate Packing & Dispatch workbook (data/upload/packing/)
whenever it had ANY value for a spool - even if DPR's own value had
just been corrected. The person, in his own words: "In case if any
spool does not have PDI/Packing/Dispatch date in DPR file, then only
it looks at Packing folder file. Otherwise do not look."

src/merge.py -> MergeEngine.apply_packing_dates() flipped: DPR's own
PDI/Packing/Dispatch value now wins whenever present - the Packing &
Dispatch workbook is only consulted to fill in a spool's date when
DPR's own field is blank, never to overwrite an existing DPR value.
Verified with 3 cases: DPR-has-value + packing-workbook-has-different-
value -> DPR value kept unchanged; DPR-blank + packing-workbook-has-
value -> filled in; both blank -> stays blank. All correct.

### 2026-08-20 (cont'd) - Rework rule now also blanks RFP; new "Holds & Reworks" strip

The person shared a real Production Backlog export: 232 of 447 rows
(52%) counted as "stuck at PDQC" actually had PDQC blank but a
downstream date (RFP/PDI/Packed) already filled - spools that had
genuinely completed the full journey once, then got sent back into
rework, with only PDQC getting blanked (the original Rule 1 scope)
while their stale downstream dates from the previous pass stayed in
place. This both misrepresented "where" these spools actually are
and badly inflated the Production Backlog chart's overdue-day
figures, since the backlog calculation anchors to the spool's
original (now very old) Welding Finish date.

Proposed blanking every downstream stage (RFP/PDI/Packed) when a
spool re-enters genuine Rework. The person's actual instruction was
narrower: "if the spool has already been PDI cleared, that means its
rework has already been cleared... blank only PDQC and RFP dates for
Rework Spools" - he'll correct stale entries in the Rework Data
workbook directly rather than have the pipeline guess at PDI/Packed.
He's also flagged wanting a different overall approach to Rework
handling in a future session - this is the interim fix.

src/rework_pdqc_rule.py -> apply_rework_pdqc_rule(): the "not
cleared" (Rework) branch now blanks RFP alongside PDQC (previously
PDQC only); PDI Clearance and Packed are untouched by this rule, in
any branch. Verified with the exact real-world shape from his export
(PDQC blank, RFP/PDI already filled, Rework status) plus a full
regression against every existing branch (Accept bump-forward,
protect-later-existing, set-from-blank, Hold-anchoring) - all
correct, matching prior test results exactly except for the new RFP-
blanking behavior on Rework specifically.

Also finally built the "Holds & Reworks" reconciliation strip on the
Fabrication Line (Projects dashboard) that was requested earlier in
this project and got sidetracked into the Rework/Hold rule work -
src/summary.py -> generate_dashboard_summary() now includes a
"rework_quantum" count (spools whose REWORK_LATEST_STATUS is
currently Rework or Hold), rendered by website/js/fabline.js as a
small strip under the bottleneck note (hidden entirely when both
counts are zero) - website/dashboard.html and website/css/styles.css
updated to match.

### 2026-08-20 (cont'd) - Stale Rework status now an override, not just a scoping choice

The person reported still seeing PDI-cleared spools in the
Production PDQC Backlog chart after the earlier RFP-blanking fix.
Root cause: that fix used his "PDI cleared means rework is already
cleared" reasoning only to decide what NOT to blank (PDI/Packed),
not as an actual condition to skip blanking PDQC/RFP in the first
place. Since "current stage" is always the first blank stage in
order, a spool with PDQC freshly blanked but PDI/Packed still filled
would permanently register as "stuck at PDQC" no matter what -
exactly the spools he was still seeing.

Fixed properly this time: src/rework_pdqc_rule.py -> apply_rework_
pdqc_rule() now checks, for any spool whose latest status is Rework,
whether it already has a PDI Clearance or Packed date on record - if
so, PDQC/RFP are left completely untouched (not blanked at all), and
the spool is flagged via a new REWORK_STALE_STATUS_EXCEPTION column,
surfaced on the Projects dashboard's Exceptions tab as a new
"rework_status_stale" type (src/summary.py -> generate_exceptions()),
so the person can find and correct the stale Rework Data workbook
entry directly, same workflow as the earlier rework_hold_reentry
exception.

Verified: a spool with PDI already cleared, and a separate one with
Packed already filled, both correctly keep their existing PDQC/RFP
untouched and get flagged; a genuine Rework spool with nothing
downstream filled still gets blanked exactly as before. Full
regression against every existing branch (Accept, Hold, plain
Rework, Hold exceptions) re-run and confirmed unchanged.

### 2026-08-21/22 - Hold ledger replaces Rule 2's anchoring; Hold excluded from every backlog chart

The person's own idea, worked through with him step by step before
building: since Hold spools were being anchored to a fake "done
almost immediately" PDQC/RFP date (the 2026-08-19 Rule 2), a future
run couldn't tell how many real WORKING days a spool had actually
spent on Hold - and there was no way to handle a Hold that happened
AFTER RFP (during Under Painting) at all, since the anchor approach
only ever touched PDQC/RFP.

Replaced with a persistent Hold ledger (new src/hold_ledger.py,
still state/hold_tracking.json - only the schema changed, with a
migration for the old single-anchor format): every spool's real Hold
start/removal dates are recorded as a list of periods (any number of
them - re-entering Hold after a previous resolution is no longer an
ambiguous case, just another period). PDQC/RFP are no longer faked -
a Hold spool gets the same blank-until-cleared treatment as a
genuine Rework spool (src/rework_pdqc_rule.py rewritten accordingly,
new CURRENTLY_ON_HOLD column). Every ageing calculation that has an
age window overlapping a Hold period - Total Age and Stage Age on
the Projects dashboard (src/ageing.py), current-age-vs-target and
per-stage actual days on Production (src/production/ageing.py) -
subtracts the WORKING days held from that window
(hold_ledger.working_days_held_between(), same weekend/holiday
calendar as everywhere else). This is a plain date-overlap check, so
a post-RFP Hold correctly reduces Under Painting's stage age the
same way a pre-RFP Hold reduces Total Age or PDQC's window - verified
directly against a synthetic case matching his post-RFP scenario.

Also per his explicit follow-up request: "The hold spools should not
be visible as backlog at any stage" - a spool with an open Hold
right now (CURRENTLY_ON_HOLD) is excluded entirely from
src/production/backlog.py's charts and from src/summary.py's
current_stage_distribution on the Projects dashboard. They get their
own dedicated chart instead - "Project wise stage wise current Hold
quantity", his words - new build_hold_by_project_stage() in both
src/summary.py and src/production/summary.py, a {project: {stage:
count}} cross-tab, rendered as a stacked bar on both dashboards
(website/js/fabline.js for Projects, website/js/production-charts.js
for Production - new HTML sections in website/dashboard.html and
website/production.html).

The old rework_hold_reentry exception type no longer applies (multiple
Hold periods are handled natively now) - the narrower case still
worth flagging (an open Hold jumping straight to Rework with no
Accept in between, which the ledger genuinely can't resolve on its
own) is now rework_hold_ambiguous, same Exceptions tab.

Files changed: src/hold_ledger.py (new), src/rework_pdqc_rule.py
(Hold anchoring removed, ledger wired in), src/ageing.py,
src/production/ageing.py, src/production/backlog.py, src/summary.py,
src/production/summary.py, src/production/pipeline.py,
website/js/fabline.js, website/js/production-charts.js,
website/js/production-data.js, website/dashboard.html,
website/production.html, docs/absolute-rules.md (Rule 2 rewritten,
old anchoring approach kept as collapsed history for context).

Tests: new tests/test_hold_ledger.py (9), tests/test_rework_pdqc_
rule.py (6, direct Hold-behavior coverage - old anchor-specific
tests removed since that code path no longer exists),
tests/test_ageing_hold.py (4), tests/test_production_ageing_hold.py
(5, including the post-RFP/Under Painting case specifically),
tests/test_production_hold_summary.py (4), tests/test_summary_hold.py
(4) - 32 new tests, all passing. Full existing suite re-run
(168 passing / 23 failing) and cross-checked against a completely
untouched copy of the repo at the same "today" - the 23 failures are
pre-existing, date-dependent flakiness unrelated to this change (a
handful of tests hardcode "N calendar days ago = N working days",
which only holds depending which weekday the suite happens to run
on) - confirmed identical failure list on the pristine repo, so
nothing in this session introduced a regression.

Not verified against his real Excel data (none was available this
session) - worth a careful first-run check, especially: (1) that
state/hold_tracking.json's legacy entries migrate cleanly (a resolved
legacy Hold gets zero retroactive day-credit, by design - see
hold_ledger.py's docstring), and (2) the new Hold charts on both
dashboards render sensibly against his actual current Hold spools.

### 2026-08-24 - Bug fix: same-date offer ties in the Rework Data workbook were keeping the wrong row

Found while investigating a specific spool the person flagged (Drawing
2-V17565-PIND-0092 / Spool V17565-PIND-0092-01, "this spool is already
accepted, then why is it appearing" in PDQC Backlog): its Rework Data
history had a Rework row and an Accept row both dated the exact same
day (2026-06-25), identical QC Observation text - QC had appended the
Accept row after review without back-dating it to a later date.

src/rework_pdqc_rule.py's "latest offer event" selection used
groupby(COMPOSITE_KEY)[REWORK_OFFER_DATE].idxmax() - on a tie, idxmax()
silently keeps whichever row comes FIRST in the workbook, not whichever
was entered LAST. Since QC's real final answer for a spool is always
the later-entered row, this was blocking PDQC clearance for spools QC
had genuinely accepted, whenever a Rework/Hold row and its eventual
Accept happened to land on the same offer date.

Fixed: stable sort by Prod Offer Date, then take the LAST row per
composite key (kind="stable" preserves each tied group's original
sheet order) - so ties now correctly resolve to whichever row was
entered last, not whichever happened to be listed first.

Scope in the person's 2026-08-22 Rework Data workbook: 156 spools
across all projects were affected (153 wrongly blocked as Rework when
the true latest entry was Accept; 3 the other direction, wrongly shown
Accept when the true latest entry was a later Rework/Hold - also now
fixed). Of the 197 spools in his original PDQC Backlog export
specifically, 10 were misclassified this way (89 -> 79 genuine
Rework, 7 -> 17 correctly Accept once re-checked with the fix).

Files changed: src/rework_pdqc_rule.py (latest-offer-event selection
only - the rest of the Accept/Rework/Hold logic is unchanged).

Tests: tests/test_rework_pdqc_rule.py - two new tests
(test_same_date_tie_picks_the_later_sheet_row_not_the_first,
test_same_date_tie_reverse_order_also_picks_the_later_sheet_row,
covering both tie directions) using the person's real example. Full
suite re-run: 170 passing (up from 168 - the two new tests), same 23
pre-existing date-dependent failures as every prior session, unrelated
to this change.

Not re-verified against a fresh pipeline run with real output files
this session (no deployment access) - the person should re-run the
pipeline with this fix and the Rework Data workbook he already
supplied; the 17 "should now clear" spools in the corrected
PDQC_Backlog_Analysis are the ones to spot-check first.

### 2026-08-24 (later same day) - Query now maps to Hold, not Rework

Given by the person: "please note Query will also come under HOLD
category, so please amend accordingly." Previously an unrecognized
Final Status value (fell through to the conservative "treat as
Rework" default, with a warning logged). Added "QUERY": "Hold" to
_STATUS_MAP in src/rework_pdqc_rule.py - 2 spools in his current
Rework Data workbook were affected (both re-classified Rework ->
Hold; PDQC stays blank either way, only REWORK_LATEST_STATUS /
CURRENTLY_ON_HOLD / Hold-ledger tracking change).

Also cleaned up a dangling orphaned comment fragment left over from
the 2026-08-21 Hold-ledger rewrite (a leftover sentence referencing
the removed STANDARD_PDQC_TO_RFP_WORKING_DAYS constant, sitting
directly above _STATUS_MAP - harmless but confusing to read).

Tests: tests/test_rework_pdqc_rule.py - new
test_query_status_is_treated_as_hold. Full suite: 171 passing (up
from 170), same 23 pre-existing unrelated failures.

Separately, used the corrected pipeline logic (this Query fix +
2026-08-24's earlier same-date tie-break fix) to answer his direct
question - which spools are CURRENTLY Rework vs CURRENTLY Hold, from
his freshly-uploaded Production_Rework_Data.xlsx: 6,563 Accept, 159
Rework, 12 Hold (of 6,734 spools with any offer history). Delivered
as Currently_Rework_and_Hold_Spools_2026-08-24.xlsx (not a code
file - an analysis output, Project Name cross-referenced from the
2026-08-22 DPR upload since no fresh DPR was supplied this turn).

### 2026-08-24 (later still) - "Re insp due to RT" mapped to Rework

Follow-up to comparing QC's separate project-wise report
(Rework_Data_Project_Wise-24-08-2026.xlsx) against
Production_Rework_Data.xlsx: found 49 spools QC has flagged "Re insp
due to RT" (need radiography re-inspection) showing as Accept in the
pipeline, because that status doesn't exist anywhere in the Rework
Data workbook's Final Status column at all - QC tracks it in a
separate report that never reaches the file the pipeline reads.

Decided with the person: QC will start recording this directly in
Production_Rework_Data.xlsx's Final Status column going forward
("Re insp due to RT" - QC's own existing wording), and it should
count fully against PDQC ageing and stay visible on backlog, same as
any other unresolved QC item (NOT excluded from backlog / day-
subtracted from ageing the way Hold is).

Added "RE INSP DUE TO RT": "Rework" to _STATUS_MAP in
src/rework_pdqc_rule.py. Note: this value already fell through to
the conservative "unrecognized -> Rework" default, so this is mostly
a documentation/warning-suppression change, not a behavior change -
it makes the mapping explicit and stops the "unrecognized Final
Status" warning from firing every run once QC starts using this
value.

Tests: tests/test_rework_pdqc_rule.py - new
test_re_insp_due_to_rt_status_is_treated_as_rework. Full suite: 172
passing (up from 171), same 23 pre-existing unrelated failures.

Separately delivered (not a code file): QC_Report_vs_Pipeline_Gap_
Analysis_2026-08-24.xlsx, comparing QC's 134-spool project-wise
report against the pipeline's actual current-status logic - 54
spools showing Accept/Hold-stale in the pipeline that QC's report
says otherwise (49 RT-reinspection + 5 stale Hold), 1 spool entirely
missing from Production_Rework_Data.xlsx (Drawing
1-V17565-PIND-0093, Spool -02 - checked directly, not a matching
issue), 79 already consistent. The person should get QC's Production
Rework Data entry going forward to use "Re insp due to RT" literally
so this fix picks it up; the 54-spool "Gap - Shows Accept" sheet is
the list to have QC correct.

### 2026-08-26 - Material/Hold Status (Weekly Production Planning column BJ) now tracked; new "Hold & MNA by Project" chart

Given by the person, who spotted this himself ("Didn't you map Column
BJ 'Material/Hold Status'?"): the Weekly Production Planning
workbook's Master Planning Sheet has its own Hold/MNA (Material Not
Available) flag column that the pipeline never read at all - a
SEPARATE signal from the Rework Data workbook's Hold status, since a
spool can be Production-flagged Hold/MNA here without ever appearing
in the Rework workbook (this reflects material/scheduling status,
not QC inspection status). Raw values: "1. Confirm from Production"
(default/normal, 5,861 of 5,971 rows in his 2026-08-26 upload), "2.
MNA Spool" (37), "3. Hold Spool" (73). Also noticed a second, mostly
non-overlapping "Hold" Yes/No column (AT) in the same sheet (8 Yes) -
flagged as an FYI only, not acted on.

Added:
- config/column_mapping.json: raw header "Material/Hold Status" ->
  "Material Hold Status Raw"
- src/constants.py: MATERIAL_HOLD_STATUS_RAW / MATERIAL_HOLD_STATUS
- src/merge.py: apply_material_hold_status() normalizes the raw text
  to "Hold" / "MNA" / None, wired into MergeEngine.merge() right
  after the planning-sheet merge; new column added to the
  planning_columns whitelist
- src/summary.py: added to generate_master_spools()'s optional-field
  list (master_spools.json), and a new material_hold_by_project
  aggregation ({project: {"Hold": n, "MNA": n}}) in
  generate_dashboard_summary()
- website/js/tables.js + website/dashboard.html: new "Material Hold
  Status" column on the All Spools table (Hold in the critical-red
  age-chip style, MNA in warn-amber, matching existing color
  conventions)
- website/js/materialHold.js (new) + website/dashboard.html +
  website/js/app.js: new "Hold & MNA by Project" stacked-bar chart,
  placed directly below the Project S-Curve chart per the person's
  request - Projects dashboard only (he didn't ask for this on
  Production)

Tests: tests/test_material_hold_status.py (6, the normalization
logic), tests/test_material_hold_by_project.py (3, the chart
aggregation) - 9 new, all passing. Full suite: 181 passing (up from
172), same 23 pre-existing unrelated failures as every prior
session.

Not yet done: a mechanism to subtract MNA/Hold ageing days from
Production's ageing calculations (src/production/ageing.py) - the
person asked to be walked through the design options before this
gets built; see the conversation for that discussion, nothing
implemented yet.

### 2026-08-26 (later same day) - Remarks column removed, Material Hold Status filter added

Given by the person: "please add a filter option of Material Hold
Status column in the List... You can also remove the column named
Remarks from this list as it doesn't hold any importance."

website/dashboard.html + website/js/tables.js:
- Removed the "Remarks" column entirely from the All Spools table
  (both the <th> header and its DataTables column definition) -
  every column index after it shifted down by 1 accordingly (sort-by
  dropdown options, Material Hold Status's filter column index).
- Added a new "Material Hold Status" multi-select filter dropdown to
  the filter bar (same pattern as the existing Group/Material/Stage
  filters), wired to column index 20 (where Material Hold Status
  landed after Remarks's removal).
- Search placeholder text updated to drop the now-gone "remarks"
  mention.

Verified header count (21) matches column definition count (21)
exactly via a real HTML parser + regex extraction, both before and
after the edit - not just eyeballed.

Separately investigated why the person reported the Material Hold
Status column showing blank and the new chart not rendering: re-ran
the actual merge code (apply_material_hold_status(), same code
delivered earlier today) against his real uploaded Weekly Production
Planning file end-to-end in isolation - it correctly normalizes
flagged spools to Hold/MNA. Concluded the live dashboard he's
looking at most likely hasn't been regenerated with today's code yet
(the old bundle simply has no Material Hold Status / 
material_hold_by_project data to show) - asked him to confirm he's
redeployed AND re-run the pipeline since receiving today's earlier
zip.

### 2026-08-26 (later still) - Fixed: Hold & MNA chart bars rendering solid black

The person sent a screenshot: both Hold and MNA bars on the new
"Hold & MNA by Project" chart rendered solid black instead of
red/amber (chart WAS otherwise working correctly - confirms the
redeploy/rerun did happen and the underlying data was fine).

Root cause: website/js/materialHold.js set Chart.js's
backgroundColor to a raw CSS custom-property string
("var(--status-critical, #dc3545)"). That works fine for normal DOM/
CSS properties, but Chart.js draws onto an HTML5 Canvas 2D context,
and canvas fillStyle can't resolve var(...) - the browser silently
rejects the assignment and canvas keeps its default fillStyle
(black). No other file in this codebase passes a raw CSS var()
string to Chart.js for exactly this reason - every other chart uses
a literal resolved color.

Fixed: replaced with the literal hex values matching
website/css/styles.css's actual --status-critical (#A82E30) /
--status-warning (#B87A12) custom properties, so the chart now uses
the same visual palette as the rest of the dashboard (age chips,
KPI cards, the Fabrication Line bottleneck highlight) without
relying on canvas resolving a CSS variable it can't.

File changed: website/js/materialHold.js only.

### 2026-08-26 (later still x2) - Projects dashboard JS files weren't cache-busted at all; likely why the color fix didn't show up

The person reported still seeing black bars after uploading the
previous fix. Re-checked materialHold.js itself - the hex-color fix
was correct and consistent with how every other chart on the
dashboard supplies colors (chartTheme.js's spoolGradientBars plugin
turns a flat hex per dataset into a gradient automatically; nothing
about the fix should have failed to render).

Found the real explanation while comparing against production.html:
that dashboard's <script> tags already carry a "?v=YYYYMMDD" cache-
busting query param on every JS file (established some session
before this one) - but website/dashboard.html (Projects) had NONE
at all. A browser has no reason to re-fetch a same-URL <script src>
after a page reload, so his browser most likely kept serving the
OLD, cached materialHold.js (with the broken var(--...) color)
indefinitely, regardless of how many times the file was replaced on
GitHub - explaining why the fix "didn't take" even though nothing
was actually wrong with it.

Fixed: added "?v=20260826" to every JS <script> tag in
website/dashboard.html (matching production.html's existing
convention exactly - vendor/ scripts and user-menu.js left
unversioned, same as Production). This should force every browser
to fetch the current files immediately, for materialHold.js and
every other Projects-dashboard JS file. Going forward, this date
should be bumped on any Projects dashboard JS file's script tag
whenever that file changes (same discipline Production's dashboard
already follows) - CHANGELOG entries for JS-file changes should
call this out explicitly so it isn't missed.

File changed: website/dashboard.html only (script tag query params).

### 2026-08-26 (later still x3) - Material/Hold Status ageing reduction: Week Planned vs Initial Week Planned gap

Given by the person, in his own words: "in the Weekly Production
Planning file, there is a column CB 'Initial Week Planned' and there
is a column BT 'Week Planned'. What I do is first I keep both the
columns same when adding the spool for the first time... Now if a
spool comes under MNA/Hold category and it gets cleared after some
days/weeks, I change only column BT while keeping column CB
unchanged... if initial week is Week 10 and changed week is Week 12,
then there is a gap of 14 days (or 10 working days). You can reduce
the ageing days using this method. In case if subtraction results in
negative, make it zero."

Verified his week numbering matches the fiscal week system already
built into this repo (52-week cycle anchored 30th March -
utils.fiscal_week_info()) with a 100% match rate cross-checked
against his real uploaded Weekly Production Planning file's actual
Planned Start dates - so week numbers convert to real calendar dates
reliably, and from there to a working-day gap using the same
holiday-aware calculator (utils.working_day_variance(), config/
holidays.json) every other ageing figure in this app already uses -
not a flat 5-days-per-week guess. Flagged to him that this makes his
own hand-worked example (14 calendar days -> 10 working days)
resolve to 9 in practice, since June 3rd 2026 is a configured
company holiday inside that specific date range - more accurate, not
a bug.

Added:
- src/utils.py: week_number_to_start_date() (inverse of
  fiscal_week_info()) and material_hold_working_days_lost() - the
  single shared implementation of the whole calculation, used by
  BOTH dashboards so a given week gap means the same number of days
  lost either way.
- config/column_mapping.json: raw header "Initial Week Planned"
  mapped explicitly (identity mapping, for resilience to minor
  header text variation).
- src/constants.py: INITIAL_WEEK_PLANNED, MATERIAL_HOLD_WORKING_
  DAYS_LOST.
- src/merge.py: apply_material_hold_ageing_reduction() (Projects
  pipeline) - computes the per-spool figure, wired into
  MergeEngine.merge() right after apply_material_hold_status().
- src/production/ageing.py: build_spool_records() builds its own
  material-hold-days-lost lookup directly from master_planning_df
  (Production's pipeline never goes through MergeEngine.merge() at
  all, so the Projects-side fix alone would not have reached
  Production ageing) - subtracted from current_age_days only
  (floored at 0, per his explicit instruction), NOT from individual
  stage_actual_days entries, since this is a single flat number with
  no real start/end dates behind it (unlike the Rework Hold ledger),
  so it can't be attributed to one specific stage the way a real
  dated Hold period can - flagged as a known limitation. New
  material_hold_days_lost field added to SpoolRecord for visibility.

Scope, per his own original wording ("reduce ageing days... from
Production ageing"): Production dashboard only - Projects' Total Age
is untouched by this feature.

Tests: tests/test_material_hold_ageing_reduction.py (5, the merge.py
side), tests/test_production_material_hold_ageing.py (4, the
Production side, including the floor-at-zero case and a missing-
columns safe no-op) - 9 new, all passing. Full suite: 190 passing (up
from 181), same ~23 pre-existing date-dependent failures as every
prior session - reconfirmed via a fresh side-by-side run against an
untouched copy of the repo, which now happens to fail a different
ROTATING subset of tests (test_ageing.py's Total Age/Stage Age tests
this time, not the previous session's test_summary.py set) since
real time has moved on since this repo was last touched - same
underlying flakiness (hardcoded "N calendar days ago = N working
days" assumptions), not a new issue.

### 2026-08-26 (later still x4) - Two new columns on Projects list: Total/Stage Age (excl. Hold Period)

Given by the person: "in the list in Projects page, lets add 2 more
column showing Total Age (excl Hold Period) & Stage age (excl. Hold
Period)... 1st will be Total Age (current existing column), 2nd will
be Total age (excl. Hold Period), 3rd will be Stage age (current
existing column), 4th will be Stage age (excl Hold Period)". When
asked which Hold source these should subtract, he chose: only the
Material/Hold Status Week-gap figure (Week Planned vs Initial Week
Planned - 2026-08-26 earlier today), explicitly NOT the Rework Data
workbook's Hold ledger.

Since he wanted Total Age listed before Stage Age (they were the
other way round before), this also REORDERED the two existing
columns, not just inserted two new ones - every column index after
that point on the All Spools table shifted, so every index-dependent
reference needed updating: the default sort ([[10,"desc"]] ->
[[9,"desc"]]), the Stage/Total Age numeric range filters
(AGE_COLUMNS), the Planning/Status dropdown filters, the Material
Hold Status filter added earlier today, and every "Sort by" dropdown
option after Stage Age - plus two new sort options added for the new
columns themselves. Verified the final 23-header/23-column table
lines up exactly via a real HTML parser (not just eyeballed),
matching the same verification method used for every column-index
change this session.

Added:
- src/constants.py: TOTAL_AGE_EXCL_HOLD, STAGE_AGE_EXCL_HOLD
- src/ageing.py: AgeingEngine._exclude_material_hold_days() -
  subtracts MATERIAL_HOLD_WORKING_DAYS_LOST (the same per-spool
  figure already computed by merge.py -> apply_material_hold_
  ageing_reduction(), which already runs as part of the Projects
  pipeline) from both Total Age and Stage Age, floored at 0. Same
  known limitation as the Production-side version: a single flat
  number, not attributable to one specific stage the way a real
  dated Hold period is.
- src/summary.py: both new fields added to generate_master_spools()'s
  optional-field list (master_spools.json)
- website/js/tables.js + website/dashboard.html: reordered/added
  columns, updated every index-dependent reference listed above;
  tables.js's cache-busting version bumped to ?v=20260826b

Tests: tests/test_ageing_material_hold_exclusion.py (6, including
the apply()-level end-to-end check). Full suite: 196 passing (up
from 190), same ~23 pre-existing date-dependent failures as every
prior session.

Per his instruction to include the previous chat's change in this
same delivery: this zip also contains everything from the earlier
2026-08-26 ageing-reduction delivery (src/utils.py, src/merge.py,
config/column_mapping.json, src/production/ageing.py and their
tests) so this is a complete, standalone package.

### 2026-08-26 (later still x5) - Quality dashboard: Rework Rate Over Time now starts at Week 1, fiscal week numbering

Investigated a screenshot the person sent of this chart showing a
long flat 0% stretch (Sept 2025 - mid March 2026) before jumping to
16%+ - verified directly against his real Rework Data workbook that
this is genuine, not a bug: every one of the 1,562 offer events in
that period has Final Status Accept, zero Rework, full stop. Real
reworks only start appearing mid-March 2026 onward.

Separately found (not yet fixed - flagged to him, no decision yet):
src/quality/summary.py's own status classifier (_normalize_status())
is an independent, much simpler duplicate of rework_pdqc_rule.py's
_STATUS_MAP - only recognizes exact "ACCEPT"/"REWORK" text, so every
other real Final Status value in the workbook ("Project hold",
"Query", "Re insp due to RT", "Not Found", "REWORK/SAME RW", "SPOOL
DELETED") falls into a generic "Other" bucket that's counted in every
rate's denominator but never the numerator - quietly diluting every
rate on the Quality dashboard, not just this chart.

What WAS changed, per his request ("Better to show chart from Week 1
onwards", confirmed to mean the SAME fiscal week system already used
for "Week Planned" elsewhere - utils.fiscal_week_info(), a 52-week
cycle anchored 30th March each year): the chart's "week" granularity
now only covers the CURRENT fiscal cycle (from its own Week 1
onward, dropping the empty tail-end of the previous cycle entirely)
and labels periods "Week 1", "Week 2", etc. instead of calendar
dates. Deliberately NOT just a label rename - the old "Monday of that
ISO calendar week" grouping is a different, unrelated week concept
from the fiscal one used everywhere else "Week" appears in this app,
and simply relabeling it would have made week numbers look like they
reset partway through the chart the moment it crossed 30th March.
"day" and "month" granularities are unchanged - full history,
calendar dates, same as before.

File changed: src/quality/summary.py (build_rework_trend(),
_period_labels()) only - no frontend change needed, since
website/js/quality-charts.js's chart already uses plain category
labels (not date-parsed), so relabeling "period" values was
sufficient.

Tests: tests/test_quality_rework_trend.py (5, including one
specifically checking week numbers sort numerically - "Week 10"
after "Week 2" - not alphabetically). Full suite: 201 passing (up
from 196), same ~23 pre-existing date-dependent failures.

Open item for the person: whether to fix the Quality dashboard's
separate, cruder status classifier (affects every rate on that
dashboard, not just this chart) - not done this session, needs his
go-ahead first.

### 2026-08-27 - Fixed: fiscal Week 1 anchor was hardcoded to 30th March every year - it actually moves

The person corrected an assumption made throughout this week's
Material/Hold Status work: "Week 1 is not anchored to 30th March
every year. It will change every year." The real rule, in his own
words: "it depends 1st April lies on which day in a week. In this
year it was on Wednesday so we considered 30th March (Monday of
that week) as Week 1. Next year 1st April will lie on Thursday so we
want to keep it part of Week 53 only and new Week 1 (FY28) will
start from next Monday i.e. 5th April." Confirmed with him precisely
before building: if 1st April falls Mon/Tue/Wed, Week 1 starts the
Monday of that same week; if it falls Thu/Fri/Sat/Sun, that week
stays the tail of the PREVIOUS fiscal year and Week 1 starts the
following Monday instead.

src/utils.py previously had FISCAL_WEEK_ANCHOR_MONTH=3 / _DAY=30 as
fixed constants, used by both fiscal_week_info() and week_number_
to_start_date() - correct for FY26/27's current cycle (which
genuinely starts 30 March 2026) but would have silently produced
wrong week numbers starting FY28 (5 April 2027), affecting
everywhere "Week" is used: the Material/Hold Status ageing reduction
(src/merge.py, src/production/ageing.py), the two Projects "excl.
Hold Period" columns (src/ageing.py), and the Quality dashboard's
Rework Rate "week" granularity (src/quality/summary.py) added
yesterday.

Fixed: replaced the fixed constants with _fiscal_week1_start(year), a
proper implementation of the person's rule (1st April's weekday
determines whether that week's Monday or the following one is
Week 1). fiscal_week_info() and week_number_to_start_date() now call
this instead of a hardcoded date - no other file needed changes,
since every consumer already goes through these two functions.

Tests: tests/test_fiscal_week_anchor.py (7 - both his worked
examples, both boundary cases of the rule - Monday and Saturday for
1st April - and confirming week_number_to_start_date() picks the
correct year's anchor). Full suite: 208 passing (up from 201), same
23 pre-existing unrelated failures - confirmed today's real dates
(FY26, anchored 30 March 2026) are completely unaffected by this
fix, so nothing computed this week needs to be redone.

### 2026-09-02 - Overview section (Quality dashboard) now sourced from a new Inspection Data workbook, not Rework Data

Asked to bring in a new recurring QC export - "INSPECTION DATA ... .xlsx" (filename varies, always starts with "INSPECTION DATA"), QC's own continuous PDQC log going back to 2023, first-time status only per offer. Explicit instructions: check whether every sheet but the first (summary) sheet shares one header; combine the data sheets into one; build a rework count summary matching his screenshot of the dashboard's existing Overview section (KPI cards + First Offer Outcome / Rework by Project / Rework Rate Over Time / Rework Cycles per Spool). Repeated twice, unprompted: this must never touch the PDQC/RFP Absolute Rules or any other rework calculation criteria - display only.

Investigation before writing any code, since his screenshot turned out to BE the dashboard's current live Overview section (build_kpis/build_first_offer_split/build_rework_by_project/build_rework_trend/build_rework_cycles in src/quality/summary.py), currently sourced from the Rework Data workbook. Confirmed with him directly: replace that data source for those 5 widgets specifically (not add a parallel section) - Rework Data stays exactly as-is for everything else (top_rework_types, the Rework Data export, Welder Performance).

Real-file findings that shaped the design (his real Aug-2026 export inspected directly, 71,700 rows, 160 sheets):

- His "except the first sheet" assumption doesn't quite hold: 159 of 160 sheets are weekly data, but a SECOND hand-built summary/tally sheet ("Sheet1", same shape as the intended first one) is buried at position 112, not first. Neither can be trusted by position or name - see design below.
- Headers are NOT identical: 140 of 159 data sheets share one standard 9-column shape; 19 older (2023) sheets vary (some add "Inch Dia", some also add "Type" and reorder "Prod Eng", 4 are missing "Prod Eng" entirely).
- "Final Status" is free text - the word "Accept", or (in ~9% of rows) the specific rework/defect-type reason itself (e.g. "Bend", "Not Found", "Punching") rather than a generic "Rework" label - not a small controlled vocabulary like the Rework Data workbook's status column.
- The file's real date range (2023-2026) is far wider than its filename ("29 MAY TO 28 AUGUST 2026") suggests.
- ~1,000 "Prod. Offer" cells hold the same multi-date-in-one-cell pattern the Rework Data workbook has (e.g. "17-08-2026/20-08-2026/21-08-2026") - confirmed this misparses into a bogus, non-physical tz offset if handed to the date parser unresolved, breaking every sort/compare on the column.

Confirmed 4 decisions with him before building, each because a wrong default would have materially changed the live numbers: (1) "Hold" status -> the Overview's existing "Other" bucket, everything else non-Accept -> Rework; (2) first-offer-only for the outcome/repeat-offender metrics, every offer event for the rate/trend/by-project metrics; (3) full file history always (checked: a strict FY26/27-only cutoff would have shown TJ/25-26/172 as 0 rows and TJ/25-26/184 as 6, both effectively invisible, since their inspection activity had already wound down before 30 March 2026); (4) harmonize the 19 older sheets down to the standard schema, dropping Inch Dia/Type, blank Prod Engineer where genuinely absent.

Design (content-based, same philosophy as the 2026-08-16 Line History sheet-detection fix, extended here to combine ALL matching sheets rather than picking one "best" sheet):

- config/settings.json + config/column_mapping.json: new input_files.inspection_data entry (data/upload/quality/, file_pattern "*INSPECTION*DATA*.xlsx") and "inspection_data" column mapping section.
- src/constants.py: INSPECTION_DATA (standardize_key) + INSPECTION_DATA_COLUMNS (the fixed 9-column harmonized shape).
- reader.py -> read_inspection_data(): opens each matching file ONCE (pd.ExcelFile, reused across all its sheets - a naive per-sheet pd.read_excel() re-opens/re-parses the whole workbook every time, which against a ~150-sheet file took over 2 minutes; reusing the already-parsed ExcelFile brought that under 25 seconds), scans every sheet's header, and combines every sheet whose standardized columns contain the full required set - a summary/tally sheet never has those columns, so both "Sheet2" and the buried "Sheet1" are skipped automatically regardless of name or position. resolve_multi_date_text_cells() (already existed for the Rework Data workbook's identical pattern) runs before convert_excel_serial_dates() to resolve the multi-date cells correctly. Optional/best-effort, same contract as every other Quality source - a missing file only empties the Overview section, nothing else.
- src/quality/summary.py: new _normalize_inspection_status()/_with_inspection_status() (Accept/Hold-as-Other/Rework, deliberately NOT reusing rework_pdqc_rule.normalize_rework_status() - a different workbook with ~150 free-text values would misfire that function's "unrecognized status" warning on nearly every rework row). build_kpis/build_first_offer_split/build_rework_by_project/build_rework_trend/build_rework_cycles switched to read from this instead of the Rework Data workbook's "Packing Release Date" column; build_top_rework_types and the two monthly export functions are untouched, still on the original _with_status()/rework_pdqc_rule path.
- src/quality/reader.py + pipeline.py: QualitySources gains inspection_data (optional); a missing/unsynced file falls back to an empty, correctly-shaped dataframe rather than crashing the pipeline, same as any other optional source having nothing to show yet.
- Website: zero changes - the JSON bundle's keys/shape (kpis, first_offer_split, rework_by_project, rework_trend, rework_cycles) are unchanged, only what feeds them.

Verified end-to-end against his real Aug-2026 file (71,691 rows after exact-duplicate removal, 158 of 160 sheets matched): Overview KPIs (71,245 spools, 9.1% overall rework rate, 121 spools needing 2+ rework, coverage 2023-01-01 to 2026-08-28 - the 2023-01-01 floor is 5 genuinely present placeholder-dated rows in the source file under one old project, left as-is rather than guessed at, consistent with how this codebase always surfaces a data question rather than silently fixing it), First Offer Split, Rework by Project (spot-checked all 7 of his named active project codes - each now shows real, sensible numbers under full-history scope, confirming the FY-cutoff concern was justified), and both Rework Rate Over Time granularities all computed correctly. `TE/25-26/196` (one of his 8 named codes) does not appear anywhere in this file under that exact code - flagged for him to check for a typo or confirm it simply hasn't been offered yet.

Tests: tests/test_inspection_data_reader.py (5 - summary-sheet exclusion regardless of position, schema harmonization, multi-date resolution, missing/disabled-file handling) and tests/test_inspection_data_status.py (18 - status classification per his exact rule, and the 4 Overview functions against a small synthetic dataset with a first-offer-vs-eventual-outcome case). Full suite: 222 passing (up from 199), same 32 pre-existing date-dependent failures as before this session, none of them in anything this session touched.

Not verified against a real production run of quality_main.py this session (no real Rework Data workbook available in this environment, which load_sources() still requires) - recommended he sync the real Inspection Data file into the Drive Quality folder and let the next scheduled drive-sync run confirm the published Overview section end-to-end.

### 2026-09-02 (cont'd) - Inspection Data: multi-date offer + literal "Accept" now counts as Rework

The person asked directly, after the Overview switch-over above went live: "what are you doing with spools which has 03-08-2026/07-08-2026 dates?" - a fair question, since a "/"-separated multi-date Prod Offer cell (a re-offer typed into the same cell instead of a new row, same pattern as the Rework Data workbook) had only ever had its DATE resolved (to the latest piece); the row's single Final Status was always taken at face value. Checked his exact example directly: Final Status "Dimension" - correctly already counted as 1 rework event. But checking the pattern more broadly turned up a real gap: of 956 multi-date cells in his real file, 262 have Final Status literally "Accept" - e.g. dates "17-08/20-08/21-08-2026", Insp Remark "tag/punching balance, SS tag required", Final Status "Accept". The remark makes clear a real deficiency existed and was corrected before acceptance; the single "Accept" status alone hid that entirely, silently undercounting rework - always in the direction of looking cleaner than reality (zero multi-date+Hold rows exist, so there was no equivalent risk the other way).

Confirmed with him (his choice, the recommended option): a row with a multi-date offer AND literal Final Status "Accept" now counts as Rework, dated at its EARLIEST offer date (when the deficiency was first found) rather than the latest (which every OTHER multi-date cell still uses, unchanged - that's the existing, already-confirmed 2026-08-10 convention for cells where the final status already reflects the real outcome).

reader.py -> read_inspection_data(): new INSPECTION_REOFFERED_BEFORE_ACCEPT flag (src/constants.py), computed BEFORE the existing multi-date resolution step so the raw multi-date text is still available; flagged rows get their Prod Offer Date resolved to the earliest piece instead of the latest. src/quality/summary.py -> _with_inspection_status(): a flagged row's `_status` is forced to "Rework" regardless of its literal Final Status - applies automatically to every Overview function (build_kpis, build_first_offer_split, build_rework_by_project, build_rework_trend, build_rework_cycles), no per-function changes needed.

Real-file impact (261 rows after exact-duplicate removal, of the file's 71,690 total): rework_events 6,543 -> 6,804, overall_rework_rate_pct 9.1% -> 9.5%, spools_needing_2plus_rework 121 -> 150, needed_rework (first-offer split) 6,386 -> 6,614.

Tests: tests/test_inspection_data_reader.py gains test_reoffered_before_accept_flagged_and_dated_earliest (flag + earliest-date behavior, alongside the existing plain-Accept and multi-date-latest-wins cases) and test_columns_harmonized_to_standard_schema updated for the new column. tests/test_inspection_data_status.py gains test_reoffered_before_accept_overrides_literal_accept_to_rework and test_with_inspection_status_works_without_the_flag_column (the pipeline's empty-fallback frame, which has no flag column at all, must not crash). Full suite: 225 passing (up from 222), same 32 pre-existing unrelated failures.

### 2026-09-02 (cont'd) - convert_excel_serial_dates() no longer crashes the whole pipeline on one bad cell

Manually triggering "Sync from Google Drive" (Run 705, to confirm the reoffer-before-accept fix above went live) surfaced an unrelated failure: "Run the Production dashboard pipeline" finished in 3s instead of its usual ~55s, with an annotation "Process completed with exit code 1." Traceback: reader.py -> read_fabrication() -> utils.py -> convert_excel_serial_dates() -> pandas' pd.to_datetime(unit="D") -> deep inside numpy's internal unit-conversion arithmetic -> FloatingPointError: overflow encountered in multiply. continue-on-error: true on that step kept it from blocking the Projects/Quality pipelines or the commit/push step, but the Production dashboard itself didn't refresh that run. Confirmed this is a NEW, intermittent failure - Run 704 (~20 minutes earlier, otherwise the same setup) completed that same step cleanly in 55s.

The person asked to look into it. Root cause: convert_excel_serial_dates()'s errors="coerce" only catches ordinary per-value parsing failures (an unparseable string, an out-of-range-but-representable number) - it can't catch a genuine overflow trap raised from inside numpy's own C code partway through converting the WHOLE column at once. Couldn't reproduce the exact trigger locally (Windows, same pinned numpy==2.3.1/pandas==2.3.1 versions as requirements.txt) even with deliberately extreme values (1e300, inf, values pushed through np.errstate(over="raise")) - this looks like a platform-dependent floating-point trap difference between the Windows wheel used for local testing and the Linux (ubuntu-latest) GitHub Actions runner, not a version mismatch. Given the exact bad DPR cell value couldn't be pinned down or reproduced, the fix targets the FAILURE MODE generically rather than a specific value.

utils.py -> convert_excel_serial_dates(): the vectorized pd.to_datetime(unit="D") call is now wrapped in try/except (OverflowError, FloatingPointError, ValueError) - on failure, logs a warning naming the column and falls back to a new _safe_serial_to_datetime(), which converts the column one value at a time inside np.errstate(all="ignore") (suppressing the same class of trap for the fallback path too), catching the same exception set (plus pandas.errors.OutOfBoundsDatetime) per value and returning NaT for whichever cell(s) are actually bad. Every other, non-flaky cell in the column still converts to its real date - only the genuinely corrupted one(s) go blank, same graceful-degradation contract errors="coerce" was always supposed to provide.

This is a shared utility used by every reader that has a .xlsb date column (Fabrication, Planning, Line History, SIOP Planned) - fixed once here rather than in read_fabrication() specifically, so any of them are protected the same way if it recurs.

Tests: new tests/test_convert_excel_serial_dates_overflow.py (3) - since the real trigger doesn't reproduce locally, these fake the failure by monkeypatching pd.to_datetime to raise FloatingPointError (matching the real traceback) on the vectorized call, confirming: good values in the column still convert correctly via the fallback; an inf value (a textbook overflow trigger) becomes NaT instead of propagating; and the ordinary no-monkeypatching path is completely unaffected. Full suite: 228 passing (up from 225), same 32 pre-existing unrelated failures.

Not verified against the actual bad DPR cell (its exact value/location is still unknown - the fix is defensive by design, not a diagnosis of that specific cell). Recommended: watch the next few scheduled Production dashboard pipeline runs; if this class of error recurs, the new warning log will name the exact column, which narrows down which DPR field to inspect by hand.

### 2026-09-02 (cont'd) - Fixed: Overview was using full history for every project, not just the named ones

The person caught a real mistake in the 2026-09-02 Overview switch-over above, asking directly: "I asked you to only work on sheets that were 30 March 2026 to till today, however, I gave you a list of some projects whose data was to be taken even from previous sheets. But I think you have considered every sheet from this excel. Am I right?" - correct. His actual instruction (given while working through the "Coverage window" question that session) was: current fiscal cycle only (30 March 2026 onward) by default, EXCEPT the 8 named projects (TJ/25-26/172, 184, 182, 183, 188, 189, 206, TE/25-26/196), which should reach back into older sheets too. That session's follow-up question ("full history vs. strict cutoff") was framed for the WHOLE file rather than per-project, and "full history" was applied everywhere as a result - correct for the 8 named projects, wrong for the other ~150 project codes in the file, whose entire multi-year history was being counted every run instead of just their current-cycle activity.

src/quality/summary.py: new NAMED_PROJECT_CODES_WITH_FULL_HISTORY (the 8 codes) and scope_inspection_data_to_current_cycle() - keeps a row if its Prod Offer Date is on/after the current fiscal cycle's Week 1 (reusing utils.fiscal_week_info()/week_number_to_start_date() - the same rolling anchor already used elsewhere, confirmed with the person: rolls forward to 5 April 2027 for FY27/28 on its own, never needs a manual date bump) OR its Project Code is in the named list (any date, including an unparseable one). pipeline.py calls this once, right after the empty-fallback dataframe is built, before any of the 5 Overview functions run - they're unaware anything changed.

Real-file impact (recomputed against his file): total_spools 71,245 -> 7,948, total_offer_events 71,690 -> 7,953, rework_events 6,804 -> 755, spools_needing_2plus_rework 150 -> 1, date_range_start 2023-01-01 -> 2025-08-21 (TJ/25-26/172's earliest date, the oldest of the 8 named projects' history). overall_rework_rate_pct happens to still round to 9.5% - coincidence, not a sign the scope change didn't matter. Checked directly: every single row in the entire 71,690-row file dated on/after 30 March 2026 already belongs to one of the 8 named projects - no other project has had any inspection activity in the current cycle at all, so this scope change doesn't silently exclude any other currently-active project; it only removes ~150 other, already-inactive project codes' old history from counting toward the Overview.

Tests: new tests/test_inspection_data_scope.py (7) - non-named project before/at cycle start, named project before cycle start (and with an unparseable date), a mixed dataframe, and the empty-dataframe passthrough. Uses the real rolling fiscal-cycle start (not a hardcoded date) so these keep passing after the cycle rolls over. Full suite: 235 passing (up from 228), same 32 pre-existing unrelated failures.

### 2026-09-03 - Top 10 Rework Types chart also switched to Inspection Data, with real defect-type categorization

Worked through this in chat first (per the person: "Show me summary here, then we decide whether to move it to Repo or not") before touching any code. Asked directly: "Do you see the Top 10 rework chart in Quality section of this repo?" - confirmed yes, build_top_rework_types() (still Rework Data workbook's "Rework Type" column at that point) - then: "Yes, replace it."

Computed by hand first: Inspection Data's Final Status is far messier for this purpose than the Rework Data workbook's "Rework Type" column - 105 distinct raw values in the person's real (cycle-scoped) file, e.g. "MSN TAG BAL" / "TAG BALANCE" / "TAG WRONG" / "MSN TAG BALANCE" all really meaning the same "Tag" defect. Per the person ("use your knowledge to categorize them"): consolidated obvious spelling/wording variants of the same defect into one category, but deliberately did NOT merge "Degree" into "Orientation" - the shop's own Sheet2 tally inside the Inspection Data workbook already treats them as two distinct categories, and nothing here should second-guess the shop floor's own convention. Also had to decide what to do with the 15 (of 755) rows flagged Reoffered Before Accept (2026-09-02, literal Final Status "Accept", no real defect word) - keyword-matched their Insp Remark text instead (e.g. "tag/punching balance, SS tag required" -> Tag, "nozzle height required..." -> Dimension), same approach the person confirmed by picking it directly when asked.

src/quality/summary.py: new INSPECTION_DEFECT_TYPE_CATEGORIES (105-entry exact-value map, chosen over keyword-matching here since exact values are unambiguous and keyword matching would risk false-positive collisions - e.g. "PUNCH BAL" containing "bal") and INSPECTION_REMARK_DEFECT_KEYWORDS (ordered keyword list for the Reoffered-Before-Accept fallback only - "direction"/"orientation" checked before the generic "handwheel" keyword so a remark like "Handwheel in +X direction but need +Y" lands under Orientation, not a generic bucket, while a bare "Handwheel not available" still falls through correctly). New _classify_inspection_defect_type() dispatches between the two. build_top_rework_types() rewritten to use these against the Inspection Data workbook (via _with_inspection_status(), same as the other 5 functions) instead of the Rework Data workbook - same output shape (top N + "Others" fold-in), so no website changes needed. A row that matches neither map (a genuinely new defect wording, or an unhelpful remark like "Satisfactory") falls into "Unclassified" and gets logged with a sample of the unmapped Final Status values, so new wording can be added to the map later - same diagnosability convention as REWORK_TYPE_CATEGORIES elsewhere in this file. pipeline.py: top_rework_types now built from the same scoped inspection_data dataframe as everything else, not sources.rework.

Real-file result (current-cycle + 8 named projects, 755 total rework events - matches the Overview's rework_events count exactly, a useful cross-check): Dimension 157 (20.8%), Bend 122 (16.2%), Degree 81 (10.7%), Bevel 78 (10.3%), Punching 54 (7.2%), Welding 42 (5.6%), Tag 28 (3.7%), Orientation 25 (3.3%), Hold/Query 21 (2.8%), Inside Cleaning 16 (2.1%), Others 131 (17.4% - 20 smaller categories, each under 2%, plus 7 genuinely unclassified rows). Verified the code's output against the by-hand computation shown to the person in chat - exact match on every category and count.

Tests: new tests/test_inspection_data_top_rework_types.py (32) - _classify_inspection_defect_type() against representative Final Status values (including an unrecognized one -> Unclassified) and all the real remark examples from the person's file (including both "Satisfactory" rows, which correctly land in Unclassified), plus build_top_rework_types() end-to-end (ranking, Others fold-in, Accept/Hold exclusion, Reoffered-Before-Accept inclusion, empty input). Full suite: 268 passing (up from 235), same ~31 pre-existing unrelated failures (one fewer than last count - date-boundary flakiness, not a regression; confirmed by comparing the failure list file-by-file, none of them touch anything this session changed).

### 2026-09-03 (cont'd) - Top 10 Rework Types: show the % on the bar itself, not just on hover

The person checked the live chart, confirmed the new categorization looked right, then asked for one more thing: "show % as well in brackets for e.g. Dimension line to show 157 (20.8%)" - the bar's permanent on-chart label, not just its hover tooltip (which already showed the % - see the 2026-09-02 Overview entry).

website/js/quality-charts.js -> renderTopReworkTypes(): every bar chart on this dashboard already gets a data label at the end of each bar via chartjs-plugin-datalabels (global default in chartTheme.js, 2026-08-13/14) - it was just showing the plain count. Added a per-chart plugins.datalabels.formatter override here (Chart.js merges per-chart plugin options into the type-level defaults rather than replacing them, so only formatter changes - color/font/anchor/align/clip all still come from chartTheme.js untouched) producing "157 (20.8%)" instead of "157".

Verified in a browser rather than by reading the diff - no JS test framework exists in this repo, frontend changes are checked by hand here, same as every other website-only change in this file's history. Built a minimal standalone harness (Chart.js + the plugin + the real chartTheme.js/quality-charts.js, fed the real 755-row categorized data, calling renderTopReworkTypes() directly - no server/auth needed, quality.html itself has a Firebase auth-guard redirect that makes testing the full page locally impractical) rather than trying to run the live site locally. Caught a real (if minor) side effect this way that a code read alone would have missed: the longer "(pct%)" text pushed the label for the single LONGEST bar (Dimension, closest to the x-axis's own auto-computed max) past the canvas's right edge, invisible despite plugins.datalabels.clip:false (that only prevents chart-AREA clipping, not the canvas's own hard boundary) - every other bar had enough headroom and rendered fine immediately. Fixed with layout.padding.right: 64 on this chart specifically (confirmed 157 (20.8%) - now the widest label on the chart - renders in full with room to spare; not applied globally, since no other bar chart on this dashboard has labels this long).

No Python changes, no new tests (nothing in src/ changed) - just this file and quality.html's cache-busting query string bump (?v=20260903, chartTheme.js's own 2026-08-16 established convention for exactly this reason: a browser has no reason to re-fetch a same-URL <script src> after a reload).
