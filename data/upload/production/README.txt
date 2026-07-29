Production - upload folder
---------------------------------------------------------
This folder is reserved for the "Production" department's source
workbooks (data/upload/production/) - the landing page card that
currently links to website/production.html ("Coming Soon").

This is a different department from "Projects" (website/dashboard.html,
the DPR / Weekly Production Planning / Line History Sheet pipeline) -
if you're looking for where to put DPR/Weekly Planning files, that's
data/upload/projects/, not this folder.

There's no pipeline built for this department yet. Once you drop
files in here, python3 main.py will notice them and print a message
telling you a pipeline hasn't been built yet for this folder - it
won't error out, and it won't silently ignore them either. When
you're ready to build this department's dashboard, share the sample
workbook(s) and the metrics you want, the same way Packing & Dispatch
was built (see src/packing/ for that pipeline as a reference, and
src/departments.py for how to register a new one).

This file exists only so the empty folder can be tracked and uploaded
through GitHub's web interface (git doesn't track empty folders, and
GitHub's browser uploader won't create one on its own). Delete this
file once you've added real workbooks here - it's ignored by the
pipeline either way (see src/departments.py -> has_uploaded_files()).
