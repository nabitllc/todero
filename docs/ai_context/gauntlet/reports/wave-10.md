# Wave 10 — item 2 on the merged tree

*2026-09-12T02:15:34+00:00 · 1225.3s wall-clock*

## Progress

**16/20 checks passing**  (16/20 last wave → 16/20)

- **Fixed:** live_loop_ollama
- **REGRESSED:** unit_ui, item5_task_drain_stable  ← treat before new work
- Still failing: item3_board_reorder, item4_send_back_one_call
- New checks: repro_second_hand_in

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 224 | 3,760 | 3,763,744 | 8,327 | $1.2977 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 541,997 | 236 | $0.1457 |
| **total** | | | | | | **$1.4434** |

## Failures

### `unit_ui` — exit 1 (110.5s)
```
node checks/vitest.mjs ui
```
```
·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·

 Test Files  1 failed | 546 passed (547)
      Tests  1 failed | 5382 passed (5383)
   Start at  21:16:00
   Duration  109.43s (transform 157.84s, setup 13.33s, import 1193.51s, tests 334.26s, environment 646.59s)

[gauntlet] 1 failed:
  FAIL  src/pages/AgentToolsTab.test.tsx > AgentToolsTab > preserves checkbox changes made after the last saved install state
```

### `item3_board_reorder` — exit 1 (2.3s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
failed (4)
   Start at  21:34:14
   Duration  1.84s (transform 693ms, setup 24ms, import 971ms, tests 7ms, environment 673ms)

[gauntlet] 4 failed:
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the priority of the card it lands above
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the lowest neighbour's priority when it lands at the bottom
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > changes nothing when the card lands where it already is
  FAIL  src/lib/board-reorder.gauntlet.ts > a drop inside one column > is a reorder that carries the new priority
```

### `item4_send_back_one_call` — exit 1 (2.0s)
```
node checks/vitest.mjs --gauntlet server src/__tests__/send-back-route.gauntlet.ts
```
```
[gauntlet] vitest in server: src/__tests__/send-back-route.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/server



 Test Files  1 failed (1)
      Tests  no tests
   Start at  21:34:16
   Duration  1.54s (transform 738ms, setup 110ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

### `item5_task_drain_stable` — exit 1 (71.2s)
```
node checks/repeat.mjs 5 server src/__tests__/instance-settings-routes.test.ts
```
```
k (file:///C:/Development/Todero/node_modules/.pnpm/@vitest+spy@4.1.10/node_modules/@vitest/spy/dist/index.js:332:34)
              at publishActivitiesBestEffort (C:/Development/Todero/server/src/routes/instance-settings.ts:74:7)
              at C:/Development/Todero/server/src/routes/instance-settings.ts:398:9
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
Â·Â·Â·Â·Â·

 Test Files  1 failed (1)
      Tests  1 failed | 49 passed (50)
   Start at  21:35:09
   Duration  20.17s (transform 7.64s, setup 110ms, import 131ms, tests 19.77s, environment 0ms)
```

## What's next — judge

# Wave 10 verdict

Written by the session from the report and two reruns.

## 1. Which failures share a root cause

**Item 2 is done.** Both item 2 checks pass, and with PR 96 merged into the branch the live loop
on Ollama passed again: plan, four tasks, reviews, wrap-up, no handoff wake, inside the budget.
`repro_second_hand_in` joined the list and passes.

**The two regressions are the two known flakes, and both pass alone.** `AgentToolsTab >
preserves checkbox changes made after the last saved install state` is the same UI test that
failed in wave 3; rerun alone it passes (4/4). `item5_task_drain_stable` failed one run in five,
as in wave 8, right after the live loop had kept the machine busy; rerun alone it passes (50/50).
Both are load-sensitive tests, which is item 5's subject; neither touches item 2's files.

**Items 3 and 4** are red by design.

## 2. What wave 11 should add, and stop

**Add** nothing for item 2. Item 3 is next (a drop inside a Board column sets the task's
priority). Item 5 now has three local sightings (waves 8 and 10 here, and CI on PRs 95 and 96):
its wave should start from the `publishActivitiesBestEffort` line in the failure, not from CI.

**Stop** nothing.

