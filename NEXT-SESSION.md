# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## ⚠️ Gotcha, hit repeatedly — check this before editing anything

**Before editing any file in this repo, confirm the primary checkout (`live-spool-status/`) isn't stale.** Run `git log -1 --oneline` and compare against `git log -1 --oneline origin/main` (after `git fetch origin main`). This checkout's `main` branch has drifted behind `origin/main` multiple times now (2026-09-07, 2026-09-15, 2026-09-21, and again by 2026-09-22 — the hourly Drive-sync workflow moved `origin/main` by one commit between this session's clone and its first push) — editing there directly risks building on stale code and losing/conflicting with upstream commits.

**The reliable way to make any change**: `git worktree add -b <branch-name> <path> origin/main` for a clean checkout of the real latest content, edit there, commit, push straight to `origin/main` (no PR flow used by this assistant so far, though the person or others may use PRs directly on GitHub), then remove the worktree when done (`git worktree remove <path>` — has been denied by permission prompts in past sessions; if that happens, just leave the worktree directory in place, harmless).

**Also watch for the shared origin/main moving mid-session** from the automated "Sync from Google Drive" workflow (runs hourly, commits data file updates) — if a push is rejected, fetch, confirm the new commit(s) only touch `website/data/*.json`, then `git reset --soft origin/main` + re-stage only your own intended files (never the data JSONs) + re-commit, rather than a full rebase.

## Where things stand (as of 2026-09-22)

**English/Thai language toggle — implemented this session, NOT YET PUSHED, waiting on the person's go-ahead.**

Full detail and design reasoning in `CHANGELOG.md`'s 2026-09-22 entry — read that before touching any of this. Short version:

- New `website/js/i18n.js` (site-wide `localStorage` language, mirrors `theme.js`'s widget pattern), a small CSS block in `website/css/styles.css` (`.lang-toggle`/`.lang-toggle__btn`), and every page (`index.html`, `dashboard.html`, `production.html`, `quality.html`, `packing-dispatch.html`, `painting.html`, `login.html`) got the toggle wired in plus `data-i18n` attributes on their static chrome (nav, KPI labels, headings, tabs, footer). `website/js/user-menu.js` was touched to translate its dynamically-built dropdown.
- **Scope is UI chrome only** — deliberately excludes `<table>` column headers, dropdown option lists populated from data, and anything Chart.js renders inside a canvas (axis labels, legends, datalabels). Translating those would mean touching a dozen-plus chart/table JS files for comparatively low value.
- **Coverage is uneven by design**: `index.html`, `dashboard.html`, `packing-dispatch.html`, `painting.html` got full depth including every chart-card heading. `production.html` and `quality.html` got topbar + KPI strip + footer but NOT their own chart-card headings (still English) — a scope cut to keep the session tractable, not a technical limit. If the person wants those two brought up to the same depth as the others, that's the next natural chunk of work — the pattern is fully mechanical at this point (add a dict entry to `i18n.js`, add `data-i18n="key"` to the heading), just needs doing for ~15 more headings on each page.
- **Real bug found and fixed during verification**: `website/js/stageAgeing.js`, `packing-tables.js`, `painting-tables.js` each rebuild a project-filter `<select>`'s default "All Projects" option from a hardcoded English string at runtime, which was silently discarding the Thai translation the moment real data loaded. Fixed in all three (now built through `window.I18N.t()`, keeping the `data-i18n` attribute so a later toggle still works). Worth keeping this class of bug in mind if any other `select.innerHTML = '<option ...>hardcoded text</option>'` pattern surfaces elsewhere later — search `grep -rn "innerHTML = '<option" website/js/` to check.
- Verified in a browser (auth-stripped local copy, real published data bundle — 13,139 real spool rows, not synthetic): all 7 pages, EN↔TH toggle both directions, persistence across navigation, no console errors, every `data-i18n*` reference cross-checked against the dictionary (zero missing keys).
- Work is on a worktree at a `lang-toggle-en-th` branch (see the gotcha above for the general worktree pattern) — not yet pushed. **Push needs the person's explicit go-ahead first** given the size of the diff (3 new/changed files' worth of dictionary plus touches to all 7 HTML pages and 3 JS files).

## Action needed from the person (blocking, can't be done from the assistant side)

Carried over from 2026-09-07, status unconfirmed — check if this was already done before re-raising it:

The Painting dashboard's data has never flowed through the automated "Sync from Google Drive" workflow. Root cause: `scripts/sync_drive.py` only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one. The code side is already fixed (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` both know about a `painting` Drive subfolder now). Still needed, in Google Drive itself:
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality`.
2. Put the Painting Weekly Plan workbook into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run) — it should then pull the workbook in automatically going forward.

Until steps 1–2 happen, Painting's data only updates via a manual local-run-and-upload bridge, not the automated sync.

## Earlier history

Full detail (the Fabrication Line redesign and rewording, the Quality dashboard's Open Rework & Hold chart, Painting's 3-series trend chart, the Quantum of Work Pending chart, per-chart Excel exports, PDF export buttons, the F11=P11 material normalization, the dark/light/system theme toggle, etc.) is in `CHANGELOG.md` — this file only tracks the most recent handoff, not a running history.
