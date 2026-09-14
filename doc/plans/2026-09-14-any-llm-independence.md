# Running on any LLM

**Status: proposal.** Written 2026-09-14 from Michael's direction: *Todero should be able to run on
the local LLM if that is what the user picked, even if it is going to go slow. We need to build
Todero in a way it will work regardless of the LLM used (Claude, Codex, good local LLM, etc).*

This document says what that costs and in what order to buy it.

## Two things that sound the same

Keep these apart, because the words collide:

- **Which model runs a task.** The user's choice. Todero may choose among models the user has
  listed, and never outside that list. Covered by piece 4.
- **How that model is configured for one request** — context window, temperature, timeout. Todero's
  job, and the user should not have to think about it. Covered by piece 2.

## The goal this serves

The goal document says a Todero company should need no human inside its daily operations, and that
two decisions stay human: what the company is for, and real money. Model independence is what makes
that promise portable. If the loop only holds together on a frontier model, then every company that
runs on Todero is renting its governance from one vendor, and the cheap local setups — the ones that
let a company run all night for the price of electricity — are demos rather than deployments.

## The principle

**A weak model must be allowed to be wrong.** Every mechanism below exists so that a model's mistake
becomes a caught error rather than company state. Todero already does this correctly in one place,
and that place is the template for the rest:

When a conversational turn ends with the agent waiting on a person, Todero does not ask the model to
stop. It sets the task's status to `blocked`
(`server/src/todero/conversation-thread.ts`, `planConversationDisposition`), and the timer's
actionable-work list only contains `todo` and `in_progress`
(`server/src/todero/timer-work-selection.ts`). The model cannot proceed, because the state machine
will not run it. The rule is held by Todero, not requested of the model.

Everything in this plan is that same move, applied to the places that still ask.

## The six pieces

### 1. The gate: a script checks before a second agent does

**This is the keystone, and it is why the order below starts here.** Every other piece makes a model
more likely to succeed. This one makes it safe to fail. A weak model is an acceptable model when
something real catches its mistakes; without that, no amount of configuration makes it trustworthy.

**Today the gate is thin, and unreadable from outside.** The reviewer is real: `judge-review.ts`
gives it the plan's goal, the feature's "done when" line, the task's "hand in" line, and the work
itself. Three things are missing.

- **The criteria are one line per feature**, shared by every task under it, plus one line per task.
  There is no per-task list of what must be true.
- **The verdict does not say what was checked.** `parseJudgeVerdict` reads `pass` or `fail` and one
  paragraph. A person cannot tell which criteria were examined, or whether any were.
- **Nothing is checked mechanically.** Every verdict is one model's opinion of prose, even when the
  criterion is something a script could settle.

Measured on a throwaway company on 2026-09-14: the reviewer passed a document six seconds after it
was written, on all eight tasks, each time opening with the same fixed sentence — "I reviewed this
and it does what the task asked." The model did read the work. But a person reading the thread has
no way to tell a real review from a lazy one, which for a product whose promise is that you can
leave it alone is the same problem as not reviewing at all.

**Change.**

- Every task carries acceptance criteria from the moment it is created. A task without them is not
  ready to start.
- Todero decides whether those criteria are machine-checkable.
- If they are — tests pass, the build runs, a file exists, a link resolves, a document has the
  required sections — a script is the gate. Its verdict is one no model can talk its way around.
- If they are not — does this read well, does it answer the brief — a second agent is the gate, and
  it judges against the written criteria rather than against its own impression.
- A verdict records what was checked. "It does what the task asked" is not a verdict.

**Why this first.** It is the cheapest way to make every model safer, it is the only piece that
improves output quality rather than throughput, and the pieces that follow are much easier to judge
once something downstream is actually checking their work.

### 2. Todero configures the request; the user picks the model

**Today.** Ollama serves a 4,096-token context window by default whatever the model can actually
hold. The skill pack is about 16,000 characters. The mismatch was found by a person watching a loop
fail, not by Todero.

**Change.** Todero sets the window per request where the runtime allows it (Ollama `num_ctx`, and
the equivalent elsewhere), from the profile in piece 3, and assembles every prompt to a measured
budget: skills by task kind, thread trimmed, documents by reference. A prompt that does not fit is
Todero's bug, not the model's.

### 3. Todero measures what each model can do

**Today.** Model capability is assumed.

**Change.** Keep a capability profile per model, written by Todero, not typed in by the user. The
connection test already exists and is the natural place to extend:

- context window, and whether Todero may set it per request
- does tool calling actually work, or only claim to
- does constrained JSON output hold
- observed seconds per turn at a representative length
- observed pass rate at the piece 1 gate, per task kind, updated as the company runs

That last line is what ties the profile to reality. Once the gate is real, "can this model do this
kind of work" stops being a guess and becomes a measured rate.

### 4. An agent has a roster of models, and the roster is declared

**Today.** One agent has exactly one model: a single `model` in its adapter config. To get a second
capability tier you hire a second agent. That works, and for a solo user on one machine it is
overhead — four capability tiers should not require four teammates.

**Change.** An agent carries a small, explicit roster: a default, plus named entries by task kind.

```
default:  qwen2.5-coder:14b
planning: qwen2.5-coder:32b
code:     claude (API)
```

