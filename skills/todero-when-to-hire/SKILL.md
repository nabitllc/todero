---
name: todero-when-to-hire
description: Ask for a hire only when one of three things is true, and when you do, propose the role, a one-paragraph brief, and what the new agent reads first.
metadata:
  version: 1
  upstream: "C:/Development/Mich-Brain2/Playbooks/Multi_Agent_Fanout.md, C:/Development/Todero/server/src/todero/orchestration-rules.ts, https://www.anthropic.com/engineering/multi-agent-research-system, https://activewizards.com/blog/hierarchical-ai-agents-a-guide-to-crewai-delegation/"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [planning]
  todero-priority: 3
---

# Hire Only for a Real Reason

One agent, well briefed, matched or beat multi-agent setups on about 64% of tasks at half the cost. Split work across two agents only when their tasks own separate pieces — different features, different files — with no dependency between them mid-way. If one has to wait on the other's answer, it is one piece of work, not two.

Three rungs, and nothing else, make a new hire worth it.

## Rung 1: A kind of work the current agent cannot do

You are a planner. You cannot write code, or you cannot review code, or you cannot design the data. The work is a real kind your role does not cover. Propose: a worker with that skill, what they will build, and the files they will read.

## Rung 2: More ready tasks than the machine can serve at once

Your plan names a dozen tasks and half can start now. The machine serves two models at the same time and you are one of them. Nobody else is on this, so the rest wait until you finish. A second agent turns waiting into finished work. Propose: a role matching the work that is ready, one feature they own, and what they read.

## Rung 3: No reviewer

Your work is done and needs review, but you would be reviewing yourself. Somebody else has to check it. Propose: a reviewer, what they are reviewing, the standard they use (the done-when line), and the deliverable they read.

## What a hire needs from you

Four parts: the role, the model tier, a one-paragraph brief, and the files they read first. The brief carries three things, or the new agent guesses: an objective, the shape of the output they hand in, and the edge of their work — what is theirs and what is not. Vague labels make two agents do the same thing twice.

## Never for a one-off

Never hire somebody for a single task you could finish yourself. Hiring costs attention, and handing work over costs clarity. A manager that mostly rephrases instructions is complexity without reliability.

## Which tier to ask for

The question is not how big the work is, it is what a wrong answer costs. A weak model's wrong file list is caught by the next step. A weak model's wrong verdict is acted on. Ask for the strongest model when the output is a verdict; anything else can take what the person set as default.

## What Todero changed

Kept from **Multi_Agent_Fanout.md**: the escalation ladder written as three rungs; the 64% line; the fan-out test (separate pieces, no dependency mid-way); and the tier rule, "The discriminator is not task size, it is what a wrong answer costs."

Kept from **Anthropic's multi-agent research system**: a new hire needs an objective, an output format, and clear task boundaries, and vague labels make agents duplicate work.

Kept from **activewizards, hierarchical AI agents**: "you are paying for complexity without gaining reliability" when the manager is mostly rephrasing instructions.

Changed by Todero: the three triggers are named as Todero's own. Only the second one exists in code — `decideExtraWorker` in server/src/todero/orchestration-rules.ts counts ready tasks against the agents already here and what the machine can serve, and nothing else. The other two triggers, a kind of work the agent cannot do and no reviewer, are new text in this file with nothing behind them in code. You ask for a hire; Todero's rules still decide whether it happens. Dropped: the playbook's full tier table and its model names, which are not Todero's models.
