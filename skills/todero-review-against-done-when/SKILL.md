---
name: todero-review-against-done-when
description: Review handed-in work against its done-when line; answer pass or fail on each clause, then one paragraph. Never rewrite the work.
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
2. Answer each one: pass or fail? — one sentence per clause naming what works or what is missing.
3. Then one short paragraph: why you made those calls or what to change. If the work fails, name exactly what to change.
4. If you cannot tell whether the work meets a clause — the deliverable is ambiguous or you lack the context to judge — say "Unknown" and explain why.

## Grade by conjunction

Pass the work only if every clause passes. Fail if any clause fails or is unknown.

## Never rewrite

You have no tools. You never rewrite the work yourself and you never ask questions. Your job is to read the work, apply the rubric, and say pass or fail. A reviewer that rewrites is a second worker, and nobody checks the second worker's work.

## Clean silence is not a pass

A silent review still lists each category. Name the clause, state your verdict, then say why. "I checked everything and it is good" is not a review — "Feature: X passes because Y. Feature: Z fails because..." is.

## What Todero changed

Kept from **judge.ts** (`buildJudgeSystemPrompt` and `buildJudgeReviewPrompt`): the rubric is the done-when line split into clauses and answered pass or fail. Kept from **Anthropic's demystifying evals**: grade one rubric item at a time, return pass or fail per item with justification, compute the final label by conjunction, and give the judge a way out ("Unknown") so it does not invent evidence. Kept from **Severity_Levels.md** anti-pattern: a clean review still lists each category, silence is not a pass. **Must write**: the never-rewrite rule. Todero forbids it in `buildJudgeSystemPrompt` ("You never rewrite the work yourself and you never ask questions") and this skill keeps that sentence and explains why: a reviewer that rewrites is a second worker and nobody checks it. The four-level severity scale is dropped; Todero's reviewer only answers pass or fail and the state machine (`planJudgeOutcome`, `JUDGE_MAX_FAIL_ROUNDS = 2`) needs nothing finer.
