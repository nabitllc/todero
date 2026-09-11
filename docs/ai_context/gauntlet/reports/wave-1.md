# Wave 1 — baseline

*2026-09-11T18:08:49+00:00 · 1987.2s wall-clock*

## Progress

**6/13 checks passing**

- Still failing: unit_server_core, file_size_caps, live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 98 | 4,495 | 3,504,055 | 5,151 | $1.2048 |
| auxiliary | claude-fable-5-1 | 1,012 | 29 | 1,756,383 | 1,796 | $0.4866 |
| **total** | | | | | | **$1.6913** |

## Failures

### `unit_server_core` — exit 1 (115.4s)
```
node checks/vitest.mjs server src/todero src/adapters/http src/routes src/__tests__/openapi-routes.test.ts src/__tests__/heartbeat-paused-company-guard.test.ts src/__tests__/company-skills-service.test.ts
```
```
·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·

 Test Files  1 failed | 39 passed (40)
      Tests  3 failed | 549 passed (552)
   Start at  13:11:09
   Duration  114.69s (transform 9.86s, setup 3.95s, import 42.92s, tests 61.79s, environment 2ms)
```

### `file_size_caps` — exit 1 (0.3s)
```
node checks/file-size-caps.mjs
```
```
[file-size] GREW ui/src/components/issue-properties/IssueProperties.tsx: 2742 lines (was 2736, cap 400)
[file-size] NEW outlier ui/src/components/work-item/work-item-model.ts: 503 lines (cap 500)
[file-size] GREW ui/src/pages/IssueDetail.tsx: 5945 lines (was 5889, cap 400)
```

### `live_loop_ollama` — exit 124 (1660.2s)
```
python checks/live-loop.py
```
```
timed out after 1200s
```

### `item1_skill_rows` — exit 1 (0.9s)
```
node checks/vitest.mjs --gauntlet ui src/lib/skill-pack-row.gauntlet.test.ts src/components/skills/SkillPackRowMeta.gauntlet.test.tsx
```
```
[gauntlet] vitest in ui: src/lib/skill-pack-row.gauntlet.test.ts src/components/skills/SkillPackRowMeta.gauntlet.test.tsx

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  2 failed (2)
      Tests  no tests
   Start at  13:40:45
   Duration  295ms (transform 88ms, setup 48ms, import 0ms, tests 0ms, environment 0ms)
```

### `item2_wizard_window` — exit 1 (0.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/local-llm-window.gauntlet.test.ts
```
```
[gauntlet] vitest in ui: src/lib/local-llm-window.gauntlet.test.ts

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  1 failed (1)
      Tests  no tests
   Start at  13:40:46
   Duration  199ms (transform 27ms, setup 22ms, import 0ms, tests 0ms, environment 0ms)
```

### `item3_board_reorder` — exit 1 (1.8s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.test.ts
```
```
[gauntlet] vitest in ui: src/lib/board-reorder.gauntlet.test.ts

 RUN  v4.1.10 C:/Development/Todero/ui

xxxx

 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  13:40:46
   Duration  1.36s (transform 775ms, setup 19ms, import 1.17s, tests 7ms, environment 0ms)
```

### `item4_send_back_one_call` — exit 1 (2.1s)
```
node checks/vitest.mjs --gauntlet server src/__tests__/send-back-route.gauntlet.test.ts
```
```
[gauntlet] vitest in server: src/__tests__/send-back-route.gauntlet.test.ts

 RUN  v4.1.10 C:/Development/Todero/server



 Test Files  1 failed (1)
      Tests  no tests
   Start at  13:40:48
   Duration  1.62s (transform 752ms, setup 156ms, import 0ms, tests 0ms, environment 0ms)
```

## What's next — judge

# Wave 1 verdict

## 1. Which failures share a root cause

**Two clusters, and one non-failure.**

**Cluster A — the live loop and everything it dragged with it.** The timeout, the banned word "issue" in notices to the person, the doubled `finish_successful_run_handoff` wake, and the two tasks that ended "waiting on you" are all one cause: since the manager wave, approving a plan starts the first task of every feature at once, and nothing enforces the agent's own `maxConcurrentRuns: 1`. Four turns hit a single model, two starved past their limit, and the recovery path fired — the copy defect and the duplicate wake are that path's output, not separate bugs. The same check passing in two minutes on an idle machine confirms it: contention, not the loop.

**Cluster B — checks that hard-code a snapshot of the world.** The symlink cases assumed a host that can make symlinks; the size allowlist assumed a repo state from before PR 92. Neither says anything about the product. Both are now fixed by deciding at runtime instead of at authoring time.

**Not a failure:** item1–item4 fail because their code does not exist yet. That is the point of a red check.

## 2. What wave 2 should add, and stop

**Add** — turn cluster A's residue into cheap deterministic checks so the slow live loop is not the only thing that catches it: one that plan approval never starts more runs than the agent's concurrency limit; one that a wake is delivered once; one that user-visible recovery copy carries no banned words. Fix the fan-out first — the other three should then pass without touching the recovery service.

**Stop** — repeating the task-drain test locally. It passed, and the flake has only ever appeared on the GitHub runner, so the local repeat scores nothing. Keep the work item; move its evidence to CI.

