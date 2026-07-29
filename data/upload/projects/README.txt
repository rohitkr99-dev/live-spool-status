Projects - upload folder
---------------------------------------------------------
This is the folder for the "Projects" dashboard on the landing page
(website/dashboard.html) - the DPR / Weekly Production Planning /
Line History Sheet pipeline. Drop those workbooks directly into this
folder (data/upload/projects/), then run:

    python3 main.py

This file exists only so the empty folder can be tracked and uploaded
through GitHub's web interface (git doesn't track empty folders, and
GitHub's browser uploader won't create one on its own). Delete this
file once you've added real workbooks here - it's ignored by the
pipeline either way (see src/departments.py -> has_uploaded_files()).

Expected files (see config/settings.json -> input_files for the exact
filename patterns each one is matched against):
  - a DPR workbook (*DPR*.xlsb)
  - a Weekly Production Planning workbook (*Weekly*.xlsb)
  - a Line History Sheet workbook (*Line*History*.xlsb) - optional
  - a SIOP Planned Spools workbook (*SIOP*Planned*Spools*.xlsb) - optional fallback

IMPORTANT if you're migrating from an earlier version of this repo:
these files used to live directly in data/upload/ (one level up), and
briefly in data/upload/production/ (a naming mistake - that folder
name collides with the separate "Production" department on the
landing page, which is a different, not-yet-built dashboard; see
data/upload/production/README.txt). config/settings.json ->
paths.upload_folder now points here (data/upload/projects/) instead -
move your existing DPR / Weekly Production / Line History workbooks
into this folder, or the pipeline won't find them.
