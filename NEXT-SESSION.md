# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, and again by 2026-09-21 — this last time origin/main had moved via two OTHER merged PRs, `dashboard-dark-mode-ux` and `dashboard-viewer-experience`, neither authored by this assistant) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow used by this assistant so far, though the person or others may use PRs directly on GitHub), then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase (a case-collision file in this repo, `data/upload/packing/Temp1.txt`, made plain rebase/checkout unreliable in an earlier session - fixed 2026-09-15, but the reset --soft approach is simpler regardless).

## Where things stand (as of 2026-09-21)

**New: "Spools Planned in Next Week" card on the main dashboard's Fabrication Line**, between "Production Order Not Released" and "Fit-Up". Splits spools that are on-schedule-but-not-yet-due (Current Stage = Fit-Up, Week = next fiscal week) out of the Fit-Up count, which used to lump them in with genuinely overdue spools. Also fixed a real CSS bug found along the way: long card labels ("Production Order Not Released", "Ready for Painting") were forcing their cards wider than the rest of the row (`white-space: nowrap` on the label collapsing a flex item's min-width to the full unwrapped text width) - fixed by letting labels wrap instead. Full story, including the exact fiscal-week math and the CSS root-cause, in `CHANGELOG.md`'s 2026-09-21 entry.

**Check before assuming it needs shipping**: run `git log origin/main --oneline -5 -- src/summary.py website/js/fabline.js` to see whether this has already been pushed, or is still sitting on the `next-week-fitup-card` branch / in worktree `../lss-worktree-nextweek`.

**Other repo state as of this session**: two PRs unrelated to this assistant's work landed on `origin/main` since the last handoff - `dashboard-dark-mode-ux` (per-page light/dark/system theme toggle, `website/js/theme.js`) and `dashboard-viewer-experience` (keyboard accessibility, load-error states, filter persistence, faster repeat-visit loader) - touching most `website/js/*-config.js`/`*-data.js`/`*-app.js` files plus `login.html`. Not reviewed in detail by this assistant; worth a skim if something in those areas behaves unexpectedly.

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (the Quality dashboard's Open Rework & Hold chart + download button, Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
