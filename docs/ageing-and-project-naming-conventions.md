# Ageing & Project Naming Conventions (site-wide)

Two display rules, decided 2026-08-08, that apply across every
department dashboard (Projects, Production, Packing & Dispatch,
Quality Assurance/Control) - not just the page where the bug report
that prompted each one happened to show up. This file exists so the
reasoning is in one place instead of scattered across commit
messages; code comments elsewhere in the repo point back here rather
than re-explaining it.

If you're adding a new chart, table, or department dashboard later,
read both sections below before you write it - not just skim past
them because the department is new.

---

## 1. Ageing can never be negative

**Rule:** anywhere a number of days is shown to a person as an
*age* - how long something has taken, how overdue it is, how long a
spool has dwelt in a stage - that number is >= 0. Always. If the
underlying dates would produce a negative value, clamp it to 0
before it reaches a chart, a table cell, or a KPI.

**Why this is even possible:** an "age" is usually computed as
`later_date - earlier_date` in calendar/working days. Real-world
data doesn't always cooperate:

- A milestone got logged out of chronological order (e.g. a PDQC
  date - especially one overridden from the QA/QC rework report,
  see `src/merge.py -> apply_rework_pdqc_override()` - landing
  before the Welding Finish date already on file for the same
  spool).
- A planned/target date is in the future relative to "today".
- Two already-legitimate (non-negative) cumulative day counts get
  subtracted from each other to produce an *individual* stage
  duration, and that subtraction can go negative even though neither
  input was.

That last case is the subtle one and the one that actually shipped a
bug (2026-08-08, Production dashboard's spool table showing "PDQC
(d): -17"): `src/production/summary.py -> _stage_display_days()`
computed each table column as `this_stage_cumulative -
previous_stage_cumulative`. Both cumulative values individually came
from `utils.days_between()`, which already clamps to 0 - but their
*difference* was never separately clamped, so an out-of-order
milestone pair still produced a negative table cell. Fixed by
clamping the subtraction result too, while still tracking the *true*
(unclamped) cumulative value for the next stage's calculation - a
clamp on one stage must not distort the stage after it.

**Where this is already handled correctly - use these as the
reference implementation:**

- `utils.days_between()` - the general-purpose "days between two
  dates, as an age" function. Already clamps to 0. This is what you
  should reach for first; only use the unclamped
  `utils.working_day_variance()` when you deliberately want a signed
  result (see below).
- `src/summary.py -> generate_stage_ageing_summary()` - explicitly
  clips its per-stage dwell times to
  `config/business_rules.json -> ageing.negative_age_value` (0) with
  a documented comment explaining why.
- `src/production/summary.py -> _stage_display_days()` - fixed
  2026-08-08, see above. Also has `tests/test_production_stage_display_days.py`
  covering the exact regression.

**The deliberate exception - do NOT clamp these:** a *variance* or
*delta* is not an age, even though it's also a day count. "5 days
ahead of plan" is meaningful and should stay negative (or whatever
sign convention the chart uses) - clamping it to 0 would silently
turn "ahead of schedule" into "on schedule," which is wrong, not
safer. `utils.working_day_variance()` exists specifically for these
cases and returns a signed value on purpose. Planning Variance
charts, "days ahead/behind" KPIs, and similar deliberately-signed
metrics should keep using it. When in doubt: if the number answers
"how long has this been going / how overdue is this," clamp it. If
it answers "how far off plan is this, in either direction," don't.

`generate_exceptions()` (`src/summary.py`) is a related but separate
case: it's a *diagnostic* report of data-entry anomalies (out-of-
order stage dates), not an ageing metric a person reads as "how old
is this spool." It deliberately keeps the raw signal so the anomaly
is visible - don't clamp it into invisibility.

---

## 2. Project Name leads; Project Code is secondary

**Rule:** wherever a project is identified to a person - a table
column, a chart axis, a tooltip, a filter dropdown, a PDF export row
- lead with the Project Name. If the Project Code is shown at all,
it's secondary: in brackets, and visually smaller/muted where the
surface actually supports that (HTML, canvas-drawn axis labels). Never
show a bare Project Code as the only identifier when a name is
available.

