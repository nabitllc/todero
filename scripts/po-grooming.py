#!/usr/bin/env python3
"""
po-grooming.py  (TOD-755)

Daily PO backlog grooming at 8am ET.
Flow:
  1. Fetch backlog issues, rank by priority
  2. Take top 5 (skip issues already DoR-complete)
  3. Auto-fill missing DoR fields (severity, reviewer, owner, sprint)
  4. PATCH each via MC API
  5. Post summary to Discord #backlog-grooming

DoR fields required before open:
  title, description, acceptance_criteria, severity, reviewer, owner,
  parent_id (tasks/bugs), sprint, priority, assignee
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from typing import Optional

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except ImportError:
    try:
        import pytz
        ET = pytz.timezone("America/New_York")
    except ImportError:
        ET = None

MC_API = os.environ.get("MC_API_URL", "http://localhost:3000/api/issues")
DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN")
# #backlog-grooming channel — required env var, no default
DISCORD_CHANNEL_ID = os.environ.get("DISCORD_BACKLOG_GROOMING_CHANNEL")

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

# Default severity by issue type
DEFAULT_SEVERITY = {
    "bug": "S1",
    "feature": "S0",
    "task": "S2",
    "ops": "S2",
    "research": "S3",
}

# Reviewer by severity
REVIEWER_BY_SEVERITY = {
    "S0": "tester",
    "S1": "tester",
    "S2": "tester",
    "S3": "designer",
}

# Default owner by type
DEFAULT_OWNER = {
    "bug": "builder",
    "task": "builder",
    "feature": "main",
    "ops": "ops",
    "research": "scout",
}


def now_et() -> datetime:
    utc_now = datetime.now(timezone.utc)
    return utc_now.astimezone(ET) if ET else utc_now


def today_sprint() -> str:
    """Return today's sprint date string (YYYY-MM-DD)."""
    return now_et().strftime("%Y-%m-%d")


