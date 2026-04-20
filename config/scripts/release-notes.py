#!/usr/bin/env python3
"""
release-notes.py — Auto-generate release notes from issues that transitioned to `released`.

Runs every 15 minutes via launchd (work.nabit.release-notes.plist).

Logic:
  1. Fetch all issues from MC API
  2. Filter to status=released, updated_at > last_run
  3. Skip any already recorded in state file
  4. Group by type: features, bugs, ops, research
  5. Bump semver: major if any S0, minor if any feature, else patch
  6. Render markdown to ~/todero/config/docs/releases/v{X.Y.Z}.md
  7. Post summary to Discord #release-notes (fallback to #alerts)
  8. Write new version to VERSION file, update state file
"""

import json
import pathlib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional, List, Dict

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except ImportError:
    ET = None

MC_API = "http://localhost:3000/api/issues"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GT-1av.FQM4lTSXgIVvB6XEA1Td7ir65uYWcyt6LvPHmk"
ALERTS_CHANNEL = "1485333335868834063"   # #alerts fallback
RELEASE_CHANNEL = "1492003782605930560"  # #release-notes

SCRIPT_DIR = pathlib.Path(__file__).parent
STATE_FILE = SCRIPT_DIR / "state-release-notes.json"
RELEASES_DIR = pathlib.Path.home() / "todero/config" / "docs" / "releases"
VERSION_FILE = RELEASES_DIR / "VERSION"
LOG_FILE = "/tmp/release-notes.log"


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"last_run": None, "released_ids": []}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def load_version() -> str:
    if VERSION_FILE.exists():
        v = VERSION_FILE.read_text().strip()
        if v:
            return v
    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    VERSION_FILE.write_text("0.1.0\n")
    return "0.1.0"


def save_version(v: str) -> None:
    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    VERSION_FILE.write_text(v + "\n")


def bump_version(current: str, has_feature: bool, has_breaking: bool) -> str:
    try:
        parts = [int(x) for x in current.split(".")]
        while len(parts) < 3:
            parts.append(0)
        major, minor, patch = parts[0], parts[1], parts[2]
    except Exception:
        major, minor, patch = 0, 1, 0
    if has_breaking:
        return f"{major + 1}.0.0"
    if has_feature:
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def mc_get_all() -> List[dict]:
    with urllib.request.urlopen(MC_API, timeout=15) as r:
        return json.loads(r.read())





def discord_post(channel_id: str, content: str) -> None:
    # Discord max message length is 2000 chars
    if len(content) > 1900:
        content = content[:1900] + "\n…(truncated)"
    try:
        discord_request("POST", f"/channels/{channel_id}/messages", {"content": content})
    except Exception as e:
        log(f"[discord] post failed: {e}")


def parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        # Handle trailing Z
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def group_issues(issues: List[dict]) -> Dict[str, List[dict]]:
    groups = {"feature": [], "bug": [], "ops": [], "research": [], "other": []}
    for i in issues:
        t = (i.get("type") or "").lower()
        if t in groups:
            groups[t].append(i)
        else:
            groups["other"].append(i)
    return groups


def format_issue_line(issue: dict) -> str:
    key = issue.get("task_key") or (issue.get("id") or "")[:8]
    title = (issue.get("title") or "").strip()
    if len(title) > 120:
        title = title[:117] + "…"
    return f"- **{key}** — {title}"


