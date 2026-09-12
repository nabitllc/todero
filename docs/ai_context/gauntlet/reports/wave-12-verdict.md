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
