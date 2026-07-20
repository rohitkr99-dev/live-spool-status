# Live Spool Status & Ageing System

A professional Production Intelligence System for monitoring fabrication spool progress, production ageing, planning status, and project KPIs.

---

## Overview

The **Live Spool Status & Ageing System** automatically reads fabrication and planning Excel files, validates the data, merges multiple datasets into a unified master spool database, applies fabrication business rules, calculates production ageing, and generates JSON files that drive a modern web dashboard.

The dashboard performs **no calculations**. All business logic resides in the Python backend, making the system accurate, maintainable, and ready for future ERP integration.

---

## Objectives

* Read multiple Excel workbooks
* Merge fabrication and planning data
* Track spool lifecycle
* Calculate stage ageing and total ageing
* Display live production KPIs
* Search and filter spool records
* Export reports to Excel
* Automatically refresh when new files are received
* Provide a foundation for ERP, AI, and Power BI integration

---

# Technology Stack

## Backend

* Python 3.12
* pandas
* openpyxl
* pyxlsb
* watchdog
* xlsxwriter
* jinja2

## Frontend

* HTML5
* CSS3
* Vanilla JavaScript
* Chart.js
* DataTables

## Deployment

* GitHub Pages (Dashboard)
* Desktop-first architecture

---

# Project Architecture

```
Excel Files
      │
      ▼
Excel Reader
      │
      ▼
Validation Engine
      │
      ▼
Business Rule Engine
      │
      ▼
Merge Engine
      │
      ▼
Ageing Engine
      │
      ▼
Summary Engine
      │
      ▼
JSON Output
      │
      ▼
Web Dashboard
```

---

# Running the Pipeline

Drop your workbooks into `data/upload/`:

* the DPR workbook (matches `input_files.fabrication.file_pattern` in `config/settings.json`)
* the Weekly Production Planning workbook (`input_files.planning.file_pattern`)
* optionally, the Line History Sheet (`input_files.line_history.file_pattern`) - joint-level Fit-Up/Welding data used to refine the Fit-Up/Welding/PDQC status, see `config/business_rules.json -> line_history_override`. If it isn't present, that refinement is simply skipped.

Then either:

```bash
# Process once and exit.
python3 main.py
```

or, so you never have to run the command again:

```bash
# Keep running in the background; automatically reprocesses within
# a few seconds of any file in data/upload/ being added, replaced,
# or removed.
python3 main.py --watch
```

Either way, this writes every file in `processed/`, including `processed/dashboard_data.json` - the single file you can upload into the dashboard (its "Upload Data" button) to preview it locally. The dashboard doesn't read `data/upload/` or `processed/` directly.

If `config/settings.json -> publishing.publish_to_website` is `true` (the default), the same bundle is *also* written to `website/data/dashboard_data.json`. That's the file a hosted copy of `website/` (e.g. GitHub Pages) automatically loads for every visitor - see "Publishing the Dashboard" below. Nobody viewing the hosted site needs to upload anything; only whoever runs the pipeline and pushes the update does.

---

# Publishing the Dashboard (GitHub Pages)

One-time setup, so anyone with the link can view the dashboard without running anything themselves:

1. Push this repository to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source**: choose **"GitHub Actions"**.
3. That's it. `.github/workflows/deploy-pages.yml` (already in this repo) publishes the `website/` folder to Pages automatically on every push to `main`.

Your GitHub Pages URL will look like `https://<username>.github.io/<repo-name>/`. On a **free personal GitHub plan, this requires the repository to be public** - the published site (and the data file inside `website/data/`) is reachable by anyone with the link, though it isn't search-indexed or linked from anywhere. If that's not acceptable for your data, you'd need a paid plan (for a private Pages site) or a different host entirely.

To update what everyone sees, from then on:

```bash
python3 main.py
git add website/data/dashboard_data.json
git commit -m "Update dashboard data"
git push
```

