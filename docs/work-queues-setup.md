# Work queues and handoffs setup

The new page reads active spool rows and stage age from the same published
`dashboard_data.json` bundle used by the existing dashboard. It does not write
to that bundle or change the production pipeline's calculated fields.

Claims and handoffs are stored separately in Cloud Firestore. Optional Excel
handover files are stored in Cloud Storage. This repository already configures
Firebase Authentication, but does not currently configure either shared store.
Before enabling shared actions and file uploads:

1. In the Firebase console for project `dee-live-dashboard`, create the default
   Cloud Firestore database in production mode (if one does not already exist).
2. Review `firestore.rules` with the project owner/security administrator and
   publish those rules to the Firestore database. The rules permit signed-in
   dashboard users to read queue/handoff records, let a user release their own
   claim, and prevent deletion of handoff history.
3. In the Firebase console, enable Cloud Storage for the existing project. Review
   `storage.rules` and publish them to the bucket. Workbook uploads are limited
   to Excel `.xls` / `.xlsx` files up to 15 MB. Files are readable by signed-in
   portal users and can only be deleted by their uploader.
4. Deploy `website/work-queues.html`, `website/css/work-queues.css`,
   `website/js/work-queues.js`, and the updated operations hub through the
   existing GitHub Pages deployment.

If Firestore is not enabled or its rules are not published, the page still
loads live spool records in read-only mode and explains why team actions are
unavailable. It never falls back to browser-only storage for a shared claim.
If Cloud Storage is not enabled, handoff records without an Excel attachment
continue to work; sending a handoff with a workbook reports the setup issue.

Handoffs are visible to every signed-in portal user because the current portal
has no department-to-account role mapping. If acknowledgement must be restricted
to the receiving department, that role mapping and corresponding Firestore rule
need to be agreed and added before production use.

The existing published spool bundle is served as a static file and may be
readable outside the authenticated page. This feature does not broaden that
existing exposure; it adds no new spool-data endpoint.