def mc_get() -> list:
    req = urllib.request.Request(MC_API, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def mc_patch(issue_id: str, fields: dict) -> Optional[dict]:
    payload = {"id": issue_id, "transitioned_by": "po-grooming", **fields}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        MC_API,
        data=data,
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[grooming] PATCH error {e.code} for {issue_id}: {body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[grooming] PATCH exception for {issue_id}: {e}", file=sys.stderr)
        return None


def post_to_discord(message: str) -> Optional[int]:
    if not DISCORD_TOKEN:
        print(f"[discord-skip] DISCORD_TOKEN not set in environment. Summary not posted.", file=sys.stderr)
        return None

    if not DISCORD_CHANNEL_ID:
        print(f"[discord-skip] DISCORD_BACKLOG_GROOMING_CHANNEL not set in environment. Summary not posted.", file=sys.stderr)
        return None

    url = f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages"

    # Discord limit: 2000 chars per message. Split into chunks if needed.
    lines = message.split("\n")
    chunks = []
    current_chunk = []
    current_size = 0

    for line in lines:
        line_size = len(line) + 1  # +1 for newline
        if current_size + line_size > 1999:
            if current_chunk:
                chunks.append("\n".join(current_chunk))
                current_chunk = []
                current_size = 0
        current_chunk.append(line)
        current_size += line_size

    if current_chunk:
        chunks.append("\n".join(current_chunk))

    last_status = None
    for i, chunk in enumerate(chunks):
        data = json.dumps({"content": chunk}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bot {DISCORD_TOKEN}",
                "Content-Type": "application/json",
                "User-Agent": "DiscordBot (https://kaos.nabit.work, 1.0)",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                last_status = resp.status
                msg_num = f" (part {i+1}/{len(chunks)})" if len(chunks) > 1 else ""
                print(f"[discord] Posted to channel {DISCORD_CHANNEL_ID}{msg_num}: HTTP {resp.status}", file=sys.stderr)
        except urllib.error.HTTPError as e:
            print(f"[discord] HTTP error on chunk {i+1}/{len(chunks)}: {e.code} {e.read().decode()}", file=sys.stderr)
            return e.code
        except Exception as e:
            print(f"[discord] error on chunk {i+1}/{len(chunks)}: {e}", file=sys.stderr)
            return None

    return last_status


def dor_missing_fields(issue: dict) -> list[str]:
    """Return list of DoR field names that are still missing (non-auto-fillable)."""
    missing = []
    if not issue.get("description"):
        missing.append("description")
    if not issue.get("acceptance_criteria"):
        missing.append("acceptance_criteria")
    itype = (issue.get("type") or "").lower()
    if itype in ("task", "bug") and not issue.get("parent_id"):
        missing.append("parent_id")
    return missing


def auto_fill_fields(issue: dict) -> dict:
    """Return dict of auto-fillable DoR fields that are missing."""
    updates = {}
    itype = (issue.get("type") or "").lower()

    if not issue.get("severity"):
        updates["severity"] = DEFAULT_SEVERITY.get(itype, "S2")

    sev = issue.get("severity") or updates.get("severity", "S2")
    if not issue.get("reviewer"):
        updates["reviewer"] = REVIEWER_BY_SEVERITY.get(sev, "tester")

    if not issue.get("owner"):
        updates["owner"] = DEFAULT_OWNER.get(itype, "builder")

    if not issue.get("sprint"):
        updates["sprint"] = today_sprint()

    return updates


def select_top_backlog(all_issues: list, n: int = 5) -> list:
    """Pick top N backlog issues, ranked by priority then created_at."""
    backlog = [
        i for i in all_issues
        if (i.get("status") or "").lower() == "backlog"
    ]
    backlog.sort(key=lambda i: (
        PRIORITY_ORDER.get((i.get("priority") or "medium").lower(), 2),
        i.get("created_at") or "",
    ))
    return backlog[:n]


def main():
    ts = now_et().strftime("%Y-%m-%d %H:%M %Z") if ET else now_et().strftime("%Y-%m-%d %H:%M UTC")
    print(f"[po-grooming] Starting daily grooming run at {ts}")

    try:
        all_issues = mc_get()
    except Exception as e:
        print(f"[po-grooming] Failed to fetch issues: {e}", file=sys.stderr)
        sys.exit(1)

    candidates = select_top_backlog(all_issues, n=5)
    print(f"[po-grooming] Selected {len(candidates)} backlog issues to groom")

    results = []

    for issue in candidates:
        iid = issue["id"]
        key = issue.get("task_key", "?")
        title = issue.get("title", "untitled")
        itype = (issue.get("type") or "?").lower()
        priority = (issue.get("priority") or "?").lower()

        fills = auto_fill_fields(issue)
        still_missing = dor_missing_fields(issue)

        patched = {}
        if fills:
            print(f"[po-grooming] Patching {key}: {list(fills.keys())}")
            result = mc_patch(iid, fills)
            if result:
                patched = fills
            else:
                print(f"[po-grooming] PATCH failed for {key}", file=sys.stderr)

        results.append({
            "key": key,
            "title": title,
            "type": itype,
            "priority": priority,
            "auto_filled": list(patched.keys()),
            "still_missing": still_missing,
        })

        print(f"[po-grooming] {key}: auto-filled={list(patched.keys())} still-missing={still_missing}")

    # Build Discord summary
    date_str = now_et().strftime("%A, %B %d %Y") if ET else datetime.now().strftime("%A, %B %d %Y")
    lines = [f"📋 **PO Grooming — {date_str}** (top {len(results)} backlog issues)\n"]

    for r in results:
        status_icon = "✅" if not r["still_missing"] else "⚠️"
        # Format: `KEY` — Title [type/priority]
        title = r['title']
        if len(title) > 80:
            title = title[:77] + "..."
        lines.append(f"{status_icon} `{r['key']}` — {title} [{r['type']} / {r['priority']}]")
        if r["auto_filled"]:
            fields = ", ".join(f"`{f}`" for f in r["auto_filled"])
            lines.append(f"   ✏️ Auto-filled: {fields}")
        if r["still_missing"]:
            fields = ", ".join(f"`{f}`" for f in r["still_missing"])
            lines.append(f"   🚧 Still needs: {fields}")
        lines.append("")

    dor_complete = sum(1 for r in results if not r["still_missing"])
    lines.append(f"_{dor_complete}/{len(results)} issues are now DoR-complete. Manual review needed for the rest._")

    report = "\n".join(lines)
    print(report)

    status = post_to_discord(report)
    if status and 200 <= status < 300:
        print(f"[po-grooming] Discord summary posted (HTTP {status})")
    else:
        print(f"[po-grooming] Discord post failed (status={status})", file=sys.stderr)


if __name__ == "__main__":
    main()
