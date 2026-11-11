"""
src/mom/summary.py
---------------------------------------------------------
Turns the Weekly Log rows into the per-project history the page shows.
Nothing here evaluates the workbook's formulas: a case is the rows that
share a Case ID, and its status is the status on its latest row.
"""

from __future__ import annotations

from typing import Any

CLOSED = {"closed", "cancelled"}


def build_history(log_rows: list[dict[str, Any]]) -> dict[str, Any]:
    # A follow-up row may leave Project / Dept blank: borrow them from any
    # row of the same case that has them.
    known: dict[str, dict[str, str]] = {}
    for row in log_rows:
        if row["case_id"]:
            entry = known.setdefault(row["case_id"], {"project": "", "dept": ""})
            entry["project"] = entry["project"] or row["project"]
            entry["dept"] = entry["dept"] or row["dept"]

    cases: dict[tuple[str, str], dict[str, Any]] = {}
    for index, row in enumerate(sorted(log_rows, key=lambda r: r["date"])):
        borrowed = known.get(row["case_id"], {})
        project = row["project"] or borrowed.get("project") or "Unassigned"
        dept = row["dept"] or borrowed.get("dept") or ""
        # A row with no Case ID is its own one-update case.
        key = (project, row["case_id"] or f"row-{index}")
        case = cases.setdefault(key, {"case_id": row["case_id"], "dept": dept, "updates": []})
        case["dept"] = dept or case["dept"]
        case["updates"].append({
            "date": row["date"], "status": row["status"], "remarks": row["remarks"],
        })

    projects: dict[str, list[dict[str, Any]]] = {}
    for (project, _), case in cases.items():
        latest = case["updates"][-1]
        projects.setdefault(project, []).append({
            "case_id": case["case_id"],
            "dept": case["dept"],
            "status": latest["status"],
            "first_raised": case["updates"][0]["date"],
            "last_updated": latest["date"],
            "updates": case["updates"],
        })

    project_list = []
    for project in sorted(projects):
        project_cases = sorted(projects[project], key=lambda c: c["last_updated"], reverse=True)
        open_count = sum(1 for c in project_cases if c["status"].lower() not in CLOSED)
        project_list.append({
            "project": project,
            "open": open_count,
            "closed": len(project_cases) - open_count,
            "cases": project_cases,
        })

    return {
        "meetings": sorted({row["date"] for row in log_rows}),
        "projects": project_list,
    }
