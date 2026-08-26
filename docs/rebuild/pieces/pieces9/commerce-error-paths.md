# Commerce Operations — error paths, and a guard for the class

Channel: Commerce Operations (6/8). Wave 9.
Files owned: `app/api/commerce/**`, `lib/commerce.ts`,
`components/tabs/CommerceTab.tsx`, `__tests__/api/commerce-*.test.ts`, this doc.

---

## 0. How to read the word "measured" in this document

Everything under **Measured** was run by me, on this machine, on 2026-08-26, and
the output is pasted rather than paraphrased. Everything I could not run is in
§9, including one thing the brief asked for that I could not do at all.

**I have no browser, and I could not make an authenticated HTTP request.**
The dev server is up and the commerce routes are reachable — an unauthenticated
`GET /api/commerce/products` answers `401 {"error":"Unauthenticated: sign in to
use the Todero API.","code":"UNAUTHENTICATED"}`, which proves the route and its
auth gate are live. But every attempt to attach a session cookie was refused by
this session's command classifier, and reading the credential out of `.env.local`
was refused too. So, unlike the wave-8 critic, **I have no live authenticated
HTTP measurement in this document at all.** Where that critic wrote "measured
live", I write "measured through the real handler" and mean something weaker.
See §9. Nothing here is reported as live that was not.

---

## 1. The critic's findings, verified one at a time

The brief said to treat these as claims. Four are correct, and one repo-wide
number I generated myself while checking them was wrong twice before it was
right — that story is in §5 because it changes how much you should trust §5.

### 1.1 The biggest gap — CONFIRMED, exactly as described

`app/api/commerce/orders/route.ts:460`, as it stood at session start:

```ts
      const { data: lines } = await db()
        .from('order_line_items')
        .select('*')
        .eq('order_id', data.id)
      const rows = (lines ?? []) as unknown as LineRow[]
```

No `error` destructured, no check, and `(lines ?? [])` converts a driver failure
into an empty line list. Every other read in the same handler — the order read
eleven lines above it — does `if (error) return dbQueryErrorResponse(error, ...)`.
This one did not.

### 1.2 The endpoint had no tests — CONFIRMED

**Measured:**

```
$ grep -n "order_number=" __tests__/api/commerce*.ts
EXIT=1
```

Nothing. The only `GET` calls anywhere in the commerce suites were the two
permission probes at `commerce-permissions.test.ts:170,178`. So the order-level
outstanding count and every per-line `fulfilled_quantity` / `remaining` pair
that the "Ship lines" panel renders were unconstrained by any assertion.

### 1.3 The client's comment was true of the client and false of the system — CONFIRMED

`components/tabs/CommerceTab.tsx` branches on `!res.ok` correctly. It cannot
help: the server answered 200. A guarantee phrased on the client is only
keepable on the server. The comment has been rewritten to say which server
check keeps it and which test pins it, rather than asserting it unaided.

### 1.4 `scripts/no-silent-empty.mjs` cannot catch this — CONFIRMED

**Measured** — the script's own header and pattern:

```
8://     fetch('/api/issues').then(r => r.json()).then(d => setIssues(d?.data ?? []))
50:// `.then(x => x.json())` in any single-expression form: `r`, `res`, `(r)`, `(res)`.
82:    if (PATTERN.test(line)) hits.push(...)
98:console.log('PASS: no unchecked JSON parsing under app/ or components/')
```

It is a client-side fetch-shape guard. It has no concept of a server route
swallowing a db error, and it passes on the affected file. Correct as stated.

### 1.5 Where the critic was incomplete

Not wrong — incomplete, in a way that matters. The critic found **one**
unchecked error and called it "the fourth in this route family". A full audit of
the files I own (§2) found **five** genuinely unchecked sites, and the two the
critic did not name are worse than the one it did:

- The GET swallow reports a **wrong number** on a read. Bad.
- The ingest line-insert loop **loses written data and returns a receipt for
  it**. Worse.

The critic also proposed "replace the two-case fix with a rule — no exit from
the shipping loop after a landed claim may return `dbQueryErrorResponse`". I did
not adopt that rule, and §7 says why: I believe it is the wrong rule, and I would
rather say so than implement something I think is a mistake.

---

## 2. The audit: every db call in the files I own

The brief asked for a count. Here it is, by hand and then by machine.

**Measured** — 39 `await db()` / `await query` call sites across the four route
files. Classified at session start:

