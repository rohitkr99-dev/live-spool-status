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
- Latest offer event's Final Status is **Rework** (per Rule 2's
  3-way classification, added 2026-08-19): PDQC AND RFP are both
  **forced blank**, even overwriting existing values (updated
  2026-08-20 - originally PDQC only). A spool the Rework workbook
  says is still under rework has, by definition, not actually passed
  QC - any earlier PDQC/RFP on record is stale and must not be shown
  as done. PDI Clearance and Packed are deliberately left untouched:
  the person's reasoning, in his own words (2026-08-20) - "if the
  spool has already been PDI cleared, that means its rework has
  already been cleared... blank only PDQC and RFP dates for Rework
  Spools" - a PDI-cleared spool is itself evidence the rework was
  actually resolved even if the Rework Data workbook hasn't caught
  up, and he corrects those stale workbook entries directly rather
  than have the pipeline guess at clearing PDI/Packed too. He's also
  said he wants a different overall approach to Rework handling in a
  future session - this is the interim rule for now.

A spool not covered by the Rework workbook at all keeps its existing
PDQC unchanged - this rule only speaks for spools the rework file
has an opinion on.

**Why RFP was added to the blanking scope (2026-08-20):** the person
shared a real Production Backlog export showing 232 of 447 "stuck at
PDQC" spools (52%) had PDQC blank but a downstream date (RFP/PDI/
Packed) already filled - spools that had completed the full journey
once, then re-entered rework, with only PDQC getting blanked while
stale downstream dates from the previous pass stayed in place. This
both misrepresented where these spools actually are and badly
inflated the Production Backlog chart's overdue-day figures (the
backlog calculation anchors to the spool's original, now very old,
Welding Finish date).

**Stale-status override (2026-08-20, same day):** blanking PDQC/RFP
while leaving PDI/Packed untouched created a NEW problem the person
caught immediately - since "current stage" is always the first blank
stage in order, any spool with PDI/Packed already filled but a
blanked PDQC would permanently show as "stuck at PDQC" no matter
what. Fixed by turning the person's own reasoning into an actual
override condition, not just a justification for what to leave
alone: if a spool's latest Rework Data status is Rework, but it
ALREADY has a PDI Clearance or Packed date on record, that fact IS
the "already cleared" signal - PDQC/RFP are left completely
untouched for it (not blanked at all), and it's flagged as a new
Exceptions tab entry (type "rework_status_stale") so the person can
find and correct the stale entry in the source workbook himself.

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

## Rule 2 - Hold is not Rework: PDQC/RFP real, but Hold days excluded from ageing

**Superseded 2026-08-21 (given by the person, in their own words):
"we will keep a track of PDQC Date and RFP date and Hold Start/
Removal dates as well. Then we will subtract those many days from
actual ageing of the process. Also note, there might be a
possibility of spool being Hold even after RFP. So, we need to
remove those days from Under Painting as well." This replaces the
2026-08-19 anchoring approach described further below (kept for
history) - PDQC/RFP are no longer faked to an artificial near-
immediate date. See `src/hold_ledger.py` for the full mechanism.**

The Production Rework Data workbook's Final Status column still maps
to exactly THREE categories (given by the person, 2026-08-19 - the
literal values as they appear in his workbook, mapped in
`src/rework_pdqc_rule.py -> _STATUS_MAP`):

| Final Status (raw text) | Category |
|---|---|
| Accept | Accept |
| Not found | Rework |
| Project hold | **Hold** |
| Rework | Rework |
| Rework/same RW | Rework |
| SPOOL DELETED | Rework |

Any value not in this table is treated conservatively as Rework (not
cleared) and logs a warning - never silently assumed Accept or Hold.

**What actually happens now, for a spool whose latest offer event is
Hold:**

- PDQC and RFP are treated exactly like a genuine Rework spool's for
  display purposes - blanked until a real Accept event clears them
  (same PDI-Cleared/Packed staleness exemption as Rule 1). No more
  fabricated anchor date.
