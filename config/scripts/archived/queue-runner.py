#!/usr/bin/env python3
"""
queue-runner.py — Per-agent autonomous queue movement
Claude Code version — no OpenClaw dependency

Usage:
  python3 queue-runner.py --agent builder
  python3 queue-runner.py --agent tester --dry-run
  python3 queue-runner.py --agent builder --once   # claim + run one issue then exit
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

# ── Constants ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
WORKSPACE_DIR = SCRIPT_DIR.parent  # todero/config workspace root
CONFIG_FILE = SCRIPT_DIR / "queue-agent-config.json"
SKIP_COUNTS_FILE = SCRIPT_DIR / "queue-skip-counts.json"
MC_API = "http://localhost:3000/api/issues"
MC_DIR = "/Users/kemuniagent/todero"
HEARTBEAT_INTERVAL = 30 * 60  # 30 minutes
STUCK_THRESHOLD = 2 * 60 * 60  # 2 hours
SKIP_ALERT_THRESHOLD = 3
RENDER_AGENT_CONTEXT_PY = SCRIPT_DIR / "render-agent-context.py"

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

DISCORD_TOKEN = os.environ.get(
    "OPENCLAW_DISCORD_TOKEN",
    "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo",
)

# Claude Code binary — installed at ~/.local/bin/claude
CLAUDE_BIN = "/Users/kemuniagent/.local/bin/claude"


# ── Agent workspace context loader ────────────────────────────────────────────

def build_agent_context(agent: str) -> str:
    """Load workspace context via render-agent-context.py.

    This includes SOUL.md, AGENTS.md, self-improving memory, and all universal skills.
    Skills are auto-injected from todero/config/skills/ — no hardcoding needed.
    """
    try:
        result = subprocess.run(
            ["python3", str(RENDER_AGENT_CONTEXT_PY), agent],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        else:
            print(f"[context] render-agent-context.py failed: {result.stderr}", file=sys.stderr)
            return ""
    except Exception as e:
        print(f"[context] Error loading context: {e}", file=sys.stderr)
        return ""


def build_agent_prompt(agent: str, issue: dict) -> str:
    """Build the full Claude Code prompt for an agent working on an issue."""
    context = build_agent_context(agent)
    task_key = issue.get("task_key", "?")
    title = issue.get("title", "")
    description = issue.get("description", "")
    ac = issue.get("acceptance_criteria", "")
    reviewer_notes = issue.get("reviewer_notes", "")
    issue_id = issue.get("id", "")
    project = issue.get("project", "Mission Control")

    rejection_block = ""
    if reviewer_notes:
        rejection_block = f"""
⚠️ REJECTION — This issue was previously reviewed and rejected. Read carefully:
{reviewer_notes}
Address ALL reviewer notes before submitting again.
"""

    return f"""<workspace-context>
{context}
</workspace-context>

You are {agent.capitalize()}. Implement the following issue.

Workspace: {MC_DIR}
MC API: http://localhost:3000/api/issues
Issue ID: {issue_id}
Task key: {task_key}
Project: {project}

## {task_key}: {title}

### Description
{description}

### Acceptance Criteria
{ac}
{rejection_block}

## Instructions

1. Set status=in_progress via MC API:
   PATCH http://localhost:3000/api/issues
   Body: {{"id": "{issue_id}", "status": "in_progress"}}

2. Implement the change. Run: npm run build
   Fix all TypeScript errors before committing.

3. Commit locally:
   git add -A && git commit -m 'feat({task_key}): <description> [skip ci]'
   ⚠️ NEVER git push — KAOS pushes at 7am/7pm sprint windows only.

4. PATCH issue to in_review:
   PATCH http://localhost:3000/api/issues
   Body: {{
     "id": "{issue_id}",
     "status": "in_review",
     "implementation_notes": "<what you built and tested>",
     "commit_sha": "<git rev-parse HEAD output>",
     "regression_test": "<command or steps to verify no regression — REQUIRED>"
   }}
   regression_test is required — the API will reject the PATCH without it.

