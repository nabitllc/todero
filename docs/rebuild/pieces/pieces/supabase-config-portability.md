# PIECE: Route all data access through ONE provider-agnostic database seam

id: supabase-config-portability
baseline score: 0/10
effort: L

## IMPORTANT — this piece was re-scoped by the owner mid-wave. Read this, not any earlier version.
The owner is migrating OFF Supabase across all their projects, toward Postgres on
Vercel (which today means Neon via the Vercel Marketplace — Vercel Postgres was
folded into Neon). You are NOT performing that migration. You are building the
seam that makes it a one-adapter swap later instead of another 41-file sweep.

Critical context you must not miss: Todero uses Supabase as PLAIN POSTGRES.
Verified counts across app/ lib/ components/ hooks/:
  - 203 supabase-js query-builder call sites (.from(...))
  - 49 raw PostgREST fetches (rest/v1)
  - 0 uses of Supabase Storage, 0 Realtime, 0 channels, 0 .subscribe()
  - 1 .rpc(), 4 incidental auth references
  - 40 migrations already written as plain SQL
There is no Supabase magic to replace. That is why a clean seam is cheap now.

## Build instruction
1. Create `lib/db.ts` as the SINGLE data-access seam for the whole app. It must be
   named and shaped so that nothing above it knows which vendor is underneath —
   do not call it supabase, do not export a Supabase client type from it, and do
   not leak PostgREST concepts (`on_conflict`, `select=*,rel(*)` strings) through
   its public surface.
   Export at minimum:
     - `db()` — the server-side handle (service credentials), throwing a named,
       readable error listing exactly which env vars are missing. Never
       createClient('','') — that throws an opaque "supabaseUrl is required".
     - `isDbConfigured(): boolean` so callers degrade honestly instead of crashing.
     - `DB_PROVIDER` resolved from `process.env.TODERO_DB_PROVIDER ?? 'supabase'`.
2. Put the Supabase implementation behind that seam in `lib/db/supabase-adapter.ts`,
   reading NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env ONLY.
   Leave a documented, clearly-marked extension point for a future
   `lib/db/neon-adapter.ts` — write the interface it will have to satisfy as a
   TypeScript type in lib/db.ts, so the next agent has a contract to implement
   rather than a guess. Do NOT write the Neon adapter now.
3. Replace every hardcoded occurrence of the literal `https://<the hosted project ref>.supabase.co`
   and every inline JWT across app/, lib/, components/, hooks/, config/, scripts/
   with imports from the seam. There are currently ~78 occurrences. None may remain.
   Also remove the hardcoded owner email `michael@nabit.app` at
   app/api/onboarding/route.ts:23 — read it from env.
4. Server-only credentials must never be imported from a file carrying 'use client'.
   (Another agent is removing the service_role key from client components right now —
   coordinate by NOT editing components/ files that already import from a server route.)
5. Add a CI grep that fails the build if `<the hosted project ref>`, `service_role`, or a
   raw `eyJhbGciOi` JWT prefix appears anywhere outside .env files.

## ACCEPTANCE — a critic will verify these against the RUNNING app
1. `grep -rn <the hosted project ref> app/ lib/ components/ hooks/ config/ scripts/ | wc -l` -> 0
2. `grep -rn "eyJhbGciOi" app/ lib/ components/ hooks/ | wc -l` -> 0
3. With NEXT_PUBLIC_SUPABASE_URL unset, the app produces a startup/route error that
   NAMES the missing variable — not an opaque "supabaseUrl is required", and not a
   silent empty result.
4. `grep -rn "createClient" app/ components/ hooks/ | wc -l` -> 0 (all client
   construction lives under lib/db/).
5. lib/db.ts exports a documented adapter interface type, and a reviewer can state
   in one sentence what a Neon adapter would have to implement. The word "supabase"
   must not appear in lib/db.ts's public exports.
6. The app still works end to end as owner: GET /api/issues -> 200 with real rows,
   the Board tab renders real cards, and a card drag still persists after reload.
