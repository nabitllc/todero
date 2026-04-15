#!/usr/bin/env python3
"""Append post-session learnings to a named agent's self-improving files."""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
from typing import Iterable

WORKSPACE_PREFIX = pathlib.Path("/Users/kemuniagent/.openclaw")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a correction/lesson/reflection to a named agent workspace."
    )
    parser.add_argument("agent", help="Agent id, e.g. builder, tester, designer")
    parser.add_argument("--workspace-root", help="Override workspace path")
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
        help="Also append the lesson to memory.md so it is loaded on the next task.",
    )
    parser.add_argument("--date", help="Override YYYY-MM-DD date for deterministic tests")
    parser.add_argument("--dry-run", action="store_true", help="Print intended changes without writing")
    return parser.parse_args(argv)


def workspace_root_for(agent: str, override: str | None) -> pathlib.Path:
    if override:
        return pathlib.Path(override).expanduser().resolve()
    return (WORKSPACE_PREFIX / f"workspace-{agent}").resolve()


def ensure_file(path: pathlib.Path, default_content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(default_content)


def append_text(path: pathlib.Path, text: str) -> None:
    existing = path.read_text() if path.exists() else ""
    if existing and not existing.endswith("\n"):
        existing += "\n"
    path.write_text(existing + text)


def ensure_section(content: str, header: str) -> str:
    if header in content:
        return content
    if content and not content.endswith("\n"):
        content += "\n"
    if content and not content.endswith("\n\n"):
        content += "\n"
    return content + f"{header}\n"


def append_memory_line(path: pathlib.Path, header: str, line: str) -> None:
    content = path.read_text() if path.exists() else ""
    content = ensure_section(content, header)
    if not content.endswith("\n"):
        content += "\n"
    content += line + "\n"
    path.write_text(content)


def default_memory(agent: str) -> str:
    title = agent.capitalize()
    return (
        f"# {title} Self-Improving Memory — HOT TIER\n\n"
        "> Always load at session start. These are learned patterns that compound execution quality.\n\n"
        "## Session-Learned Patterns\n"
    )


def default_corrections(agent: str) -> str:
    return (
        f"# {agent.capitalize()} Corrections Log\n\n"
        "> Track corrections here. After 3 identical corrections → confirm as permanent rule in memory.md.\n\n"
        "## Format\n"
        "```\n"
        "[DATE] [TYPE: global|domain|project] [CONTEXT] — [CORRECTION] — status: tentative|confirmed\n"
        "```\n\n"
        "## Log\n"
    )


def default_reflections(agent: str) -> str:
    return (
        f"# {agent.capitalize()} Reflections\n\n"
        "> Short post-session notes. Keep it tight and reusable.\n\n"
        "## Log\n"
    )


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    agent = args.agent.strip().lower()
    root = workspace_root_for(agent, args.workspace_root)
    self_improving = root / "self-improving"
    memory_path = self_improving / "memory.md"
    corrections_path = self_improving / "corrections.md"
    reflections_path = self_improving / "reflections.md"

    date = args.date or dt.date.today().isoformat()
    ensure_file(memory_path, default_memory(agent))
    ensure_file(corrections_path, default_corrections(agent))
    ensure_file(reflections_path, default_reflections(agent))

    actions: list[str] = []

    if args.correction:
        actions.append(
            f"append corrections.md: [{date}] [{args.type}] [{args.task_key}: {args.context}] — {args.correction} — status: {args.status}"
        )
    if args.reflection or args.lesson:
        reflection_text = args.reflection or args.lesson
        actions.append(
            f"append reflections.md: - {date} {args.task_key} — {args.context} — {reflection_text}"
        )
    if args.lesson and args.promote_hot:
        actions.append(
            f"append memory.md under ## Session-Learned Patterns: - {date} {args.task_key} [{args.type}] {args.context} — {args.lesson}"
        )

    if args.dry_run:
        print(f"Agent workspace: {root}")
        for action in actions:
            print(action)
        return 0

    if args.correction:
        append_text(
            corrections_path,
            f"[{date}] [{args.type}] [{args.task_key}: {args.context}] — {args.correction} — status: {args.status}\n",
        )
    if args.reflection or args.lesson:
        reflection_text = args.reflection or args.lesson
        append_text(
            reflections_path,
            f"- {date} {args.task_key} — {args.context} — {reflection_text}\n",
        )
    if args.lesson and args.promote_hot:
        append_memory_line(
            memory_path,
            "## Session-Learned Patterns",
            f"- {date} {args.task_key} [{args.type}] {args.context} — {args.lesson}",
        )

    print(f"Updated {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
