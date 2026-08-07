Quality Assurance / Control - upload folder
---------------------------------------------------------
This folder holds the Production Rework Data workbook - QC's own
record of every offer-for-inspection event per spool (Project Code,
Drawing No., Spool No, MAT, Size, Prod offer date, Prod Eng.,
QC observation, Final status, Type of Rework). Drop the latest
export in here (any filename containing "Rework", .xlsx - see
config/settings.json -> input_files.rework) and:

  - `python3 main.py` picks it up as part of the Projects pipeline,
    best-effort, purely to override PDQC (see src/reader.py ->
    read_rework() and src/merge.py -> apply_rework_pdqc_override()).
    A spool found in this workbook gets its PDQC replaced with the
    LATER of (its existing PDQC, the latest "Prod offer" date across
    all of its rows here) - PDQC never moves backwards. A spool not
    found here keeps its existing PDQC unchanged.

  - `python3 quality_main.py` builds the Quality Assurance/Control
    dashboard (website/quality.html) from the same workbook - top
    rework types, rework rate by project, first-offer acceptance,
    trend over time, and rework-cycle distribution. See
    src/quality/.

Like data/upload/packing/, files here aren't checked into git
(see .gitignore) - Google Drive sync (scripts/sync_drive.py,
the "quality" subfolder) or a manual upload through GitHub's web
interface repopulates this folder before each pipeline run.

This README exists only so the empty folder can be tracked and
uploaded through GitHub's web interface (git doesn't track empty
folders). It's ignored by both pipelines either way (see
src/departments.py -> has_uploaded_files()).
