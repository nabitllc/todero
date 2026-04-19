#!/usr/bin/env python3
"""
n8n-audit.py — Audit all n8n workflows and export them to JSON files.

Run this while n8n is stopped (or with a copy of the DB):
  python3 n8n-audit.py

Outputs:
  - Prints a full workflow inventory to stdout
  - Exports each workflow as JSON to ~/.openclaw/workspace/scripts/n8n-exports/
  - Writes a summary report to n8n-audit-report.md
"""

import json
import os
import pathlib
import sqlite3
from datetime import datetime

DB_PATH = pathlib.Path.home() / ".n8n" / "database.sqlite"
EXPORT_DIR = pathlib.Path(__file__).parent / "n8n-exports"
REPORT_PATH = pathlib.Path(__file__).parent / "n8n-audit-report.md"

EXPORT_DIR.mkdir(exist_ok=True)


def get_node_types(nodes: list) -> list[str]:
    return sorted(set(n.get("type", "?").replace("n8n-nodes-base.", "") for n in nodes))


def main():
    if not DB_PATH.exists():
        print(f"DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get all workflows
    cur.execute("""
        SELECT id, name, active, nodes, connections, settings, staticData, createdAt, updatedAt
        FROM workflow_entity
        ORDER BY updatedAt DESC
    """)
    workflows = cur.fetchall()

    # Get execution counts per workflow
    cur.execute("""
        SELECT workflowId, COUNT(*) as count,
               SUM(CASE WHEN finished=1 AND stoppedAt IS NOT NULL THEN 1 ELSE 0 END) as finished,
               SUM(CASE WHEN mode='error' OR status='error' THEN 1 ELSE 0 END) as errors
        FROM execution_entity
        GROUP BY workflowId
    """)
    exec_counts = {str(r["workflowId"]): dict(r) for r in cur.fetchall()}

    conn.close()

    print(f"{'='*70}")
    print(f"n8n Workflow Audit — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Total workflows: {len(workflows)}")
    print(f"{'='*70}\n")

    report_lines = [
        f"# n8n Workflow Audit — {datetime.now().strftime('%Y-%m-%d')}",
        f"\nTotal: {len(workflows)} workflows\n",
        "| Status | ID | Name | Nodes | Executions | Errors | Last Updated |",
        "|---|---|---|---|---|---|---|",
    ]

    active_count = 0
    exported = []

    for w in workflows:
        wid = str(w["id"])
        name = w["name"]
        active = bool(w["active"])
        updated = w["updatedAt"][:10] if w["updatedAt"] else "?"

        try:
            nodes = json.loads(w["nodes"] or "[]")
        except Exception:
            nodes = []

        node_types = get_node_types(nodes)
        exec_info = exec_counts.get(wid, {})
        total_execs = exec_info.get("count", 0)
        errors = exec_info.get("errors", 0)

        status_icon = "🟢" if active else "⚫"
        if active:
            active_count += 1

        print(f"{status_icon} [{wid}] {name}")
        print(f"   Nodes ({len(nodes)}): {', '.join(node_types[:8])}")
        print(f"   Executions: {total_execs} total, {errors} errors | Updated: {updated}")
        print()

        report_lines.append(
            f"| {status_icon} | `{wid}` | {name} | {len(nodes)} | {total_execs} | {errors} | {updated} |"
        )

        # Export workflow JSON
        workflow_data = {
            "id": wid,
            "name": name,
            "active": active,
            "nodes": nodes,
            "connections": json.loads(w["connections"] or "{}"),
            "settings": json.loads(w["settings"] or "{}"),
        }
        safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name)[:60]
        export_path = EXPORT_DIR / f"{wid}_{safe_name}.json"
        export_path.write_text(json.dumps(workflow_data, indent=2))
        exported.append(str(export_path))

    print(f"\n{'='*70}")
    print(f"Summary: {active_count} active, {len(workflows) - active_count} inactive")
    print(f"Exports written to: {EXPORT_DIR}")
    print(f"{'='*70}")

    # Write report
    report_lines.extend([
        f"\n## Summary",
        f"- Active: {active_count}",
        f"- Inactive: {len(workflows) - active_count}",
        f"- Exports: `scripts/n8n-exports/`",
    ])
    REPORT_PATH.write_text("\n".join(report_lines))
    print(f"Report written to: {REPORT_PATH}")


if __name__ == "__main__":
    main()
