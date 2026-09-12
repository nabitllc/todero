# Wave 2 verdict

Written by the session from the stored runs and two reruns, not by a separate judge: both
failures had a deterministic cause that could be read off the evidence.

## 1. Which failures share a root cause

**None of them. Two separate things, and one of them is not a failure of the product.**

**The live loop stalled on its second turn because the parser threw the plan away.** The model
answered the person's brief with a plan block that named the goal and four features and stopped
before the tasks, twice in a row, each time ending "Do you approve this plan?". The stored result
of both turns carries the reply and `toderoDisposition: waiting` but no `toderoPlanBlock`: the
shared parser returns null for a block with no tasks, so the reply posted as plain prose, no Plan
document was written, no approval card appeared, and the task sat "waiting on you" with nothing
to approve. The instructions do ask for four to twelve tasks; a 14B model does not always obey.
This is not what item 0 set out to fix (the ten-minute floor held: every turn came back inside
75 seconds) but it is the same family, a healthy loop taken off the rails by ordinary variation in
what a local model writes. Fixed on this branch: a plan with features and no tasks becomes one
task per feature, handing in what the feature's `done_when` asks for. The reply from the loop,
word for word, is now `repros/plan-without-tasks.gauntlet.ts` (fails on main, passes here).

**The unit_ui "regression" did not reproduce.** Two full reruns of the UI suite on the same tree
passed 5370 of 5370, and the branch touches one UI file (the wizard's default timeout constant),
whose own tests pass. The wave lost the names of the four tests because the wrapper's dot
reporter prints them under the stack traces and the runner keeps only the last 600 characters.
The wrapper now ends every run with the `FAIL` lines, so the next flake is named. Treat it as
a flake under load until wave 3 says otherwise.

## 2. What wave 3 should add, and stop

**Add** `repro_plan_without_tasks` (done). Nothing else: the item 0 checks and the slow-turn repro
all passed, and the live loop is the check that matters for this item.

**Stop** nothing yet. The task-drain repeat stays one more wave as a control, as wave 1 decided.
