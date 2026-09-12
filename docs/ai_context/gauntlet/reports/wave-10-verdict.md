# Wave 10 verdict

Written by the session from the report and two reruns.

## 1. Which failures share a root cause

**Item 2 is done.** Both item 2 checks pass, and with PR 96 merged into the branch the live loop
on Ollama passed again: plan, four tasks, reviews, wrap-up, no handoff wake, inside the budget.
`repro_second_hand_in` joined the list and passes.

**The two regressions are the two known flakes, and both pass alone.** `AgentToolsTab >
preserves checkbox changes made after the last saved install state` is the same UI test that
failed in wave 3; rerun alone it passes (4/4). `item5_task_drain_stable` failed one run in five,
as in wave 8, right after the live loop had kept the machine busy; rerun alone it passes (50/50).
Both are load-sensitive tests, which is item 5's subject; neither touches item 2's files.

**Items 3 and 4** are red by design.

## 2. What wave 11 should add, and stop

**Add** nothing for item 2. Item 3 is next (a drop inside a Board column sets the task's
priority). Item 5 now has three local sightings (waves 8 and 10 here, and CI on PRs 95 and 96):
its wave should start from the `publishActivitiesBestEffort` line in the failure, not from CI.

**Stop** nothing.
