# one-discord-sender — one send/probe path for Discord, and an honest database usage tile

**Piece:** pieces7 / one-discord-sender
**Branch:** rebuild/2026-08-24 (session working tree at time of writing)
**Owner:** bug_fixer, this session

This piece covers two defects the orchestrator handed in as CLAIMS TO VERIFY,
not facts. Both were measured before anything was changed.

---

## DEFECT 1 — the real call-site count

Grepped `DISCORD_BOT_TOKEN` across `app/` and `lib/`, excluding
`app/api/notify/route.ts` (already wired to `resolveHubDiscord()`),
`lib/connections.ts` (the resolver itself), and test files.

**Measured: 9 direct-read sites across 7 files** (the briefing's list of 8
across 7 files was close but undercounted by one — `app/api/status/route.ts`
has TWO sites, not one):

| # | file:line | what it does |
|---|---|---|
| 1 | `app/api/issues/route.ts:182` (`postDiscord`) | sends a message |
| 2 | `app/api/issues/route.ts:313` (`notifyWatchers`) | sends a message / opens a DM channel |
| 3 | `app/api/releases/route.ts:6` | sends a message (module-load `!` non-null assertion) |
| 4 | `app/api/settings/usage/route.ts:123` | probes `users/@me` (bot identity) |
| 5 | `app/api/sprint-close/route.ts:12` | sends a message |
| 6 | `app/api/sprint-start/route.ts:10` | sends a message |
| 7 | `app/api/status/route.ts:14` (`checkDiscord`) | probes `users/@me` |
| 8 | `app/api/status/route.ts:186` | boolean env-presence check (`channels.discord`) |
| 9 | `lib/loop-breaker.ts:60` | sends a message |

Of these, 6 are genuine **sends** (POST a message as the bot) and 3 are
**probes/booleans** that read the token for a non-message purpose (identity
check, presence flag). All 9 are now fixed — the shared module covers both
shapes (`sendDiscordMessage` for sends, `resolveDiscordToken` for probes).

## What I changed — DEFECT 1

**New module: `lib/discord-sender.ts`.** Wraps `lib/connections.ts`'s
`resolveHubDiscord()` (the function `app/api/notify/route.ts` already uses)
rather than reimplementing resolution. Two exports:

- `sendDiscordMessage(channelId, content, businessId?)` — resolves a token
  (hub connection first, process-wide `DISCORD_BOT_TOKEN` fallback second),
  POSTs the message, and returns `{ ok, status?, error?, source? }`. A
  resolution failure or a non-2xx response is `ok: false` with a named
  reason — **and is also logged via `console.error`**, so a fire-and-forget
  caller (`void sendDiscordMessage(...)`, used at every send site) still
  leaves a trace even though it never reads the return value.
- `resolveDiscordToken(businessId?)` — same resolution order, for a caller
  that needs the raw token for something other than "post a message"
  (`users/@me` identity probes, opening a DM channel). Returns `null` — never
  a placeholder — when nothing resolves.

**Every one of the 9 sites now goes through this module.** `businessId` is
threaded through where it was already in scope:

- `app/api/sprint-close/route.ts` and `app/api/sprint-start/route.ts` both
  receive `business_id` in the request body — their `postDiscord()` now
  takes it as a third argument and passes it to `sendDiscordMessage`, so
  THEIR sends resolve a hub's own connection first, not just the env var.
- `app/api/issues/route.ts` (the highest-risk file) — per the explicit scope
  boundary, this is a **token-resolution swap only**, not a hub-threading
  refactor. `postDiscord()` and `notifyWatchers()` call the shared module
  with no `businessId`, which is IDENTICAL behaviour to before this piece
  (both always fell through to the env var; neither had a hub id in scope
  without a wider refactor of every call site, which was explicitly out of
  scope). Nothing else in that file was touched — no transition validators,
  no scope resolution, no `isOwnerActor`.
- `app/api/releases/route.ts`, `lib/loop-breaker.ts` — no hub context
  available in either (releases has no business_id; loop-breaker's public
  API (`recordAgentFailure`/`pauseAgent`) is called from
  `app/api/run-agent`, `app/api/inbox`, `app/api/hub-pause` — none of which
  this piece owns, so its signature was not changed). Both fall through to
  the env var, same as before.
- `app/api/status/route.ts`, `app/api/settings/usage/route.ts` — whole-host
  probes with no hub context; both now call `resolveDiscordToken()` instead
  of reading the env var directly.

