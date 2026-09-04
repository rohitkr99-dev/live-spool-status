# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## Action needed from me (blocking, can't be done from the assistant side)

The Painting dashboard's data has **never** flowed through the automated "Sync from Google Drive" workflow — not a bug introduced this session, a gap that's existed since the Painting dashboard was built. Root cause (full story in `CHANGELOG.md` → "Root cause found" entry, 2026-09-04): the Google Drive sync script (`scripts/sync_drive.py`) only mirrors `projects`/`packing`/`quality` subfolders from Drive — there was never a `painting` one, so the Painting Weekly Plan workbook never made it into the repo for the pipeline to read, no matter how many times the workflow ran.

**Fixed the code side already** (`scripts/sync_drive.py` + `.github/workflows/drive-sync.yml` now both know about a `painting` Drive subfolder and run `painting_main.py`). **Still need to, in Google Drive itself:**
1. Create a subfolder named exactly `painting` under the same shared root folder that already has `projects`/`packing`/`quality` in it.
2. Put the Painting Weekly Plan workbook (filename containing "Painting Weekly Plan", same convention as always) into that new `painting` subfolder.
3. Re-run "Sync from Google Drive" (or wait for the next scheduled run, every 15 min) — it should now actually pull the workbook in and regenerate Painting's data going forward, same as every other department.

Until step 1–2 happen, Painting's data will only ever update via a manual local-run-and-upload bridge (like the one done today), not the automated sync.

## Where things stand otherwise (as of 2026-09-04)

1. **Production backlog fix** (shipped 2026-09-03, corrected same day): "Release for Painting"/PDQC backlog charts no longer wrongly count Rework spools as backlog, except PDQC's own chart (correctly still shows them). Confirmed synced and live.
2. **Painting "Output by Bay" chart** + **3. Internal vs External Blasting butterfly chart** (both shipped 2026-09-04): both are live and working — verified directly against the person's own open browser tab, real data, correct colors (DEE blue `#4333A5` left / DEE red `#A82E30` right), correct left/right orientation, dynamic row height. As of this handoff the published bundle was manually regenerated and republished (`website/data/b3f7e6a1d4.json`, `generated_at: 2026-09-04T02:08:48`) using the real Painting Weekly Plan workbook plus a DPR stand-in built from the previously-published bundle's own `spools` (no direct DPR access outside the Drive-synced CI environment) — so both charts should show real data right now, but that data is a one-time manual snapshot, not self-refreshing, until the Drive folder step above happens.

## Known open item

The user said (2026-09-03) "I have some more things to add in Painting" before pivoting to the Production investigation — content not yet given. Ask what those are if picking Painting back up.

## Housekeeping note (not urgent)

Local git push doesn't work in this environment (no stored credentials) — all publishing this session was done via GitHub's web "Upload files" UI. The local git branch has also drifted from `origin/main`'s real history (confirmed to be encoding/line-ending noise, not real content differences, the one time it was checked). Don't try to reconcile it unless a task specifically needs local git history — work directly against files and publish via web-upload as this session did. Local `.github/workflows/` and `scripts/` directories didn't exist at all before this session (same drift) — they were pulled fresh from GitHub's raw content this session to make the sync fix.
