#!/usr/bin/env python3
"""
auto-deploy.py — Poll GitHub for new commits on main, pull and rebuild MC automatically.
Runs every 5 minutes via launchd (work.nabit.auto-deploy.plist).
Posts to Discord when a deploy happens.
"""
import json, subprocess, pathlib, urllib.request
from datetime import datetime

MC_DIR = "/Users/kemuniagent/todero"
DISCORD_BOT = "MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GT-1av.FQM4lTSXgIVvB6XEA1Td7ir65uYWcyt6LvPHmk"
CHANNEL = "1487584904135970816"  # #deployments
STATE_FILE = pathlib.Path(__file__).parent / "state-auto-deploy.json"
LOG = "/tmp/auto-deploy.log"

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG, "a") as f: f.write(line + "\n")

def load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"last_commit": ""}

def save_state(s): STATE_FILE.write_text(json.dumps(s))

def discord_post(content):
    data = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{CHANNEL}/messages", data=data,
        headers={"Authorization": f"Bot {DISCORD_BOT}", "Content-Type": "application/json",
                 "User-Agent": "DiscordBot (https://kaos.nabit.work, 1.0)"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10): pass
    except Exception as e: log(f"[discord] {e}")

def run(cmd, cwd=None):
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    return result.returncode, result.stdout.strip(), result.stderr.strip()

def main():
    state = load_state()

    # Fetch latest commit hash from remote without pulling
    code, out, err = run("git fetch origin main && git rev-parse origin/main", cwd=MC_DIR)
    if code != 0:
        log(f"fetch failed: {err}")
        return

    remote_commit = out.strip()
    if remote_commit == state["last_commit"]:
        log(f"no new commits ({remote_commit[:8]})")
        return

    log(f"new commit detected: {remote_commit[:8]} (was {state['last_commit'][:8] if state['last_commit'] else 'none'})")

    # Skip if monitor-pr-merge already handled this commit (avoids double-build)
    merged = state.get("merged_commit", "")
    if merged and remote_commit.startswith(merged):
        log(f"commit {remote_commit[:8]} already deployed by monitor-pr-merge — skipping")
        state["last_commit"] = remote_commit
        save_state(state)
        return

    # Pull
    code, out, err = run("git pull origin main", cwd=MC_DIR)
    if code != 0:
        log(f"git pull failed: {err}")
        discord_post(f"⚠️ **Auto-deploy failed** — `git pull` error:\n```{err[:300]}```")
        return

    # Build
    log("building...")
    code, out, err = run("npm run build", cwd=MC_DIR)
    if code != 0:
        log(f"build failed: {err[-500:]}")
        discord_post(f"⚠️ **Auto-deploy failed** — build error on commit `{remote_commit[:8]}`:\n```{err[-300:]}```")
        return

    # Restart production server (serves https://kaos.nabit.work via Cloudflare tunnel)
    run("launchctl kickstart -k gui/$(id -u)/work.nabit.todero")

    state["last_commit"] = remote_commit
    save_state(state)

    log(f"deployed {remote_commit[:8]} ✅")
    ts = datetime.now().strftime("%b %-d, %I:%M %p EST")
    discord_post(f"🚀 **Deployed** — commit `{remote_commit[:8]}`\n↳ Direct push · {ts}")

if __name__ == "__main__":
    main()
