# identity-sessions — round 3

Channel: **Identity, Auth & Access Control**. Prior judgement **5/10**.
Benchmark: **builderz-labs** — per-agent API keys, and viewer/operator/admin
roles over real sessions, replacing three shared passwords that double as their
own tokens.

Everything below marked **Measured** was run by me on **2026-08-26** against the
already-running dev server at `http://localhost:3000`, or with the real classes
under an injected clock. **I have no browser.** Anything that needs one is
marked NOT VERIFIED and appears again in §9.

---

## 1. Files this lane owns, and the complete footprint of this round

Ownership: `lib/with-permission.ts`, `lib/session-actor.ts`, `lib/rbac-types.ts`,
`app/api/auth/**`, `app/api/auth-form/**`, `__tests__/auth/**`, this doc.

Changed or added this round — **three files, and that is the whole list**:

| File | Change |
|---|---|
| `app/api/auth/rate-limit.ts` | FIX 4: a hard ceiling the trusted exemption cannot cross. Header + `check()` doc corrected. |
| `__tests__/auth/rate-limit-defaults.test.ts` | NEW. 27 tests. Pins the shipped defaults, the cookie attributes, the constant-time compare, and FIX 4. |
| `__tests__/auth/middleware-role-source-seam.test.ts` | NEW. 9 tests, **4 RED on purpose**. |
| `__tests__/auth/login-surface-seam.test.ts` | NEW. 4 tests, **2 RED on purpose**. |

`middleware.ts` was **not modified**. `git status middleware.ts` was clean before,
during and after — including while I was verifying the seam diff, which was
applied to a scratch copy inside `__tests__/auth/` and then deleted.

**Correcting the round-2 header, which was false.** It claimed
`lib/with-permission.ts`, `lib/session-actor.ts` and `lib/rbac-types.ts` "were
deliberately left byte-identical to HEAD", and acceptance row A1 asked a critic
to verify that with `git diff --stat` against HEAD — which is trivially empty
once the work is committed, so the row tested nothing it claimed to test.
Measured:

```
$ git diff --stat db0ccd1 HEAD -- lib/with-permission.ts lib/session-actor.ts
 lib/session-actor.ts     |  80 +++++-
 lib/with-permission.ts   | 174 +++++++++---
```

Round 2's real footprint was **14 files, not the 7 its header listed** (the 7
omitted three test suites and both RBAC libs). That correction is the reason §1
above lists files rather than describing them.

---

## 2. The critic's findings, checked one at a time

Ten findings were relayed. **I could not find one that was wrong.** Two were
understated, and I found a third variant of the headline bug that appears in no
document I read.

### 2.1 The cookie oracle — CONFIRMED, and it is still the biggest gap

**Measured.** 30 wrong `mc-auth` values, `GET /api/projects`:

```
401 401 401 401 401 401 401 401 401 401 401 401 401 401 401
401 401 401 401 401 401 401 401 401 401 401 401 401 401 401
correct: 200
```

No throttle of any kind. `middleware.ts`'s `hasValidSession()` compares the
cookie against all three passwords on every `/api/` request, and `mc-auth` **is**
the password, so every API request is a free 401/200 password oracle. The login
limiter this lane built guards a door no attacker needs. This is stated in three
source-file headers already and it is still true.

### 2.2 The middleware escalation — CONFIRMED, and there are THREE variants, not one

**Measured**, `DELETE /api/issues?id=TOD-NONEXISTENT-LANE9-PROBE`, every request
carrying the **read-only viewer password** and nothing else:

```
Cookie: mc-auth=view2026; mc-role=viewer     -> 403  {"error":"Read-only access: viewer role cannot modify data"}
Cookie: mc-auth=view2026; mc-role=owner      -> 200  {"ok":true}      FORGED
Cookie: mc-auth=view2026                     -> 200  {"ok":true}      OMITTED
Cookie: mc-auth=view2026; mc-role=notarole   -> 200  {"ok":true}      GARBAGE
no cookie at all                             -> 401
```

