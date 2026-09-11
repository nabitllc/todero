# Local model: from mission to working tasks

**Status:** proposed, 2026-09-10. **Owner:** Michael. **Scope:** a chat-only local model
(Ollama through the http adapter) hired in the first-run wizard.

## Why

PR #77 made a local model converse on the first task and hand back a status. Everything
before and after that reply still assumes a tool-capable agent: the instructions file the
model never reads, a first-task script that asks for a plan document and a checkbox card
the model cannot produce, a Second Brain it cannot open, and no way for a "yes" from the
person to turn into tasks the agent then works through. This plan closes that gap for one
agent on one machine, which is the standing wave-one goal.

## The four weaknesses and the fix for each

### W1. AGENTS.md never reaches a local model

The hire writes an `AGENTS.md` bundle from the mission; the http adapter skips it, so the
model only sees the task description.

**Fix.** Build the system message for a conversational http agent from the agent record,
not from a file: name, role title, company name, the company mission (from the company
goal), and the behaviour rules PR #77 added. Keep it under ~250 words: a 7B model loses
the thread otherwise. `AGENTS.md` keeps being written for tool adapters; for http agents it
is simply not the source of truth. Code: `server/src/adapters/http/chat-completions.ts`
`buildChatCompletionsSystemPrompt` takes an `identity` object; the heartbeat fills it from
`agent` + `company` + `goal` in the same place it loads `toderoThread`.

### W2. The first-task script asks for tools the model does not have

`ui/src/lib/onboarding-first-task.ts` tells the agent to write the `plan` document and
present a `request_checkbox_confirmation` card. A chat-only model answers in prose and the
promised sidebar never appears.

**Fix.** A second first-task script for conversational agents, chosen by the wizard when
`connectKind === "local_llm"`:

1. Ask at most three questions that change the plan (scope, must-haves, what "done" is).
   Stop and wait (`STATUS: waiting`).
2. Once answered, reply with a short plan in the fenced block below, followed by
   `STATUS: waiting`. No hiring talk, no tool talk.

The block is the contract Todero parses (see "The loop"). The description stays short so
the mission is not buried.

### W3. The Second Brain step is decorative for a local model

The vault reaches agents through an environment variable only command-line adapters read.

**Fix, now.** Skip the step for a local-LLM hire and record `None`. One condition in the
wizard's step order, plus copy on the Review step: "Your local model works from the
conversation only." **Later.** When retrieval exists, feed the top few vault notes into the
system message per task; not before one project works end to end.

### W4. The mission is repeated three times before the model speaks

Greeting quotes it, the description quotes it, the title is its first sentence.

**Fix.** The greeting stops quoting the mission and becomes one line: "Welcome! I'm Ash.
Give me a moment to read the mission and I'll come back with a couple of questions." The
title keeps the first sentence (it is what lists show). The work-item view hides the seeded
description on the onboarding first task and shows the mission line instead, the way the
old chat view already did (`originKind` marks the task; `work-item-adapter.ts` reads it).

## The loop: mission → questions → plan → approval → tasks → work → done

One agent, one machine, sequential. The model only ever produces text; Todero does every
structural action. That is the whole design principle: **the model proposes in a fixed
shape, Todero acts on the shape.**

### 1. Clarify

First-task script step 1 above. Each exchange is one heartbeat run; PR #77 already wakes
the agent on the person's comment and hands the turn back with `STATUS: waiting`.

### 2. Propose: the plan block

When ready, the model ends its reply with:

````
```todero-plan
goal: One sentence of what we are building and for whom.
features:
  - name: Short feature name
    why: One line
    done_when: One line
tasks:
  - title: Imperative task title
    feature: Short feature name
    output: What the agent will hand in (a document, a list, a draft, a decision)
```
STATUS: waiting
````

Rules: YAML-ish, flat, no nesting deeper than shown, 3–7 features, 4–12 tasks, every task
names a feature. A 7B model can hold this shape; a 14B model does it reliably. The test
connection already tells the person the model's speed; the wizard can recommend the 14B when
it is present.

**Server.** `parseToderoPlanBlock(text)` in `server/src/todero/plan-block.ts`: returns
`{ plan, body }` or `null`. Tolerant: accepts `-` lists, trims labels, ignores unknown keys,
never throws. On a successful run with a parsed plan, the heartbeat:

