# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, and again by 2026-09-21 — this last time origin/main had moved via two OTHER merged PRs, `dashboard-dark-mode-ux` and `dashboard-viewer-experience`, neither authored by this assistant) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow used by this assistant so far, though the person or others may use PRs directly on GitHub), then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase (a case-collision file in this repo, `data/upload/packing/Temp1.txt`, made plain rebase/checkout unreliable in an earlier session - fixed 2026-09-15, but the reset --soft approach is simpler regardless).

## Where things stand (as of 2026-09-21)

**Fabrication Line has had three rounds of changes this session, all shipped except the most recent:**

1. **"Spools Planned in Next Week" card** (pushed, commit `c77384e`), between "Production Order Not Released" and "Fit-Up". Splits spools that are on-schedule-but-not-yet-due (Current Stage = Fit-Up, Week = next fiscal week) out of the Fit-Up count.
2. **Full grid redesign** (pushed, commit `0214235`): the row's cards used to be sized proportionally to spool count (flex-grow), which reliably overflowed once an 11th stage card existed. Replaced with a uniform CSS grid, always exactly 2 rows, every card the same fixed size (213×108px at desktop width). The "widest card = bottleneck" visual is gone; the Bottleneck badge + count number carry that signal now.
3. **Card wording change (NOT YET COMMITTED as of this handoff)** - relabeled 7 of the 11 cards to read as active states: "Fit-Up"→"Under Fit-Up", "Welding"→"Under Welding", "PDQC"→"Under PDQC", "Ready for Painting"→"Pending Ready for Painting", "Packing"→"Under Packing", "Dispatch"→"Under Dispatch", "Completed"→"Shipment Complete". **Display-only** - the underlying `Current Stage` value spools carry everywhere else (All Spools table, filters, CSV exports, Production dashboard) is untouched; only `website/js/fabline.js`'s rendered card name, tooltip, and the "Busiest stage right now" note read through the new `SPOOL_STATUS_CONFIG.stageDisplayLabel` lookup in `website/js/config.js`. Verified locally (auth-stripped preview, desktop width) - all 7 relabeled correctly, the 4 unmentioned stages ("Production Order Not Released", "Spools Planned in Next Week", "Partial Fit-Up/Welding", "Under Painting") unchanged, no console errors. Full detail in `CHANGELOG.md`'s 2026-09-21 "(cont'd)" entries.

**Check before assuming #3 still needs shipping**: run `git log origin/main --oneline -5 -- website/js/config.js website/js/fabline.js` to see whether it's already been pushed, or is still sitting on the `next-week-fitup-card` branch / in worktree `../lss-worktree-nextweek` waiting on the person's go-ahead to push.

**Other repo state as of this session**: two PRs unrelated to this assistant's work landed on `origin/main` since an earlier handoff - `dashboard-dark-mode-ux` (per-page light/dark/system theme toggle, `website/js/theme.js`) and `dashboard-viewer-experience` (keyboard accessibility, load-error states, filter persistence, faster repeat-visit loader) - touching most `website/js/*-config.js`/`*-data.js`/`*-app.js` files plus `login.html`. Not reviewed in detail by this assistant; worth a skim if something in those areas behaves unexpectedly.

**Parked, not implemented**: the person floated adding an English/Thai language toggle to this site, got a scoped feasibility answer, then said "Let's park it for a while." No code changes were made for this - raise it again only if the person brings it back up.

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (the Quality dashboard's Open Rework & Hold chart + download button, Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
