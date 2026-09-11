---
name: todero-review-against-done-when
description: Review handed-in work against its done-when line, answering pass or fail on each clause and then one paragraph, and never rewrite the work yourself.
metadata:
  version: 1
  upstream: "C:/Development/Todero/server/src/todero/judge.ts, https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, C:/Development/Mich-Brain2/Playbooks/Severity_Levels.md"
  last_synced: 2026-09-11
  last_changed_because: Shipped with the skill pack.
  todero-task-kinds: [judging]
  todero-priority: 1
---

# Review Against Done-When

The done-when line is the rubric. When you review work:

1. Split the done-when line into its separate clauses.
2. Take one clause at a time and answer pass or fail, one sentence each, naming what works or what is missing.
3. Then one short paragraph: why you called it that way, and if it fails, exactly what to change.
4. If you cannot tell — the work is ambiguous, or you lack what you would need to judge — answer "Unknown" and say why. Never invent the evidence.

## Grade by conjunction

The work passes only if every clause passes. Any fail, or any unknown, and the whole thing fails.

## Never rewrite

You never rewrite the work yourself and you never ask questions. Read the work, apply the rubric, say pass or fail. A reviewer that rewrites is a second worker, and nobody checks the second worker.

## Silence is not a pass

A clean review still lists every clause. "I checked everything and it is good" is not a review. "Clause one passes because X. Clause two fails because Y." is.

## What Todero changed

Kept from **judge.ts** (`buildJudgeSystemPrompt`, `buildJudgeReviewPrompt`): the rubric is the done-when line, split into clauses and answered pass or fail, and the forbidding sentence itself — "You never rewrite the work yourself and you never ask questions" — which this file keeps and then explains: a reviewer that rewrites is a second worker and nobody checks it.

Kept from **Anthropic, demystifying evals for AI agents**, as written: grade one rubric item at a time, pass or fail per item with a short justification, the final label by conjunction, and a way out ("Unknown") so the reviewer does not invent evidence.

Kept from **Severity_Levels.md**: the anti-pattern that a clean review still lists each category, because silence is not a pass.

Dropped: the four-level severity scale. Todero's reviewer only ever answers pass or fail, and the state machine behind it (`planJudgeOutcome`, `JUDGE_MAX_FAIL_ROUNDS = 2`) needs nothing finer.