The push triggers the GitHub Actions workflow, which redeploys the site with the new data within a minute or two. Running `python3 main.py --watch` doesn't push for you - it only regenerates the local files - so you still need to `git add/commit/push` `website/data/dashboard_data.json` whenever you want the published copy to update.

If you'd rather not publish data on every run, set `publishing.publish_to_website` to `false` in `config/settings.json` - the local "Upload Data" workflow keeps working exactly as before either way.

---

# Project Structure

```
Live-Spool-Status-System/

│
├── .github/
│   └── workflows/
├── backups/
├── config/
│   ├── settings.json
│   ├── schema.json
│   ├── stages.json
│   └── business_rules.json
│
├── data/
│   ├── upload/
│   └── archive/
│
├── docs/
├── logs/
├── processed/
├── src/
├── tests/
├── website/
│   └── data/          (published dashboard_data.json for GitHub Pages)
│
├── README.md
├── requirements.txt
└── .gitignore
```

---

# Core Modules

## Excel Reader

Responsible for reading all configured Excel workbooks.

---

## Validation Engine

Checks:

* Required columns
* Duplicate records
* Invalid dates
* Missing identifiers
* Data integrity

---

## Business Rule Engine

Determines:

* Planned Status
* Completed Status
* Current Stage
* Next Stage
* First Activity
* Status Message

---

## Merge Engine

Creates a single Master Spool Dataset using the Composite Key.

Composite Key

```
Project Code
+
Drawing Number
+
Spool Number
```

---

## Ageing Engine

Calculates:

* Total Age
* Stage Age

according to approved fabrication business rules.

---

## Summary Engine

Generates dashboard-ready JSON files including:

* Dashboard Summary
* Project Summary
* Weekly Summary
* Department Summary
* Exception Reports

---

# Dashboard Features

## KPI Cards

* Total Spools
* Planned
* Unplanned
* Completed
* Average Age
* Oldest Spool
* Planning Variance

## Charts

* Project Progress
* Weekly Progress
* Department Progress
* Stage Distribution

## Tables

* Oldest Spools
* Search Results
* Validation Exceptions

---

# Search & Filters

Search by:

* Project
* Drawing
* Spool
* Composite Key
* Material
* Group
* Remarks

Filters include:

* Project
* Week
* Group
* Material
* Current Stage
* Planning Status

---

# Output Files

The backend generates JSON files for the dashboard.

```
master_spools.json

dashboard_summary.json

project_summary.json

weekly_summary.json

group_summary.json

stage_ageing_summary.json

fitup_summary.json

welding_summary.json

activity_metrics.json

validation_report.json

exceptions.json

dashboard_data.json  (bundle of the above, uploaded into the dashboard,
                      and published to website/data/ - see above)
```

---

# Coding Standards

* PEP8
* Type Hints
* Docstrings
* Logging
* Configuration Driven
* Single Responsibility Principle
* Modular Architecture
* No Business Logic in HTML
* No Business Logic in JavaScript

---

# Development Roadmap

### Phase 1

* Project Foundation

### Phase 2

* Configuration

### Phase 3

* Excel Reader

### Phase 4

* Validation Engine

### Phase 5

* Business Rule Engine

### Phase 6

* Merge Engine

### Phase 7

* Ageing Engine

### Phase 8

* Summary Engine

### Phase 9

* Dashboard

### Phase 10

* Auto Refresh

### Phase 11

* ERP Integration

### Phase 12

* AI Delay Prediction

---

# Future Enhancements

* ERP Integration
* Power BI Integration
* AI Delay Prediction
* Historical Trend Analysis
* Email Alerts
* WhatsApp Alerts
* Mobile Application
* User Authentication
* Role-Based Access Control

---

# Design Principles

* Business Logic First
* Dashboard Reads JSON Only
* Configuration Driven
* Modular Design
* Maintainable Code
* Production Ready
* Extensible Architecture

---

# License

This project is intended for internal production monitoring and process improvement. Licensing and distribution terms will be defined before public release.
