# Absolute Rules

This file holds business rules that are **absolute across the entire
repository** - every dashboard, every pipeline, no exceptions and no
per-page variation. Created 2026-08-18 at the person's explicit
request, after the Projects and Production dashboards were found to
disagree on PDQC/"Ready for Painting" counts because a rule that
should have been universal was only ever implemented in one of the
two pipelines.

**Every future Claude session must read this file before touching
any pipeline that reads or computes PDQC, or before adding a new
dashboard/pipeline at all.** If a change would make a page disagree
with a rule listed here, that is a bug, not a design choice - fix
the page, don't add an exception here without the person's explicit
sign-off.

This file is for rules that must hold everywhere. `docs/decision_log.md`
remains the place for rules and fixes scoped to a single pipeline or
page - see that file for everything not listed below.

---

## Rule 1 - PDQC reflects Rework clearance everywhere

**Given by the person, in their own words (2026-08-18): "Rework rule
is absolute primary. If a spool is showing rework, PDQC goes blank,
even if DPR has PDQC date. Same rule needs to be applied to
everywhere."**

For any spool covered by the Production Rework Data workbook, PDQC
is driven by that workbook's latest offer-for-inspection event for
that spool - not by whatever the DPR Detailed Sheet or Line History
Sheet says - and specifically:

- Latest offer event's Final Status is **Accept** (cleared): PDQC
  becomes the **later of** (existing PDQC, that latest offer date).
  PDQC never moves backwards on a clearance.
- Latest offer event's Final Status is **anything else** (Rework, or
  a normalized "Other" like "Project hold"): PDQC is **forced
  blank**, even overwriting an existing PDQC value from DPR/Line
  History. A spool the Rework workbook says is still under rework
  has, by definition, not actually passed QC - any earlier PDQC on
  record is stale and must not be shown as done.

A spool not covered by the Rework workbook at all keeps its existing
PDQC unchanged - this rule only speaks for spools the rework file
has an opinion on.

**Single implementation:** `src/rework_pdqc_rule.py ->
apply_rework_pdqc_rule()`. Every pipeline that has a PDQC field must
call this exact function on it - never re-implement this logic
locally, even in a "just this once" or "just for this page" way.

**Current call sites** (2026-08-18):
- `src/merge.py -> MergeEngine.apply_rework_pdqc_override()` (Projects
  dashboard, `main.py`) - thin wrapper around the shared function.
- `src/production/pipeline.py -> run()` (Production dashboard,
  `production_main.py`) - calls the shared function directly on
  `sources.fabrication` right after `load_sources()`, before any
  stage/backlog/ageing computation reads PDQC.

If a third pipeline or dashboard is ever added that has its own PDQC
field, it must call `apply_rework_pdqc_rule()` too, at the earliest
point after its own PDQC source is loaded and before anything
downstream reads it. Do not add a new dashboard whose PDQC skips this
rule without asking the person first.

### Why this rule exists (history)

The rule itself (latest Rework Data offer event overriding PDQC) was
first added 2026-08-10, for the Projects dashboard only, via
`src/merge.py`. On 2026-08-17 the person pointed out a gap he'd
meant to include from the start: the override should only ever
*advance* PDQC on an actual QC clearance, never on a mere "most
recently offered" event - so the Cleared/Not-Cleared split (blanking
PDQC when not cleared) was added, still only in `src/merge.py`.

On 2026-08-18 the person reported the Projects page's "Ready for
Painting" count (~400 spools) didn't match the Production page's
"Release for Painting Backlog" count (500+ spools) for what should
be the same population. Investigation found the Production dashboard
(`src/production/reader.py`) reads PDQC straight from the raw DPR
Detailed Sheet, with **no knowledge of the Rework Data workbook at
all** - so a spool the Rework workbook showed as still under rework
could count as "PDQC done" on Production while correctly showing as
not-yet-PDQC'd on Projects. The rule was extracted into
`src/rework_pdqc_rule.py` as the single shared implementation, and
wired into the Production pipeline too, specifically to close this
gap and prevent it recurring for any future dashboard.

---

*(Future absolute rules go below this line, each as its own `## Rule
N` section, in the same format: what the rule is, in the person's
own words where possible; the single implementation it must go
through; every current call site; and why it exists.)*
