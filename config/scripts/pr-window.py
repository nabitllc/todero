#!/usr/bin/env python3
"""
pr-window.py — Push approved branches and open PRs at 7am/7pm EDT sprint windows.
Replaces the missing pr_window_server.py / n8n PR Window workflow.

Runs at 7am and 7pm EDT via launchd (work.nabit.pr-window.plist).

Logic:
  1. Fetch all issues with status=approved and a feature_branch set
  2. For each: git push the branch, open a GitHub PR via API
  3. Post summary to Discord #deployments
  4. Mark issues as having a PR (patch pr_url)

Rules (from AGENTS.md):
  - Builder commits locally only, NEVER pushes
  - KAOS (this script) owns all git push and PR creation
  - PRs only at 7am and 7pm windows
  - No push triggers Vercel preview builds until PR is opened
"""

import json
import os
import pathlib
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except ImportError:
    ET = None

MC_API = "http://localhost:3000/api/issues"
MC_DIR = "/Users/kemuniagent/todero"
GH_TOKEN = "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"
GH_ORG = "nabitllc"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo"
DEPLOY_CHANNEL = "1487584904135970816"   # #deployments
PR_CHANNEL = "1487826368170299592"       # #pr-reviews
LOG_FILE = "/tmp/pr-window.log"

# Map project names to GitHub repos
PROJECT_REPOS = {
    "Todero": "todero",
    "Mission Control": "todero",
    "Infrastructure": "todero",
    "Vespera": "vespera",
    "Kemuni": "todero",
    "KAOS": "todero",
}


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def mc_get() -> list:
    with urllib.request.urlopen(MC_API, timeout=15) as r:
        return json.loads(r.read())


