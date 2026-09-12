# Wave 8 — second hand-in keeps its document

*2026-09-12T01:14:13+00:00 · 1250.5s wall-clock*

## Progress

**14/19 checks passing**

- Still failing: item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call, item5_task_drain_stable

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 392 | 11,631 | 6,382,533 | 20,797 | $2.5970 |
| auxiliary | claude-fable-5-1 | 1,012 | 18 | 919,317 | 528 | $0.2514 |
| **total** | | | | | | **$2.8485** |

## Failures

### `item1_skill_rows` — exit 1 (0.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/skill-pack-row.gauntlet.ts src/components/skills/SkillPackRowMeta.gauntlet.tsx
```
```
[gauntlet] vitest in ui: src/lib/skill-pack-row.gauntlet.ts src/components/skills/SkillPackRowMeta.gauntlet.tsx

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  2 failed (2)
      Tests  no tests
   Start at  20:33:43
   Duration  251ms (transform 76ms, setup 42ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 2 failed:
  FAIL  src/lib/skill-pack-row.gauntlet.ts [ src/lib/skill-pack-row.gauntlet.ts ]
  FAIL  src/components/skills/SkillPackRowMeta.gauntlet.tsx [ src/components/skills/SkillPackRowMeta.gauntlet.tsx ]
```

### `item2_wizard_window` — exit 1 (0.6s)
```
node checks/vitest.mjs --gauntlet ui src/lib/local-llm-window.gauntlet.ts
```
```
[gauntlet] vitest in ui: src/lib/local-llm-window.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  1 failed (1)
      Tests  no tests
   Start at  20:33:44
   Duration  195ms (transform 25ms, setup 21ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (1.6s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
4 failed (4)
   Start at  20:33:45
   Duration  1.19s (transform 698ms, setup 21ms, import 1.00s, tests 6ms, environment 0ms)

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
   Start at  20:33:46
   Duration  1.56s (transform 742ms, setup 110ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

### `item5_task_drain_stable` — exit 1 (46.0s)
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
   Start at  20:34:14
   Duration  20.02s (transform 7.87s, setup 116ms, import 131ms, tests 19.61s, environment 0ms)
```

## What's next — judge

# Wave 8 verdict

Written by the session from the report.

## 1. Which failures share a root cause

**The live loop passed for the first time.** Plan, four tasks, reviews, wrap-up, project completed,
feature goals achieved, no handoff wake, inside the budget, with a reviewer send-back on the way:
the second hand-in landed as revision two of its Output document instead of failing. Nothing on
this branch changed the loop except that.

**`item1_skill_rows` is red only because this branch was cut before item 1 merged** (PR 95 is on
main now); the check passes there.

**`item5_task_drain_stable` failed locally for the first time**: one run in five of
`instance-settings-routes.test.ts` failed in `publishActivitiesBestEffort`, right after the live
loop had kept the machine busy. Until now the flake had only shown on the GitHub runner. That is
item 5's evidence, and it says the cause is load, not the runner: the repeat is worth keeping.

**Items 2, 3 and 4** are red by design.

## 2. What wave 9 should add, and stop

**Add** nothing for this branch; it is done. Item 2 is next (the window hint, and a reply cut off
at the window reported as cut off).

**Stop** nothing. The task-drain repeat earned its place this wave.

