# PIECE: Connections — Discord added from scratch, and a scanner that has earned its verdict

id: connections-discord
lane: Custody
channel: Secrets & Credential Custody (1 -> 9)

OWNS EXCLUSIVELY: `app/api/connections/**`, `components/tabs/ConnectionsCard.tsx`,
`lib/connections.ts`, `lib/__tests__/connections.test.ts`,
`migrations/059_hub_connections.sql`, `migrations/sqlite/059_hub_connections.sql`,
`scripts/check-no-secrets.js`, this file.

DO NOT TOUCH: `app/page.tsx`, `components/nav/**`, `app/api/issues/**`,
`app/api/hub-settings/**`, `lib/constants.ts`, `lib/mc-constants.ts` — owned by
other agents this round. The mount line and the `app/api/issues/route.ts`
cutover are REPORTED, not performed.

## Why

`docs/rebuild/FEEDBACK.md` item 9:

> "Same way settings show connected tools, Discord should be there so something
> can be added per project. What currently exists might be broken anyway so good
> to set up something the user can add Discord from scratch to a hub."

The channel scores 1/9 for a reason that is not about UI. A **live Discord bot
token is hardcoded in tracked source** at `app/api/issues/route.ts:136` and used
as a live fallback (`process.env.DISCORD_BOT_TOKEN ?? DISCORD_BOT_TOKEN`), so
the app works on the author's machine and on a stranger's — with the author's
bot. It appears in 29 files on the default branch.

And `scripts/check-no-secrets.js` prints

> `OK: no hardcoded credentials, and no code bypassing the database seam.`

while checking three hand-written Supabase-era needles and nothing else. That
sentence is a general verdict drawn from specific evidence. It is the exact
failure HANDOFF.md keeps recording: **a guard that reports confidence it has not
earned is worse than no guard**, because it is the reason nobody looked.

So this piece has two halves that must both land:

1. a real place to put a Discord credential, per hub, that the operator can fill
   in from scratch and the app can read;
2. a scanner whose verdict is true, proven by watching it FAIL on the real token
   and PASS on prose that merely names one.

## Build instruction

### 1. Migration 059 — a per-hub connections table, in both dialects

`migrations/058_hub_settings.sql` and `migrations/sqlite/058_hub_settings.sql`
are the two-dialect model. A connection is per `business_id`, carries a provider,
a display name, config (channel ids), and a credential.

The credential does **not** go in the same table as the rest. Justify that in
the migration comment, not in a commit message.

### 2. `app/api/connections/hub` — validate on WRITE, mask on READ

`app/api/hub-settings/route.ts` is the pattern, including its fail-closed stance:
an unknown key is **refused, not stored**, because an open key/value write is an
open write to a table the app reads back and trusts.

- `GET` lists a hub's connections and **never returns the raw credential** — a
  masked hint (`••••9HdAyo`) and `configured: true/false`.
- `POST` / `PATCH` add or update.
- `DELETE` removes.

`configured` must be a fact, not a hope: if a connection points at an env var
that is not set in this process, it is `configured: false` with the reason.

### 3. `ConnectionsCard.tsx` — Discord added from scratch

Built on `components/nav/Card.tsx` (one question, one number with its source, one
action, an empty state that names its subject, an error that REPLACES the body).
Paste a bot token, name the channels, test it, see it listed. The stored
credential is never rendered back.

### 4. `scripts/check-no-secrets.js` — a verdict it has earned

Add generic detection, and scope the closing sentence to what was actually
checked. Prove both directions: it must FAIL on `app/api/issues/route.ts:136`
and it must still PASS on the prose in `scripts/setup.mjs:85` and in
`docs/rebuild/**`, which name credentials without being credentials. The file's
existing comments record two occasions where a bare-substring rule turned
`npm run build` red on a clean clone by matching a description.

## ACCEPTANCE — verified against the RUNNING app

Server already running at http://localhost:3000. Do NOT restart it, NEVER
`npm run build`. Auth: `cookie: mc-auth=kaos2026; mc-role=owner`. URLs are
path-based. SQLite at `./db.sqlite`; every fixture inserted must be removed and
the removal confirmed. Hub id for Limiglow's business ("Todero"):
`2bcb6477-54b0-4791-9cb1-c69355b011d5`.