- Separately, `hold_ledger.py` records the spool's REAL Hold
  start/removal dates as a period in `state/hold_tracking.json`
  (still that filename - only the schema changed, see the file
  itself for the migration from the old single-anchor format). A
  spool can have any number of these periods over its life.
- Every ageing calculation that has an age WINDOW overlapping a Hold
  period - Total Age and Stage Age on the Projects dashboard
  (`src/ageing.py`), current-age-vs-target and each stage's actual
  days on the Production dashboard (`src/production/ageing.py`) -
  subtracts however many WORKING days of that window were spent on
  Hold (`hold_ledger.working_days_held_between()`, using the same
  weekend/holiday calendar as everything else - `utils.
  working_day_variance()`). This is a plain date-overlap check, not
  "was this Hold during stage X specifically" - so a Hold that
  happens AFTER RFP, during Under Painting, is excluded from Under
  Painting's stage age exactly the same way a pre-RFP Hold is
  excluded from Total Age or the PDQC window. Floors at 0 everywhere.
- A spool with an OPEN (unresolved) Hold period right now
  (`CURRENTLY_ON_HOLD` in `src/rework_pdqc_rule.py`) is excluded
  from every backlog/delayed chart on both dashboards entirely -
  given by the person (2026-08-21): "The hold spools should not be
  visible as backlog at any stage." It shows instead on a dedicated
  chart, grouped by Project and current stage
  (`build_hold_by_project_stage()` in `src/summary.py` /
  `src/production/summary.py`).

**Persistent memory required, same as before:** a spool's status can
change from Hold to Accept by editing the SAME row in the workbook
in place (no new row added), so the fact it was ever on Hold, and
the date it happened, can vanish from the workbook once resolved.
`state/hold_tracking.json` is how that history survives across
pipeline runs - committed to git by every pipeline run
(`.github/workflows/drive-sync.yml`) - **this file must keep being
committed, or Hold-day tracking silently stops working correctly the
moment a Hold row gets edited to Accept in place.**

**Multiple Hold periods are now first-class, not an exception:**
unlike the superseded anchoring approach, a spool going Hold ->
Accept -> Hold -> Accept any number of times just accumulates
periods in the ledger - no manual review needed for re-entry.
**The one genuinely ambiguous case left:** a spool with an open Hold
period whose latest workbook status jumps straight to Rework with no
Accept in between - the ledger can't tell whether the Hold should
count as resolved, so it's left untouched and flagged on the
Projects dashboard's Exceptions tab (`src/summary.py ->
generate_exceptions()`, exception type `rework_hold_ambiguous`) for
manual review.

**Single implementation, same as Rule 1:** `src/rework_pdqc_rule.py
-> apply_rework_pdqc_rule()` (blanking + ledger advancement) plus
`src/hold_ledger.py` (the ledger itself, and the working-day overlap
helper every ageing engine calls) - called from the exact same
places (`src/merge.py` for Projects, `src/production/pipeline.py`
for Production). No separate call site to maintain.

<details>
<summary>History: the 2026-08-19 anchoring approach this replaced</summary>

Originally (given by the person, 2026-08-19: "Production says a Hold
should not affect their ageing, QC says Hold should not affect their
ageing... For Hold spools, consider PDQC done and anchor it to
higher of either 2 (DPR PDQC date of Production Rework Date)"), a
Hold spool's PDQC was anchored to the EARLIEST offer date it was
ever seen on Hold (not the eventual Accept date), and RFP was set to
that anchor plus a flat standard target gap (4 working days) rather
than its true, hold-inflated date - because "the main problem is RFP
days, which is incalculable due to HOLD... consider standard days
difference between PDQC & RFP" (the person, 2026-08-19). This
protected Production/QC's ageing from Hold delays, but at the cost
of PDQC/RFP no longer being real dates, and it had no way to handle
a Hold that happened after RFP (during Under Painting) at all - both
of which the 2026-08-21 rewrite above fixes directly.

</details>

---

*(Future absolute rules go below this line, each as its own `## Rule
N` section, in the same format: what the rule is, in the person's
own words where possible; the single implementation it must go
through; every current call site; and why it exists.)*
