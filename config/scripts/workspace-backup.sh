#!/bin/bash
# workspace-backup.sh — Sync agent workspace dirs into kaos-config repo and push
# Runs hourly via LaunchAgent work.nabit.workspace-backup
#
# Syncs all 9 agent workspaces from ~/todero/workspace-* into
# ~/todero/config/workspace-* (the kaos-config git repo), then commits and
# pushes to origin so memories survive hardware loss.

set -euo pipefail

TODERO_DIR="/Users/kemuniagent/todero"
CONFIG_DIR="/Users/kemuniagent/todero/config"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

WORKSPACE_DIRS=(
  workspace-builder
  workspace-tester
  workspace-designer
  workspace-auditor
  workspace-ops
  workspace-po
  workspace-scout
  workspace-vespera-sme
  workspace-kemuni-sme
)

# Rsync each workspace into kaos-config (skip node_modules, .next, large blobs)
for ws in "${WORKSPACE_DIRS[@]}"; do
  src="$TODERO_DIR/$ws/"
  dst="$CONFIG_DIR/$ws/"
  if [ -d "$src" ]; then
    rsync -a --delete \
      --exclude='node_modules/' \
      --exclude='.next/' \
      --exclude='*.tar' \
      --exclude='*.zip' \
      --exclude='*.gz' \
      --exclude='__pycache__/' \
      --exclude='*.pyc' \
      "$src" "$dst"
  else
    log "WARNING: $src does not exist, skipping."
  fi
done

# Commit from kaos-config repo
cd "$CONFIG_DIR"

git add "${WORKSPACE_DIRS[@]}" 2>/dev/null || true

if git diff --cached --quiet; then
  log "No workspace changes to commit."
  exit 0
fi

git commit -m "chore(TOD-626): auto-backup agent workspace memories [skip ci]"

log "Committed workspace changes to kaos-config."

# Push to origin — GIT_PUSH_FORCE=1 bypasses the PR window enforcement
# (backup commits must push outside 7am/7pm windows)
GIT_PUSH_FORCE=1 git push origin main

log "Workspace backup pushed to origin/main."
