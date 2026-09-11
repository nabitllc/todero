---
name: todero-plan-a-project
description: Propose a plan in the fixed shape Todero parses, with three to seven features and four to twelve tasks, each with a clear done-when line.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Playbooks/PRD_Framework.md, packages/shared/src/todero-plan.ts, https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/planning-and-task-breakdown/SKILL.md"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning]
  todero-priority: 1
---

# Plan a Project

When you understand the goal, propose one plan in this shape and nothing else:

Write the plan inside one fenced block, exactly in this shape and nothing else inside it:

```todero-plan
goal: One sentence: what we are building and for whom.
features:
  - name: Short feature name
    why: One line on why it matters
    done_when: One line that says how we know it is finished
tasks:
  - title: An imperative task title
    feature: The feature name it belongs to
    output: What you will hand in for it (a document, a list, a draft, a decision)
    after: The title of the task that has to finish first (leave this line out when nothing has to come first)
```

## Ordering matters

1. **Foundation first** — migrations, schema, authorization policies, types come before UI and business logic.
2. **Data before UI** — your data layer and queries come before the pages.
3. **Core before edge** — the main path works before you handle errors and unusual cases.
4. **Shared before specific** — components and infrastructure shared by multiple features come before feature-specific builds.

Start a new feature's tasks only after its foundation is done, so workers can start in parallel on unrelated features and land ready work at the same time.

## Constraints on the block

- **Three to seven features.** Fewer than three obscures the real work; more than seven is a different kind of decision, not a plan.
- **Four to twelve tasks.** Each one names a feature. Use `after` only when a task truly cannot start until another one is handed in — tasks without it run side by side.
- **Every task needs a done-when.** It lives on the feature, not on individual tasks. But when you create a task, you are committing to this definition of done, so state it in the feature's `done_when` line and check it in the task's `output`. If you cannot say what done looks like for one task, the task is not ready.

## What Todero changed

Kept from **PRD_Framework.md**: phase order (foundation first, data before UI, core before edge, shared before specific) and the Phase Report template's gate: `Questions-before-next-phase`. Kept from **addyosmani/agent-skills § planning-and-task-breakdown**: every task carries acceptance criteria and a verification step; split anything with four or more acceptance criteria; the red flag "tasks without acceptance criteria". Dropped from PRD_Framework: the fifteen sections and file-based storage. Dropped from the public skill: five-level checklists and the idea of a separate plan file — Todero parses the fixed block itself. **Must write**: no task without a done-when. The body is `TODERO_PLAN_BLOCK_INSTRUCTIONS` from packages/shared/src/todero-plan.ts verbatim, plus the two ordering rules from the vault's PRD_Framework and the "every task" constraint above.
