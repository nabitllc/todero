#!/usr/bin/env python3
"""
merged-branches-audit.py — find feat/tod-* branches already merged into main,
flag the issues whose commits shipped without the issue being reconciled, and
(optionally) prune the now-redundant branches.

Why: accumulation of merged-but-undeleted branches confuses the deployer agent
(it tries to re-merge work already in main) and issues stay stuck in
backlog/underway/open/approved even after their code shipped. See TOD-604 for
the canonical failure mode. This script is the first pass of gap #1 in the
"clean deployment mental model" plan.

What it does
============
1. Iterates every local or origin branch matching feat/tod-*.
2. Tests whether the branch tip is already an ancestor of main
   (`git merge-base --is-ancestor <branch> main`). If not, skips.
3. For every merged branch:
   - Extracts TOD-NNNN keys from the subjects of commits on the branch
     (really: commits reachable from the branch that are also in main — but
     since the branch is merged, that's the branch's full history).
   - Looks each key up via Todero API. If the issue is in a non-terminal
     status, appends a reviewer_notes line describing the drift (idempotent
     — won't duplicate if the same line is already present).
4. Prints a report.
5. With --delete, also deletes the local branch (safe: -d only works if
   already merged, which it is). Never touches origin unless --delete-remote
   is passed AND the branch is in origin.

Non-goals (explicitly not in this pass):
- Does not auto-close issues. That's a judgment call (shipped commits may be
  partial vs. AC). The flag makes the drift visible; a human/po decides.
- Does not push/force-push anything.
- Does not touch non-feat branches (release/*, main, etc).

Invocation:
  ./merged-branches-audit.py                     # dry-run report
  ./merged-branches-audit.py --flag              # add reviewer_notes to drift issues
  ./merged-branches-audit.py --flag --delete     # + delete merged local branches
  ./merged-branches-audit.py --flag --delete --delete-remote  # + delete from origin

Safe to run nightly. Reports-only mode (no --flag) is side-effect free except
for the `git fetch --prune` that keeps remote refs honest.
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_DIR = Path("/Users/kemuniagent/todero")
MC_API = "http://localhost:3000/api/issues"
TOD_KEY_RE = re.compile(r"\b(TOD-\d+)\b")
BRANCH_KEY_RE = re.compile(r"^feat/tod-(\d+)$")  # only the numeric convention
TERMINAL_STATUSES = {"closed", "done", "released", "cancelled", "canceled"}
DRIFT_MARKER = "DRIFT AUDIT"  # presence in reviewer_notes ⇒ already flagged


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), *args],
        check=check, capture_output=True, text=True,
    )
    return r.stdout.strip()


def list_candidate_branches() -> list[tuple[str, str]]:
    """Return [(ref, display_name), ...] for every feat/tod-* branch local or on origin."""
    out = git("for-each-ref", "--format=%(refname)",
              "refs/heads/feat/tod-*", "refs/remotes/origin/feat/tod-*")
    refs = [r for r in out.splitlines() if r]
    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for ref in refs:
        display = ref.replace("refs/heads/", "").replace("refs/remotes/origin/", "origin/")
        # Dedupe by HEAD sha: if local and origin point at the same commit, keep local.
        sha = git("rev-parse", ref)
        key = sha
        if key in seen:
            continue
        seen.add(key)
        result.append((ref, display))
    return result


def is_merged_into_main(ref: str) -> bool:
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), "merge-base", "--is-ancestor", ref, "main"],
        capture_output=True,
    )
    return r.returncode == 0


def primary_key_from_branch(display: str) -> str | None:
    """Extract TOD-NNNN from a branch name following the feat/tod-NNNN convention.

    Non-conforming historic names (feat/tod-field-enforcement, feat/skill-*, etc)
    return None and are logged separately for human review — see TOD-604 for why
    we don't auto-flag TOD keys scraped from the full commit history.
    """
    name = display.removeprefix("origin/")
    m = BRANCH_KEY_RE.match(name)
    if not m:
        return None
    return f"TOD-{m.group(1)}"


def mc_get_issue(task_key: str) -> dict | None:
    url = f"{MC_API}?task_key={task_key}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"[warn] fetch {task_key}: {e}", file=sys.stderr)
        return None
    if isinstance(data, list):
        return data[0] if data else None
    return data


def mc_patch_issue(issue_id: str, payload: dict) -> tuple[bool, str]:
    body = json.dumps({"id": issue_id, **payload}).encode()
    req = urllib.request.Request(
        MC_API, data=body,
        headers={"Content-Type": "application/json"}, method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read())
        if resp.get("task_key"):
            return True, "ok"
        return False, resp.get("error", "unknown")
    except urllib.error.HTTPError as e:
        return False, f"http {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"
    except (urllib.error.URLError, TimeoutError) as e:
        return False, str(e)


def flag_drift(task_key: str, branch_display: str, commit_shas: list[str]) -> str:
    issue = mc_get_issue(task_key)
    if not issue:
        return "not found"
    status = issue.get("status", "")
    if status in TERMINAL_STATUSES:
        return f"skip ({status})"
    existing = issue.get("reviewer_notes") or ""
    if DRIFT_MARKER in existing:
        return "already flagged"
    if commit_shas:
        commits_line = f"Commits tagged {task_key}: {', '.join(commit_shas[:5])}."
    else:
        commits_line = (
            f"No commits on the branch are tagged {task_key} — the branch was "
            f"named after this issue but its commits reference other keys."
        )
    msg = (
        f"DRIFT AUDIT (merged-branches-audit): the branch {branch_display} "
        f"is already in main, but this issue is still {status}. "
        f"{commits_line} Audit: do the shipped commits fully satisfy AC? "
        f"If yes → closed. If partial → code_review for the remaining scope."
    )
    combined = (existing + "\n\n---\n" + msg) if existing else msg
    ok, detail = mc_patch_issue(issue["id"], {"reviewer_notes": combined})
    return "flagged" if ok else f"patch failed: {detail}"


def commit_shas_for_key(ref: str, key: str, limit: int = 5) -> list[str]:
    log = git("log", f"--grep={key}", "--format=%h", ref, "-n", str(limit))
    return [s for s in log.splitlines() if s]


def unknown_keys_on_branch(ref: str, primary: str, limit: int = 20) -> list[str]:
    """Other TOD keys that appear in commit subjects on the branch, excluding the
    primary. Only used to flag multi-issue branches for human review — never
    auto-flag them because ancestry-based scans over-report shared history."""
    log = git("log", "--format=%s", ref, "-n", str(limit))
    seen: list[str] = []
    for line in log.splitlines():
        for m in TOD_KEY_RE.findall(line):
            if m != primary and m not in seen:
                seen.append(m)
    return seen


def delete_branch(display: str, delete_remote: bool) -> str:
    # display is like "feat/tod-604" or "origin/feat/tod-604"
    if display.startswith("origin/"):
        if not delete_remote:
            return "skip (remote, --delete-remote not set)"
        name = display.removeprefix("origin/")
        r = subprocess.run(
            ["git", "-C", str(REPO_DIR), "push", "origin", "--delete", name],
            capture_output=True, text=True,
        )
        return "deleted remote" if r.returncode == 0 else f"remote fail: {r.stderr.strip()[:120]}"
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), "branch", "-d", display],
        capture_output=True, text=True,
    )
    return "deleted local" if r.returncode == 0 else f"local fail: {r.stderr.strip()[:120]}"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--flag", action="store_true",
                   help="Patch reviewer_notes on drift issues (default: report only)")
    p.add_argument("--delete", action="store_true",
                   help="Delete local branches that are already merged")
    p.add_argument("--delete-remote", action="store_true",
                   help="Also delete from origin (requires --delete)")
    p.add_argument("--no-fetch", action="store_true", help="Skip git fetch --prune")
    args = p.parse_args()

    if args.delete_remote and not args.delete:
        print("--delete-remote requires --delete", file=sys.stderr)
        return 2

    if not args.no_fetch:
        print("# fetching origin…")
        subprocess.run(["git", "-C", str(REPO_DIR), "fetch", "--prune", "origin"],
                       capture_output=True)

    branches = list_candidate_branches()
    if not branches:
        print("# no feat/tod-* branches found")
        return 0

    merged_count = 0
    flagged_count = 0
    deleted_count = 0
    unmerged_count = 0
    non_conforming: list[tuple[str, list[str]]] = []  # (display, extra_keys)

    for ref, display in branches:
        if not is_merged_into_main(ref):
            unmerged_count += 1
            continue
        merged_count += 1
        primary = primary_key_from_branch(display)
        if primary is None:
            extras = unknown_keys_on_branch(ref, primary="")
            non_conforming.append((display, extras))
            print(f"\n== {display}  (merged; non-conforming name — skipping auto-flag)")
            if extras:
                print(f"   commits reference: {', '.join(extras[:10])}"
                      + (f" (+{len(extras) - 10} more)" if len(extras) > 10 else ""))
            if args.delete:
                r = delete_branch(display, args.delete_remote)
                print(f"   delete: {r}")
                if "deleted" in r:
                    deleted_count += 1
            continue
        extras = unknown_keys_on_branch(ref, primary)
        print(f"\n== {display}  (merged; primary={primary}"
              + (f", also touched: {', '.join(extras[:5])}" if extras else "")
              + ")")
        if args.flag:
            shas = commit_shas_for_key(ref, primary)
            result = flag_drift(primary, display, shas)
            print(f"   {primary}: {result}")
            if result == "flagged":
                flagged_count += 1
        if args.delete:
            r = delete_branch(display, args.delete_remote)
            print(f"   delete: {r}")
            if "deleted" in r:
                deleted_count += 1

    print(
        f"\n# summary: merged={merged_count} unmerged_skipped={unmerged_count} "
        f"non_conforming={len(non_conforming)} flagged={flagged_count} "
        f"deleted={deleted_count}"
    )
    if non_conforming:
        print("# non-conforming branches need human review (one-issue-per-branch convention "
              "violated — decide whether to reconcile, then delete manually):")
        for display, _ in non_conforming:
            print(f"   {display}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