def mc_patch(payload: dict):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(MC_API, data=data,
        headers={"Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def discord_post(channel: str, content: str):
    data = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{channel}/messages", data=data,
        headers={"Authorization": f"Bot {DISCORD_BOT}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10): pass
    except Exception as e:
        log(f"[discord] {e}")


def gh_create_pr(repo: str, branch: str, title: str, body: str) -> Optional[dict]:
    """Create a GitHub PR. Returns PR data dict or None on failure."""
    url = f"https://api.github.com/repos/{GH_ORG}/{repo}/pulls"
    payload = {
        "title": title,
        "head": branch,
        "base": "main",
        "body": body,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KAOS-pr-window",
        "Content-Type": "application/json",
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.request.HTTPError as e:
        body = e.read().decode()
        log(f"[gh] PR creation failed {e.code}: {body[:200]}")
        # 422 = PR already exists for this branch — try to find it
        if e.code == 422:
            return gh_find_existing_pr(repo, branch)
        return None
    except Exception as e:
        log(f"[gh] {e}")
        return None


def gh_merge_pr(repo: str, pr_number: int) -> bool:
    """Auto-merge a PR. Returns True on success.
    The PR exists as an audit trail (who approved what, what changed),
    not as a review gate — tester+designer already reviewed the code
    during code_review. If merge fails (conflict, branch protection),
    it stays open for manual intervention."""
    url = f"https://api.github.com/repos/{GH_ORG}/{repo}/pulls/{pr_number}/merge"
    payload = {
        "merge_method": "squash",
        "commit_title": f"Release PR #{pr_number}",
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KAOS-pr-window",
        "Content-Type": "application/json",
    }, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            result = json.loads(r.read())
            log(f"[pr] #{pr_number} auto-merged: {result.get('message', 'ok')}")
            return True
    except urllib.request.HTTPError as e:
        body = e.read().decode()
        log(f"[pr] #{pr_number} auto-merge failed {e.code}: {body[:200]}")
        return False
    except Exception as e:
        log(f"[pr] #{pr_number} merge error: {e}")
        return False


def gh_find_existing_pr(repo: str, branch: str) -> Optional[dict]:
    """Find an already-open PR for this branch."""
    url = f"https://api.github.com/repos/{GH_ORG}/{repo}/pulls?head={GH_ORG}:{branch}&state=open"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KAOS-pr-window",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            prs = json.loads(r.read())
            return prs[0] if prs else None
    except Exception:
        return None


def git_push(branch: str, repo_dir: str) -> bool:
    """Push a branch to origin. Returns True on success."""
    try:
        result = subprocess.run(
            ["git", "push", "origin", branch],
            cwd=repo_dir, capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            log(f"[git] pushed {branch}")
            return True
        else:
            # Already up to date is fine
            if "Everything up-to-date" in result.stderr or "already exists" in result.stderr:
                log(f"[git] {branch} already pushed")
                return True
            log(f"[git] push failed for {branch}: {result.stderr[:200]}")
            return False
    except Exception as e:
        log(f"[git] push error: {e}")
        return False


def get_current_branch(repo_dir: str) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=repo_dir, capture_output=True, text=True)
    return result.stdout.strip()


def build_pr_body(issues: list) -> str:
    """Build the PR description from linked issues."""
    lines = ["## Issues in this PR\n"]
    for i in issues:
        key = i.get("task_key", i["id"][:8])
        lines.append(f"- **{key}** — {i['title']}")
        if i.get("acceptance_criteria"):
            lines.append(f"  - AC: {i['acceptance_criteria'][:100]}")
    lines.append("\n---\n_Auto-opened by KAOS PR Window (7am/7pm EDT)_")
    return "\n".join(lines)


def window_label() -> str:
    now = datetime.now(ET) if ET else datetime.now()
    return f"{'7am' if now.hour < 12 else '7pm'} {now.strftime('%b %d')}"


def main():
    log(f"=== PR Window — {window_label()} ===")

    try:
        all_issues = mc_get()
    except Exception as e:
        log(f"[mc-api] Failed to fetch issues: {e}")
        sys.exit(1)

    # Find approved issues with a feature_branch set and no pr_url yet
    ready = [i for i in all_issues
             if i.get("status") == "approved"
             and i.get("feature_branch")
             and not i.get("pr_url")]

    if not ready:
        log("No approved issues with branches ready — nothing to do")
        discord_post(DEPLOY_CHANNEL,
            f"🔀 **PR Window — {window_label()}** | No approved branches to push. Queue clear.")
        return

    log(f"Found {len(ready)} approved issue(s) with branches")

    # Group issues by repo (1 PR per repo per window)
    by_repo: dict[str, list] = {}
    for issue in ready:
        project = issue.get("project", "Todero")
        repo = PROJECT_REPOS.get(project, "todero")
        by_repo.setdefault(repo, []).append(issue)

    pushed = []
    failed = []
    now_str = datetime.now(ET).strftime("%-I:%M %p %Z") if ET else datetime.now().strftime("%H:%M UTC")
    now_date = datetime.now(ET).strftime("%Y-%m-%d") if ET else datetime.now().strftime("%Y-%m-%d")
    window = "7am" if (datetime.now(ET) if ET else datetime.now()).hour < 12 else "7pm"

    for repo, issues in by_repo.items():
        repo_dir = MC_DIR  # extend for multi-repo later
        release_branch = f"release/{now_date}-{window}"

        log(f"Building release branch {release_branch} for {repo} ({len(issues)} issue(s))")

        # Close any existing open PR for this repo from a previous window
        existing_pr = gh_find_existing_pr(repo, release_branch)
        if existing_pr:
            pr_num = existing_pr.get("number")
            log(f"[pr] Closing superseded PR #{pr_num}")
            try:
                close_data = json.dumps({"state": "closed"}).encode()
                close_req = urllib.request.Request(
                    f"https://api.github.com/repos/{GH_ORG}/{repo}/pulls/{pr_num}",
                    data=close_data, method="PATCH",
                    headers={"Authorization": f"Bearer {GH_TOKEN}",
                             "Accept": "application/vnd.github+json",
                             "Content-Type": "application/json"})
                urllib.request.urlopen(close_req, timeout=15)
            except Exception as e:
                log(f"[pr] Failed to close old PR: {e}")

        # Create release branch from main, merge all feature branches into it
        try:
            subprocess.run(["git", "checkout", "main"], cwd=repo_dir,
                          capture_output=True, text=True, timeout=30)
            subprocess.run(["git", "pull", "--ff-only"], cwd=repo_dir,
                          capture_output=True, text=True, timeout=60)
            subprocess.run(["git", "branch", "-D", release_branch], cwd=repo_dir,
                          capture_output=True, text=True, timeout=10)  # delete if exists
            subprocess.run(["git", "checkout", "-b", release_branch], cwd=repo_dir,
                          capture_output=True, text=True, timeout=10)
        except Exception as e:
            log(f"[git] Failed to create release branch: {e}")
            failed.append(release_branch)
            continue

        # Merge each feature branch into release branch.
        # First rebase each branch on main to minimize conflicts from
        # stale branches that diverged while other work landed.
        merged_issues = []
        merge_failed = []
        for issue in issues:
            branch = issue.get("feature_branch", "").strip()
            if not branch:
                continue

            # Step 1: Rebase the feature branch on main (in the release branch context)
            # This brings the feature branch up to date with main before merging.
            rebase_ok = subprocess.run(
                ["git", "rebase", "main", branch],
                cwd=repo_dir, capture_output=True, text=True, timeout=60
            )
            if rebase_ok.returncode != 0:
                subprocess.run(["git", "rebase", "--abort"], cwd=repo_dir,
                              capture_output=True, text=True, timeout=10)
                # Rebase failed — try merge anyway (might still work for trivial divergence)
                log(f"  [rebase] {branch} failed to rebase — falling back to direct merge")
                # Go back to release branch
                subprocess.run(["git", "checkout", release_branch], cwd=repo_dir,
                              capture_output=True, text=True, timeout=10)
            else:
                log(f"  [rebase] {branch} rebased on main")
                # Go back to release branch
                subprocess.run(["git", "checkout", release_branch], cwd=repo_dir,
                              capture_output=True, text=True, timeout=10)

            # Step 2: Merge the (now-rebased) feature branch
            result = subprocess.run(
                ["git", "merge", branch, "--no-edit", "-m",
                 f"Merge {branch} ({issue.get('task_key', '?')})"],
                cwd=repo_dir, capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                merged_issues.append(issue)
                log(f"  Merged {branch} ({issue.get('task_key')})")
            else:
                # Abort failed merge and skip this branch
                subprocess.run(["git", "merge", "--abort"], cwd=repo_dir,
                              capture_output=True, text=True, timeout=10)
                merge_failed.append(issue)
                log(f"  CONFLICT: {branch} ({issue.get('task_key')}) — skipped")

        if not merged_issues:
            log(f"No branches merged successfully for {repo}")
            subprocess.run(["git", "checkout", "main"], cwd=repo_dir,
                          capture_output=True, text=True, timeout=10)
            failed.append(release_branch)
            continue

        # Push release branch
        push_ok = git_push(release_branch, repo_dir)
        subprocess.run(["git", "checkout", "main"], cwd=repo_dir,
                      capture_output=True, text=True, timeout=10)

        if not push_ok:
            failed.append(release_branch)
            continue

        # Build PR
        keys = ", ".join(i.get("task_key", "?") for i in merged_issues)
        pr_title = f"Release {window} {now_date}: {keys}"
        if len(pr_title) > 72:
            pr_title = f"Release {window} {now_date}: {len(merged_issues)} issues"
        pr_body = build_pr_body(merged_issues)
        if merge_failed:
            pr_body += f"\n\n⚠️ **Skipped (merge conflict):**\n"
            for mf in merge_failed:
                pr_body += f"- {mf.get('task_key', '?')}: {mf['title'][:60]} (`{mf.get('feature_branch')}`)\n"

        pr = gh_create_pr(repo, release_branch, pr_title, pr_body)
        if not pr:
            failed.append(release_branch)
            continue

        pr_url = pr.get("html_url", "")
        pr_number = pr.get("number", "?")
        log(f"[pr] #{pr_number} created: {pr_url}")

        # PR stays open for Michael to review and merge.
        # KAOS never auto-merges — only Michael approves merges.
        issue_keys = ", ".join(i.get("task_key", "?") for i in merged_issues)
        review_msg = (
            f"👀 **PR #{pr_number} ready for review** — `{pr_title}`\n"
            f"Issues: {issue_keys}\n"
            f"<{pr_url}>\n"
            f"_Merge when ready — KAOS won't auto-merge._"
        )
        discord_post(PR_CHANNEL, review_msg)

        # Patch all merged issues with pr_url
        for issue in merged_issues:
            try:
                mc_patch({"id": issue["id"], "pr_url": pr_url})
            except Exception as e:
                log(f"[mc-patch] {issue.get('task_key')}: {e}")

        pushed.append({"branch": release_branch, "pr_url": pr_url,
                       "pr_number": pr_number, "issues": merged_issues,
                       "conflicts": merge_failed})

    # Post summary to Discord
    if pushed:
        lines = [f"🔀 **PR Window — {window_label()}** | {now_str} | {len(pushed)} release PR(s)\n"]
        for p in pushed:
            issue_keys = ", ".join(i.get("task_key", "?") for i in p["issues"])
            lines.append(f"• **PR #{p['pr_number']}** — `{p['branch']}` | {len(p['issues'])} issues: {issue_keys}")
            lines.append(f"  <{p['pr_url']}>")
            if p.get("conflicts"):
                conflict_keys = ", ".join(i.get("task_key", "?") for i in p["conflicts"])
                lines.append(f"  ⚠️ Conflicts (skipped): {conflict_keys}")
        discord_post(DEPLOY_CHANNEL, "\n".join(lines))
        discord_post(PR_CHANNEL, "\n".join(lines))

    if failed:
        fail_msg = f"⚠️ **PR Window** | Failed: `{'`, `'.join(failed)}` — needs manual check"
        discord_post(DEPLOY_CHANNEL, fail_msg)
        log(f"Failed: {failed}")

    log(f"=== Done: {len(pushed)} PRs, {len(failed)} failed ===")


if __name__ == "__main__":
    main()
