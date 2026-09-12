# Wave 13 — item 5: the task-drain test waits for its condition

*2026-09-12T03:40:51+00:00 · 1275.7s wall-clock*

## Progress

**19/20 checks passing**

- Still failing: item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 64 | 1,074 | 1,368,408 | 1,791 | $0.4323 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 685,687 | 213 | $0.1812 |
| **total** | | | | | | **$0.6135** |

## Failures

### `item4_send_back_one_call` — exit 1 (2.1s)
```
node checks/vitest.mjs --gauntlet server src/__tests__/send-back-route.gauntlet.ts
```
```
[gauntlet] vitest in server: src/__tests__/send-back-route.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/server



 Test Files  1 failed (1)
      Tests  no tests
   Start at  23:00:27
   Duration  1.62s (transform 779ms, setup 110ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 13 verdict

Written by the session from the report.

## 1. Which failures share a root cause

**Item 5 is done on the checks.** `item5_task_drain_stable` passed five runs right after the live
loop, the load that made it fail in waves 8, 10 and 12; the live loop itself passed; the UI suite
passed. The one red check, `item4_send_back_one_call`, is red only because this branch was cut
before PR 99 merged; it passes on main.

**What the flake was.** The overlapping-requests case slept a fixed 30 ms and then asserted the
first request had reached its blocked transaction. On a loaded machine it had not. The case now
waits for that condition. Every case in the file also rebuilds the app with a fresh module graph,
which under load can pass vitest's 5-second default on its own; the file has a 30-second budget.
A publish mock made to throw in one case now resets after it, which removes the logged
"live event bus unavailable" noise the earlier reports mistook for the failure.

**One sighting is still unexplained**: under heavy local load (two suites alongside), an
executionMode-floor case once returned 500 where 403 was expected. Ten loaded runs since were
clean. Its assertions now carry the response body, so the next sighting names its cause.

## 2. What wave 14 should add, and stop

The five items on the work list are built and merged or in review. **Add** nothing until
Michael sets the next list. **Stop** nothing; the checks stay as the regression set.

