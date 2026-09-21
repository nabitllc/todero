# Wave 17 — improvement loop wave 2 - dependency hand-off

*2026-09-21T00:41:55+00:00 · 5240.2s wall-clock*

## Progress

**19/22 checks passing**  (17/22 last wave ↑ 19/22)

- **Fixed:** file_size_caps
- Still failing: unit_ui, live_loop_ollama, improvement_loop
- New checks: repro_dependency_handoff

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| subagent:workflow-subagent | claude-opus-5[1m] | 52 | 12,944 | 1,319,631 | 725,002 | $5.5149 |
| main | claude-fable-5-1 | 68 | 5,832 | 2,062,081 | 8,414 | $0.9761 |
| auxiliary | claude-fable-5-1 | 506 | 6 | 692,942 | 956 | $0.1977 |
| subagent:general-purpose | claude-sonnet-5 | 6 | 1,481 | 117,355 | 63,047 | $0.1959 |
| **total** | | | | | | **$6.8846** |

## Failures

### `unit_ui` — exit 1 (112.8s)
```
node checks/vitest.mjs ui
```
```
    Tests  3 failed | 5407 passed (5410)
   Start at  19:42:21
   Duration  111.69s (transform 156.92s, setup 12.10s, import 1143.41s, tests 321.02s, environment 734.51s)

[gauntlet] 3 failed:
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > omits the Local driver option and lists Sandbox before SSH
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > shows the Local driver option when editing an existing local environment
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > preserves sandbox config when re-selecting the same provider while editing
```

### `live_loop_ollama` — exit 1 (1497.8s)
```
python checks/live-loop.py
```
```
9:51:43 paused for ninety seconds; nothing moved; resumed
20:03:19 FAIL ZZGAAAA-2: the reviewer gave a verdict
20:03:20 ZZGAAAA-2: handed in, reviewed, accepted
20:03:20 ZZGAAAA-3: answered a question
20:03:20 ZZGAAAA-4: handed in, reviewed, accepted
20:03:20 ZZGAAAA-5: answered a question
20:06:46 ZZGAAAA-3: answered a question
20:06:46 ZZGAAAA-5: answered a question
20:10:17 FAIL ZZGAAAA-3: still asking after two answers
20:10:17 FAIL ZZGAAAA-5: still asking after two answers
20:11:46 runs by status: {'succeeded': 15}
20:11:46 archived Zz Gauntlet 0920-194648
20:11:46 3 expectation(s) failed
```

### `improvement_loop` — exit 1 (3319.1s)
```
python checks/improvement-loop.py
```
```
  "approves": 1,
  "lazy_replies": 0,
  "hand_accepts": 0
 },
 "askedForPredecessorOutput": [],
 "noise": [
  {
   "id": "8bd99a90-8bc0-47c6-a53a-19f8e47ec756",
   "issue": "ZZGAAAAA-1",
   "said": "Got it. Based on your requirements, here's the proposed plan:\n\nThis plan ensures that we have a clear process from research to final publication, with each step building on the previous one. Let me kn"
  }
 ],
 "final": {
  "ZZGAAAAA-2": "blocked",
  "ZZGAAAAA-1": "blocked",
  "ZZGAAAAA-7": "todo",
  "ZZGAAAAA-6": "todo",
  "ZZGAAAAA-5": "todo",
  "ZZGAAAAA-4": "todo",
  "ZZGAAAAA-3": "todo"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 18 add, and what should it stop checking?
