# Self-Reflection Log

## Format
```
CONTEXT: [type of task]
REFLECTION: [what I noticed]
LESSON: [what to do differently]
STATUS: tentative | confirmed (Nx)
```

## 2026-03-28
CONTEXT: System architecture Q&A (tasks/features/testing/task-first rule)
REFLECTION: Four real process gaps existed that had never been formalized: no task IDs, no unified issue hierarchy, Tester reviewing everything, no task-first rule. All existed as informal intent but weren't enforced.
LESSON: After each major build sprint, do an architecture Q&A — surface what's missing before it causes problems. Don't assume process is solid just because it was discussed.
STATUS: confirmed (Michael validated all 4 gaps)

CONTEXT: n8n Discord automation rebuild
REFLECTION: Built 5 workflows with HTTP Request jsonBody mode, all silently sent `{{ $json.content }}` as literal text. Didn't test before shipping.
LESSON: Always test n8n Discord integrations immediately after building — send a test message manually. jsonBody = literal. keypair or fetch() = expressions work.
STATUS: confirmed (tested and fixed)

CONTEXT: Sprint productivity — 57 tasks shipped in one day
REFLECTION: Highest single-day output so far. Key factors: clear priorities from Michael, infrastructure already stable, no deployment blockers, parallelized DB + UI + automation work.
LESSON: This pace is sustainable when: scope is clear upfront, infra is stable, no waiting on external dependencies, sub-agents handle heavy work.
STATUS: tentative

## 2026-03-27
CONTEXT: MC Chat — building LLM integration
REFLECTION: Built with OpenRouter first, then had to redo for OpenClaw gateway. Should have asked about routing preference upfront.
LESSON: When building LLM integrations, ask where the calls should route before writing code.
STATUS: tentative

CONTEXT: Vespera build sprint (PRs #2-5)
REFLECTION: 4 PRs merged in one session, but all had bugs caught in testing. Speed over quality tradeoff.
LESSON: After bulk feature PRs, run a structured test pass before moving on. Don't wait for Michael to find bugs.
STATUS: tentative
