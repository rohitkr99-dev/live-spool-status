# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, 2026-09-21, and again by 2026-09-22 — the hourly Drive-sync workflow moved `origin/main` by one commit between this session's clone and its first push) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, then ship it per the agreed split (2026-10-08): **small, low-risk changes (wording, a label, one chart tweak, CSS) push straight to `origin/main`; pipeline or data changes (anything under `src/`, `config/`, the Drive sync, published data fields) go on a branch and PR for review first**. Only merge/deploy on an explicit go-ahead, delete the branch after, then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase.

## PDI Accept date from the RFP Spools Latest file (2026-10-21) - in a PR

The PDI date on the site is now the **PDI Accept date** from `RFP Spools Latest.xlsb` (Drive `quality/` folder, uploaded daily by the person) wherever that file has one; the file wins over the DPR. Spools it does not cover keep the old logic. RFP is untouched. Needs a sync after merge. **Check after the first sync:** about 6,100 PDI dates move earlier, 12 later, and ~68 spools move from Under Painting to Packing. See the CHANGELOG entry of 2026-10-21.

## New look shipped: DEE Maroon (tonal) Studio skin (2026-10-19)

The whole site now uses the "Studio" skin (flat cards, pill controls, maroon colour blocks, flat 4px-corner bars with a hairline between stacked segments). It is **front end only**: `website/css/studio.css` (everything scoped to `html[data-skin="studio"]`) plus `website/js/studio-theme.js` on the five chart pages; each page has `data-skin="studio"` on `<html>`. See the CHANGELOG entry of 2026-10-19 for the full list and how to undo it. **Next (only if asked):** check Quality / Painting / Packing in dark mode and the wide-desktop layout on a real screen; the department PNG icons are still red/blue line art; Thai labels were not touched. Gotcha for edits: `website/index.html` has mixed CRLF/LF line endings, so stage it with `git -c core.autocrlf=false add website/index.html` or the diff shows ~300 changed lines.

## Cutting Station build (2026-10-21)

The page is now **Cutting Station & Material Handover** (still Testing; hub card is 6th, right after Packing & Dispatch), all four build steps done (2026-10-24): Drive script v3 with Firebase login check (PASSCODE property deleted), two private Google Sheet masters in the Drive Cutting folder (Cutting and Beveling Status, Material Handover, each with History), the Cutting & Beveling Status section, the Material Handover section, Excel reports for both. Setup/ops notes: `Documents/Cutting Plan/DRIVE-SETUP.md`. **Next (only when the owner asks):** trial with the cutting team and fix feedback; later switch the tracker's Material Handover section from the old workbook (Drive `production/`) to the new master and retire the old file; a pipeline reading the masters from Drive for weekly reports; remove the Testing badge when signed off. Do not put master data in the repo (it is PUBLIC). **LIVE 2026-10-21 (later) - script v8:** only emails on the sheet Allowed (Cutting and Beveling Status master) can save in the Cutting Station (Material Handover is open to all signed-in users); admin-only Daily summary tab (ADMINS constant in the script) fed by the History sheets plus a Visits sheet. To allow a new person: add their login email to the Allowed sheet, no deploy needed. Not live-tested with a non-listed login. The user guides do not yet mention the Allowed list or the summary. **LIVE 2026-10-21 - Material Handover round 2:** merged to main, Apps Script v7 deployed, BOM job re-run (FORMAT 2, area column), the 3 VOGT 209-096 plan files moved into TJ_25-26_209/Excel, PDF, JSON, live-tested with a dummy project (rows removed; real data untouched). It has: Remark box per item (also in the Excel), item surface area (3 decimals) plus spool total, Return of a received fitting (Dent / Wrong ICD / Other; sheet Returns; Returned items card + Excel), editable spool Group (sheet SpoolGroups), several ICDs / Drawing Nos / Spool Nos (paste lists, partial match; Drawing/Spool are in the Filter and tick card), status suffix ', but spool handed over', Download MNA list and Download shown items (Excel), plan files saved in Excel / PDF / JSON sub-folders. No legacy 'handed over before system start' feature (decided with the person). Both user guides (EN + TH) were updated for round 2 (2 pages each). STILL TO DO: plans VOGT 209-105 and 209-125 are REAL plans (the person confirmed) - never delete them; Thai guide still needs a native-speaker check. **Update 2026-10-24 (BOM):** the Material Handover section is now per ITEM from the Drive BOM folder (see the CHANGELOG entry "Material Handover is now per ITEM"); the hourly workflow `bom-build.yml` needs the tracker service account to be EDITOR on the Drive `BOM/` folder,. The user guides (EN + TH, `Documents/Cutting Plan`) cover it. Live-tested 2026-10-24 (project TJ/25-26/209: load 4.6 s, save and reload OK, test rows removed); BOM/data files are pre-created placeholders because a service account cannot create files in a personal Drive. **Update 2026-10-24:** also live: Accepted plans filters + Excel, Whole plan boxes, all dates DD-MM-YYYY (real Excel dates in downloads), and Release a piece that cannot be cut (script v5, Releases sheet in the Cutting master) - see the CHANGELOG entry of that date. The two user guides in `Documents/Cutting Plan` do not yet mention Release, Whole plan or the date format.

