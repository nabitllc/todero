# PIECE: the provider is a base URL, not a code branch

id: provider-is-a-base-url
lane: LLM Provider Independence
channel goal: *"LiteLLM — the provider is a base URL, not a code branch. Open
WebUI — the model list is read live from that endpoint, never hardcoded."*

## The claim this piece was opened on, and what was actually measured

`scripts/board/channels.json` carried, as the channel's current evidence:

> "Blocked from goal by 66 remaining OpenRouter references — chat still routes
> to a cloud host the owner has ruled out."

**Both halves are false against this tree.** Measured 2026-08-26, on branch
`rebuild/2026-08-26`, before any edit in this piece:

| What was counted | How | Result |
|---|---|---|
| The ruled-out provider's name in live code (`app/`, `lib/`, `components/`, `hooks/`, `.ts`/`.tsx`, comments stripped) | `node scripts/no-cloud-provider.mjs` | **0** |
| Same four roots, comments NOT stripped | `countMatches(['app','lib','components','hooks'], 'openrouter\|OPENROUTER')` — the existing `no-openrouter` acceptance check | **0** |
| `__tests__/` fixtures | `grep -rin … __tests__` | **0** |
| Repo source outside build output, `exports/`, `config/` and `db.sqlite` | `grep -rin` | **39 lines across 22 files** — 9 in `docs/`, 8 in `scripts/` (the acceptance graders' own detector patterns, `check-no-secrets.js` rule text, the board HTML, `setup.mjs` prose), 2 in `migrations/` `CHECK` constraints, and one each in `ops/HEARTBEAT.md`, `data/crons.json`, `README.md`, `.env.local.template` |
| Everything `grep -ri` sees, build artifacts and DB and Supabase export dumps included | `grep -ri … \| wc -l` | **263 lines**, of which **224** are inside `.next-*/` build output, `exports/supabase/*.json`, `config/` and `db.sqlite` |

No denominator produces 66. Nothing under `app/`, `lib/`, `components/` or
`hooks/` names the provider at all — not in code, not in a comment.

Where chat actually routes, measured against the running server rather than
read off a document:

```
$ curl -s localhost:3000/api/chat/models
{"base_url":"http://localhost:11434/v1","default_model":"qwen2.5-coder:7b",
 "models":[{"id":"qwen2.5-coder:14b",…},{"id":"qwen2.5-coder:32b",…},
           {"id":"qwen2.5-coder:7b",…}]}

$ curl -s localhost:11434/api/tags   # the endpoint itself
  qwen2.5-coder:14b  qwen2.5-coder:32b  qwen2.5-coder:7b
```

The two rosters are the same three ids because the first is a live proxy of the
second. `POST /api/chat` sends to `${LLM_BASE_URL}/chat/completions`
(`app/api/chat/route.ts:69`), and `LLM_BASE_URL` is
`http://localhost:11434/v1` in `.env.local`. There is no second endpoint in the
file and no vendor branch to reach one.

So the removal this piece was scoped around **had already been done**, in the
`chat-route-local-model` and `finish-openrouter-removal` pieces. What had NOT
been done is the thing that keeps it done: nothing in the tree fails when the
name comes back. The `no-openrouter` acceptance check is close, but it greps
raw text, so it cannot tell a live `fetch()` from a tombstone comment — which
means the only way to satisfy it is to delete the record of the deletion, and
this repo has twice reinvented a fabrication it had already removed.

That is what this piece builds: the guard, plus the evidence that the two
properties in the goal hold.

## What "a code branch" would look like, and why it is absent

A provider branch is an `if` in application code that picks an endpoint. The
seam has none. `lib/llm-provider.ts:13` is the whole selection:

```ts
export const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '')
```

`LLM_PROVIDER_ID` exists (`:47`) and is derived from that URL, but nothing
routes on it — it only lets a caller write a model id provider-qualified
(`ollama/qwen2.5-coder:7b`). `lib/runtimes/openai-api.ts:59 resolveProvider()`
reads the same variable and *refuses to default*: an unset `LLM_BASE_URL` is a
named configuration error, not a silent cloud endpoint.

## ACCEPTANCE

Each item is a command and the output that satisfies it. Run from the repo root
with the dev server already up on :3000. No item is satisfied by reading a file.

1. **`scripts/no-cloud-provider.mjs` exists and exits 0 on this tree.**
   `node scripts/no-cloud-provider.mjs; echo $?` → `0`, and its stdout names
   the ruled-out set it derived and the number of files it scanned.

2. **The guard derives its ruled-out set — it does not carry a list.**
   The set comes from the `**Never <Provider>.**` bullets under
   "Owner decisions already made — do not re-litigate" in
   `docs/rebuild/HANDOFF.md`. Observable: `grep -c "openrouter" -i
   scripts/no-cloud-provider.mjs` → `0`. The provider's name appears nowhere in
   the guard's own source, so the guard cannot be the last place the name lives.

3. **The guard refuses to run rather than pass when it cannot read its input.**
   `HANDOFF_MD_PATH=/nonexistent node scripts/no-cloud-provider.mjs; echo $?`
   → `2`, with a message saying the guard could not run. A guard that reports
   "clean" because it parsed nothing is worse than no guard.

4. **The guard fails when a reference is reintroduced into live code.**
   Add a line naming the ruled-out provider to a file under `app/`, `lib/`,
   `components/` or `hooks/`; `node scripts/no-cloud-provider.mjs; echo $?` →
   `1`, and the violation is printed as `file:line` with the offending token.
   Remove the line; → `0`. Both directions must be run and reported — a guard
   nobody has watched fail is an untested guard.

5. **The guard does NOT fail on a tombstone comment.** A comment recording that
   the provider was removed, in a file under a scanned root, leaves the exit
   code at `0`. Comments are stripped before scanning, deliberately and with
   the boundary stated in the guard's own header.

6. **The chat model list is read live, and is not a constant anywhere.**
   `curl -s localhost:3000/api/chat/models | jq -r '.models[].id'` and
   `curl -s localhost:11434/api/tags | jq -r '.models[].name'` print the same
   set. `node scripts/acceptance/run.mjs` reports `chat-model-list-is-live`
   PASS.

7. **The live list is the only source — an unreachable endpoint renders as an
   error, never as a fallback menu.** This is the dangerous form of a hardcoded
   list: a constant that only appears on the unhappy path, invisible to any
   grep. `npx jest __tests__/api/chat-model-list-is-live.test.ts` → 11 passing,
   covering unreachable (`ok:false`, error names the URL, no `models` key at
   all), non-2xx, empty roster, and "the roster is exactly the ids the endpoint
   reported, nothing appended". The route handlers turn each of those into a
   `502` naming the URL (`app/api/chat/models/route.ts:16-24`,
   `app/api/chat/route.ts:48-54` — line numbers before this piece's tombstone).

8. **A model id the endpoint does not serve is rejected by name.**
   `POST /api/chat` with `modelOverride` set to an id absent from the live
   roster → `400` whose body contains `unknown model "<id>" — not present in
   <base url>/models`. Measured against the running server:

   ```
   modelOverride=anthropic/claude-sonnet-4-6 -> 400 unknown model "anthropic/claude-sonnet-4-6"
   modelOverride=gpt-4o                      -> 400 unknown model "gpt-4o"
   modelOverride=qwen2.5-coder:7b            -> 200, SSE: {"delta":"OK"} {"done":true}
   ```

   A provider-qualified cloud id is never stripped down and answered by
   whichever model happens to be loaded.

9. **The provider is selected by configuration, not by an `if`.**
   `grep -rn "LLM_BASE_URL" app lib | wc -l` is non-zero and every consumer
   reads the variable; no file under `app/` or `lib/` contains a conditional
   that selects between two LLM hostnames. Changing `LLM_BASE_URL` in
   `.env.local` changes where chat sends, with no source edit.

10. **The tombstone survives the raw-text check.** `app/api/chat/route.ts`
    carries a written record of what was deleted from its line 9 and why —
    without spelling the provider's name, because the existing `no-openrouter`
    acceptance check greps this file as raw text. `grep -ci "<provider>"
    app/api/chat/route.ts` → `0`, and `node scripts/acceptance/run.mjs` reports
    `no-openrouter  PASS  0 occurrences`. This constraint is the reason the new
    guard strips comments and derives the name instead of carrying it.

11. **Nothing regressed.** `node scripts/acceptance/run.mjs` → `45/45`;
    `node scripts/no-invented-projects.mjs` → exit `0`; `npx tsc --noEmit` →
    clean; `npm test` → 961 passing, 5 failing, and those 5 are the known
    pre-existing `agents-route` / `agents-unconfigured` / `spawn-live`
    failures, unchanged by this piece.

## Coverage boundary — read this before trusting a green run

The guard scans `app/`, `lib/`, `components/`, `hooks/` only, and only
`.ts/.tsx/.js/.jsx/.mjs/.cjs`. It therefore does **not** cover, and a green run
does **not** clear:

- `migrations/045_connections_table.sql:13` and
  `migrations/sqlite/000_baseline.sql:326`, whose `CHECK (type IN (…))`
  constraints still admit a connection row of the ruled-out type. **Not fixed
  here — `migrations/**` is owned by another builder this session.** The exact
  change needed is on the two lines above: drop that one value from each
  `IN (...)` list, in a new migration rather than by editing the applied ones.
- `data/crons.json:44` — a cron whose description is a balance check against
  the ruled-out provider. Unowned by this piece.
- `.env.local.template:21`, `README.md:66`, `scripts/setup.mjs:199` — operator
  documentation that lists the provider as one example of an
  OpenAI-compatible endpoint. These are prose about a *shape*, not a route;
  whether they should still name it is an owner call, not a defect this guard
  should assert.
- `scripts/`, including the acceptance graders, which necessarily contain the
  detector pattern they hunt for.
- Comments, by design (item 5).
- `__tests__/`, where a fixture may legitimately name a removed provider in
  order to prove it stays removed. (Measured: it currently names none.)
- **`lib/runtimes/codex.ts:32-39` and `lib/runtimes/cursor.ts:30-40`, which DO
  still map a tier alias onto a hardcoded vendor model id** (`opus → gpt-5`,
  `opus → claude-opus-4-6`, …). Not flagged, and deliberately not changed. Those
  two adapters shell out to a CLI binary; their "provider" is the executable,
  not a base URL, and the model string is that CLI's own `--model` argument.
  There is no endpoint to configure, so there is no seam to move them onto. The
  runtime that DOES own a base URL — `lib/runtimes/openai-api.ts` — resolves
  tiers live (`mapModel()`, `:219-240`): `LLM_MODEL_<TIER>`, then `LLM_MODEL`,
  then the tier name, each checked against the live roster, `null` when nothing
  matches. It used to be a static map, and is not one now.
- **Concurrency note.** Mid-piece, `no-dead-modules` went red on
  `lib/issue-moves.ts` (no importer) and then green again without any change
  here — that file belongs to the board/pipeline builder working in parallel.
  Recorded so a future reader does not attribute the flap to this piece. Final
  state: `no-dead-modules` OK, 150 modules, all reachable.
