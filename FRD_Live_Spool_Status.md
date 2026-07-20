Live Spool Status & Ageing System
Functional Requirements Document (FRD)

Version: 1.0

1. Project Objective

Develop a web-based application to monitor the live fabrication status and ageing of piping spools.

The system shall:

Read production Excel files.
Merge data from multiple sources.
Calculate spool ageing automatically.
Display live dashboards.
Allow searching and filtering.
Export filtered information to Excel.
Automatically refresh whenever the latest Excel files are available.

The application should be designed to allow future expansion without changing the core architecture.

2. Data Sources
Source 1

DPR Fabrication

Sheet:

Detailed Sheet

Purpose:

Master fabrication status.

Contains:

Project
Drawing
Spool
Production dates
QC dates
Painting dates
Packing dates
Source 2

Weekly Production Planning

Sheets

Master Planning

Fit-Up DB

Welding DB

Purpose

Planning

Fit-up summary

Welding summary

3. Unique Identification

Every spool shall be uniquely identified by

Project Code

+

Drawing Number

+

Spool Number

This Composite Key shall be used for

Merge
Search
Update
Status
Export

The system shall never merge using only Spool Number.

4. Master Spool Table

The system shall generate one record per spool.

Fields include:

Identification
Project Code
Project Name
Drawing No
Spool No
Composite Key
Planning
Planned Week
Planned Start Date
Group
Production
First Fit-up Date
First Welding Date
First Activity Date
Quality
PDQC Date
RFP Date
Inspection
PDI Date
Dispatch
Packing Date
Calculated
Current Stage
Stage Age
Total Age
Delay Flag
Completed
Planned/Unplanned
5. Ageing Rules
Planned Spools

Age Flow

Start Date

↓

First Fit-up/Welding

↓

PDQC

↓

RFP

↓

PDI

↓

Packing

Only the current stage shall have an Age.

Completed stages shall have Age = 0.

Negative Age = 0.

Unplanned Spools

Age starts from

First Fit-up

or

First Welding

Remaining flow remains identical.

6. Current Stage Rules

The application shall determine Current Stage automatically.

Possible values

Waiting Fit-up
PDQC Pending
RFP Pending
PDI Pending
Packing Pending
Completed
7. Dashboard

Executive Dashboard

KPIs

Total Spools
Planned
Unplanned
Completed
Average Age
Oldest Spool
8. Search

Search by

Project
Drawing
Spool
Composite Key
9. Filters

Global Filters

Project
Week
Group
Material
Current Stage
10. Export

Every table shall support

Export to Excel.

11. Auto Refresh

The application shall periodically check a configured folder for updated Excel files.

If newer files are detected

Read Excel
Process Data
Generate JSON
Refresh Dashboard
12. Exceptions

Generate an Exceptions report for:

Duplicate Composite Keys
Missing Keys
Invalid Dates
Missing Planning
Logical Date Errors
13. Architecture
Excel

↓

Processing Engine

↓

Master Spool Table

↓

Dashboard

↓

GitHub
14. Future Scope
ERP Integration
Power BI
AI Predictions
Mobile App
Email Notifications
