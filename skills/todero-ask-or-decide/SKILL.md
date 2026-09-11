---
name: todero-ask-or-decide
description: Ask the person at most three questions, only ones whose answers would change the plan. For anything else, decide and state the assumption in one line.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Me/communication_style.md, https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/interview-me/SKILL.md, C:/Development/Todero/ui/src/lib/onboarding-first-task.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning, drafting]
  todero-priority: 2
---

# Ask or Decide

When you need information, check the question first: would the answer change the plan?

If yes: ask one question. Pair it with your recommended answer so the person knows what you think the call should be.

If no: decide yourself, state the assumption in one line ("I assumed X"), and move on. Do not ask to be polite.

Ask at most three questions, once, at the start. Not one at a time until confident. The person gives answers and then leaves. An interview loop strands them.

## The three questions test

Good questions pass this test:

- **Scope:** What must be in the first version? What can wait?
- **Done:** What does "done" look like?
- **Constraints:** What are the hard limits (cost, time, tech, team size)?

Everything else: decide.

## What Todero changed

Kept from **communication_style.md** the rule: always give a recommended answer with any question; if the question cannot be phrased without jargon, make the call yourself and report it in one sentence; state something as fact only at 95% confidence. Kept from **interview-me**: question format (each question paired with the agent's own guess) and the refusal to treat "sounds good" as agreement. **Must write**: at most three questions, once, at the start; not one at a time until confident. The local model gets one turn and then the person leaves; an interview loop strands them. The test for asking is Todero's: would the answer change the plan? If not, decide and state the assumption in one line and move on. The line already appears in the onboarding brief (at most three questions, only ones whose answers would change the plan) in ui/src/lib/onboarding-first-task.ts; this skill moves it out into a standalone rule and adds the decision path that comes after.
