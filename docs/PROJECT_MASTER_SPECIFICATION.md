# PROJECT MASTER SPECIFICATION
## Live Spool Status & Ageing System

**Version:** 1.0

Prepared By:
Lead Solution Architect

---

# 1. PROJECT OVERVIEW

## Objective

Develop a professional Production Intelligence System for fabrication spool monitoring.

This application shall read multiple Excel files, merge them into one Master Spool Dataset, calculate fabrication status and ageing, and present the information through a modern web dashboard.

The application is intended for production engineers, planning engineers, project management, and senior management.

This is NOT just a dashboard.

This is a production monitoring platform.

---

# 2. PROJECT GOALS

The application shall:

• Read multiple Excel workbooks
• Merge production data
• Track spool lifecycle
• Calculate ageing
• Display live KPIs
• Provide search
• Export data
• Refresh automatically
• Be extendable for ERP integration

---

# 3. PROJECT PRINCIPLES

The project must follow these principles.

## Rule 1

Business Logic is more important than UI.

## Rule 2

Dashboard never calculates anything.

All calculations happen in Python.

## Rule 3

Dashboard only reads JSON.

## Rule 4

Every module has a single responsibility.

## Rule 5

Everything must be configurable.

Never hardcode sheet names, file names or business rules.

---

# 4. TECHNOLOGY STACK

Backend

Python 3.12

Libraries

pandas

pyxlsb

openpyxl

watchdog

xlsxwriter

jinja2

Frontend

HTML

CSS

Vanilla JavaScript

Chart.js

DataTables

Hosting

GitHub Pages

Desktop-first deployment

---

# 5. PROJECT STRUCTURE

```
Live Spool Status & Ageing System

│

├── backups/

├── config/

│   ├── settings.json

│   ├── schema.json

│   ├── stages.json

│   └── business_rules.json

├── data/

│   ├── upload/

│   └── archive/

├── docs/

├── logs/

├── processed/

├── src/

├── tests/

├── website/

└── README.md
```

---

# 6. CURRENT DEVELOPMENT STATUS

Completed

✅ Foundation

✅ Configuration

✅ Logging

✅ Excel Reader

✅ Validation Engine

✅ Merge Engine

✅ Initial Ageing Engine

Pending

⬜ Business Rule Engine

⬜ Summary Engine

⬜ Dashboard

⬜ Search

⬜ Export

⬜ Auto Refresh

---

# 7. DATA SOURCES

Workbook 1

DPR Fabrication Jobs

Sheet

Detailed Sheet

Purpose

Master production database.

Contains

Project

Drawing

Spool

Material

Production dates

QC dates

Packing

Dispatch

---

Workbook 2

Weekly Production Planning

Sheets

Master Planning Sheet

Fit-Up DB

Welding DB

Purpose

Planning

Production

Fit-up

Welding

Weekly summaries

---

# 8. UNIQUE IDENTIFICATION

This is the most important rule.

Every spool is uniquely identified by

Project Code

+

Drawing No

+

Spool No

This Composite Key shall be used everywhere.

Never merge only using Spool Number.

---

# 9. MASTER SPOOL DATASET

Every spool becomes one record.

Fields include

Identification

Project Code

Drawing No

Spool No

Composite Key

Planning

Week

Start Date

Group

Material

Total Joints

Production

First Fit-Up

First Welding

First Activity

PDQC

RFP

PDI

Packing

Calculated

Current Stage

Stage Age

Total Age

Completed

Planned

Delay

Next Stage

Last Activity

Status Message

---

# 10. BUSINESS RULES

## Planned Spools

Age Flow

Planned Start

↓

First Fit-Up OR First Welding

↓

PDQC

↓

RFP

↓

PDI

↓

Packing

---

## Unplanned Spools

Age starts from

First Fit-Up

OR

First Welding

Remaining stages remain identical.

---

Negative Age

Return Zero.

---

Completed

Packing completed

↓

Completed=True

Stage Age=0

---

# 11. CURRENT STAGE

Current Stage is NOT

Last completed stage.

