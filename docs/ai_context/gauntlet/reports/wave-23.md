# Wave 23 — improvement loop wave 7 - a fresh attempt

*2026-09-22T03:41:56+00:00 · 4492.9s wall-clock*

## Progress

**29/32 checks passing**  (28/32 last wave ↑ 29/32)

- **REGRESSED:** unit_ui  ← treat before new work
- Still failing: item5_task_drain_stable, improvement_loop
- New checks: repro_fresh_review_gives_a_fresh_attempt, repro_review_follows_its_draft

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 22 | 4,819 | 349,090 | 657,941 | $4.4073 |
| **total** | | | | | | **$4.4073** |

## Failures

### `unit_ui` — exit 1 (109.3s)
```
node checks/vitest.mjs ui
```
```
    Tests  3 failed | 5409 passed (5412)
   Start at  22:42:21
   Duration  108.44s (transform 143.60s, setup 12.51s, import 1127.39s, tests 341.04s, environment 685.58s)

[gauntlet] 3 failed:
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > omits the Local driver option and lists Sandbox before SSH
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > shows the Local driver option when editing an existing local environment
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > preserves sandbox config when re-selecting the same provider while editing
```

### `item5_task_drain_stable` — exit 1 (59.0s)
```
node checks/repeat.mjs 5 server src/__tests__/instance-settings-routes.test.ts
```
```
k (file:///C:/Development/Todero/node_modules/.pnpm/@vitest+spy@4.1.10/node_modules/@vitest/spy/dist/index.js:332:34)
              at publishActivitiesBestEffort (C:/Development/Todero/server/src/routes/instance-settings.ts:74:7)
              at C:/Development/Todero/server/src/routes/instance-settings.ts:398:9
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
Â·Â·Â·Â·Â·

 Test Files  1 failed (1)
      Tests  1 failed | 49 passed (50)
   Start at  23:15:16
   Duration  15.58s (transform 6.01s, setup 113ms, import 133ms, tests 15.18s, environment 0ms)
```

### `improvement_loop` — exit 1 (2401.3s)
```
python checks/improvement-loop.py
```
```
 {
    "ZZGAAAAAAAAAAAAAAAA-1": "done",
    "ZZGAAAAAAAAAAAAAAAA-4": "done",
    "ZZGAAAAAAAAAAAAAAAA-5": "done",
    "ZZGAAAAAAAAAAAAAAAA-3": "done",
    "ZZGAAAAAAAAAAAAAAAA-2": "done"
   }
  }
 },
 "humanTouches": {
  "answers_before_plan": 1,
  "approves": 1,
  "lazy_replies": 0,
  "hand_accepts": 0
 },
 "askedForPredecessorOutput": [],
 "noise": [],
 "final": {
  "ZZGAAAAAAAAAAAAAAAAAA-5": "blocked",
  "ZZGAAAAAAAAAAAAAAAAAA-4": "done",
  "ZZGAAAAAAAAAAAAAAAAAA-3": "done",
  "ZZGAAAAAAAAAAAAAAAAAA-2": "done",
  "ZZGAAAAAAAAAAAAAAAAAA-1": "blocked",
  "ZZGAAAAAAAAAAAAAAAAAA-6": "todo"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. **1 regression(s)** — unit_ui. Something this wave changed broke something that worked. Rank this first.
1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 24 add, and what should it stop checking?
