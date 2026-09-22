# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, 2026-09-21, and again by 2026-09-22 — the hourly Drive-sync workflow moved `origin/main` by one commit between this session's clone and its first push) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow used by this assistant so far, though the person or others may use PRs directly on GitHub), then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase.

## Where things stand (as of 2026-09-22)

**English/Thai language toggle.** Initial rollout (commit `6cc5f34`) is live on `origin/main` and deployed. A follow-up bringing `production.html`/`quality.html` up to full depth is done on a worktree, verified, but **NOT YET PUSHED** — waiting on the person's go-ahead.

Full detail and design reasoning in `CHANGELOG.md`'s two 2026-09-22 entries — read both before touching any of this. Short version:

- `website/js/i18n.js` (site-wide `localStorage` language, mirrors `theme.js`'s widget pattern) plus a small CSS block in `website/css/styles.css` (`.lang-toggle`/`.lang-toggle__btn`) power the toggle on every page (`index.html`, `dashboard.html`, `production.html`, `quality.html`, `packing-dispatch.html`, `painting.html`, `login.html`). `website/js/user-menu.js` translates its dynamically-built dropdown.
- **Scope is UI chrome only** — deliberately excludes `<table>` column headers, dropdown option lists populated from data, and anything Chart.js renders inside a canvas (axis labels, legends, datalabels).
- **Coverage is now even across all 6 dashboard-style pages**: every one of `index.html`, `dashboard.html`, `production.html`, `quality.html`, `packing-dispatch.html`, `painting.html` has full depth — topbar, KPI strip, every chart-card heading, tabs/filter labels, footer. `login.html` has its own narrower-by-nature scope (tagline, field labels, submit button, auth error messages — no topbar/KPI strip on a login screen). The dictionary is now ~297 entries.
- **Two real bugs found and fixed during verification, both the same class**: JS rebuilding a `<select>`'s default option from hardcoded English text at runtime, silently discarding whatever `data-i18n` markup was there. First round: `website/js/stageAgeing.js`, `packing-tables.js`, `painting-tables.js` (all three "All Projects" project-filter dropdowns). Fixed by routing the rebuilt option's text through `window.I18N.t()` and keeping the `data-i18n` attribute on it. If anything similar surfaces later, search `grep -rn "innerHTML = '<option" website/js/`.
- Verified in a browser both rounds (auth-stripped local copy, real published data bundle — 13,139 rows on Projects, 10,121 on Production, real Quality rework data): every page, EN↔TH toggle both directions, persistence across navigation, no console errors, every `data-i18n*` reference cross-checked against the dictionary (zero missing, zero duplicate keys).
- The Production/Quality depth work is on a worktree at a `prod-quality-i18n-depth` branch (see the gotcha above for the general worktree pattern) — not yet pushed. **Push needs the person's explicit go-ahead first**, same as the initial rollout.

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (the Fabrication Line redesign and rewording, the Quality dashboard's Open Rework & Hold chart, Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, the dark/light/system theme toggle, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
