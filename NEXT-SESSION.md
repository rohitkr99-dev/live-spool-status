# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit twice now — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` more than once now (most recently found 3 commits behind on 2026-09-15, before that on 2026-09-07) — editing there directly risks building on stale code and losing/conflicting with upstream commits (including the auto-synced data commits from GitHub Actions).

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow on this repo so far), then remove the worktree when done (`git worktree remove <path>` — note: this has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, it's harmless).

## Where things stand (as of 2026-09-15)

**New: Quality dashboard "Open Rework & Hold by Project" chart.** Built in a fresh worktree (`../lss-worktree-quality`) after the stale-checkout gotcha above bit again mid-session. Shows currently-open (not yet Accepted) Rework + Hold spool counts, stacked bar per project — sourced from the Production Rework Data workbook directly (`sources.rework`, NOT the Inspection Data workbook every other chart on this page uses since 2026-09-02), per explicit instruction. Classification reuses the existing `normalize_rework_status()` rule from `src/rework_pdqc_rule.py` unchanged (FQC Accept/Packing Release/RFP → Accept, Not Found/Rework → Rework, Project Hold/Query/Hold → Hold) — confirmed with the person before building, no new classification logic written. Full design/verification story in `CHANGELOG.md`'s 2026-09-15 entry.

**Check before assuming it needs shipping**: run `git log origin/main --oneline -5 -- src/quality/summary.py website/quality.html` to see whether this has already been pushed, or is still sitting locally / on the `quality-open-rework-hold` branch.

Earlier the same session (ad-hoc data investigations, no repo code changes — just Excel exports sent directly to the person, nothing to ship here): VOGT FP's Stage Ageing Summary RFP average (14.1 days) traced to a PDQC date typo (`2025-02-09` should be `2025-09-02`, a DD/MM-as-MM/DD misread) affecting 67 spools; cross-checked the Inspection Data workbook's "still open" spools against DPR and against a QC-maintained per-project Rework file, surfacing 77 same-event conflicts between two QC logs (Inspection Data vs. a per-project Rework Data export) worth someone's manual review.

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
