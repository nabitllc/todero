# Wave 4 verdict

Written by the session from the stored runs and the check's own log.

## 1. Which failures share a root cause

**The product side of item 0 held.** The loop's four tasks were handed in and reviewed one after
another (turns of 18, 61, 89 and 129 seconds plus the reviewer each time), a question on the
first task was answered and the task then passed; the organization's seven turns all succeeded;
there was no continuation turn, no handoff wake and no system notice on any task. The
"no handoff re-wake" expectation passed for the first time.

**The live loop still failed, on its own budgeting.** The check waited on the first child for
five minutes but only reads a child once no turn is queued or running anywhere in the
organization, and every first task of the plan is queued at approval. Four serial turns took
until fourteen seconds after that budget. The retry then used up the loop's fixed number of
passes before the fourth task was accepted, so the wrap-up never came. The check now lets the
queue settle, acts on every child that is ready, and repeats until none is open (25-minute budget).

**The file-size regression is this branch's own growth**: the hand-in-before-review change added
sixteen lines to `heartbeat.ts`, the repo's standing outlier. The allowlist is refreshed to the
current tree; the debt of extracting the hand-in block out of that file is real and noted.

## 2. What wave 5 should add, and stop

**Add** nothing. Wave 5 is the confirmation wave for the fixed check.

**Stop** nothing.
