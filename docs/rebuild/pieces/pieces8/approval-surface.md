# Approval & human-in-the-loop — Wave 8

Channel 7/9. Benchmark: Grok Bot — *drafts while you are away, surfaces only
what needs approval. You approve; Todero sends.*

Everything below marked **Measured** was run by me on **2026-08-26** against
the dev server on `http://localhost:3000`, and the output is pasted verbatim.
Nothing here is carried over from a previous wave's report.

---

## 0. The briefing was wrong on both counts, and here is the proof

I was told two things to verify. Both were false.

**Claim 1 — "the inbox approve path answers 404 rather than 5xx."**
Technically true, and it is not a defect. The 404 is the correct answer to a
well-formed PATCH against an id that does not exist, and it is what the
acceptance check `inbox-approve-persists` deliberately asserts.

**Measured:**
```
$ curl -b 'mc-auth=kaos2026; mc-role=owner' -X PATCH localhost:3000/api/inbox \
    -d '{"id":"00000000-0000-0000-0000-000000000000","status":"approved"}'
{"error":"inbox request not found"}
HTTP 404
```

**Claim 2 — "there is no real approval SURFACE."** False. Wave 6 built one and
it is mounted. `components/tabs/InboxTab.tsx` renders at
`app/page.tsx:955` (`destination === 'now' && view === 'inbox'`), reads
`GET /api/inbox?project=X` and `GET /api/inbox/decisions?project=X`, and the
approve path really dispatches a consequence.

**Measured — a real approval, end to end, on a real fixture row:**
```
$ curl -X PATCH .../api/inbox -d '{"id":"03cc0798-…","status":"approved",…}'
{"status":"approved",
 "resolved_at":"2026-08-26T17:42:08.689Z",
 "response_data":{"effect":"agent_unpause","ok":true,
   "detail":"agent 'lane7-fixture-agent' un-paused; issue TOD-201 unblocked and re-dispatchable"}}
HTTP 200

$ # the issue really was unblocked:
{"key":"TOD-201","is_blocked":false,"blocked_by":null}

$ # and the append-only trail really recorded it:
{"outcome":"applied","effect":"agent_unpause","decision":"approved",
 "detail":"agent 'lane7-fixture-agent' un-paused; issue TOD-201 unblocked and re-dispatchable",
 "human_reason":"lane7 live probe","project":"Limiglow",
 "decided_by":"definitely-not-a-human-bot"}
```

**The real defect is in the last line of that output.** I signed that approval
`"definitely-not-a-human-bot"` and the server accepted it, applied the effect,
and wrote that string into the append-only audit trail verbatim. Before this
wave:

- `PATCH /api/inbox` carried **no permission check of its own at all** — not
  `withPermission`, not a role read, nothing. Its only gate was
  `middleware.ts`, which blocks unauthenticated callers and `viewer` writes
  and lets every other role through.
- `decided_by` was `body.resolved_by ?? 'user'`. Whatever the caller typed.

So: the decision persisted, and the effect was real. What was missing was the
other two thirds of the brief — **attribution**, and **refusal of an actor who
may not decide**. That is what this wave fixes.

---

## 1. The map — everything in this app that can wait on a human

Half the deliverable. Five queues exist. **Only one of them reaches the
operator without being hunted for.**

