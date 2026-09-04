# Next Session

Paste this to start the next chat cold.

---

I'm continuing work on my `rohitkr99-dev/live-spool-status` repo (the DEE Piping Systems spool tracker). Read `CHANGELOG.md` first — it has the project's full history and reasoning. This file is just the handoff for exactly where I left off.

## Where things stand (as of 2026-09-04)

Three things landed this session and are waiting on verification:

1. **Production backlog fix** (shipped 2026-09-03, corrected same day): "Release for Painting"/PDQC backlog charts no longer wrongly count spools that are actually in Rework as backlog — except PDQC's own chart, which correctly still shows them (that IS PDQC's own unresolved verdict). See `CHANGELOG.md` → 2026-09-03 entry for the full story, including the real example spool that caught the first version's bug (`1-V17565-PIND-0079` / `V17565-PIND-0079-02`). Already confirmed sync'd — commit history shows 3 "Auto-update: sync from Google Drive" runs on 2026-09-04, after this fix landed.
2. **Painting "Output by Bay" chart** (shipped 2026-09-04): compares Bay-4 / Bay-6 / Bay-6 Auto output per day/week/month, one process at a time. Confirmed showing blank on the live site as of this session — expected, needs the next sync (see below), not a bug.
3. **Painting: Internal vs External Blasting combined into one butterfly chart** (shipped 2026-09-04): replaces the two separate single-process charts with one diverging chart (Internal up / External down from zero, plus a combined-total label at the zero line), a From/To range filter defaulting to the last 20 periods, and data labels added to the other 4 Process Output Over Time charts (Primer/Pickling/PDI Offer/PDI Clearance).

**#2 and #3 require the "Sync from Google Drive" GitHub Action to be re-run** before they show real data on the live site — the code is published, but the last syncs predate both. Run it, then check the Painting page:
- "Output by Bay" chart (below "Process Output Over Time") shows real bars instead of being empty.
- "Internal vs External Blasting" (top of "Process Output Over Time", full-width) shows a diverging chart with real weekly bars, per-bar labels, and the dark combined-total pill at the zero line — not empty.

## Known open item

The user said (2026-09-03) "I have some more things to add in Painting" before pivoting to the Production investigation — content not yet given. Ask what those are if picking Painting back up.

## Housekeeping note (not urgent)

Local git push doesn't work in this environment (no stored credentials) — all publishing this session was done via GitHub's web "Upload files" UI. The local git branch has also drifted from `origin/main`'s real history (confirmed to be encoding/line-ending noise, not real content differences, the one time it was checked). Don't try to reconcile it unless a task specifically needs local git history — work directly against files and publish via web-upload as this session did.
