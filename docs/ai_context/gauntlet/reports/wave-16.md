# Wave 16 — improvement loop wave 1 - baseline

*2026-09-20T21:55:12+00:00 · 5016.3s wall-clock*

## Progress

**17/21 checks passing**  (20/21 last wave ↓ 17/21)

- **REGRESSED:** unit_ui, file_size_caps, live_loop_ollama  ← treat before new work
- New checks: improvement_loop

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 1,614 | 174,229 | 39,134,766 | 217,738 | $22.8660 |
| auxiliary | claude-fable-5-1 | 3,542 | 86 | 5,441,380 | 11,231 | $1.6247 |
| **total** | | | | | | **$24.4907** |

## Failures

### `unit_ui` — exit 1 (111.6s)
```
node checks/vitest.mjs ui
```
```
    Tests  3 failed | 5407 passed (5410)
   Start at  16:55:41
   Duration  110.56s (transform 142.23s, setup 10.15s, import 1103.89s, tests 326.14s, environment 759.15s)

[gauntlet] 3 failed:
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > omits the Local driver option and lists Sandbox before SSH
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > shows the Local driver option when editing an existing local environment
  FAIL  src/pages/CompanySettings.test.tsx > CompanyEnvironments > preserves sandbox config when re-selecting the same provider while editing
```

### `file_size_caps` — exit 1 (0.3s)
```
node checks/file-size-caps.mjs
```
```
ap 400)
[file-size] GREW ui/src/components/work-item/work-item-model.ts: 524 lines (was 503, cap 500)
[file-size] GREW ui/src/components/work-item/WorkItemView.tsx: 579 lines (was 548, cap 400)
[file-size] GREW ui/src/pages/AgentDetail.tsx: 4531 lines (was 4525, cap 400)
[file-size] GREW server/src/services/companies.ts: 601 lines (was 598, cap 500)
[file-size] GREW server/src/services/heartbeat.ts: 21177 lines (was 21028, cap 500)
[file-size] NEW outlier server/src/todero/conversation-outcome.ts: 541 lines (cap 500)
[file-size] GREW packages/shared/src/index.ts: 2756 lines (was 2753, cap 500)
```

### `live_loop_ollama` — exit 1 (1278.6s)
```
python checks/live-loop.py
```
```
rs={'waiting': True, 'review': False, 'plan': False}
17:02:01 round 2: status=blocked markers={'waiting': True, 'review': False, 'plan': True}
17:04:57 paused for ninety seconds; nothing moved; resumed
17:15:48 FAIL ZZGAA-2: the reviewer gave a verdict
17:15:48 ZZGAA-2: handed in, reviewed, accepted
17:15:48 ZZGAA-3: handed in, reviewed, accepted
17:15:48 ZZGAA-4: answered a question
17:15:48 ZZGAA-5: handed in, reviewed, accepted
17:19:19 ZZGAA-4: handed in, reviewed, accepted
17:21:12 runs by status: {'succeeded': 10}
17:21:12 archived Zz Gauntlet 0920-165953
17:21:12 1 expectation(s) failed
```

### `improvement_loop` — exit 124 (3324.5s)
```
python checks/improvement-loop.py
```
```
timed out after 2700s
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. **3 regression(s)** — unit_ui, file_size_caps, live_loop_ollama. Something this wave changed broke something that worked. Rank this first.
1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 17 add, and what should it stop checking?
