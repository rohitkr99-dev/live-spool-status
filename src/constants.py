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

PLANNED_START = "Planned Start"
ACTUAL_START_DATE = "Actual Start Date"
FIRST_FITUP = "First Fit-Up"
FIRST_WELDING = "First Welding"
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
LH_LAST_WELDING_FRUN = "LH Last Welding FRun Date"

SIOP_PLANNED_START = "SIOP Planned Start"

CURRENT_STAGE = "Current Stage"
NEXT_STAGE = "Next Stage"

TOTAL_AGE = "Total Age"
STAGE_AGE = "Stage Age"

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
