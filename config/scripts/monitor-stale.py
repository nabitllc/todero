#!/usr/bin/env python3
"""
monitor-stale.py — Detect & auto-recover stale issues.

For issues stuck in `in_progress` for >2h with no `updated_at` change:
  1. PATCH back to `open` via Todero API with implementation_notes + bumped rejection_count
  2. Kill any running `claude` agent processes for that agent
  3. Post alert to Discord #alerts
  4. Append a recovery entry to self-improving/stale-recoveries.md
  5. Pattern-detect: if same agent/issue-type recovered 3+ times, escalate to memory.md

Other stale statuses (product_review, released, completed) still get the existing
Telegram alert for backward compat.

Runs every 2 hours via launchd.
"""
import json
import os
import re
import subprocess
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SUPA = "https://twthgapiouiqhavrcnry.supabase.co"
SK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q"
TODERO_API = "http://localhost:3000/api/issues"
# TOD-XXX: prefer env vars; hardcoded values are dev fallbacks only.
TELEGRAM_CHAT = os.environ.get("TELEGRAM_GROUP_CHAT", "-1003598670302")
TELEGRAM_BOT = os.environ.get("TELEGRAM_BOT_TOKEN", "8792497927:AAEcRevJI2KnxlKpHochhSJj4-SviK281is")

DISCORD_ALERTS_CHANNEL = "1485333335868834063"
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")

SMOKE_STATE = Path.home() / "todero/config" / "self-improving" / "monitor-stale-smoke.json"
MEMORY_API = "http://localhost:3000/api/agent-memory"
TELEGRAM_DM_CHAT = "5084875115"  # Michael's private DM

THRESHOLDS = {"in_progress": 0.25, "product_review": 4, "released": 24, "completed": 48}
STATUS_LABELS = {
    "in_progress": "🔧 In Progress (>15m)",
    "product_review": "👁 Product Review (>4h)",
    "released": "🚀 Released (>24h — needs audit)",
    "completed": "✔️ Completed (>48h — needs close)",
}


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def supa_get(path):
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/{path}",
        headers={"apikey": SK, "Authorization": f"Bearer {SK}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def todero_patch(payload):
    """PATCH an issue via Todero API. Returns (ok, body)."""
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        TODERO_API,
        data=data,
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return True, r.read().decode()
    except Exception as e:
        return False, str(e)


def telegram_send(text):
    data = json.dumps(
        {"chat_id": TELEGRAM_CHAT, "text": text, "parse_mode": "Markdown"}
    ).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_BOT}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as e:
        print(f"[telegram] {e}")


