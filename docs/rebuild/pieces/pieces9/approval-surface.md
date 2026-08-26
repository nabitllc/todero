# Approval & human-in-the-loop — Wave 9

**Lane:** Approval & Human-in-the-loop (5/9)
**Owned files:** `app/api/inbox/**`, `components/tabs/InboxTab.tsx`, `lib/approvals.ts`,
this doc. Everything else named below is a **seam request**, not a change.
**Date of every measurement in this document:** 2026-08-26, against the running dev
server on `http://localhost:3000` and the checked-out tree, by me, in this session.
**No browser tool was available to this lane.** Every statement about pixels is
labelled as such; there are none that are not.

---

## 0. The one-sentence answer to the brief's question

> *"Start by establishing whether the role is provable NOW, end to end."*

**No — and the reason is not the one the previous wave wrote down.**

`PATCH /api/inbox` proves the role correctly. But `inbox.status` and
`inbox.resolved_by` have **two writers**, and the second one
(`PATCH /api/db/inbox`) resolves no role at all. Measured, one read-only
credential, one row, same shell, seconds apart:

```
Cookie: mc-auth=view2026; mc-role=owner        # view2026 is the READ-ONLY password

PATCH /api/inbox  {"id":"7b3b1c93-…","status":"approved","resolved_by":"lane5-spoof"}
  -> HTTP 403
     {"code":"PERMISSION_DENIED","role":"viewer","ignored_role_claim":"owner",
      "required":"issues:write","request_status":"pending"}

PATCH /api/db/inbox?id=eq.7b3b1c93-…
      {"status":"approved","resolved_by":"definitely-not-a-human-bot"}
  -> HTTP 200
     [{"id":"7b3b1c93-…","status":"approved",
       "resolved_by":"definitely-not-a-human-bot","resolved_at":null,…}]

GET /api/db/inbox?id=eq.7b3b1c93-…&select=id,status,resolved_by,resolved_at
  -> [{"status":"approved","resolved_by":"definitely-not-a-human-bot","resolved_at":null}]

GET /api/inbox/decisions?project=Limiglow
  -> {"data":[],"total":0,…}          # the successful write left NO audit row

DELETE /api/db/inbox?id=eq.<a second pending row>
  -> HTTP 200, row gone               # a pending approval request destroyed outright
```

So the critic's headline finding is **CONFIRMED, verbatim, by me**. `resolved_at`
came back `null` next to `status:"approved"` — a shape no gated writer can produce,
and one a `CHECK` constraint would have refused.

I could not fix it: `app/api/db/[...path]/route.ts` is not this lane's.
It is **SEAM-1** below, and it is expressed as a test that fails until the seam
lands and prints the diff — `__tests__/api/inbox-db-proxy-seam.test.ts`.

---

## 1. Verdict on every relayed claim

| # | Relayed claim | My verdict |
|---|---|---|
| BIGGEST GAP | `/api/db/inbox` bypasses the gate; DELETE too; no audit row | **CONFIRMED** — §0, reproduced end to end |
| M11 | InboxTab rights notice deletable with 88/88 still green | **CONFIRMED** — I applied the mutation myself, §3 |
| Uncaught | `mc-role=constructor` → 500 on three routes | **CONFIRMED and WORSE** — six prototype keys, not five (§4) |
| Fab. 1 | §9.1 "headline safety property … is now true" | **CONFIRMED false** |
| Fab. 2 | "the role is provable" / "the only half the server verified" | **CONFIRMED false of the column**; true of what `PATCH /api/inbox` writes. Comment rewritten |
| Fab. 3 | `resolveDecisionRole` "pure" but not total | **CONFIRMED**. Fixed and the docstring now says *total*, with a test that proves it |
| Fab. 4 | line-600 comment describes a branch the crash never reaches | **CONFIRMED**. Rewritten |
| Fab. 5 | "other `resolveRole()` callers" is stale and points at the wrong file | **CONFIRMED both ways** — `lib/with-permission.ts:121` already calls `resolveDecisionRole`. Both headers rewritten |
| Fab. 6 | SELF_APPROVAL is opt-in; omitting the name gets through | **CONFIRMED**, and **FIXED** (§2) |