## What I measured — DEFECT 1

- `npx tsc --noEmit`: **0 errors** after all changes.
- New test file `lib/__tests__/discord-sender.test.ts` (6 tests, all
  passing): a hub connection's token wins over `DISCORD_BOT_TOKEN`; the env
  var is used only when no `businessId` is given; a refusal when neither
  exists (never posts, logs via `console.error`); a non-2xx Discord response
  surfaces as `ok: false` rather than being swallowed; `resolveDiscordToken`
  mirrors the same two cases. Mocks `@/lib/db` the same way
  `__tests__/api/notify-hub-discord.test.ts` does — the real
  `resolveHubDiscord()` query shape is exercised, not a stub of it.
  `global.fetch` is mocked in every test — **no real network call was made
  to Discord by this test file.**
- Hit the running dev server directly (internal-auth header, no login flow)
  to prove transport end-to-end, live:
  - `GET /api/status` → `services.discord: { status: "down", note: "users/@me
    returned HTTP 401" }` — this is `checkDiscord()` resolving a token via
    the new module and making the SAME real `users/@me` GET probe this
    endpoint already made before this piece (unchanged in kind — a read-only
    identity check, not a message post) and getting the documented dead
    token's 401. This proves resolution wires through correctly without
    ever posting a message.
  - `channels.discord: true` — a credential resolves (the env var is set on
    this host and shape-valid), even though it is dead.
  - `GET /api/settings/usage` → `discord.connected: false` — same resolved
    token, same dead-401 result, now going through the shared resolver.
- **I did not post a test message to any Discord channel, real or fake.**
  Per the task's explicit rule, transport is proven by (a) the mocked-fetch
  unit tests above and (b) the two live GET-only probes above, neither of
  which sends a message. I have NOT stood up a local HTTP listener and
  pointed `sendDiscordMessage` at it — that would require monkeypatching
  `fetch`'s target URL, which the function does not expose a seam for (by
  design — the URL is `https://discord.com/api/v10/...`, not configurable).
  The mocked-fetch test is the substitute for that, per the task's own
  wording ("a local listener **or** a mock").

---

## DEFECT 2 — the Settings page claims this install runs Supabase

**Measured**, via `lib/db.ts` and the live server: `TODERO_DB_PROVIDER` is
unset on this host, `detectProvider()` (`lib/db/adapters.ts`) finds neither
`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` nor `DATABASE_URL` set,
and resolves to **`sqlite`** — confirmed live: `db().provider === 'sqlite'`.

Three things were wrong, exactly as the briefing described, and a fourth
instance of the SAME defect was found in a second location:

1. `app/api/settings/usage/route.ts:134` hardcoded
   `dbLimitBytes: 500 * 1024 * 1024, plan: 'Free Tier'` and labelled the
   whole object `supabase`, unconditionally — regardless of provider.
2. `components/tabs/SettingsTab.tsx` and `components/tabs/AIServicesTab.tsx`
   rendered that object under the name "Supabase".
3. **A second, independent instance of the same mislabeling**, at
   `app/api/status/route.ts`'s `checkSupabase()`: a REAL probe (a live query
   against whichever adapter `lib/db.ts` actually resolved, through
   `lib/hub-client.ts`'s `createAdminClient()` → `lib/db.ts`'s `db()`) but
   reported under `services.supabase` and rendered as "Supabase" in
   `components/tabs/InfraTab.tsx:174` and `components/tabs/AIServicesTab.tsx`
   — the exact tile the orchestrator pointed at as "the same tile appearing
   a second time."

## What I changed — DEFECT 2

**`app/api/settings/usage/route.ts`:**
- `dbSizeBytes(provider)` now branches on the ACTIVE provider: for `sqlite`
  it reads the real file size via `fs.statSync(sqlitePath())`
  (`lib/db/sqlite-adapter.ts`'s own path resolver — respects
  `TODERO_SQLITE_PATH`/`TODERO_DATA_DIR`); for `postgres`/`supabase` it keeps
  the `pg_database_size_bytes` stored-procedure call (which genuinely
  applies to those two).
- The response's `supabase` key is renamed `database`, shaped
  `{ provider, dbBytes, dbLimitBytes, plan, lastChecked }`. `provider` is
  `db().provider` — live, never a literal. `dbLimitBytes`/`plan` are now
  `null` by default: this codebase has no billing-API probe for ANY
  provider (the same "kill-fake-infra-greens" reasoning already applied a
  few lines below to Vercel's plan and Claude's plan in this exact file), so
  inventing a number for one provider and not the others would just move
  the defect, not fix it.
