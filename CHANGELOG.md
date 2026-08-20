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
