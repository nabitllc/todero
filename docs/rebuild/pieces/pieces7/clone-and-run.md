# PIECE: clone and run (continued)

id: clone-and-run
lane: Portability & Host Independence / Observability & Honest Reporting
channel goal: *"finish Todero so it runs on any machine against any LLM API,
tested with local Ollama."*

**This is a continuation of `docs/rebuild/pieces/pieces6/clone-and-run.md`,
not a rewrite of it.** That piece ran a real clone trial on 2026-08-26 and left
two things explicitly open, in its own words:

> Item 2 is a genuine defect and is not in this piece's ownership.
> … This is **not in this piece's ownership** (`package.json` and its lockfile
> belong to another builder this session). The fix belongs to whoever owns
> dependency management.

This session owns `package.json` / `package-lock.json`. This piece picks up
exactly that defect, plus doctor's fake-green pattern the same predecessor
piece documented as fixed for one failure mode (a broken native binding) but
never checked against two others it named as untested: a corrupt data file
and a dead Postgres. Both were checked here, and both were fake green.

---

## What was verified before touching anything, and how

Two prior claims were treated as claims, not facts, and checked fresh in this
session before any edit:

| Claim | How checked | Result |
|---|---|---|
| `npm install` fails with no C++ toolchain | Fresh clone (`trial1`), `npm install`, real exit code (not a piped `$?`) | **Reproduced directly** — this host genuinely has no Visual Studio / C++ toolchain, so this was a real failure, not a simulation |
| Doctor reports a fake green | Corrupted a **copy** of `db.sqlite`, pointed `TODERO_DB_PROVIDER=postgres` at a closed port | **Reproduced directly** — `npm run doctor` printed "OK — this host can run Todero." and exited 0 in both cases, before any fix in this piece |

---

## Fix 1 — `npm install` no longer needs a compiler

### Root cause, read out of npm's own source, not guessed

`better-sqlite3@13.0.3` ships a working prebuilt binary for every platform
(`prebuilds/*.node`) and declares `"gypfile": false` in its own
`package.json` specifically to tell npm not to compile it. Measured:

```
$ npm install better-sqlite3@13.0.3     # empty dir, no lockfile
added N packages                         EXIT 0, no gyp, prebuild used

$ npm install                            # same dir, lockfile now present
npm error gyp ERR! find VS  Could not find any Visual Studio installation
                                          EXIT 1
```

The lockfile's presence, not its version or content, is the variable — a
second `npm install` from the same freshly-written lockfile fails the same
way. The cause, found in
`@npmcli/arborist/lib/install-scripts.js` (installed npm 11.16.0, this host):

```js
const hasExplicitGypGate = !!(collected.preinstall || collected.install)
if (
  !hasExplicitGypGate &&
  pkg.gypfile !== false &&                      // <- the check
  await isNodeGypPackage(node.path).catch(() => false)
) {
  collected.install = 'node-gyp rebuild'
}
```

`pkg` here is the dependency record arborist built while resolving **from
the lockfile**. `lockfileVersion: 3` has no slot for `gypfile`, so `pkg.gypfile`
reads `undefined`, and `undefined !== false` is `true` — the synthetic
`node-gyp rebuild` step fires on a package that explicitly asked it not to.
Installing the same package with no lockfile present reads `gypfile` from the
real, freshly-fetched manifest and correctly skips the rebuild. The bug is
specific to the lockfile-resolution path.

### The fix, and what was tested before trusting it

Adding `"gypfile": false` directly to the `better-sqlite3` entry in
`package-lock.json` gives arborist's lockfile-only view of the package the
same field the real manifest has. Measured in an isolated scratch clone,
each state confirmed with a real (non-piped) exit code:

| Command, against the patched lockfile | Result |
|---|---|
| `npm install` (empty `node_modules`) | **exit 0**, no gyp invoked, `node_modules/better-sqlite3/build` absent (prebuild used, not compiled) |
| `npm ci` (empty `node_modules`, lockfile never mutated by `ci`) | **exit 0**, same prebuild used |
| `npm install` again, no `node_modules` deleted (idempotent re-run) | **exit 0**, no-op, still works |

One durability gap was found and is now guarded, not just noted: **a plain
`npm install` REWRITES `package-lock.json` to its own canonical shape once it
succeeds, and that shape drops the `gypfile` field again.** Measured directly
— patch the field, run `npm install`, `grep gypfile package-lock.json` goes
from 1 match to 0. If a future contributor bumps a dependency, runs
`npm install`, and commits the regenerated lockfile, this fix disappears with
no error anywhere, and the next clone with no toolchain hits this exact
failure again. `npm ci` does not have this problem (it never mutates the
lockfile), but `npm install` is what the README documents.