**Where the critic is incomplete, not wrong** — three things it did not find, all
of which I did:

* **§4b — a one-request denial of service on the whole approval queue.** `inbox.type`
  is free text and reached a prototype lookup too. `POST /api/inbox` with
  `"type":"constructor"` returned **201**, and while that single row existed
  `GET /api/inbox?project=Limiglow` was **HTTP 500 for everybody** — including for
  the operator trying to load the queue in order to delete it. Recovered the instant
  the row was removed.
* **§3b — both InboxTab notices were invisible on an empty queue.** Found by
  rendering the component for the first time. `components/nav/Card.tsx:134` is
  `{isEmpty ? <p>{empty!.message}</p> : children}`, and both notices were children
  of the card. A viewer with nothing pending — and a browser carrying a forged
  `mc-role` — were told nothing at all. Not visible from reading `InboxTab.tsx`,
  because the suppression is in the other component.
* **§7 — the "Needs you" badge divergence, MEASURED.** The critic stated it from
  source and said it could not force it. I forced it with one row (§7).

---

## 2. What I changed

All four changes are inside this lane's ownership.

### 2.1 `lib/approvals.ts` — `resolveDecisionRole` is now TOTAL

`ROLE_PERMISSIONS` is an object literal, so `wanted in ROLE_PERMISSIONS` was true for
every member of `Object.prototype`; the value behind each is a function or
`Object.prototype`, and `isNarrowerOrEqual` then called `.every` on it.

**Before** (measured, valid read-only session, cookie the only variable):

```
mc-role=constructor    PATCH /api/inbox=500  GET /api/inbox?project=500  GET /api/conversations?project=500
mc-role=toString       500 / 500 / 500
mc-role=valueOf        500 / 500 / 500
mc-role=hasOwnProperty 500 / 500 / 500
mc-role=__proto__      500 / 500 / 500
mc-role=isPrototypeOf  500 / 500 / 500     <- the critic missed this one
mc-role=viewer         403 / 200 / 200     (control)
```

Every 500 had an **empty body**. Blast radius is every `withPermission` route,
because `lib/with-permission.ts:121` calls the same function.

**After** (same probes, same session, re-run today):

```
mc-role=constructor|toString|valueOf|hasOwnProperty|__proto__|isPrototypeOf
  GET /api/inbox?project=Limiglow      -> 200
  GET /api/conversations?project=…     -> 200
  PATCH /api/inbox on a REAL row       -> 403 PERMISSION_DENIED, role "viewer"
```

i.e. an unreadable cookie now resolves to exactly what the *credential* proves:
no crash, and no upgrade. New helper `isDefinedRole()` (own key **and**
`Array.isArray` on the value); `isNarrowerOrEqual` hardened with `Array.isArray`
instead of truthiness.

### 2.2 `lib/approvals.ts` — a request TYPE could crash the queue

Same class, different table column. `APPROVAL_KINDS[row.type]` at three call sites.
`inbox.type` is a plain `TEXT` column (`migrations/011_inbox.sql` — no CHECK, no FK).

**Before / after, measured on the real server:**

```
POST /api/inbox {"agent":"…","type":"constructor","project":"Limiglow"}
                                          -> 201 (both before and after)
GET  /api/inbox?project=Limiglow          -> 500 BEFORE  |  200 AFTER
PATCH …{"status":"approved",…}            -> 500 BEFORE  |  422 AFTER:
   {"code":"NO_REGISTERED_EFFECT","error":"No automated effect is registered for
    request type \"constructor\", so an approval here would change nothing…"}
PATCH …{"status":"explained",…}           -> 500 BEFORE  |  200 AFTER (acknowledging still works)
```

New helper `kindFor()`.

### 2.3 `lib/approvals.ts` — an approval must be signed (`UNSIGNED_APPROVAL`, 422)

The SELF_APPROVAL refusal was **opt-in**. Measured, one fixture, one owner session,
`resolved_by` the only variable:

```
{"id":…,"status":"approved","resolved_by":"lane5-self-agent"} -> 403 SELF_APPROVAL
{"id":…,"status":"approved"}                                  -> 200, agent released,
                                                                  trail records "owner"
```

The refused variant was the *more* attributable of the two. **This copies the repo's
own answer** rather than inventing one — `lib/conversations.ts`
(`validateMessageAction`) already returns
`422 'approve requires approved_by — an approval must record who made it'`.

It lives in `authorizeDecision()`, not in the route's early validation, so the
refusal is **recorded in `approval_decisions`** like every other refusal.
**Deliberately not gated:** `denied` / `explained` / `timeout`. Those only ever leave
the agent stopped, and requiring a signature there would push an operator toward
doing nothing.

**After, measured on one fixture, three requests:**

```
{"status":"approved"}                              -> 422 UNSIGNED_APPROVAL
{"status":"approved","resolved_by":"lane5-role-agent"}  -> 403 SELF_APPROVAL
{"status":"approved","resolved_by":"michael"}      -> 200, resolved_by "michael (owner)",
                                                       agent un-paused
```

Neither UI caller is affected: `components/tabs/InboxTab.tsx:196` and
`components/InboxDrawer.tsx:275` both always send `resolved_by: 'michael'`.
The acceptance check `inbox-approve-persists` sends no `resolved_by` and asserts
`< 500`; it still passes (404 on its bogus id, verified in the 45/45 run below).

### 2.4 `components/tabs/InboxTab.tsx` — the notices are hoisted above the cards

See §3b. Both notices moved out of the card body; the "can record nothing" wording
changed from *"The buttons below will be refused"* to *"Any decision recorded from
this session will be refused"*, since it no longer sits under any buttons.

### 2.5 Comment/doc corrections (a false comment is a defect in its own right)

* `lib/approvals.ts` "SCOPE OF THE FIX" block — rewritten. It claimed the remaining
  exposure was other `resolveRole()` callers; that is stale in both directions.
  It now names `app/api/db/[...path]/route.ts`, quotes `isViewer`, carries the
  measurement, and points at SEAM-1's test.
* `lib/approvals.ts` `attributeDecision()` docstring — *"the only half the server
  verified"* → *"the only half THIS FUNCTION'S CALLER verified"*, with the measured
  counter-example and the tell (a `resolved_by` with no parenthesised half was not
  written by this function).
* `lib/approvals.ts` `resolveDecisionRole()` docstring — "Pure" → "Pure AND TOTAL",
  with what "total" cost to learn.
* `app/api/inbox/actor.ts` header — same stale paragraph, replaced.

---

## 3. Mutation testing — M11 reproduced, then killed

**M11 reproduced on the shipped tree.** `components/tabs/InboxTab.tsx:234`,
`if (!rights) return null` → `if (true) return null`, deleting the entire rights
notice:

```
npx jest --no-cache InboxTab inbox approval approvals
  -> Test Suites: 6 passed, 6 total     Tests: 88 passed, 88 total
```

Root cause is exactly as relayed: nothing rendered the component.
`components/tabs/__tests__/inbox-actor-attribution.test.ts` was the only file naming
InboxTab and it imports the pure `splitActor()` export. `data-testid=
"inbox-rights-notice"` had **one** occurrence in the whole repo — the JSX line.

**Killed.** New suite `components/tabs/__tests__/inbox-rights-notice.test.tsx`
renders the component with `renderToStaticMarkup` (node env, `useApiData` and
`useProjectScope` mocked to return the payload the server would send). Re-applying
M11 with the new suite in place:

```
npx jest --no-cache InboxTab inbox approval approvals
  -> Test Suites: 1 failed, 6 passed    Tests: 5 failed, 109 passed, 114 total
```

Mutation restored; `md5sum` of `components/tabs/InboxTab.tsx` matched the
pre-mutation backup, and `grep -c M11` returned 0.

### 3b. The defect the new suite found on its very first run

