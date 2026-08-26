# Piece: approval-surface (Wave 6, channel "Approval & Human-in-the-loop")

**Owner:** builder (this round)
**Channel:** Approval & Human-in-the-loop — 0/9 at the start of this round.

## The problem this piece exists to fix

Todero's stated shape is *"a 0 or 1 person business manager"*: agents do the
work, one human approves what matters. Before this piece the human was not
actually in the loop, for four separate reasons — each of which is observable
in the code that shipped before this round:

1. **No project scope.** `GET /api/inbox` had no `project` parameter at all,
   and `InboxTab` took no scope and read no scope. Every other destination in
   the app is scoped to a project (`ProjectScopeProvider`, `app/page.tsx`);
   the one surface where a human makes a binding decision was the only one
   that showed the whole fleet with no way to say which business the decision
   belonged to.

2. **A decision that vanishes.** The only record of a decision was the inbox
   row itself, mutated in place (`status` / `resolved_by` / `resolved_at` /
   `response_data`). A second PATCH on the same row silently overwrote the
   first. There was no append-only record of who decided what, when, or what
   it did.

3. **Silent success on a vanished target.** `INBOX_EFFECTS.ceiling_stop` and
   `INBOX_EFFECTS.loop_breaker_pause` both returned `{ ok: true, detail:
   '... not found — nothing to unblock' }` when the issue the request was
   about no longer existed. The operator saw a green, successful approval for
   an approval that did nothing to anything.

4. **A button that does not say what it approves.** The card showed
   `agent · type` and a JSON-ish context blurb. It never said what approving
   would *do*, and never said what refusing would leave in place.

## What ships

- `lib/approvals.ts` — the pure decision logic: the registry of what each
  request type does when approved and when refused, target resolution,
  project resolution, and the **preflight** that decides whether a decision
  may be recorded at all.
- `lib/__tests__/approvals.test.ts` — unit tests, weighted towards proving
  the preflight **refuses**, not only that it permits.
- `migrations/061_approval_decisions.sql` + `migrations/sqlite/061_approval_decisions.sql`
  — append-only `approval_decisions` audit table.
- `app/api/inbox/route.ts` — project-scoped GET, fail-closed PATCH, audit write.
- `app/api/inbox/decisions/route.ts` — GET the audit trail.
- `components/tabs/InboxTab.tsx` — rebuilt on `components/nav/Card.tsx`.
- `components/tabs/ApprovalCard.tsx` — one approval item.

---

## ACCEPTANCE

Every item below is observable by running a command or reading a rendered
string. "Rendered string" means text present in the DOM of
`/b/todero/p/limiglow/now/inbox`.

### A. The approval item says what it is

1. `lib/approvals.ts` exports `describeApproval(row)` returning an object with
   **all five** of: `question` (what is being asked), `agent` (which agent
   asked), `ifApproved` (what happens on approval), `ifRefused` (what happens
   on refusal), `approveLabel` (a button label that names the consequence).
   It also returns `refuseLabel` and `confirmRefuseLabel` for the refusal
   path. No field may be an empty string for any input row.

2. For `type: 'loop_breaker_pause'` with `context.last_issue_id` set,
   `approveLabel` names **both** halves of the real effect — the agent id and
   the issue — e.g. `Approve — un-pause builder and unblock TOD-9001`. For
   the same type with no `last_issue_id`, `approveLabel` names the agent only
   and does **not** claim an issue will be unblocked.

3. For a `type` with **no** registered effect, `describeApproval` returns
   `hasRegisteredEffect: false`, `approveLabel` is `null` (there is no approve
   button to render), and `ifApproved` states in plain words that approving
   would do nothing.

4. `components/tabs/ApprovalCard.tsx` renders, for every pending item, the
   literal labels `If you approve` and `If you refuse` followed by the
   corresponding strings from `describeApproval`. Verifiable by reading the
   page HTML.

### B. Built on the Card contract

5. `InboxTab` renders `components/nav/Card.tsx` (imported, not
   reimplemented) for both of its sections: `id="inbox-waiting"` and
   `id="inbox-decisions"`.

6. Each Card's `metric.value` is a number that came from the response body of
   a real request in this render — never a constant, never `items.length`
   where the server reported a different total.

7. Each Card's `source` prints the actual query string that produced the
   metric, including the project parameter — e.g.
   `GET /api/inbox?status=pending&project=Limiglow`.

8. When there is nothing waiting, the empty state **names the project**: the
   rendered string contains the project name (e.g. `Limiglow`) and does not
   read as breakage. When there is nothing waiting *and* rows existed
   fleet-wide that did not resolve to this project, the empty message states
   that count.

