state/
======

Small, hand-off-limits JSON files the pipeline itself maintains
across runs - NOT user-uploaded data (that's data/upload/) and NOT
regenerated fresh every run (that's processed/, gitignored). Files
here are committed to git by every drive-sync run precisely because
they need to survive between runs.

hold_tracking.json
-------------------
Rule 2 (docs/absolute-rules.md), rewritten 2026-08-21. Records every
spool's real Hold periods (start/removal dates) from the Production
Rework Data workbook's "Project hold" status, so working days spent
on Hold can be subtracted from ageing calculations even after the
workbook itself is edited to show Accept (a Hold row can be edited
in place, with no new row added, so the fact it was ever held would
otherwise be lost once resolved).

Written and read by src/hold_ledger.py -> load_ledger() /
save_ledger() / update_hold_periods() - see that module's docstring
for the full mechanism, and src/rework_pdqc_rule.py for where it's
called from. Do not hand-edit this file under normal circumstances;
if a spool is incorrectly flagged as a Hold exception (an open Hold
jumping straight to Rework with no Accept in between) on the
Projects dashboard's Exceptions tab, the correct fix is almost
always to correct the Production Rework Data workbook itself and let
the next pipeline run resolve it naturally - not to hand-edit this
file.

Format: {"<Composite Key>": {"hold_periods": [{"hold_start": "<ISO
date>", "hold_removed": "<ISO date>|null"}, ...]}, ...} - a spool can
have any number of periods; "hold_removed": null means that period
is still open right now. An old-format entry ({"hold_offer_date":
..., "still_on_hold": ...}) migrates automatically the first time
it's touched - see hold_ledger.py's module docstring for exactly how.
