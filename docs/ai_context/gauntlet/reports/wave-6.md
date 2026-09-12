# Wave 6 — item 0: confirmation, second pass

*2026-09-11T23:38:23+00:00 · 1201.4s wall-clock*

## Progress

**13/18 checks passing**  (13/18 last wave → 13/18)

- Still failing: live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 196 | 6,657 | 1,335,953 | 80,315 | $2.2751 |
| auxiliary | claude-fable-5-1 | 1,518 | 42 | 677,163 | 1,452 | $0.2156 |
| **total** | | | | | | **$2.4907** |

## Failures

### `live_loop_ollama` — exit 1 (855.0s)
```
python checks/live-loop.py
```
```
:43:29 round 1: status=blocked markers={'waiting': True, 'review': False, 'plan': False}
18:44:39 round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': True}
18:51:52 ZZGAAAAAAA-2: answered a question
18:51:52 ZZGAAAAAAA-3: handed in, reviewed, accepted
18:51:52 ZZGAAAAAAA-4: handed in, reviewed, accepted
18:51:52 ZZGAAAAAAA-5: handed in, reviewed, accepted
18:53:48 ZZGAAAAAAA-2: answered a question
18:55:24 FAIL ZZGAAAAAAA-2: still asking after two answers
18:56:52 runs by status: {'succeeded': 10}
18:56:52 archived Zz Gauntlet 0911-184237
18:56:52 1 expectation(s) failed
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
   Start at  18:56:56
   Duration  256ms (transform 79ms, setup 41ms, import 0ms, tests 0ms, environment 0ms)

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
   Start at  18:56:56
   Duration  193ms (transform 24ms, setup 20ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (1.6s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
 failed (4)
   Start at  18:56:57
   Duration  1.18s (transform 702ms, setup 19ms, import 1000ms, tests 6ms, environment 0ms)

[gauntlet] 4 failed:
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the priority of the card it lands above
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > takes the lowest neighbour's priority when it lands at the bottom
  FAIL  src/lib/board-reorder.gauntlet.ts > reorderFor > changes nothing when the card lands where it already is
  FAIL  src/lib/board-reorder.gauntlet.ts > a drop inside one column > is a reorder that carries the new priority
```

### `item4_send_back_one_call` — exit 1 (2.1s)
```
node checks/vitest.mjs --gauntlet server src/__tests__/send-back-route.gauntlet.ts
```
```
[gauntlet] vitest in server: src/__tests__/send-back-route.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/server



 Test Files  1 failed (1)
      Tests  no tests
   Start at  18:56:59
   Duration  1.62s (transform 782ms, setup 114ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 6 verdict

Written by the session from the stored runs.

## 1. Which failures share a root cause

**The loop ran to the end.** Plan in two rounds, four tasks handed in and reviewed one after
another, the conversation closed with its wrap-up, the Onboarding project completed, the feature
goals achieved, ten turns all succeeded, no continuation turn, no handoff wake, no system notice.
Item 0's done-when lines are met.

**The one expectation that failed is not this item's.** The "One-page concept" task answered its
brief with the document and then read as a question, three times, so the check closed it by hand.
The three replies are identical, 1,672 characters, and end mid-word ("groups of fiv"): the model's
output hit the edge of its 4,096-token window (Ollama's default; the model was trained for 32,768)
before it could write the status line, so the half-reply carried no "done" and was treated as the
model waiting on the person. The adapter never reads the endpoint's `finish_reason`, so the run
row says `completed`. That is item 2 (the window is too small, and how to raise it), with one
addition for it: read `finish_reason`, and when it is `length`, say the reply was cut off rather
than posting the half as a question.

## 2. What the next wave should add, and stop

**Add** to item 2's checks: a reply with `finish_reason: length` is reported as cut off, not
handed back as a question.

**Stop** nothing. Item 0 closes here; the next wave belongs to item 1.

