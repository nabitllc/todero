# Running on any LLM

**Status: proposal.** Written 2026-09-14 from Michael's direction: *Todero should be able to run on
the local LLM if that is what the user picked, even if it is going to go slow. We need to build
Todero in a way it will work regardless of the LLM used (Claude, Codex, good local LLM, etc).*

This document says what that costs and in what order to buy it.

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

## The five pieces

### 1. The contract with the model is enforced, not requested

**Today.** Todero asks the model to write a plan inside a fenced `todero-plan` block in an exact
shape, and to put STATUS in backticks. Each model gets this wrong differently. The 14B model wrote
features with no tasks, and the parser had to be taught to cope
(`packages/shared/src/todero-plan.ts`, gauntlet repro `plan-without-tasks`).

**Change.** Where a runtime offers a way to constrain output, use it rather than prose: JSON schema
(Ollama `format`, OpenAI-compatible `response_format`), tool/function calling, or a grammar. Where it
does not, keep the prose shape but validate against the same schema. On a validation failure, feed
the model the specific error and allow exactly one bounded retry before handing the step to the
person as a decision.

**Why it matters more on a weak model.** A frontier model follows a format because it inferred the
intent. A 7B model follows a format because the decoder would not let it do otherwise.

### 2. Todero measures what the connected model can do

**Today.** Model capability is assumed. The skill pack is about 16,000 characters; Ollama's default
window was 4,096, and the mismatch was found by a person watching a loop fail.

**Change.** Keep a capability profile per connected model, written by Todero, not typed in by the
user. The connection test already exists and is the natural place to extend:

- context window, and whether Todero may set it per request
- does tool calling actually work, or only claim to
- does constrained JSON output hold
- observed seconds per turn at a representative length
- observed success rate per task kind, updated as the company runs

**What consumes it.** Task sizing, prompt budget, timeout floors, how many agents may run at once,
and whether a task kind is offered at all for this model.

### 3. Task size follows the profile

Michael's instinct — break work into the smallest pieces possible — is right, and needs one guard:
size should be a consequence of the measured profile, not a fixed taste. A 14B model gets tasks with
one acceptance criterion. A frontier model gets a whole feature.

The trade to name honestly: smaller pieces mean more turns, and on a slow local model turns are the
expensive resource. The profile's measured seconds-per-turn is what balances the two. The manager
agent already breaks work into features and tasks; it needs the profile as an input.

### 4. Check with a script first, a second agent second

Michael's builder-and-tester idea is right. The refinement: **never ask a model to judge what a
script can score.** Two models double the cost and double the chance of a confident wrong answer.

- Every task carries acceptance criteria from the moment it is created.
- Todero decides whether those criteria are machine-checkable.
- If they are — tests, build, lint, a file exists, a link resolves — a script is the gate, and its
  verdict is one no model can talk its way around.
- If they are not — does this read well, does it answer the brief — a second agent is the gate.

This is the existing reviewer agent, with a deterministic tier in front of it.

### 5. Failure is a normal path

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
fails loudly, and every one of the five pieces above has a place to prove itself.

## Order of work

1. **Todero sets the model's window per request** — small, and the first half of the prompt budget.
   Already the recommendation of the wave 15 verdict.
2. **Capability profile written by the connection test** — nothing else can be sized without it.
3. **The model matrix check** — before any new task kind, so that new work is measured on arrival.
4. **Enforced output contracts** — schema or grammar where the runtime allows.
5. **Acceptance criteria plus the deterministic checker tier.**
6. **Task sizing from the profile.**

Code tasks (the "wave L" item: routing implement-tasks to Claude Code or Codex) should come after
steps 1-3 and be designed from the start around step 5. Running code tasks on a local model before
the matrix exists produces failures nobody can attribute.

## Non-goals

- Making a small model as good as a large one. The aim is that a small model fails safely and
  visibly, not that it matches Claude.
- A model router that silently picks a different model than the user chose. The user's choice is the
  user's choice; Todero's job is to work within it and say what it costs.

## Open questions for Michael

- How slow is too slow? If a 7B model needs nine hours for what Claude does in twenty minutes, is
  that a supported configuration or a warning at setup time?
- Should Todero refuse a task kind when the profile says the model cannot do it, or attempt it and
  report the failure?
