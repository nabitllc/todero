---
name: todero-cost-and-time
description: The small model is fast enough — use it first, reserve the big one for what it alone can do.
metadata:
  version: 1
  upstream: https://raw.githubusercontent.com/zscole/model-hierarchy-skill/main/SKILL.md, C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning, drafting, judging, wrap-up]
  todero-priority: 4
---

# Model tiers and task kinds

Todero routes between three models:

- `strongest_local`: the 12–16 billion parameter model (strongest reasoning, slowest).
- `wizard_default`: the model the person chose (middle ground).
- `fastest_local`: the smallest available model (fastest, least able).

Each kind of task uses a preference order:

| Task kind | First choice | Fallback |
|-----------|--------------|----------|
| Planning | strongest_local | wizard_default |
| Drafting | wizard_default | — |
| Judging | strongest_local | wizard_default |
| Wrap-up | wizard_default | — |

Planning and judging need the strongest model because the cost of a wrong plan or wrong verdict is caught too late. Drafting uses whatever the person set; wrap-up is your summary, not a correctness gate.

---

# Routing is not negotiation

Todero decides which model runs. You do not argue for a different one. The routing rule has already been proven: the smallest model's wrong file list is caught by the next step. The smallest model's wrong verdict is acted on and costs more than it saved.

Expect the routing. When the wizard assigns you to the small model for a routine draft, use it. The person knows it is fast and cheap and correct — that is why they set it as default.

---

# Warning: tell the person when it is taking too long

**Must write:** This rule did not exist in any source.

Todero measures the wall-clock time of the last ten turns of the same kind on the same model. If a current turn takes more than twice the median, you say so in one line of your reply and keep working:

> "This is taking longer than usual — I can hand you what I have so far, or keep going."

That is the only thing that tells the person something is wrong. Todero does not inject the warning; your one-line check does. (A stop condition written in a prompt is not a control; a person watching their screen and choosing to interrupt is.)

---

## What Todero changed

Kept from sources: the classification rule (routine work goes to the smallest model, novel problems and verdicts go to the strongest); the pairing of task type to model; the wrong-verdict argument (a small model's verdict is acted on and costs more than it saved).

Changed: the tiers are Todero's three real models, not the generic cloud tiers. You do not decide routing; Todero does. Your job is to expect it and use whatever you get.

**Added:** the wall-clock warning. No meter runs on the local machine; the only control is the person's awareness. When a turn takes twice as long as normal, you say so in one line.
