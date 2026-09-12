# Wave 14 verdict

Written by the session from the report and the organization's stored runs.

## 1. Which failures share a root cause

**The pause held.** With four tasks queued, Pause was pressed; three of them waited the whole
ninety seconds and started only after Play. The fourth had started two seconds before Pause and
finished on its own, handed in and was reviewed, which is the rule ("work already under way
finishes"). The check did not allow for that: it took its baseline the moment Pause was pressed
and then saw the finished turn's state change and comments as movement. The check now waits for
anything running to finish before it takes the baseline. Nothing in the product moved wrongly.

**The unit_ui regression is a load flake, not this branch's**: three `CompanyEnvironments` cases
in the settings page test failed under the wave; the file passes alone (4/4) and the whole UI
suite was rerun.

**Item 4's check turned green** because this branch was cut after PR 99 merged.

**Cost note.** The wave's cost table carries a `subagent:general-purpose` row from another
session's spend inside the window; the wave's own spend is the `main` and `auxiliary` rows.

## 2. What wave 15 should add, and stop

**Add** nothing; wave 15 confirms the corrected pause step. **Stop** nothing.