**Guard added:** `__tests__/lockfile-gypfile-guard.test.ts` asserts
`package-lock.json`'s `better-sqlite3` entry carries `gypfile: false`, and
separately asserts the installed package still ships that field and a
`prebuilds/**` files entry (so if a future version bump drops the prebuild,
this test fails loudly instead of silently suppressing a rebuild the package
would then genuinely need).

**Two things this fix does NOT do**, stated rather than implied:
- It does not touch `lib/db/**` or any application code — the change is one
  field in `package-lock.json`.
- It does not add an `.npmrc` with `ignore-scripts=true`. That was considered
  and rejected in `pieces6` for good reason: it would also disable `prepare`,
  `predev`, `prestart`, and `prebuild` — the last of which is where
  `check:secrets` and `guard:no-silent-empty` run. This fix is narrower: it
  suppresses exactly one package's synthetic gyp step, nothing else.

---

## Fix 2 — doctor now opens the real database, not just the driver

`pieces6` fixed doctor reporting a fake green when the **native binding**
(`better-sqlite3.node`) would not load, by opening an in-memory database. That
proves the driver works. It does not open the actual data file, so it could
not — and did not — catch the file itself being unreadable.

### Measured, before any fix in this piece

```
$ cp db.sqlite db.sqlite.bak      # work on a copy, per instructions
$ head -c 2000 /dev/urandom > db.sqlite
$ npm run doctor
...
Environment
───────────
[boot-migrate] boot migration failed: file is not a database
  db provider     sqlite
  missing required env vars: 0
Summary
───────
  OK — this host can run Todero.
$ echo $?
0
```

Same pattern for Postgres — `requiredEnvReport()` only ever checked whether
`DATABASE_URL` is *set*, never whether anything answers:

```
$ TODERO_DB_PROVIDER=postgres DATABASE_URL=postgresql://user:pass@localhost:59999/x npm run doctor
...
  db provider     postgres
  missing required env vars: 0
Summary
───────
  OK — this host can run Todero.
```

Both are exactly the failure doctor's own file header says it exists to
prevent, on a data-file corruption and a dead-endpoint case its predecessor
piece explicitly left unchecked.

### The fix

`scripts/doctor.mjs` gained a new "Database (live check)" section:

- **sqlite**: opens the real file (never `:memory:`) read-only via
  `better-sqlite3` with `fileMustExist: true`, and runs `PRAGMA quick_check`
  — which reads every page, not just the header — before declaring it OK.
- **postgres**: makes one real `pg.Client` connection with a 5s timeout and
  runs `SELECT 1`, using the project's own `pg` dependency (no new package).
  The connection string is redacted before ever being printed.
- Neither check runs when there is nothing to check yet (`db.sqlite` not
  created) or when the driver itself is already known broken (avoids
  reporting the same root cause twice in different words) — those states
  report as **unknown/not-yet**, never as **ok**.
- The exit-code formula gained `dbUnreachable` (`dbHealth.checked &&
  dbHealth.ok === false`) alongside the existing fatal conditions, so a
  corrupt file or a dead Postgres now fails the same command a CI gate reads.

### Red-then-green, measured for every state this piece touched

| State | `Database (live check)` says | Exit |
|---|---|---|
| healthy `db.sqlite` | `quick_check   ok — opened read-only and read every page` | **0** |
| `db.sqlite` overwritten with 2000 random bytes | `reachable   NO` / `file is not a database` | **1** |
| healthy `db.sqlite` restored from the pre-corruption copy | back to `quick_check ok` | **0** |
| `DATABASE_URL` pointed at a closed port | `reachable   NO` / `ECONNREFUSED` | **1** |
| provider restored to `sqlite` | back to `OK — this host can run Todero.` | **0** |

**A message-quality bug was found and fixed while proving this**: the first
dead-Postgres run printed `Postgres at DATABASE_URL did not answer: ` with
nothing after the colon. Node's dual-stack connect failure surfaces as an
`AggregateError` whose own top-level `.message` is empty (`err.message ===
''`); the real reason lives in `err.code` (`ECONNREFUSED`) and `err.errors[]`.
Confirmed directly with a standalone `pg.Client().connect()` against the same
closed port before changing the fallback order to `.message → .code →
.errors[0].message → String(err)`.

---

## Fix 3 — "0 models" no longer means the same thing for two different problems