Todero picks from the roster using the piece 3 profile — which model can actually hold this
prompt, return this shape, pass the gate for this task kind, and finish in reasonable time — and
never picks anything not on it.

Three rules make this safe rather than clever:

- **Visible, never silent.** The roster shows on the agent's page. Every run records which entry it
  used, and the task shows it. If a person cannot see which model did a piece of work, "understand
  your entire company at a glance" is already broken.
- **Closed list.** A model the user did not add is never used. This is the difference between
  routing and a router that quietly sends a company's work to a vendor nobody chose.
- **Escalation that spends is a money decision.** Local to local is free and automatic. Local to a
  paid API spends, so it runs against the agent's existing budget: inside the cap it proceeds, over
  the cap it stops and asks. The goal document keeps real money human, and model choice is a way to
  spend real money.

**Complexity is measured, not guessed.** Todero cannot judge how hard a task is by looking at it.
It can read the profile: this model passes the gate on 40% of planning tasks and takes four minutes
a turn, that one passes 95% in twenty seconds. Routing follows the measurement.

### 5. The contract with the model is enforced, not requested

**Today.** Todero asks the model to write a plan inside a fenced `todero-plan` block in an exact
shape, and to put STATUS in backticks. Each model gets this wrong differently. The 14B model wrote
features with no tasks, and the parser had to be taught to cope
(`packages/shared/src/todero-plan.ts`, gauntlet repro `plan-without-tasks`).

**Change.** Where a runtime offers a way to constrain output, use it rather than prose: JSON schema
(Ollama `format`, OpenAI-compatible `response_format`), tool/function calling, or a grammar. Where
it does not, keep the prose shape but validate against the same schema. On a validation failure,
feed the model the specific error and allow exactly one bounded retry before handing the step to the
person as a decision.

**Why it matters more on a weak model.** A frontier model follows a format because it inferred the
intent. A 7B model follows a format because the decoder would not let it do otherwise.

### 6. Task size follows the profile

Break work into the smallest useful pieces, with one guard: size should be a consequence of the
measured profile, not a fixed taste. A 14B model gets tasks with one acceptance criterion. A
frontier model gets a whole feature.

The trade to name honestly: smaller pieces mean more turns, and on a slow local model turns are the
expensive resource. The profile's measured seconds-per-turn is what balances the two. The manager
agent already breaks work into features and tasks; it needs the profile as an input.

## Failure is a normal path

A slow local model will time out, get cut off, and return junk. Item 0 of the 2026-09-11 work list
already did one pass at this (timeout floors for local runtimes, one quiet retry instead of three
recovery paths, plain-words recovery copy). The rule it established should be general: one quiet
retry, then a clean statement that this model could not do this step, landing in the Inbox as a
decision for the person. Never three overlapping recovery paths posting jargon.

## How we keep it true: the model matrix

The gauntlet already runs a scripted company end to end against one local model
(`docs/ai_context/gauntlet/checks/live-loop.py`). Make it a matrix: the same company, the same
expectations, against a small local model, a mid local model, and a frontier model. Score the same
outcomes.

The matrix only means something once piece 1 exists. Today the scripted company would pass on every
model, because the reviewer approves everything. A matrix scored against a real gate is a gate
itself; scored against a rubber stamp it measures nothing.

## Order of work

1. **The quality gate** — acceptance criteria on every task, a deterministic checker tier in front
   of the reviewer, and verdicts that say what was checked.
2. **Todero sets the model's window per request** — small, and the first half of the prompt budget.
   Already the recommendation of the wave 15 verdict.
3. **Capability profile written by the connection test**, including the measured pass rate at the
   gate.
4. **The model matrix check** — now that it measures something.
5. **The roster on the agent** — a second model per agent, chosen by profile, shown on every run,
   with escalation to a paid model gated by the existing budget.
6. **Enforced output contracts** — schema or grammar where the runtime allows.
7. **Task sizing from the profile.**

Code tasks (the "wave L" item: routing implement-tasks to Claude Code or Codex) should come after
steps 1-5. Code is the task kind where the gate is most obviously real — tests and builds either
pass or they do not — so it benefits from step 1 more than any other work.

## Non-goals

- **Choosing a model the user did not list.** Todero may choose among the roster's entries and
  nothing else. A model the user has not added is never used, whatever the task, and there is no
  silent substitution when a model struggles — the escalation is to a roster entry or to the person.
- **Spending money without a decision.** An escalation to a paid model is spend, and it obeys the
  agent's budget like any other spend.
- **Hiding which model did the work.** Every run names its roster entry.
- **Making a small model as good as a large one.** The aim is that a small model fails safely and
  visibly, not that it matches Claude.

## Open questions for Michael

- How slow is too slow? If a 7B model needs nine hours for what Claude does in twenty minutes, is
  that a supported configuration or a warning at setup time?
- Should Todero refuse a task kind when the profile says the model cannot do it, or attempt it and
  report the failure?
- When an agent's roster has no entry that can do a task, is the right move to stop and ask, or to
  attempt it with the best entry and flag the result as low confidence?
- When a task's acceptance criteria are not machine-checkable and no second model is available, does
  the task stop, or finish with an explicit "unchecked" mark on the output?
