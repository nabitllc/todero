#!/usr/bin/env python3
"""
monitor-pr-merge.py — Poll GitHub for merged PRs → transition linked issues approved→released
Replaces n8n workflow huC16MvkjX5FiI3f
Runs every 5 minutes via launchd.

Health check: after detecting a merge, GET the prod URL before marking released.
HTTP 200 → released normally. Non-200 → create bug issue + Discord alert, skip release.
"""
import json, subprocess, urllib.request, urllib.error, pathlib
from datetime import datetime, timezone

import os
GH_TOKEN = os.environ.get("GH_TOKEN", "")
DISCORD_BOT = os.environ.get("DISCORD_BOT_TOKEN", "")
DEPLOY_CHANNEL = "1487584904135970816"  # #deployments
MC_API = "http://localhost:3000/api/issues"
REPOS = ["nabitllc/todero", "nabitllc/vespera"]
STATE_FILE = pathlib.Path(__file__).parent / "state-pr-merge.json"

# Production URLs to health-check after deploy detected
PROD_URLS = {
    "nabitllc/todero":   "https://kaos.nabit.work",
    "nabitllc/vespera":  "https://vespera-nabit.vercel.app",
}

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"processed": {}}

def save_state(s): STATE_FILE.write_text(json.dumps(s))

def git_commit_state():
    """Commit state-pr-merge.json to git so it survives context resets."""
    repo = str(pathlib.Path(__file__).parents[2])  # ~/todero
    try:
        subprocess.run(["git", "-C", repo, "add", "config/scripts/state-pr-merge.json"],
                       check=True, capture_output=True)
        diff = subprocess.run(["git", "-C", repo, "diff", "--cached", "--quiet"],
                              capture_output=True)
        if diff.returncode != 0:  # something staged
            subprocess.run(["git", "-C", repo, "commit", "--no-verify", "-m",
                            "chore(state): update state-pr-merge [skip ci]"],
                           check=True, capture_output=True)
            print("[monitor-pr-merge] state committed to git")
    except Exception as e:
        print(f"[monitor-pr-merge] git commit skipped: {e}")

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

def mc_post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(MC_API, data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def health_check(repo):
    """GET the prod URL for the repo. Returns (ok: bool, status_code: int, url: str)."""
    url = PROD_URLS.get(repo)
    if not url:
        print(f"[health-check] no prod URL configured for {repo}, skipping check")
        return True, 0, ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "KAOS-health-check"})
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
            ok = (200 <= code < 300)
            print(f"[health-check] {url} → {code}")
            return ok, code, url
    except urllib.error.HTTPError as e:
        print(f"[health-check] {url} → HTTP {e.code}")
        return False, e.code, url
    except Exception as e:
        print(f"[health-check] {url} → error: {e}")
        return False, 0, url

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

            # Health check: run once per PR (not per issue) to avoid redundant requests
            hc_ok, hc_code, hc_url = health_check(repo)

            linked = issues_by_pr.get(pr["html_url"].lower(), [])
            for issue in linked:
                if issue["status"] != "approved": continue
                repo_short = repo.split("/")[1]
                try:
                    if hc_ok:
                        mc_patch({"id": issue["id"], "status": "released",
                                   "transitioned_by": "ops",
                                   "implementation_notes": f"Auto-released. PR merged: {pr['html_url']}. Health check: {hc_url} → 200 OK"})
                        msg = (f"🚀 **Released: {issue['task_key']}** — {issue['title'][:80]}\n"
                               f"• **Repo:** {repo_short}\n• **PR:** <{pr['html_url']}>\n"
                               f"• approved → released | Merged: {pr['merged_at']}\n"
                               f"• ✅ Health check passed: {hc_url}")
                        discord_post(msg)
                        print(f"[monitor-pr-merge] released {issue['task_key']}")
                    else:
                        # Health check failed — create a bug + alert; do NOT mark released
                        bug_title = f"[Deploy smoke test failed] {repo_short} prod unhealthy after PR #{pr['number']}"
                        bug_body = {
                            "title": bug_title,
                            "project": repo_short.capitalize(),
                            "type": "bug",
                            "priority": "high",
                            "severity": "S0",
                            "assignee": "builder",
                            "parent_id": issue.get("parent_id"),
                            "acceptance_criteria": f"Prod URL {hc_url} returns HTTP 200.",
                            "description": (
                                f"Health check failed after PR #{pr['number']} was merged.\n"
                                f"URL: {hc_url}\nHTTP status: {hc_code}\n"
                                f"Linked issue: {issue['task_key']} — {issue['title']}"
                            ),
                        }
                        try:
                            mc_post(bug_body)
                            print(f"[monitor-pr-merge] created deploy-failure bug for {issue['task_key']}")
                        except Exception as e:
                            print(f"[mc-post] bug creation failed: {e}")

                        msg = (f"🚨 **Deploy smoke test FAILED** — {repo_short}\n"
                               f"• **PR:** <{pr['html_url']}>\n"
                               f"• **URL:** {hc_url} → HTTP {hc_code}\n"
                               f"• Issue {issue['task_key']} NOT marked released — manual check required\n"
                               f"• Bug filed automatically")
                        discord_post(msg)
                        print(f"[monitor-pr-merge] health check failed for {issue['task_key']}, skipping release")
                except Exception as e:
                    print(f"[mc-patch] {issue.get('task_key')}: {e}")

    state["processed"] = processed
    save_state(state)
    git_commit_state()

if __name__ == "__main__":
    main()
