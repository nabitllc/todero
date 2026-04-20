#!/usr/bin/env python3
"""Append post-session learnings to a named agent's memory in Supabase DB.

Writes to agent_memory_files via /api/agent-memory (GET to fetch, append, POST back).
Memory types used:
  corrections   — specific mistakes and corrections (--correction)
  self_improving — reusable lessons and patterns (--lesson, --reflection, --promote-hot)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.request
from typing import Iterable

MEMORY_API = "http://localhost:3000/api/agent-memory"


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a correction/lesson/reflection to a named agent's DB memory."
    )
    parser.add_argument("agent", help="Agent id, e.g. builder, tester, designer")
    parser.add_argument("--task-key", required=True, help="Task or issue key tied to this session")
    parser.add_argument("--context", required=True, help="Short context for the learning")
    parser.add_argument(
        "--type",
        default="global",
        choices=["global", "domain", "project"],
        help="Correction/lesson scope",
    )
    parser.add_argument("--correction", help="Specific correction that should be logged")
    parser.add_argument("--lesson", help="Reusable lesson/pattern to keep for next time")
    parser.add_argument("--reflection", help="Short session reflection or what changed")
    parser.add_argument(
        "--status",
        default="tentative",
        choices=["tentative", "confirmed"],
        help="Confidence level for the correction or lesson",
    )
    parser.add_argument(
        "--promote-hot",
        action="store_true",
        help="Also append the lesson to self_improving so it is loaded on the next task.",
    )
    parser.add_argument("--date", help="Override YYYY-MM-DD date for deterministic tests")
    parser.add_argument("--dry-run", action="store_true", help="Print intended changes without writing")
    return parser.parse_args(argv)


def db_get(agent_id: str, memory_type: str) -> str:
    """Fetch current content for agent/type from DB. Returns empty string if not found."""
    try:
        req = urllib.request.Request(
            f"{MEMORY_API}?agent_id={agent_id}&type={memory_type}",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read()).get("memory", [])
        return rows[0]["content"] if rows else ""
    except Exception as e:
        print(f"[db_get] {agent_id}/{memory_type}: {e}")
        return ""


def db_append(agent_id: str, memory_type: str, entry: str, dry_run: bool = False) -> None:
    """Append entry to existing DB content and POST back."""
    existing = db_get(agent_id, memory_type)
    if existing and not existing.endswith("\n"):
        existing += "\n"
    updated = existing + entry

    if dry_run:
        print(f"[dry-run] Would write to DB: agent={agent_id} type={memory_type}")
        print(f"  Entry: {entry.strip()[:120]}")
        return

    try:
        data = json.dumps({"agent_id": agent_id, "memory_type": memory_type, "content": updated}).encode()
        req = urllib.request.Request(MEMORY_API, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10):
            pass
        print(f"Updated DB: {agent_id}/{memory_type}")
    except Exception as e:
        print(f"[db_append] {agent_id}/{memory_type}: {e}")


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    agent = args.agent.strip().lower()
    date = args.date or dt.date.today().isoformat()

    if args.correction:
        entry = f"[{date}] [{args.type}] [{args.task_key}: {args.context}] — {args.correction} — status: {args.status}\n"
        db_append(agent, "corrections", entry, dry_run=args.dry_run)

    if args.reflection or args.lesson:
        text = args.reflection or args.lesson
        entry = f"- {date} {args.task_key} — {args.context} — {text}\n"
        db_append(agent, "self_improving", entry, dry_run=args.dry_run)

    if args.lesson and args.promote_hot:
        entry = f"- {date} {args.task_key} [{args.type}] {args.context} — {args.lesson}\n"
        db_append("global", "self_improving", entry, dry_run=args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
