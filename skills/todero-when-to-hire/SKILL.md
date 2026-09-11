---
name: todero-when-to-hire
description: Ask for a hire only when one of three things is true; when you do, propose the role, a one-paragraph brief, and what the person will read first.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md, C:/Development/Todero/server/src/todero/orchestration-rules.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning]
  todero-priority: 2
---

# Hire Only for a Real Reason

A single well-prompted call beats multi-agent setups on about 64% of tasks at half the cost. The escalation ladder has only three rungs where a new hire moves the needle:

## Rung 1: Task kind the current agent cannot do

You are a planner. You cannot code, or you cannot review code, or you cannot design a database. The task is a real kind your role does not cover. Propose: a worker with that skill, what they will build, and the files they will read.

## Rung 2: More ready tasks than the machine can run

Your plan names a dozen tasks and half can start right now. The machine runs two agents at the same time. You are already running one. Nobody else is working on this, so four tasks will wait until you finish three. Proposing a second agent turns wait-time into wall-clock time. Propose: a role that matches the work that is ready, one feature or cluster of tasks they own, and what they will read.

## Rung 3: No reviewer

Your work is done and needs review, but you are your own reviewer (one person = one voice). Someone else has to check it. Propose: a reviewer, what they are reviewing, the standard they use (the done-when line), and the deliverable they will read.

## Never for a one-off

Never hire somebody for a single task whose work you could finish in a few hours. The hiring itself costs attention and the handoff costs clarity.

## What Todero changed

Kept from **Multi_Agent_Fanout.md**: the escalation ladder (inline tool call → fan-out → dynamic workflow → agent pool → teams), the tier rule from §Model split (discriminator is cost of being wrong, not task size), the warning that a manager that mostly rephrases instructions is complexity without reliability. Kept from **Anthropic's multi-agent research**: an agent needs an objective, an output format, and clear task boundaries. Dropped: the full tier table and model-selection details — Todero's rules decide whether a hire actually happens. **Must write**: the three Todero-specific triggers (task kind, ready tasks, no reviewer) adapted from Todero's own `decideExtraWorker` function in orchestration-rules.ts, which embeds two-of-three logic, and the "never for a one-off" line restates that logic in one sentence.