5. NEVER create new tester/reviewer child issues.
   NEVER mark status=done — the reviewer does that.

⚠️ PARTIAL WORK RULE: If you cannot complete the task, either:
   (a) Commit with [WIP] prefix: git commit -m '[WIP] partial: description'
   (b) OR clean up: git checkout -- . && git clean -fd
   NEVER leave uncommitted partial .tsx/.ts files — they break the TypeScript compiler.
"""


# ── Discord ────────────────────────────────────────────────────────────────────

def discord_send(channel_id: str, content: str) -> bool:
    url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    payload = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Authorization": f"Bot {DISCORD_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201)
    except Exception as e:
        print(f"[discord] Error: {e}", file=sys.stderr)
        return False


# ── MC API ─────────────────────────────────────────────────────────────────────

def api_get() -> list:
    try:
        with urllib.request.urlopen(MC_API, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[api] GET error: {e}", file=sys.stderr)
        return []


def api_patch(payload: dict) -> Optional[dict]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        MC_API, data=data,
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[api] PATCH error: {e}", file=sys.stderr)
        return None


# ── Skip counts ────────────────────────────────────────────────────────────────

def load_skip_counts() -> dict:
    if SKIP_COUNTS_FILE.exists():
        try:
            return json.loads(SKIP_COUNTS_FILE.read_text())
        except Exception:
            pass
    return {}


def save_skip_counts(counts: dict) -> None:
    SKIP_COUNTS_FILE.write_text(json.dumps(counts, indent=2))


def increment_skip(task_key: str) -> int:
    counts = load_skip_counts()
    counts[task_key] = counts.get(task_key, 0) + 1
    save_skip_counts(counts)
    return counts[task_key]


def reset_skip(task_key: str) -> None:
    counts = load_skip_counts()
    counts.pop(task_key, None)
    save_skip_counts(counts)


# ── Queue logic ────────────────────────────────────────────────────────────────

def fetch_issues_for_agent(agent: str, eligible_statuses: list[str]) -> list:
    all_issues = api_get()
    return [
        i for i in all_issues
        if i.get("assignee") == agent
        and i.get("status") in eligible_statuses
        and not i.get("worked_by")
    ]


def sort_by_priority(issues: list) -> list:
    def sort_key(i: dict) -> tuple:
        pri = PRIORITY_ORDER.get(i.get("priority", "low"), 4)
        created = i.get("created_at") or "9999"
        return (pri, created)
    return sorted(issues, key=sort_key)


def check_stuck_in_progress(agent: str, channel_id: str, dry_run: bool) -> Optional[dict]:
    all_issues = api_get()
    in_progress = [
        i for i in all_issues
        if i.get("worked_by") == agent and i.get("status") == "in_progress"
    ]
    if not in_progress:
        return None

    issue = in_progress[0]
    task_key = issue.get("task_key", "?")
    started_raw = issue.get("started_at")

    if not started_raw:
        print(f"[1-at-a-time] {agent} has in_progress {task_key} (no started_at — treating as active)")
        return issue

    try:
        started = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_seconds = (now - started).total_seconds()
        age_str = f"{age_seconds/60:.0f}m" if age_seconds < 3600 else f"{age_seconds/3600:.1f}h"

        if age_seconds < STUCK_THRESHOLD:
            print(f"[1-at-a-time] {agent} already working on {task_key} (age: {age_str}) — lane blocked")
            return issue

        print(f"[1-at-a-time] STALE: {task_key} stuck for {age_str} — resetting to open")
        if not dry_run:
            api_patch({
                "task_key": task_key,
                "status": "open",
                "worked_by": None,
                "started_at": None,
                "implementation_notes": (
                    f"Auto-reset by queue-runner ({agent}): "
                    f"stuck in_progress for {age_str}. "
                    f"Reset at {datetime.now(timezone.utc).isoformat()}."
                ),
            })
            discord_send(channel_id,
                f"⚠️ **Queue Runner** | `{agent}` | `{task_key}` stuck {age_str} — reset to open.")
        return None

    except Exception as e:
        print(f"[1-at-a-time] Could not parse started_at for {task_key}: {e}", file=sys.stderr)
        return issue


def claim_next_issue(agent: str, eligible_statuses: list[str], channel_id: str, dry_run: bool) -> Optional[dict]:
    issues = fetch_issues_for_agent(agent, eligible_statuses)
    if not issues:
        return None

    sorted_issues = sort_by_priority(issues)
    all_issues_cache = api_get()
    issue_by_id = {i.get("id"): i for i in all_issues_cache}
    cycle_skips: dict[str, str] = {}

    for issue in sorted_issues:
        task_key = issue.get("task_key", "?")
        blocked_by = issue.get("blocked_by")

        if blocked_by:
            blocker = issue_by_id.get(blocked_by)
            blocker_done = blocker and blocker.get("status") in ("done", "released", "completed", "closed")
            blocker_key = blocker.get("task_key", str(blocked_by)[:8]) if blocker else str(blocked_by)[:8]
            if not blocker_done:
                cycle_skips[task_key] = blocker_key
                persistent_count = increment_skip(task_key)
                print(f"[queue] Skipping {task_key} (blocked by {blocker_key}) — persistent: {persistent_count}")
                if persistent_count % SKIP_ALERT_THRESHOLD == 0 and not dry_run:
                    discord_send(channel_id,
                        f"🚧 **Queue Runner** | `{agent}` | `{task_key}` skipped "
                        f"{persistent_count}x — blocked by `{blocker_key}`. Needs triage.")
                continue

        print(f"[queue] Claiming {task_key} for {agent}")
        if not dry_run:
            patched = api_patch({
                "task_key": task_key,
                "status": "in_progress",
                "worked_by": agent,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "transitioned_by": agent,
            })
            if patched:
                reset_skip(task_key)
                return patched
            else:
                print(f"[queue] Failed to claim {task_key}", file=sys.stderr)
                continue
        else:
            print(f"[dry-run] Would claim {task_key}")
            return issue

    if cycle_skips:
        print(f"[queue] Pass complete — all eligible issues blocked: {cycle_skips}")
    return None


def run_agent_on_issue(agent: str, issue: dict, dry_run: bool) -> bool:
    """Invoke Claude Code with the task payload. Returns True on success."""
    task_key = issue.get("task_key", "?")
    prompt = build_agent_prompt(agent, issue)

    print(f"[queue] Running Claude Code as '{agent}' on {task_key}")

    if dry_run:
        print(f"[dry-run] Would invoke: {CLAUDE_BIN} --permission-mode bypassPermissions --print <prompt>")
        return True

    # Try installed path first, fall back to PATH lookup
    for bin_path in [CLAUDE_BIN, "claude"]:
        try:
            result = subprocess.run(
                [bin_path, "--permission-mode", "bypassPermissions", "--print", prompt],
                cwd=MC_DIR,
                timeout=3600,
                text=True,
            )
            return result.returncode == 0
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            print(f"[queue] Claude Code timed out on {task_key}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"[queue] Error running Claude Code: {e}", file=sys.stderr)
            return False

    print(f"[queue] Claude Code not found at {CLAUDE_BIN} or in PATH", file=sys.stderr)
    return False


# ── Main loop ──────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Per-agent autonomous queue runner (Claude Code)")
    parser.add_argument("--agent", required=True, help="Agent id, e.g. builder, tester")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen, no API writes")
    parser.add_argument("--once", action="store_true", help="Claim and run one issue then exit")
    args = parser.parse_args(argv)

    agent = args.agent

    if not CONFIG_FILE.exists():
        print(f"[queue] Config not found: {CONFIG_FILE}", file=sys.stderr)
        sys.exit(1)

    config = json.loads(CONFIG_FILE.read_text())
    if agent not in config:
        print(f"[queue] Unknown agent '{agent}'. Known: {list(config.keys())}", file=sys.stderr)
        sys.exit(1)

    agent_cfg = config[agent]
    eligible_statuses: list[str] = agent_cfg["eligible_statuses"]
    channel_id: str = agent_cfg.get("discord_channel", "1485333334077735084")

    print(f"[queue] Starting: agent={agent} eligible={eligible_statuses} dry_run={args.dry_run}")

    last_heartbeat = 0.0
    last_done_key: Optional[str] = None
    current_key: Optional[str] = None
    current_key_started: Optional[float] = None
    issues_done_this_session = 0
    heartbeat_state_file = SCRIPT_DIR / f"heartbeat-{agent}.json"

    def write_heartbeat_state(state: dict) -> None:
        try:
            heartbeat_state_file.write_text(json.dumps(state))
        except Exception:
            pass

    def format_duration(seconds: float) -> str:
        seconds = int(seconds)
        if seconds < 60:
            return f"{seconds}s"
        m = seconds // 60
        return f"{m}m" if m < 60 else f"{m // 60}h {m % 60}m"

    while True:
        now = time.time()

        # ── Heartbeat ─────────────────────────────────────────────────────────
        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            issues = fetch_issues_for_agent(agent, eligible_statuses)
            queue_depth = len(issues)
            time_in_issue = format_duration(now - current_key_started) if current_key_started else "—"
            ts_iso = datetime.now(timezone.utc).isoformat()

            if queue_depth == 0 and not current_key:
                msg = (f"✅ `{agent}` queue drained | done: {issues_done_this_session} | "
                       f"last: `{last_done_key or 'none'}` | ts: {ts_iso}")
                state = {"agent": agent, "status": "drained", "queue_depth": 0,
                         "current": None, "last_done": last_done_key,
                         "done_session": issues_done_this_session, "ts": ts_iso}
            else:
                msg = (f"🤖 HEARTBEAT | agent=`{agent}` | current=`{current_key or 'idle'}` | "
                       f"time_in={time_in_issue} | depth={queue_depth} | "
                       f"last_done=`{last_done_key or 'none'}` | done={issues_done_this_session} | ts={ts_iso}")
                state = {"agent": agent, "status": "active", "queue_depth": queue_depth,
                         "current": current_key, "time_in_issue": time_in_issue,
                         "last_done": last_done_key, "done_session": issues_done_this_session, "ts": ts_iso}

            print(f"[heartbeat] {msg}")
            if not args.dry_run:
                discord_send(channel_id, msg)
                write_heartbeat_state(state)
            last_heartbeat = now

        # ── One-at-a-time check ───────────────────────────────────────────────
        if check_stuck_in_progress(agent, channel_id, args.dry_run) is not None:
            time.sleep(60)
            continue

        # ── Claim next ────────────────────────────────────────────────────────
        issue = claim_next_issue(agent, eligible_statuses, channel_id, args.dry_run)

        if issue is None:
            if args.once:
                break
            time.sleep(60)
            continue

        current_key = issue.get("task_key")
        current_key_started = time.time()
        print(f"[queue] Running {current_key}")

        success = run_agent_on_issue(agent, issue, args.dry_run)

        if success:
            last_done_key = current_key
            issues_done_this_session += 1
            print(f"[queue] ✅ {current_key} done")
        else:
            print(f"[queue] ⚠️  {current_key} failed or timed out")
            if not args.dry_run:
                discord_send(channel_id,
                    f"⚠️ **Queue Runner** | `{agent}` | `{current_key}` failed or timed out.")

        current_key = None
        current_key_started = None

        if args.once:
            break

        time.sleep(5)


if __name__ == "__main__":
    main()
