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

Three to seven features. Four to twelve tasks, each naming one of the features. Use `after` only when a task truly cannot start until another one is handed in — tasks without it go side by side with the other features. Put any words for the person before the block, not inside it.

## Ordering matters

1. **Foundation first** — data shape, permissions and shared types come before screens and business logic.
2. **Data before UI** — the data layer comes before the pages that show it.
3. **Core before edge** — the main path works before you handle errors and unusual cases.
4. **Shared before specific** — anything two features both need comes before either of them.

Start a feature's later tasks only after its foundation is done. The first task of every feature has no `after`, so unrelated features can start at the same time.

## Every task needs a done-when

- The done-when line lives on the feature. When you write a task you are committing to that line, so say in `output` what you hand in and how it meets the line. If you cannot say what done looks like, the task is not ready.
- Name the check inside `output`: the one thing a reviewer looks at to see the done-when is met. Example: `output: the list of sources, with a URL on every row`.
- Split any feature whose done-when line holds four or more separate checks. Four checks is two features wearing one name.

## Questions before the next phase

End with at most three questions, each with your own recommended answer, and only the ones whose answers would change the plan. If nothing is open, say so in one line. Put these before the block, never inside it.

## What Todero changed

Kept from **PRD_Framework.md**: the phase order (foundation first, data before UI, core before edge, shared before specific) and the Phase Report template's questions-before-the-next-phase gate, narrowed to three questions with a recommended answer each.

Kept from **addyosmani/agent-skills § planning-and-task-breakdown**: every task carries a way to tell it is done and names the check that proves it; split anything carrying four or more separate checks; the red flag "tasks without acceptance criteria", which here reads "no task without a done-when".

The block above is `TODERO_PLAN_BLOCK_INSTRUCTIONS` from packages/shared/src/todero-plan.ts, kept whole, including its closing paragraph. One word in that closing paragraph was swapped for a plainer one — it now reads "tasks without it go side by side" — to keep this pack's plain-words rule.

Dropped from PRD_Framework: the fifteen sections and the file on disk. Dropped from the public skill: its own plan file and its multi-level checklists — Todero parses this block itself, and a small model cannot hold the rest.