def build_markdown(version: str, issues: List[dict], now_local: datetime) -> str:
    groups = group_issues(issues)
    breaking = [i for i in issues if (i.get("severity") or "").upper() == "S0"]

    # Contributors: prefer worked_by, fallback to assignee
    contribs = set()
    for i in issues:
        w = i.get("worked_by")
        if w:
            if isinstance(w, list):
                for x in w:
                    if x:
                        contribs.add(str(x))
            else:
                contribs.add(str(w))
        elif i.get("assignee"):
            contribs.add(str(i["assignee"]))

    # PR links (unique, skip the "merged-locally" placeholders)
    prs = []
    seen_prs = set()
    for i in issues:
        url = i.get("pr_url")
        if not url or url.startswith("merged-locally"):
            continue
        if url in seen_prs:
            continue
        seen_prs.add(url)
        prs.append((i.get("task_key") or "?", url))

    date_str = now_local.strftime("%Y-%m-%d %H:%M %Z") if now_local.tzinfo else now_local.strftime("%Y-%m-%d %H:%M")

    lines: List[str] = []
    lines.append(f"# Release v{version}")
    lines.append("")
    lines.append(f"**Released:** {date_str}")
    lines.append("")

    # Summary
    total = len(issues)
    parts = []
    if groups["feature"]:
        parts.append(f"{len(groups['feature'])} new feature(s)")
    if groups["bug"]:
        parts.append(f"{len(groups['bug'])} bug fix(es)")
    if groups["ops"]:
        parts.append(f"{len(groups['ops'])} improvement(s)")
    if groups["research"]:
        parts.append(f"{len(groups['research'])} research item(s)")
    if groups["other"]:
        parts.append(f"{len(groups['other'])} other change(s)")
    summary_parts = ", ".join(parts) if parts else f"{total} change(s)"
    summary = f"This release includes {summary_parts}."
    if breaking:
        summary += f" Contains {len(breaking)} breaking change(s)."
    lines.append(summary)
    lines.append("")

    if groups["feature"]:
        lines.append("## ✨ New Features")
        lines.append("")
        for i in groups["feature"]:
            lines.append(format_issue_line(i))
        lines.append("")

    if groups["bug"]:
        lines.append("## 🐛 Bug Fixes")
        lines.append("")
        for i in groups["bug"]:
            lines.append(format_issue_line(i))
        lines.append("")

    if groups["ops"]:
        lines.append("## ⚙️ Improvements")
        lines.append("")
        for i in groups["ops"]:
            lines.append(format_issue_line(i))
        lines.append("")

    if groups["research"]:
        lines.append("## 🔬 Research")
        lines.append("")
        for i in groups["research"]:
            lines.append(format_issue_line(i))
        lines.append("")

    if groups["other"]:
        lines.append("## 📦 Other Changes")
        lines.append("")
        for i in groups["other"]:
            lines.append(format_issue_line(i))
        lines.append("")

    if breaking:
        lines.append("## 💥 Breaking Changes")
        lines.append("")
        for i in breaking:
            lines.append(format_issue_line(i))
        lines.append("")

    if contribs:
        lines.append("## Contributors")
        lines.append("")
        lines.append(", ".join(f"`{c}`" for c in sorted(contribs)))
        lines.append("")

    if prs:
        lines.append("## Pull Requests")
        lines.append("")
        for key, url in prs:
            lines.append(f"- {key}: {url}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_discord_summary(version: str, issues: List[dict], md_path: pathlib.Path) -> str:
    groups = group_issues(issues)
    breaking = [i for i in issues if (i.get("severity") or "").upper() == "S0"]
    now_et = datetime.now(ET) if ET else datetime.now()
    ts = now_et.strftime("%b %-d, %I:%M %p EST")
    lines = [f"📦 **Release v{version}** — {len(issues)} issue(s)"]
    if groups["feature"]:
        lines.append(f"↳ ✨ {len(groups['feature'])} feature(s)")
    if groups["bug"]:
        lines.append(f"↳ 🐛 {len(groups['bug'])} bug fix(es)")
    if groups["ops"]:
        lines.append(f"↳ ⚙️ {len(groups['ops'])} improvement(s)")
    if groups["research"]:
        lines.append(f"↳ 🔬 {len(groups['research'])} research")
    if breaking:
        lines.append(f"↳ 💥 {len(breaking)} breaking change(s)")
    keys = ", ".join((i.get("task_key") or "?") for i in issues[:8])
    if len(issues) > 8:
        keys += f", +{len(issues) - 8} more"
    lines.append(f"↳ {keys}")
    lines.append(f"↳ {ts}")
    return "\n".join(lines)


def main() -> None:
    log("=== release-notes run ===")
    state = load_state()
    last_run = parse_iso(state.get("last_run"))
    seen_ids = set(state.get("released_ids", []))

    try:
        issues = mc_get_all()
    except Exception as e:
        log(f"[mc-api] fetch failed: {e}")
        return

    # Find issues currently in status=released that we haven't processed yet
    candidates: List[dict] = []
    for i in issues:
        if i.get("status") != "released":
            continue
        if i.get("id") in seen_ids:
            continue
        upd = parse_iso(i.get("updated_at"))
        if last_run and upd and upd < last_run:
            # Older than our last run and not in seen_ids — include it anyway (backfill)
            pass
        candidates.append(i)

    if not candidates:
        log("No new released issues — nothing to do")
        # Still update last_run timestamp
        state["last_run"] = datetime.now(timezone.utc).isoformat()
        save_state(state)
        return

    log(f"Found {len(candidates)} new released issue(s)")

    # Version bump
    current_version = load_version()
    has_feature = any((i.get("type") or "").lower() == "feature" for i in candidates)
    has_breaking = any((i.get("severity") or "").upper() == "S0" for i in candidates)
    new_version = bump_version(current_version, has_feature, has_breaking)
    log(f"Version: {current_version} -> {new_version} (feature={has_feature}, breaking={has_breaking})")

    # Markdown
    now_local = datetime.now(ET) if ET else datetime.now()
    md = build_markdown(new_version, candidates, now_local)
    md_path = RELEASES_DIR / f"v{new_version}.md"
    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    md_path.write_text(md)
    log(f"Wrote {md_path}")

    # Discord
    summary = build_discord_summary(new_version, candidates, md_path)
    discord_post(RELEASE_CHANNEL, summary)

    # Persist state + version
    save_version(new_version)
    for i in candidates:
        seen_ids.add(i.get("id"))
    state["released_ids"] = sorted(seen_ids)
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    state["last_version"] = new_version
    save_state(state)
    log(f"=== done: v{new_version} with {len(candidates)} issue(s) ===")


if __name__ == "__main__":
    main()
