#!/usr/bin/env python3
"""Render the workspace-aware context preamble for a named agent.
Claude Code version — reads from unified todero/config workspace."""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable

# All agents now share the unified workspace in todero/config
WORKSPACE_ROOT = pathlib.Path("/Users/kemuniagent/.openclaw/workspace")


def optional_read_text(path: pathlib.Path) -> str | None:
    try:
        return path.read_text().rstrip()
    except FileNotFoundError:
        return None


def section(title: str, body: str) -> str:
    return f"### {title}\n{body.strip()}"


def build_context(agent: str, agent_root: pathlib.Path | None = None) -> str:
    """Build context preamble from the unified workspace.

    agent_root is accepted for backwards compatibility but ignored —
    all agents share the same SOUL.md, AGENTS.md, and self-improving/ tree.
    """
    workspace = WORKSPACE_ROOT
    soul_path = workspace / "SOUL.md"
    agents_path = workspace / "AGENTS.md"
    memory_path = workspace / "self-improving" / "memory.md"
    corrections_path = workspace / "self-improving" / "corrections.md"
    reflections_path = workspace / "self-improving" / "reflections.md"
    session_state_path = workspace / "self-improving" / "session-state.md"

    parts = ["## Agent Context — " + agent.capitalize(), ""]

    soul = optional_read_text(soul_path)
    if soul:
        parts.extend([section(f"Identity ({soul_path.name})", soul), ""])

    agents = optional_read_text(agents_path)
    if agents:
        parts.extend([section(f"Operational Rules ({agents_path.name})", agents), ""])

    memory = optional_read_text(memory_path)
    if memory:
        parts.extend([section(f"HOT Memory ({memory_path.name})", memory), ""])

    corrections = optional_read_text(corrections_path)
    if corrections:
        parts.extend([section(f"Corrections ({corrections_path.name})", corrections), ""])

    reflections = optional_read_text(reflections_path)
    if reflections:
        parts.extend([section(f"Reflections ({reflections_path.name})", reflections), ""])

    session_state = optional_read_text(session_state_path)
    if session_state:
        parts.extend([section(f"Session State ({session_state_path.name})", session_state), ""])

    parts.extend(["---", "## Task"])
    return "\n".join(parts)


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render workspace context block for a named agent spawn prompt."
    )
    parser.add_argument("agent", help="Agent id, e.g. builder, tester, designer")
    parser.add_argument(
        "--agent-root",
        help="Ignored (kept for backwards compatibility). All agents use the unified workspace.",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    agent = args.agent.strip().lower()
    print(build_context(agent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
