#!/usr/bin/env python3
"""Append post-session learnings to a named agent's self-improving memory via MC API."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.request
import urllib.error
from typing import Iterable

MC_API_BASE = "http://localhost:3000"


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a correction/lesson/reflection to a named agent's memory."
    )
    parser.add_argument("agent", help="Agent id, e.g. builder, tester, designer")
    parser.add_argument("--workspace-root", help="Ignored — memory is now in Supabase via MC API")
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
        help="Also append the lesson to long_term memory (loaded on next task).",
    )
    parser.add_argument("--date", help="Override YYYY-MM-DD date for deterministic tests")
    parser.add_argument("--dry-run", action="store_true", help="Print intended changes without writing")
    return parser.parse_args(argv)


def api_get(agent_id: str, memory_type: str) -> str:
    """Fetch current content for agent_id + memory_type. Returns empty string if not found."""
    url = f"{MC_API_BASE}/api/agent-memory?agent_id={agent_id}&type={memory_type}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
            rows = data.get("memory", [])
            if rows:
                return rows[0].get("content", "") or ""
    except Exception:
        pass
    return ""


def api_post(agent_id: str, memory_type: str, content: str) -> bool:
    """Upsert content for agent_id + memory_type. Returns True on success."""
    url = f"{MC_API_BASE}/api/agent-memory"
    payload = json.dumps({
        "agent_id": agent_id,
        "memory_type": memory_type,
        "date_key": None,
        "content": content,
    }).encode()
    req = urllib.request.Request(url, data=payload, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status < 300
    except Exception as e:
        print(f"[append-agent-memory] POST error: {e}")
        return False


def append_to_memory(agent_id: str, memory_type: str, new_text: str, dry_run: bool) -> None:
    """GET existing content, append new_text, POST back."""
    existing = api_get(agent_id, memory_type)
    if existing and not existing.endswith("\n"):
        existing += "\n"
    updated = existing + new_text
    if dry_run:
        print(f"[dry-run] Would write to {agent_id}/{memory_type}:\n{new_text.rstrip()}")
        return
    ok = api_post(agent_id, memory_type, updated)
    if ok:
        print(f"Updated {agent_id}/{memory_type}")
    else:
        print(f"[append-agent-memory] WARNING: failed to write {agent_id}/{memory_type}")


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    agent = args.agent.strip().lower()
    date = args.date or dt.date.today().isoformat()

    if args.correction:
        line = f"[{date}] [{args.type}] [{args.task_key}: {args.context}] — {args.correction} — status: {args.status}\n"
        append_to_memory(agent, "corrections", line, args.dry_run)

    if args.reflection or args.lesson:
        reflection_text = args.reflection or args.lesson
        line = f"- {date} {args.task_key} — {args.context} — {reflection_text}\n"
        append_to_memory(agent, "reflections", line, args.dry_run)

    if args.lesson and args.promote_hot:
        line = f"- {date} {args.task_key} [{args.type}] {args.context} — {args.lesson}\n"
        append_to_memory(agent, "long_term", line, args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
