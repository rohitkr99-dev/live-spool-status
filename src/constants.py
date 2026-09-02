"""
constants.py
---------------------------------
Application-wide constants.

These values should be imported
throughout the project instead of
hardcoding strings.
"""

# ==================================================
# Column Names
# ==================================================

PROJECT_CODE = "Project Code"
PROJECT_NAME = "Project Name"
DRAWING_NO = "Drawing No"
SPOOL_NO = "Spool No"
COMPOSITE_KEY = "Composite Key"

MATERIAL = "Material"
TOTAL_JOINTS = "Total Joints"

# From the Weekly Production Planning workbook's Master Planning
# Sheet, column BJ "Material/Hold Status" (given by the person,
# 2026-08-26 - found via his own question "Didn't you map Column BJ
# 'Material/Hold Status'?", not previously read by the pipeline at
# all). Raw values seen: "1. Confirm from Production" (the default/
# normal state - not flagged), "2. MNA Spool" (Material Not
# Available), "3. Hold Spool". MATERIAL_HOLD_STATUS_RAW is that text
# as-is; MATERIAL_HOLD_STATUS is normalized to "MNA" / "Hold" / None
# (see merge.py -> apply_material_hold_status()) for display and for
# ageing-day subtraction. This is a SEPARATE signal from the Rework
# Data workbook's Hold status (hold_ledger.py / REWORK_LATEST_STATUS)
# - a spool can be MNA/Hold here without ever appearing in the
# Rework workbook at all, since this reflects Production's own
# material/scheduling status, not QC's inspection status.
MATERIAL_HOLD_STATUS_RAW = "Material Hold Status Raw"
MATERIAL_HOLD_STATUS = "Material Hold Status"

# From the same Master Planning Sheet, columns BT "Week Planned"
# (already WEEK below) and CB "Initial Week Planned" - his own
# manual convention (given 2026-08-26, in his own words): "I keep
# both the columns same when adding the spool for the first time...
# if a spool comes under MNA/Hold category and it gets cleared after
# some days/weeks, I change only column BT while keeping column CB
# unchanged." The gap between them, converted from fiscal week
# numbers to real calendar dates (utils.week_number_to_start_date())
# and then to working days (utils.working_day_variance(), same
# holiday calendar as every other ageing figure), is how many
# working days a spool's schedule slipped due to Hold/MNA - see
# merge.py -> apply_material_hold_ageing_reduction().
INITIAL_WEEK_PLANNED = "Initial Week Planned"
MATERIAL_HOLD_WORKING_DAYS_LOST = "Material Hold Working Days Lost"

PLANNED_START = "Planned Start"
ACTUAL_START_DATE = "Actual Start Date"
FIRST_FITUP = "First Fit-Up"
FIRST_WELDING = "First Welding"
WELDING_FINISH = "Welding Finish"
FIRST_ACTIVITY_DATE = "First Activity Date"
LAST_ACTIVITY_DATE = "Last Activity"

WEEK = "Week"
GROUP = "Group"
PLANNING_VARIANCE = "Planning Variance"
COMPLETION_DATE = "Completion Date"
TOTAL_WEIGHT = "Total Wt."
REMARKS = "Remarks"

PDQC = "PDQC"
RFP = "RFP"
PDI = "PDI"
PACKING = "Packing"
DISPATCH = "Dispatch"

JOINT_NO = "Joint No"
WELD_FITUP_DATE = "Weld FitUp Date"
WELDING_FRUN_DATE = "Welding FRun Date"
LINE_HISTORY_STAGE = "Line History Stage"
LH_FITUP_LAST_DATE = "LH Fit-Up Last Date"
LH_WELDING_AGE = "LH Welding Age"

# Welder Performance workbook (data/upload/quality/) - see
# reader.py -> read_welder_performance() and
# src/quality/welder_performance.py
WELDER_PERFORMANCE = "welder_performance"
WELDER_MONTH = "Month"
WELDER_JOB_NO = "Job No"
WELDER_ID = "Welder ID"
WELDER_PROCESS = "Welding Process"
WELDER_TOTAL_WELD_JOINT = "Total Weld Joint"
WELDER_TOTAL_NDT_JOINT = "Total NDT Joint"
WELDER_NDT_ACCEPT_JOINT = "NDT Accept Joint"
WELDER_REJECTED_JOINT = "Rejected Joint"
WELDER_TOTAL_NDT_LENGTH = "Total NDT Length"
WELDER_NDT_ACCEPTED_LENGTH = "NDT Accepted Length"
WELDER_NDT_REJECTED_LENGTH = "NDT Rejected Length"
WELDER_DEFECT_TYPE = "Type of Defect"

