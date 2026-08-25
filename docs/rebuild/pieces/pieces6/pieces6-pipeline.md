# PIECE: The pipeline must show a task's real state, sliceable by lane

id: pipeline-fidelity
lane: Operator

## Why this piece matters
The Pipeline is the screen an operator watches to answer "where is this task?"
Today it cannot answer that, by construction.

Verified 2026-08-25:
- `components/tabs/PipelineTab.tsx:11` defines SEVEN invented display stages —
  Backlog, Definition, Building, Testing, UX Review, PR Queue, Merged — while
  `lib/issue-lifecycle.ts` has ELEVEN real statuses: open, approved, in_progress,
  code_review, product_review, feature_review, underway, wrapped, released,
  closed, cancelled. There is no mapping between them.
- Column membership is decided by ad-hoc conditions inside the render, e.g.
  `stage === 'Testing' && issues.some(i => i.assignee === 'tester' && ...)`.
  So a card's column is a *guess about* its status, not its status.
- `PipelineTab.tsx:23` hardcodes a four-agent array — the same fabrication class
  already removed elsewhere in this reconstruction.
- `PipelineTab.tsx:471` filters on the status string `'completed'`, which does not
  appear in the lifecycle module at all — a permanently dead condition.

Swim lanes DO already exist and work: `components/tabs/BoardTab.tsx:242` supports
together / business / feature / sprint, persisted to localStorage. Do not rebuild
that. What is missing is a lane **by agent** — the one that matters for a fleet,
because it answers "what is each agent working through right now".

## Build instruction
1. Delete the seven invented stages. Columns are the real lifecycle statuses,
   read from `lib/issue-lifecycle.ts` — one column per status, in lifecycle order.
   If seven columns is the right *density* for a phone, group real statuses into
   named groups explicitly and show the underlying status on the card. A grouping
   is acceptable; an invention is not. A card must never appear in a column that
   contradicts its status.
2. Remove the hardcoded AGENTS array and the dead `'completed'` filter. Agents come
   from the roster.
3. Add `agent` to the existing swimlane union in BoardTab and reuse that mechanism
   in the Pipeline rather than writing a second one. One lane per agent, plus an
   unassigned lane. Preserve the localStorage persistence that is already there.
4. Every card shows its true status as text, not only by column position, so the
   two can never silently disagree.
5. Pipeline writes go through the MC API — the audit found this tab writing
   straight to Postgres with a browser-side key, bypassing the lifecycle validation
   that is the best code in the repo. That path must be gone.

## ACCEPTANCE — a critic will verify against the RUNNING app
1. `grep -n "Backlog\|Definition\|PR Queue" components/tabs/PipelineTab.tsx` -> no
   invented stage constant remains.
2. Every column header in the Pipeline corresponds to a status (or an explicitly
   named group of statuses) that exists in lib/issue-lifecycle.ts.
3. `grep -n "const AGENTS" components/tabs/PipelineTab.tsx` -> 0 matches.
4. `grep -n "'completed'" components/tabs/PipelineTab.tsx` -> 0 matches.
5. Switching the lane selector to "agent" groups rows by agent, with an unassigned
   lane, and the choice survives a reload.
6. Pick any issue, note its status from `GET /api/issues`, find it on the Pipeline:
   its column and its printed status agree.
7. The browser network panel during a drag shows a request to /api/issues and ZERO
   requests to any *.supabase.co host.