- writes the plan as the issue's `plan` document (the data model already has it),
- stores the parsed shape as issue metadata (`onboardingPlan`, version 1),
- posts the reply body (block stripped) as the comment,
- sets the task to Blocked, Waiting on you (existing PR #77 path).

### 3. Approve: the plan card

In the work-item view, a task with an `onboardingPlan` and status Waiting shows a card
above the composer: the goal line, features as headings, tasks as checkboxes (all checked),
and two buttons, **Approve** and **Ask for changes**. "Ask for changes" focuses the composer;
the typed comment wakes the agent, which revises and re-emits the block (same path, new
version). **Approve** posts `POST /api/issues/:id/plan/approve` with the kept task ids.

The right sidebar gets a **Plan** section that renders the `plan` document, so the card can
stay short. This is the missing "plan on the right sidebar".

### 4. Create the work: Todero, not the model

On approve, the server, as the board actor:

- creates one child issue per kept task under the first task, in the Onboarding project,
  assigned to the same agent, status To do, with a description of
  `goal + feature + done_when + output` so each task stands alone,
- links them in order with `blockedByIssueIds` so task N+1 is blocked by task N (the
  existing dependency machinery then wakes the next one when the previous closes),
- sets the first task to In progress with its own `STATUS` left to the agent, and posts a
  system line "Approved. 6 tasks created." (system tone, not under the person's name).

Hiring is **out of scope** for this loop: the checked options are tasks only. Multiple
agents come back when one agent finishes one project (owner directive).

### 5. Work: one task at a time

Each child task wakes the agent (assignment wake). The prompt is the task description plus
the thread on that task; the system message says: do the work in this reply, hand in the
output, end with `STATUS: done` when the output is complete or `STATUS: waiting` with one
question when you cannot proceed.

- `STATUS: done`: the reply is stored as the task's `output` document and as the comment;
  the task closes; the dependency wake starts the next task. Same run path as PR #77 plus
  one document write.
- `STATUS: waiting`: Blocked, Waiting on you; the person's comment resumes it. Nothing else
  moves.
- Failure or timeout: the existing retry path; after the cap, Blocked with a system line
  the person can read, never "missing disposition".

Rate: one run at a time per agent (already `maxConcurrentRuns`, set it to 1 for http agents
in `buildNewAgentRuntimeConfig`), ten-second cooldown, no timer. So the loop is quiet unless
there is work, and never floods a laptop GPU.

### 6. Report: the parent task closes itself

When the last child closes, a heartbeat-side hook (the same place that runs the dependency
wake) posts a summary on the first task: one line per task with a link to its output, then
sets the first task to Done. The dashboard's "Tasks in progress" and Inbox's "Waiting on
you" already read these states.

## What the person sees, end to end

1. Finish the wizard, land on the first task: one greeting line.
2. Within about ten seconds: two or three questions. Answer in the composer.
3. Next reply: the plan card. Untick what you do not want. Approve.
4. The task list under the first task fills in; the first one starts on its own.
5. Each task ends with a document you can open, or a question in your Inbox.
6. When the last one closes, the first task shows the summary and turns green.

## Delivery order

| PR | Contents | Size |
| --- | --- | --- |
| A | W1 system identity, W2 chat first-task script, W3 skip step, W4 greeting + hidden description, `maxConcurrentRuns: 1` for http agents | small, one day |
| B | Plan block parser + plan document + issue metadata + Plan sidebar section + plan card with Approve / Ask for changes + approve endpoint creating chained child tasks | medium, two to three days |
| C | Per-task `output` document on done, dependency wake to the next task, parent summary and auto-close, failure lines readable | medium, two days |
| D | Model recommendation in the wizard (14B when present), retrieval from the vault into the system message | later |

Each PR is testable on its own on the reference machine with qwen2.5-coder:14b and the
current PoGo Collection+ organization. A leaves the loop as it is today but makes the first
exchange sensible; B is the moment the product becomes "propose, don't decide"; C is the
first time a local model finishes a project by itself.

## Out of scope, on purpose

- Hiring more agents from the plan.
- Code-producing tasks; a local chat model hands in documents. Code needs a tool adapter
  and a workspace, which the existing Claude Code / Codex paths already cover.
- Cloud models. Local only, per the standing directive.

## Risks

- Small models sometimes break the block shape. The parser is tolerant, and a parse miss
  simply posts the reply as prose with a system line "I could not read a plan in that
  reply" and a one-click "Ask Ash to send the plan again".
- Long threads exceed a 7B context. Cap the thread at 20 turns and 4k characters per turn
  (already in `conversation-thread.ts`); tasks get their own thread, so the first task's
  history never bleeds into work tasks.
- Dependency chains of 12 tasks are fine; the existing dependency wake is idempotent.
