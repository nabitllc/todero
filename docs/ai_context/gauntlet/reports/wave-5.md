# Wave 5 — item 0: confirmation

*2026-09-11T23:13:49+00:00 · 1422.4s wall-clock*

## Progress

**13/18 checks passing**  (12/18 last wave ↑ 13/18)

- **Fixed:** file_size_caps
- Still failing: live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 64 | 1,556 | 537,649 | 6,272 | $0.3383 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 272,780 | 111 | $0.0759 |
| **total** | | | | | | **$0.4142** |

## Failures

### `live_loop_ollama` — exit 1 (1076.4s)
```
python checks/live-loop.py
```
```
8:18:04 organization Zz Gauntlet 0911-181804 42189840-5872-47fe-9079-97ecbb6caeac
18:19:06 round 1: status=blocked markers={'waiting': True, 'review': False, 'plan': False}
18:20:52 round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': True}
18:30:55 FAIL turns still running after ten minutes
18:36:00 FAIL the conversation task closed with the wrap-up
18:36:00 FAIL the Onboarding project completed
18:36:00 FAIL feature goals achieved (Counter({'active': 4}))
18:36:01 runs by status: {'succeeded': 7}
18:36:01 archived Zz Gauntlet 0911-181804
18:36:01 4 expectation(s) failed
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
   Start at  18:36:04
   Duration  243ms (transform 72ms, setup 39ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 2 failed:
  FAIL  src/lib/skill-pack-row.gauntlet.ts [ src/lib/skill-pack-row.gauntlet.ts ]
  FAIL  src/components/skills/SkillPackRowMeta.gauntlet.tsx [ src/components/skills/SkillPackRowMeta.gauntlet.tsx ]
```

### `item2_wizard_window` — exit 1 (0.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/local-llm-window.gauntlet.ts
```
```
[gauntlet] vitest in ui: src/lib/local-llm-window.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  1 failed (1)
      Tests  no tests
   Start at  18:36:05
   Duration  197ms (transform 25ms, setup 19ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (1.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
4 failed (4)
   Start at  18:36:05
   Duration  1.20s (transform 713ms, setup 19ms, import 1.02s, tests 6ms, environment 0ms)

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
   Start at  18:36:07
   Duration  1.57s (transform 730ms, setup 120ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 5 verdict

Written by the session from the stored runs.

## 1. Which failures share a root cause

**The product side held again, and the check's budget was still the failure.** The four tasks'
turns ran one after another and took 79, 204, 218 and 39 seconds this time (the model was slower
than in wave 4), plus the reviewer after each; the queue emptied at 23:30:55, the very second the
check's ten-minute wait for a quiet queue ran out. Three tasks were in review and one was asking a
question when the check gave up; all seven turns succeeded; no continuation turn, no handoff wake,
no system notice. The check now gives the queue the whole of its remaining 25-minute budget
instead of a separate ten minutes.

## 2. What wave 6 should add, and stop

**Add** nothing; **stop** nothing. Wave 6 confirms the check with the same tree.

