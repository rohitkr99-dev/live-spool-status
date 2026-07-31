# Production Department Dashboard

`website/production.html` — spool ageing by category against a target-day
matrix. Confirmed with the project owner against real DPR/Weekly Planning/
Line History data on 2026-07-30.

This is a **separate, additive pipeline** (`src/production/`,
`production_main.py`) from the Projects pipeline (`src/pipeline.py`,
`main.py`). It reads the **same** DPR / Weekly Production Planning / Line
History Sheet workbooks already in `data/upload/projects/` — nothing new to
upload or sync from Google Drive — but computes and displays a different
view of them. It does not import from, or modify, `src/pipeline.py`,
`src/merge.py`, `src/business_rules.py`, or `src/ageing.py`.

## Categories

Every spool is classified into exactly one of 5 categories, in this order
(`src/production/classify.py`, config `config/production_rules.json`):

1. **Spool Size is 0/blank AND Inch Dia is 0/blank** → always category 1
   (`<=8 Joint Single Spool - CS/SS`), regardless of actual material or
   joint count.
2. **Spool Size <= 2** (any material, any joint count) → `SB`.
3. Otherwise, by Material and Total Joints:
   - Material in `{F11, P11, P22, P91}` → `AS`; anything else (CS, SS,
     DUPLEX, or unrecognised) → the combined `CS/SS` bucket (the target
     table gives CS and SS identical targets).
   - Total Joints <= 8 → `<=8 Joint`; > 8 → `>8 Joint`. A blank/unreadable
     Total Joints defaults to `<=8 Joint`.

## Target-day matrix

Target day, counted from Planned Start (day 1), per category:

| Stage                 | <=8 CS/SS | >8 CS/SS | <=8 AS | >8 AS | SB |
|------------------------|:---:|:---:|:---:|:---:|:---:|
| Planned Start          | 1   | 1   | 1   | 1   | 1  |
| Welding Finish         | 5   | 8   | 8   | 12  | 5  |
| PDQC                    | 6   | 11  | 12  | 16  | 9  |
| Release for Painting    | 10  | 15  | 16  | 20  | 13 |
| PDI Clearance           | 14  | 19  | 20  | 24  | 17 |
| Packed                  | 15  | 20  | 21  | 25  | 18 |

PWHT is deliberately not tracked (not every spool needs it, and it isn't
in scope for this dashboard yet).

## Welding Finish

The DPR's own `5. Welding` column is 100% blank (confirmed on real data),
so "Welding Finish" (the date the LAST joint finished welding — not to be
confused with the Projects pipeline's `First Welding`, the start of the
Welding stage) is derived (`src/production/welding_finish.py`):

For a spool found in the Line History Sheet with >=1 non-blank `Joint No.` row:

1. Every joint's `Welding FRun Date` filled → Welding Finish = latest (max)
   of those dates.
2. Some/all blank, but DPR's PDQC date is already filled → Welding Finish =
   PDQC date − 1 day.
3. Some/all blank, no PDQC yet → still in progress. No Welding Finish date;
   age = Today − Planned Start.

For a spool NOT found in the Line History Sheet:

4. DPR's PDQC (or later) is already filled → Welding Finish = latest
   Activity Date for that spool in the Weekly workbook's Welding DB sheet.
   If that spool isn't in Welding DB either, falls back to PDQC − 1 day.
5. No PDQC/later dates anywhere → not started. No Welding Finish date; age
   = Today − Planned Start.

Every "in progress" / "not started" spool is aged as `Today - Planned
Start` for this dashboard — a rule specific to this Production Table, not
a change to the Projects pipeline's existing Stage Age logic.

## Ageing / delay

`src/production/ageing.py` walks each spool through Welding Finish → PDQC
→ Release for Painting → PDI Clearance → Packed, in order, to find its
"current stage" (the first one not yet reached). A spool is flagged
**delayed** if its age at that current position (days since Planned Start)
already exceeds that stage's target for its category. Spools with no
Planned Start (not found in the Master Planning Sheet) are excluded from
ageing but still counted in the category distribution.

## Output

`src/production/pipeline.py` writes `production_data.json`
(`processed/` always, `website/data/` if publishing is enabled) — see
`src/production/summary.py` for the exact structure. The website only
displays these pre-calculated numbers; no aggregation happens in
JavaScript.

## Charts (website/production.html)

1. Spool distribution by category (pie).
2. Ideal vs. actual total cycle time, Planned Start → Packed, all 5
   categories side by side (grouped bar — deliberately not stacked).
3–7. One chart per category: target day vs. average actual day, per
   stage (grouped bar).

## Next steps

The project owner has indicated more Production-specific charts are
planned, fed by workbooks dropped into `data/upload/production/` (still
reserved, not yet wired to anything — see its `README.txt`). That's a
separate expansion on top of what's live here.
