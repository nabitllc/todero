# Wave 22 — improvement loop wave 6 - a worker that can only write

*2026-09-21T23:11:57+00:00 · 3196.4s wall-clock*

## Progress

**28/30 checks passing**  (27/30 last wave ↑ 28/30)

- **REGRESSED:** item5_task_drain_stable  ← treat before new work
- Still failing: improvement_loop
- New checks: repro_text_only_worker_judged_on_content, repro_parked_refusal_gets_a_fresh_review

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 26 | 5,032 | 621,556 | 417,371 | $3.0453 |
| **total** | | | | | | **$3.0453** |

## Failures

### `item5_task_drain_stable` — exit 1 (50.8s)
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
   Start at  18:35:22
   Duration  21.59s (transform 8.29s, setup 117ms, import 142ms, tests 21.17s, environment 0ms)
```

### `improvement_loop` — exit 1 (1691.2s)
```
python checks/improvement-loop.py
```
```
anization": "Zz Gauntlet Org 0921-140952",
   "final": {
    "ZZGAAAAAAAAAAAAAA-4": "blocked",
    "ZZGAAAAAAAAAAAAAA-5": "blocked",
    "ZZGAAAAAAAAAAAAAA-3": "done",
    "ZZGAAAAAAAAAAAAAA-2": "done",
    "ZZGAAAAAAAAAAAAAA-1": "blocked"
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
  "ZZGAAAAAAAAAAAAAAAA-1": "done",
  "ZZGAAAAAAAAAAAAAAAA-4": "done",
  "ZZGAAAAAAAAAAAAAAAA-5": "done",
  "ZZGAAAAAAAAAAAAAAAA-3": "done",
  "ZZGAAAAAAAAAAAAAAAA-2": "done"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. **1 regression(s)** — item5_task_drain_stable. Something this wave changed broke something that worked. Rank this first.
1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 23 add, and what should it stop checking?
