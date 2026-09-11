---
name: todero-cost-and-time
description: Spend the small model first and keep the strongest one for what only it can do, and say so out loud when a turn is taking far longer than usual.
metadata:
  version: 1
  upstream: "https://raw.githubusercontent.com/zscole/model-hierarchy-skill/main/SKILL.md, C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md, C:/Development/Todero/server/src/todero/model-routing.ts"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning]
  todero-priority: 4
---

# Model tiers and turn types

Todero picks between three models:

- `strongest_local`: the largest model on this machine — best reasoning, slowest.
- `wizard_default`: the model the person chose — the middle ground.
- `fastest_local`: the smallest model here — quickest, least able.

Each type of turn has a preference order:

| Turn type | First choice | Fallback |
|-----------|--------------|----------|
| Planning | strongest_local | wizard_default |
| Judging | strongest_local | wizard_default |
| Drafting | wizard_default | — |
| Wrap-up | wizard_default | — |
| Formatting | fastest_local | wizard_default |

Routine work goes to the cheapest model that can do it. Planning and judging get the strongest one, because a wrong plan or a wrong verdict is caught far too late.

Prefer a draft from the small model over a first draft from the big one. A draft is cheap to check; waiting is not.

# Expect the routing, do not argue with it

Todero decides which model does the work. You do not ask for a different one. The reason is settled: a small model's wrong file list is caught by the next step, and a small model's wrong verdict is acted on and costs more than it saved. When you are put on the small model for a routine draft, use it.

# Warning: say when a turn is taking too long

**Must write:** this rule came from no source.

Todero times the last ten turns of the same type on the same model and keeps the middle number. When the current turn passes twice that, say so in one line of your reply and keep working:

> "This is taking longer than usual — I can hand you what I have so far, or keep going."

That line is the only thing telling the person something is off. The timing check lives in Todero, not in your instructions, and for a reason: a stop condition written into an agent's instructions is a statement of intent, never a control. The control is a person seeing the line and choosing to stop you.

## What Todero changed

Kept from **zscole/model-hierarchy-skill**: the classification — routine work goes to the cheapest tier, only novel problems and reviews go to the best one.

Kept from **Multi_Agent_Fanout.md**: the pairing of type of work to tier, and the wrong-verdict argument — a cheap model's wrong file list is caught downstream, a cheap wrong verdict is acted on.

Changed by Todero: the tiers are the three real models Todero already picks between, so this skill's job is to make you expect the choice rather than argue with it.

**Must write:** the warning. The vault's budget discipline assumes a metered cloud, and a local model on this machine has no meter at all. Todero writes the rule from the only number it has — the middle wall-clock time of the last ten turns of the same type on the same model — and past twice that, you say one line.
