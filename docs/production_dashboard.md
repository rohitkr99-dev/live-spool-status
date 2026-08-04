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

| Key | Displayed as |
|---|---|
| `le8_cs_ss` | &le;8 Joints (CS/SS) |
| `gt8_cs_ss` | >8 Joints (CS/SS) |
| `le8_as` | &le;8 Joints (Alloy) |
| `gt8_as` | >8 Joints (Alloy) |
| `sb` | Small Bore (CS/SS/AS) |


1. **Spool Size is 0/blank AND Inch Dia is 0/blank** → always category 1
   (`le8_cs_ss`, displayed as "&le;8 Joints (CS/SS)"), regardless of actual
   material or joint count.
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

## Production Order Release (Rule 0)

Before anything else, `src/production/ageing.py` excludes any spool whose
`Prod Order Release` date (DPR) is blank — same principle as the existing
Projects pipeline's "Production Order Not Released" rule
(`src/business_rules.py`). An unreleased spool isn't active in production
yet, so it's excluded entirely: not counted in the category distribution,
ageing, or any chart, and never shown as a "missing Planned Start" gap.

This was confirmed after a first pass got it wrong: of the 966 spools that
initially looked like they had no Planned Start, 918 turned out to simply
be un-released — expected, not a gap. Only 48 were genuinely released
with no Planned Start recorded anywhere. On the project owner's real data
this brings `total_spools` from 8,881 down to 7,963.

## Planned Start / SIOP fallback

Planned Start comes from the Weekly workbook's Master Planning Sheet
(`Start Date` column) first. For a spool that workbook has no row for,
`src/production/ageing.py` falls back to the SIOP Planned Spools
workbook's `Start Date` column (`config/settings.json` →
`input_files.siop_planned`, optional) — but only to fill the gap, never
to override a Planned Start the Master Planning Sheet already gave. On
the project owner's real files (2026-07-31): of the 7,963 released
spools, 3,711 were initially missing Planned Start from the Weekly
workbook alone; the SIOP file covered 2,745 of those, leaving 48 still
missing (not in either workbook — no anchor date exists for them at all,
so they're excluded from ageing but still counted in the category
distribution).

Note: the SIOP workbook's real column is named `Start Date`, not
`Planned Start Date` as `config/column_mapping.json`'s `siop_planned`
section expects — so that mapping likely never actually renamed
anything, in either this dashboard or the existing Projects pipeline's
own SIOP fallback (`src/merge.py` → `apply_siop_fallback()`). This
dashboard reads the real column name directly
(`production_rules.json` → `welding_finish_fields.siop_planned_start_field`)
rather than relying on that mapping. The Projects pipeline's own copy of
this bug was flagged to the project owner but not fixed here, since
`column_mapping.json` is shared with that pipeline.

## Spool List table + global chart filters

`website/production.html` also has a full spool list table
(`js/production-table.js`) - one row per spool, every column has its own
multi-select filter (funnel icon in the header), and a subtotal row
reflects whatever combination of filters is currently applied (sum for
Quantity/Weight/Surface Area, average for the day/size columns, count for
everything else). The 5 stage-day columns show the INDIVIDUAL time each
stage took - the gap since the previous milestone, not the cumulative
day count from Planned Start (a spool reaching PDI Clearance on
cumulative day 100 and Packed on cumulative day 105 shows a Packed age
of 5, not 105). A stage the spool has already passed shows that
individual gap; the one stage currently in progress shows a running
count since the last-reached milestone; everything after that is blank -
see `src/production/summary.py` -> `_stage_display_days()`. Note this is
a different number from the charts above the table: the charts compare
CUMULATIVE actual vs. the cumulative target-day matrix (the matrix the
project owner supplied is itself cumulative from Planned Start), while
the table exists to show where time is actually being spent stage by
stage.

Each spool row in the bundle therefore carries BOTH fields -
`stage_days` (individual, table only) and `stage_days_cumulative`
(cumulative, charts only, via `_stage_cumulative_days()`) - and they
must stay separate. A 2026-08-03 regression had the charts briefly
reading `stage_days` (the individual-duration field) instead of
`stage_days_cumulative`, which made every "Actual" bar look tiny next
to the correctly-cumulative Target bar - fixed in
`js/production-filters.js`.

Above the charts, a separate global filter bar controls all 7 charts at
once: a metric switcher (Spool Count / Quantity / Inch Dia / Weight /
Surface Area) and a Project multi-select. These are intentionally
independent of the table's per-column filters - two separate filter
systems sharing the same underlying per-spool array.

**Architecture note:** this pushed chart aggregation itself into
JavaScript (`js/production-filters.js` -> `ProductionAggregate`), a
change from the dashboard's original all-in-Python design. That was
unavoidable once charts needed to react to an open-ended combination of
metric + Project selections - Python can't precompute every combination
in advance. The per-spool numbers charts aggregate FROM (category,
Welding Finish, days per stage, delayed flag, weight/quantity/etc.) are
still 100% computed in Python (`src/production/summary.py` ->
`build_spool_rows()`) and shipped in `production_data.json` -> `spools`;
JS only groups, sums, and averages what Python already calculated. The
non-metric-based numbers in `stage_ageing`/`ideal_vs_actual`/
`category_distribution` at the top of the bundle are still computed in
Python too (unfiltered, Spool-Count-weighted) but are no longer read by
the charts - kept for now as a simple unfiltered reference/fallback.

Weighted averages: when a non-count metric is selected, each stage's
"Actual" bar becomes a weighted average of each spool's day count,
weighted by that spool's value for the selected metric (a heavier spool
counts for more of the average). Target bars never change with the
metric - a target is a fixed per-category constant, there's no
"weighted" version of it.

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

`.github/workflows/drive-sync.yml` runs `production_main.py` right after
`main.py` on every Drive sync that changes a file, so newly-released
spools (or a newly-uploaded SIOP file) flow through automatically -
Rule 0 above is checked fresh on every run, nothing is cached. This step
is `continue-on-error: true` so a Production pipeline failure never
blocks the Projects dashboard's own commit/push.

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
