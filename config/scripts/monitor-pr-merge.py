#!/usr/bin/env python3
"""
monitor-pr-merge.py — Poll GitHub for merged PRs → transition linked issues approved→released
Replaces n8n workflow huC16MvkjX5FiI3f
Runs every 5 minutes via launchd.
"""
import json, subprocess, urllib.request, pathlib
from datetime import datetime, timezone

REPO_DIR = "/Users/kemuniagent/todero"
GH_TOKEN = "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"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo"
DEPLOY_CHANNEL = "1487584904135970816"  # #deployments
MC_API = "http://localhost:3000/api/issues"
REPOS = ["nabitllc/todero", "nabitllc/vespera"]
STATE_FILE = pathlib.Path(__file__).parent / "state-pr-merge.json"

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"processed": {}}

def save_state(s): STATE_FILE.write_text(json.dumps(s))

def gh_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GH_TOKEN}", "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "KAOS-monitor"})
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def mc_patch(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(MC_API, data=data,
        headers={"Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def discord_post(content):
    data = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{DEPLOY_CHANNEL}/messages", data=data,
        headers={"Authorization": f"Bot {DISCORD_BOT}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10): pass
    except Exception as e: print(f"[discord] {e}")

def main():
    state = load_state()
    processed = state.get("processed", {})
    now = datetime.now(timezone.utc)

    # Prune entries older than 30 days
    processed = {k: v for k, v in processed.items()
                 if (now - datetime.fromisoformat(v)).days < 30}

    try:
        with urllib.request.urlopen(MC_API, timeout=15) as r:
            all_issues = json.loads(r.read())
    except Exception as e:
        print(f"[mc-api] {e}"); return

    issues_by_pr = {}
    for i in all_issues:
        if i.get("pr_url"):
            issues_by_pr.setdefault(i["pr_url"].lower(), []).append(i)

    for repo in REPOS:
        try:
            prs = gh_get(f"https://api.github.com/repos/{repo}/pulls?state=closed&per_page=20&sort=updated&direction=desc")
        except Exception as e:
            print(f"[gh] {repo}: {e}"); continue

        for pr in prs:
            if not pr.get("merged_at"): continue
            key = f"{repo}#{pr['number']}"
            if key in processed: continue
            processed[key] = now.isoformat()

            linked = issues_by_pr.get(pr["html_url"].lower(), [])
            released_any = False
            for issue in linked:
                if issue["status"] != "approved": continue
                try:
                    mc_patch({"id": issue["id"], "status": "released",
                               "transitioned_by": "ops",
                               "implementation_notes": f"Auto-released. PR merged: {pr['html_url']}"})
                    repo_short = repo.split("/")[1]
                    msg = (f"🚀 **Released: {issue['task_key']}** — {issue['title'][:80]}\n"
                           f"• **Repo:** {repo_short}\n• **PR:** <{pr['html_url']}>\n"
                           f"• approved → released | Merged: {pr['merged_at']}")
                    discord_post(msg)
                    print(f"[monitor-pr-merge] released {issue['task_key']}")
                    released_any = True

                    # Prune the feature branch now that it's in main
                    fb = issue.get("feature_branch", "").strip()
                    if fb:
                        subprocess.run(["git", "push", "origin", "--delete", fb],
                                       cwd=REPO_DIR, capture_output=True, text=True, timeout=15)
                        subprocess.run(["git", "branch", "-D", fb],
                                       cwd=REPO_DIR, capture_output=True, text=True, timeout=10)
                        print(f"[monitor-pr-merge] pruned feature branch {fb}")
                except Exception as e:
                    print(f"[mc-patch] {issue.get('task_key')}: {e}")

            # Prune the release branch (e.g. release/2026-04-19-7pm) — it's merged, no longer needed.
            # pr["head"]["ref"] is the source branch of the PR (the release branch).
            if released_any:
                release_branch = pr.get("head", {}).get("ref", "")
                if release_branch and release_branch.startswith("release/"):
                    subprocess.run(["git", "push", "origin", "--delete", release_branch],
                                   cwd=REPO_DIR, capture_output=True, text=True, timeout=15)
                    subprocess.run(["git", "branch", "-D", release_branch],
                                   cwd=REPO_DIR, capture_output=True, text=True, timeout=10)
                    print(f"[monitor-pr-merge] pruned release branch {release_branch}")
                subprocess.run(["git", "fetch", "--prune"], cwd=REPO_DIR,
                               capture_output=True, text=True, timeout=30)
                print("[monitor-pr-merge] git fetch --prune done")

                # Rebuild and restart the production server when todero code merges
                if repo == "nabitllc/todero":
                    print("[monitor-pr-merge] todero PR merged — rebuilding and restarting server")
                    subprocess.run(["git", "checkout", "main"], cwd=REPO_DIR, capture_output=True, text=True, timeout=15)
                    subprocess.run(["git", "pull", "origin", "main"], cwd=REPO_DIR, capture_output=True, text=True, timeout=30)
                    build = subprocess.run(["npm", "run", "build"], cwd=REPO_DIR, capture_output=True, text=True, timeout=300)
                    if build.returncode == 0:
                        subprocess.run(["launchctl", "stop", "work.nabit.todero"], capture_output=True, text=True, timeout=10)
                        subprocess.run(["launchctl", "start", "work.nabit.todero"], capture_output=True, text=True, timeout=10)
                        print("[monitor-pr-merge] server restarted successfully")
                        discord_post("🔄 **Production rebuilt & restarted** — new code is live")
                    else:
                        err = build.stderr[-500:] if build.stderr else "(no output)"
                        print(f"[monitor-pr-merge] build FAILED: {err}")
                        discord_post(f"⚠️ **Production build FAILED** after PR merge — server still on old build\n```{err}```")

    state["processed"] = processed
    save_state(state)

if __name__ == "__main__":
    main()
