#!/usr/bin/env python3
"""
branch-janitor.py — prune stale branches that slip past merged-branches-audit.

Two gaps this closes:

1. **Closed-unmerged release/* on origin.** The rolling-release supersede in
   pr-window.py closes stale release PRs each window, but GitHub leaves the
   closed branch on origin. Without cleanup these accumulate forever.

2. **Abandoned local feat/tod-NNNN or infra/tod-NNNN.** If an issue gets
   cancelled/closed without its branch ever being merged,
   merged-branches-audit.py never deletes it (that script only acts on
   ancestors-of-main). This catches the terminal-but-not-merged edge case.
   Both prefixes are scanned (feat/ = app-code, infra/ = LOCKED_FILES per
   P3 / Gap #3).

This janitor does NOT re-implement merged-branches-audit — it only covers the
two gaps above. Merged-into-main branches are still the audit's job.

Invocation:
  ./branch-janitor.py                    # dry-run report
  ./branch-janitor.py --prune            # delete stale branches
  ./branch-janitor.py --prune --age 7    # age threshold in days (default 7)

Safe to run every 6h alongside worktree-janitor.
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_DIR = Path("/Users/kemuniagent/todero")
GH_TOKEN = "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"
GH_ORG = "nabitllc"
REPOS = ["todero", "vespera"]
MC_API = "http://localhost:3000/api/issues"
BRANCH_KEY_RE = re.compile(r"^(?:feat|infra)/tod-(\d+)$")
TERMINAL_STATUSES = {"closed", "released", "wrapped", "done", "cancelled", "canceled", "completed"}


def gh_get(url: str):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KAOS-branch-janitor",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def gh_delete_ref(repo: str, ref: str) -> tuple[bool, str]:
    """Delete a branch on origin via refs API (more reliable than push --delete)."""
    url = f"https://api.github.com/repos/{GH_ORG}/{repo}/git/refs/heads/{ref}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KAOS-branch-janitor",
    }, method="DELETE")
    try:
        urllib.request.urlopen(req, timeout=15)
        return True, "ok"
    except urllib.error.HTTPError as e:
        return False, f"http {e.code}: {e.read().decode('utf-8', 'replace')[:120]}"
    except Exception as e:
        return False, str(e)


def mc_get_issue(task_key: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{MC_API}?task_key={task_key}", timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"[warn] fetch {task_key}: {e}", file=sys.stderr)
        return None
    if isinstance(data, list):
        return data[0] if data else None
    return data


def git(*args: str) -> tuple[int, str, str]:
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), *args],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode, r.stdout, r.stderr


def prune_stale_release_branches(repos: list[str], age_days: int, prune: bool) -> tuple[int, int]:
    """Delete closed-unmerged release/* branches on origin older than age_days.

    Returns (stale_count, deleted_count).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=age_days)
    stale = 0
    deleted = 0
    for repo in repos:
        try:
            prs = gh_get(
                f"https://api.github.com/repos/{GH_ORG}/{repo}/pulls"
                f"?state=closed&per_page=100&sort=updated&direction=desc"
            )
        except Exception as e:
            print(f"[warn] list PRs {repo}: {e}", file=sys.stderr)
            continue
        for pr in prs:
            head = (pr.get("head") or {}).get("ref", "")
            if not head.startswith("release/"):
                continue
            if pr.get("merged_at"):
                continue
            closed_at = pr.get("closed_at") or pr.get("updated_at")
            if not closed_at:
                continue
            try:
                closed_dt = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if closed_dt > cutoff:
                continue
            try:
                gh_get(
                    f"https://api.github.com/repos/{GH_ORG}/{repo}/branches/{head}"
                )
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    continue  # branch already gone — not stale
                print(f"[warn] branch check {repo}/{head}: {e}", file=sys.stderr)
                continue
            except Exception as e:
                print(f"[warn] branch check {repo}/{head}: {e}", file=sys.stderr)
                continue
            stale += 1
            label = f"{repo}:{head} (PR #{pr['number']} closed {closed_at[:10]})"
            if prune:
                ok, msg = gh_delete_ref(repo, head)
                print(f"  {'deleted' if ok else 'FAILED'}: {label} — {msg}")
                if ok:
                    deleted += 1
            else:
                print(f"  stale: {label}")
    return stale, deleted


def prune_abandoned_feat_branches(prune: bool) -> tuple[int, int]:
    """Delete local feat/tod-NNNN or infra/tod-NNNN whose issue is terminal but
    branch is not an ancestor of main (merged-branches-audit only covers
    ancestor branches).

    Returns (stale_count, deleted_count).
    """
    code, out, _ = git("for-each-ref", "--format=%(refname:short)",
                       "refs/heads/feat/tod-*", "refs/heads/infra/tod-*")
    if code != 0:
        return 0, 0
    stale = 0
    deleted = 0
    for line in out.strip().splitlines():
        branch = line.strip()
        m = BRANCH_KEY_RE.match(branch)
        if not m:
            continue
        key = f"TOD-{m.group(1)}"
        issue = mc_get_issue(key)
        if not issue:
            continue
        status = issue.get("status", "")
        if status not in TERMINAL_STATUSES:
            continue
        # Skip if branch is already an ancestor of main — that's merged-branches-audit's
        # territory and `git branch -d` would succeed silently; we only want to report
        # the terminal-but-not-merged case where merge-audit's ancestry test missed it.
        anc = subprocess.run(
            ["git", "-C", str(REPO_DIR), "merge-base", "--is-ancestor", branch, "main"],
            capture_output=True,
        )
        if anc.returncode == 0:
            continue
        stale += 1
        label = f"{branch} (issue {status})"
        if prune:
            r = subprocess.run(
                ["git", "-C", str(REPO_DIR), "branch", "-D", branch],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0:
                print(f"  deleted: {label}")
                deleted += 1
            else:
                print(f"  FAILED: {label} — {r.stderr.strip()[:120]}")
        else:
            print(f"  stale: {label}")
    return stale, deleted


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--prune", action="store_true", help="Actually delete (default: dry-run)")
    p.add_argument("--age", type=int, default=7,
                   help="Age threshold in days for closed release branches (default: 7)")
    args = p.parse_args()

    print(f"# branch-janitor ({'prune' if args.prune else 'dry-run'}, age≥{args.age}d)")
    print("\n# Closed-unmerged release/* on origin:")
    r_stale, r_deleted = prune_stale_release_branches(REPOS, args.age, args.prune)
    print("\n# Abandoned local feat/tod-NNNN or infra/tod-NNNN (issue terminal, branch not in main):")
    f_stale, f_deleted = prune_abandoned_feat_branches(args.prune)

    print(
        f"\n# summary: release_stale={r_stale} release_deleted={r_deleted} "
        f"feat_stale={f_stale} feat_deleted={f_deleted}"
    )
    if not args.prune and (r_stale or f_stale):
        print("# (dry run — re-run with --prune to delete)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
