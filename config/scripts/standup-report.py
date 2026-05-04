#!/usr/bin/env python3
"""
standup-report.py  (TASK-19)

Daily async standup report generator.
Designed to run at 8am ET via cron/n8n.

Flow:
  1. Fetch all issues from MC API
  2. Determine the "yesterday" window (24h lookback from now)
  3. Per agent: collect done yesterday, planned today, blockers
  4. Skip agents with no activity
  5. Post aggregated report to Discord #agent-logs

Each section includes issue keys (task_key) and titles.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
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

SUPA_URL = "https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MC_API = "http://localhost:3000/api/issues"
DISCORD_TOKEN = os.environ.get(
    "DISCORD_TOKEN",
    "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo",
)
DISCORD_CHANNEL_ID = os.environ.get("DISCORD_CHANNEL_ID", "1491993545966489620")

# Agents to include in standup (matches openclaw.json agent list)
KNOWN_AGENTS = [
    "main", "scout", "ops", "kemuni-sme", "vespera-sme",
    "builder", "tester", "deployer", "auditor", "designer",
    "po", "growth", "security", "community", "content",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def mc_get(url=MC_API):
    """GET from MC API, return parsed JSON list."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def fetch_recent_issues(cutoff: "datetime") -> list:
    """Fetch issues updated in the last 24h directly from Supabase — avoids full table scan."""
    if not SUPA_KEY:
        return mc_get()
    cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (
        f"{SUPA_URL}/rest/v1/issues"
        f"?updated_at=gte.{cutoff_iso}"
        f"&select=id,task_key,title,status,assignee,type,updated_at,completed_at"
        f"&order=updated_at.desc&limit=500"
    )
    req = urllib.request.Request(url, headers={
        "apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def post_to_discord(message: str):
    """Post a message to Discord #agent-logs."""
    if not DISCORD_TOKEN:
        print(f"[discord-skip] {message}")
        return
    url = f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages"
    data = json.dumps({"content": message}).encode("utf-8")
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
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"Discord HTTP error: {e.code} {e.read().decode()}", file=sys.stderr)
        return e.code
    except Exception as e:
        print(f"Discord error: {e}", file=sys.stderr)
        return None


def now_et() -> datetime:
    """Current time in ET."""
    utc_now = datetime.now(timezone.utc)
    if ET is not None:
        return utc_now.astimezone(ET)
    return utc_now


def format_date_et(dt: datetime) -> str:
    """Format datetime for display."""
    if ET is not None:
        local = dt.astimezone(ET) if dt.tzinfo else dt
        return local.strftime("%A, %B %d %Y")
    return dt.strftime("%A, %B %d %Y")


def parse_iso(ts: str) -> Optional[datetime]:
    """Parse ISO timestamp string to datetime."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def classify_issues(all_issues: list, cutoff: datetime):
    """
    Classify issues into per-agent buckets:
      - done_yesterday: completed/done since cutoff
      - planned_today: open or in_progress right now
      - blocked: status=blocked or fail_count >= 3

    Returns dict[agent_id] -> {done: [], planned: [], blocked: []}
    """
    agents: dict = {}

    for issue in all_issues:
        assignee = (issue.get("assignee") or issue.get("worked_by") or "").lower()
        if not assignee or assignee not in KNOWN_AGENTS:
            continue

        bucket = agents.setdefault(assignee, {
            "done": [], "planned": [], "blocked": [],
        })

        status = (issue.get("status") or "").lower()
        task_key = issue.get("task_key", "???")
        title = issue.get("title", "untitled")
        entry = f"`{task_key}` — {title}"

        # Done yesterday: completed_at or updated_at within window + status done
        if status == "done":
            completed = parse_iso(
                issue.get("completed_at") or issue.get("updated_at") or ""
            )
            if completed and completed >= cutoff:
                bucket["done"].append(entry)
            continue

        # Blocked
        if status == "blocked" or (issue.get("fail_count") or 0) >= 3:
            bucket["blocked"].append(entry)
            continue

        # Planned today: open, in_progress, or in_review
        if status in ("open", "in_progress", "in_review"):
            bucket["planned"].append(entry)

    return agents


def build_report(agents: dict, report_date: datetime) -> str:
    """Build the standup report message from classified agent data."""
    date_str = format_date_et(report_date)
    lines = [f"📋 **Daily Standup — {date_str}**\n"]

    active_count = 0

    for agent_id in KNOWN_AGENTS:
        if agent_id not in agents:
            continue

        data = agents[agent_id]
        done = data["done"]
        planned = data["planned"]
        blocked = data["blocked"]

        # Skip agents with zero activity
        if not done and not planned and not blocked:
            continue

        active_count += 1
        lines.append(f"**{agent_id}**")

        if done:
            lines.append("  ✅ Done yesterday:")
            for item in done[:10]:  # cap at 10
                lines.append(f"    • {item}")
        else:
            lines.append("  ✅ Done yesterday: —")

        if planned:
            lines.append("  📌 Planned today:")
            for item in planned[:10]:
                lines.append(f"    • {item}")
        else:
            lines.append("  📌 Planned today: —")

        if blocked:
            lines.append("  🚧 Blockers:")
            for item in blocked:
                lines.append(f"    • {item}")

        lines.append("")  # blank separator

    if active_count == 0:
        lines.append("_No agent activity in the last 24 hours._")
    else:
        lines.append(f"_{active_count} active agent(s) reporting._")

    return "\n".join(lines)


def main():
    current = now_et()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    try:
        all_issues = fetch_recent_issues(cutoff)
    except Exception as e:
        print(f"Failed to fetch issues: {e}", file=sys.stderr)
        sys.exit(1)

    agents = classify_issues(all_issues, cutoff)
    report = build_report(agents, current)

    # Discord message limit is 2000 chars — split if needed
    if len(report) <= 2000:
        chunks = [report]
    else:
        # Split at agent boundaries (double newline)
        header, _, body = report.partition("\n\n")
        chunks = [header]
        current_chunk = ""
        for section in body.split("\n\n"):
            if len(current_chunk) + len(section) + 2 > 1900:
                chunks.append(current_chunk.strip())
                current_chunk = section
            else:
                current_chunk += "\n\n" + section
        if current_chunk.strip():
            chunks.append(current_chunk.strip())

    posted = 0
    for chunk in chunks:
        status = post_to_discord(chunk)
        if status and 200 <= status < 300:
            posted += 1
        else:
            print(f"Failed to post chunk (status={status})", file=sys.stderr)

    ts = current.strftime("%Y-%m-%d %H:%M %Z") if ET else current.strftime("%Y-%m-%d %H:%M UTC")
    print(f"[{ts}] Standup report posted. {posted}/{len(chunks)} chunks sent.")
    print(report)


if __name__ == "__main__":
    main()
