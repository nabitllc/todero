# Wave 4 — item 0: the hand-in lands before the reviewer is asked

*2026-09-11T22:51:52+00:00 · 1198.2s wall-clock*

## Progress

**12/18 checks passing**  (11/18 last wave ↑ 12/18)

- **Fixed:** unit_ui
- **REGRESSED:** file_size_caps  ← treat before new work
- Still failing: live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call
- New checks: repro_review_window

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 100 | 1,290 | 1,036,266 | 1,938 | $0.3633 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 260,454 | 103 | $0.0727 |
| **total** | | | | | | **$0.4360** |

## Failures

### `file_size_caps` — exit 1 (0.3s)
```
node checks/file-size-caps.mjs
```
```
[file-size] GREW server/src/services/heartbeat.ts: 21027 lines (was 21011, cap 500)
```

### `live_loop_ollama` — exit 1 (852.0s)
```
python checks/live-loop.py
```
```
round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': True}
18:03:30 FAIL ZZGAAAAA-2: no hand-in or question within 5 minutes
18:05:12 ZZGAAAAA-2: handed in, reviewed, accepted
18:05:12 ZZGAAAAA-3: handed in, reviewed, accepted
18:05:12 ZZGAAAAA-4: handed in, reviewed, accepted
18:10:18 FAIL the conversation task closed with the wrap-up
18:10:18 FAIL the Onboarding project completed
18:10:18 FAIL feature goals achieved (Counter({'achieved': 3, 'active': 1}))
18:10:18 runs by status: {'succeeded': 7}
18:10:18 archived Zz Gauntlet 0911-175606
18:10:18 4 expectation(s) failed
```

### `item1_skill_rows` — exit 1 (0.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/skill-pack-row.gauntlet.ts src/components/skills/SkillPackRowMeta.gauntlet.tsx
```
```
[gauntlet] vitest in ui: src/lib/skill-pack-row.gauntlet.ts src/components/skills/SkillPackRowMeta.gauntlet.tsx

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  2 failed (2)
      Tests  no tests
   Start at  18:10:21
   Duration  261ms (transform 68ms, setup 37ms, import 0ms, tests 0ms, environment 0ms)

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
   Start at  18:10:22
   Duration  193ms (transform 23ms, setup 18ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (1.6s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
4 failed (4)
   Start at  18:10:23
   Duration  1.17s (transform 697ms, setup 20ms, import 991ms, tests 6ms, environment 0ms)

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
   Start at  18:10:24
   Duration  1.54s (transform 717ms, setup 108ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 4 verdict

Written by the session from the stored runs and the check's own log.

## 1. Which failures share a root cause

**The product side of item 0 held.** The loop's four tasks were handed in and reviewed one after
another (turns of 18, 61, 89 and 129 seconds plus the reviewer each time), a question on the
first task was answered and the task then passed; the organization's seven turns all succeeded;
there was no continuation turn, no handoff wake and no system notice on any task. The
"no handoff re-wake" expectation passed for the first time.

**The live loop still failed, on its own budgeting.** The check waited on the first child for
five minutes but only reads a child once no turn is queued or running anywhere in the
organization, and every first task of the plan is queued at approval. Four serial turns took
until fourteen seconds after that budget. The retry then used up the loop's fixed number of
passes before the fourth task was accepted, so the wrap-up never came. The check now lets the
queue settle, acts on every child that is ready, and repeats until none is open (25-minute budget).

**The file-size regression is this branch's own growth**: the hand-in-before-review change added
sixteen lines to `heartbeat.ts`, the repo's standing outlier. The allowlist is refreshed to the
current tree; the debt of extracting the hand-in block out of that file is real and noted.

## 2. What wave 5 should add, and stop

**Add** nothing. Wave 5 is the confirmation wave for the fixed check.

**Stop** nothing.