Round 2's §10.4 describes only the FORGED row. The OMITTED row the critic found.
**The GARBAGE row is mine and is in no document**: `getRoleFromCookie()` returns
null for an unrecognised value exactly as it does for an absent one, and null
falls past the `role === 'viewer'` check into the branch commented
`// No cookie = server-side call (e.g. agent → API) — pass through`.

The shape of the defect is worth naming precisely, because it is not "the client
can lie". **The viewer role is enforced only when the attacker volunteers the
cookie that identifies them as a viewer.** Absence of a claim is being read as
proof of privilege, in a branch reached only *after* `hasValidSession()` has
already admitted a human viewer — so the "server-side call" the comment
describes is not who is standing there.

`POST /api/roles`, same credential — **Measured**:

```
mc-role=viewer -> 403    mc-role=owner  -> 400 (handler reached)
mc-role=admin  -> 403    mc-role=god    -> 400 (handler reached)
mc-role=member -> 403    no mc-role     -> 403
```

### 2.3 The four surviving mutants — ALL FOUR CONFIRMED, personally re-run

One mutation at a time, reverting between each, `npm test -- __tests__/auth/`:

| Mutation | Before this round |
|---|---|
| `DEFAULT_TRUST_WINDOW_MS` 12h → `12h * 100000` (~137 years) | **157/157 PASSED** |
| `DEFAULT_MAX_TRACKED_KEYS` `10_000` → `10_000_000_000` | **157/157 PASSED** |
| `secure: NODE_ENV === 'production'` → `secure: false` | **157/157 PASSED** |
| `return timingSafeEqual(a, b)` → `return submitted === configured` | **157/157 PASSED** |

The first two survived for the same reason and it is worth writing down: **every**
trust and memory test injects its own `trustWindowMs` / `maxTrackedKeys` through
the constructor, so the numbers this install actually runs on were asserted by
nothing. A default nothing pins is not a default, it is a comment.

### 2.4 The design-level survivor — CONFIRMED, with the real class

The trusted-key pre-registration bypass needed no mutation; the shipped code had
it. **Measured** with `AuthRateLimiter` under an injected clock, inside one
15-minute window, against a global cap of 100:

```
10,000 keys pre-registered by recordSuccess, then ground for failures
  guesses allowed: 100000    snapshot: {keys:10000, globalFailures:100000, trusted:10000}
control — identical rotation, no password held
  guesses allowed:    100
```

**A thousandfold.** The cost of entry is one successful login with the *weakest*
of the three passwords, and `recordSuccess` is deliberately not rate limited, so
the loop that mints trusted keys has no brake on it at all.

The `check()` doc comment asserted the opposite — "it cannot be turned into a
guessing budget … rotating `X-Forwarded-For` … lands on a fresh untrusted key
every time." That is false of the ordering above, and this file had every fact
needed to know it. **FIX 3 re-opened, at 1000x, the same class of weakening FIX 1
had just closed at 900x — against the exact adversary FIX 2 names.** The one test
that looked like coverage (`'trust cannot be forged'`) only ever fills the global
counter *first* and then rotates.

### 2.5 The third RBAC module — CONFIRMED, latent

`lib/rbac-middleware.ts` `resolveRole()` returns the raw `mc-role` cookie with no
`mc-auth` check at all, and `withPermission` there gives `role === 'god'` an
unconditional bypass of every permission check. **Measured** — one call site,
`app/api/memory/route.ts` (`memory:read`, which `viewer` already holds):

```
mc-auth=<viewer>; mc-role=god     GET /api/memory -> 200
mc-auth=<viewer>; mc-role=viewer  GET /api/memory -> 200
mc-role=god, NO mc-auth           GET /api/memory -> 401   (middleware refuses first)
```

Latent, not exploitable today, and named in no still-open list. It is now §S3.

### 2.6 What round 2 genuinely did fix — verified BOTH ways

