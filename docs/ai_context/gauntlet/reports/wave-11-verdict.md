# Wave 11 verdict

Written by the session from the report.

## 1. Which failures share a root cause

**Item 3 is done.** `item3_board_reorder` passes, the Board suites pass, and on the running
product dragging TAM-8 above TAM-7 in the Queued lane moved the card and said "TAM-8 is now
critical priority." The live loop passed again, and neither known flake showed this time.

**`item2_wizard_window` is red only because this branch was cut before item 2 merged** (PR 97 is
on main now); the check passes there. **Item 4** is red by design.

**Found on the way, fixed here**: a full navigation to `/board` read "board" as an organization
prefix and showed "Organization not found", and the sidebar's Board link went nowhere. "board"
joins the pages that live under the organization's prefix.

## 2. What wave 12 should add, and stop

**Add** nothing; **stop** nothing. Item 4 is next: a person's send-back as one call.
