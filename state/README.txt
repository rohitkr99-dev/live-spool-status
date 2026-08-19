state/
======

Small, hand-off-limits JSON files the pipeline itself maintains
across runs - NOT user-uploaded data (that's data/upload/) and NOT
regenerated fresh every run (that's processed/, gitignored). Files
here are committed to git by every drive-sync run precisely because
they need to survive between runs.

hold_tracking.json
-------------------
ABSOLUTE RULE #2 (docs/absolute-rules.md), added 2026-08-19. Records
every spool ever seen on "Project hold" status in the Production
Rework Data workbook, and the offer date it was first seen there -
so that date can still be used as the spool's PDQC anchor even after
the workbook itself is edited to show Accept (the Hold row can be
edited in place, with no new row added, so the fact it was ever held
would otherwise be lost once resolved).

Written and read by src/rework_pdqc_rule.py -> 
_load_hold_tracking_store() / _save_hold_tracking_store() - see that
module's docstring for the full rule. Do not hand-edit this file
under normal circumstances; if a spool is incorrectly flagged as a
Hold Exception (re-entered Hold after a previous resolution) on the
Projects dashboard's Exceptions tab, the correct fix is almost always
to correct the Production Rework Data workbook itself and let the
next pipeline run resolve it naturally - not to hand-edit this file.

Format: {"<Composite Key>": {"hold_offer_date": "<ISO date>",
"still_on_hold": true|false}, ...}