* **Server-side open redirect: closed.** All eight payloads on the SUCCESS path
  of a real login → `location: http://localhost:3000/`; `/settings` and
  `/p/limiglow/work?tab=1` preserved exactly.
* **`withPermission` escalation: closed.** Confirmed by the seam work below —
  `resolveDecisionRole` is correct and 51/51 of the existing middleware suite
  passes when middleware is wired to it.
* **Login limiter: real.** Re-measured today *after* my change (§3):
  10 × 401 then 2 × 429; the CORRECT password from the blocked address → 429,
  `retry-after: 890`, **zero Set-Cookie**; correct password from a fresh address
  → 200 + both cookies; malformed body → 400.

---

## 3. What I changed — FIX 4: the trusted exemption gets a ceiling

`app/api/auth/rate-limit.ts`. The exemption's purpose is real: without it, an
unauthenticated stranger re-topping the global counter refused the honest
operator's *correct* password on 99.9% of attempts, indefinitely. That must stay
fixed. The hole is that the exemption was **unbounded in aggregate**.

There are now **two global thresholds** instead of one:

* `globalMaxFailures` (100) — an **untrusted** client is refused here.
* `globalTrustedMaxFailures` (default `2 ×` that = 200) — **everyone** is
  refused here, trusted or not. Checked **first**, with no exemption of any kind.

The aggregate guessing budget is therefore a property of the limiter rather than
a property of how many passwords the caller holds, or how many addresses it
rotated. **Measured**, same probe as §2.4, after the change:

```
attacker holding the viewer password, 10,000 pre-registered trusted keys:  200
control, identical rotation, no password held:                             100
```

Three deliberate design decisions, each stated rather than buried:

1. **The ceiling is derived from the *resolved* `globalMaxFailures`, not from a
   module constant**, so a caller that tightens the cap tightens the ceiling with
   it instead of leaving a fixed 200 above a cap of 5. Pinned by a test.
2. **A configured ceiling BELOW the cap clamps UP to the cap**, which makes the
   trusted branch unreachable. That costs *availability* on a config typo. The
   alternative — falling back to the 2× default — would silently *grant* 100
   extra guesses a window. A misconfiguration must never widen access.
3. **`MC_AUTH_GLOBAL_TRUSTED_MAX_FAILURES` may only ever tighten**, like every
   other variable in this file. `'1000000'`, `'0'`, `'-1'`, `''`, `'12.5'`,
   `'unlimited'`, `'NaN'` are all ignored in favour of the default. Pinned by
   eight parameterised tests.

**The DoS fix survives, and I proved it rather than argued it.** The measured
siege re-tops the counter to exactly `globalMaxFailures` and never beyond,
because an attacker who pushes past the hard ceiling locks *themselves* out too.
`refused === 0` of 600 attempts, unchanged.

**Cost, stated honestly.** In the band between the two ceilings the honest
operator still gets in; above it nobody does, for at most one window. An
**already-signed-in** operator is unaffected either way, because `middleware.ts`
never consults this limiter — which is the same fact that makes §2.1 the bigger
door.

---

## 4. What I changed — closing the four mutants

`__tests__/auth/rate-limit-defaults.test.ts`, 27 tests. Every assertion is made
against a limiter constructed with **no options at all**, or against the real
exported function. Never against an injected value — that is the entire point.

Re-ran every mutation against the new suite. **All four now caught**, and the
cookie assertions are pinned in **both** directions so "always true" is not a
passing answer either:

| Mutation | Before | After |
|---|---|---|
| `DEFAULT_TRUST_WINDOW_MS` → ~137 years | 157/157 pass | **1 failed** |
| `DEFAULT_MAX_TRACKED_KEYS` → 10e9 | 157/157 pass | **2 failed** |
| `secure` → `false` | 157/157 pass | **1 failed** |
| `secure` → `true` (always) | — | **1 failed** |
| `sameSite: 'strict'` → `'lax'` | — | **1 failed** |
| `mc-auth` `httpOnly` → `false` | — | **3 failed** |
| `timingSafeEqual` → `===` | 157/157 pass | **1 failed** |
| delete FIX 4's hard-ceiling branch | — | **13 failed** |

