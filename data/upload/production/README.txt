Production - upload folder
---------------------------------------------------------
This folder is reserved for FUTURE Production-only charts that need
their own source workbooks - it's not used yet.

The "Production" landing page card (website/production.html) is now
LIVE, but its first set of charts (spool ageing by category vs. the
target-day matrix - see src/production/) reuses the SAME DPR /
Weekly Production Planning / Line History Sheet workbooks as
"Projects" (website/dashboard.html), read straight out of
data/upload/projects/. Nothing needs to be uploaded here for those
charts to work.

If you're looking for where to put DPR/Weekly Planning files, that's
still data/upload/projects/, not this folder.

This folder stays reserved for later: more Production-specific
charts, fed by different workbooks dropped in here, on top of the
ones already live. When that expansion happens, wire a new reader
into src/production/ (or a sibling module) the same way
src/packing/ was built - see src/departments.py for how to register
a folder like this once a pipeline actually reads it.

This file exists only so the empty folder can be tracked and uploaded
through GitHub's web interface (git doesn't track empty folders, and
GitHub's browser uploader won't create one on its own). Delete this
file once you've added real workbooks here - it's ignored by the
pipeline either way (see src/departments.py -> has_uploaded_files()).
