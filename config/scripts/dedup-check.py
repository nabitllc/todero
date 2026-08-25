#!/usr/bin/env python3
"""
dedup-check.py  (TASK-21)

Intelligent issue deduplication — runs a similarity check before issue
creation.  Uses Levenshtein distance on titles and keyword overlap on
descriptions.  If any existing issue is >80% similar, prints the match
and exits non-zero (suggesting merge).

Logs every dedup decision (pass / blocked / forced) to the agent_runs
table in Supabase kaos-ops.

Usage:
    python3 dedup-check.py --title "Fix login bug" --description "Users cannot log in"
    python3 dedup-check.py --title "Fix login bug" --description "..." --force
    python3 dedup-check.py --title "Fix login bug"   # description is optional

Exit codes:
    0  — no duplicate found (or --force used), safe to create
    1  — duplicate detected, creation blocked
    2  — error (API unreachable, bad args, etc.)
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

MC_API = "http://localhost:3000/api/issues"
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SIMILARITY_THRESHOLD = 0.80


# ---------------------------------------------------------------------------
# Levenshtein distance (pure-Python, no deps)
# ---------------------------------------------------------------------------

def levenshtein(s: str, t: str) -> int:
    """Return the edit distance between two strings."""
    if not s:
        return len(t)
    if not t:
        return len(s)
    m, n = len(s), len(t)
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        for j in range(1, n + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[n]


def title_similarity(a: str, b: str) -> float:
    """Normalised title similarity (1.0 = identical, 0.0 = completely different)."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return 1.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0
    return 1.0 - levenshtein(a, b) / max_len


# ---------------------------------------------------------------------------
# Keyword overlap on descriptions
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset(
    "a an the is are was were be been being have has had do does did "
    "will would shall should may might must can could of in to for on "
    "with at by from as into through during before after above below "
    "between out off over under again further then once and but or nor "
    "not so yet both each few more most other some such no only own "
    "same than too very it its this that these those i me my we our "
    "you your he him his she her they them their what which who whom".split()
)

def _tokenise(text: str) -> set[str]:
    """Extract meaningful lowercase keywords from text."""
    words = set(re.findall(r"[a-z0-9]+", text.lower()))
    return words - _STOP_WORDS


def description_similarity(a: str, b: str) -> float:
    """Jaccard-style keyword overlap (0.0–1.0)."""
    ka, kb = _tokenise(a), _tokenise(b)
    if not ka or not kb:
        return 0.0
    intersection = ka & kb
    union = ka | kb
    return len(intersection) / len(union)


# ---------------------------------------------------------------------------
# Combined similarity
# ---------------------------------------------------------------------------

def combined_similarity(
    title_a: str, title_b: str,
    desc_a: str, desc_b: str,
) -> tuple[float, float, float]:
    """Return (combined, title_sim, desc_sim).  Weights: title 60%, desc 40%."""
    t_sim = title_similarity(title_a, title_b)
    d_sim = description_similarity(desc_a, desc_b) if desc_a and desc_b else 0.0
    # If no descriptions provided, rely entirely on title
    if not desc_a or not desc_b:
        return t_sim, t_sim, d_sim
    combined = 0.6 * t_sim + 0.4 * d_sim
    return combined, t_sim, d_sim


# ---------------------------------------------------------------------------
# MC API helpers
# ---------------------------------------------------------------------------

def mc_get(url: str = MC_API) -> list[dict]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# agent_runs logging (Supabase REST)
# ---------------------------------------------------------------------------

def log_to_agent_runs(decision: str, details: dict):
    """Insert a dedup decision row into agent_runs via Supabase REST."""
    url = f"{SUPABASE_URL}/rest/v1/agent_runs"
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "agent_id": "dedup-check",
        "task_title": f"dedup: {decision} — {details.get('proposed_title', '?')}",
        "status": "done",
        "started_at": now,
        "finished_at": now,
        "output": json.dumps({"decision": decision, **details}),
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status
    except Exception as e:
        print(f"[dedup] Warning: failed to log to agent_runs: {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def find_duplicates(
    title: str,
    description: str,
    issues: list[dict],
    threshold: float = SIMILARITY_THRESHOLD,
) -> list[dict]:
    """Return list of issues that exceed the similarity threshold."""
    matches = []
    for issue in issues:
        existing_title = issue.get("title", "")
        existing_desc = issue.get("description", "") or ""
        combined, t_sim, d_sim = combined_similarity(
            title, existing_title, description, existing_desc
        )
        if combined >= threshold:
            matches.append({
                "task_key": issue.get("task_key", issue.get("id", "?")),
                "title": existing_title,
                "status": issue.get("status", "?"),
                "combined_similarity": round(combined, 3),
                "title_similarity": round(t_sim, 3),
                "description_similarity": round(d_sim, 3),
            })
    matches.sort(key=lambda m: m["combined_similarity"], reverse=True)
    return matches


def main():
    parser = argparse.ArgumentParser(description="Issue deduplication check")
    parser.add_argument("--title", required=True, help="Proposed issue title")
    parser.add_argument("--description", default="", help="Proposed issue description")
    parser.add_argument(
        "--force", action="store_true",
        help="Bypass dedup — log decision but allow creation",
    )
    parser.add_argument(
        "--threshold", type=float, default=SIMILARITY_THRESHOLD,
        help=f"Similarity threshold (default {SIMILARITY_THRESHOLD})",
    )
    args = parser.parse_args()

    # Fetch existing issues
    try:
        issues = mc_get()
    except Exception as e:
        print(f"[dedup] Error fetching issues: {e}", file=sys.stderr)
        sys.exit(2)

    matches = find_duplicates(args.title, args.description, issues, args.threshold)

    if not matches:
        print(f"[dedup] No duplicates found for: {args.title}")
        log_to_agent_runs("pass", {
            "proposed_title": args.title,
            "matches": [],
        })
        sys.exit(0)

    # Duplicates found
    best = matches[0]
    print(f"[dedup] Potential duplicate(s) detected for: {args.title}")
    for m in matches:
        print(
            f"  -> {m['task_key']} ({m['status']}): \"{m['title']}\" "
            f"— similarity {m['combined_similarity']:.0%} "
            f"(title {m['title_similarity']:.0%}, desc {m['description_similarity']:.0%})"
        )

    if args.force:
        print("[dedup] --force flag set, allowing creation despite duplicate(s).")
        log_to_agent_runs("forced", {
            "proposed_title": args.title,
            "matches": matches,
            "best_match": best["task_key"],
            "best_similarity": best["combined_similarity"],
        })
        sys.exit(0)

    print(
        f"[dedup] Suggest merging with {best['task_key']} instead of creating a new issue."
    )
    print("[dedup] Use --force to create anyway.")
    log_to_agent_runs("blocked", {
        "proposed_title": args.title,
        "matches": matches,
        "best_match": best["task_key"],
        "best_similarity": best["combined_similarity"],
    })
    sys.exit(1)


if __name__ == "__main__":
    main()