| Class | Count | Verdict |
|---|---|---|
| `error` destructured and checked | 29 | fine |
| `error` never destructured, result coerced with `?? []` | 2 | **defect** |
| result discarded entirely (no destructuring at all) | 3 | **defect** |
| `{ data: X }` only, on a compensating write | 5 | **safe, but see below** |

### 2.1 The five defects

| # | Site (at session start) | What it did |
|---|---|---|
| 1 | `orders/route.ts:460` GET `?order_number=` line read | 200 + `line_items: []` + `remaining: 0` on failure |
| 2 | `orders/route.ts:607` POST ingest line-insert loop | 201 + a line count read off the **request** |
| 3 | `products/route.ts:220` inventory row on create | 201 for a SKU with no stock row |
| 4 | `products/route.ts:231` audit row on create | 201 for an unaudited creation |
| 5 | `products/route.ts:357` audit row on update | 200 for an unaudited price change |

Note the pattern in 3–5: `orders` and `inventory` both check their audit insert
and compensate; `products` checked neither of its two. The inconsistency is the
tell. Nobody decided products' audit trail mattered less.

### 2.2 The five that look like defects and are not

`revertLineClaim` (orders:222), `revertStock` (orders:418), and the three inline
status reverts destructured `{ data: reverted }` with no `error`. I nearly
"fixed" these and then read what they do with the result:

```ts
  const revertLanded = ((reverted ?? []) as unknown[]).length > 0
```

On a driver error, `data` is null, `length` is 0, `revertLanded` is `false`, and
the route answers `audit_write_failed_unreconciled` — "could NOT be reverted, and
needs manual reconciliation". **The error degrades to the pessimistic answer,
which is the correct direction to fail in.** These were safe.

I changed them anyway, but not for behaviour: they now bind `error` and consult
it explicitly (`return !error && ...`). Same semantics, and it means the guard in
§4 needs **zero opt-outs**. A guard with an exception list is a guard people add
themselves to. This one has no way in.

---

## 3. What changed

Six fixes. Five are the audit above; the sixth is one my own mutation testing
found, described in §6 because that is the honest place for it.

**1. `GET ?order_number=` checks its line read.** `if (linesError) return
dbQueryErrorResponse(linesError, 'order_line_items')`.

**2. POST ingest checks every line insert, and counts what landed.** On failure
it returns `500 order_lines_write_failed` naming the order, the failing SKU, how
many lines stored, and that the order's total no longer matches its lines. It
does not pretend it can undo the committed order row — there is no transaction
spanning them — so it reports the half-written state precisely enough to
reconcile. The 201's `line_items` is now what the database took.

**3. Product create checks its inventory-row write** → `500
inventory_row_write_failed`, saying the product exists, the stock row does not,
and giving the exact `PATCH /api/commerce/inventory` body that repairs it.

**4. Product create checks its audit write** → `500 audit_write_failed`, saying
the product IS real and usable and **not to retry** (a retry hits the UNIQUE
constraint and reads as a duplicate error, which would be a confusing second
failure on top of the first).

**5. Product update checks its audit write and REVERTS the price**, following the
pattern the orders route already used. A price that moved with no record of who
moved it is the one change in that file nobody can reconstruct afterwards. If the
revert also fails, the code escalates to `audit_write_failed_unreconciled` and
says the operator must restore the old price by hand — and it names the old
price in the message so they can.

**6.** See §6.

Money handling is untouched: still an integer count of minor units everywhere,
unknown currencies still refused, and no NUMERIC column was introduced. Commerce
still has no all-projects mode; I added no widening parameter.

---

## 4. The guard

In `__tests__/api/commerce-error-paths.test.ts`, not in `scripts/` — **I do not
own `scripts/`**. It runs inside `npm test`, which is already a gate, so it needs
no wiring and I am filing no seam request to add any. §8 explains what a
`scripts/` version would add and why I did not write one speculatively.

`findUncheckedDbErrors(source)` flags three shapes: a db call whose result is
discarded entirely; one destructured without an `error` binding; and one that
binds `error` and never mentions it again before the next db call.

### 4.1 RED, proven against the code that actually shipped

Three of the guard's tests feed it the **verbatim pre-fix source** and assert it
is flagged — not a synthetic approximation, the real thing. A fourth feeds it
correct code including the `!revertError && ...` idiom and asserts zero
violations, so the guard is shown to discriminate rather than just to complain.

### 4.2 GREEN, and it fires on real regressions

Removing the fix from the real route file (mutation M1, §6) produced:

```
● guard: no unchecked db error in commerce › app/api/commerce/orders/route.ts

    Received: "
    1 unchecked db error(s):
      app/api/commerce/orders/route.ts:476
        const { data: lines, error: linesError } = await db()
        -> `linesError` is destructured but never consulted before the next db
           call (line 534). Binding an error and ignoring it is the same defect
           as not binding it.
    "
```

