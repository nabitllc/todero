# Wave 7 — item 1: pack skill rows show version, because-line, and Reset

*2026-09-12T00:37:37+00:00 · 1494.2s wall-clock*

## Progress

**13/18 checks passing**  (13/18 last wave → 13/18)

- **Fixed:** item1_skill_rows
- **REGRESSED:** unit_ui  ← treat before new work
- Still failing: live_loop_ollama, item2_wizard_window, item3_board_reorder, item4_send_back_one_call

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 64 | 873 | 783,715 | 2,897 | $0.2982 |
| auxiliary | claude-fable-5-1 | 506 | 9 | 393,906 | 125 | $0.1065 |
| **total** | | | | | | **$0.4046** |

## Failures

### `unit_ui` — exit 1 (107.3s)
```
node checks/vitest.mjs ui
```
```
lPage settings > renders long source paths in full so they can wrap inside the sidebar
  FAIL  src/pages/CompanySkills.test.tsx > SkillDetailPage settings > saves normalized category edits from the settings dialog
  FAIL  src/pages/CompanySkills.test.tsx > SkillDetailPage settings > allows clearing categories and saving sharing together
  FAIL  src/pages/CompanySkills.test.tsx > SkillDetailPage settings > does not treat reordered categories as dirty
  FAIL  src/pages/CompanySkills.test.tsx > SkillDetailPage settings > keeps the category draft visible while a failed save leaves detail unchanged
```

### `live_loop_ollama` — exit 1 (1144.5s)
```
python checks/live-loop.py
```
```
9:52:21 ZZGAAAAAAAA-4: handed in, reviewed, accepted
19:52:21 ZZGAAAAAAAA-5: answered a question
19:57:13 ZZGAAAAAAAA-2: answered a question
19:57:13 ZZGAAAAAAAA-5: handed in, reviewed, accepted
19:59:34 FAIL ZZGAAAAAAAA-2: still asking after two answers
20:00:55 FAIL no handoff re-wake ({'issue_children_completed': 1, 'heartbeat_timer': 3, 'issue_commented': 1, 'issue_reopened_via_comment': 3, 'finish_successful_run_handoff': 1, 'issue_judge_revision': 1, 'issue_assigned': 5})
20:00:55 runs by status: {'succeeded': 15}
20:00:55 archived Zz Gauntlet 0911-194151
20:00:55 2 expectation(s) failed
```

### `item2_wizard_window` — exit 1 (1.3s)
```
node checks/vitest.mjs --gauntlet ui src/lib/local-llm-window.gauntlet.ts
```
```
[gauntlet] vitest in ui: src/lib/local-llm-window.gauntlet.ts

 RUN  v4.1.10 C:/Development/Todero/ui



 Test Files  1 failed (1)
      Tests  no tests
   Start at  20:01:02
   Duration  901ms (transform 19ms, setup 26ms, import 0ms, tests 0ms, environment 681ms)

[gauntlet] 1 failed:
  FAIL  src/lib/local-llm-window.gauntlet.ts [ src/lib/local-llm-window.gauntlet.ts ]
```

### `item3_board_reorder` — exit 1 (2.3s)
```
node checks/vitest.mjs --gauntlet ui src/lib/board-reorder.gauntlet.ts
```
```
failed (4)
   Start at  20:01:03
   Duration  1.87s (transform 712ms, setup 25ms, import 1.01s, tests 6ms, environment 669ms)

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
   Start at  20:01:05
   Duration  1.59s (transform 786ms, setup 114ms, import 0ms, tests 0ms, environment 0ms)

[gauntlet] 1 failed:
  FAIL  src/__tests__/send-back-route.gauntlet.ts [ src/__tests__/send-back-route.gauntlet.ts ]
```

## What's next — judge

# Wave 7 verdict

Written by the session from the stored runs and the revision turn's own log.

## 1. Which failures share a root cause

**Item 1 is done**: `item1_skill_rows` passes, and on the running product the skill's page shows
"Version 1", "Last changed because: Shipped with the skill pack." and a "Reset to the original"
button that, pressed, rewrote the line to "Reset to the original" and refreshed the page.

**The unit_ui regression was this branch's, and is fixed.** Four `SkillDetailPage settings` tests
render the page without a query client; the first placement of the meta line used a query hook
inside the page. The refresh now comes in as a callback from the parent. The suite passes again.

**The live loop's two failures are one cause, and it is not item 1's.** The reviewer sent the
first task back once; the worker's second hand-in then failed with
`Failed to apply the reply's disposition: Document update requires baseRevisionId`: the task's
Output document already existed from the first hand-in, and the second write asks for the
revision it builds on. The whole hand-in is dropped at that point (no status, no review, no
pre-write), so the successful-run handoff fired, posted "Todero needs you to choose what
happens next", and the worker answered that wake with a question. Every task that goes round the
reviewer once hits this. It belongs with item 0's promise ("no handoff wake") and is next.

## 2. What wave 8 should add, and stop

**Add** a repro for the second hand-in after a send-back (the Output document is updated, the
task lands in review, no handoff wake), on its own branch.

**Stop** nothing.

