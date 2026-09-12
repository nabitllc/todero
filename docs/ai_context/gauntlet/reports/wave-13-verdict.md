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