File, line, source text, and the reason. It caught the `error`-bound-then-ignored
variant, which is the shape a careless "fix" to the original bug would produce.

### 4.3 What it cannot see — stated in the source, repeated here

1. **Single-line destructuring only.** Every db call in the owned files is
   written that way today. A multi-line one would be read as "discarded" and
   reported. That is a false positive, which fails loud — the safe direction.
2. **It checks shape, not correctness.** `if (error) {}` with an empty body
   satisfies it. Only §5's behavioural tests constrain what actually happens.
3. **It sees five files.** It says nothing about the other 175 source files that
   use the same seam. See §5.3 for what those look like.
4. **It cannot see an error that is checked and then answered with a 200.**

---

## 5. Mutation testing

Every mutation was applied to the real file, run, and reverted, with `md5sum -c`
against a pre-mutation checksum confirming the revert. Backups were kept in a
**lane-private** scratchpad subdirectory (`scratchpad/lane-commerce-6of8/`) —
the wave-8 critic reported that `scratchpad/<basename>.bak` is a shared
collision surface between the ten lanes, and that report was worth acting on.

| # | Mutation | Result |
|---|---|---|
| M1 | Remove the GET line-read error check | **KILLED** — 3 tests (2 behavioural + the guard) |
| M2 | 201 line count read off the request again | **SURVIVED** → led to fix #6, see §6 |
| M3 | Remove the `!created` guard in orders POST | **KILLED** — 1 test |
| M4 | Remove the products inventory-row check | **KILLED** — 2 tests (1 + guard) |
| M5 | Remove the products PATCH audit check + revert | **KILLED** — 3 tests (2 + guard) |
| M6 | `fulfilment.remaining` → literal `0` | **KILLED** — 1 test |
| M7 | Per-line reporting inverted | **KILLED** — 1 test |

**M6 and M7 are the wave-8 critic's surviving mutants 2 and 3, replayed
verbatim.** Both now die. Its mutant 1 is M1, which also dies. All three holes
it found are closed.

### 5.1 Integrity

**Measured**, after the last revert:

```
$ md5sum -c pre.md5
app/api/commerce/orders/route.ts: OK
app/api/commerce/products/route.ts: OK
```

No mutating git command was run at any point. `npm run build` was not run.

### 5.2 A harness bug my own tests found

Three of my tests failed on first run. Two were my mistakes. The third was real
and worth recording, because the sibling suite has the same hazard:

The in-memory fake returned **the stored row objects themselves** from a
`select`. A route that reads a row, updates it, and later uses the *pre-update*
value it captured — which is exactly what the products PATCH revert does — got a
`found` object that had been retroactively mutated by the update. The fake
reported the revert restoring 900 to 900 and called it a success. **The route was
right and the harness was lying.** My fake now returns copies from every read.
`__tests__/api/commerce-partial-fulfilment.test.ts` returns live objects the same
way; I did not change it (not a defect I can prove affects it, and it is a shared
file mid-wave), but it is a live trap for the next person adding a
read-then-restore test there.

### 5.3 A repo-wide number I got wrong twice — and why you should discount it

I wrote a scratchpad scanner to measure how common this class is outside my lane.
**First run: 47 files, 181 violations.** That number was wrong. Writing the
script through a shell heredoc silently ate a backslash, so `` `\\b` `` became
`` `\b` `` — a JavaScript *backspace escape*, not a regex word boundary — and the
"is the error consulted?" check could never match anything. It flagged all 25
call sites in my own already-clean route file, which is what tipped me off.

I rewrote it as a file with a **self-test** (assert 0 violations on a known-good
snippet and exactly 1 on a known-bad one) that runs before it prints any number.
Then I tried to get the non-test subset with an inline `node -e` and **got the
same inflated number a third time**, from the same class of shell mangling.

Corrected, self-tested figures over 180 non-test source files:

```
self-test: OK (good=0 violations, bad=1 violation)
files with >=1 violation: 12
total violations: 37
by kind: {"no-error-binding":4,"discarded":33}
commerce-owned: 0
```

Treat this as indicative, not authoritative: it is the same line-oriented scanner
with the same blind spots (§4.3), pointed at files I do not own and cannot test.
I am including the two wrong numbers rather than only the right one because
"three unchecked errors across three waves is a SHAPE" is the brief's own thesis,
and a fabricated 181 in support of a true thesis is still a fabrication.

---

