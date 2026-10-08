# Spool Traveler: joint details and the secure connection still needed

Spool search on the Spool Traveler page works today from the spool records the
site already publishes. Joint-level details (fit-up date and contractor, welding
date and welder, joint status) are **not** shown, and the page says so.

## Why joint details are not shown

The site's data files are static files in a public repository. Sign-in on the
site is a page-level check only, so anything stored as a static file can be
downloaded without signing in. Joint-level records include contractor and
welder names, so they must not be published that way. The repository has no
signed-in-only data path for them:

- Firestore and Cloud Storage are described in `docs/work-queues-setup.md` but
  are not enabled for the project, and no Firestore/Storage rules are deployed.
- The scheduled pipeline writes only static JSON bundles.

## What the page does today

- Searches all published spool records by Project, Drawing or Spool. Project +
  Drawing + Spool (the record's Composite Key) is the unique item.
- More than one match shows a candidate list; one item must be selected, and only
  that record is rendered.
- Stage dates come from the spool record: release, PDQC, FQC (DPR Detailed
  Sheet column BE, read by position), ready for painting, painting, packing and
  dispatch from the DPR; Plan is the Planned Start date; Material is the Material
  Handover workbook's handover date. PDQC is labelled Production; Ready for
  Painting is labelled QC. A date the published data does not carry at all says
  "No date published"; a blank one says "Not yet".
- Fit-up and welding dates are deliberately not taken from the spool record.
- No new data file, endpoint or stored copy was added.

## What is needed to turn joint details on

1. A store that only signed-in users can read (for example Cloud Firestore with
   rules requiring authentication, as sketched in `docs/work-queues-setup.md`).
2. A pipeline step that writes joint records to that store, never to
   `website/data/`.
3. Matching rules, per the plant's data rules:
   - Joint-level fit-up dates, welding dates and welder: the Line History data.
   - Fit-up contractor: the Fit-Up & Welding data, matched on the full
     Project + Drawing + Spool + Joint identity **and** the activity date.
     Never match on spool number alone.
4. An acceptance check: drawing `1-V17565-PIND-0012`, spool
   `V17565-PIND-0012-01` must show exactly one fit-up contractor (an earlier
   preview matched a second, wrong one). Drawing `2-V17565-PIND-0012` carries the
   same spool number and must stay separate.

QR lookup is planned for a later stage. This page generates no QR codes and
changes no existing labels.