9. On a failed load the Card renders `ApiErrorBanner` **in place of** the
   body — no empty state and no rows are rendered in the same Card at the
   same time.

### C. Project scope, and it refuses rather than widens

10. `GET /api/inbox` **without** a `project` parameter returns a bare JSON
    array, byte-compatible with what it returned before this piece (the
    fleet-wide consumers — `app/page.tsx`, `components/InboxDrawer.tsx`,
    `components/SidebarNav.tsx`, `components/tabs/OverviewTab.tsx` — are not
    mine to change and must not break).

11. `GET /api/inbox?project=X` returns an envelope
    `{ data, total, has_more, scope: { project, matched, other_project, unresolvable } }`
    where the three scope counts sum to the number of rows examined.

12. A row whose project **cannot be resolved** (no `context.project`, no
    resolvable issue) is **excluded** from `data` when `project=X` is given,
    and counted in `scope.unresolvable`. Scoping never widens by falling back
    to "show it anyway".

13. `GET /api/inbox?project=` (empty value) is a `400`, not a silent
    fleet-wide answer.

### D. Fail closed

14. `PATCH /api/inbox` with a well-formed body and an id that does not exist
    answers a 4xx (not a 5xx). *(This is the existing acceptance check
    `inbox-approve-persists`; it must still pass.)*

15. `PATCH /api/inbox` with `status: 'approved'` on a request whose **target
    issue no longer exists** answers `409`, the inbox row stays `pending`,
    and the body's `error` names the missing target. It does **not** answer
    2xx with `ok: true`.

16. `PATCH /api/inbox` with `status: 'approved'` on a request **type with no
    registered effect** answers `422` and the row stays `pending`. Approving
    something with no consequence is refused, not recorded as an approval.
    (`denied` / `explained` / `timeout` are still accepted on such a type —
    refusal is always safe.)

17. `PATCH /api/inbox` on a row that is **already resolved** answers `409`
    and does not overwrite the existing decision.

18. Every refusal in 15–17 writes an `approval_decisions` row with
    `outcome = 'refused'` and a non-null `detail`. A refusal is part of the
    audit trail, not a silence.

### E. The decision persists and is visible afterwards

19. `migrations/061_approval_decisions.sql` and its sqlite twin create
    `approval_decisions`, append-only (no route ever UPDATEs or DELETEs it),
    and the file's header comment justifies why an audit table was needed
    rather than the inbox row alone.

20. `npm run db:migrate` applies 061 on the sqlite provider and is idempotent
    (a second run is a no-op).

21. A successful `approve` writes exactly one `approval_decisions` row with
    `decision='approved'`, `outcome='applied'` (or `'failed'` if the effect
    threw), and the effect `detail` the route actually produced.

22. A successful `deny` writes exactly one `approval_decisions` row with
    `decision='denied'`, `outcome='no_effect'`, and the human's reason in
    `human_reason`.

23. `GET /api/inbox/decisions?project=X` returns those rows newest-first, and
    the Inbox surface renders them under the `inbox-decisions` Card with the
    decision, who made it, and what it did.

### F. Honesty guards

24. `lib/__tests__/approvals.test.ts` contains at least four tests that assert
    a **refusal** (`ok: false`) — vanished issue target, unregistered type
    approved, already-resolved row, and missing agent id — and each fails if
    the corresponding guard is removed.

25. `npx tsc --noEmit` reports no errors introduced by this piece.

26. `node scripts/acceptance/run.mjs` reports no *new* failures relative to
    the baseline recorded in the builder report, and
    `inbox-approve-persists` still passes.

27. Every fixture row this piece inserts into `db.sqlite` for verification is
    deleted afterwards, and the deletion is confirmed by a count query in the
    builder report.

---

## Explicitly NOT in this piece

- `components/tabs/OverviewTab.tsx`'s "Needs you" card keeps its deliberately
  fleet-wide inbox leg. That file belongs to another piece. The effect of
  this piece on that inconsistency is reported, not fixed.
- `components/InboxDrawer.tsx` is a second, near-duplicate copy of the old
  inbox UI. It is not this piece's file; it keeps working because change 10
  preserves the unscoped response shape, but it does not gain the new
  surface. That duplication is a recorded defect, not a fixed one.
- Agent *existence* is not verified. Agent identity in this schema is a
  free-text column (`inbox.agent`), not a foreign key, so the preflight
  verifies the agent id is **present and non-empty** and says so in its
  wording. Only the issue leg is verified by a real row lookup.
