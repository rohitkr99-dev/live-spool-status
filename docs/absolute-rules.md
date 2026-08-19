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

## Rule 2 - Hold is not Rework: PDQC/RFP anchored, not blanked

**Given by the person, in their own words (2026-08-19), after
reporting that Rule 1's blanking behavior was inflating the
PDQC-stuck count on both dashboards for spools that were only on
administrative Hold: "Production says a Hold should not affect their
ageing, QC says Hold should not affect their ageing... For Hold
spools, consider PDQC done and anchor it to higher of either 2 (DPR
PDQC date of Production Rework Date)."**

The Production Rework Data workbook's Final Status column maps to
exactly THREE categories (given by the person, 2026-08-19 - the
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

For a spool whose latest-dated offer event (or any prior offer
event) is Hold:

- **PDQC** is treated as done almost immediately: anchored to the
  EARLIEST offer date this spool was ever seen on Hold - not the
  eventual Accept date, however long the hold actually lasted - then
  set to the LATER of (existing DPR PDQC date, that anchor date).
  Worked example, given by the person: offered 1 Aug, held, cleared
  11 Aug - PDQC is NOT 10 days, it's anchored back to (approximately)
  1 Aug, so the hold period effectively doesn't count against PDQC
  ageing at all. Contrast with genuine Rework (Rule 1): a spool that
  was genuinely reworked for the same 10 days keeps the full 10-day
  delay, since that IS a real fabrication/quality delay.
- **RFP** is set to the LATER of (existing DPR RFP date, the PDQC
  anchor date + the standard PDQC-to-RFP target gap - 4 working
  days, `STANDARD_PDQC_TO_RFP_WORKING_DAYS` in
  `src/rework_pdqc_rule.py`, derived from `config/production_rules.
  json -> target_days`). The TRUE RFP date is not used for
  Hold-affected spools, because it would still carry almost the
  entire hold-caused delay and unfairly inflate whichever team's
  ageing depends on RFP - "the main problem is RFP days, which is
  incalculable due to HOLD... consider standard days difference
  between PDQC & RFP" (the person, 2026-08-19).

**Persistent memory required:** a spool's status can change from
Hold to Accept by editing the SAME row in the workbook in place (no
new row added), so the fact it was ever on Hold, and the date it
happened, can vanish from the workbook once resolved. This is
tracked permanently in `state/hold_tracking.json`, committed to git
by every pipeline run (`.github/workflows/drive-sync.yml`) - **this
file must keep being committed, or Rule 2 silently stops working
correctly the moment a Hold row gets edited to Accept in place.**
Once a spool is first recorded as Hold, its anchor date is
remembered forever, even long after it clears - the entire point of
the rule is that the hold period never counts, not just while the
hold is ongoing.

**Ambiguous case - flag, don't guess:** if a spool that was
previously resolved (no longer on Hold, per the stored record) is
later seen on Hold AGAIN, that's an unexpected pattern the person
said shouldn't normally happen ("I don't think this situation should
come. You can flag this spool in Exceptions section... I will see
and make changes in the actual file manually and reupload it."). That
spool's Hold-anchor treatment is suspended (falls back to the plain
Rework rule - PDQC blanked) and it's surfaced on the Projects
dashboard's Exceptions tab (`src/summary.py -> generate_exceptions()`,
exception type `rework_hold_reentry`) for manual review, rather than
silently re-anchored to a possibly-wrong date.

**Single implementation, same as Rule 1:** `src/rework_pdqc_rule.py
-> apply_rework_pdqc_rule()` - the same function that implements
Rule 1 implements Rule 2 too, and is called from the exact same
places (`src/merge.py` for Projects, `src/production/pipeline.py`
for Production). No separate call site to maintain.

---

*(Future absolute rules go below this line, each as its own `## Rule
N` section, in the same format: what the rule is, in the person's
own words where possible; the single implementation it must go
through; every current call site; and why it exists.)*
