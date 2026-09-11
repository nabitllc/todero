---
name: todero-retrospective
description: Right after wrap-up, look back once at what broke and what held, and name up to three lines in the skills that should change.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Skills/observe-and-improve/SKILL.md, C:/Development/Mich-Brain2/Playbooks/Skill_Engineering.md, https://raw.githubusercontent.com/accidentalrebel/claude-skill-session-retrospective/master/SKILL.md, https://www.dhirajdas.dev/blog/ai-agent-postmortem-template"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [wrap-up]
  todero-priority: 5
---

# Retrospective: one pass, while the work is fresh

After wrap-up, before you close the task, do this once. Look back at what went wrong and what fixed it. The retrospective is not finished until one concrete thing changes.

## Three sections

**What went wrong.** Each problem, how you noticed it, and what finally fixed it.

**What held.** What worked and should stay. Name the skill that got it right.

**What to change.** One to three entries, no more. Each names a skill, quotes the line that should change, and gives one sentence of why. If a skill is missing entirely, say which one and what it would cover.

## Never edit the skills yourself

You propose; you do not change. A person reads the proposal, applies it, and bumps that skill's version and last-synced date. That is the only way a skill changes.

## Tone

Write for somebody who will do this work next: the exact message you saw, the exact file, what the failure looked like. Be honest about mistakes. They are the part worth keeping.

## Format

```
## Retrospective

### What went wrong
- [problem]: [what happened] -> [what fixed it]

### What held
- [technique]: [one line]

### What to change
1. Skill: [name]. Line: [quote the line]. Why: [one sentence].
2. Skill: [name]. Line: [quote the line]. Why: [one sentence].
3. Skill: [name]. Line: [quote the line]. Why: [one sentence].
```

Use one entry if one is all you have. Three is the ceiling, not the target.

## What Todero changed

Kept whole from **observe-and-improve/SKILL.md**, its central rule: never edit the skills directly, write proposals only, a person applies them and bumps the target skill's version.

Kept from **Skill_Engineering.md**: the frontmatter fields every skill in this pack carries — `version`, `upstream`, `last_synced` — plus Todero's own `last_changed_because`.

Kept from **claude-skill-session-retrospective**: the shape — what went wrong and how it was fixed, the mistakes and the corrections, the techniques worth keeping. Kept from **dhirajdas.dev, AI agent postmortem template**, as the closing rule: a retrospective is not finished until one concrete thing changes.

Changed by Todero: the cadence. The vault reviews weekly; Todero does this once, right after wrap-up, while the work is still in the thread. Trimmed hard — the public version reads a whole session's transcript, Todero's asks for at most three proposed edits, each with the line that should change and one sentence of why.
