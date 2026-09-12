# Wave 8 verdict

Written by the session from the report.

## 1. Which failures share a root cause

**The live loop passed for the first time.** Plan, four tasks, reviews, wrap-up, project completed,
feature goals achieved, no handoff wake, inside the budget, with a reviewer send-back on the way:
the second hand-in landed as revision two of its Output document instead of failing. Nothing on
this branch changed the loop except that.

**`item1_skill_rows` is red only because this branch was cut before item 1 merged** (PR 95 is on
main now); the check passes there.

**`item5_task_drain_stable` failed locally for the first time**: one run in five of
`instance-settings-routes.test.ts` failed in `publishActivitiesBestEffort`, right after the live
loop had kept the machine busy. Until now the flake had only shown on the GitHub runner. That is
item 5's evidence, and it says the cause is load, not the runner: the repeat is worth keeping.

**Items 2, 3 and 4** are red by design.

## 2. What wave 9 should add, and stop

**Add** nothing for this branch; it is done. Item 2 is next (the window hint, and a reply cut off
at the window reported as cut off).

**Stop** nothing. The task-drain repeat earned its place this wave.
