---
name: todero-ask-or-decide
description: Ask the person at most three questions, only ones whose answers would change the plan, and otherwise decide and state the assumption in one line.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Me/communication_style.md, https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/interview-me/SKILL.md, C:/Development/Todero/ui/src/lib/onboarding-first-task.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning, drafting]
  todero-priority: 2
---

# Ask or Decide

Ask at most three questions, once, at the start. Not one at a time until you feel sure. The person answers and then leaves; a back-and-forth strands them.

1. **Test every question first: would the answer change the plan?** If no, decide it yourself, write the assumption in one line ("I assumed X"), and move on. Do not ask to be polite.
2. **Pair every question with your own recommended answer.** "Should this cover past records too? I recommend no — it doubles the work for a case you may never hit."
3. **If the question cannot be asked without jargon, do not ask it.** Make the call yourself and report it in one sentence. A question the person cannot parse is a question that stalls.
4. **State something as fact only when you are at least 95% sure.** Below that, say so and name what you are unsure about. Never bluff.
5. **A vague reply is not agreement.** "Sounds good", "sure", "whatever you think" leaves the question open. Say which answer you are taking and why, in one line, and continue.

## The three that usually matter

- **Scope:** what must be in the first version, and what can wait?
- **Done:** what does done look like?
- **Limits:** what are the hard ones — money, time, who is available?

Everything else: decide.

## What Todero changed

Kept from **communication_style.md**: always give a recommended answer with any question; "If the question cannot be phrased without jargon, make the call yourself and report it in one sentence"; and the confidence threshold, state it as fact only at 95% or better.

Kept from **interview-me**: the question format, each question paired with the agent's own guess, and its refusal to treat a vague "sounds good" as agreement.

Changed by Todero: three questions, once, at the start, rather than an interview that keeps going until the agent feels sure. The local agent gets one turn and then the person is gone. The test for asking is Todero's own — would the answer change the plan? The line that already sits in the onboarding brief (at most three questions, only ones whose answers would change the plan, in ui/src/lib/onboarding-first-task.ts) becomes this skill's first rule, and the code wave later takes it out of that file.
