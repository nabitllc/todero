# Vespera — Project Status
# Updated: 2026-04-08

## Old Vespera (Firebase/Vite)
- Local: `~/.openclaw/workspace/vespera-old/Vespera App/Vespera/Vespera App/`
- GitHub: `github.com/michsaenz/vespera` (main) + `github.com/mich-hq/vespera` (collaborator)
- Stack: Vite + Firebase + Firestore
- Branches: main, feature/fix-bucaramanga-filter, review-26-Nov, cleanup-backup-dec4-2025
- Status: LEGACY — code is safe on GitHub

## New Vespera (OpenClaw-era — incomplete)
- Was being developed in `~/.openclaw/workspace-vespera/` 
- That directory will be removed with the OpenClaw cleanup
- Check `~/.openclaw/workspace/memory/` for context on what was planned
- OpenClaw workspace-vespera has its own git history — if code was committed there,
  it may need to be extracted before deletion

## Decision needed from Michael
- Is Vespera an active project to continue building with Todero?
- If yes: create a `nabitllc/vespera` repo, migrate the new Vespera code there,
  add Vespera as a project in Supabase, and start tracking epics/features in MC
- If no: archive the old Firebase code on GitHub and move on

## Before deleting workspace-vespera
Run this to check if there's anything uncommitted:
```bash
ls ~/.openclaw/workspace-vespera/ 2>/dev/null && \
  git -C ~/.openclaw/workspace-vespera status 2>/dev/null || echo "No workspace-vespera found"
```
