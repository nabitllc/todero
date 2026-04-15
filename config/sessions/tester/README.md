# tester Session Directory

TOD-794: Persistent agent sessions (not yet active).

This directory will hold the tester agent's long-lived session state when the
persistent-sessions epic ships. For now it's a placeholder.

Planned contents (from self-improving/proactivity skill spec):
- session-state.md       — current task, last decision, next move
- working-buffer.md      — volatile breadcrumbs for the in-progress task
- conversation.jsonl     — raw conversation log from the runtime
- compact-summary.md     — auto-generated summary when context >60% full

Status: EMPTY placeholder. Agents currently run via `claude --print` single-shot
mode (TOD-793 runtime adapter is the foundation). Moving to persistent sessions
requires the runtime adapter to expose `supportsSessions: true` and implement
a session-aware `dispatch()` method alongside `spawn()`.
