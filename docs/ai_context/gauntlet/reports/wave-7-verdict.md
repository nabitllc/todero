# Wave 7 verdict

Written by the session from the stored runs and the revision turn's own log.

## 1. Which failures share a root cause

**Item 1 is done**: `item1_skill_rows` passes, and on the running product the skill's page shows
"Version 1", "Last changed because: Shipped with the skill pack." and a "Reset to the original"
button that, pressed, rewrote the line to "Reset to the original" and refreshed the page.

**The unit_ui regression was this branch's, and is fixed.** Four `SkillDetailPage settings` tests
render the page without a query client; the first placement of the meta line used a query hook
inside the page. The refresh now comes in as a callback from the parent. The suite passes again.

**The live loop's two failures are one cause, and it is not item 1's.** The reviewer sent the
first task back once; the worker's second hand-in then failed with
`Failed to apply the reply's disposition: Document update requires baseRevisionId`: the task's
Output document already existed from the first hand-in, and the second write asks for the
revision it builds on. The whole hand-in is dropped at that point (no status, no review, no
pre-write), so the successful-run handoff fired, posted "Todero needs you to choose what
happens next", and the worker answered that wake with a question. Every task that goes round the
reviewer once hits this. It belongs with item 0's promise ("no handoff wake") and is next.

## 2. What wave 8 should add, and stop

**Add** a repro for the second hand-in after a send-back (the Output document is updated, the
task lands in review, no handoff wake), on its own branch.

**Stop** nothing.