- Also fixed the Discord probe in the same `Promise.allSettled` array (see
  DEFECT 1) since it lived in this file too.

**`app/api/status/route.ts`:** `checkSupabase()` renamed `checkDatabase()`;
its `reading('ok', …)` note now names the live provider
(`` `reachable — issues table queried (provider: ${db().provider})` ``);
`result.services.supabase` renamed `result.services.database`.

**`components/tabs/SettingsTab.tsx`:** `UsageData.supabase` renamed
`database` with the new nullable shape. `dbPct` now requires BOTH `dbBytes`
and `dbLimitBytes` to be non-null (a percentage against a null denominator
is a fabricated percentage, same class of bug as the invented 500MB). The
card's name is now `DB_PROVIDER_LABEL[provider]` (`SQLite`/`Postgres`/
`Supabase`), its plan text falls back to an honest sentence
(`"Local file — no vendor size limit"` for sqlite, `"No plan/limit known for
this database"` otherwise) instead of asserting a tier nobody measured, and
the byte display/usage bar only render the `/ limit` half and the bar itself
when a limit is actually known.

**`components/tabs/AIServicesTab.tsx`** and **`components/tabs/InfraTab.tsx`**
(line 174, the second tile): tile key renamed `supabase` → `database`, name
`Supabase` → `Database`, matching the renamed `/api/status` `services` key.

## What I measured — DEFECT 2

Hit the running dev server directly (internal-auth header):

- `GET /api/settings/usage` → `database: { provider: "sqlite", dbBytes:
  974848, dbLimitBytes: null, plan: null, lastChecked: "…" }`. `974848` bytes
  = `952.0 KB` — the exact figure from the orchestrator's own browser
  screenshot before this piece, now attached to the real provider instead of
  a fabricated Supabase Free Tier percentage.
- `GET /api/status` → `services.database: { status: "ok", note: "reachable —
  issues table queried (provider: sqlite)" }`.
- `npx tsc --noEmit`: 0 errors (verifies the renamed/typed `UsageData`
  interface against every read site in `SettingsTab.tsx`).

---

## Gate — exact numbers