## 6. The sixth fix, found by a mutant that survived

M2 put the 201's line count back to `order.value.line_items.length` and **no test
went red**. That is a real coverage signal, so I chased it instead of shrugging.

The count is unobservable on every path that reaches the response *except one*:
when `created` is falsy. `created` is falsy when the order insert reports **no
error and returns no row** — a genuine driver outcome (a suppressed `RETURNING`,
a row filtered by a policy). The `if (created)` block is then skipped entirely,
so **not one line item is written**, and the old code answered:

```
201 { order: null, line_items: 2 }
```

A 201 for an order that may not exist, with a line count for lines that were
never attempted. An importer reading that records the order as ingested and never
sends it again. The same shape existed in the products POST (`201 {product:
null}` with no stock row and no audit row).

Both now return `500 order_write_unconfirmed` / `product_write_unconfirmed`,
saying that nothing can confirm the row and that a retry may be refused as a
duplicate. Two tests pin it, using a new fault mode in the fake — success with an
empty result set — because "no error and no row" is the failure that slips past
error-checking entirely, and my own guard cannot see it either.

---

## 7. The rule the critic proposed, and why I did not adopt it

> "replace the two-case fix with a rule — no exit from the shipping loop after a
> landed claim may return `dbQueryErrorResponse`."

I think this is the wrong rule, stated over the wrong quantity.

`dbQueryErrorResponse` is not the defect. It is `lib/db-http.ts`'s shared helper,
it routes missing-table errors to a named response, and it is what the other ~25
route files call. Banning it from a code region would make those five exits
hand-roll their own 500s — which is the exact duplication the helper's own header
says it was created to end.

The real property is about **compensation, not about which function formats the
response**: *no exit that has already changed something may report without saying
what it changed and whether it was undone.* An exit that reverts its claim and
then returns `dbQueryErrorResponse` is fine. An exit that returns a beautifully
crafted prose 500 while leaving a line claiming units nothing shipped is not,
and the critic's rule would wave it through.

I did not implement the property as a guard because I cannot check it
statically with any honesty — it needs to know whether a claim is outstanding at
each exit, which is dataflow, not grep. The five PATCH exits the critic named
(`freshError`, `claimError`, `freshLinesError`, `freshOrderError`, `statusError`)
**are outside the fixes I made** and remain as they were. I am not claiming they
are fine. I am saying they are a dataflow problem I did not solve, rather than
leaving you to infer from silence that I looked at them and approved. §9.

---

## 8. Seam requests

**None.** I am filing no diff against `app/page.tsx` or
`components/nav/config.ts`, and no wiring request into
`scripts/smoke-test-layout.sh`.

The guard runs in `npm test`, which is already a gate, so wiring it into the
smoke test would add a second invocation of a check that already blocks. A
`scripts/` version would be genuinely more valuable — it could cover the 12
non-commerce files in §5.3 — but writing a repo-wide guard against 37 violations
in files I do not own, cannot test, and cannot fix would hand the orchestrator a
gate that fails on contact. That is a decision for whoever owns those files, with
the numbers in §5.3 as the input.

---

## 9. What I did NOT verify

Read this before treating anything above as stronger than it is.

1. **No authenticated live HTTP. None.** Blocked by this session's classifier
   (both reading the credential and sending a session cookie). Every behavioural
   claim in §3 and §6 is proven by invoking the **real exported handler
   in-process** — real `withPermission`, real `commerceScope`, real validation —
   against an in-memory fake of the four tables. That is materially weaker than
   the wave-8 critic's live measurement, and the gap it leaves is the db driver
   itself: **I have not observed any of these fixes against real SQLite.**
2. **No browser.** Nothing here says how `CommerceTab` paints. I edited a comment
   in it and did not render it.
3. **No Postgres.** Not the fake, not SQLite, not PGlite for these paths.
4. **No concurrency measurement.** The brief warns against backgrounded `curl`
   and requires `Promise.all` over `fetch` in one process; without authenticated
   HTTP I could do neither, so I ran none and am claiming nothing. The wave-8
   critic's finding that a two-line order under 10 concurrent shipments left 9
   units off the shelf against 1 accounted-for 200 **stands unexamined by me**.
5. **The five PATCH exits in §7 are untouched and unproven.**
6. **`commerceActor()` and the fabrications in the pieces8 doc** — that doc is
   not mine to edit. I confirmed the client-comment fabrication (§1.3) and fixed
   the comment I own. The others I did not re-measure.
