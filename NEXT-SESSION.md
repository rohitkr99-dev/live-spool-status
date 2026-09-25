# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, 2026-09-21, and again by 2026-09-22 — the hourly Drive-sync workflow moved `origin/main` by one commit between this session's clone and its first push) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow used by this assistant so far, though the person or others may use PRs directly on GitHub), then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase.

## Where things stand (as of 2026-09-25)

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
