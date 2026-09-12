# Wave 12 — item 4: a send-back is one call

*2026-09-12T03:07:34+00:00 · 981.7s wall-clock*

## Progress

**17/20 checks passing**

- Still failing: unit_server_core, item3_board_reorder, item5_task_drain_stable

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 196 | 5,131 | 4,466,075 | 10,016 | $1.5753 |
| auxiliary | claude-fable-5-1 | 1,012 | 18 | 1,284,072 | 1,179 | $0.3556 |
| **total** | | | | | | **$1.9310** |

## Failures

### `unit_server_core` — exit 1 (138.4s)
```
node checks/vitest.mjs server src/todero src/adapters/http src/routes src/__tests__/openapi-routes.test.ts src/__tests__/heartbeat-paused-company-guard.test.ts src/__tests__/company-skills-service.test.ts
```
```
Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·

 Test Files  1 failed | 45 passed (46)
      Tests  1 failed | 577 passed | 3 skipped (581)
   Start at  22:09:45
   Duration  137.77s (transform 9.54s, setup 4.31s, import 50.72s, tests 75.98s, environment 2ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/openapi-routes.test.ts > openapi routes > covers the mounted server routes exactly
```

### `item3_board_reorder` — exit 1 (2.4s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
failed (4)
   Start at  22:22:00
   Duration  1.97s (transform 737ms, setup 23ms, import 1.04s, tests 6ms, environment 731ms)

[gauntlet] 4 failed:
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the priority of the card it lands above
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the lowest neighbour's priority when it lands at the bottom
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > changes nothing when the card lands where it already is
  FAIL  src/lib/board-reorder.gauntlet.ts > a drop inside one column > is a reorder that carries the new priority
```

### `item5_task_drain_stable` — exit 1 (70.2s)
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
   Start at  22:23:06
   Duration  19.57s (transform 7.79s, setup 118ms, import 136ms, tests 19.14s, environment 0ms)
```

## What's next — judge

# Wave 12 verdict

Written by the session from the report and one rerun.

## 1. Which failures share a root cause

**Item 4 is done on the checks**: `item4_send_back_one_call` passes, the route's ordinary test
proves the order (the note exists when the wake is queued, and the wake carries the note's id),
and the live loop on Ollama passed again.

**`unit_server_core` failed on one test, and it was this branch's**: the OpenAPI coverage test
lists every route file it knows and found `todero-send-back-routes.ts` unknown. The route is now
in the spec (`POST /api/issues/{id}/send-back`) and in the test's registry; the test passes.

**`item3_board_reorder` is red only because this branch was cut before item 3 merged** (PR 98 is
on main now).

**`item5_task_drain_stable` failed again**, its third local sighting. The stack the report shows
is not the failure: it is the error the "publish fails" case logs on purpose. The repeat check now
ends with the failing test's name and message, so wave 13 names the flake; item 5 starts there.

## 2. What wave 13 should add, and stop

**Add** nothing for item 4. Item 5's wave should read the repeat check's new recap first.

**Stop** nothing.