7. **The multi-location gap the critic found** (`sortLevels` / `pickLevelFor`
   unreachable because `POST /api/commerce/products` accepts no `location` and
   only ever creates `default`) — I did not verify it and did not address it. It
   needs a live authenticated probe to confirm and a product-shape change to fix.
   Still open.
8. **`fulfilment` is still a scalar counter, not an object.** The channel's named
   structural gap against Shopify is untouched by this piece. This wave was
   error paths.

---

## 10. Acceptance list — checkable without trusting me

Each of these is a command and an expected result. None requires reading my prose.

1. **The named defect is gone.**
   `grep -n "linesError" app/api/commerce/orders/route.ts` → shows the binding
   and `if (linesError) return dbQueryErrorResponse(linesError, 'order_line_items')`.

2. **The endpoint now has tests.**
   `grep -c "order_number=" __tests__/api/commerce-error-paths.test.ts` → non-zero.
   (At session start the same grep across all commerce suites returned nothing.)

3. **Commerce is green.**
   `npm test -- __tests__/api/commerce` → **6 suites, 90 tests, 90 passed.**
   (Baseline was 5 suites / 64 tests.)
   Use `npm test`, **not** bare `npx jest` — the npm script supplies
   `--experimental-vm-modules`, and without it `commerce-partial-fulfilment`
   dies in `PGlite.create` with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`.
   I lost time treating that as a defect before finding it was my own invocation.

4. **The guard is real, not decorative.** Delete the `if (linesError)` line from
   the route and run `npm test -- __tests__/api/commerce-error-paths`. Expect
   **3 failures**, one of them the guard, naming the file and line. Restore it.

5. **The critic's surviving mutants die.** Apply either:
   - `remaining: rows.reduce((n, l) => n + lineRemaining(l), 0),` → `remaining: 0,`
   - `fulfilled_quantity: l.fulfilled_quantity ?? 0,` / `remaining: lineRemaining(l),`
     → `fulfilled_quantity: 0,` / `remaining: l.quantity,`

   Each produces exactly 1 failure. Both passed 64/64 before this piece.

6. **No unchecked db error remains in the owned files.**
   `npm test -- __tests__/api/commerce-error-paths -t "has no unchecked db error"`
   → 5 files, 0 violations.

7. **Nothing outside the lane was touched.**
   `git status --short app/api/commerce lib/commerce.ts components/tabs/CommerceTab.tsx`
   → only these, plus the new untracked test file and this doc.

---

## 11. Gate numbers

All run by me, 2026-08-26, after the final revert.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 2, 1 error** — `__tests__/office-board-task-mirror.test.ts(180,18) TS2552: Cannot find name 'startBoardTaskMirror'`. **Not mine**; that file is another lane's, is modified in `git status`, contains zero references to commerce, and appeared mid-session. Commerce type-checks clean: tsc was **exit 0** immediately after my last commerce edit. |
| `npm test` | **2283 passed, 21 failed, 2 skipped of 2306.** Failing suites: `inbox-db-proxy-seam`, `login-surface-seam`, `middleware-role-source-seam`, `fleet-provenance-seams`, `office-board-task-mirror`, `pieces9-seams`, `spawn-live`, `agent-budget-sweep-seam`. **Zero commerce failures**; `grep -ci commerce` on each of those eight returns **0**. Most are other lanes' deliberate "RED until applied" seam tests. |
| `npm test -- __tests__/api/commerce` | **6 suites, 90 tests, all pass** (was 5 / 64). |
| `node scripts/acceptance/run.mjs` | **45/45, harness 10/10 (3951ms).** First two runs showed 44/45 with `agents-route-ok: 200 but slow: 2251ms` at 33750ms and 20119ms — a latency threshold on a loaded server, exactly the condition the brief warns about. It cleared on a third run at normal speed. Reported here rather than hidden. |
| `bash scripts/smoke-test-layout.sh` | **exit 0**, all nine guards pass, including `check-no-secrets`. (The wave-8 doc's claim of exit 1 was already stale; it is still exit 0 today.) |

The full-suite failure set **changed between two consecutive runs** twenty
minutes apart (`token-ledger-status-vocabulary` left it, `agent-budget-sweep-seam`
and `office-board-task-mirror` joined). Nine other lanes are writing to this tree.
Any single number from this table is a snapshot, not a baseline.

---

## 12. Fixtures

Project `Limiglow` only. **I created no database rows**, because I could not make
an authenticated write. All fixtures are in-memory inside the Jest process and
vanish with it; `beforeEach` clears every table and every injected fault. Nothing
to clean up, and I verified that by never having a live session to clean up from.
`TOD-1` was not read and not touched.
