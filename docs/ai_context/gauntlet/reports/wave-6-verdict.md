# Wave 6 verdict

Written by the session from the stored runs.

## 1. Which failures share a root cause

**The loop ran to the end.** Plan in two rounds, four tasks handed in and reviewed one after
another, the conversation closed with its wrap-up, the Onboarding project completed, the feature
goals achieved, ten turns all succeeded, no continuation turn, no handoff wake, no system notice.
Item 0's done-when lines are met.

**The one expectation that failed is not this item's.** The "One-page concept" task answered its
brief with the document and then read as a question, three times, so the check closed it by hand.
The three replies are identical, 1,672 characters, and end mid-word ("groups of fiv"): the model's
output hit the edge of its 4,096-token window (Ollama's default; the model was trained for 32,768)
before it could write the status line, so the half-reply carried no "done" and was treated as the
model waiting on the person. The adapter never reads the endpoint's `finish_reason`, so the run
row says `completed`. That is item 2 (the window is too small, and how to raise it), with one
addition for it: read `finish_reason`, and when it is `length`, say the reply was cut off rather
than posting the half as a question.

## 2. What the next wave should add, and stop

**Add** to item 2's checks: a reply with `finish_reason: length` is reported as cut off, not
handed back as a question.

**Stop** nothing. Item 0 closes here; the next wave belongs to item 1.
