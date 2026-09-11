# Wave 3 verdict

Written by the session from the stored runs, the server log and one rerun; the causes were
deterministic enough not to need a separate judge.

## 1. Which failures share a root cause

**The live loop's timeout and the noise on every child task are one cause; the UI flake is
another; the item checks are not failures.**

**One cause: the turn is stamped finished before its hand-in is applied, and the reviewer sits in
that gap.** The wave-2 fix held: the features-only plan was approved (turn two), four child tasks
started, and each one was handed in and passed by the reviewer. But each also collected a
"continuation" turn, a "choose what happens next" wake and two system notices, and the loop's
own budget ran out on the fourth task. The server log shows why: the worker's turn is written
`succeeded` (its `finishedAt` set) before the hand-in block runs, and the hand-in block asks the
reviewer, a model on this machine, before it writes the task's new status. The recovery sweep
runs every thirty seconds; on each child it found a finished turn on a task still `in_progress`
with no next step and queued `issue_continuation_needed` (16:26:07 for the first task, fifteen
seconds after its turn finished, while the reviewer was still thinking). That continuation turn
had nothing to do, so the successful-run handoff fired next, with its two notices. The fix on this
branch writes the hand-in (blocked, in review) before the reviewer is asked; the reviewer's accept
is the only thing that writes a second time. `repros/review-window.gauntlet.ts` drives a real
heartbeat turn with a loopback reviewer that records what the task said when it was asked: on main
it says `in_progress`, here it says `blocked` with the review marker. The live loop's check budget
also goes from twenty to forty-five minutes: a four-task plan with a reviewer on this machine
takes about six minutes per task, and the loop was on its fourth when the runner cut it off.

**The other cause: a UI test that is sensitive to load.** This time the wrapper named it,
`AgentToolsTab > preserves checkbox changes made after the last saved install state`, a different
test from wave 2's four, and one of one failure in 5370. Not this item's; a candidate for the
task-drain item (5), which is the same kind of thing on the CI runner.

## 2. What wave 4 should add, and stop

**Add** `repro_review_window` (done). Wave 4 is the confirmation wave for item 0: the whole loop
inside the budget, with no continuation turn, no handoff wake and no system notice on any child.

**Stop** nothing. The task-drain repeat stays as a control, as wave 1 decided.
