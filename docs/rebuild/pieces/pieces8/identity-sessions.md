# Identity, Auth & Access Control — 7/8

**Lane:** identity-sessions · **Date:** 2026-08-26 · **Branch:** `rebuild/2026-08-24`

**Competitor benchmark:** builderz-labs — per-agent API keys and viewer/operator/admin
roles over real sessions, replacing three shared passwords that double as their own
tokens.

**What this lane did NOT do:** it did not build real sessions. It did not touch the
role model, the RBAC tables, or any of the six modules that read the session cookies.
The credential is still a shared password. See [§7 Plan](#7-plan-what-real-sessions-would-cost)
and [§8 Not verified](#8-what-i-did-not-verify).

**Files changed / added (the complete footprint):**

```
 M app/api/auth/route.ts
 M app/api/auth-form/route.ts
?? app/api/auth/rate-limit.ts
?? app/api/auth/session-cookies.ts
?? app/api/auth-form/return-path.ts
?? __tests__/auth/                     (4 files, 90 tests)
?? docs/rebuild/pieces/pieces8/identity-sessions.md
```

`lib/with-permission.ts`, `lib/session-actor.ts` and `lib/rbac-types.ts` are owned by
this lane and were deliberately left **byte-identical to HEAD**. Verify:

```
git diff --stat -- lib/with-permission.ts lib/session-actor.ts lib/rbac-types.ts
   -> empty
```

---

## 1. What the board said, and whether it was still true

The board says authentication is three shared passwords that double as their own
session tokens, with no users, no logout, and no rate limiting. **All four confirmed.**

| Claim | Verified how | Still true? |
|---|---|---|
| Three shared passwords | `app/api/auth/route.ts` maps `MC_PASSWORD`→owner, `MC_MEMBER_PASSWORD`→member, `MC_VIEWER_PASSWORD`→viewer | yes |
| The password IS the token | the same route sets `mc-auth` to the password *verbatim* (`cookieValue = OWNER_PASSWORD`) | yes |
| No users | no user/session table; `mc-role` is the only identity, and `lib/session-actor.ts` derives a *name* from the role, not from a person | yes |
| No logout | `grep -rn "logout\|signOut\|sign-out"` over the repo, excluding `node_modules`/`.next`, returned exactly one hit: the string `'Fix logout bug'` inside a memory-retrieval test fixture | yes — **there was no logout of any kind** |
| No rate limiting | measured, below | yes |

Two aggravating facts found while confirming this:

- **`mc-auth` is `httpOnly`.** Browser JavaScript cannot clear it. So before this
  change there was not merely "no logout button" — there was no mechanism by which a
  signed-in operator could stop being signed in, short of clearing site data by hand.
- **`MC_MEMBER_PASSWORD` is unset on this host.** `grep -a -o "^MC_[A-Z_]*" .env.local`
  returns only `MC_PASSWORD` and `MC_VIEWER_PASSWORD`. The member role is unreachable
  through login.

---

## 2. Measured — before

All run today, 2026-08-26, over real HTTP against the already-running dev server on
`http://localhost:3000`. No browser was used; this lane has no browser tool.

### 2a. Unlimited guessing on `POST /api/auth`

```
$ for i in 1..12; curl -s -o /dev/null -w "%{http_code}" -X POST /api/auth \
      -H 'Content-Type: application/json' -d '{"password":"wrong-N"}'
401 401 401 401 401 401 401 401 401 401 401 401

$ curl ... -d '{"password":"kaos2026"}'
200
```

Twelve wrong passwords in a row, twelve 401s, no throttle of any kind, and the correct
password immediately after answers 200. **This is an online brute force at network
speed against a password of `kaos2026`.**

### 2b. Unlimited guessing on `POST /api/auth-form` (the no-JS path)

```
$ for i in 1..20; curl -s -o /dev/null -w "%{http_code}" -X POST /api/auth-form \
      -d "password=badN&from=/"
303 303 303 303 303 303 303 303 303 303 303 303 303 303 303 303 303 303 303 303
```

Twenty attempts, no throttle. Worth stating plainly: **this endpoint is reachable
without JavaScript and was the unlimited door even if the JSON one had been guarded.**

### 2c. Open redirect on `POST /api/auth-form` — found while reading, then measured

The old code validated the post-login destination with `from.startsWith('/')`:

```ts
const redirectUrl = new URL(from.startsWith('/') ? from : '/', origin)
```

`//host` is a protocol-relative URL and the WHATWG URL parser normalises `\` to `/`
for http(s), so two shapes pass that check and still resolve to another origin.
Measured against the running server, **on the success path of a real login**:

```
from=//evil.example.com/x   ->  location: http://evil.example.com/x
from=/\evil.example.com     ->  location: http://evil.example.com/
```

Both `Location` values name a host that is not this app. A phishing link of the form
`/login?from=//attacker/...` sends the operator to the attacker's site **immediately
after they type the workspace password**, which is the moment they are least
suspicious of the page they land on.

Controls run at the same time, which did *not* escape: `from=https://evil.example.com`
→ `http://localhost:3000/`, `from=/%2F%2Fevil.example.com` → `http://localhost:3000/`.

> **Measurement caveat, stated because it bit me.** Some of my early `curl` probes on
> this Windows host were corrupted by Git Bash's MSYS path translation, which rewrites
> a bare `/settings` argument into `C:/Program Files/Git/settings` before curl runs.
> That made legitimate deep links *look* like they were being refused. I caught it by
> instrumenting my own route with a temporary debug header (since removed) that dumped
> the raw form value: `"raw":"C:/Program Files/Git/settings"`. **Every measurement in
> this document was re-run with `MSYS_NO_PATHCONV=1`.** The two escapes above are not
> affected — an off-origin `Location` cannot be produced by path mangling — but anyone
> reproducing this must export that variable or they will measure their shell.

---

## 3. What changed

### 3a. `app/api/auth/rate-limit.ts` (new) — brute-force limiting

A sliding-window failure counter with **two** counters that must both pass:

- **Per client**, keyed on `cf-connecting-ip` → `x-real-ip` → first `x-forwarded-for`
  hop → socket address → `"unknown"`. Default **10 failures / 15 min**.
- **Global**, unkeyed, across the whole endpoint. Default **100 failures / 15 min**.

The global counter exists because the per-client key is derived from proxy headers and
proxy headers are attacker-supplied: rotating `X-Forwarded-For` buys a fresh per-client
bucket every request. The global counter is the one that does not move for them.

Four design decisions worth arguing with:

1. **The check runs BEFORE the password is compared.** A limiter that runs after
   verification still lets the winning guess through — the only guess an attacker
   cares about. Consequence: a blocked client is refused *even with the right
   password*. Proven both ways in §4.
2. **Only failures are counted.** An operator who types the right password all day is
   never throttled.
3. **Success clears that client's history but NOT the global counter.** Otherwise
   anyone holding the read-only viewer password could reset the backstop at will and
   grind on the other two forever.
4. **There is no environment value that disables it.** `MC_AUTH_MAX_FAILURES`,
   `MC_AUTH_WINDOW_MS` and `MC_AUTH_GLOBAL_MAX_FAILURES` are clamped to sane ranges
   and fall back to the default on anything invalid — `0`, `-1`, `unlimited`, `NaN`,
   a float, empty. An off switch on a brute-force limiter is a hole with a name.

   > **CORRECTED 2026-08-26 (round 2) — true of the letter, false of the point.**
   > No value *disabled* it, but `MC_AUTH_WINDOW_MS` was clamped to a **minimum of
   > 1000 ms and accepted**, which multiplies the guessing budget by 900.
   > Measured with the real class under an injected clock: `MC_AUTH_WINDOW_MS=1000`
   > allowed **600 guesses per 60 simulated seconds = 864,000/day** for one
   > address. The test behind A15 only ever varied `MC_AUTH_MAX_FAILURES`, never
   > the window. Fixed — env may now only ever TIGHTEN — in **§10.3**.

**Known trade-off, deliberate:** the global backstop is a lockout. A determined
attacker can spend the global budget and deny logins to everyone until the window
drains. On a workspace with a handful of operators and a password like `kaos2026`,
a temporary inability to log in is the lesser harm against an unlimited guessing
budget. It is set high enough (100 / 15 min) that ordinary mistyping never reaches it.
**If you disagree with that ranking, this is the line to change.**

> **CORRECTED 2026-08-26 (round 2) — "temporary" was wrong, and so was the
> ranking.** The lockout is not temporary: an unauthenticated attacker who
> re-tops the global counter whenever a slot frees (~1 request/second) holds it
> shut **indefinitely**. Measured with the real class over ten full windows: the
> honest operator's **CORRECT** password was refused on **5,994 of 6,000**
> attempts — 99.9%. That is a workspace-wide denial of service from an
> unauthenticated stranger, with no allowlist and — by decision 4 above — no way
> to switch it off. Fixed in **§10.3**: a client that has itself authenticated
> recently is exempt from the GLOBAL counter, never from its own.

**The singleton is pinned to `globalThis`, and that is load-bearing.** My first
deployment of the limiter did nothing at all: ten wrong passwords still returned ten
401s with the code live (confirmed live by the new 400-on-malformed-body path
answering correctly at the same moment). Next's dev compiler re-evaluates the route
module, so a plain module-level `new AuthRateLimiter()` had every counter back at zero
between requests. Pinning it under `Symbol.for('todero.auth.rateLimiter')` fixed it.
This is the same reason the Prisma-client-singleton pattern exists.

### 3b. `app/api/auth-form/return-path.ts` (new) — the open redirect

`safeReturnPath(raw, origin)` reduces the submitted `from` to a **same-origin relative
path**, or to `/`. It refuses non-strings, anything over 2048 chars, any control
character (including the CR/LF used for header splitting), any string containing a
backslash, anything not starting with exactly one `/`, and — belt and braces — anything
whose resolved origin is not this origin.

> **CORRECTED 2026-08-26 (round 2) — the sentence that stood here was FALSE.**
> It read: *"The value returned is always relative, so the `Location` header
> cannot name another origin even if `origin` itself were influenced by a forged
> `Host`."* It was not: `safeReturnPath` returned `resolved.pathname` **without
> ever checking that value**, and `/..` normalisation makes that pathname
> protocol-relative. Six payloads escaped on the SUCCESS path of a real login.
> Measured, fixed and re-measured in **§10.1**.

It lives in its own module because App Router `route.ts` files may only export HTTP
method handlers, so the check could not be exported from `route.ts` to be tested.

### 3c. `app/api/auth/session-cookies.ts` (new) — one place that writes the pair

Both routes now set and clear `mc-auth`/`mc-role` through the same helpers, so a clear
carries the same `Path` and `SameSite` as the set — which is the condition for a
browser to actually drop the cookie. It also holds `secretEquals`, a
`crypto.timingSafeEqual` comparison replacing `===`.

`secretEquals` narrows the timing side channel; it does not close it, because unequal
*lengths* are still observable (`timingSafeEqual` requires equal-size buffers). Closing
it needs the stored credential to be a fixed-width hash — that is in the plan, not in
this change. It also refuses an empty/unset configured secret, so an unset
`MC_MEMBER_PASSWORD` cannot become a password of `""`.

### 3d. Logout — `DELETE /api/auth` and `POST /api/auth-form` with `intent=logout`

**Read this before calling it invalidation. It is not.**

What it does: server-issued `Set-Cookie` expiring both cookies with matching
attributes. That is the part that was previously *impossible* — `mc-auth` is
`httpOnly`, so no amount of client-side JavaScript could clear it.

What it does not do: invalidate the credential. The value inside `mc-auth` is a shared
workspace password. Anyone who kept a copy replays it and is still authenticated. I
measured that too, and it is in §4 as a failing-by-design row rather than omitted.

**Why `DELETE /api/auth` and not `POST /api/auth/logout`.** `middleware.ts` exempts
exactly the two literal paths `/api/auth` and `/api/auth-form` from the session gate,
and separately refuses **every write method from a `viewer`** on any other `/api/`
path. A logout at its own path would therefore answer 403 for the one role most likely
to be sharing a machine. Fixing that needs an edit to `middleware.ts`, which this lane
does not own. `DELETE /api/auth` needs no seam and works for every role today. The
friendlier path is offered as an optional seam diff in §6.

### 3e. Smaller hardening in the same two routes

- A malformed JSON body on `POST /api/auth` was an unhandled throw (a 500). It is now
  a 400, and it is counted as a failed attempt.
- `typeof password === 'string'` guard before comparison.
- The 429 body is byte-identical whether or not the submitted password was correct, so
  the refusal does not become an oracle.

### 3f. Deliberately NOT changed — three findings written up instead of fixed

1. **`/api/auth-form` maps the owner password to role `admin`, while `/api/auth` maps
   the same password to `owner`.** `admin` is the *weaker* of the two —
   `lib/rbac-types.ts` grants it neither `roles:admin` nor `projects:admin` nor
   `issues:admin`. "Fixing" the inconsistency would **widen** what a no-JS login can
   do. That is a decision for whoever owns the role model. Left alone.

   > **CORRECTED 2026-08-26 (round 2) — the fact is true, the ARGUMENT was void.**
   > `admin` really does hold fewer permissions than `owner`. But `mc-role` is a
   > cookie the client types, so a no-JS login handed `mc-role=admin` simply
   > rewrote it, and issuing the weaker word bought nothing. Measured with the
   > READ-ONLY viewer password: `mc-role=viewer` → 403, `mc-role=admin` → the
   > handler. What actually closes it is refusing to treat the cookie as
   > authoritative — **§10.2**. The mapping is still left alone, but now for a
   > reason that survives reading the code.
2. **`/api/auth-form` does not accept `MC_MEMBER_PASSWORD` at all.** Adding it widens
   the no-JS surface. Left alone.
3. **`MC_PASSWORD` in `.env.local` is the literal default `kaos2026`** — proven,
   because that value authenticates against the running server and the route reads the
   env var in preference to its fallback. `view2026` likewise. Not this lane's file to
   change, and rotating it is an operational act, not a code change.

---

## 4. Measured — after

Every refusal proven **both ways**: the denied case gets a real refusal status, and the
allowed case still succeeds. All run today against the running server with
`MSYS_NO_PATHCONV=1`.

### 4a. Rate limiting on `POST /api/auth`

```
12 wrong from 203.0.113.20 (limit 10):
401 401 401 401 401 401 401 401 401 401 429 429

CORRECT password from that blocked address:
HTTP/1.1 429 Too Many Requests
retry-after: 883
{"error":"Too many login attempts. Try again later.","code":"RATE_LIMITED","retry_after_seconds":883}
   -> no Set-Cookie at all

CORRECT password from a FRESH address 203.0.113.21:
HTTP/1.1 200 OK
set-cookie: mc-auth=kaos2026; Path=/; ... HttpOnly; SameSite=strict
set-cookie: mc-role=owner;  Path=/; ... SameSite=strict
{"ok":true,"role":"owner"}

VIEWER password from a fresh address:      {"ok":true,"role":"viewer"}  [200]
one wrong then correct from a fresh address: wrong=401 right=200
```

`retry-after: 883` is ~14m43s, consistent with a 15-minute window nearly full.

### 4b. Rate limiting on `POST /api/auth-form`

```
12 wrong from 203.0.113.30:   303 x12   (this endpoint answers by redirect either way)

CORRECT password from that blocked address:
  HTTP/1.1 303
  location: .../login?error=1&rate_limited=1&retry_after=894
  retry-after: 894
  -> NO Set-Cookie

CORRECT password from FRESH 203.0.113.31:
  HTTP/1.1 303
  location: http://localhost:3000/
  set-cookie: mc-auth=...; set-cookie: mc-role=admin
```

The status code is 303 in both cases because this is a form endpoint. **The thing that
actually differs is the presence of `Set-Cookie`** — that is the assertion to check,
not the status.

### 4c. Open redirect, closed — and deep links still work

> **CORRECTED 2026-08-26 (round 2).** This section claimed the hole was closed.
> It was not — the table below is accurate for the payloads it lists, and those
> were the only payloads tried. `/..//evil.example.com` and five siblings
> still escaped.
> The complete list, the cause, and the re-measurement are in **§10.1**.

```
/settings                  -> location: http://localhost:3000/settings
/work/epics                -> location: http://localhost:3000/work/epics
/p/limiglow/work?tab=1     -> location: http://localhost:3000/p/limiglow/work?tab=1
//evil.example.com/x       -> location: http://localhost:3000/
/\evil.example.com         -> location: http://localhost:3000/
https://evil.example.com   -> location: http://localhost:3000/
///evil.example.com        -> location: http://localhost:3000/
```

The first three rows are the half that matters as much as the last four: a "fix" that
always returns `/` would close the hole and break every deep link.

### 4d. Logout, end to end — including what it does not do

```
1. login (cookie jar)                       -> 200
   jar: mc-role owner / mc-auth kaos2026
2. GET /api/projects with jar               -> 200
3. DELETE /api/auth                         -> 200
   set-cookie: mc-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=strict
   set-cookie: mc-role=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=strict
   jar afterwards: (mc-auth removed from jar)
4. GET /api/projects with the same jar      -> 401
5. replay the OLD cookie VALUE by hand      -> 200      <-- NOT INVALIDATION
6. POST /api/auth-form intent=logout        -> 303 -> /login, both cookies expired
```

**Row 5 is the honest result and I am not burying it.** The brief asked me to prove
the old cookie no longer works. It still works. It cannot be made not to work while
the cookie value is a shared constant — killing that value logs out every holder of
that role simultaneously, which is not logout, it is a password rotation. What rows
1–4 prove is that the *browser's* copy is gone and the session is over for the person
sitting at the machine. That is a real gap closed (§1: there was previously no
mechanism at all) and it is strictly less than invalidation.

---

## 5. Acceptance — checkable without trusting anything above

Each row is a command and its expected result. Run from the repo root with the dev
server up. **Export `MSYS_NO_PATHCONV=1` first on Windows** or you will measure Git
Bash instead of the app (§2c).

| # | Check | Expected |
|---|---|---|
| A1 | `git diff --stat -- lib/with-permission.ts lib/session-actor.ts lib/rbac-types.ts` | empty — the three RBAC libs are untouched |
| A2 | `git status --porcelain` | changed files are exactly the seven in the header; no `middleware.ts`, no `app/page.tsx`, no `components/nav/config.ts` |
| A3 | `npx jest __tests__/auth/` | 4 suites, 90 tests, all passing |
| A4 | `node scripts/acceptance/run.mjs` | 45/45, harness 10/10, with **both** `dispatch-guard-armed` and `dispatch-guard-untouched` PASS |
| A5 | `bash scripts/smoke-test-layout.sh` | nine guards, all ✅ |
| A6 | `grep -rn "TODERO_DISPATCH_ENABLED" lib/dispatch-guard.ts` then `git diff -- lib/dispatch-guard.ts` | second command empty — the kill switch was not touched |
| A7 | 11 wrong passwords to `POST /api/auth` from one `X-Forwarded-For` | first 10 → 401, 11th → 429 with a `Retry-After` header |
| A8 | correct password from that same address | **429**, and zero `Set-Cookie` headers |
| A9 | correct password from a different `X-Forwarded-For` | 200 + `mc-auth` and `mc-role` cookies |
| A10 | `POST /api/auth-form` with `from=//evil.example.com/x` and the right password | `Location` host is `localhost:3000`, never `evil.example.com`. **INSUFFICIENT — see A18 in §10.6.** This row passed while the redirect was still open, because it tried only the payload the fix was written against. |
| A11 | same with `from=/work/epics` | `Location: http://localhost:3000/work/epics` — deep links are not collateral damage |
| A12 | `DELETE /api/auth` | 200; two `Set-Cookie` with `Max-Age=0` and `Expires=Thu, 01 Jan 1970`; `Path=/` on both; `HttpOnly` on `mc-auth` |
| A13 | login with a cookie jar → `GET /api/projects` → `DELETE /api/auth` → `GET /api/projects` with the same jar | 200, then 401 |
| A14 | `curl -H 'Cookie: mc-auth=kaos2026; mc-role=owner' /api/projects` after a logout | **200** — this is expected and is the documented limitation, not a regression |
| A15 | `npx jest __tests__/auth/rate-limit.test.ts -t "no environment value that disables"` | passes — `0`, `-1`, `false`, `off`, `unlimited` all fall back to the default of 10. (Checked in Jest rather than over HTTP because the env is read at construction and the dev server may not be restarted in this wave.) |
| A16 | `POST /api/auth` with body `not json` | 400, not 500 |
| A17 | `grep -rn "x-debug-from" app/` | empty — the temporary instrumentation from §2c is gone |

Two properties a critic should try to break rather than confirm:

- **A8 is the load-bearing one.** If a blocked client can still log in with the right
  password, the limiter is decorative.
- **A11 is the other one.** If deep links collapse to `/`, the redirect fix is a
  regression wearing a security hat.

---

## 6. Seam diffs — for the orchestrator

### SEAM-1 (**security, not cosmetic**): the JS login path still has an open redirect

`app/login/LoginForm.tsx` is not owned by this lane and **my fix does not cover it**.
The no-JS path posts `from` to the server, which now sanitises it. The JavaScript path
never sends `from` to the server at all — it navigates client-side:

```tsx
// app/login/LoginForm.tsx, in handleSubmit, after res.ok:
window.location.href = from
```

`from` originates in `app/login/page.tsx` as `searchParams?.from ?? '/'` — fully
attacker-controlled via `/login?from=...`. So `https://kaos.nabit.work/login?from=https://evil.example.com`
still hands the operator to the attacker's site immediately after they authenticate,
for every user with JavaScript enabled, which is all of them.

**This is a code read, not a measurement — I have no browser tool and cannot execute a
client-side navigation.** It should be reproduced in a browser before and after.

Proposed diff (owner of `app/login/**` should apply; it reuses the module this lane
added, so no logic is duplicated):

```diff
--- a/app/login/LoginForm.tsx
+++ b/app/login/LoginForm.tsx
@@
 import { Button } from '@/components/ui'
 import { Input } from '@/components/ui'
+import { safeReturnPath } from '@/app/api/auth-form/return-path'
@@
     if (res.ok) {
-      window.location.href = from
+      // `from` comes from ?from= and is attacker-controlled. The no-JS path is
+      // sanitised server-side in app/api/auth-form/route.ts; this is the same
+      // check for the path that never reaches the server.
+      window.location.href = safeReturnPath(from, window.location.origin)
     } else {
```

`return-path.ts` has no server-only imports (no `next/server`, no `crypto`), so it is
safe to import into a `'use client'` file. I did not apply this and did not verify the
import graph under the client bundler.

### SEAM-2 (optional, ergonomics): a friendlier logout path

`DELETE /api/auth` works today for every role and needs nothing. If a
`POST /api/auth/logout` is preferred, `middleware.ts` must exempt it, or a `viewer`
gets 403 (see §3d):

```diff
--- a/middleware.ts
+++ b/middleware.ts
@@
   // Unauthenticated endpoints: the login handshake itself.
-  if (pathname === '/api/auth' || pathname === '/api/auth-form') {
+  // `/api/auth/logout` is here for the same reason as the other two: it is part
+  // of the handshake. It reads nothing and writes nothing — it only emits
+  // expiring Set-Cookie headers — so exempting it grants no data access. Without
+  // the exemption the WRITE_METHODS branch below refuses a `viewer` POST with
+  // 403, i.e. the read-only role could not sign out.
+  if (pathname === '/api/auth' || pathname === '/api/auth-form' || pathname === '/api/auth/logout') {
     return NextResponse.next()
   }
```

**Do not apply SEAM-2 without also adding the route** — as written it would exempt a
path that 404s. This lane did not add it, precisely to avoid needing the seam.

### SEAM-3 (no diff — a decision, not an edit)

The role-mapping inconsistency in §3f.1: `/api/auth-form` issues `mc-role=admin` where
`/api/auth` issues `mc-role=owner` for the same password. Changing it widens. Someone
who owns the role model should decide whether the no-JS path is meant to be weaker.

---

## 7. Plan: what real sessions would cost

Written as a plan, not started, per the brief — a session-table migration in a wave
with nine lanes writing is how you get a two-dialect migration collision.

### 7.1 The blocker nobody will expect

`middleware.ts` is the **primary** authentication gate: it 401s every `/api/` request
without a valid session before any route handler runs. Next.js middleware in this app's
version (`next: ^14.2.35`) executes in the **Edge runtime**. Node-only APIs are
unavailable there, which means the gate **cannot open a `better-sqlite3` connection,
cannot reach the Postgres/PGlite adapters, and cannot read any Node-side in-memory
store.** (Node middleware is an experimental Next 15.2+ feature; this repo pins no
`runtime` export on `middleware.ts` and sets no related experimental flag —
`grep -rn "export const runtime" middleware.ts` is empty.)

**Therefore a session table alone does not give you revocation.** You could write
`sessions` rows all day and the gate that actually refuses requests would never be
able to consult them. This is the single most important thing to know before starting,
and it is the reason this lane stopped at a cookie clear instead of shipping half a
revocation and calling it logout.

**I have not empirically measured the middleware runtime** — see §8. Measure it before
committing to a design.

### 7.2 Two viable shapes

**Shape A — stateless, short-lived, signed tokens.** `mc-auth` stops being the password
and becomes `HMAC-SHA256(secret, {sub, role, iat, exp, sid})`. The Edge runtime *does*
have Web Crypto, so middleware can verify a signature and an expiry with no store at
all. Revocation becomes "the token expires in 15 minutes and the refresh is refused",
which is bounded rather than instant.

- Pro: keeps the gate where it is; no per-request DB read on the hot path.
- Con: revocation is not instant. A stolen token is good until `exp`.
- Con: needs a refresh endpoint and a real `SESSION_SECRET`, which must fail closed
  when unset — never fall back to a literal, which is the mistake this codebase already
  makes with `?? 'kaos2026'` in five places.

**Shape B — stateful sessions with the gate moved.** Sessions table, opaque random
`sid` in the cookie, revocation instant. Requires moving the auth gate out of
middleware into a Node-side wrapper — `lib/with-permission.ts` is the natural home and
this lane owns it — and then middleware degrades to routing only.

- Pro: real logout, "sign out everywhere", per-session audit, and it is the shape that
  gets you to the benchmark's per-agent API keys.
- Con: **every route must be wrapped or it is unguarded.** Middleware's virtue is that
  it cannot be forgotten. Moving the gate to a per-route wrapper converts "protected by
  default" into "protected if someone remembered", and that trade is the whole risk.
  It needs a guard script in `scripts/` that fails CI when an `app/api/**/route.ts`
  exports a handler that is not wrapped — in the same family as the existing
  `no-unscoped-issues.mjs`.

**Recommendation: A first, then B.** Shape A can ship without moving the gate and
without a migration, and it kills the "cookie is the password" property immediately —
which is the actual headline defect. Shape B is a follow-on once a guard script makes
per-route wrapping safe.

### 7.3 What breaks, concretely

Six modules compare `mc-auth` against a password. Every one of them changes under
either shape, and **any one missed becomes a bypass or a lockout**:

| File | What it does today |
|---|---|
| `middleware.ts` | `hasValidSession()` — the 401 gate for all `/api/` |
| `lib/rbac-middleware.ts` | validates `mc-auth` against known passwords |
| `lib/with-permission.ts` | `resolveRole()` — session beats `X-Agent-Role` |
| `lib/session-actor.ts` | `hasSession()` / `resolveSessionActor()` |
| `lib/permission-check.ts` | reads `mc-role` |
| `app/api/db/[...path]/route.ts` | requires a valid `mc-auth` for the browser proxy |

Plus, outside the app: `scripts/acceptance/checks.mjs`, `checks-truth.mjs`,
`checks-anywhere.mjs` and `ship-gate.mjs` all send the literal
`cookie: 'mc-auth=kaos2026; mc-role=owner'`. **The acceptance harness authenticates by
knowing the password.** Under either shape it must mint a token instead, and that is a
change to the harness the orchestrator owns — the migration is not done when the app
compiles.

Also: `lib/with-permission.ts` currently accepts an `X-Agent-Role` header, with no
secret, whenever there is no valid session. Agent identity is a *claim*. The
benchmark's per-agent API keys are exactly the fix, and they belong in the same piece
of work as sessions rather than after it.

### 7.4 Sequencing

1. Measure the middleware runtime (§7.1). Everything downstream depends on the answer.
2. `SESSION_SECRET` that fails closed when unset. Remove `?? 'kaos2026'`-style
   literals from the auth path.
3. Shape A, both routes, both gates, harness updated in the same change.
4. Guard script: every `app/api/**/route.ts` handler is wrapped.
5. Shape B: `sessions` + `agent_keys` tables, two-dialect migrations
   (`migrations/NNN_*.sql` **and** `migrations/sqlite/NNN_*.sql`), gate moved.
6. Per-agent keys replace `X-Agent-Role`.

Steps 2–6 are each their own wave. Do not bundle them.

---

## 8. What I did NOT verify

Stated plainly, because a security write-up that only lists what worked is a sales
document.

1. **No browser, no DOM evidence, anywhere in this document.** This lane has no browser
   tool. Everything above is HTTP or Node. The login page rendering, the cookie
   actually disappearing from a real browser's jar, and SEAM-1's client-side redirect
   are all **unverified in a browser**. `curl`'s cookie jar honouring `Max-Age=0` is
   good evidence for A13 but it is not Chrome.
2. **No UI calls the new logout.** There is no sign-out button anywhere in the app.
   `DELETE /api/auth` and `intent=logout` exist and work; nothing in
   `components/` or `app/` invokes them. Wiring a button touches files this lane does
   not own. **Logout is reachable by API only until someone adds the control.**
3. **Rate-limit recovery was never observed over HTTP.** The default window is 15
   minutes and the dev server must stay up, so I could not wait it out or restart with
   a shorter window. Recovery is proven only in Jest with an injected clock
   (`__tests__/auth/rate-limit.test.ts`, "RECOVERS once the window drains", "slides
   rather than resetting wholesale", "retryAfterSeconds points at the moment the block
   actually lifts"). **The window has not been watched draining against the real
   server.**
4. **Single-process only, and unverified beyond one process.** The limiter is in-memory
   on `globalThis`. I did not test two Node workers, `next start` (only `next dev`), or
   a restart. A restart clears the budget; that is a documented weakness, not a bug I
   fixed.
5. **The `globalThis` pin was verified in dev only.** I verified it fixes counting
   under `next dev`. I did not verify behaviour under `npm run build && npm start` —
   **I am forbidden from running `npm run build` in this wave.**
6. **Spoofing the per-client key was not measured end to end.** The global backstop is
   proven in Jest against rotated keys; I did not run a live header-rotating attack
   against the server.
7. **Timing was not measured.** `secretEquals` is `timingSafeEqual`, but I ran no
   timing experiment showing the side channel is actually reduced, and the length
   channel is knowingly still open.
8. **No CSRF analysis of the new logout endpoints.** Both are reachable without a
   session (they sit on middleware-exempt paths). A cross-site POST could sign a user
   out. `SameSite=strict` on the cookies makes this awkward but I did not test it. The
   impact is a nuisance, not a privilege gain — **but I did not prove that, I reasoned
   it.**
9. **The pre-fix open redirect (§2c) cannot be re-measured**, because the vulnerable
   code is gone and I will not reintroduce it on a live server to re-demonstrate it.
   The two off-origin `Location` values in §2c are the record. The *fix* is measured
   directly (§4c) and pinned by tests.
10. **`npm test` failures.** The failure set moved twice under me while other lanes
    landed work, so judge by the set, not the total. At the **start** of this lane:
    `agents-route`, `agents-unconfigured`, `spawn-live` (5 failed / 1163 passed / 1170
    total). **Mid-session** the agents pair was fixed by another lane and
    `commerce-permissions` + `commerce-audit-atomicity` appeared, both failing on a
    **409** from a compare-and-swap in `app/api/commerce/orders/route.ts` — another
    lane's in-flight file, modified in the working tree. **Final:** those were fixed
    too, leaving `spawn-live` alone (1 failed / 1566 passed / 1569 total). At no point
    was a failure in this lane's files, and at no point was any failure a **403** —
    i.e. no permission check failed at any stage. I investigated none of them and
    touched none of them.
11. **Fixtures:** none. This lane created no database rows in `Limiglow` or anywhere
    else — every probe was `POST /api/auth`, `POST /api/auth-form`, or an authenticated
    `GET`. Nothing to clean up, and `TOD-1` was never touched.

---

## 9. Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | 1 suite failed, 1 skipped, 82 passed of 84; **1 failed**, 2 skipped, **1566 passed** of 1569. Only failure: `__tests__/runtimes/spawn-live.test.ts`, a known baseline failure, not in this lane (see §8.10 for how the set moved during the session) |
| `npx jest __tests__/auth/` | **4 suites, 90 tests, all passing** |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** — `dispatch-guard-armed` PASS, `dispatch-guard-untouched` PASS |
| `bash scripts/smoke-test-layout.sh` | **all nine guards ✅** |

`lib/dispatch-guard.ts` and `TODERO_DISPATCH_ENABLED` were not touched.

---

## 10. Round 2 — 2026-08-26

Everything in this section was measured **today, by me**, against the dev server
already running on `http://localhost:3000`, with `MSYS_NO_PATHCONV=1` exported
(§2c). No browser was used; this lane still has no browser tool, so there is no
DOM-level evidence anywhere below and none is claimed.

A fresh critic scored the piece 4/10 and named six fabrications. **I verified
every one before changing anything.** Five were correct, one was correct in
substance but wrong in its stated figure, and two of the critic's framings are
wrong on the facts — said plainly in §10.5. I also found two defects the critic
did not, both inside files this lane owns.

### 10.0 Verdict on each relayed claim

| # | Critic's claim | My measurement | Verdict |
|---|---|---|---|
| 1 | `safeReturnPath` returns a value that re-resolves off-origin | `POST /api/auth-form`, correct password, `from=/..//evil.example.com/steal?x=1` → `303` + `location: http://evil.example.com/steal?x=1` + both `Set-Cookie` | **CONFIRMED** |
| 2 | Six further payloads escape | All six reproduced live on the success path (table in §10.1) | **CONFIRMED** |
| 3 | The cookie is an unthrottled password oracle that bypasses the limiter | 30 wrong `mc-auth` values to `GET /api/projects` → **30 unthrottled 401s**; correct → **200**. `/settings`: 307 wrong, 200 right | **CONFIRMED** |
| 4 | `MC_AUTH_WINDOW_MS=1000` is accepted → 864,000 guesses/day | Real class, injected clock: **600 allowed per 60 simulated seconds = 864,000/day.** Exactly the critic's number | **CONFIRMED** |
| 5 | Global lockout denies the honest operator 100.0% of the time | Real class, 10 windows, attacker re-topping ahead of the operator: **5,994 / 6,000 = 99.9%**. With the attacker topping up *after* the operator's attempt I measured 90.0%, so the exact figure depends on interleaving — the substance is confirmed, the flat "100.0%" is not reproducible as a constant | **CONFIRMED (99.9%, not 100.0%)** |
| 6 | The `admin`-vs-`owner` justification is a void argument | `mc-auth=view2026; mc-role=viewer` → 403; `mc-role=admin` → handler reached. The *fact* (`admin` ⊂ `owner` in `rbac-types.ts`) is true; the *argument* built on it was void | **CONFIRMED as void argument** |
| — | *"`lib/with-permission.ts:50` still accepts an **unauthenticated** `X-Agent-Role` header as agent identity"* | **Wrong.** With no cookie at all, `PATCH /api/commerce/products -H 'X-Agent-Role: owner'` → **401** from `middleware.ts` before `with-permission.ts` runs. It is not an anonymous front door | **CRITIC INCORRECT — §10.5** |
| — | *"`mc-role` is set `httpOnly:false` … and is the SOLE input to authorization"* | Half right. It **was** the sole input, and that is the real defect. But `httpOnly` is irrelevant to it: the attack is a request the attacker composes, so a flag that only governs `document.cookie` changes nothing — and flipping it would **break** `app/page.tsx:419-421`, which reads it for RBAC-aware UI | **DIAGNOSIS RIGHT, CAUSE WRONG — §10.2** |

### 10.1 The open redirect, actually closed this time

The first fix checked the **input** and returned `resolved.pathname` **unchecked**.
`/..` at the root pops nothing and the parser keeps the doubled slash that
follows, so an input passing every input guard comes back as a *protocol-relative*
output — which the route then re-resolved at `route.ts`'s `new URL(from, origin)`.

Measured live on the SUCCESS path of a real login, **before** (both `Set-Cookie`
headers present on every row) and **after**:

| `from=` | before | after |
|---|---|---|
| `/..//evil.example.com/steal?x=1` | `http://evil.example.com/steal?x=1` | `http://localhost:3000/` |
| `/a/..//evil.example.com` | `http://evil.example.com/` | `http://localhost:3000/` |
| `/./..//evil.example.com` | `http://evil.example.com/` | `http://localhost:3000/` |
| `/../..//evil.example.com` | `http://evil.example.com/` | `http://localhost:3000/` |
| `/..///evil.example.com` | `http://evil.example.com/` | `http://localhost:3000/` |
| `/..//evil.example.com:8080/x` | `http://evil.example.com:8080/x` | `http://localhost:3000/` |
| `//evil.example.com/x` | `http://localhost:3000/` | `http://localhost:3000/` |
| `/\evil.example.com` | `http://localhost:3000/` | `http://localhost:3000/` |
| `/settings` | `.../settings` | `.../settings` |
| `/work/epics` | `.../work/epics` | `.../work/epics` |
| `/p/limiglow/work?tab=1` | preserved | preserved |

**What changed.** `isSameOriginRelative()` now validates the **output**, because
that is the value the caller feeds back into `new URL(..., origin)`. A second
guard, `safeRedirectUrl()`, does the final resolution inside the module, so the
route cannot reintroduce the bug by re-resolving a value itself. The three input
guards are kept as defence in depth and are now labelled as redundant on purpose.

**The test that should have caught it, and why it did not.** `return-path.test.ts`'s
"never returns a value that resolves off-origin" iterated the same 14-row table
the preceding test had already asserted equals `/` — it explored nothing.
`__tests__/auth/return-path-escape.test.ts` replaces it with a real generator
(**8,829 inputs**, counted by running the generator; the test asserts `> 2000`) plus a guard-the-guard test proving the
generator still contains shapes the old code let through. **Mutation-tested:**
deleting both output checks turns the auth suite red with **9 failures**;
restored, 110/110 green. Each input guard now also has a payload only it rejects.

### 10.2 The biggest gap, as far as this lane's ownership reaches

`mc-role` is a cookie the client types, and the server treated it as
authoritative. Two files this lane owns did so, and **both are now fixed**.

**(a) `lib/with-permission.ts` — privilege escalation.** Measured live against
`PATCH /api/commerce/products`, a route this file guards, with the READ-ONLY
viewer password and one cookie value as the only variable:

```
BEFORE  mc-auth=view2026; mc-role=viewer -> 403 "Read-only access"
        mc-auth=view2026; mc-role=admin  -> reaches the handler, commerce:write granted
AFTER   mc-auth=view2026; mc-role=viewer -> 403 "Read-only access"
        mc-auth=view2026; mc-role=admin  -> 403 PERMISSION_DENIED, role resolved as "viewer"
        mc-auth=view2026; mc-role=owner  -> 403   (also god, member, tron, defaultbot)
```

**(b) `lib/session-actor.ts` — forged provenance. The critic did not find this
one.** `resolveSessionActor` read `mc-role` directly to decide which **human
name** to write into `issues.transitioned_by`. Measured with the real module:

```
BEFORE  mc-auth=view2026; mc-role=owner -> "michael"     (the workspace owner)
        mc-auth=view2026; mc-role=admin -> "michael"
AFTER   both -> undefined
        mc-auth=kaos2026; mc-role=owner -> "michael"     (unchanged, as it must be)
        mc-auth=kaos2026; mc-role=admin -> "michael"     (legacy no-JS word, unchanged)
```

That is worse than an access-control bug: it wrote a false name into the workflow
audit trail, and `isOwnerActor()` then treats that name as the owner's admin
bypass downstream.

**The fix reuses an existing implementation rather than inventing a rival.**
`resolveDecisionRole()` in `lib/approvals.ts` already derives the role from the
CREDENTIAL and lets `mc-role` only ever narrow it, and the piece that added it
filed a seam request asking this file to adopt it (see `app/api/inbox/actor.ts`'s
header: *"THIS DOES NOT FIX THE OTHER ROUTES"*). **This lane closes that seam
from its side.** One rule, one implementation, three call sites.

**One deliberate behaviour change, not buried:** the owner password now resolves
to `owner` where `with-permission.ts` privately called it `admin`.
`ROLE_PERMISSIONS.owner` is a strict superset of `ROLE_PERMISSIONS.admin`, so
nothing loses access, and no caller compares the result to the literal `'admin'`
(checked: `grep -rn "role === 'admin'" app/ lib/` finds only
`lib/rbac-middleware.ts`, which uses its own separate `resolveRole`). **Visible
consequence:** `app/api/agent-responsibilities/route.ts` stores `resolveRole(req)`
in `assigned_by`, so new rows from an owner session read `owner`, not `admin`.

A refused escalation now says so in the 403 body rather than being silently
downgraded, so a caller cannot mistake the check for a bug.

### 10.3 The limiter: three defects, and a fourth nobody had named

1. **Env could WIDEN it.** `MC_AUTH_WINDOW_MS` was clamped to a *minimum* of
   1000 ms and accepted → 864,000 guesses/day. Each variable is now bounded on
   the side that makes the limiter **stricter**, so no setting can enlarge the
   budget. A sweep of 12 env values now asserts the budget is identical to the
   default.
2. **The workspace-wide DoS.** Fixed by exempting a client that has **itself**
   authenticated successfully within `trustWindowMs` (12 h) from the **GLOBAL**
   counter — never from its own per-client counter. Re-measured with the same
   siege: honest operator refused **0 / 600**, stranger still refused **600 / 600**.
3. **NEW — found by me, not relayed: holding one password bought unlimited
   guesses at the other two.** `recordSuccess` deleted the client's whole failure
   history unconditionally, so anyone holding the read-only viewer password could
   interleave one correct login every ten guesses and grind forever, bounded only
   by the global counter — which is exactly the counter fix 2 exempts them from.
   **Fixing 2 without this would have opened a hole, not closed one.** Forgiveness
   is now once per window per key: bounded at 2x `maxFailures`, honest
   mistype-then-success unaffected.
4. **NEW — unbounded memory.** My first draft trimmed the new `trusted` map only
   when `perClient` was over capacity, and `recordSuccess` empties `perClient` —
   and successes are deliberately not rate limited. A password holder rotating
   `X-Forwarded-For` could have grown it without limit. The three maps are now
   bounded independently.

**The false claim in that file's header is gone.** It said this module was *"the
only thing standing between that and an online guessing attack."* It is not, and
§10.4 is why.

### 10.4 STILL OPEN — and it is the headline. `middleware.ts` is not ours.

Two things remain broken, and **both need one edit to a file this lane does not
own.** Nothing below is fixed; all of it is measured as still live **after** all
the changes above.

1. **The cookie is an unthrottled password oracle.** `mc-auth` *is* the password,
   so `middleware.ts:171 hasValidSession()` compares a guess against all three
   passwords on **every** `/api/` request. Measured today: 30 wrong values → 30
   unthrottled 401s; the correct value → 200. **The login rate limiter is
   irrelevant to an attacker who uses this door instead.**
2. **The forged role still escalates on routes middleware alone guards.**
   Measured today, after §10.2, with the READ-ONLY viewer password:

   ```
   DELETE /api/issues?id=...   mc-role=viewer -> 403      mc-role=owner -> 200
   POST   /api/roles           mc-role=viewer -> 403      mc-role=owner -> 400 (handler reached)
   ```

   `withPermission` is not on these paths, so §10.2's fix cannot reach them.

   **Read the 200 precisely:** it proves the *gate* admitted the request, not
   that a row was destroyed. The id is deliberately nonexistent
   (`TOD-NONEXISTENT-PROBE-7of8`) and no fixture was created or removed. The
   differential — the SAME credential answering 403 with the honest cookie and
   200 with the forged one — is the finding, and it does not depend on what the
   handler then did.

**SEAM-4 (security, blocking) — the exact change requested.** Both are killed by
the same move: Shape A from §7.2, `mc-auth` carrying an HMAC token instead of the
password. That is a change to `middleware.ts` **and** to the acceptance harness
(§7.3: `checks.mjs`, `checks-truth.mjs`, `checks-anywhere.mjs`, `ship-gate.mjs`
all authenticate by knowing the literal password), so it cannot be done from
inside this lane's file list. **This piece is INCOMPLETE until it lands.**

The minimum interim change, which fixes (2) alone and needs no token, no
migration and no harness change — `middleware.ts` stops trusting the cookie and
derives the role from the credential, exactly as this lane's files now do:

```diff
--- a/middleware.ts
+++ b/middleware.ts
@@
+import { resolveDecisionRole } from '@/lib/approvals'
+
-/** Read and validate the mc-role cookie. Returns null if missing/unrecognised. */
-function getRoleFromCookie(req: NextRequest): Role | null {
-  const raw = req.cookies.get('mc-role')?.value
-  if (!raw) return null
-  const known: Role[] = ['owner', 'member', 'viewer', 'god', 'admin', 'tron', 'defaultbot']
-  return known.includes(raw as Role) ? (raw as Role) : null
-}
+/**
+ * The role this request may act with.
+ *
+ * NOT read from the `mc-role` cookie. That cookie is a string the client types,
+ * and reading it directly was a privilege escalation: measured 2026-08-26 with
+ * the READ-ONLY viewer password, one cookie value as the only variable --
+ *   DELETE /api/issues  mc-role=viewer -> 403   mc-role=owner -> 200
+ *   POST   /api/roles   mc-role=viewer -> 403   mc-role=owner -> 400 (reached)
+ * The role comes from the CREDENTIAL; `mc-role` may only ever narrow it.
+ * `resolveDecisionRole` is pure and imports only lib/rbac-types, so it is safe
+ * in the Edge runtime -- no node:crypto, no Buffer, no DB.
+ */
+function getRoleFromCookie(req: NextRequest): Role | null {
+  return resolveDecisionRole(
+    {
+      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
+      claimedRole: req.cookies.get('mc-role')?.value ?? null,
+      agentRoleHeader: null,
+    },
+    {
+      ownerPassword: ADMIN_PASSWORD,
+      viewerPassword: VIEWER_PASSWORD,
+      memberPassword: process.env.MC_MEMBER_PASSWORD || null,
+    },
+  ).role
+}
```

**Verify Edge-safety before applying — I could not.** `lib/approvals.ts` imports
only `lib/rbac-types.ts` and uses no Node API (checked by reading both files),
but I have **not** run it in the Edge runtime, and §7.1's warning about that
runtime is exactly why this diff is a request rather than a change.

One consequence to expect: the owner password would resolve to `owner` rather
than `admin` at the gate too, which is a widening **at that gate** (`owner` has
`roles:admin`, `admin` does not) — for the credential that is already the
owner's. Whoever applies it should confirm that is intended.

### 10.5 Where the critic was wrong

**`X-Agent-Role` is not an anonymous front door.** The critic wrote that
`lib/with-permission.ts:50` *"still accepts an unauthenticated `X-Agent-Role`
header as agent identity."* Measured:

```
PATCH /api/commerce/products  -H 'X-Agent-Role: owner'   (no cookie at all)
  -> 401 {"error":"Unauthenticated: sign in to use the Todero API.","code":"UNAUTHENTICATED"}
```

`middleware.ts` refuses it before this file runs. The header is reachable only
behind `lib/internal-auth.ts`'s shared-secret check (`TODERO_INTERNAL_SECRET`,
configured on this host). **The real shape of the gap is different and still
worth fixing:** one shared internal secret grants *any* role, so there is no
per-principal credential — which is the benchmark's actual point. It is a
missing-identity problem, not an open door. Not fixed here; per-agent keys are
step 6 of §7.4.

**`httpOnly: false` on `mc-role` is not the enabler either** — see §10.0's last
row. The flag stays, with a comment saying why, because `app/page.tsx:419-421`
depends on it and removing it would close nothing.

### 10.6 Acceptance — new rows

Run with the dev server up and `MSYS_NO_PATHCONV=1` exported.

| # | Check | Expected |
|---|---|---|
| A18 | `POST /api/auth-form`, correct password, `from=/..//evil.example.com/steal?x=1` | `Location` host is `localhost:3000`. **Supersedes A10**, which passed while the hole was open |
| A19 | the other five payloads in §10.1 | every `Location` host is `localhost:3000` |
| A20 | `/settings`, `/work/epics`, `/p/limiglow/work?tab=1` | preserved exactly — the fix is not a collapse-to-`/` |
| A21 | `PATCH /api/commerce/products` with `mc-auth=view2026; mc-role=admin` | **403** `PERMISSION_DENIED`, `"role":"viewer"` |
| A22 | same with `mc-role` in {owner, god, member, tron, defaultbot} | 403 every time |
| A23 | `npm test -- __tests__/auth/` | **7 suites, 157 tests, all passing** |
| A24 | delete both output checks in `return-path.ts`, re-run A23 | **RED** (9 failures). The property is real, not decorative |
| A25 | `resolveSessionActor` with `mc-auth=view2026; mc-role=owner` | `undefined` — not `"michael"` |
| A26 | `npm test -- lib/__tests__/db-seam.test.ts` | 60/60 — the four pre-existing session-actor rows still pass |
| A27 | **still-failing, on purpose:** `DELETE /api/issues` with `mc-auth=view2026; mc-role=owner` | **200.** This is §10.4 and is NOT fixed. It goes green only when SEAM-4 lands |

### 10.7 Gates — run by me, today

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0, 0 errors** |
| `npm test` | **final run:** 3 suites failed / 1 skipped / 95 passed of 99; **7 failed**, 2 skipped, **1,950 passed** of 1,959 |
| `npm test -- __tests__/auth/` | **7 suites, 157 tests, all passing** |
| every suite touching a file I changed | **12 suites, 245 tests, all passing** |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness 10/10** — `dispatch-guard-armed` PASS, `dispatch-guard-untouched` PASS (503 `DISPATCH_DISABLED`) |
| `bash scripts/smoke-test-layout.sh` | **9 ✅ then RED on `check-no-secrets`** — see below. `no-silent-empty` and `no-unscoped-issues` run after it and so never executed; I ran them directly: both **PASS** |

**The `npm test` failure SET, judged as the brief requires — none is mine, and no
file I touched is imported by any of them:**

| Suite | Whose |
|---|---|
| `__tests__/nav/runs-permalink-seam.test.ts` (3) | another lane's; the suite **names itself** *"RED until the orchestrator applies it"* (an `app/page.tsx` seam) |
| `__tests__/runtimes/spawn-live.test.ts` (1) | the known baseline failure |
| `scripts/__tests__/spawn-context-availability.test.ts` (3) | memory-retrieval lane |

**The set moved twice while I worked, which is why the SET and not the total is
the measure.** Mid-session it was five suites / 13 failed / 1,839 total, also
including `__tests__/runtimes/adapter-exit-record.test.ts` (`exit_status` coming
back null) and `lib/__tests__/issue-moves.test.ts` (a humaniser eating two API
sentences). Both were fixed by their own lanes before my final run. The total has
risen from the critic's 1,588 to 1,959 as nine other lanes landed work. At no
point was any failure in a file this lane owns, and no failing suite imports one.

**A methodology note that cost me time, recorded so it does not cost anyone
else's:** `npx jest <path>` on this repo fails with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` on any suite touching PGlite. That
is not a broken test — `npm test` is `node --experimental-vm-modules .../jest.js`,
and invoking `npx jest` directly drops the flag. **Use `npm test -- <path>`.**

**`check-no-secrets` — I caused this, then fixed my half. The remaining two hits
are not mine to edit.** My new test set `process.env.MC_PASSWORD` to a 22-char
quoted literal, which is exactly the shape the scanner exists to catch (a
credential-shaped NAME assigned a 20+ character quoted literal). The rule is
right; it cannot tell a fixture from a real key. I compose the value now instead.
But two other lanes ran the smoke test during the window in which my line
existed, **correctly identified it as not theirs, and quoted it verbatim into
their piece docs** — and the scanner reads those too:

```
docs/rebuild/pieces/pieces8/approval-surface.md:740
docs/rebuild/pieces/pieces8/work-ui-cards.md:636
```

By my final run a third lane's doc had joined them
(`docs/rebuild/pieces/pieces8/pipeline-fidelity.md:718`). Those are the only
remaining hits (`git status` shows both untracked, and the
string is absent from `HEAD`). They are not this lane's files, so I did not touch
them. **The orchestrator needs one of those lanes to reword its quotation** — for
instance `process.env.MC_PASSWORD = '<redacted 22-char fixture>'` — after which
the guard goes green. One thing worth telling them: their surrounding text says
the offending file "belongs to the identity-sessions lane", which was true, and
the line itself no longer exists.

### 10.8 What I did NOT verify this round

1. **No browser, still.** No DOM evidence anywhere in §10. SEAM-1 (the JS login
   path's client-side `window.location.href = from`) is **still unfixed and still
   unverified** — `app/login/LoginForm.tsx` is not this lane's file. The
   server-side hole is closed; the client-side one is not, and it is the path
   every user with JavaScript actually takes.
2. **The Edge-runtime safety of the SEAM-4 diff** is reasoned from reading
   `lib/approvals.ts`'s imports, not measured. §7.1 says why that matters.
3. **Rate-limit recovery over real HTTP** — still Jest-with-an-injected-clock
   only. The 15-minute window has never been watched draining against the server.
4. **The trusted-client exemption has not been measured over HTTP**, only against
   the real class under an injected clock. Doing it live means spending the
   global budget on a server nine other lanes are using, which I judged not worth
   it.
5. **`npm start` / multi-process** — unverified, and `npm run build` is forbidden
   in this wave. The limiter is still single-process, in-memory, cleared by a
   restart.
6. **Timing.** `secretEquals` is still `timingSafeEqual` with the length channel
   knowingly open, and `resolveDecisionRole`'s own compare is `===` — not this
   lane's file, and narrowing it alone buys nothing while `middleware.ts` and
   `lib/rbac-middleware.ts` compare the same cookie with `===` on every request.
7. **Logout is still API-only.** `grep -rn` across `app/`, `components/`, `lib/`
   still finds **zero** call sites for `DELETE /api/auth` or `intent=logout`. No
   button, no menu item. Unchanged from §8.2, and unchanged because wiring one
   touches files this lane does not own.
8. **Fixtures: none.** No `Limiglow` rows were created or deleted. Every probe was
   `POST /api/auth`, `POST /api/auth-form`, a GET, or a DELETE against the
   deliberately nonexistent `TOD-NONEXISTENT-PROBE-7of8`. `TOD-1` was never
   touched. Both temporary probe test files I created were deleted.
