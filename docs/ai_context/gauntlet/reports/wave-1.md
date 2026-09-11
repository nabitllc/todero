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

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 2 add, and what should it stop checking?
