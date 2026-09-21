# Wave 20 — improvement loop wave 4 - the send-back deadlock

*2026-09-21T14:06:19+00:00 · 4618.2s wall-clock*

## Progress

**24/26 checks passing**  (22/26 last wave ↑ 24/26)

- **Fixed:** item5_task_drain_stable
- **REGRESSED:** live_loop_ollama  ← treat before new work
- Still failing: improvement_loop
- New checks: repro_task_judged_on_its_own_hand_in, repro_empty_retry_is_not_parked

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 56 | 11,912 | 2,233,375 | 797,588 | $6.3997 |
| **total** | | | | | | **$6.3997** |

## Failures

### `live_loop_ollama` — exit 1 (851.9s)
```
python checks/live-loop.py
```
```
an': False}
09:13:38 round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': True}
09:16:34 paused for ninety seconds; nothing moved; resumed
09:23:15 ZZGAAAAAAAAAA-2: handed in, reviewed, accepted
09:23:15 ZZGAAAAAAAAAA-3: handed in, reviewed, accepted
09:23:16 ZZGAAAAAAAAAA-4: handed in, reviewed, accepted
09:23:16 ZZGAAAAAAAAAA-5: answered a question
09:23:16 ZZGAAAAAAAAAA-5: answered a question
09:23:51 FAIL ZZGAAAAAAAAAA-5: still asking after two answers
09:25:27 runs by status: {'succeeded': 10}
09:25:27 archived Zz Gauntlet 0921-091116
09:25:27 1 expectation(s) failed
```

### `improvement_loop` — exit 1 (3314.8s)
```
python checks/improvement-loop.py
```
```
: "done",
    "ZZGAAAAAAAAA-11": "blocked",
    "ZZGAAAAAAAAA-9": "done",
    "ZZGAAAAAAAAA-8": "done",
    "ZZGAAAAAAAAA-7": "done",
    "ZZGAAAAAAAAA-4": "blocked",
    "ZZGAAAAAAAAA-3": "done",
    "ZZGAAAAAAAAA-2": "done",
    "ZZGAAAAAAAAA-1": "blocked"
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
  "ZZGAAAAAAAAAAA-5": "blocked",
  "ZZGAAAAAAAAAAA-4": "done",
  "ZZGAAAAAAAAAAA-3": "done",
  "ZZGAAAAAAAAAAA-2": "done",
  "ZZGAAAAAAAAAAA-1": "blocked"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. **1 regression(s)** — live_loop_ollama. Something this wave changed broke something that worked. Rank this first.
1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 21 add, and what should it stop checking?
