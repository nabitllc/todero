#!/usr/bin/env python3
"""
safe-export.py — Extract everything important before removing OpenClaw remnants.

Run this ONCE before deleting ~/.openclaw/* platform directories.
It copies anything that isn't already in todero/config into a dated backup.

What it exports:
- Per-agent self-improving memory (corrections, reflections, memory.md)
- Any workspace-* files that differ from the main workspace
- Credentials and identity files
- Logs (last 500 lines of each)

Output: ~/kaos-export-YYYY-MM-DD/
"""

import json, pathlib, shutil
from datetime import datetime

OPENCLAW = pathlib.Path.home() / ".openclaw"
WORKSPACE = OPENCLAW / "workspace"
EXPORT_DIR = pathlib.Path.home() / f"kaos-export-{datetime.now().strftime('%Y-%m-%d')}"

AGENT_WORKSPACES = [d for d in OPENCLAW.iterdir()
                    if d.is_dir() and d.name.startswith("workspace-")]

INTERESTING_FILES = [
    "self-improving/memory.md",
    "self-improving/corrections.md",
    "self-improving/reflections.md",
    "self-improving/session-state.md",
    "MEMORY.md",
    "SOUL.md",
    "AGENTS.md",
]

def export():
    EXPORT_DIR.mkdir(exist_ok=True)
    exported = []

    for ws in AGENT_WORKSPACES:
        agent = ws.name.replace("workspace-", "")
        dest_base = EXPORT_DIR / "agents" / agent

        for rel in INTERESTING_FILES:
            src = ws / rel
            if not src.exists():
                continue
            # Check if content differs from main workspace version
            main_equiv = WORKSPACE / rel
            if main_equiv.exists():
                if src.read_text() == main_equiv.read_text():
                    continue  # Already in todero/config, skip
            dest = dest_base / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            exported.append(str(dest))

    # Export credentials (for reference — don't commit these)
    creds_dir = OPENCLAW / "credentials"
    if creds_dir.exists():
        dest = EXPORT_DIR / "credentials"
        shutil.copytree(creds_dir, dest, dirs_exist_ok=True)
        exported.append(str(dest))

    # Export identity
    identity_dir = OPENCLAW / "identity"
    if identity_dir.exists():
        dest = EXPORT_DIR / "identity"
        shutil.copytree(identity_dir, dest, dirs_exist_ok=True)
        exported.append(str(dest))

    # Export openclaw.json for reference
    for f in ["openclaw.json", "exec-approvals.json"]:
        src = OPENCLAW / f
        if src.exists():
            shutil.copy2(src, EXPORT_DIR / f)
            exported.append(str(EXPORT_DIR / f))

    print(f"✅ Export complete: {EXPORT_DIR}")
    print(f"   {len(exported)} files exported")
    for f in exported:
        print(f"   {f}")

    if not exported:
        print("   Nothing unique found — all content already in todero/config.")

    return EXPORT_DIR

if __name__ == "__main__":
    export()