Two notes on method:

* **The constant-time property is pinned structurally, not by wall clock.** A
  timing assertion would be flaky on a loaded box. Instead the test spies on
  `crypto.timingSafeEqual` and asserts the function delegates to it — on the
  equal-length path, on the first-byte-differs path, and on the unequal-length
  path where the header claims a comparison is burned. That claim was asserted
  by nothing before.
* **The `secure` flag is asserted under a real `NODE_ENV`**, both production
  (must be `true`) and development (must be `false`, or every localhost login
  breaks). The clear path is asserted to carry the *same* attributes as the set
  path, which is the property that makes `DELETE /api/auth` do anything at all.

---

## 5. What I did NOT change, and refused to

* **`middleware.ts`** — not in this lane. It is §S1 as a *verified* seam.
* **`lib/rbac-middleware.ts`** — not in this lane. §S3.
* **`app/login/LoginForm.tsx`** — not in this lane. §S2.
* **`lib/dispatch-guard.ts` / `TODERO_DISPATCH_ENABLED`** — untouched. Acceptance
  `dispatch-guard-armed` and `dispatch-guard-untouched` both **PASS** (§7).
* **A session-table migration** — deliberately not started in a wave where nine
  lanes are writing, per the brief. The plan is §8.
* **The three shared passwords, the 30-day cookie life, `X-Agent-Role`, the
  single `TODERO_INTERNAL_SECRET`** — every one of these is a schema or
  deployment change. Naming them here is not the same as fixing them and this
  doc will not pretend otherwise.

One refusal worth recording because it nearly shipped: **the first draft of the
§S1 seam diff WIDENED `/api/roles`.** Deriving the role purely from the
credential meant an owner credential sending *no* `mc-role` cookie went from
`403` to `200` on `POST /api/roles`. Two assertions in
`__tests__/rbac-middleware.test.ts` (AC-7) caught it. The corrected diff requires
**both** a credential that grants `roles:admin` **and** an explicitly named,
recognised role — the cookie may narrow, or be *required*, but it may never
widen. That is why the extra condition exists and why it must not be
"simplified" away.

---

## 6. The seams — RED tests, not prose

The brief's house pattern, adopted. Round 2 put both of these in paragraphs;
every gate stayed green while the channel's headline defect stayed open.

### §S1 — `__tests__/auth/middleware-role-source-seam.test.ts`

**4 RED**: viewer credential OMITTING / GARBAGE-ing / FORGING `mc-role` on
`DELETE /api/issues`, and forging it at `POST /api/roles`.
**5 GREEN and must stay green**: owner still writes; owner writes with no
`mc-role`; owner narrowing itself to `viewer` is refused; unauthenticated is 401
not 403; viewer reads are unaffected. Those five are the guard against "fixing"
the red four by denying everything.

The failure message prints the full three-edit diff. **It is verified, not
proposed** — applied to a scratch copy of `middleware.ts` inside this lane's own
directory, run, and deleted:

```
this suite                          9 / 9   pass   (4 red -> green, 5 guards stay green)
__tests__/rbac-middleware.test.ts  51 / 51  pass   (its baseline is also 51/51)
```

There is no workaround inside this lane. Checked, not assumed:
`grep -c "withPermission" app/api/issues/route.ts` → **0**. Middleware is the
whole gate on that path.

### §S2 — `__tests__/auth/login-surface-seam.test.ts`

**2 RED**, **2 GREEN**.

