#!/usr/bin/env python3
"""
monitor-review-transition.py — Auto-transition in_review → code_review
Replaces n8n workflow 9Frgx5Odj57qrVnk
Runs every 2 minutes via launchd.
"""
import json, urllib.request, pathlib
from datetime import datetime, timezone, timedelta

SUPA = "https://twthgapiouiqhavrcnry.supabase.co"
SK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q"
MC_API = "http://localhost:3000/api/issues"
STATE_FILE = pathlib.Path(__file__).parent / "state-review-transition.json"

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"transitioned": {}}

def save_state(s): STATE_FILE.write_text(json.dumps(s))

def mc_patch(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(MC_API, data=data,
        headers={"Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def main():
    state = load_state()
    transitioned = state.get("transitioned", {})
    now = datetime.now(timezone.utc)

    # Prune entries older than 7 days
    transitioned = {k: v for k, v in transitioned.items()
                    if (now - datetime.fromisoformat(v)).days < 7}

    cutoff = (now - timedelta(minutes=2, seconds=30)).isoformat()
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/issues?status=eq.in_review&updated_at=gt.{cutoff}"
        f"&select=id,task_key,implementation_notes,commit_sha,regression_test",
        headers={"apikey": SK, "Authorization": f"Bearer {SK}"})

    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            issues = json.loads(r.read())
    except Exception as e:
        print(f"[supa] {e}"); return

    for issue in issues:
        if issue["id"] in transitioned: continue
        try:
            mc_patch({"id": issue["id"], "status": "code_review",
                      "transitioned_by": "monitor-review-transition",
                      "implementation_notes": issue.get("implementation_notes") or "Auto-transitioned from in_review",
                      "commit_sha": issue.get("commit_sha"),
                      "regression_test": issue.get("regression_test")})
            transitioned[issue["id"]] = now.isoformat()
            print(f"[monitor-review-transition] {issue['task_key']} → code_review")
        except Exception as e:
            print(f"[mc-patch] {issue.get('task_key')}: {e}")

    state["transitioned"] = transitioned
    save_state(state)

if __name__ == "__main__":
    main()
