#!/usr/bin/env python3
"""
monitor-prs.py — Poll GitHub for new PRs → post to Discord #pr-reviews
Replaces n8n workflow dDcSY7ZWV04AgHmW
Runs every 5 minutes via launchd.
"""
import os
import json, os, urllib.request, pathlib
from datetime import datetime, timezone, timedelta

GH_TOKEN = "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"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GT-1av.FQM4lTSXgIVvB6XEA1Td7ir65uYWcyt6LvPHmk"
PR_CHANNEL = "1487826368170299592"  # #pr-reviews
SUPA_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPA_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
REPOS = ["nabitllc/vespera", "nabitllc/todero"]
STATE_FILE = pathlib.Path(__file__).parent / "state-prs.json"

TYPE_EMOJI = {"feature": "✨", "task": "📋", "bug": "🐛", "epic": "🏔️", "ops": "⚙️", "research": "🔬"}

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"seen": {}}

def save_state(s): STATE_FILE.write_text(json.dumps(s))

def gh_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GH_TOKEN}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "KAOS-monitor"})
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def discord_post(content):
    data = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{PR_CHANNEL}/messages", data=data,
        headers={"Authorization": f"Bot {DISCORD_BOT}", "Content-Type": "application/json",
                 "User-Agent": "DiscordBot (https://kaos.nabit.work, 1.0)"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10): pass
    except Exception as e: print(f"[discord] {e}")

def main():
    state = load_state()
    seen = state.get("seen", {})
    now = datetime.now(timezone.utc)

    # Prune seen entries older than 30 days
    seen = {k: v for k, v in seen.items()
            if (now - datetime.fromisoformat(v)).days < 30}

    # Fetch only issues with pr_url set — targeted Supabase query, no full table scan
    issues_by_pr = {}
    if SUPA_KEY:
        try:
            req = urllib.request.Request(
                f"{SUPA_URL}/rest/v1/issues?pr_url=not.is.null&select=id,task_key,title,type,status,pr_url&limit=200",
                headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                for i in json.loads(r.read()):
                    issues_by_pr.setdefault(i["pr_url"].lower(), []).append(i)
        except Exception as e: print(f"[supa] {e}")

    for repo in REPOS:
        try:
            prs = gh_get(f"https://api.github.com/repos/{repo}/pulls?state=open&per_page=20&sort=created&direction=desc")
        except Exception as e:
            print(f"[gh] {repo}: {e}"); continue

        for pr in prs:
            key = f"{repo}#{pr['number']}"
            if key in seen: continue

            linked = issues_by_pr.get(pr["html_url"].lower(), [])
            ts = datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00")).strftime("%b %-d %-I:%M %p EST")

            msg = f"🔀 **PR #{pr['number']}** — {pr['title'][:80]}\n"
            msg += f"Branch: `{pr['head']['ref']}` → `{pr['base']['ref']}`\n"
            msg += f"Author: {pr['user']['login']} | {ts}\n"
            if linked:
                msg += "\n**Linked issues:**\n"
                for i in linked:
                    emoji = TYPE_EMOJI.get(i.get("type", "task"), "📋")
                    k = i.get("task_key", i["id"][:8])
                    suffix = f" [{i['status']}]" if i["status"] in ("approved","released","closed") else ""
                    msg += f"{emoji} **{k}** — {i['title'][:60]}{suffix}\n"
            msg += f"\n<{pr['html_url']}>"

            discord_post(msg)
            seen[key] = now.isoformat()
            print(f"[monitor-prs] posted PR {key}")

    state["seen"] = seen
    save_state(state)

if __name__ == "__main__":
    main()