All five notice assertions failed against the *unmutated* tree, and not for the
reason I expected. Rendered markup of the "Waiting on you" card body contained only
the `source` line and the empty message — no children at all. `components/nav/Card.tsx:134`:

```
{isEmpty ? <p className="text-white/45 text-xs">{empty!.message}</p> : children}
```

Both notices were children. So on the screen an operator sees most — a queue with
nothing in it — a viewer session was told nothing about its rights, and a browser
carrying `mc-role=owner` on a read-only credential was told nothing about the
forgery. Fixed in §2.4. Two cases now pin both halves (empty queue **and**
non-empty queue).

---

## 4. Everything I measured, with the commands

**Gate, in order, at the end of the session.**

```
npx tsc --noEmit
  -> exit 0, NO OUTPUT.   (Mid-session it printed 11 lines from
     components/office/OfficeCanvas.tsx and __tests__/work-ui-wiring.test.tsx —
     another lane mid-edit. Zero lines ever mentioned an approval-surface file;
     I re-ran filtered for approvals|inbox|InboxTab and got nothing.)

npm test
  -> Test Suites: 4 failed, 1 skipped, 103 passed, 107 of 108
     Tests: 10 failed, 2 skipped, 2176 passed, 2188 total
  A second run minutes later listed 7 failing suites. The set MOVES between runs —
  other lanes are editing. Failing suites seen: __tests__/fleet/fleet-provenance-seams,
  lib/__tests__/pipeline-no-phantom-columns, __tests__/agents-route,
  __tests__/runtimes/spawn-live, __tests__/auth/rate-limit-defaults,
  __tests__/runtimes/adapter-exit-record, and MINE:
  __tests__/api/inbox-db-proxy-seam (2 tests, DELIBERATE — see SEAM-1).
  At least two of the others (fleet-provenance-seams, pipeline-no-phantom-columns)
  are other lanes' seam suites using the same house pattern.

  The seven approval-surface suites, run on their own:
  npx jest --no-cache <the seven>
  -> Test Suites: 7 passed, 7 total     Tests: 114 passed, 114 total
     (was 88 before this lane: +26)

node scripts/acceptance/run.mjs
  -> 45/45 passing (16149ms), harness score 10/10.
     inbox-approve-persists PASS: "approve path validates and answers 404, not a 5xx".

bash scripts/smoke-test-layout.sh
  -> ✅ Smoke test complete. TWELVE named guards + the completion line = 13 ✅ lines.
     The brief says nine; I counted twelve and added or removed none.
```

**Live probes** are quoted inline in §0 and §2. All of them used project `Limiglow`.

---

## 5. SEAM-1 — the only thing that makes the headline property true

