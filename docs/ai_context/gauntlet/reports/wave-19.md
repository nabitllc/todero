# Wave 19 — improvement loop wave 3 - a parked task stays parked

*2026-09-21T08:22:24+00:00 · 4879.4s wall-clock*

## Progress

**22/24 checks passing**  (22/24 last wave → 22/24)

- **REGRESSED:** item5_task_drain_stable  ← treat before new work
- Still failing: improvement_loop
- New checks: repro_parked_task_stays_parked

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 64 | 13,378 | 1,736,353 | 742,363 | $5.8427 |
| **total** | | | | | | **$5.8427** |

## Failures

### `item5_task_drain_stable` — exit 1 (38.1s)
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
   Start at  03:47:18
   Duration  22.72s (transform 7.79s, setup 115ms, import 133ms, tests 22.31s, environment 0ms)
```

### `improvement_loop` — exit 1 (3308.4s)
```
python checks/improvement-loop.py
```
```
n\n- **Review Status:** The first guide for the Snake Plant (Sansevieria) has been finalized and formatted. It meets the criteria of being one page and ready for distrib"
  }
 ],
 "final": {
  "ZZGAAAAAAAAA-10": "done",
  "ZZGAAAAAAAAA-11": "blocked",
  "ZZGAAAAAAAAA-9": "done",
  "ZZGAAAAAAAAA-8": "done",
  "ZZGAAAAAAAAA-7": "done",
  "ZZGAAAAAAAAA-4": "blocked",
  "ZZGAAAAAAAAA-3": "done",
  "ZZGAAAAAAAAA-2": "done",
  "ZZGAAAAAAAAA-1": "blocked",
  "ZZGAAAAAAAAA-14": "todo",
  "ZZGAAAAAAAAA-13": "todo",
  "ZZGAAAAAAAAA-12": "todo",
  "ZZGAAAAAAAAA-6": "todo",
  "ZZGAAAAAAAAA-5": "todo"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. **1 regression(s)** — item5_task_drain_stable. Something this wave changed broke something that worked. Rank this first.
1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 20 add, and what should it stop checking?
