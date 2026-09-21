# Wave 21 — improvement loop wave 5 - the last step and the way back

*2026-09-21T18:41:08+00:00 · 5027.8s wall-clock*

## Progress

**27/28 checks passing**  (24/28 last wave ↑ 27/28)

- **Fixed:** live_loop_ollama
- Still failing: improvement_loop
- New checks: repro_last_task_judged_with_its_feature, repro_parked_task_gets_its_way_back

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 58 | 11,255 | 1,607,541 | 674,363 | $5.3002 |
| **total** | | | | | | **$5.3002** |

## Failures

### `improvement_loop` — exit 1 (3303.8s)
```
python checks/improvement-loop.py
```
```
"pass": false,
   "organization": "Zz Gauntlet Org 0921-092802",
   "final": {
    "ZZGAAAAAAAAAAA-5": "blocked",
    "ZZGAAAAAAAAAAA-4": "done",
    "ZZGAAAAAAAAAAA-3": "done",
    "ZZGAAAAAAAAAAA-2": "done",
    "ZZGAAAAAAAAAAA-1": "blocked"
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
  "ZZGAAAAAAAAAAAAAA-4": "blocked",
  "ZZGAAAAAAAAAAAAAA-3": "done",
  "ZZGAAAAAAAAAAAAAA-2": "done",
  "ZZGAAAAAAAAAAAAAA-1": "blocked",
  "ZZGAAAAAAAAAAAAAA-5": "todo"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 22 add, and what should it stop checking?
