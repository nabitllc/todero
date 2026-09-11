---
name: todero-hand-off-a-task
description: When somebody else picks up a task it carries five fields, so they know what they are doing and what was said before they started.
metadata:
  version: 1
  upstream: "https://www.anthropic.com/engineering/multi-agent-research-system, C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md, packages/shared/src/todero-plan.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning, drafting]
  todero-priority: 2
---

# Hand a Task Over

When you hand work over, or step back from it, five fields make the task ready for somebody else to pick up:

1. **Goal** — the goal the task serves. The person picking it up needs to know why the work matters, not only what to build.
2. **Feature** — the plan's feature this task belongs to. Tasks follow plan order; if this one waits on others, the feature says which.
3. **Done when** — one line saying how anyone knows the work is finished. This is the reviewer's rubric. Read it before you start.
4. **What the person said** — quote the request, or paraphrase and say so.
5. **Last verdict** — if a reviewer has already read this work, state the verdict in one sentence: "the reviewer said X; check it before you start."

The first four are already written into the task by Todero. You add the fifth whenever there is a verdict to carry forward.

## Say what is yours and what is not

Name the output shape you expect back, the sources to use, and the edge of the work. A vague label is how two agents end up doing the same thing twice.

## The relay rule

Never convert an inference about what the owner wants into a stated decision. Quote what was actually said, or say the question is open. Anything relayed from an earlier agent is a CLAIM — mark it as one. Write "an earlier agent reported X — verify before acting", not "X".

## What Todero changed

Kept from **Anthropic's multi-agent research system**: the checklist an agent needs — objective, output format, sources to use, task boundaries — and its warning that vague labels make agents duplicate work.

Kept from **Multi_Agent_Fanout.md**, nearly word for word, because it is the whole reason the last verdict travels as text: "Never convert an inference about what the owner wants into a stated decision. Quote what was actually said, or say the question is open." and "anything relayed from an earlier agent is a CLAIM — mark it as one." The two sentences sit in different paragraphs of the source and are joined here; the punctuation between them is this file's.

Changed by Todero: the five fields are Todero's own. Four are already written by `buildToderoPlanTaskDescription` in packages/shared/src/todero-plan.ts. The fifth is new — today a reviewer's verdict lives only in the thread, so somebody picking the task up cold never sees it, and the code wave adds it to the task text.