# Project Code -> Project Name master list (data/upload/projects/),
# hand-maintained, updated from time to time - see
# reader.py -> read_project_master()
PROJECT_MASTER = "project_master"
LH_LAST_WELDING_FRUN = "LH Last Welding FRun Date"

SIOP_PLANNED_START = "SIOP Planned Start"

REWORK_OFFER_DATE = "Prod Offer Date"
REWORK_FINAL_STATUS = "Final Status"
REWORK_TYPE = "Rework Type"
REWORK_LATEST_STATUS = "Rework Latest Status"

# Column K of the Production Rework Data workbook, "Packing Release
# Date". Despite the name, QC uses this column to record the actual
# outcome of the offer event as free text ("Packing Release", "RFP",
# "Project Hold", "Rework", etc.) - NOT a date. Per the person
# (2026-08-31), this replaces the old "Final Status" (column I) as
# the single source of truth for Accept/QC Hold/Rework - see
# src/rework_pdqc_rule.py -> normalize_rework_status().
REWORK_PACKING_STATUS = "Packing Release Date"

MH_GROUP = "MH Group"
MH_QTY = "MH Qty"
MH_SPOOL_SIZE = "MH Spool Size"
MH_INCH_DIA = "MH Inch Dia"
MH_DEPARTMENT = "MH Department"
MH_FIRST_STATUS = "MH First Status"
MH_CURRENT_STATUS = "MH Current Status"
MH_HANDOVER_DATE = "MH Handover Date"
MH_EXPECTED_DATE = "MH Expected Date"

CURRENT_STAGE = "Current Stage"
NEXT_STAGE = "Next Stage"

TOTAL_AGE = "Total Age"
STAGE_AGE = "Stage Age"

# Given by the person, 2026-08-26: two extra columns on the Projects
# spool list, each of these minus the Material/Hold Status Week-gap
# figure (MATERIAL_HOLD_WORKING_DAYS_LOST above) - the same flat
# reduction already applied to Production ageing, now also on
# Projects' Total Age and Stage Age. Deliberately excludes the
# Rework Data workbook's Hold ledger (hold_ledger.py) - his explicit
# choice when asked which Hold source these columns should reflect.
TOTAL_AGE_EXCL_HOLD = "Total Age (excl. Hold Period)"
STAGE_AGE_EXCL_HOLD = "Stage Age (excl. Hold Period)"

STATUS_MESSAGE = "Status Message"

PLANNED_FLAG = "Planned"
COMPLETED_FLAG = "Completed"

# ==================================================
# Source Names
# ==================================================

FABRICATION = "fabrication"
PLANNING = "planning"
LINE_HISTORY = "line_history"
SIOP_PLANNED = "siop_planned"
REWORK = "rework"
MATERIAL_HANDOVER = "material_handover"

# QC's continuous PDQC Inspection Data log (2026-09-02) - see
# reader.py -> read_inspection_data() and src/quality/summary.py.
# Its own "Final Status" column is unrelated to REWORK_FINAL_STATUS/
# REWORK_PACKING_STATUS above - a different workbook, with a raw
# free-text vocabulary of ~150 defect-type values (mostly the
# specific rework reason itself, e.g. "Bend", "Not Found") rather
# than the Rework Data workbook's small controlled status list.
INSPECTION_DATA = "inspection_data"
INSPECTION_DATA_COLUMNS = [
    "Project Code", "Drawing No", "Spool No", "Material",
    "Spool Size", "Prod Offer Date", "Insp Remark", "Final Status",
    "Prod Engineer",
]

# Derived (not read from any sheet - computed in
# reader.py -> read_inspection_data()): True when a row's Prod Offer
# cell held multiple "/"-separated dates (a re-offer) but its Final
# Status is literally "Accept" - confirmed against the real file
# (2026-09-02, given by the person) that this combination almost
# always means a real deficiency was found and corrected before
# acceptance (e.g. Insp Remark "tag/punching balance, SS tag
# required" recorded as Accept), which the single Final Status value
# alone doesn't capture. src/quality/summary.py's
# _with_inspection_status() treats a True row as Rework regardless
# of its literal "Accept" status.
INSPECTION_REOFFERED_BEFORE_ACCEPT = "Reoffered Before Accept"

# ==================================================
# Log Messages
# ==================================================

APPLICATION_STARTED = "Application started"

READING_FABRICATION = "Reading fabrication workbook"

READING_PLANNING = "Reading planning workbook"

VALIDATION_STARTED = "Validation started"

MERGE_STARTED = "Merge engine started"

BUSINESS_RULES_STARTED = "Business Rule Engine started"

AGEING_STARTED = "Ageing Engine started"

SUMMARY_STARTED = "Summary Engine started"