1. **Migration 059 exists in both dialects and applies cleanly.**
   `migrations/059_hub_connections.sql` and `migrations/sqlite/059_hub_connections.sql`
   both exist; `npm run db:migrate` reports them applied, and a second run
   reports zero pending. Show both runs.

2. **The migration comment states where the credential lives and why.**
   The ciphertext is in a table of its own (`hub_connection_secrets`), not a
   column of `hub_connections`, and the comment gives the reason: a `SELECT *`
   on the connections table must be incapable of returning a credential. Quote
   the comment.

3. **`GET` never returns a credential — proven by a grep, not an eyeball.**
   With a connection configured, `GET /api/connections/hub?business_id=<hub>`
   returns `configured: true` and a hint of the form `••••` + the last 6
   characters. Pipe the whole response through a search for the real token's
   first segment and show zero matches.

4. **`configured` is measured, not assumed.**
   A connection whose custody is an env var that is NOT set in the server
   process returns `configured: false` with a reason naming the variable —
   never `true` with a fabricated hint. Show both a set and an unset case.

5. **An unknown provider is refused, not stored.**
   `POST` with `provider: "slack"` returns 400 listing the known providers, and
   a follow-up `GET` shows no row was created. Show both calls.

6. **An unknown config key is refused, not stored.**
   `PATCH` with a config key outside the provider's declared set returns 422
   naming the offending key and the accepted keys, and the stored config is
   unchanged. Show the response and the subsequent `GET`.

7. **A malformed credential is refused before it reaches the database.**
   `POST` with a bot token that does not have Discord's three-segment shape
   returns 422; `POST` with a well-formed one is accepted. Show both, and show
   that the rejected one left no row.

8. **Storing a credential without an encryption key fails closed.**
   With `CONNECTIONS_ENCRYPTION_KEY` unset, a `custody: "stored"` write returns
   a 503 naming that variable and stores **nothing** — it never falls back to
   plaintext. Show the response and show `hub_connection_secrets` is still empty.

9. **The encrypted round trip is proven where the key can be controlled.**
   `lib/__tests__/connections.test.ts` sets a key, stores, reads back the masked
   hint, decrypts to the original, and asserts the ciphertext does not contain
   the plaintext. Show the passing test names.

10. **Full lifecycle, live.** `POST` (add), `GET` (list, masked), `PATCH`
    (update channels), `DELETE` (remove), then a final `GET` proving the row is
    gone and `hub_connection_secrets` holds no orphan. Paste all five responses.

11. **The card renders on the Card contract and cannot show an empty state over
    a failure.** With the API forced to fail, `ConnectionsCard` renders the error
    in place of the body — not "no connections yet". Show the failing branch.

12. **The card never renders the credential.** Grep `ConnectionsCard.tsx` for any
    path that puts a token into the DOM; the only credential-shaped thing on
    screen is the masked hint from the API.

13. **The scanner FAILS on the real token.** Run `node scripts/check-no-secrets.js`
    unchanged against the current tree and show a non-zero exit naming
    `app/api/issues/route.ts:136`. A scanner only proven to pass is not proven.

14. **The scanner still PASSES on prose.** Show that `scripts/setup.mjs:85`
    (`MC_PASSWORD=YOUR_MC_ADMIN_PASSWORD` inside a comment) and the credential
    names written throughout `docs/rebuild/**` do not match. State plainly which
    shapes the rules do NOT cover.

15. **The verdict sentence matches the evidence.** The success line enumerates
    what was checked and names what is out of scope, rather than claiming "no
    hardcoded credentials" in general. Quote the old line and the new one.

16. **The scanner cannot match itself.** Every needle is assembled from
    fragments; `git grep` for each rule's literal finds the offenders, not the
    rule.

17. **No new secret was invented and none was rotated.** No file added by this
    piece contains a real credential. Show `git status` for the new files and a
    scan of each.

18. **`npx tsc --noEmit` is clean and `node scripts/acceptance/run.mjs` still
    reports 45/45.** Slow or mass-failing means the SERVER is unhealthy — say so
    rather than reporting a number.

19. **The cutover is specified, not performed.** The report names the exact
    lines in `app/api/issues/route.ts` the orchestrator must change, and the
    exact line in `app/page.tsx` that mounts the card. Neither file is edited by
    this piece.

20. **Every fixture is removed.** Any row inserted into `hub_connections` or
    `hub_connection_secrets` during acceptance is deleted, and the deletion is
    confirmed with a query showing zero rows.