*SEAM A — the JS login path is still an open redirect.* **Measured**:
`GET /login?from=https%3A%2F%2Fevil.example.com%2Fphish` delivers
`evil.example.com/phish` into the page four times, and
`app/login/LoginForm.tsx:30` is still `window.location.href = from`, unsanitised,
on the SUCCESS branch of a real login. The two green tests prove the fix works
before it is applied: `safeReturnPath` — the function the seam calls, which this
lane already ships — refuses all nine payloads **and** still preserves
`/settings`, `/work/epics`, `/p/limiglow/work?tab=1`.

*SEAM B — sign-out is an endpoint with no caller.* **Measured**:
`DELETE /api/auth` → 200 with two expiring `Set-Cookie` headers; zero call sites
across `app/` and `components/`; zero "sign out" strings in any `.tsx`. `mc-auth`
is httpOnly, so browser JS cannot clear it either — an operator on a shared
machine has no way to end their session from inside the product. Round 2 offered
this in a route comment as though shipping the endpoint were shipping the
feature.

### §S3 — `lib/rbac-middleware.ts` (documented, no test)

Not a seam test, because a red test here would assert a behaviour change on a
module with one call site whose permission `viewer` already holds — it would be
noise. Recorded in §2.5 and in the §S1 failure message so it is not lost again.

---

