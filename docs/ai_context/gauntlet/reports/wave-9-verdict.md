# Wave 9 verdict

Written by the session from the stored runs and the turns' own logs.

## 1. Which failures share a root cause

**Item 2 is done on the checks**: `item2_wizard_window` and the new `item2_cut_off_reply` pass,
and every unit suite around them.

**The live loop's two failures are the second-hand-in bug, already fixed on main by PR 96.**
This branch was cut from main after item 1 merged and before PR 96 did, so it ran the loop
without that fix. Every `finish_successful_run_handoff` wake (four) sits right after a turn whose
log says `Failed to apply the reply's disposition: Document update requires baseRevisionId`,
the same line wave 7 found; the six `issue_blockers_resolved` wakes are the plan's `after` chain
re-waking tasks that could not hand in for the same reason; and the "still asking after two
answers" task is one of them. No reply on this loop was cut off (`toderoCutOff` never set), so
item 2's adapter change did not come into play here and changed nothing else.

Main is merged into the branch now; wave 10 runs the same tree with PR 96 in it.

## 2. What wave 10 should add, and stop

**Add** nothing; **stop** nothing. Wave 10 is the confirmation on the merged tree.
