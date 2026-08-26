# PIECE: Hub connections — giving `resolveHubDiscord()` its first caller

id: hub-connections
lane: Custody
channel: Secrets & Credential Custody (6 -> 9)

OWNED: `lib/connections.ts` (tests only — no functional change), `app/api/notify/route.ts`,
`lib/__tests__/connections.test.ts`, `__tests__/api/notify-hub-discord.test.ts`, this file.

NOT TOUCHED: `app/api/issues/route.ts`, `app/api/releases/route.ts`,
`app/api/sprint-close/route.ts`, `app/api/sprint-start/route.ts`,
`lib/loop-breaker.ts`, `app/api/connections/**`, `components/tabs/ConnectionsCard.tsx`
— see "What was NOT wired" below for why, and the exact cutover each still needs.

## The briefing's claim, verified

**"`resolveHubDiscord` has ZERO CALLERS." — TRUE.** Measured with:

```
grep -rn "resolveHubDiscord" --include="*.ts" --include="*.tsx"
```

Two hits before this piece, both in `app/api/issues/route.ts`: the function's own
definition (`lib/connections.ts:483`) and a **comment**, not a call, at line ~159
("`lib/connections.ts` resolveHubDiscord() returns it, or null, never a
constant"). Zero executable call sites anywhere in the tree. The briefing was
right. This piece gives it exactly one.

## What I found before changing anything

**Every real Discord send path, grepped for `postDiscord\(` / `sendDiscord\(` /
`DISCORD_BOT_TOKEN`:**

| File | Mechanism | Credential source |
|---|---|---|
| `app/api/issues/route.ts` | local `postDiscord()`, 7 call sites | `process.env.DISCORD_BOT_TOKEN` directly |
| `app/api/notify/route.ts` | `sendDiscord()` (TOD-801, "one place to rotate tokens") | `requireEnv('DISCORD_BOT_TOKEN')` — **this piece rewires this one** |
| `app/api/releases/route.ts` | local `postDiscord()` | `process.env.DISCORD_BOT_TOKEN!` (module-load read, unchecked `!`) |
| `app/api/sprint-close/route.ts` | local `postDiscord()` | `process.env.DISCORD_BOT_TOKEN` |
| `app/api/sprint-start/route.ts` | local `postDiscord()` | `process.env.DISCORD_BOT_TOKEN ?? ''` |
| `lib/loop-breaker.ts` | local `postDiscordAlert()` | `process.env.DISCORD_BOT_TOKEN ?? ''` |
| `app/api/status/route.ts` | probe only, no send | `process.env.DISCORD_BOT_TOKEN` |

Seven independent, duplicated implementations. **None of the other six
consulted `hub_connections` before this piece, and none do after it** — see
"What was NOT wired."

**Real callers of `/api/notify` today** (so wiring it is not a dead end):
`app/api/circuit-breaker/route.ts`, `app/api/cron/queue-refill/route.ts`,
`app/api/cron/watchdog/route.ts`, `app/api/run-sprint/route.ts`. None of them
pass `business_id` today — they are system-wide alerts with no hub context —
so wiring adds the *capability*; a follow-up piece would have those callers
start naming a hub where one is known.

**The Settings round trip already existed before this piece** (pieces6 /
TOD-2429): `app/api/connections/hub/route.ts` (CRUD), `.../hub/test/route.ts`
(a read-only `GET /users/@me` identity check via `resolveCredential()`), and
`components/tabs/ConnectionsCard.tsx`. `resolveCredential()` already had a
real caller (the test endpoint). The gap was specifically the higher-level
`resolveHubDiscord()` — token *and* channel-map resolution for an actual send
— which nothing called.

## What I built

**`app/api/notify/route.ts`** — the one send path in reach without touching
another agent's files (see below): `sendDiscord()` now takes an optional
`businessId` and resolves the credential via `resolveHubDiscord(businessId ??
null)` instead of reading `DISCORD_BOT_TOKEN` directly. `POST` accepts an
optional `business_id` in the body and threads it through both the named-
channel and the `discordChannelId` ad-hoc path.

- **A hub with its own connection uses THAT connection's credential** — proven
  live below, not just in a test.
- **No connection AND no env fallback → refused**, naming the hub id, with
  `fetch` never called (proven by call-count, not by reading the code).
- **No `business_id` at all → unchanged legacy behaviour** (the process-wide
  env var), so this is additive, not a breaking change to the four existing
  callers.
- The result carries `source` (`hub_connections(<id>) custody=<mode>` or
  `process.env.DISCORD_BOT_TOKEN`) so the caller — and this report — can see
  which path resolved, without the credential ever being in that string.

**Tests** (`lib/__tests__/connections.test.ts`, +17 cases; new file
`__tests__/api/notify-hub-discord.test.ts`, 5 cases): `resolveCredential()` and
`resolveHubDiscord()` had **zero tests of any kind** before this piece — one
reason the zero-caller state went unnoticed for a whole wave. Covered: env and
stored custody, missing variable, missing encryption key, a database error,
tampered ciphertext, an unrecognised custody, the no-`business_id` env
fallback, a hub's own connection overriding the fallback, a hub with a row but
no usable credential falling through to env (not refusing), a hub with
nothing at all refusing by name, and the ad-hoc channel override path.

## Measured — against the RUNNING app, live

Server already running at `localhost:3000`. Auth: `cookie: mc-auth=kaos2026;
mc-role=owner`. The only business/hub row in this install: `Todero`, id
`2bcb6477-54b0-4791-9cb1-c69355b011d5` (`Limiglow` is a **project** label on
issue rows — `lib/constants.ts` `PROJECT_PREFIX` — not a separate hub; there is
one hub in this single-tenant install, so any connection fixture is
necessarily under the `Todero` business id. No issue rows were touched; no
`TOD-1` row was touched).

1. **Added a connection**, `POST /api/connections/hub` — `custody: "env"`
   (this dev process has no `CONNECTIONS_ENCRYPTION_KEY`, so `custody:
   "stored"` 503s here — see "What I could not do"):
   ```
   {"connection":{"id":"b1ebaa7a-...","custody":"env","credential_env_var":"DISCORD_BOT_TOKEN",
    "credential_hint":"••••9HdAyo","configured":true,"unconfigured_reason":null}}
   ```
2. **`GET` lists it**, masked, as both `owner` and `viewer`. Ran a script that
   reads the real `DISCORD_BOT_TOKEN` from `.env.local` server-side, takes its
   first 15 characters, and searches the JSON response text for that
   substring **without ever printing the token itself**: `contains real-token
   15-char prefix: false`, `contains full real token: false`. Same check
   against the `/test` response: also `false`/`false`.
3. **Sent a live test** — `POST /api/connections/hub/test` (the existing,
   already-reviewed, read-only `GET /users/@me` identity check; it posts no
   message and touches no channel) — got `{"tested":true,"reachable":true,
   "ok":false,"status":401,"bot":null}`. The shared dev token in
   `.env.local` is the one the code comment at
   `app/api/issues/route.ts` already documents as dead ("POST to Discord with
   it returns 401"); this independently confirms that from a different code
   path, and doubles as a **live wrong/revoked-token failure-path proof**:
   reachable, rejected, no message delivered, no exception, a legible status.
4. **`POST /api/notify` with `business_id` set to the hub that now has the
   connection**:
   ```
   {"ok":false,"sent":0,"failed":1,"results":[{"channel":"discord-alerts","ok":false,
    "status":401,"error":"{\"message\": \"401: Unauthorized\", \"code\": 0}",
    "source":"hub_connections(b1ebaa7a-...) custody=env"}]}
   ```
   `source` names the connection row, not the process env var — this is the
   wiring working end to end, live, with the same dead token producing the
   same honest 401 rather than a silent drop.
5. **`POST /api/notify` with a `business_id` that has no connection row** (the
   process still has `DISCORD_BOT_TOKEN` set, so this exercises the fallback,
   not the refusal): `source: "process.env.DISCORD_BOT_TOKEN"` — correct,
   matches the documented contract.
6. **Refusal path** — mocked, not live, because this dev process has
   `DISCORD_BOT_TOKEN` set for its whole lifetime, so "no connection AND no
   env" cannot be produced live without restarting the server (forbidden).
   Proven instead in `__tests__/api/notify-hub-discord.test.ts`: `fetchCalls`
   has length 0, and the message contains the hub id and "no Discord
   connection is configured".
7. **Cleanup**: `DELETE ?id=b1ebaa7a-...` → `{"deleted":"b1ebaa7a-..."}`; a
   follow-up `GET` shows `connections: []`; a follow-up `DELETE` of the same id
   404s (`no connection with id "..."`) — the row is actually gone, not just
   reported gone.

## What was NOT wired, and the exact cutover each needs

The six other send paths in the table above are **unchanged** — each still
reads `process.env.DISCORD_BOT_TOKEN` directly. I did not touch
`app/api/issues/route.ts`, `app/api/releases/route.ts`,
`app/api/sprint-close/route.ts`, `app/api/sprint-start/route.ts`, or
`lib/loop-breaker.ts`. Two reasons, both real:

1. **Scope.** My brief lists exactly what I own; those five files are not on
   it, and `app/api/issues/route.ts` in particular is the MC API core that
   four other agents are concurrently editing this session (`git status`
   showed live, uncommitted changes to `lib/conversations.ts`,
   `app/api/conversations/**`, `lib/db/sqlite-adapter.ts` from other agents
   while I worked). Editing a 2500+ line shared file outside my lane risks a
   collision with in-flight work I cannot see the shape of.
2. **pieces6 already specified this exact cutover and deferred it** ("THE
   CUTOVER IS SPECIFIED, NOT PERFORMED" — its acceptance item 19). That it is
   *still* unperformed, a whole wave later, is exactly what "zero callers"
   measures. This piece performs the smallest real cutover in reach
   (`/api/notify`) and reports the rest rather than silently expanding scope
   to finish someone else's deferred item in files I do not own.

The cutover each of the other five needs is mechanical and identical: replace
`const token = process.env.DISCORD_BOT_TOKEN` (or the local `postDiscord`'s
equivalent) with `const resolved = await resolveHubDiscord(businessId ??
null)`, thread a `businessId` into each call site (`issues/route.ts` already
computes `effectiveBusinessId` / `hubScope.businessId` in most of the places
`postDiscord` is called from), and treat `resolved === null` as "log and skip"
rather than posting with an empty Authorization header.

## Round-trip: what I drove and what I could not

- **Browser/DOM verification of `ConnectionsCard.tsx` was NOT performed.**
  This subagent invocation was not given `mcp__Claude_Browser__*` tools despite
  the brief instructing their use — I checked my available tool set and they
  are absent. Everything under "Measured" above is therefore HTTP-level
  (`curl` / a small Node script against the live server), which is real and
  live but is not the same claim as "observed in the DOM." I did not touch
  `ConnectionsCard.tsx`, so its rendering is unchanged from pieces6's own
  DOM-level acceptance (its item 11/12); I did not re-verify those myself in
  a browser this session.
- **`custody: "stored"` was not exercised live.** `CONNECTIONS_ENCRYPTION_KEY`
  is unset in this dev process (confirmed: `encryption.available: false` in
  every `GET` response above), so a `stored` write 503s by design — correct,
  fail-closed behaviour, but it means the "paste a token" half of the round
  trip only has coverage from pieces6's own unit tests and mine
  (`resolveCredential`'s stored-custody branch, mocked), not a live POST in
  this session.
- **No message was ever delivered to a real Discord channel.** Every live
  call above either targeted the identity endpoint (`GET /users/@me`, no
  content, no channel) or was rejected with 401 before Discord would have
  posted anything. I did not have — and did not seek — a test webhook.
- **The true "nothing configured anywhere" refusal is proven only by mock**,
  because `DISCORD_BOT_TOKEN` is set for this whole dev process and I cannot
  unset it without restarting the forbidden-to-restart server.

## ACCEPTANCE — checkable without trusting this summary

1. `grep -rn "resolveHubDiscord" --include="*.ts" --include="*.tsx"` shows the
   definition, the pre-existing comment in `app/api/issues/route.ts`, and now
   one real call site in `app/api/notify/route.ts`.
2. `npx tsc --noEmit` — zero errors.
3. `npm test` — failure set is exactly `{agents-route, agents-unconfigured,
   spawn-live}` (5 failing tests, 2 skipped), the stated baseline; every test
   in `lib/__tests__/connections.test.ts` and
   `__tests__/api/notify-hub-discord.test.ts` passes.
4. `node scripts/acceptance/run.mjs` — 45/45, harness 10/10.
5. `node scripts/check-no-secrets.js` run alone against only this piece's
   files passes; any failure in `scripts/smoke-test-layout.sh` at the time of
   review should be checked against `git status` first — if the flagged line
   is in `lib/conversations.ts` / `lib/__tests__/conversations*.test.ts`, that
   is a different agent's in-flight file, not this piece's.
6. `curl` the sequence in "Measured" step 1-7 above against a business id with
   no existing Discord connection; the `source` field in step 4's response
   must read `hub_connections(<id>) custody=<mode>`, never a bare env-var
   name, once a connection exists for that hub.
7. Reading `app/api/notify/route.ts`, `sendDiscord()` never logs or returns
   `resolved.token` — only `resolved.source`. Grep the file for `resolved.token`
   and confirm every use is inside the `Authorization` header construction,
   never in a `results.push(...)` or `console.*` call.
8. `git status --porcelain` before and after this piece's commit shows only
   `app/api/notify/route.ts`, `lib/__tests__/connections.test.ts`, and the new
   `__tests__/api/notify-hub-discord.test.ts` changed by this work — nothing
   under `lib/conversations.ts`, `app/api/conversations/**`, `lib/db/**`,
   `migrations/070*`, `migrations/071*`, `lib/issue-permalink.ts`,
   `lib/issue-verbs.ts`, `components/IssueDetailOverlay.tsx`,
   `components/SearchOverlay.tsx`, `lib/search-commands.ts`,
   `app/api/tasks/**`, `components/office/**`, `hooks/useAgentStatus.ts`,
   `lib/agent-roster.ts`, `scripts/doctor.mjs`, `scripts/setup.mjs`, or
   `package.json`.
9. The fixture connection created during measurement
   (`b1ebaa7a-42ea-4299-b9fe-23d2a9e47340`) is deleted; `GET
   /api/connections/hub?business_id=2bcb6477-54b0-4791-9cb1-c69355b011d5`
   returns `connections: []`, and a repeat `DELETE` of that id 404s.

## What I did NOT verify

- DOM/browser rendering of `ConnectionsCard.tsx` (no browser tool available
  this session — see above).
- The `custody: "stored"` write path live (encryption key unset in this
  process).
- Any of the five other Discord send paths beyond reporting their mechanism
  and the exact cutover they need — I did not change or re-test them.
- Whether `app/api/circuit-breaker`, `cron/queue-refill`, `cron/watchdog`, or
  `run-sprint` *should* start passing `business_id` to `/api/notify` — that is
  a follow-up decision, not something this piece decided by editing those
  callers.
- Rate limiting, Telegram transport, and every other `/api/notify` behaviour
  not touched by this change.
