# Wave 2 — item 0: a slow local model does not derail the loop

*2026-09-11T20:52:52+00:00 · 513.4s wall-clock*

## Progress

**10/16 checks passing**  (6/16 last wave ↑ 10/16)

- **Fixed:** unit_server_core, file_size_caps
- **REGRESSED:** unit_ui  ← treat before new work
- Still failing: live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call
- New checks: item0_local_model_timeout, item0_recovery_copy, repro_slow_local_model_turn

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 128 | 3,467 | 1,173,028 | 35,659 | $1.1811 |
| auxiliary | claude-fable-5-1 | 3,799 | 8,733 | 1,045,688 | 1,830 | $0.7634 |
| **total** | | | | | | **$1.9444** |

## Failures

### `unit_ui` — exit 1 (111.1s)
```
node checks/vitest.mjs ui
```
```
·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·

 Test Files  2 failed | 542 passed (544)
      Tests  4 failed | 5366 passed (5370)
   Start at  15:53:18
   Duration  110.21s (transform 146.41s, setup 12.59s, import 1190.67s, tests 341.50s, environment 652.54s)
```

### `live_loop_ollama` — exit 1 (179.3s)
```
python checks/live-loop.py
```
```
15:57:11 organization Zz Gauntlet 0911-155711 8f055ffe-ef70-4633-a06e-3fb7c8c52d33
15:57:49 round 1: status=blocked markers={'waiting': True, 'review': False, 'plan': False}
15:59:04 round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': False}
16:00:10 round 3: status=blocked markers={'waiting': True, 'review': False, 'plan': False}
16:00:10 FAIL plan proposed within two rounds (round None)
16:00:10 archived Zz Gauntlet 0911-155711
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
   Start at  16:00:14
   Duration  248ms (transform 64ms, setup 31ms, import 0ms, tests 0ms, environment 0ms)
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
   Start at  16:00:14
   Duration  199ms (transform 25ms, setup 20ms, import 0ms, tests 0ms, environment 0ms)
```

### `item3_board_reorder` — exit 1 (1.6s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
[gauntlet] vitest in ui: src/lib/board-reorder.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/ui

xxxx

 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  16:00:15
   Duration  1.19s (transform 700ms, setup 20ms, import 1.01s, tests 6ms, environment 0ms)
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
   Start at  16:00:17
   Duration  1.58s (transform 740ms, setup 117ms, import 0ms, tests 0ms, environment 0ms)
```

## What's next — judge

# Wave 2 verdict

Written by the session from the stored runs and two reruns, not by a separate judge: both
failures had a deterministic cause that could be read off the evidence.

## 1. Which failures share a root cause

**None of them. Two separate things, and one of them is not a failure of the product.**

**The live loop stalled on its second turn because the parser threw the plan away.** The model
answered the person's brief with a plan block that named the goal and four features and stopped
before the tasks, twice in a row, each time ending "Do you approve this plan?". The stored result
of both turns carries the reply and `toderoDisposition: waiting` but no `toderoPlanBlock`: the
shared parser returns null for a block with no tasks, so the reply posted as plain prose, no Plan
document was written, no approval card appeared, and the task sat "waiting on you" with nothing
to approve. The instructions do ask for four to twelve tasks; a 14B model does not always obey.
This is not what item 0 set out to fix (the ten-minute floor held: every turn came back inside
75 seconds) but it is the same family, a healthy loop taken off the rails by ordinary variation in
what a local model writes. Fixed on this branch: a plan with features and no tasks becomes one
task per feature, handing in what the feature's `done_when` asks for. The reply from the loop,
word for word, is now `repros/plan-without-tasks.gauntlet.ts` (fails on main, passes here).

**The unit_ui "regression" did not reproduce.** Two full reruns of the UI suite on the same tree
passed 5370 of 5370, and the branch touches one UI file (the wizard's default timeout constant),
whose own tests pass. The wave lost the names of the four tests because the wrapper's dot
reporter prints them under the stack traces and the runner keeps only the last 600 characters.
The wrapper now ends every run with the `FAIL` lines, so the next flake is named. Treat it as
a flake under load until wave 3 says otherwise.

## 2. What wave 3 should add, and stop

**Add** `repro_plan_without_tasks` (done). Nothing else: the item 0 checks and the slow-turn repro
all passed, and the live loop is the check that matters for this item.

**Stop** nothing yet. The task-drain repeat stays one more wave as a control, as wave 1 decided.