`lib/llm-provider.ts`'s `fetchLiveModels()` parses the endpoint's response
with `res.json().catch(() => null)` and defaults a parse failure to an empty
model list. That means a 200-OK response from **any** server — OpenAI-shaped
or not — reports `{ ok: true, models: [] }`, identically to a real Ollama with
nothing pulled yet. Measured:

```
$ node -e "require('http').createServer((_,res)=>res.end('<html>hi</html>')).listen(8099)"
$ LLM_BASE_URL=http://localhost:8099/v1 npm run doctor
LLM endpoint
────────────
  reachable       yes — 0 models        # before this fix — indistinguishable
                                         # from "Ollama, nothing pulled yet"
```

This is not the same problem as an unconfigured Ollama and does not have the
same fix — one needs a different `LLM_BASE_URL`, the other needs `ollama
pull`. Since `lib/llm-provider.ts` is outside this piece's ownership, the fix
lives entirely in the tooling this piece owns: `scripts/lib/env-report.mjs`
gained `probeOpenAiShape(baseUrl)`, a second, independent, read-only request
that inspects the actual response — valid JSON with a `data` array (OpenAI
shape, genuinely zero models) vs. anything else (not an OpenAI-compatible
endpoint at all) vs. a probe failure of its own (reported as **unknown**,
never folded into either verdict). Both `npm run setup` and `npm run doctor`
call it, so the two commands agree, as the file's own header already commits
them to.

Measured after the fix, same fake server:

```
LLM endpoint
────────────
  reachable       yes — 0 models
  shape           NOT an OpenAI-compatible endpoint
                  responded 200, Content-Type: text/html — body is not JSON,
                  so this is not an OpenAI-compatible endpoint
```

And `npm run setup` against the same fake server:

```
[2/5] LLM endpoint
      0 models available:
      this endpoint is reachable but is NOT an OpenAI-compatible API:
        responded 200, Content-Type: text/html — body is not JSON, ...
   -  Point LLM_BASE_URL at an actual OpenAI-compatible server instead —
         Ollama (http://localhost:11434/v1), OpenRouter, Together, Azure, vLLM, …
```

Restoring `LLM_BASE_URL` to the real, running Ollama on this host produced the
unchanged original good output (3 models listed, no shape warning) — the new
check is silent whenever there is nothing to say.

**LLM_BASE_URL pointing nowhere** (a closed port, not a wrong-shaped server)
was also checked and was already handled correctly before this piece:
`reachable no` / `<url> is unreachable — fetch failed`, and `npm run setup`
prints the Ollama-install / hosted-endpoint remedies. No change was needed
there.

---

## The full clone-to-running trial, twice, from genuinely fresh copies