## Where things stand (as of 2026-10-12) - Cutting Plan page

**Project filter drives the KPI cards (2026-10-16)** - in a PR; needs a sync after merge for the per-project KPI values (`by_project[code].kpis`). See `CHANGELOG.md`.

**Packing & Dispatch All Spools headers fixed (2026-10-16)** - one header cell was missing for the hidden Project Code column; see `CHANGELOG.md`.

**Projects page global project filter (2026-10-16)** - in a PR: a Project select between the KPI cards and the Fabrication Line filters everything below it. Needs the pipeline change (per-project Fabrication Line in `dashboard_summary.by_project`, per-project `activity_metrics`), so merge, then run the sync; see `CHANGELOG.md`.

New page `website/cutting-plan.html`, now in **Testing** (2026-10-12; layout bars recoloured 2026-10-15 - six-colour cycle, piece numbers, hatched remain; PDF redesigned 2026-10-17 - large print, max 3 pipes/page, Cut box column, divider between pipes; 2026-10-19 - paste-from-Excel boxes and restyle to the shared topbar/kpi-card/glass-card look): the tool is visible to signed-in users, the hub card says Testing, and the `?preview=1` gate is gone. Full detail in `CHANGELOG.md`'s 2026-10-12 entry. **Next:** (1) Drive save is working (confirmed 2026-10-16; success/failure toast added) - suggest the person set a stronger `PASSCODE` in the Apps Script settings before the team uses it; tracker sync of the Drive `Cutting` folder is still to do; (2) a tracker pipeline step reads the saved plan JSON/Excel from the Drive inbox; (3) once the cutting team has trialled it with real cut lists (compare against the old tool's PDF), change the Testing badge to Live. Constraint: master workbook stays manual for now - the tool only produces paste-ready SPOOL/STORE update sheets.

## Where things stand (as of 2026-10-08)

**Stage Age (excl. Hold Period) fix (2026-10-12)** - material-hold weeks now come off Total Age only, not Stage Age; in a PR, see `CHANGELOG.md`.

**Material Handover: F11 merged, Concern Department chart removed (2026-10-08)** - in a PR; see `CHANGELOG.md`.

**Material Handover charts limited to current FY (2026-10-08)** - Production page, from FY Week 1 (plus still-open dateless items); in a PR, see `CHANGELOG.md`. Confirm the numbers after the next sync.

**Spool Traveler Plan/Material dates (2026-10-08)** - Plan = Planned Start; Material = Material Handover workbook date (Drive `production` subfolder is now synced). FQC was added then removed the same day as confusing (Ready for Painting is the QC marker); see `CHANGELOG.md`.

**Spool Traveler search - in a PR, not merged (2026-10-08).** Branch `feat/spool-traveler-search`: the Spool Traveler page now searches real spool records by Project/Drawing/Spool with candidate selection; joint details show "unavailable" because there is no signed-in-only data path yet (see `docs/spool-traveler-joint-data.md`). Landing tile still says Coming Soon. Waiting for review; do not merge or deploy without explicit approval.

**Planned-in-future-weeks card fixed to include SIOP-only spools (2026-10-02)** - blank Week now falls back to the fiscal week of Planned Start (+175 Week-29 spools). Verify the card reads ~638 after the next sync; see `CHANGELOG.md`.