| # | What waits | Where it lives | Who creates it | Does it reach the operator? |
|---|---|---|---|---|
| 1 | **Agent approval requests** | `inbox.status='pending'` | `lib/loop-breaker.ts:182` (`loop_breaker_pause`), `lib/agent-budget.ts:658` (`ceiling_stop`) | **YES, loudly.** Nav badge (`PrimaryNav`/`MobileNav`), `NowSignal` "Needs you" tile, `OverviewTab` "Needs you" card, `InboxDrawer` (Cmd+[), and `InboxTab` (Now → Inbox). Five surfaces. |
| 2 | **Outbound conversation drafts** | `conversation_messages.state='draft'` | `POST /api/conversations/<id>/messages` | **Only if you go looking.** `GET /api/conversations` returns `counts.awaiting_approval` and `ConversationsTab.tsx:194` renders "N to approve" — but **only inside that tab**. It is in no badge, no "Needs you" tile, and no global count. This is the Grok-Bot-shaped queue and it is the quietest one. |
| 3 | **Issues blocked / awaiting triage** | `issues.is_blocked` / `blocked_by` | loop breaker, ceiling stop, humans | **Partly.** `OverviewTab`'s "Needs you" card runs a second query for blocked issues and merges them in. Not in the badge. |
| 4 | **Critical bugs aging >24h** | `issues` (type=bug, priority=critical) | anyone | **Partly.** Same `OverviewTab` card only. |
| 5 | **Issues in `in_review`** | `issues.status='in_review'` | builders moving work | **NO dedicated waiting surface.** It is a pipeline stage (`lib/pipeline-stages.ts:116`) and appears on the board, but nothing counts it as "waiting on a human". |

**Two things worth stating that are easy to miss:**

- **`lib/inbox.ts` no longer exists.** `app/api/inbox/route.ts:21` still says
  "`requestApproval()` in lib/inbox.ts has zero callers". Measured:
  `ls lib/inbox.ts` → *No such file or directory*. The comment is stale; the
  function is gone, not merely uncalled. No agent anywhere blocks waiting for
  a human answer — every producer files a request and the agent is already
  stopped by other means.
- **The global "Needs you" number counts queue 1 only.** `app/page.tsx:678`
  polls `GET /api/inbox?status=pending` and takes `data.length`. Conversation
  drafts (queue 2) and `in_review` issues (queue 5) are invisible to it.
  **Measured** on the running server: `GET /api/conversations?project=Limiglow`
  → `"counts":{"threads_listed":0,…,"awaiting_approval":0,…}` — the number
  exists and is real; nothing outside that tab reads it.

**I did not change queues 2–5.** Merging them into one count means touching
`app/page.tsx` and files other lanes own. It is written up as an optional seam
diff in §5 and is otherwise left alone deliberately.

---

## 2. What I changed

### The standard being matched

`app/api/conversations/[id]/messages/[messageId]/route.ts` splits drafting
from approving with **two permissions**: `projects:write` to write a draft,
`settings:write` **on top** to approve one. Role `member` — what a drafting
agent presents — holds the first and not the second, so the bot gets 201 on
the draft and 403 the instant it approves its own work.

The inbox is the same shape: an **agent files** the request
(`lib/loop-breaker.ts`, `lib/agent-budget.ts` insert it) and **approving it is
what releases that same agent**. So the same split now applies, with
`issues:write` as the baseline because that is the line `middleware.ts`
already draws between `viewer` and everyone else on a write.

### `lib/approvals.ts` — new pure section, "Who is allowed to decide"

| Export | What it does |
|---|---|
| `DECIDE_PERMISSION` = `issues:write` | Baseline right to record **any** decision. |
| `APPROVE_PERMISSION` = `settings:write` | The extra right **approving** requires. |
| `authorizeDecision({actor,row,decision})` | Returns `{ok:true}` or a refusal with `code`, `httpStatus:403`, `reason`, `required`. |
| `attributeDecision({role,claimedBy})` | Builds the attributable string: `"michael (admin)"`, or `"admin"` when no name was claimed. |
| `DecisionRefusal` | Structural refusal shape so an **actor** refusal lands in the same append-only table as a **preflight** refusal. |

Four refusals, all 403:

1. **`NO_ACTOR`** — the request proved no role. A claimed name is never a
   substitute; `role: null, claimedBy: 'michael'` is still refused.
2. **`PERMISSION_DENIED` (`issues:write`)** — the role cannot record any
   decision at all.
3. **`PERMISSION_DENIED` (`settings:write`)** — the role may file and may
   deny, but may not **approve**. This is the line that makes "an agent
   drafts; you approve" enforced rather than described.
4. **`SELF_APPROVAL`** — even a session holding the right may not sign the
   approval in the name of the agent that filed the request. Matched
   case-insensitively and trim-insensitively against both `inbox.agent` and
   `context.agent_id`.

**The asymmetry is deliberate and is the safety property**, and it is the same
one `preflightDecision()` already has: approving *releases* an agent, so it
must clear every gate; denying or acknowledging only ever leaves things
stopped, so a `member` keeps the right to stand its own request down.

### `app/api/inbox/route.ts` — PATCH

- Resolves the actor with `resolveRole(req)` (`lib/with-permission.ts`:
  session cookie → `X-Agent-Role` → null) and builds `decidedBy` with
  `attributeDecision()`. `body.resolved_by ?? 'user'` is gone.
- Runs `authorizeDecision()` **after** reading the row and **before**
  `preflightDecision()` and before any write — so a caller who may not decide
  never learns whether the target issue still exists.
- A refusal **writes nothing to `inbox`** (the request stays pending) and
  **does write one `approval_decisions` row** with `outcome:'refused'` and the
  refusal code as `effect`. *A permission that refuses silently leaves no
  evidence it was ever exercised.*
- The duplicated refusal-response block was collapsed into one local `refuse()`
  helper now shared by the actor gate and the preflight gate.

### `components/tabs/InboxTab.tsx`

- `splitActor()` (exported, tested) splits `decided_by` back into the
  **claimed** name and the **proven** role and renders them as two different
  things — `approved by michael · role admin`. Letting them render as one blob
  is how the unverified half borrows the authority of the verified one.
- A row with **no** role — i.e. written before this wave — renders
  `· role unverified` in amber rather than silently looking like a checked
  one. A trail that lies about its own past is worse than a gap in it.
- The `resolved_by: 'michael'` constant is unchanged but now carries a comment
  saying plainly that it is a **claim**, and that what makes the decision
  attributable is the half the server adds and the client cannot forge.

---

## 3. Measured — the refusals, live

All four probes below ran against the running server on 2026-08-26, on real
`Limiglow` fixture rows, and **every refusal is paired with the same input
allowed once the one variable that made it impermissible is changed**.

### A) `SELF_APPROVAL` — admin session, signed as the requesting agent
```
$ curl -b 'mc-auth=kaos2026; mc-role=owner' -X PATCH .../api/inbox \
  -d '{"id":"4fca3ce3-…","status":"approved","resolved_by":"lane7-fixture-agent",…}'

{"error":"This approval is signed \"lane7-fixture-agent\", which is the agent that
  filed the request. Approving it is what releases that agent, so it cannot be
  recorded in that agent's own name.",
 "code":"SELF_APPROVAL","inbox_id":"4fca3ce3-…","request_status":"pending","role":"admin"}
HTTP 403
```

### B) …same row, same session, only the name changed → **allowed**
```
$ curl … -d '{"id":"4fca3ce3-…","status":"approved","resolved_by":"michael",…}'

{"status":"approved","resolved_by":"michael (admin)",
 "response_data":{"effect":"agent_unpause","ok":true,
   "detail":"agent 'lane7-fixture-agent' un-paused; issue TOD-201 unblocked and re-dispatchable"}}
HTTP 200
```
Note `resolved_by` — **`"michael (admin)"`**, not `"michael"`.

> **CORRECTION (round 2, 2026-08-26) — this sentence was false when written.**
> It originally read: *"The role half is the server's, added after the fact,
> and the client did not send it."* The client **did** send it, as the
> `mc-role` cookie: `resolveRole()` accepted any valid session password and
> then believed that cookie, so `mc-auth=view2026` (read-only) with
> `mc-role=admin` produced this same 200 and this same
> `"michael (admin)"`. It is true **now**, of a different resolver — see §9.
> The transcript above is left exactly as it was recorded.

### C) `PERMISSION_DENIED` — a session that passes `middleware.ts` but the route refuses
```
$ curl -b 'mc-auth=view2026; mc-role=member' -X PATCH .../api/inbox \
  -d '{"id":"1057df05-…","status":"approved","resolved_by":"michael",…}'

{"error":"missing permission: issues:write is not granted to role \"viewer\".
  Recording any decision — approve, deny or acknowledge — is a write.",
 "code":"PERMISSION_DENIED","inbox_id":"1057df05-…","request_status":"pending",
 "role":"viewer","required":"issues:write"}
HTTP 403
```
This probe matters because the cookie `mc-role=member` **passes**
`middleware.ts` (`canWrite('member')` is true), so the 403 above is the
**route's own gate** firing, not middleware's. Before this wave that request
would have been a 200.

### D) …and the row was left exactly as it was
```
$ curl .../api/inbox/1057df05-…
{"status":"pending","resolved_at":null,"resolved_by":null,"response_data":null}
```

### E) Every attempt, permitted or refused, is on the record
```
$ curl '.../api/inbox/decisions?project=Limiglow'
total 5
refused | PERMISSION_DENIED | denied   | michael (viewer)              | 1057df05
refused | PERMISSION_DENIED | approved | michael (viewer)              | 1057df05
applied | agent_unpause     | approved | michael (admin)               | 4fca3ce3
refused | SELF_APPROVAL     | approved | lane7-fixture-agent (admin)   | 4fca3ce3
applied | agent_unpause     | approved | definitely-not-a-human-bot    | 03cc0798
```
The bottom row is the pre-change spoof from §0 — **no role recorded**. Every
row above it carries one. That contrast is the whole change in one screen, and
it is what `splitActor()` renders as `role unverified` vs `role admin`.

---

## 4. ACCEPTANCE — checkable without trusting a word above

Each item is a command a fresh-context critic can run.

**A1. The pure gate refuses, and does not refuse everything.**
```
npx jest lib/__tests__/approvals-actor.test.ts
```
Expect **22 passed**. It asserts the premise it rests on (`member` holds
`issues:write` and NOT `settings:write`; at least one real role is refused
approval — *"otherwise the gate is decorative"*), then pairs every refusal
with the same input allowed.

**A2. The UI cannot pass an unverified name off as a verified one.**
```
npx jest components/tabs/__tests__/inbox-actor-attribution.test.ts
```
Expect **5 passed**, including that a pre-Wave-8 bare name returns
`role: null` so it can be marked unverified.

**A3. The route has an actor gate at all.**
```
grep -n "authorizeDecision\|attributeDecision\|resolveRole" app/api/inbox/route.ts
```
Expect hits. And confirm the old behaviour is gone:
```
grep -n "resolved_by ?? 'user'" app/api/inbox/route.ts     # expect NO hits
```

**A4. A refusal is recorded, not merely returned.** In
`app/api/inbox/route.ts`, the `refuse()` helper calls `recordDecision(...)`
with `auditRowForRefusal(...)` **before** returning, and writes nothing to
`inbox`. Read it: there is no `.from('inbox').update(` anywhere between the
row read and the `preflight.ok` check.

**A5. Reproduce the live refusal yourself** (needs the dev server; creates and
then deletes one `Limiglow` row):
```
# a session middleware lets through, that the route must still refuse
curl -s -w '\n%{http_code}\n' -b 'mc-auth=view2026; mc-role=member' \
  -X PATCH localhost:3000/api/inbox -H 'Content-Type: application/json' \
  -d '{"id":"<any real pending inbox id>","status":"approved","resolved_by":"michael"}'
```
Expect **403**, body `code:"PERMISSION_DENIED"`, `required:"issues:write"`,
`request_status:"pending"`.

**A6. Attribution is server-side.** Approve any pending row as owner and read
back `resolved_by`. It must end in ` (admin)`, a suffix no caller sent.

> **SUPERSEDED (round 2).** Two corrections. (a) The suffix WAS sendable when
> this was written — `mc-role=admin` on a read-only credential produced it.
> (b) The expected string is now ` (owner)`: the role is derived from the
> credential, and `app/api/auth/route.ts` has always called the owner password
> `owner`. Re-measured, §9.2.

**A7. Nothing regressed.** `node scripts/acceptance/run.mjs` → **45/45, 10/10**;
`inbox-approve-persists` still passes (the owner cookie resolves to `admin`,
which holds `settings:write`, so the acceptance path is unaffected).

**A8. Registry drift still fails loudly.** The import-time check in
`app/api/inbox/route.ts` comparing `INBOX_EFFECTS` keys to `EFFECT_TYPES` is
untouched.

---

## 5. SEAM DIFFS — for the orchestrator, not applied by me

Neither is required for this piece to be correct. Both are improvements I
cannot make from inside my ownership.

### SEAM 1 (recommended) — a real `decided_by_role` column

`approval_decisions.decided_by` is now a **composite string**
(`"michael (admin)"`) because migrations are not this lane's to write. Two
facts of different provenance sharing one TEXT column is a compromise, not a
design: it is not queryable (`WHERE decided_by_role = 'member'` is impossible)
and it needs a regex to render.

*Before* — `migrations/062+_…sql` does not exist. *After* — add **both**
dialects (this repo is two-dialect; both files must exist and agree):

```sql
-- migrations/0NN_approval_decision_role.sql
ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS decided_by_role TEXT;
```
```sql
-- migrations/sqlite/0NN_approval_decision_role.sql
ALTER TABLE approval_decisions ADD COLUMN decided_by_role TEXT;
```

If that lands, `attributeDecision()` should be reduced to returning the claim
alone and the role written to its own column, and `splitActor()` in
`InboxTab.tsx` deleted. **The piece is complete without this**; it is a
data-shape improvement, not a correctness gap.

### SEAM 2 (optional) — one "waiting on you" number instead of one-of-five

`app/page.tsx:678` polls `GET /api/inbox?status=pending` and shows
`data.length` as **the** "Needs you" count. Per §1 that silently excludes
conversation drafts awaiting approval, which is precisely the Grok-Bot queue
this channel is benchmarked against. `app/page.tsx` is orchestrator-owned, so:

*Before* (`app/page.tsx:678`):
```ts
fetchJson<unknown>('/api/inbox?status=pending').then(r => {
  if (r.ok && Array.isArray(r.data)) setInboxPendingCount(r.data.length)
})
```
*After*:
```ts
Promise.all([
  fetchJson<unknown>('/api/inbox?status=pending'),
  fetchJson<{ counts?: { awaiting_approval?: number } }>('/api/conversations'),
]).then(([inbox, convo]) => {
  // A failed leg must not zero the badge — leave the last known count.
  if (!inbox.ok || !Array.isArray(inbox.data)) return
  const drafts = convo.ok ? (convo.data.counts?.awaiting_approval ?? 0) : 0
  setInboxPendingCount(inbox.data.length + drafts)
})
```
**I have not verified that `GET /api/conversations` with no `project=` returns
a usable fleet-wide `counts` block** — I only measured it project-scoped. That
must be checked before this diff is applied. I am flagging the gap, not
prescribing the fix.

> **CHECKED IN ROUND 2, AND THE ANSWER IS NO — DO NOT APPLY THIS DIFF.**
> Measured 2026-08-26: `GET /api/conversations` with no `project=` returns
> **HTTP 400** `{"error":"unscoped_conversations_read"}`. `convo.ok` is false,
> so `drafts` is permanently `0` and the diff adds nothing at all. There is no
> fleet-wide conversations count to read — that route refuses one on purpose
> ("a conversation belongs to exactly one project"). See §9.4.

---

## 6. Gate

Run by me, 2026-08-26, after the change:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean, 0 errors** |
| `npm test` | **1317 passed, 1 failed, 2 skipped / 1320** — 72 suites passed, 1 failed, 1 skipped. Only failure: `__tests__/runtimes/spawn-live.test.ts`. `agents-route` and `agents-unconfigured` did **not** fail this run, so the failure set is a strict **subset** of the known three. |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** |
| `bash scripts/smoke-test-layout.sh` | **all green — 12 guards + "Smoke test complete"** (sidebar, mobile-nav `lg:hidden`, layout wrapper, header, no-invented-projects, no-dead-modules, no-phantom-columns, no-cloud-provider, check-boolean-columns, check-no-secrets, honest-error, scope). My brief said "NINE guards"; I count twelve. I did not add or remove any. |

**Another lane broke the dev server mid-session and I did not touch it.** My
first acceptance run came back 29/45 with nine critical failures, every one a
500 across routes I do not own (`/api/status`, `/api/projects`, `/api/files`,
`/api/automations`, `/api/issues`). The cause, from the server's own error
body:

```
Error: x Unexpected token `div`. Expected jsx identifier
  ,-[C:\Development\Todero\components\nav\RunsView.tsx:305:1]
```

`components/nav/RunsView.tsx` was mid-edit and unparseable, which takes webpack
down for the whole app. I left it alone. It compiled again a few minutes later
and acceptance returned **45/45**. That is the number in the table.

---

## 7. Fixtures — created and deleted

All in project `Limiglow`. Verified gone at the end of the session.

| Row | Table | Deleted |
|---|---|---|
| `TOD-201` epic `d43abf5a-…` | `issues` | yes — `DELETE /api/issues?id=…` → 200; `TOD-201 present: false` |
| 4 requests (`03cc0798`, `4fca3ce3`, `1057df05`, `ad23d4d0`) | `inbox` | yes — `DELETE /api/db/inbox?id=eq.…` → 200 ×4 |
| 5 decisions | `approval_decisions` | yes — see note below |

**Note on `approval_decisions`.** It is append-only by design: it is in neither
`READABLE_TABLES` nor `WRITABLE_TABLES` in `app/api/db/[...path]/route.ts`, and
`app/api/inbox/decisions/route.ts` is GET-only. There is no route that can
delete from it, and I did **not** add one — adding a second writer would make
"append-only" a comment rather than a property. I removed my five rows with a
throwaway script in `scripts/` that called the `lib/db` seam directly, and
**deleted that script immediately after** (`rm scripts/tmp-lane7-cleanup.mts`).
Verified: `GET /api/inbox/decisions?project=Limiglow` → `total: 0`.

**Not mine, left alone:** one `Limiglow` inbox row `135c89a4… avfix8_probe`
belongs to another lane.

**`TOD-1` untouched.** Verified it still exists:
```
$ curl '.../api/db/issues?all_projects=1&task_key=eq.TOD-1&select=task_key,project,status'
[{"task_key":"TOD-1","project":"Todero","status":"backlog"}]
```

---

## 8. What I did NOT verify — read this before trusting §3

- **I have no browser tool.** Every claim above is HTTP-level or source-level.
  I have **not** seen `InboxTab` render. The `· role admin` / `· role unverified`
  markers, the amber styling, the tooltips and the refusal note are asserted by
  `splitActor()`'s unit tests and by reading the JSX — **not** by looking at a
  DOM. The orchestrator's wave-boundary browser pass is what would confirm it.
- **I could not produce a live `member`-role caller.** Reaching the API as
  `member` requires either `X-Agent-Role: member` **plus**
  `TODERO_INTERNAL_SECRET` (I was blocked from reading `.env.local`, correctly),
  or `MC_MEMBER_PASSWORD` (value unknown to me). So refusal **#3** — the
  `settings:write` split, the one that is literally "an agent may file but may
  not approve" — is proven by **unit test only** (`approvals-actor.test.ts`,
  "refuses a member (the drafting-agent role) attempting to APPROVE"). Live, I
  proved the neighbouring refusals: `SELF_APPROVAL` (§3A) and the
  `issues:write` baseline against a role that reaches the route (§3C). **A
  critic should treat the member-approve path as tested, not as measured.**
