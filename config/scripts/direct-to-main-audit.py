#!/usr/bin/env python3
"""
direct-to-main-audit.py — find TOD-NNNN keys mentioned in commits on main whose
issue is still in a non-terminal status, so code-shipped/issue-open drift never
silently accumulates.

Why: merged-branches-audit.py (gap #1) catches drift where a feat/tod-NNNN
branch was merged but the issue stayed non-terminal. That only works when
there's a branch. Direct-to-main commits (infra-file edits per the pre-commit
hook's LOCKED_FILES list, agent-driven local merges, manual hotfixes) have no
branch — they sit local-only until the next PR window picks them up, and never
go through monitor-pr-merge's released transition. This script closes that
gap by scanning git log directly.

What it does
============
1. Lists every commit on main whose subject mentions one or more TOD-NNNN keys
   within the lookback window (default 30 days).
2. For every unique key: looks it up via the Todero API. If the issue is in a
   non-terminal status, appends a reviewer_notes line flagging drift
   (idempotent — DRIFT AUDIT DIRECT marker suppresses re-flagging).
3. Prints a report of flagged / already-flagged / terminal-skipped / not-found.

Non-goals (explicit):
- Does not auto-close issues. Partial-vs-full AC is a judgment call.
- Does not distinguish "direct-to-main" from "shipped-via-PR" commits —
  attempting that heuristically (checking --contains against release/* or
  feat/* refs) over-reported by 10x when branches get deleted after merge.
  Simpler to scan everything: terminal-status issues get skipped, so the net
  effect is identical for issues that released cleanly. Only non-terminal
  issues referenced in main commits show up as drift.

Invocation:
  ./direct-to-main-audit.py                   # dry-run report (last 30 days)
  ./direct-to-main-audit.py --since 7         # last 7 days
  ./direct-to-main-audit.py --flag            # patch reviewer_notes on drift
  ./direct-to-main-audit.py --since 90 --flag # widen window + flag

Safe to run nightly alongside merged-branches-audit.py.
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
TERMINAL_STATUSES = {"closed", "wrapped", "released", "completed", "cancelled", "canceled"}
DRIFT_MARKER = "DRIFT AUDIT DIRECT"  # distinct from merged-branches-audit's marker


def git(*args: str) -> str:
    r = subprocess.run(
        ["git", "-C", str(REPO_DIR), *args],
        check=True, capture_output=True, text=True,
    )
    return r.stdout


def scan_main_commits(since_days: int) -> dict[str, list[tuple[str, str]]]:
    """Walk main's history within the window, return {TOD_KEY: [(sha, subject), ...]}."""
    out = git("log", f"--since={since_days}.days.ago", "--format=%h %s", "main")
    by_key: dict[str, list[tuple[str, str]]] = {}
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        sha, _, subject = line.partition(" ")
        for key in set(TOD_KEY_RE.findall(subject)):
            by_key.setdefault(key, []).append((sha, subject))
    return by_key


def mc_get_issue(task_key: str) -> dict | None:
    url = f"{MC_API}?task_key={task_key}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
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


def classify(issue: dict | None) -> str:
    """'not_found' | 'terminal:<status>' | 'already_flagged' | 'drift:<status>'"""
    if not issue:
        return "not_found"
    status = issue.get("status", "")
    if status in TERMINAL_STATUSES:
        return f"terminal:{status}"
    if DRIFT_MARKER in (issue.get("reviewer_notes") or ""):
        return "already_flagged"
    return f"drift:{status}"


def flag_one(issue: dict, commits: list[tuple[str, str]]) -> tuple[bool, str]:
    task_key = issue.get("task_key", "?")
    existing = issue.get("reviewer_notes") or ""
    status = issue.get("status", "")
    commit_refs = ", ".join(sha for sha, _ in commits[:5])
    if len(commits) > 5:
        commit_refs += f" (+{len(commits) - 5} more)"
    msg = (
        f"DRIFT AUDIT DIRECT (direct-to-main-audit): {len(commits)} commit(s) "
        f"on main reference {task_key}, but this issue is still {status}. "
        f"Commits: {commit_refs}. These may have shipped via direct-to-main "
        f"(infra-file edits, agent-driven merges) rather than a tracked "
        f"feature branch, so monitor-pr-merge never transitioned the issue. "
        f"Audit: do the shipped commits fully satisfy AC? If yes → closed. "
        f"If partial → code_review for the remaining scope."
    )
    combined = (existing + "\n\n---\n" + msg) if existing else msg
    return mc_patch_issue(issue["id"], {"reviewer_notes": combined})


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--since", type=int, default=30,
                   help="Lookback window in days (default: 30)")
    p.add_argument("--flag", action="store_true",
                   help="Patch reviewer_notes on drift issues (default: report only)")
    args = p.parse_args()

    print(f"# scanning main for TOD keys in last {args.since} days…")
    by_key = scan_main_commits(args.since)
    if not by_key:
        print("# no TOD keys found on main in window")
        return 0

    print(f"# found {len(by_key)} unique TOD key(s) across commits\n")

    flagged = already = terminal = not_found = drift_candidates = 0
    for key in sorted(by_key.keys(), key=lambda k: int(k.split("-")[1])):
        commits = by_key[key]
        issue = mc_get_issue(key)
        label = classify(issue)
        n = len(commits)
        commit_word = f"{n} commit{'' if n == 1 else 's'}"

        if label == "not_found":
            print(f"  {key:<12} ({commit_word}): not found")
            not_found += 1
        elif label.startswith("terminal:"):
            print(f"  {key:<12} ({commit_word}): skip ({label.split(':', 1)[1]})")
            terminal += 1
        elif label == "already_flagged":
            print(f"  {key:<12} ({commit_word}): already flagged")
            already += 1
        elif label.startswith("drift:"):
            status = label.split(":", 1)[1]
            drift_candidates += 1
            if args.flag and issue:
                ok, detail = flag_one(issue, commits)
                if ok:
                    print(f"  {key:<12} ({commit_word}): flagged ({status})")
                    flagged += 1
                else:
                    print(f"  {key:<12} ({commit_word}): patch failed ({detail})")
            else:
                print(f"  {key:<12} ({commit_word}): DRIFT ({status})")

    print(
        f"\n# summary: keys={len(by_key)} drift_candidates={drift_candidates} "
        f"flagged={flagged} already_flagged={already} "
        f"terminal_skipped={terminal} not_found={not_found}"
    )
    if not args.flag and drift_candidates:
        print("# (dry run — re-run with --flag to patch reviewer_notes on drift issues)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
