#!/usr/bin/env python3
"""
monitor-pr-merge.py — Poll GitHub for merged PRs → transition linked issues approved→released
Replaces n8n workflow huC16MvkjX5FiI3f
Runs every 5 minutes via launchd.
"""
import json, os, subprocess, urllib.request, pathlib
from datetime import datetime, timezone

REPO_DIR = "/Users/kemuniagent/todero"
GH_TOKEN = "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"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GT-1av.FQM4lTSXgIVvB6XEA1Td7ir65uYWcyt6LvPHmk"
DEPLOY_CHANNEL = "1487584904135970816"  # #deployments
MC_API = "http://localhost:3000/api/issues"
SUPA_URL = "https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
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
        headers={"Authorization": f"Bot {DISCORD_BOT}", "Content-Type": "application/json",
                 "User-Agent": "DiscordBot (https://kaos.nabit.work, 1.0)"},
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

    # Fetch only issues with pr_url set — targeted Supabase query, no full table scan
    issues_by_pr = {}
    if SUPA_KEY:
        try:
            req = urllib.request.Request(
                f"{SUPA_URL}/rest/v1/issues?pr_url=not.is.null&select=id,task_key,title,type,status,pr_url,feature_branch&limit=200",
                headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                for i in json.loads(r.read()):
                    issues_by_pr.setdefault(i["pr_url"].lower(), []).append(i)
        except Exception as e:
            print(f"[supa] {e}"); return
    else:
        try:
            with urllib.request.urlopen(MC_API, timeout=15) as r:
                for i in json.loads(r.read()):
                    if i.get("pr_url"):
                        issues_by_pr.setdefault(i["pr_url"].lower(), []).append(i)
        except Exception as e:
            print(f"[mc-api] {e}"); return

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
            released_keys = []
            merge_sha = (pr.get("merge_commit_sha") or "")[:8]
            ts = datetime.fromisoformat(pr["merged_at"].replace("Z", "+00:00")).strftime("%b %-d, %I:%M %p EST")

            # TOD-1919 ordering fix: build-check BEFORE transitioning issues
            # to released. Previously the transition ran here unconditionally;
            # a post-merge build failure produced a Discord warning while
            # issues were already marked released, so the drift signal was
            # lost. Now the transition only happens if the build passes.
            pending = [i for i in linked if i.get("status") == "approved"]

            # Prune the release branch regardless — it's already merged into
            # main, so removing it is safe independent of the build result.
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

            build_ok = True
            build_err = ""
            if repo == "nabitllc/todero" and pending:
                print("[monitor-pr-merge] todero PR merged — build check before release transition")
                subprocess.run(["git", "checkout", "main"], cwd=REPO_DIR,
                               capture_output=True, text=True, timeout=15)
                subprocess.run(["git", "pull", "origin", "main"], cwd=REPO_DIR,
                               capture_output=True, text=True, timeout=30)
                build = subprocess.run(["npm", "run", "build"], cwd=REPO_DIR,
                                       capture_output=True, text=True, timeout=300)
                build_ok = build.returncode == 0
                if not build_ok:
                    build_err = (build.stderr[-300:] if build.stderr else "(no output)")

            if pending and not build_ok:
                # Build broke after merge: do NOT transition, do NOT prune feat
                # branches, do NOT restart the server. Alert loudly, annotate
                # each affected issue so a human can fix the build on main and
                # then PATCH these to released manually.
                keys = ", ".join(i.get("task_key", "?") for i in pending)
                print(f"[monitor-pr-merge] build FAILED — leaving {keys} in approved")
                discord_post(
                    f"⚠️ **Deploy failed** — PR #{pr['number']} merged but `npm run build` failed on main.\n"
                    f"↳ Issues left in **approved**: {keys}\n"
                    f"↳ Build error: `{build_err[:150]}`\n"
                    f"↳ `{merge_sha}` · {ts}\n"
                    f"<{pr['html_url']}>"
                )
                for issue in pending:
                    try:
                        existing = issue.get("reviewer_notes") or ""
                        note = (
                            f"Auto-release skipped — PR #{pr['number']} merged ({merge_sha}) "
                            f"but `npm run build` failed on main at {ts}. Feature branch was "
                            f"NOT pruned; server was NOT restarted. Fix the build on main, "
                            f"verify `npm run build` passes, then manually PATCH this issue "
                            f"to released. Build error excerpt: {build_err[:200]}"
                        )
                        combined = (existing + "\n\n---\n" + note) if existing else note
                        mc_patch({"id": issue["id"], "reviewer_notes": combined})
                    except Exception as e:
                        print(f"[mc-patch] failed to annotate {issue.get('task_key')}: {e}")
                continue  # skip the released-any block below for this PR

            # Build passed (or no build check applied) — proceed with transitions.
            for issue in pending:
                try:
                    mc_patch({"id": issue["id"], "status": "released",
                               "transitioned_by": "ops",
                               "implementation_notes": f"Auto-released. PR merged: {pr['html_url']}"})
                    released_keys.append(issue.get("task_key", issue["id"][:8]))
                    print(f"[monitor-pr-merge] released {issue.get('task_key')}")

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

            released_any = bool(released_keys)

            if released_any:
                restart_ok = True
                restart_err = ""
                if repo == "nabitllc/todero":
                    # stop + start are not atomic. If stop succeeds and start
                    # fails, the site goes down until a human intervenes, so
                    # treat a non-zero start as a loud failure. Previously
                    # this block always printed "restarted successfully"
                    # regardless of exit code (TOD-1514 P4 gap).
                    subprocess.run(["launchctl", "stop", "work.nabit.todero"],
                                   capture_output=True, text=True, timeout=10)
                    start = subprocess.run(["launchctl", "start", "work.nabit.todero"],
                                           capture_output=True, text=True, timeout=10)
                    if start.returncode != 0:
                        restart_ok = False
                        restart_err = (start.stderr or start.stdout or f"exit {start.returncode}")[:200]
                        print(f"[monitor-pr-merge] SERVER RESTART FAILED: {restart_err}")
                        discord_post(
                            f"🚨 **Server restart FAILED** — PR #{pr['number']} deployed but "
                            f"`launchctl start work.nabit.todero` returned non-zero.\n"
                            f"↳ kaos.nabit.work may be down. Issues already marked **released**: "
                            f"{', '.join(released_keys)}\n"
                            f"↳ Error: `{restart_err[:150]}`\n"
                            f"↳ Fix: run `launchctl start work.nabit.todero` manually and check "
                            f"`tail /tmp/todero-error.log`.\n"
                            f"↳ `{merge_sha}` · {ts}"
                        )
                    else:
                        print("[monitor-pr-merge] server restarted successfully")

                # One unified message per PR
                n = len(released_keys)
                msg = f"🚀 **Deployed** — PR #{pr['number']} · {n} issue{'s' if n != 1 else ''}\n"
                msg += f"↳ {', '.join(released_keys)}\n"
                msg += f"↳ `{merge_sha}` · {ts}\n"
                msg += f"<{pr['html_url']}>"
                discord_post(msg)

                # Create release note in DB
                released_ids = [i["id"] for i in linked if i.get("task_key") in released_keys]
                try:
                    payload = json.dumps({
                        "pr_number": pr["number"],
                        "pr_url": pr["html_url"],
                        "commit_sha": merge_sha,
                        "repo": repo,
                        "issue_ids": released_ids,
                        "merged_at": pr["merged_at"],
                    }).encode()
                    req_r = urllib.request.Request(
                        "http://localhost:3000/api/releases", data=payload,
                        headers={"Content-Type": "application/json"}, method="POST")
                    with urllib.request.urlopen(req_r, timeout=15) as r:
                        result = json.loads(r.read())
                        print(f"[monitor-pr-merge] release created: v{result.get('version')}")
                except Exception as e:
                    print(f"[monitor-pr-merge] release creation failed: {e}")

    state["processed"] = processed
    save_state(state)

if __name__ == "__main__":
    main()
