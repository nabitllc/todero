# Wave 18 — improvement loop wave 2b - deferred review on top of the hand-off

*2026-09-21T03:20:09+00:00 · 4783.5s wall-clock*

## Progress

**22/23 checks passing**  (19/23 last wave ↑ 22/23)

- **Fixed:** unit_ui, live_loop_ollama
- Still failing: improvement_loop
- New checks: repro_deferred_review

## Cost

| Actor | Model | In | Out | Cache read | Cache write | USD |
|---|---|---:|---:|---:|---:|---:|
| main | claude-fable-5-1 | 198 | 11,040 | 4,064,176 | 879,829 | $19.1666 |
| subagent:workflow-subagent | claude-opus-5[1m] | 46 | 8,196 | 1,003,521 | 680,694 | $4.9612 |
| auxiliary | claude-fable-5-1 | 1,012 | 34 | 960,582 | 1,005 | $0.2721 |
| **total** | | | | | | **$24.3999** |

## Failures

### `improvement_loop` — exit 1 (3309.3s)
```
python checks/improvement-loop.py
```
```
re_plan": 1,
  "approves": 1,
  "lazy_replies": 0,
  "hand_accepts": 0
 },
 "askedForPredecessorOutput": [],
 "noise": [
  {
   "id": "fbdc3398-a734-4f64-95de-aa317127e660",
   "issue": "ZZGAAAAAAA-1",
   "said": "Sure, let's move forward with the plan.\n\nThis plan outlines the necessary steps to create the four one-page guides, ensuring that each guide contains the required information and is well-written. Let "
  }
 ],
 "final": {
  "ZZGAAAAAAA-4": "todo",
  "ZZGAAAAAAA-3": "done",
  "ZZGAAAAAAA-2": "done",
  "ZZGAAAAAAA-1": "blocked",
  "ZZGAAAAAAA-6": "todo",
  "ZZGAAAAAAA-5": "todo"
 }
}
```

## What's next — judge

> **Not yet judged.** Everything above is deterministic and free. This section is the
> only part that needs a model, so it is the only part that costs anything to produce.

**Judge brief — the residue no check could score:**

1. Which of the failures share one root cause? Waves fix causes, not symptoms.
1. What should wave 19 add, and what should it stop checking?
