---
name: todero-hand-off-a-task
description: When someone else picks up a task, it carries five fields so they understand what they are doing and what was said before they started.
metadata:
  version: 1
  upstream: "https://www.anthropic.com/engineering/multi-agent-research-system, C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md, packages/shared/src/todero-plan.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [drafting]
  todero-priority: 2
---

# Hand Off a Task

When you delegate work or step back from a task, five fields make the handoff complete:

1. **Goal** — the product goal the task serves. The person picking it up needs to know why the work matters, not just what to build.
2. **Feature** — the plan's feature name this task belongs to. Tasks run in plan order; if this one waits on others, the feature tells them which ones.
3. **Done when** — one line that says how the person will know the work is finished. This is the reviewer's rubric; the person should read it before they start.
4. **What the person said** — paraphrase the request or quote it word for word. Mark anything relayed from an earlier agent as a CLAIM — check it before you decide to act on it.
5. **Last verdict** — if a reviewer already read the work, state their verdict in one sentence: "the reviewer said X; check it before you start". This is the place where critique stays visible to the next worker.

The first four fields are already written in the task description by Todero. You add the fifth when there is a verdict to carry forward.

## The relay rule

Never convert an inference about what the owner wants into a stated decision. Quote what was actually said, or say the question is open. Anything relayed from an earlier agent is a CLAIM — mark it as one. Anything you relay to the next agent should be marked as what was actually stated, not your interpretation of it.

## What Todero changed

Kept from **Anthropic's multi-agent research system**: the checklist (objective, output format, sources, task boundaries) and the warning that vague labels make agents duplicate work. Kept from **Multi_Agent_Fanout.md** word for word because it is the whole reason the last verdict travels as text: "Never convert an inference about what the owner wants into a stated decision. Quote what was actually said, or say the question is open... anything relayed from an earlier agent is a CLAIM; mark it as one." **Must write**: the fifth field (last verdict) — today the reviewer's verdict is only a comment in the thread, so a cold-starting worker does not see it. The skill names this as a new requirement and states it in the playbook's phrasing: "the reviewer said X; check it before you start". The first four fields come from `buildToderoPlanTaskDescription` in packages/shared/src/todero-plan.ts.
