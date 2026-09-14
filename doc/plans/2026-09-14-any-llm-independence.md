# Running on any LLM

**Status: proposal.** Written 2026-09-14 from Michael's direction: *Todero should be able to run on
the local LLM if that is what the user picked, even if it is going to go slow. We need to build
Todero in a way it will work regardless of the LLM used (Claude, Codex, good local LLM, etc).*

This document says what that costs and in what order to buy it.

## Two things that sound the same

Keep these apart, because the words collide:

- **Which model runs a task.** The user's choice. Todero may choose among models the user has
  listed, and never outside that list. Covered by piece 3.
- **How that model is configured for one request** — context window, temperature, timeout. Todero's
  job, and the user should not have to think about it. Covered by piece 1.

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

### 1. Todero configures the request; the user picks the model

**Today.** Ollama serves a 4,096-token context window by default whatever the model can actually
hold. The skill pack is about 16,000 characters. The mismatch was found by a person watching a loop
fail, not by Todero.

**Change.** Todero sets the window per request where the runtime allows it (Ollama `num_ctx`, and
the equivalent elsewhere), from the profile in piece 2, and assembles every prompt to a measured
budget: skills by task kind, thread trimmed, documents by reference. A prompt that does not fit is
Todero's bug, not the model's.

### 2. Todero measures what each model can do

**Today.** Model capability is assumed.

**Change.** Keep a capability profile per model, written by Todero, not typed in by the user. The
connection test already exists and is the natural place to extend:

- context window, and whether Todero may set it per request
- does tool calling actually work, or only claim to
- does constrained JSON output hold
- observed seconds per turn at a representative length
- observed success rate per task kind, updated as the company runs

**What consumes it.** Everything below. Without measurement, "pick the right model" and "pick the
right task size" are both guesses.

### 3. An agent has a roster of models, and the roster is declared

**Today.** One agent has exactly one model: a single `model` in its adapter config. To get a second
capability tier you hire a second agent. That works, and for a solo user on one machine it is
overhead — four capability tiers should not require four teammates.

**Change.** An agent carries a small, explicit roster: a default, plus named entries by task kind.

```
default:  qwen2.5-coder:14b
planning: qwen2.5-coder:32b
code:     claude (API)
```

Todero picks from the roster using the piece 2 profile — which model can actually hold this
prompt, return this shape, and finish in reasonable time — and never picks anything not on it.

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
It can read the profile: this model returns valid JSON 40% of the time and takes four minutes a
turn, that one is 99% and twenty seconds. Routing follows the measurement.

### 4. Task size follows the profile

Break work into the smallest useful pieces, with one guard: size should be a consequence of the
measured profile, not a fixed taste. A 14B model gets tasks with one acceptance criterion. A
frontier model gets a whole feature.

The trade to name honestly: smaller pieces mean more turns, and on a slow local model turns are the
expensive resource. The profile's measured seconds-per-turn is what balances the two. The manager
agent already breaks work into features and tasks; it needs the profile as an input.

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

### 6. Check with a script first, a second agent second

A builder and a checker is the right shape, with one refinement: **never ask a model to judge what a
script can score.** Two models double the cost and double the chance of a confident wrong answer.

- Every task carries acceptance criteria from the moment it is created.
- Todero decides whether those criteria are machine-checkable.
- If they are — tests, build, lint, a file exists, a link resolves — a script is the gate, and its
  verdict is one no model can talk its way around.
- If they are not — does this read well, does it answer the brief — a second agent is the gate.

This is the existing reviewer agent, with a deterministic tier in front of it.

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

Until that check exists, model independence is an intention. After it exists, it is a gate that
fails loudly, and every piece above has a place to prove itself.

## Order of work

1. **Todero sets the model's window per request** — small, and the first half of the prompt budget.
   Already the recommendation of the wave 15 verdict.
2. **Capability profile written by the connection test** — nothing else can be sized or routed
   without it.
3. **The model matrix check** — before any new task kind, so that new work is measured on arrival.
4. **The roster on the agent** — a second model per agent, chosen by profile, shown on every run,
   with escalation to a paid model gated by the existing budget.
5. **Enforced output contracts** — schema or grammar where the runtime allows.
6. **Acceptance criteria plus the deterministic checker tier.**
7. **Task sizing from the profile.**

Code tasks (the "wave L" item: routing implement-tasks to Claude Code or Codex) should come after
steps 1-4 and be designed from the start around step 6. Running code tasks on a local model before
the matrix exists produces failures nobody can attribute.

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
