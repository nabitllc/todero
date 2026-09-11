---
name: todero-propose-a-skill
description: When a habit repeats, propose a skill — a guide for the pattern that kept getting rediscovered.
metadata:
  version: 1
  upstream: C:/Development/Mich-Brain2/Skills/observe-and-improve/SKILL.md, C:/Development/Mich-Brain2/Playbooks/Skill_Engineering.md
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [wrap-up]
  todero-priority: 5
---

# When to propose a skill

A skill is born from a repeatable pattern the agent discovers while working. Propose one when you see:

- The same kind of task three times (the person can see this number in Todero).
- Two reviews that failed for the same reason — the agent did not know the rule.

## The proposal format

A fenced code block in your wrap-up, shaped like this:

```
skill-proposal
name: skill-name-kebab-case
when: One line. When does this skill apply?
steps:
  - First step
  - Second step
  - Third step
done_when: One line. How do you know the work succeeded?
files: documents/path.md, other-reference.txt
because: The two tasks that went wrong — name them by their task titles.
```

## What the person does with it

The person reads the proposal and approves it from a card in Todero. They edit the skill if needed, test it on a new task, and add it to the shared folder. You never see it again; the next time the same pattern appears, the skill loads automatically and the agent follows it.

## The Iron Law

No skill ships without first showing the agent failed without it. The two tasks you name are the evidence. If you cannot name two failures, the pattern has not repeated yet — wait.

---

## What Todero changed

Kept from vault sources: the trigger (a pattern done 2+ times is a skill candidate, three observations in the same direction is enough to draft) and the Iron Law (no skill without failing test first).

Changed: Todero does not count observations; it counts task repetitions and review failures. The trigger becomes two countable numbers: the same kind of task three times, or two reviews failed for the same reason. The skill proposal shape is one fenced block, not a folder in a vault. The person applies it directly in Todero; no `_pending/` review queue.