**Why:** project codes (`TJ/25-26/182` etc.) are meaningless to
someone scanning a dashboard who doesn't have every code memorized;
the name is what's actually being asked about. But the code still
matters for anyone cross-referencing against a PO, a drawing
register, or another system - so it doesn't disappear, it just steps
back.

**The two tiers, and which surfaces get which:**

1. **Full treatment - Name prominent, Code smaller/bracketed, both
   genuinely visible at different visual weights.** Use this
   wherever the surface gives you real control over styling:
   - HTML table cells: a `<span class="project-name-cell">` (bold)
     next to a `<span class="project-code-suffix">` (smaller, muted,
     monospace) - see `website/css/styles.css`. Every department's
     spool/project table uses this pattern now
     (`website/js/tables.js`, `production-table.js`,
     `packing-tables.js`).
   - Chart axis labels with few enough categories to lay out
     vertically, one per row (e.g. the Projects dashboard's
     "Days-in-Stage by Project" chart) - see
     `website/js/charts.js -> twoPartYLabelsPlugin` (also duplicated,
     self-contained, in `website/js/packing-charts.js` - this
     codebase's convention is one copy per department file rather
     than a shared import, so if you add a similar chart, copy the
     plugin rather than trying to reach across files for it).

2. **Documented exception - plain "Name (Code)" text, same size,
   no custom styling.** Used where the surface genuinely can't do
   better, or where doing better isn't worth the engineering:
   - Chart.js tooltips and legends (canvas-drawn, transient,
     effectively impossible to mix font sizes within without a
     bespoke tooltip/legend renderer for marginal benefit).
   - Native HTML `<select>`/`<option>` dropdown text (browsers don't
     support per-run styling inside an `<option>`).
   - PDF export rows (`website/js/packing-pdfExport.js`) - jsPDF text
     runs are single-font per call; not worth a second `doc.text()`
     call per cell for a rarely-zoomed-in export.
   - X-axis chart ticks with many categories that need Chart.js's
     own `autoSkip`/`maxRotation` to stay readable (e.g. Production's
     "Delayed vs In Time by Project", Quality's "Rework by Project").
     These use Chart.js's native multi-line tick support (the
     `ticks.callback` returns `[name, "(code)"]`, an array = one
     line each) rather than a custom-drawn axis, specifically
     *because* a custom-drawn axis would have to reimplement
     autoSkip/rotation itself to avoid overlapping labels for
     projects with many entries - not worth it for what's ultimately
     still a bracketed-code convention, just same-size instead of
     two-size.

   In both of these cases the text is still always "Name (Code)",
   never a bare code - the exception is about *font size*, not about
   whether the code gets bracketed.

**Filtering stays keyed on Code, not the display text.** Every table
filter, dropdown `<option value="...">`, and DataTables column search
still filters/sorts by the raw Project Code underneath - only the
*label* a person reads changed. Don't switch filter values over to
the combined "Name (Code)" string; codes are stable and unique,
formatted display strings are a UI concern layered on top.

**Where the Project Name actually comes from:** every department's
Python pipeline needs a `project_name` field attached before this
convention can apply to it - it isn't automatic. Reference points:

- Core Projects pipeline: `Project Name` already comes straight off
  the DPR (Fabrication) workbook - see `config/schema.json` /
  `config/column_mapping.json`.
- Production (`src/production/`): `SpoolRecord.project_name`,
  populated from the same Fabrication data at
  `src/production/ageing.py -> build_spool_records()`, exposed in
  the bundle by `src/production/summary.py`.
- Packing & Dispatch (`src/packing/`): `project_name` was already on
  `project_summary`/`shipments`/`boxes` rows via
  `build_project_names()`; `spools` rows didn't have it until
  2026-08-08 - see `src/packing/pipeline.py -> _finalize_spool_rows()`.
- Quality Assurance/Control (`src/quality/`): the Rework Data
  workbook has no Project Name column of its own, so
  `src/quality/reader.py -> load_sources()` reads the Fabrication
  (DPR) workbook purely for this lookup, best-effort (a missing DPR
  file just means charts fall back to the bare code, never blocks
  the dashboard).

If you build a fifth department with its own source data that has no
natural link to the DPR's Project Name column, that's a case this
doc doesn't have an answer for yet - decide deliberately (a fallback
lookup like Quality's, or accept bare-code display for that one
surface) rather than silently skipping the convention.
