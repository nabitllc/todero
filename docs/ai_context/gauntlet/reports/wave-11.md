# Wave 11 — item 3: a drop inside a column sets the priority

*2026-09-12T02:44:16+00:00 · 1095.8s wall-clock*

## Progress

**17/19 checks passing**

- Still failing: item2_wizard_window, item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 354 | 9,924 | 7,199,273 | 20,390 | $2.7074 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 610,081 | 266 | $0.1634 |
| **total** | | | | | | **$2.8707** |

## Failures

### `item2_wizard_window` — exit 1 (1.3s)
```
node checks/vitest.mjs --gauntlet ui src/lib/local-llm-window.gauntlet.ts
```
```
[gauntlet] vitest in ui: src/lib/local-llm-window.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  1 failed (1)
      Tests  no tests
   Start at  22:00:54
   Duration  885ms (transform 17ms, setup 23ms, import 0ms, tests 0ms, environment 670ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
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
   Start at  22:00:58
   Duration  1.54s (transform 743ms, setup 113ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 11 verdict

Written by the session from the report.

## 1. Which failures share a root cause

**Item 3 is done.** `item3_board_reorder` passes, the Board suites pass, and on the running
product dragging TAM-8 above TAM-7 in the Queued lane moved the card and said "TAM-8 is now
critical priority." The live loop passed again, and neither known flake showed this time.

**`item2_wizard_window` is red only because this branch was cut before item 2 merged** (PR 97 is
on main now); the check passes there. **Item 4** is red by design.

**Found on the way, fixed here**: a full navigation to `/board` read "board" as an organization
prefix and showed "Organization not found", and the sidebar's Board link went nowhere. "board"
joins the pages that live under the organization's prefix.

## 2. What wave 12 should add, and stop

**Add** nothing; **stop** nothing. Item 4 is next: a person's send-back as one call.