Per the working instructions for this piece, a commit in the main checkout
was not made (the four other concurrently running agents' in-progress,
uncommitted edits to unrelated files rule out a safe `git commit` here, and
an automated checkpoint process in this environment periodically commits the
whole working tree on its own schedule regardless — see "What happened to
the diff" below). Because the fix therefore lived only in the working tree
until an automated checkpoint caught it, the fresh-copy trial could not use
`git clone` from a `.git` copy (that only ever reproduces committed history).
Instead each trial copied the current working tree via `robocopy`, explicitly
excluding `node_modules`, `.next`, `.git`, `db.sqlite`, `.env.local`, and every
`workspace-*` agent-worktree directory — the same no-account-artifacts
guarantee a `git clone` gives, applied to the working tree instead of to
`HEAD`.

**Trial 2** (used to develop and iterate on the doctor/setup fixes) and
**Trial 3** (a second, independent fresh copy taken after every fix above was
in place, run without reusing anything from Trial 2) both passed the full
path. Trial 3, the one that matters as the final proof:

```
$ npm install                                       EXIT 0, 30s, no gyp
$ ls node_modules/better-sqlite3/build               (absent — prebuild used)

$ npm run setup                                      EXIT 0
  [1/5] .env.local        created; 4 secrets generated
  [2/5] LLM endpoint      3 models at http://localhost:11434/v1
  [3/5] Database          provider = sqlite; pinned TODERO_DB_PROVIDER=sqlite
  [4/5] Migrations        20 sqlite migration(s) already applied (boot-migrate
                          ran them before this explicit step — see caveat below)
  [5/5] Next steps        "This host is configured — database: sqlite."

$ node -e "… select count(*) from sqlite_master …"   54 tables
$ node -e "… select count(*) from schema_migrations" 20 rows

$ npm run doctor                                     EXIT 0
  Native modules   better-sqlite3  13.0.3   binding loads, in-memory query OK
  Database (live check)   quick_check   ok — opened read-only and read every page
  Summary   OK — this host can run Todero.

$ PORT=3188 npm run dev                              Ready in 1953ms

$ curl /api/health
  {"ok":true,"db":{"reachable":true},"schema":{"missingTables":[]}}

$ curl -X POST /api/auth -d '{"password":"<generated>"}'
  {"ok":true,"role":"owner"}                                        200

$ curl /api/issues                    (no cookie)                  401
$ curl -X POST /api/issues -d '{... project:"Limiglow", type:"feature" ...}'
  {"task_key":"TOD-1","project":"Limiglow", ...}                    200
$ curl /api/issues?all_projects=1
  {"total":1,"data":[{"task_key":"TOD-1", ...}]}                    200
```

`TOD-1` here is a row in Trial 3's own private, throwaway `db.sqlite` inside
the scratch copy — not the shared team database. The whole scratch directory
(`trial1`, `trial2`, `trial3`, both `gitcopy*` directories, and every log
written during this session) was deleted at the end; nothing was left behind
outside the main checkout, and nothing in the shared Supabase/production
database was touched by this piece at all.

### Honest caveats about these trials

- **Ollama was running throughout.** The "points nowhere" and "not
  OpenAI-compatible" LLM scenarios were tested by pointing `LLM_BASE_URL` at a
  closed port and at a throwaway plain-HTTP server, respectively — not by
  stopping the real Ollama, which was left running for the rest of the
  session's other work. "A real Ollama" (the third scenario in the brief) was
  the state already exercised by every `setup`/`doctor` run in this trial.
- **This host genuinely has no C++ toolchain**, so the `npm install` failure
  in Fix 1 is a real reproduction, not an inference — confirmed by the `gyp
  ERR! find VS` output naming the exact missing tool. No toolchain-less VM was
  built; none was needed.
- **`npm run build` was never run**, per this piece's hard rule. `npm start`
  (the production path) is therefore still unproven; only `next dev` was.
- **Windows only.** The `gypfile` bug is specific to the lockfile-resolution
  path in npm's arborist and is not Windows-specific in its mechanism, but it
  was only measured on Windows here. macOS/Linux prebuilds exist in the same
  tarball (`prebuilds/darwin-*`, `prebuilds/linux-*`) but were not installed
  on another OS in this session.
- **The "0 new migrations" line is unexplained but not investigated.** Both
  trials' fresh `db.sqlite` reported migrations already applied by the time
  the explicit `npm run db:migrate` step ran inside `npm run setup` — some
  earlier step (plausibly `lib/db/boot-migrate.ts`, referenced in doctor's own
  comments) appears to auto-apply migrations on first open. `lib/db/**` is
  outside this piece's ownership, so this was observed and reported, not
  changed or fully traced.
- **A postgres "green" (real reachable Postgres) was not measured** — only
  the dead-endpoint (red) and the restore-to-sqlite (unrelated green) states
  were. No live Postgres instance was available in this session to connect
  to. The `SELECT 1` code path was read and is structurally identical to the
  sqlite live-check's proven pattern, but is not itself red-then-green proven.
- **What happened to the diff**: this environment runs an automated process
  outside this agent's control that commits the entire working tree on its
  own schedule (`checkpoint: <timestamp>` commits visible in `git log`,
  authored by the repo owner's account, roughly every 3 minutes). All five
  files this piece changed were swept into two such checkpoints
  (`6cc70e7`, `e650b2f`, `ab3ba5d`) during this session, alongside unrelated
  concurrent agents' work in the same commits. This piece did not run `git
  add` beyond a single stage-then-immediately-`git reset` (to check a diff
  size) and did not run `git commit` at all — every commit visible in
  `git log` for these files was made by that external process, not by this
  agent.

---

## ACCEPTANCE — a fresh-context critic can check every line without trusting the summary above

| # | Criterion | How to check | Result |
|---|---|---|---|
| 1 | `package-lock.json`'s `better-sqlite3` entry has `"gypfile": false` | `grep -A2 '"node_modules/better-sqlite3"' package-lock.json` | **PASS** |
| 2 | A regression test fails if that field is ever dropped | `npx jest __tests__/lockfile-gypfile-guard.test.ts` | **PASS**, 2/2 |
| 3 | Fresh clone, `npm install` exits 0 with no C++ toolchain present | reproduce per "The full clone-to-running trial" above | **PASS**, exit 0, no gyp invoked |
| 4 | The installed `better-sqlite3` uses the prebuild, not a compile | `ls node_modules/better-sqlite3/build` absent after install | **PASS** |
| 5 | `npm ci` also works, and does not need the fix re-applied | `rm -rf node_modules && npm ci` after step 3 | **PASS**, exit 0 |
| 6 | Doctor opens the real `db.sqlite`, not just `:memory:` | read `scripts/doctor.mjs` `reportSqliteHealth()` | **PASS** — `new Database(file, {readonly:true, fileMustExist:true})`, `PRAGMA quick_check` |
| 7 | A corrupted `db.sqlite` fails doctor, not just prints a note | corrupt a copy, `npm run doctor`, check real (non-piped) exit code | **PASS**, exit 1 |
| 8 | Restoring the file returns doctor to green | restore the copy, re-run | **PASS**, exit 0 |
| 9 | A dead Postgres fails doctor with a real connection attempt | `TODERO_DB_PROVIDER=postgres DATABASE_URL=postgresql://x:y@localhost:1/z npm run doctor` | **PASS**, exit 1, names `ECONNREFUSED` |
| 10 | The connection string is never printed with its credentials | read `redactConnectionString()` in `scripts/doctor.mjs` | **PASS** — username/password replaced with `***` before any `row()` call |
| 11 | A non-OpenAI-compatible endpoint is distinguished from "0 models pulled" | point `LLM_BASE_URL` at a plain HTTP server, `npm run doctor` and `npm run setup` | **PASS** — both print `NOT an OpenAI-compatible endpoint` with the Content-Type and the parse failure named |
| 12 | `setup` and `doctor` never disagree about the LLM endpoint | both import `probeOpenAiShape` from the same `scripts/lib/env-report.mjs` | **PASS** — one implementation, two call sites |
| 13 | Doctor never says "ok" for something it could not determine | read every `return { ok: null, … }` branch in the new functions | **PASS** — file-not-created-yet, path-unresolvable, and pg-probe-itself-failed all return `null`/"unknown", never `true` |
| 14 | `npx tsc --noEmit` is clean | run it | **PASS**, zero errors |
| 15 | `npm test` matches the documented baseline failure set | run it | **PASS** — 1157 passed / 5 failed (`agents-route`, `agents-unconfigured`, `spawn-live`) / 2 skipped / 1164 total — same three files as the session's stated baseline, total risen as expected |
| 16 | `node scripts/acceptance/run.mjs` is unregressed | run it | **PASS**, 45/45, 10/10 |
| 17 | `bash scripts/smoke-test-layout.sh` is unregressed | run it | **PASS**, all guards green |
| 18 | The main dev server on :3000 was left running throughout | `netstat -ano \| grep :3000` before and after this piece's work | **PASS** — same PID, never restarted |
| 19 | No row was left in the shared database | every issue created during this piece lived in a scratch `db.sqlite` inside a deleted temp directory, never the shared/production database | **PASS** — nothing to delete; the file it lived in no longer exists |
| 20 | Every scratch directory this piece created was deleted | `ls` the scratchpad for `trial1`, `trial2`, `trial3`, `gitcopy`, `gitcopy2` | **PASS** — none present |

**20 of 20 pass.**

---

## What this piece did NOT verify, stated plainly

- A toolchain-less host was not literally built — this host has no toolchain
  already, so the `npm install` failure is a direct measurement, not an
  inference from a log, but it is still one host's toolchain absence, not a
  controlled "definitely no compiler anywhere" environment.
- macOS and Linux were not tested at all.
- `npm run build` and `npm start` were not run, per this piece's own hard
  rule; only `next dev` was proven.
- A real, reachable Postgres was never connected to — only the dead-endpoint
  and non-postgres-provider states were measured for that code path.
- Stopping the real Ollama entirely (rather than pointing at a closed port or
  a wrong-shaped server) was not separately re-verified in this session; it
  was verified in `pieces6` and not re-run here since Ollama stayed up for
  other concurrent work.
- The "20 migrations already applied by the time the explicit migrate step
  runs" behavior was observed, not explained — `lib/db/**` is out of this
  piece's ownership.
- The ABI-mismatch doctor branch (`NODE_MODULE_VERSION` message pattern) was
  read but not reproduced, same as in `pieces6`.

## Files touched by this piece

- `package-lock.json` — one field (`gypfile: false` on `better-sqlite3`)
- `scripts/doctor.mjs` — live sqlite/postgres health checks, corrected
  AggregateError message extraction, `probeOpenAiShape` wired in, exit-code
  formula extended
- `scripts/setup.mjs` — `probeOpenAiShape` wired in at setup time
- `scripts/lib/env-report.mjs` — `probeOpenAiShape` added as the one shared
  implementation `setup` and `doctor` both call
- `__tests__/lockfile-gypfile-guard.test.ts` — new regression guard
- `docs/rebuild/pieces/pieces7/clone-and-run.md` — this file