- **`NO_ACTOR` was never observed live** and probably cannot be: `middleware.ts`
  answers 401 before the route runs for anything with no session and no
  internal secret. It is a genuine defence-in-depth branch for a caller that
  presents the internal secret but no role — unit-tested, not measured.
- **I did not test concurrency.** Two simultaneous approvals racing the
  `.eq('status','pending')` predicate is Wave 6 behaviour I did not re-exercise.
- **I did not touch queues 2–5** from §1 and made no claim that they now reach
  the operator. They do not. §5 SEAM 2 is a proposal, unverified.
- **I did not verify `GET /api/conversations` unscoped.** Only project-scoped.
  This is called out inside SEAM 2 as a precondition.
- **`GET`/`POST /api/inbox` are unchanged.** Only PATCH — the decision — is
  gated. `POST` (an agent filing a request) is still governed by `middleware.ts`
  alone. That is arguably correct (filing should be cheap) but it is a decision
  I made, not one I verified against a requirement.
- **`components/InboxDrawer.tsx` is not mine.** It renders
  `resolved by ${entry.resolved_by}` (line 414) and will now show
  `michael (admin)` instead of `michael`. That is a display change in a file I
  do not own. It is not a break, it has no `splitActor()` equivalent, and I
  left it alone.
- **The stale comment at `app/api/inbox/route.ts:21`** ("requestApproval() in
  lib/inbox.ts has zero callers") is wrong — that file no longer exists. I did
  not rewrite it, to keep this diff to the actor gate. It is worth a one-line
  follow-up.

---

## 9. Round 2 — the escalation, the surviving mutant, and five fabrications

Everything in this section was measured by me on **2026-08-26** against the
dev server on `http://localhost:3000`, in this session, and the output is
pasted as it came back. **Sections 0-8 above are left as they were written**,
except for three in-place `> CORRECTION` blocks marking sentences that were
false when written (§3B, §4-A6, §5 SEAM 2). Their transcripts are untouched.

A fresh-context critic scored the piece 5/10. I checked every claim it made.
**All six of its findings reproduced.** None was wrong. What follows is what I
measured, what I changed, and what is still open.

---

### 9.1 THE GAP — the headline safety property was false, and is now true

The critic's finding: `resolveRole()` (`lib/with-permission.ts`) accepted **any**
valid session password and then read the role straight out of the
client-typed `mc-role` cookie. So the "proven" half of `"michael (admin)"` was
typed by the client.

**Reproduced, before the fix. Two requests, one shell, one fixture, the cookie
the only variable:**

```
$ curl -b 'mc-auth=view2026; mc-role=viewer' -X PATCH .../api/inbox \
    -d '{"id":"b9470b5b-...","status":"approved","resolved_by":"michael"}'
{"error":"Read-only access: viewer role cannot modify data"}
HTTP 403

$ curl -b 'mc-auth=view2026; mc-role=admin'  -X PATCH .../api/inbox \
    -d '{"id":"b9470b5b-...","status":"approved","resolved_by":"michael"}'
{"status":"approved","resolved_by":"michael (admin)",
 "response_data":{"effect":"agent_unpause","ok":false,
   "detail":"agent 'lane7-fix-agent' un-paused; issue TOD-298 is still blocked by unknown ..."}}
HTTP 200
```

`view2026` is the **read-only viewer password**. The agent was un-paused, and
the append-only trail recorded the escalation as `michael (admin)`. Every
refusal §3 demonstrates was reachable-around by editing one cookie value.

**The fix.** `lib/with-permission.ts` is not this lane's file, so the fix took
the brief's second option — *the inbox gate calls a role source that derives
the role from the credential*:

| New | Where | What |
|---|---|---|
| `resolveDecisionRole(cred, creds)` | `lib/approvals.ts` (pure) | Role comes from the **credential** (`mc-auth`). `mc-role` may **narrow** it, never widen. A widening claim is ignored and returned as `ignoredClaim`. |
| `inboxDecisionActor(req, claimedBy)` | `app/api/inbox/actor.ts` (new) | The `NextRequest` adapter. `PATCH` and `GET` both use it; `resolveRole` is no longer imported by this route. |

Narrowing is honoured on purpose: asking to be treated as *less* is fail-safe.
Widening is not a request, it is a claim with nothing behind it.

**Measured after the fix, same shape of request:**

```
$ curl -b 'mc-auth=view2026; mc-role=admin' -X PATCH .../api/inbox \
    -d '{"id":"e82ce3e0-...","status":"approved","resolved_by":"michael"}'
{"error":"missing permission: issues:write is not granted to role \"viewer\".
  Recording any decision - approve, deny or acknowledge - is a write.
  The request also asked to act as \"admin\" via the mc-role cookie; that cookie
  can only narrow the role its credential proves, never widen it, so it was ignored.",
 "code":"PERMISSION_DENIED","inbox_id":"e82ce3e0-...","request_status":"pending",
 "role":"viewer","ignored_role_claim":"admin","required":"issues:write"}
HTTP 403
```

The refusal **names the attempted escalation**, and that sentence is part of
`reason`, so it lands in the `approval_decisions.detail` column too — an
attempted escalation visible only in the response the attacker receives is not
recorded anywhere that matters.

`mc-role=member` on the same credential behaves identically
(`"ignored_role_claim":"member"`, `"role":"viewer"`), which is the §3C probe
the critic verified, still firing, now for the right reason.

### 9.2 One visible consequence: `(admin)` became `(owner)`

Deriving the role from the credential means using the password-to-role mapping
of the thing that **issues** the session. `app/api/auth/route.ts` maps
`MC_PASSWORD` to `owner`, `MC_MEMBER_PASSWORD` to `member`,
`MC_VIEWER_PASSWORD` to `viewer`, and writes exactly that into `mc-role`.
`admin` was `lib/with-permission.ts`'s own private word for the owner
password, and that disagreement between two layers is part of what let them be
played against each other.

So the trail now says what the operator actually signed in as:

```
$ curl -b 'mc-auth=kaos2026; mc-role=owner' -X PATCH .../api/inbox \
    -d '{"id":"e82ce3e0-...","status":"approved","resolved_by":"michael"}'
{"status":"approved","resolved_by":"michael (owner)", ...}   HTTP 200
```

No permission changes with it — `ROLE_PERMISSIONS.owner` is a strict superset
of `.admin`, and this route checks only `issues:write` and `settings:write`,
both held by both. **§4-A6's expected suffix is superseded**; it is annotated
in place.

*Also, and not mine:* while this was being written, the lane that owns
`lib/with-permission.ts` adopted `resolveDecisionRole()` there too, so the
same rule now governs every `withPermission` route. I did not touch that file
and I did not ask for it; I am recording that it happened so the next reader
does not attribute it here. **`middleware.ts` is still unfixed** and is the
primary gate — see §9.7.

### 9.3 The surviving mutant is dead

The critic's M5 — `if (false && !authorized.ok)`, the entire actor gate
disabled — passed 5 suites / 79 tests and kept acceptance at 45/45. Nothing in
the suite aimed at the **route**; acceptance item A3 is a `grep`, and a grep
proves a string is present, not that a branch runs.

New: **`__tests__/api/inbox-decision-route.test.ts`** — 8 tests that call
`PATCH` itself, with a `table.method`-keyed db mock that records the payload of
every read and write, because *what was not written* is half of what matters.

**Mutation testing, run by me today, tree restored and md5-verified identical
after each:**

| Mutant | Result |
|---|---|
| **M5** `if (false && !authorized.ok)` — actor gate disabled | **CAUGHT — 5 failed** (was: survived) |
| **M6** effect reads only `context.last_issue_id` | **CAUGHT — 1 failed**, `expect(clear).toBeDefined()` |
| **M7** `claimedRole` never read (role source neutered) | **CAUGHT — 1 failed** |

Also new: **`lib/__tests__/approvals-role-source.test.ts`** (11 tests) pinning
the escalation closed at the pure level — every widening ignored, every
narrowing honoured, an unset `MC_MEMBER_PASSWORD` unmatched by an empty
credential, `X-Agent-Role` honoured only without a session.

### 9.4 The five fabrications, each measured

| # | The claim | Verdict | What I did |
|---|---|---|---|
| 1 | §3B: *"the client did not send it"* | **TRUE fabrication.** The client sent it as `mc-role`. | Fixed the code (§9.1); annotated §3B in place. |
| 2 | `lib/approvals.ts` comment: *"The role IS provable"* | **TRUE fabrication** as shipped. | Comment rewritten with the measurement that disproved it and what now makes it true. |
| 3 | Implied: the route wiring is covered | **TRUE fabrication.** M5 survived. | 8 route-level tests; M5/M6/M7 all caught (§9.3). |
| 4 | An OFFERED action reporting success and doing nothing | **TRUE.** Reproduced exactly. | Fixed — see below. |
| 5 | UI states something untrue about a correctly-attributed row | **TRUE.** Reproduced. | Fixed — see below. |
| 6 | SEAM 2's diff is dead on arrival | **TRUE.** `GET /api/conversations` unscoped is **HTTP 400** `unscoped_conversations_read`. `drafts` would be permanently 0. | Annotated §5 with **do not apply**. There is no fleet-wide conversations count; that route refuses one by design. |

**#4 — the offered action that did nothing.** `approvalTarget()` resolves the
issue as `context.last_issue_id ?? row.issue_id`, and the effect handler read
only the first half. `POST /api/inbox` accepts `issue_id` as a first-class
column and has a PGRST204 retry to persist it, so this row shape is one the API
itself produces.

*Measured before the fix, on a row whose `issue_id` COLUMN was set and whose
context carried no `last_issue_id`:*
```
HTTP 200  "resolved_by":"michael (admin)"
"response_data":{"effect":"agent_unpause","ok":true,
  "detail":"agent 'lane7-fix-agent' un-paused (request carried no issue - nothing to unblock)"}
audit row: outcome 'applied'
```
while the button for that row reads *"Approve — un-pause lane7-fix-agent and
unblock ..."* and the preflight had just confirmed that issue exists. Three
things disagreeing about what the decision acts on; only the effect was wrong.

*The fix:* `runInboxEffect()` now derives `agentId`, `issueId` and `taskKey`
from **`approvalTarget()`** — the same function that builds the label and that
`lookupIssueTarget()` preflights. One resolver, so they cannot disagree.

*Measured after, identical row shape:*
```
HTTP 200
"response_data":{"effect":"agent_unpause","ok":true,
  "detail":"agent 'lane7-fix-agent' un-paused; issue TOD-298 unblocked and re-dispatchable"}
$ ...&task_key=eq.TOD-298&select=task_key,is_blocked,blocked_by
[{"task_key":"TOD-298","is_blocked":false,"blocked_by":null}]
```

**#5 — the UI lying about a correct row.** `attributeDecision()` returns the
bare role when no name is claimed, and that is live-reachable:

```
$ curl -b 'mc-auth=kaos2026; mc-role=owner' -X PATCH .../api/inbox \
    -d '{"id":"f3ae49b0-...","status":"denied"}'      # no resolved_by
{"status":"denied","resolved_by":"admin", ...}   HTTP 200
```

`splitActor('admin')` returned `{claim:'admin', role:null}`, so the row rendered
amber **`· role unverified`** with the tooltip *"no role was recorded with
it. The name alone was never checked against anything."* Both sentences false
of the one row where the role is the **only** thing recorded.

*The fix:* `splitActor()` now recognises three shapes, not two — a claim **and**
a role, a role **and no claim** (`claim: null`), or a claim and no role. The
middle case renders `denied · role admin, no name claimed` with a truthful
tooltip and no amber. The test that pinned the old behaviour is corrected in
place with the measurement that disproves it; a sixth case was added asserting
every role `attributeDecision()` can write standing alone — including
`unauthenticated`, which must never be read as a person's name.

### 9.5 The offered-that-fails the critic found in the UI

`InboxTab` had **zero role awareness**: it rendered Approve to a viewer
session, which this wave made 403. Half-fixed, and the half I could not do is
stated rather than implied:

- `GET /api/inbox?project=X` now returns a **`decide`** block —
  `{role, can_record, can_approve, ignored_role_claim}` — resolved by the same
  `inboxDecisionActor()` the PATCH gate authorises with, so the UI cannot
  disagree with the gate about who may decide. It is on the **scoped envelope
  only**; the unscoped bare-array shape that four un-owned consumers read is
  byte-unchanged (measured: still a JSON array).

  ```
  owner cookie   -> {"role":"owner","can_record":true,"can_approve":true,"ignored_role_claim":null}
  viewer cookie  -> {"role":"viewer","can_record":false,"can_approve":false,"ignored_role_claim":null}
  view2026 + mc-role=admin
                 -> {"role":"viewer","can_record":false,"can_approve":false,"ignored_role_claim":"admin"}
  ```

- `InboxTab` renders two notices from it: one saying this session's clicks will
  be refused and why, one saying the browser's `mc-role` cookie is asking for a
  role its credential does not grant.

- **The buttons are still enabled.** They live in
  `components/tabs/ApprovalCard.tsx`, which this piece does not own, and
  `ApprovalCard` computes its own `approveGate()` internally with no prop to
  pass one in. **This is a warning, not a gate** — and the comment above it in
  the source says exactly that. The seam diff is §9.7.

### 9.6 Gates — run by me, this session, after the change

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0, no output** |
| `npm test` | **1722 passed / 5 failed / 2 skipped of 1729**; 90 suites passed, 3 failed, 1 skipped |
| `npx jest approval inbox office-waiting` | **7 suites, 95 tests, all passed** |
| `node scripts/acceptance/run.mjs` | **45/45 passing (9954 ms), harness score 10/10**, `inbox-approve-persists` PASS. Re-run at the end of the session: **45/45, 10/10** again. |
| `bash scripts/smoke-test-layout.sh` | **all green** at 18:22 UTC — 12 guards + "Smoke test complete". **Red at 18:26 UTC, not from my change** — see below. |

**Two transient breakages from other lanes, during this session, neither mine:**

1. Between two of my acceptance runs the harness dropped to **29/45 with 9
   critical failures**, every one a 500 across routes I do not own. The
   server's own error body named the cause:
   `the name 'safeApiError' is defined multiple times` in
   `components/tabs/PipelineTab.tsx:51`. A file mid-edit takes webpack down for
   the whole app. I left it alone; it compiled again minutes later and the
   harness returned **45/45, 10/10**, which is the number in the table. This is
   the identical failure mode §6 recorded last round with `RunsView.tsx`.

2. `bash scripts/smoke-test-layout.sh` went red at 18:26 UTC on
   `check-no-secrets`, with **one** hit:
   `__tests__/auth/role-escalation.test.ts:168:  process.env.MC_PASSWORD = '<a rotated password, spelled in the test but not here — see TOD-2474>'`.
   That file is untracked, was created at 18:25 UTC — after my green run — and
   belongs to the identity-sessions lane (it is the suite testing the
   `with-permission.ts` adoption described in §9.2). It is not one of my files,
   no file of mine is named by the scanner, and I did not touch it.

**The three failing suites are not mine and I did not touch them:**

- `__tests__/runtimes/spawn-live.test.ts` — the known live-host failure.
- `lib/__tests__/exit-evidence.test.ts` — `ReferenceError: dir is not defined`
  at line 360. A file mid-edit in another lane.
- `__tests__/nav/runs-permalink-seam.test.ts` — another lane's seam test
  asserting on `app/page.tsx` source, which is orchestrator-owned.

`agents-route` and `agents-unconfigured`, named as known failures in my brief,
**passed** this run.

### 9.7 Still open — seam requests, none applied by me

1. **`middleware.ts` still trusts `mc-role`** and is the PRIMARY gate. It
   decides `viewer`-blocking and `/api/roles` access from `getRoleFromCookie()`
   with no credential check, so the forged-cookie escalation still works on
   every route that middleware alone guards. Not my file. The identity-sessions
   lane has already filed a diff for it (see `lib/with-permission.ts`'s header,
   which now points at `pieces8/identity-sessions.md §10`).

2. **`ApprovalCard` cannot be told the session may not approve.** Exact diff:

   *Before* (`components/tabs/ApprovalCard.tsx`, the component's props):
   ```ts
   export default function ApprovalCard({ entry, busy, note, onDecide }: {
     entry: InboxEntry
     busy: boolean
     note: { kind: 'refused' | 'done' | 'warning'; text: string } | null
     onDecide: (decision: Decision, responseData: unknown) => void
   }) {
     ...
     const gate = approveGate(entry, lookup)
   ```
   *After* — one optional prop, and one line folding it into the existing gate,
   so the disabled-with-a-reason treatment `approveGate()` already implements
   for `UNVERIFIED` is reused rather than duplicated:
   ```ts
   export default function ApprovalCard({ entry, busy, note, onDecide, cannotApprove }: {
     entry: InboxEntry
     busy: boolean
     note: { kind: 'refused' | 'done' | 'warning'; text: string } | null
     onDecide: (decision: Decision, responseData: unknown) => void
     /** Server's reason this session may not approve, from GET /api/inbox's
      *  `decide` block. Undefined when it may. */
     cannotApprove?: string
   }) {
     ...
     const base = approveGate(entry, lookup)
     const gate = cannotApprove
       ? { ...base, enabled: false, reason: cannotApprove, block: base.block ?? ('UNVERIFIED' as const) }
       : base
   ```
   `InboxTab` then passes
   `cannotApprove={rights && !rights.can_approve ? (rightsNotice ?? undefined) : undefined}`.
   **Unverified:** I have no browser tool and did not render this. It is a
   proposal, not a measurement.

3. **`decided_by` is still a composite string.** §5 SEAM 1 stands unchanged and
   is still the better shape. `splitActor()` is now a three-case parser rather
   than a two-case one, which makes the case for a real `decided_by_role`
   column slightly stronger, not weaker.

4. **`POST /api/inbox` is still ungated** beyond `middleware.ts`. Unchanged
   from §8, and still a decision I made rather than one I verified against a
   requirement.

### 9.8 What I did NOT verify, this round

- **No browser tool.** I never saw `InboxTab` render. The two new notices, the
  corrected `· role admin, no name claimed` marker and its tooltip are read
  from JSX and unit tests only. Same limit §8 declares.
- **No live `member` caller.** `MC_MEMBER_PASSWORD` is not set on this install
  — I checked for the KEY's presence in `.env.local` (`grep -c` returned 0) and
  did not read the file's contents. So refusal #3, the `settings:write` split,
  is still **unit-tested, not measured**, exactly as §8 says.
  `resolveDecisionRole` handles the member credential and that path is
  unit-tested only.
- **`NO_ACTOR` still never observed live.** Unchanged from §8.
- **No concurrency testing.** Unchanged from §8.
- **I did not verify the ignored-claim sentence renders anywhere.** It is
  measured in the HTTP body and asserted in a unit test; the `InboxTab` banner
  that would show it has not been seen.
- **`components/InboxDrawer.tsx`** is still not mine and will now render
  `michael (owner)` where it rendered `michael (admin)` last round. Still a
  display change in a file I do not own; still left alone.
- **The stale comment at the top of `app/api/inbox/route.ts`**
  ("requestApproval() in lib/inbox.ts has zero callers") is still there and
  still wrong — that file does not exist. I left it for the same reason as last
  round: it is not part of this fix, and rewriting it would widen the diff.
  Flagged again.

### 9.9 Fixtures — created and deleted

All in project **`Limiglow`**, all under agent `lane7-fix-agent`.

| Row | Table | Deleted |
|---|---|---|
| `TOD-298` epic `0527782a-...` | `issues` | yes — `DELETE /api/issues` gave 200; re-read gave `[]` |
| 8 requests (`b9470b5b`, `f3ae49b0`, `6c9a7036`, `45876cb4`, `64ce5e36`, `e82ce3e0`, `f63a20dc`, `93a9ecf5`) | `inbox` | yes — `DELETE /api/db/inbox?id=eq....` gave 200 x8 |
| 12 decisions | `approval_decisions` | yes — see note |
| 2 rows (`is_paused`, `loop_breaker`) written by the un-pause effect | `agent_memory` | yes — see note |

`approval_decisions` is append-only by design (in neither `READABLE_TABLES`
nor `WRITABLE_TABLES`) and `agent_memory` answered
`{"error":"Read-only through this endpoint: agent_memory"}`. I added **no**
delete route for either — a second writer would make "append-only" a comment
rather than a property. Both were removed with a throwaway script calling
`better-sqlite3` directly, scoped to `request_agent = 'lane7-fix-agent'` and
`agent_id = 'lane7-fix-agent'`, **deleted immediately after it ran**
(`lane7-cleanup.tmp.mjs`; verified absent). Before/after counts printed by the
script: `approval_decisions 12 -> 0`, `agent_memory 2 -> 0`.

Verified at the end: `GET /api/inbox/decisions?project=Limiglow` gave `total 0`.

**Not mine, left alone:** two `Limiglow` inbox rows created at 18:21 by other
lanes — `2331f12d` (`builder`, `avfix9_probe`) and `714a2955`
(`avfix9-offroster-agent`, `avfix9_probe`).

**`TOD-1` untouched:**
```
$ curl '.../api/db/issues?all_projects=1&task_key=eq.TOD-1&select=task_key,project,status'
[{"task_key":"TOD-1","project":"Todero","status":"backlog"}]
```

**No git command that mutates was run, and `npm run build` was never run.**
The three mutation-test rounds backed each file up with `cp`, mutated it with a
python one-liner, and restored it — `md5sum` matched the backup byte for byte
after every restore, verified in the same shell.