**File:** `app/api/db/[...path]/route.ts` (not this lane's)
**Gate:** `__tests__/api/inbox-db-proxy-seam.test.ts` — **red until this lands**, and
its failure message prints both options verbatim.

### Option A (recommended — one token)

Nothing in the app writes `inbox` through this proxy. Verified by grep over `app/`,
`components/`, `hooks/`, `lib/` and `scripts/`: the only occurrence of `/api/db/inbox`
outside tests and doc comments is a **comment** at `lib/runtimes/token-ledger.ts:28`.

```diff
-const WRITABLE_TABLES = new Set(['issues', 'notifications', 'inbox'])
+// `inbox` is deliberately NOT writable here. Deciding an approval goes through
+// PATCH /api/inbox, which resolves the role from the CREDENTIAL and files the
+// attempt in `approval_decisions`. This route's only write gate is the
+// client-typed `mc-role` cookie, so leaving `inbox` writable made that gate
+// bypassable from a read-only session — measured 2026-08-26, HTTP 200 on both
+// PATCH and DELETE with `mc-auth=<viewer>; mc-role=owner`.
+// See docs/rebuild/pieces/pieces9/approval-surface.md SEAM-1.
+const WRITABLE_TABLES = new Set(['issues', 'notifications'])
```

`READABLE_TABLES` keeps `inbox`, so reads through the proxy are untouched (the seam
suite asserts that as a discriminator).

### Option B (only if some caller genuinely needs to write it)

Fix the gate instead of the table list — full diff is in the seam test's failure
output and is not repeated here. It replaces `isViewer`'s cookie read with
`resolveDecisionRole()` + `hasPermission(role, 'issues:write')`.

**HONESTY ABOUT OPTION A.** I did **not** apply it — editing that file while nine
lanes run concurrently is exactly the failure mode the brief warns about, and it
would have recompiled the dev server under other lanes' live probes. My confidence
is a **source read**, not a measurement: `handle()` at line 219 is
`if (isWrite && (isViewer(req) || !WRITABLE_TABLES.has(table)))` → 403, so removing
`'inbox'` refuses PATCH and DELETE for every caller regardless of cookies, while the
401 check at line 206 still runs first and `READABLE_TABLES` still governs GET. All
five cases in the seam suite follow from that expression. **Whoever lands it should
re-run the suite rather than trust this paragraph.**

### SEAM-1b (optional, stronger — needs a migration, which is not this lane's)

The repo's own standard for this problem is a **CHECK constraint**, not route policy:
`lib/conversations.ts` says so in its header, and migrations 063/070 back it. The
inbox has no equivalent. The measured spoof produced `status='approved'` with
`resolved_at=null`, which a constraint would have refused *whichever route wrote it*:

```sql
-- migrations/0NN_inbox_decided_rows_are_attributable.sql  (+ migrations/sqlite/0NN_…)
ALTER TABLE inbox ADD CONSTRAINT inbox_decided_is_attributable
  CHECK (status = 'pending'
         OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolved_by <> ''));
```

Two-dialect, per the repo rule. This is defence in depth *and* the only version of
the property that survives a future third writer. I have **not** validated this SQL
against the existing rows — a pre-flight `SELECT COUNT(*) FROM inbox WHERE status <>
'pending' AND (resolved_at IS NULL OR resolved_by IS NULL)` is mandatory first, and
at least one such row existed today (the spoof's, since deleted).

---

## 6. SEAM-2 — the "Needs you" badge and the Inbox tab count different things

**File:** `app/page.tsx:694` (orchestrator-owned). **Not** expressed as a failing
test, deliberately: unlike SEAM-1 this is a product judgment, not a safety hole, and
a red gate would be me deciding it for you.

The critic said it could not force the divergence. **I did**, with one row:

```
BEFORE
  GET /api/inbox?status=pending              (badge query) -> array length 0
  GET /api/inbox?status=pending&project=Limiglow           -> scope {matched:0, other_project:0, unresolvable:0}

POST one pending request that carries no issue (so it cannot be placed in a project)

AFTER
  GET /api/inbox?status=pending              (badge query) -> array length 1
  GET /api/inbox?status=pending&project=Limiglow           -> scope {matched:0, other_project:0, unresolvable:1}
```

So the badge says **1 needs you**; the operator clicks through and the Inbox card
says **0 to decide**. The tab is not lying — its empty message does append
*"…1 could not be placed in any project"* — but the number the operator navigated
by does not exist on the screen they land on. Any request filed without an issue
does this, which is the normal shape for `loop_breaker_pause` with no
`context.last_issue_id`.

Two honest resolutions; **pick one, do not leave both**:

```diff
  // A) badge follows the scope the operator is standing in
- fetchJson<unknown>('/api/inbox?status=pending').then(r => {
-   if (r.ok && Array.isArray(r.data)) setInboxPendingCount(r.data.length)
- })
+ const url = project
+   ? `/api/inbox?status=pending&project=${encodeURIComponent(project)}`
+   : '/api/inbox?status=pending'
+ fetchJson<{ scope?: { matched: number } } | unknown[]>(url).then(r => {
+   if (!r.ok) return                      // a failed poll must not zero the badge
+   const d = r.data as { scope?: { matched: number } } | unknown[]
+   setInboxPendingCount(Array.isArray(d) ? d.length : d.scope?.matched ?? 0)
+ })
```

…or **B)** leave the badge fleet-wide and give the Inbox tab a line saying so, e.g.
`"N pending fleet-wide, of which M are in <project>"`. B is a change to
`components/tabs/InboxTab.tsx`, which **is** this lane's — I did not make it because
choosing B commits `app/page.tsx` to staying unscoped, and that is the
orchestrator's call, not mine.

---

## 7. Competitor benchmark — Grok Bot, feature by feature

> *drafts while you are away, surfaces only what needs approval; you approve, it sends.*

| Capability | Todero today | Verdict |
|---|---|---|
| **You approve → a real consequence** | Approving runs a registered effect (`agent_unpause`): un-pauses the agent, clears `system:loop_breaker`, unblocks the issue. Measured today: `"detail":"agent 'lane5-self-agent' un-paused"`. Plus an append-only `approval_decisions` trail that records **refusals**. | **Todero wins.** Grok Bot has no audit equivalent. |
| **An agent drafts, a human approves** | Enforced by two permissions (`issues:write` to record, `settings:write` on top to approve) — and, as of this wave, an approval must be *signed* (§2.3), so the refusal is no longer opt-out. | **Todero wins** for the session path. |
| …but the agent path | `resolveDecisionRole` honours **any** role named in `X-Agent-Role` once the internal secret is presented, so a process holding `TODERO_INTERNAL_SECRET` can send `X-Agent-Role: owner` and approve. **Source-level reading — I did not read the secret's value and did not test this live.** | **Conceded.** Listed in §9. |
| **Surfaces only what needs approval** | Five separate queues (piece §1), one global badge, and the badge counts a different population from the tab (§6). `awaiting_approval` — the conversation-draft count, which is the actual Grok-Bot-shaped queue — appears in exactly three files and **no badge, tile or global count**. Confirmed by grep: `app/api/conversations/route.ts`, `app/api/conversations/[id]/route.ts`, `components/tabs/ConversationsTab.tsx`. | **Grok Bot wins.** |
| **You approve; Todero sends** | Todero **does not send.** `app/api/conversations/[id]/messages/[messageId]/route.ts` says so in its own header; `record_send` is a report an external transport must make. Approving parks a message at `approved`. Source read, not measured. | **Grok Bot wins.** |
| **Offered-that-fails** | `components/tabs/ApprovalCard.tsx` has no `cannotApprove` prop; its Approve button is `disabled={busy || !gate.enabled}` from `approveGate()` alone, so a viewer is still offered a button that 403s. That file is not this lane's. The **warning** is now at least reliably visible (§3b). | Still open, disclosed. |

---

## 8. ACCEPTANCE — checkable without trusting me

Each item names the exact command and the exact expected output.

1. **The escalation is still closed on the gated route.**
   `curl -s -X PATCH localhost:3000/api/inbox -H 'Cookie: mc-auth=view2026; mc-role=owner' -H 'Content-Type: application/json' -d '{"id":"<a pending id>","status":"approved","resolved_by":"x"}'`
   → HTTP 403, `"code":"PERMISSION_DENIED"`, `"role":"viewer"`, `"ignored_role_claim":"owner"`.

2. **The prototype crash is gone.** For each of
   `constructor toString valueOf hasOwnProperty isPrototypeOf __proto__`:
   `GET /api/inbox?project=Limiglow` and `GET /api/conversations?project=Limiglow`
   with `Cookie: mc-auth=view2026; mc-role=<key>` → **200**, not 500.
   *Counterfactual:* `git stash` this lane and the same six return 500 with an empty body.

3. **The queue cannot be DoS'd by a request type.**
   `POST /api/inbox {"agent":"tmp","type":"constructor","project":"Limiglow","context":{}}` → 201;
   then `GET /api/inbox?project=Limiglow` → **200**; then
   `PATCH {"id":…,"status":"approved","resolved_by":"you"}` → **422 NO_REGISTERED_EFFECT**;
   then `PATCH {"id":…,"status":"explained"}` → **200**. **Delete the row afterwards.**

4. **An approval must be signed.** On one pending row filed by agent `A`:
   `{"status":"approved"}` → **422 `UNSIGNED_APPROVAL`**;
   `{"status":"approved","resolved_by":"A"}` → **403 `SELF_APPROVAL`**;
   `{"status":"approved","resolved_by":"someone-else"}` → **200**, `resolved_by`
   comes back `"someone-else (owner)"`. All three refusals appear in
   `GET /api/inbox/decisions` (project-scoped rows only — see §9).

5. **Denying still needs no signature.**
   `{"status":"denied"}` with no `resolved_by` → **200**. If this 422s, the
   asymmetry has been broken and §2.3 is wrong.

6. **The UI half has a test now.** `npx jest --no-cache components/tabs/__tests__/inbox-rights-notice.test.tsx`
   → **11 passed**. Then apply M11 (`if (!rights) return null` → `if (true) return null`)
   → **5 fail**. Restore.

7. **The seam is red on purpose.** `npx jest --no-cache __tests__/api/inbox-db-proxy-seam.test.ts`
   → **2 failed, 3 passed**, and the failure output contains the full SEAM-1 diff.
   After SEAM-1 lands it must be **5 passed**. The 3 that pass today are the
   discriminators (reads still work; unauthenticated is still 401; `notifications`
   is still writable) — they exist so "refuse everything" cannot turn it green.

8. **Gate.** `npx tsc --noEmit` clean; the seven approval suites 114/114;
   `node scripts/acceptance/run.mjs` 45/45 and 10/10 with `inbox-approve-persists`
   PASS; `bash scripts/smoke-test-layout.sh` all ✅ (13 lines).

9. **Fixtures.** `GET /api/db/inbox?select=id,agent&limit=200` contains no `lane5-`
   agent; `agent_memory` contains no `lane5-` agent; `approval_decisions` has no
   `lane5-` `request_agent`. `TOD-1` still present:
   `[{"task_key":"TOD-1","project":"Todero","status":"backlog"}]` — verified after
   cleanup.

---

## 9. What I did NOT verify — read this before trusting anything above

* **No browser. I never rendered anything in a browser.** §3/§3b are
  `renderToStaticMarkup` output: they prove the element and its words are emitted
  for a given server payload. They do **not** prove it is visible, contrasty, above
  the fold, or reachable on a phone. No claim in this document says otherwise.
* **SEAM-1's Option A is a source read, not a measurement.** §5 says exactly why and
  exactly what to re-run.
* **The `X-Agent-Role: owner` escalation is a source read.** I confirmed
  `TODERO_INTERNAL_SECRET` is present as a KEY in `.env.local` and never read its
  value, and I did not send the header with it.
* **`member` was never exercised live.** `MC_MEMBER_PASSWORD` is absent from
  `.env.local` (confirmed: `grep -a -oE "MC_[A-Z_]+" .env.local` yields only
  `MC_PASSWORD` and `MC_VIEWER_PASSWORD`). Every `member` assertion is unit-tested.
* **Concurrency untested.** The `.eq('status','pending')` write predicate is read
  from source; I did not race two PATCHes.
* **A refusal against an UNPLACEABLE request is invisible in the project-scoped
  decisions view.** Measured: my first 403 was correctly written to
  `approval_decisions`, and `GET /api/inbox/decisions?project=Limiglow` returned
  `total:0` because the row carried no issue and so no project. That is
  `scopeToProject()` behaving as designed (excluding rather than guessing), but it
  means a scoped audit view can be empty while refusals are happening. I did not
  change it — say so rather than let a fresh critic "discover" it as a lie.
* **`mc-role=viewer` is refused by middleware BEFORE the route**, with a different
  body (`"Read-only access: viewer role cannot modify data"`), so an *honest*
  viewer's refusal is **not** filed in `approval_decisions` while an *escalating*
  one is. Measured today. `middleware.ts` is not this lane's; flagged, not fixed.
* **`npm test` was noisy and moving** — see §4. I did not touch any of the other
  failing suites and cannot vouch for them.
* **No mutating git command was run. `npm run build` was never run.**
  `app/page.tsx` and `components/nav/config.ts` were read, never written.