**Daily 10:30 AM sync (2026-10-02)** - `drive-sync.yml` has a second cron (`30 3 * * *` = 10:30 Thailand time) that always re-runs the pipelines. Confirm the first run happened; the base cron is now every 4 hours (`0 */4 * * *`, changed the same day). See `CHANGELOG.md`.

**Sync now auto-deploys (2026-09-25)** - `drive-sync.yml` dispatches `deploy.yml` after committing new data (previously the site stayed stale until a manual deploy). Verify on the next hourly sync that a Deploy Website run follows it; see `CHANGELOG.md`.

**Fabrication Line "planned" card widened (2026-09-25)** - now counts all Fit-Up spools with a planned Week after the current fiscal week (was: next week only); displays as "Spools Planned in Future Weeks". Needs a pipeline run to show; see `CHANGELOG.md` 2026-09-25 for the fiscal-year-wrap limitation.

**Project Progress chart regrouped (2026-09-24)** - Dashboard page's Project Progress chart only: Under Production (Fit-Up/Partial/Welding/PDQC), Under QC (was Ready for Painting), Packed (Packing/Dispatch). Logic lives in `drawProjectChart()` in `website/js/charts.js`; everything else (Weekly Progress, filters, tables, other pages) intentionally keeps raw stage names. Detail in `CHANGELOG.md`'s 2026-09-24 entry. Thai labels for the three new names were not added.

**English/Thai language toggle — fully shipped.** Both rollouts (`6cc5f34` site-wide toggle, `16181f0` Production/Quality brought to full depth) are live on `origin/main` and deployed. Full detail in `CHANGELOG.md`'s three 2026-09-22/23 entries if this area needs touching again. Short version: `website/js/i18n.js` (site-wide `localStorage` language, ~297-entry dictionary) covers UI chrome only (not `<table>` headers, data-populated dropdown options, or Chart.js canvas text) across all 6 dashboard pages at full depth, plus `login.html` at its own narrower scope. One recurring bug class worth remembering: JS that rebuilds a `<select>`'s default option from a hardcoded English string at runtime silently discards `data-i18n` markup - hit three times (`stageAgeing.js`, `packing-tables.js`, `painting-tables.js`), all fixed by routing through `window.I18N.t()`. If it surfaces again: `grep -rn "innerHTML = '<option" website/js/`.

**Design polish pass — in progress, NOT YET PUSHED, waiting on the person's go-ahead.** Full reasoning in `CHANGELOG.md`'s 2026-09-23 entry. Short version:

- Scoped one page at a time rather than running loose across the whole site (this is a live production tool). Projects dashboard checked first and came back clean - no changes made there, reported honestly rather than manufacturing busywork.
- Painting and Production checked next, using the same method both times: real published data (not synthetic), desktop (1440px) + mobile (390px) + dark mode, text contrast measured programmatically (not eyeballed), console/network checked for errors. Two apparent issues turned out to be false alarms on closer inspection (a chart legend that looked cramped in a downscaled screenshot but measured proportionate; a chart card that looked oddly tall but is deliberately data-height-driven, per a `painting.css` comment already explaining why) - worth remembering so a future pass doesn't re-chase either.
- **Two real bugs found and fixed**, both mobile/overflow, both on a worktree at a `polish-check` branch (not yet pushed):
  - `website/css/painting.css` - the 8-tab table-toolbar tablist wrapped raggedly (uneven flex-wrap packing) at nearly every real viewport width, not just mobile - its ~1340px natural width barely fits under the site's own 1440px max-width. Fixed with an unconditional 2-column CSS grid for this specific tablist, deliberately not a pixel breakpoint (the margin was too narrow, and the EN/TH toggle shifts these exact 8 labels' lengths).
  - `website/css/production.css` - a real user-facing bug: the "Project" filter group (label + 160px-min-width select + "All Projects" button, ~385px total) was wider than a phone's ~360px content width, and the parent's flex-wrap only wraps whole groups, not items within one - so the reset button was completely invisible on mobile, silently clipped, not just cramped. Fixed by letting the group itself wrap.
- Both fixes verified at multiple viewport widths + dark mode + click interaction; `impeccable detect --json` clean on both files.

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (the Fabrication Line redesign and rewording, the Quality dashboard's Open Rework & Hold chart, Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, the dark/light/system theme toggle, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