Current Stage is

The FIRST incomplete milestone.

Example

PDQC Complete

RFP Blank

Current Stage

Waiting for RFP

---

# 12. TOTAL AGE

If Planned

Today

-

Planned Start

If Unplanned

Today

-

First Activity

Negative

↓

0

---

# 13. STAGE AGE

Current Date

-

Current Stage Start

Negative

↓

0

---

# 14. BACKEND ARCHITECTURE

```
Excel

↓

Reader

↓

Validation

↓

Business Rule Engine

↓

Merge Engine

↓

Ageing Engine

↓

Summary Engine

↓

Processed JSON

↓

Dashboard
```

---

# 15. MODULE RESPONSIBILITIES

Reader

Only reads Excel.

Validation

Only validates.

Business Rules

Determines

Current Stage

Completed

Next Stage

First Activity

Merge

Creates Master Dataset.

Ageing

Calculates Stage Age

Total Age

Summary

Generates Dashboard JSON.

Dashboard

Displays only.

No calculations.

---

# 16. JSON FILES

master_spools.json

dashboard_summary.json

project_summary.json

weekly_summary.json

fitup_summary.json

welding_summary.json

exceptions.json

validation_report.json

---

# 17. DASHBOARD DESIGN

Top KPI Cards

Total Spools

Planned

Unplanned

Completed

Average Age

Oldest Spool

Planning Variance

---

Current Stage

Planning

Production

PDQC

RFP

PDI

Packing

Completed

---

Charts

Project Progress

Weekly Progress

Department Progress

---

Tables

Oldest Spools

Search Results

Exceptions

---

# 18. SEARCH

Search by

Project

Drawing

Spool

Composite Key

Material

Group

Remarks

---

# 19. FILTERS

Project

Week

Group

Material

Current Stage

Status

Planning

---

# 20. EXPORT

Every table shall support

Export to Excel.

---

# 21. AUTO REFRESH

Application monitors

data/upload/

When newer Excel files arrive

↓

Reader

↓

Validation

↓

Merge

↓

Ageing

↓

Summary

↓

Dashboard Refresh

---

# 22. CODING STANDARDS

PEP8

Type Hints

Docstrings

Logging

Small Functions

No duplicated code

Single Responsibility Principle

Configuration-driven

---

# 23. DEVELOPMENT PHILOSOPHY

Do NOT generate generic dashboard code.

Business Logic must exactly follow fabrication workflow.

Configuration files must drive behaviour.

No business rules inside HTML.

No business rules inside JavaScript.

Python is the single source of truth.

---

# 24. FUTURE ROADMAP

AI Delay Prediction

Power BI Integration

ERP Integration

Email Alerts

WhatsApp Alerts

Mobile App

User Authentication

Role Management

Historical Trends

Machine Learning

---

# 25. IMPORTANT ARCHITECTURAL DECISIONS

Do NOT redesign the project.

Current architecture has been approved.

Improve existing modules instead of rewriting everything.

Reader and Config modules are considered stable.

Validator should be enhanced, not replaced.

Merge Engine should remain modular.

Ageing Engine must be rewritten according to business rules.

Dashboard must read JSON only.

---

# 26. CURRENT TASK FOR THE NEXT CHATGPT SESSION

Continue development.

Do NOT restart the project.

Next module to build:

Business Rule Engine

Create

src/business_rules.py

Responsibilities

Determine Current Stage

Determine Next Stage

Determine Completed Flag

Determine Planned Flag

Determine First Activity Date

Determine Status Message

No Ageing calculations.

No Dashboard code.

After Business Rule Engine

Proceed to rewrite Ageing Engine using the finalized business rules.

---

# FINAL INSTRUCTION TO CHATGPT

You are joining an existing software project as the Lead Software Engineer.

Assume the architecture has already been approved.

Do NOT redesign the application.

Continue development from the current state.

Review the existing source code before modifying any module.

Improve only what is necessary.

Preserve compatibility between modules.

Write production-quality code.

Test every module independently before proceeding.

Focus on correctness of business logic over speed of implementation.