## 7. Gate numbers, run by me today

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors.** (Earlier in the session it showed 2 in `lib/__tests__/issue-moves.test.ts` and 3 in `lib/memory-retrieval.ts` — other lanes' files, since fixed.) |
| `bash scripts/smoke-test-layout.sh` | **all green**, including `check-no-secrets`, honest-error guard, and the scope guard's 10 live probes. |
| `node scripts/acceptance/run.mjs` | **45/45**, harness **10/10** (5597ms). |
| `npx jest __tests__/auth/` — non-seam | **184 / 184 pass**, 8 suites. (Baseline was 157; +27.) |
| `npx jest __tests__/auth/` — the two seam suites | **6 failed / 7 passed of 13.** All 6 failures intentional. |
| `npm test` | 40 failed / 2244 passed of 2286. **6 of the 40 are mine and are the intentional seams.** |

**About that `npm test` number, plainly.** The baseline in my brief was ~1967
passing with one known failure (`spawn-live`). The suite is now 2286 tests and 8
suites fail. Mine are exactly two:
`__tests__/auth/middleware-role-source-seam.test.ts` and
`__tests__/auth/login-surface-seam.test.ts`. The others —
`__tests__/api/inbox-db-proxy-seam.test.ts`,
`__tests__/fleet/fleet-provenance-seams.test.ts`,
`__tests__/runtimes/pieces9-seams.test.ts`,
`__tests__/api/commerce-error-paths.test.ts`,
`lib/__tests__/agent-budget-ceilings.test.ts`,
`scripts/__tests__/spawn-context-availability.test.ts`, and the known
`spawn-live` — are other lanes'. Several are visibly the same house pattern.
**Do not read "npm test is red" as this lane regressing something.**

---

## 8. The plan the benchmark actually asks for

Not started this wave, on instruction. Three shapes, in dependency order.

**Shape A — the credential stops being the session token.** One migration:
`sessions(id TEXT PK, token_hash TEXT, role TEXT, principal TEXT, created_at,
expires_at, revoked_at)`, two-dialect as this repo requires. `mc-auth` holds a
random opaque token; the server stores only its hash. This is what closes §2.1 —
`hasValidSession()` stops being a password oracle because the cookie is no longer
the password — **and** what makes `DELETE /api/auth` a real revocation instead of
a cookie clear, **and** what lets the 30-day life shrink to a rolling window.
Everything else in this channel is downstream of it.

**Shape B — the role comes from the session row, not from a cookie.** Once
Shape A exists, `resolveDecisionRole`'s "derive from the credential" becomes
"read the row", the `mc-role` cookie reverts to what it should always have been
(a hint for disabling buttons in the UI), and §S1 stops being a seam because the
thing it patches no longer exists.

**Shape C — per-agent keys.** `agent_keys(id, agent, key_hash, scopes,
created_at, revoked_at)` replacing the single shared `TODERO_INTERNAL_SECRET`.
**Measured today**, the size of what that secret is: `DELETE /api/issues` with
`x-todero-internal: <secret>` and no session at all reaches the handler, and
adding `Cookie: mc-role=owner` reaches `POST /api/roles`. One 64-character
string, no attribution, no per-principal revocation. This is the benchmark's
first named feature and we do not have it.

**Ordering matters and is not arbitrary.** Doing C first would give attributable
machine callers standing next to human sessions that are still shared passwords
in cookies — the weaker half would remain the way in.

---

## 9. Scoreboard against builderz-labs — unflattering on purpose

| Feature the benchmark names | Theirs | Ours | Winner |
|---|---|---|---|
| Per-agent API keys | one revocable, attributable credential per agent | one shared 64-char secret granting any role, no attribution, no per-principal revocation (measured §8) | **THEIRS** |
| viewer/operator/admin roles | 3 roles | 7 roles, 27 granular permissions; derived from the credential in `with-permission` + `session-actor` | **OURS**, on vocabulary and on that half of enforcement |
| Roles over **real sessions** | sessions | no session table, no user table, cookie value **is** the password, 30-day life, retained cookie still authenticates after sign-out | **THEIRS, decisively** |
| Replacing three shared passwords | replaced | still three; two configured; both 8 characters | **THEIRS** |
| *(not named)* login brute-force limiting | — | real, measured, and after FIX 4 its exemption is bounded — but still a speed bump on the door nobody needs | ours, and it does not count |

**Net: we lose on the three features the benchmark names.** FIX 4 removed a
1000× hole in our own hardening; it did not win a feature. Nothing in this round
moved the boundary the benchmark measures, because everything that would is
Shape A, and Shape A is a migration.

---

## 10. ACCEPTANCE — checkable without trusting me

Every row is a command plus the answer I got. Nothing here says "verify the diff
is empty against HEAD"; that row was the mistake round 2 made.

| # | Check | Expected |
|---|---|---|
| A1 | `npx jest __tests__/auth/ --testPathIgnorePatterns seam` | 8 suites, **184/184 pass** |
| A2 | `npx jest __tests__/auth/rate-limit-defaults.test.ts` | **27/27 pass** |
| A3 | `npx jest __tests__/auth/middleware-role-source-seam.test.ts` | **4 failed, 5 passed** — the 4 are the seam |
| A4 | `npx jest __tests__/auth/login-surface-seam.test.ts` | **2 failed, 2 passed** — the 2 are the seam |
| A5 | `git status --short middleware.ts` | **empty** — this lane never modified it |
| A6 | `git status --short app/login lib/rbac-middleware.ts` | **empty** |
| A7 | `node scripts/acceptance/run.mjs` | **45/45, 10/10**; `dispatch-guard-armed` and `dispatch-guard-untouched` both PASS |
| A8 | `bash scripts/smoke-test-layout.sh` | all green |
| A9 | `npx tsc --noEmit` | 0 errors in `app/api/auth/**`, `lib/with-permission.ts`, `lib/session-actor.ts`, `lib/rbac-types.ts`, `__tests__/auth/**` |
| A10 | Mutate `DEFAULT_TRUST_WINDOW_MS` to `12*60*60*1000*100000`, run `__tests__/auth/` | **≥1 failure** (was 0) |
| A11 | Mutate `DEFAULT_MAX_TRACKED_KEYS` to `10_000_000_000` | **≥1 failure** (was 0) |
| A12 | Mutate `secure:` to `false` — then to `true` | **≥1 failure each way** (was 0) |
| A13 | Mutate `return timingSafeEqual(a, b)` to `return submitted === configured` | **≥1 failure** (was 0) |
| A14 | Delete FIX 4's `globalTrustedMaxFailures` branch in `check()` | **13 failures** |
| A15 | `curl -X POST -H 'x-forwarded-for: <fresh>' -d '{"password":"<viewer>"}' /api/auth` | **200**, both `Set-Cookie` present |
| A16 | 12 wrong passwords from one address, then the CORRECT one | `401×10, 429×2`; correct → **429**, `retry-after` set, **zero Set-Cookie** |
| A17 | `curl -X POST -d 'not json' /api/auth` | **400** |
| A18 | `curl -X DELETE /api/auth` | **200**, two expiring `Set-Cookie`, body says it is not a revocation |
| A19 | 8 hostile `from` payloads through `POST /api/auth-form` with a valid password | `location: http://localhost:3000/` every time |
| A20 | `from=/settings` and `from=/p/limiglow/work?tab=1` through the same | preserved exactly |
| A21 | `DELETE /api/issues?id=TOD-NONEXISTENT-*` with viewer cred + `mc-role` ∈ {absent, `notarole`, `owner`} | **200 today** — this is §S1 and it is why A3 is red |
| A22 | Same with `mc-role=viewer` | **403** |
| A23 | `git status --short __tests__/auth/` | exactly 3 new files, no scratch/probe files left |

---

## 11. WHAT I DID NOT VERIFY — read this before scoring anything above

1. **No browser, so no client-side navigation was executed.** SEAM A's open
   redirect is established from (a) the source line and (b) the hostile value
   being delivered into the page. I did **not** watch a browser land on
   `evil.example.com`. The test is a source assertion and says so in its message.
2. **I did not run `npm run build`** — forbidden by the brief. So the §S2 SEAM A
   diff, which imports `app/api/auth-form/return-path.ts` from a `'use client'`
   component, is **type-checked but not build-checked**. The module is pure
   TypeScript with no server-only imports and `tsc --noEmit` is clean, but if the
   import location is objectionable the function should be re-exported from
   `lib/` — and `lib/` beyond three named files is outside this lane.
3. **The §S1 diff was verified against a scratch copy, not against the running
   server.** `middleware.ts` compiles into Next's edge runtime and I did not
   restart or rebuild the dev server with it applied. Whoever applies it should
   re-run `__tests__/rbac-middleware.test.ts` (51/51) and the acceptance harness.
4. **FIX 4's bound is per process and in memory**, unchanged from before. Two
   workers do not share it and a restart clears it. Only a durable store fixes
   that, and it belongs to Shape A.
5. **`secretEquals` still leaks LENGTH.** `timingSafeEqual` needs equal-size
   buffers. Closing that needs a fixed-width hash — Shape A.
6. **I did not test with `MC_MEMBER_PASSWORD` set.** It is unset on this host, so
   the member role is exercised only in unit tests with an injected value.
7. **I did not verify multi-process or Cloudflare-tunnel behaviour.** All HTTP
   measurements are against `localhost:3000` directly, so `cf-connecting-ip` was
   never the key `clientKey()` selected.
8. **`retryAfter` under the new hard ceiling is computed from the ceiling, not
   the cap.** It is correct arithmetic for the ceiling, but I did not measure
   the header end-to-end in the ceiling case specifically — only in the
   per-client and untrusted-global cases (A16).

---

## 12. Two things outside my ownership, reported not fixed

1. **A Limiglow fixture row disappeared during this wave.** The critic recorded
   two issue rows (`TOD-1`, archived, project Todero; and `TOD-368`, Limiglow).
   `db.sqlite` now holds **one**: `TOD-1`, `archived_at 2026-08-25 19:36:02`,
   untouched. My probes cannot have removed `TOD-368` — every write probe used
   `?id=TOD-NONEXISTENT-…` and `issues.id` is a UUID column, so it matched no
   row (and `{"ok":true}` came back for a delete that deleted nothing). I created
   no rows and deleted none. I cannot say which lane did.
2. **`DELETE /api/issues?id=<nonexistent>` answers `{"ok":true}`** for a row that
   does not exist. Not this lane's file; the critic flagged it too. It made every
   escalation probe above safe, which is convenient and is still wrong.
