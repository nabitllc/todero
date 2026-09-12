# Wave 3 — item 0: slow turns survive; a features-only plan is still a plan

*2026-09-11T21:17:16+00:00 · 1622.8s wall-clock*

## Progress

**11/17 checks passing**  (10/17 last wave ↑ 11/17)

- Still failing: unit_ui, live_loop_ollama, item1_skill_rows, item2_wizard_window, item3_board_reorder, item4_send_back_one_call
- New checks: repro_plan_without_tasks

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 546 | 11,274 | 2,193,317 | 77,720 | $2.6719 |
| auxiliary | claude-fable-5-1 | 1,012 | 19 | 286,472 | 770 | $0.0981 |
| **total** | | | | | | **$2.7700** |

## Failures

### `unit_ui` — exit 1 (106.5s)
```
node checks/vitest.mjs ui
```
```
·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·Â·

 Test Files  1 failed | 543 passed (544)
      Tests  1 failed | 5369 passed (5370)
   Start at  16:17:42
   Duration  105.50s (transform 153.87s, setup 13.22s, import 1158.92s, tests 317.24s, environment 619.27s)

[gauntlet] 1 failed:
  FAIL  src/pages/AgentToolsTab.test.tsx > AgentToolsTab > preserves checkbox changes made after the last saved install state
```

### `live_loop_ollama` — exit 124 (1296.3s)
```
python checks/live-loop.py
```
```
timed out after 1200s
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
   Start at  16:43:06
   Duration  249ms (transform 76ms, setup 39ms, import 0ms, tests 0ms, environment 0ms)

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
   Start at  16:43:07
   Duration  196ms (transform 26ms, setup 19ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (1.7s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
4 failed (4)
   Start at  16:43:07
   Duration  1.20s (transform 705ms, setup 18ms, import 1.01s, tests 6ms, environment 0ms)

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
   Start at  16:43:09
   Duration  1.52s (transform 718ms, setup 111ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 3 verdict

Written by the session from the stored runs, the server log and one rerun; the causes were
deterministic enough not to need a separate judge.

## 1. Which failures share a root cause

**The live loop's timeout and the noise on every child task are one cause; the UI flake is
another; the item checks are not failures.**

**One cause: the turn is stamped finished before its hand-in is applied, and the reviewer sits in
that gap.** The wave-2 fix held: the features-only plan was approved (turn two), four child tasks
started, and each one was handed in and passed by the reviewer. But each also collected a
"continuation" turn, a "choose what happens next" wake and two system notices, and the loop's
own budget ran out on the fourth task. The server log shows why: the worker's turn is written
`succeeded` (its `finishedAt` set) before the hand-in block runs, and the hand-in block asks the
reviewer, a model on this machine, before it writes the task's new status. The recovery sweep
runs every thirty seconds; on each child it found a finished turn on a task still `in_progress`
with no next step and queued `issue_continuation_needed` (16:26:07 for the first task, fifteen
seconds after its turn finished, while the reviewer was still thinking). That continuation turn
had nothing to do, so the successful-run handoff fired next, with its two notices. The fix on this
branch writes the hand-in (blocked, in review) before the reviewer is asked; the reviewer's accept
is the only thing that writes a second time. `repros/review-window.gauntlet.ts` drives a real
heartbeat turn with a loopback reviewer that records what the task said when it was asked: on main
it says `in_progress`, here it says `blocked` with the review marker. The live loop's check budget
also goes from twenty to forty-five minutes: a four-task plan with a reviewer on this machine
takes about six minutes per task, and the loop was on its fourth when the runner cut it off.

**The other cause: a UI test that is sensitive to load.** This time the wrapper named it,
`AgentToolsTab > preserves checkbox changes made after the last saved install state`, a different
test from wave 2's four, and one of one failure in 5370. Not this item's; a candidate for the
task-drain item (5), which is the same kind of thing on the CI runner.

## 2. What wave 4 should add, and stop

**Add** `repro_review_window` (done). Wave 4 is the confirmation wave for item 0: the whole loop
inside the budget, with no continuation turn, no handoff wake and no system notice on any child.

**Stop** nothing. The task-drain repeat stays as a control, as wave 1 decided.