- `npx tsc --noEmit` → **0 errors.**
- `npm test` → **Test Suites: 3 failed, 1 skipped, 59 passed (62 of 63
  total). Tests: 5 failed, 2 skipped, 1163 passed (1170 total).** The 5
  failures are the same named baseline family the task described —
  `__tests__/agents-route.test.ts` (3 tests: "answers 200 with the roster…",
  "answers 200 with an EMPTY roster…", "never reports an agent the roster
  does not declare"), `__tests__/api/agents-unconfigured.test.ts` (1: "still
  returns the roster…"), `__tests__/runtimes/spawn-live.test.ts` (1: "names a
  log file that exists on disk and grows") — none of them touch a file this
  piece owns. 1163 passed vs. the 1157 baseline is +6, exactly the new
  `discord-sender.test.ts` suite.
- `node scripts/acceptance/run.mjs` → **45/45 passing, harness score 10/10**
  — matches baseline exactly.
- `bash scripts/smoke-test-layout.sh` → **all nine guards pass**
  (no-invented-projects, no-dead-modules, no-phantom-columns,
  no-cloud-provider, check-boolean-columns, check-no-secrets,
  no-silent-empty, no-unscoped-issues, plus the five build-output layout
  checks against the pre-existing `.next` build — unchanged, since `npm run
  build` was never run this session per the hard rule).

---

## ACCEPTANCE — checkable without trusting this summary

1. `grep -rn "process.env.DISCORD_BOT_TOKEN" app lib --include=*.ts` returns
   **zero hits outside `lib/discord-sender.ts`'s own doc comment and
   `lib/connections.ts`'s doc comments** (both are prose, not a read).
2. `grep -rln "sendDiscordMessage\|resolveDiscordToken" app lib` lists
   exactly: `lib/discord-sender.ts`, `app/api/issues/route.ts`,
   `app/api/releases/route.ts`, `app/api/sprint-close/route.ts`,
   `app/api/sprint-start/route.ts`, `app/api/status/route.ts`,
   `app/api/settings/usage/route.ts`, `lib/loop-breaker.ts`.
3. `sendDiscordMessage` and `resolveDiscordToken` both call
   `resolveHubDiscord` from `lib/connections.ts` — `grep -n
   resolveHubDiscord lib/discord-sender.ts` shows both call sites.
4. A call to `sendDiscordMessage`/`resolveDiscordToken` with no hub
   connection and no `DISCORD_BOT_TOKEN` returns `{ ok: false, error: <names
   the reason> }` / `null` — never throws, never silently no-ops. See
   `lib/__tests__/discord-sender.test.ts`'s "REFUSES" test.
5. `app/api/sprint-close/route.ts` and `app/api/sprint-start/route.ts` pass
   `business_id` into `postDiscord`'s third argument — `grep -n
   "postDiscord(.*business_id)" app/api/sprint-close/route.ts
   app/api/sprint-start/route.ts` shows 3 call sites total (2 + 1).
6. `app/api/issues/route.ts`'s diff (`git diff main -- app/api/issues/route.ts`
   once committed, or compare against the version before this piece) touches
   ONLY `postDiscord()` and `notifyWatchers()` — no line inside a transition
   validator, `isOwnerActor`, or scope-resolution code changed.
7. `grep -rn '"supabase"' components/tabs/AIServicesTab.tsx
   components/tabs/InfraTab.tsx components/tabs/SettingsTab.tsx
   app/api/status/route.ts app/api/settings/usage/route.ts` returns zero
   hits outside comments explaining the rename.
8. `GET /api/settings/usage`'s body has a `database` key (not `supabase`)
   shaped `{ provider, dbBytes, dbLimitBytes, plan, lastChecked }`; on THIS
   host `provider` is `"sqlite"`, `dbLimitBytes` and `plan` are both `null`.
9. `GET /api/status`'s body has `services.database` (not
   `services.supabase`), and its `note` contains the substring
   `provider: sqlite` on this host.
10. `npx tsc --noEmit` exits 0. `node scripts/acceptance/run.mjs` prints
    `45/45 passing` and `harness score: 10/10`. `bash
    scripts/smoke-test-layout.sh` ends `✅ Smoke test complete` with no
    guard reporting FAILED.

## What I did NOT verify

- **No real message was posted to any Discord channel**, per the task's
  hard rule. Transport is proven by mocked-fetch unit tests and by two live
  GET-only identity probes (`users/@me`) that already existed before this
  piece and were unchanged in kind. The actual `channels/{id}/messages` POST
  path is exercised by the unit tests' fetch mock only, not against a real
  socket or a local HTTP listener — I did not stand one up, since
  `sendDiscordMessage` hardcodes `https://discord.com/api/v10/...` with no
  injectable base URL, and adding one was out of scope for a token-resolution
  swap.
- **The three tab components' rendering was not visually verified.** I have
  no browser tool this session. I verified the JSON contracts each tab reads
  (`/api/settings/usage`'s `database` object, `/api/status`'s
  `services.database`/`services.discord`) end-to-end against the live dev
  server, and I verified `npx tsc --noEmit` passes against the updated
  `UsageData` interface and every read site in `SettingsTab.tsx`,
  `AIServicesTab.tsx`, and `InfraTab.tsx` — but I did not load
  `/p/limiglow/settings` in a browser and look at the rendered card. Anyone
  who can should confirm the "Database" tile shows `SQLite`, `952.0 KB`, and
  `"Local file — no vendor size limit"` with no percentage bar.
- **`postgres`/`supabase`-provider behaviour of `dbSizeBytes()` was not
  exercised live** — this host runs `sqlite`, so the `pg_database_size_bytes`
  branch was verified only by reading the code (it is the exact call the
  function made before this piece, untouched) and by `tsc`, not by pointing
  a live Postgres/Supabase connection at it.
- **`app/api/releases/route.ts`'s and `lib/loop-breaker.ts`'s send paths
  were not exercised against the running server** — no release was created
  and no loop-breaker pause was triggered this session (both would require
  writing fixture rows I was not asked to create). Coverage for their token
  resolution is the shared module's own unit tests plus `tsc`, not an
  end-to-end hit through those specific routes.
- I re-ran the suite a second time filtering to `FAIL`/`●` lines to name all
  5 failing tests explicitly (listed above) rather than trust the count
  alone — all 5 are in files this piece does not own (`agents-route.test.ts`,
  `agents-unconfigured.test.ts`, `spawn-live.test.ts`), and none reference
  Discord, the database-usage tile, or any file in this piece's owned list.