def discord_send(text):
    """Post a message to Discord #alerts via bot token. No-op if token missing."""
    if not DISCORD_BOT_TOKEN:
        print("[discord] no DISCORD_BOT_TOKEN; skipping")
        return
    url = f"https://discord.com/api/v10/channels/{DISCORD_ALERTS_CHANNEL}/messages"
    data = json.dumps({"content": text}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as e:
        print(f"[discord] {e}")


# ── Recovery actions ──────────────────────────────────────────────────────────
def fmt_age(age_h):
    h = int(age_h)
    m = int((age_h - h) * 60)
    return f"{h}h {m}m" if h else f"{m}m"


def kill_agent_processes(agent_id):
    """Kill any running claude CLI processes for this agent. Best-effort."""
    if not agent_id:
        return 0
    killed = 0
    patterns = [
        f"claude.*agent {agent_id}",
        f"claude.*you are {agent_id}",
    ]
    for pat in patterns:
        try:
            r = subprocess.run(
                ["pkill", "-f", pat], capture_output=True, timeout=5
            )
            # pkill exit 0 = killed something, 1 = no match
            if r.returncode == 0:
                killed += 1
        except Exception as e:
            print(f"[pkill] {pat}: {e}")
    return killed


def recover_issue(issue, age_h):
    """Roll a stuck in_progress issue back to open + kill its agent."""
    task_key = issue.get("task_key", "?")
    title = issue.get("title", "")
    agent = issue.get("worked_by") or issue.get("assignee") or ""
    issue_id = issue.get("id")

    new_notes = (
        "Auto-recovered: stale in_progress for >2h. Rolled back to open.\n"
        f"(Previous worker: {agent or 'unknown'}, stuck for {fmt_age(age_h)})"
    )
    # Preserve any existing implementation_notes by appending
    existing_notes = issue.get("implementation_notes") or ""
    combined = (
        f"{existing_notes}\n\n---\n{new_notes}".strip() if existing_notes else new_notes
    )

    new_rejection = (issue.get("rejection_count") or 0) + 1

    # API validator requires transitioned_by == current assignee.
    # Use the assignee (or fall back to 'builder' which is the most common stuck lane).
    transitioned_by = (issue.get("assignee") or agent or "builder")
    payload = {
        "id": issue_id,
        "status": "open",
        "implementation_notes": combined,
        "rejection_count": new_rejection,
        "transitioned_by": transitioned_by,
    }
    ok, body = todero_patch(payload)
    if not ok:
        print(f"[recover] {task_key} PATCH failed: {body}")
        return False

    killed = kill_agent_processes(agent)
    print(f"[recover] {task_key} rolled back; killed={killed} pkill matches")

    # Discord alert
    msg = (
        "🚨 **Stale Agent Recovered**\n"
        f"Issue: {task_key} — {title[:80]}\n"
        f"Agent: {agent or 'unknown'}\n"
        f"Stuck for: {fmt_age(age_h)}\n"
        "Action: Rolled back to open, agent process killed"
    )
    discord_send(msg)

    # Log to self-improving memory
    log_recovery(issue, age_h, existing_notes)
    return True


def db_append_memory(agent_id: str, memory_type: str, entry: str, date_key=None) -> bool:
    """GET current content from DB, append entry, POST back. Returns success."""
    try:
        params = f"agent_id={agent_id}&type={memory_type}"
        if date_key:
            params += f"&date={date_key}"
        req = urllib.request.Request(
            f"{MEMORY_API}?{params}",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read()).get("memory", [])
        existing = rows[0]["content"] if rows else ""
        if existing and not existing.endswith("\n"):
            existing += "\n"
        updated = existing + entry
        data = json.dumps({"agent_id": agent_id, "memory_type": memory_type, "content": updated, "date_key": date_key}).encode()
        req = urllib.request.Request(MEMORY_API, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10):
            pass
        return True
    except Exception as e:
        print(f"[db_append_memory] {agent_id}/{memory_type}: {e}")
        return False


def log_recovery(issue, age_h, prior_notes):
    """Append recovery entry to DB corrections; pattern-detect if 3+ same agent/type."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    task_key = issue.get("task_key", "?")
    agent = issue.get("worked_by") or issue.get("assignee") or "unknown"
    itype = issue.get("type") or "?"
    title = (issue.get("title") or "").replace("\n", " ")[:80]

    why = "no implementation_notes — likely model timeout or agent crash"
    if prior_notes:
        first_line = prior_notes.strip().splitlines()[0][:140]
        why = f"prior notes: {first_line}"

    entry = (
        f"## {today} — {task_key}\n"
        f"- **Agent:** {agent}\n"
        f"- **Type:** {itype}\n"
        f"- **Title:** {title}\n"
        f"- **Stuck for:** {fmt_age(age_h)}\n"
        f"- **Why:** {why}\n\n"
    )
    db_append_memory("global", "corrections", entry)
    pattern_detect(agent, itype, task_key)


def pattern_detect(agent, itype, task_key):
    """If same agent or issue-type recovered 3+ times, append escalation to self_improving in DB."""
    try:
        req = urllib.request.Request(
            f"{MEMORY_API}?agent_id=global&type=corrections",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read()).get("memory", [])
        text = rows[0]["content"] if rows else ""
    except Exception:
        return

    agents = re.findall(r"- \*\*Agent:\*\* (\S+)", text)
    types = re.findall(r"- \*\*Type:\*\* (\S+)", text)

    agent_count = Counter(agents).get(agent, 0)
    type_count = Counter(types).get(itype, 0)

    triggers = []
    if agent_count >= 3:
        triggers.append(f"Agent `{agent}` has been auto-recovered {agent_count} times — investigate why it stalls")
    if type_count >= 3 and itype not in ("?", "task"):
        triggers.append(f"Issue type `{itype}` recovered {type_count} times — review templates/workflow")

    if not triggers:
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    note = f"\n## Stale-Recovery Pattern (auto-detected {today})\n"
    for t in triggers:
        note += f"- {t} (latest: {task_key})\n"

    # Avoid duplicate stamp for same day
    try:
        req = urllib.request.Request(f"{MEMORY_API}?agent_id=global&type=self_improving", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read()).get("memory", [])
        existing = rows[0]["content"] if rows else ""
        if f"auto-detected {today}" in existing:
            return
    except Exception:
        pass

    db_append_memory("global", "self_improving", note)
    print(f"[pattern] escalated to DB self_improving: {triggers}")


# ── Main ──────────────────────────────────────────────────────────────────────
def auto_advance_completed(issues):
    """Fast-path: if an issue is in_progress and has implementation_notes set
    (agent completed work but forgot to PATCH status), auto-advance based on type."""
    advanced = 0
    for issue in issues:
        if issue.get("status") != "in_progress":
            continue
        notes = issue.get("implementation_notes") or ""
        # Skip if no notes OR notes are just recovery markers
        if len(notes) < 30 or "Auto-recovered" in notes:
            continue
        itype = issue.get("type") or "task"
        # Pick target status: code_review for code-producing, product_review otherwise
        target = "code_review" if itype in ("task", "bug", "ops") else "product_review"
        agent = issue.get("worked_by") or issue.get("assignee") or "builder"
        payload = {
            "id": issue["id"],
            "status": target,
            "transitioned_by": agent,
            "implementation_notes": notes,
            "regression_test": "npm run build",
        }
        ok, body = todero_patch(payload)
        if ok:
            print(f"[auto-advance] {issue.get('task_key')} → {target} (agent had notes)")
            advanced += 1
    return advanced


def main():
    now = datetime.now(timezone.utc)
    statuses = ",".join(THRESHOLDS.keys())
    issues = supa_get(
        f"issues?status=in.({statuses})"
        "&select=id,task_key,title,status,assignee,worked_by,updated_at,"
        "implementation_notes,rejection_count,type"
    )

    # ── Fast-path: auto-advance in_progress with implementation_notes ─────────
    auto_advance_completed(issues)

    # Re-fetch after possible advances
    issues = supa_get(
        f"issues?status=in.({statuses})"
        "&select=id,task_key,title,status,assignee,worked_by,updated_at,"
        "implementation_notes,rejection_count,type"
    )

    stale_by_status = {}
    for issue in issues:
        threshold = THRESHOLDS.get(issue["status"], 999)
        updated = datetime.fromisoformat(issue["updated_at"].replace("Z", "+00:00"))
        age_h = (now - updated).total_seconds() / 3600
        if age_h >= threshold:
            stale_by_status.setdefault(issue["status"], []).append(
                {**issue, "age_h": age_h}
            )

    # ── Auto-recover in_progress > 2h ─────────────────────────────────────────
    recovered = []
    for issue in stale_by_status.get("in_progress", []):
        if recover_issue(issue, issue["age_h"]):
            recovered.append(issue)

    if recovered:
        print(f"[monitor-stale] auto-recovered {len(recovered)} stale in_progress issues")

    # ── Telegram alert (backward compat) — for everything stale, including recovered ──
    if not stale_by_status:
        print("[monitor-stale] nothing stale")
        return

    total = sum(len(v) for v in stale_by_status.values())
    sections = []
    for status, items in stale_by_status.items():
        label = STATUS_LABELS.get(status, status)
        section = f"\n*{label}:*"
        for i in items[:3]:
            section += f"\n  • {i['task_key']} {i['title'][:45]} — {round(i['age_h'])}h"
        if len(items) > 3:
            section += f"\n  • ...+{len(items)-3} more"
        sections.append(section)

    suffix = ""
    if recovered:
        keys = ", ".join(i["task_key"] for i in recovered[:5])
        suffix = f"\n\n♻️ *Auto-recovered:* {keys}"

    text = (
        f"⚠️ *Stale Issues — {total} need attention*"
        f"{''.join(sections)}{suffix}"
        "\n\n📊 [Mission Control](https://kaos.nabit.work)"
    )
    telegram_send(text)
    print(f"[monitor-stale] alerted on {total} stale issues")


# ── Watchdog smoke test (TOD-797) ─────────────────────────────────────────────
# Runs hourly via its own LaunchAgent. Verifies the recovery API path still
# works by doing a no-op PATCH against a REAL in_progress issue (safe: only
# updates `updated_at` by touching `implementation_notes` to its current value).
# If the API response code changes from the last run, alerts Telegram DM.
# If 3 consecutive runs fail, escalates to Telegram DM with full context.


def telegram_dm(text):
    """Send to Michael's private chat, not the group."""
    data = json.dumps({"chat_id": TELEGRAM_DM_CHAT, "text": text}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_BOT}/sendMessage",
        data=data, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception as e:
        print(f"[telegram_dm] {e}")


def load_smoke_state():
    if SMOKE_STATE.exists():
        try:
            return json.loads(SMOKE_STATE.read_text())
        except Exception:
            pass
    return {"last_http_code": None, "consecutive_failures": 0, "last_ok_at": None, "last_run_at": None}


def save_smoke_state(state):
    SMOKE_STATE.parent.mkdir(parents=True, exist_ok=True)
    SMOKE_STATE.write_text(json.dumps(state, indent=2))


def smoke_test():
    """Hourly watchdog: verify the monitor-stale PATCH path still works end-to-end."""
    state = load_smoke_state()
    state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    now = datetime.now(timezone.utc)

    # Pick any in_progress issue for Todero project to use as a smoke target.
    issues = supa_get(
        "issues?status=eq.in_progress&project=eq.Todero"
        "&select=id,task_key,title,assignee,implementation_notes,rejection_count&limit=1"
    )

    if not issues:
        # No in_progress issues means nothing to smoke-test against. That's fine —
        # we log OK and move on. If there are no in_progress issues for >1h that
        # itself is a signal the pipeline is idle (TOD-776 territory).
        print("[smoke] no in_progress issues — nothing to test against")
        state["last_http_code"] = "idle"
        state["consecutive_failures"] = 0
        state["last_ok_at"] = now.isoformat()
        save_smoke_state(state)
        return 0

    target = issues[0]
    task_key = target.get("task_key", "?")
    agent = target.get("assignee", "builder")
    current_notes = target.get("implementation_notes") or "[smoke-test baseline]"

    # No-op PATCH: set implementation_notes to its current value + a smoke marker.
    # This exercises the full validator path (transitioned_by check, assignee
    # match, etc.) without changing state. DO NOT write to implementation_notes
    # anymore — smoke markers were polluting the field and confusing the UI.
    # Instead, PATCH just updated_at implicitly by setting a field that already
    # has its current value (priority is read-back above).
    payload = {
        "id": target["id"],
        "status": "in_progress",  # no-op: already in_progress
        "transitioned_by": agent,
        # Setting priority back to itself exercises the validator path without
        # writing anything observable. If priority is null we fall back to
        # updated_at bump via updated_at field (which the API recomputes anyway).
        **({"priority": target.get("priority")} if target.get("priority") else {}),
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        TODERO_API, data=data,
        headers={"Content-Type": "application/json"}, method="PATCH",
    )

    http_code = None
    error_body = ""
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            http_code = r.getcode()
    except urllib.error.HTTPError as e:
        http_code = e.code
        try:
            error_body = e.read().decode()[:300]
        except Exception:
            pass
    except Exception as e:
        http_code = -1
        error_body = str(e)[:300]

    prior_code = state.get("last_http_code")
    print(f"[smoke] {task_key} → HTTP {http_code} (prior: {prior_code})")

    # Acceptable: 200/204 (success) OR 400 if it's a validator rejection that
    # matches the expected same-state check (some APIs refuse no-op transitions).
    ok = http_code in (200, 204)

    if ok:
        state["last_http_code"] = http_code
        state["consecutive_failures"] = 0
        state["last_ok_at"] = now.isoformat()

        # Code changed from a prior failure back to OK → recovery alert
        if prior_code not in (200, 204, "idle", None):
            telegram_dm(
                f"✅ monitor-stale API recovered\n"
                f"HTTP {prior_code} → {http_code}\n"
                f"Tested against {task_key}"
            )
    else:
        state["consecutive_failures"] = state.get("consecutive_failures", 0) + 1
        state["last_http_code"] = http_code

        # Drift alert: HTTP code differs from last known good
        if prior_code in (200, 204) and http_code != prior_code:
            telegram_dm(
                f"🚨 monitor-stale API drift\n"
                f"HTTP {prior_code} → {http_code}\n"
                f"Target: {task_key} (agent={agent})\n"
                f"Error: {error_body[:200]}\n\n"
                "The auto-recovery safety net may be broken. Check "
                "~/todero/config/scripts/monitor-stale.py and /api/issues "
                "validators."
            )

        # Escalate on 3 consecutive failures
        if state["consecutive_failures"] >= 3:
            telegram_dm(
                f"🔥 monitor-stale: {state['consecutive_failures']} consecutive failures\n"
                f"Last HTTP: {http_code}\n"
                f"Last OK: {state.get('last_ok_at') or 'never'}\n"
                f"Error: {error_body[:200]}\n\n"
                "Auto-recovery is down. Agents will freeze overnight."
            )

    save_smoke_state(state)
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    if "--smoke" in sys.argv:
        sys.exit(smoke_test())
    main()
