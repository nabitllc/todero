# PIECE: clone and run

id: clone-and-run
lane: Portability & Host Independence
channel goal: *"builderz-labs — SQLite and one start command, no Redis,
Postgres or Docker. Clone it, run it, working app on any OS with no cloud
account."*

## The claim this piece was opened on, and what was actually measured

`scripts/board/channels.json` carried, as the channel's current evidence:

> "Still far from goal: no SQLite adapter, so cloud Supabase remains a hard
> requirement, and there is no proven clone-to-running path."

**Two of its three clauses are false.** Measured 2026-08-26 on branch
`rebuild/2026-08-26`, before any edit in this piece:

| The claim | How it was checked | Result |
|---|---|---|
| "no SQLite adapter" | `lib/db/sqlite-adapter.ts` exists and is registered in `lib/db/adapters.ts`; acceptance check `sqlite-adapter-registered` | **False.** Adapter present, driver `better-sqlite3` |
| "cloud Supabase remains a hard requirement" | `npm run doctor` in the working tree | **False.** `db provider  sqlite`, `missing required env vars: 0`, exit 0 |
| "no proven clone-to-running path" | A real clone trial — see below | **True on the letter, and now discharged.** The path had never been run end to end. It has now, and it works except for one step |

The working tree's `.env.local` *does* hold Supabase credentials, but
`TODERO_DB_PROVIDER=sqlite` pins the adapter, and `lib/db/adapters.ts`
`detectProvider()` falls back to `sqlite` when nothing is set. The live
adapter is SQLite; the cloud credentials are inert.

### Rewritten evidence sentence

> Clone-to-running is proven end to end on Windows with no cloud account:
> `npm run setup` writes `.env.local`, generates the login password, pins
> `TODERO_DB_PROVIDER=sqlite` and applies 18 migrations into a 54-table
> `db.sqlite` in 1.7s; `npm run doctor` exits 0; the server boots and answers
> an authenticated issue create-and-read-back. One step still fails: on a host
> with no C++ toolchain, `npm install` from the committed `package-lock.json`
> runs `node-gyp rebuild` on `better-sqlite3` and dies, because lockfile v3
> does not record that package's `gypfile: false`.

---

## ACCEPTANCE

Every item is a command and an observable result. Run from a directory that
has never held this repo, on a host with no database server, no Docker, and no
account with any vendor.

| # | Acceptance criterion | Observable | Measured 2026-08-26 |
|---|---|---|---|
| 1 | A fresh clone contains no `.env.local`, no `db.sqlite`, no `node_modules` | `ls -a` after clone | **PASS** — none of the three present |
| 2 | `npm install` exits 0 on a host with no C++ compiler | exit code | **FAIL** — exit 1, `node-gyp rebuild` on `better-sqlite3`. See "The one failing step" |
| 3 | `npm run setup` exits 0 and asks no questions | exit code; no prompt on stdin | **PASS** — exit 0 in 1.7s, zero prompts |
| 4 | `npm run setup` needs no cloud account, no API key, no hand-edited file | full transcript contains no "sign up", no "paste your key", no manual edit step | **PASS** |
| 5 | Setup generates the login password and prints it | `MC_PASSWORD` in stdout and in `.env.local` | **PASS** — 16-char generated value, printed once |
| 6 | Setup pins the zero-account provider | `grep TODERO_DB_PROVIDER .env.local` | **PASS** — `TODERO_DB_PROVIDER=sqlite` |
| 7 | The database file exists and carries the full schema | count tables in `db.sqlite` | **PASS** — 54 tables, 843 776 bytes |
| 8 | Every migration is applied and ledgered | `select count(*) from schema_migrations` | **PASS** — 18 rows |
| 9 | `npm run doctor` exits 0 on the fresh clone | exit code | **PASS** — exit 0, `OK — this host can run Todero.` |
| 10 | Doctor names the live provider and where its data is | doctor output | **PASS** — `db provider  sqlite`, `db location  <checkout>/db.sqlite (843776 bytes)` |
| 11 | The server starts with one command | `npm run dev` | **PASS** — `Ready in 1974ms` on port 3100 |
| 12 | An unauthenticated page renders | `GET /login` | **PASS** — 200 (`GET /` → 307 to `/login`, the auth gate working) |
| 13 | The app reports its database reachable with no missing tables | `GET /api/health` | **PASS** — `db.reachable: true`, `latencyMs: 1`, `missingTables: []` |
| 14 | The generated password actually signs in | `POST /api/auth` | **PASS** — 200 `{"ok":true,"role":"owner"}` |
| 15 | Data routes refuse anonymous reads rather than leaking | `GET /api/issues` with no cookie | **PASS** — 401 `UNAUTHENTICATED` |
| 16 | An authenticated read succeeds | `GET /api/issues?all_projects=1` | **PASS** — 200, `{"data":[],"total":0}` |
| 17 | An authenticated **write** reaches SQLite and reads back | `POST /api/issues`, then `GET` | **PASS** — created `TOD-1`, read back with the same uuid |
| 18 | Validation errors name the field, not a stack trace | the four rejected `POST`s | **PASS** — missing `description`, bad `priority`, `type=task requires parent_id`, each named |
| 19 | Doctor tells a newcomer what is missing instead of letting them find it in a stack trace | `npm run doctor` on a broken install | **PASS after this piece** — see "What doctor now catches" |
| 20 | The README's commands are exactly the commands that work | diff README against the trial log | **FAIL before this piece** — three inaccuracies, all fixed here |

**18 of 20 pass. Item 2 is a genuine defect and is not in this piece's
ownership. Items 19 and 20 were fixed by this piece.**

---

## The clone trial, step by step

The trial was a real clone, not a description of one. `.git` was copied to a
throwaway directory and `git clone` was run **from the copy**, so the trial
tree is exactly the tracked files at `HEAD` (`cc101d5`) — no untracked file,
no in-flight edit, no `.env.local`, no `db.sqlite`. Nothing in the working
tree was read by git and nothing in it was written.

Only what a newcomer has was used: the README and the commands it names.

### Step 1 — `npm install` → **FAILED**

```
npm error code 1
npm error path  …\trial\todero\node_modules\better-sqlite3
npm error command failed
npm error command C:\Windows\system32\cmd.exe /d /s /c node-gyp rebuild
npm error gyp ERR! find VS  You need to install the latest version of Visual Studio
npm error gyp ERR! find VS  including the "Desktop development with C++" workload.
npm error gyp ERR! stack Error: Could not find any Visual Studio installation to use
```

Reproduced twice from a clean `node_modules`. **This is where a newcomer
stops.** The README's four-line quickstart never gets to line 2.

### Step 1a — isolating the cause

`better-sqlite3@13.0.3` is not the problem, and neither is a missing prebuild.
The package ships `prebuilds/win32-x64.node` inside its own tarball and
declares `gypfile: false` to tell npm not to compile it. Four measurements, in
an empty directory with no Todero code involved at all:

| Command | Lockfile present | Result |
|---|---|---|
| `npm install better-sqlite3@13.0.3` | no | **exit 0** — no gyp, prebuild used |
| `npm install` (from the lockfile npm itself just wrote) | yes | **exit 1** — `node-gyp rebuild` |
| `npm ci` | yes | **exit 1** — `node-gyp rebuild` |
| `npm install --ignore-scripts` | yes | **exit 0**, and the module works |

The lockfile is the variable. With no lockfile npm reads `gypfile: false` from
the registry manifest and skips the build. `lockfileVersion: 3` does not
record `gypfile`, so on the lockfile path npm falls back to "this package has
a `binding.gyp`, therefore compile it" and runs its default `node-gyp rebuild`
— on a package that explicitly asked it not to.

That the shipped prebuild is fine was proven directly:

```
$ npm install --ignore-scripts && node -e "…"
better-sqlite3 WORKS, read back: 42
```

So the compiler was never needed. npm was told to invoke one anyway.

### Steps 2–7 — everything after `npm install` **PASSED**

With dependencies present (installed via `--ignore-scripts`, which is
knowledge a newcomer does not have — that is the finding, not a fix):

```
$ npm run setup                          exit 0, 1.7s
  [1/5] .env.local      created from .env.local.template; 4 secrets generated
  [2/5] LLM endpoint    3 models at http://localhost:11434/v1
  [3/5] Database        provider = sqlite; pinned TODERO_DB_PROVIDER=sqlite
  [4/5] Migrations      18 sqlite migration(s) applied; db.sqlite created
  [5/5] Next steps      "This host is configured — database: sqlite."

$ npm run doctor                         exit 0, "OK — this host can run Todero."
$ PORT=3100 npm run dev                  Ready in 1974ms

$ curl /api/health
  {"ok":true,"db":{"reachable":true,"latencyMs":1},
   "schema":{"missingTables":[],"malformedTables":[]}}

$ curl -X POST /api/auth -d '{"password":"<the one setup printed>"}'
  {"ok":true,"role":"owner"}                                        200

$ curl -X POST /api/issues -d '{…}'
  {"task_key":"TOD-1","id":"72c96759-…","project":"TRIAL"}          200
$ curl /api/issues?all_projects=1
  {"data":[{"task_key":"TOD-1","id":"72c96759-…"}],"total":1}       200
```

**No cloud account was required at any point, at boot or after it.** The only
network call in the whole trial was to `localhost:11434`, and setup states in
its own output that Todero starts whether or not that answers.

### Honest caveats about this trial

- **The host had Ollama running.** A newcomer without it gets `[2/5] no
  answer:` and three printed remedies. Setup still exits 0 and the app still
  boots; chat and agent dispatch stay off. This was not separately verified
  with Ollama stopped.
- **`npm install` was completed with `--ignore-scripts`.** Steps 2–7 are
  therefore proven *given dependencies*, not proven from a bare clone on this
  host. Item 2 of ACCEPTANCE is the gap.
- **No build was run.** `npm run build` is out of scope for this piece, so the
  production command `npm start` is unproven here. Only `npm run dev` was.
- **Windows only.** macOS and Linux were not tested. The `node-gyp` failure is
  specific to hosts without a C++ toolchain, which is the normal state of a
  Windows machine and the abnormal state of a Linux one.

---

## The one failing step, and where it lives

**File: `package-lock.json`, the entry `"node_modules/better-sqlite3"`.**

```json
"node_modules/better-sqlite3": {
  "version": "13.0.3",
  "resolved": "…",
  "integrity": "…"
}
```

There is no `hasInstallScript` and no `gypfile` field — lockfile v3 has no
slot for the latter. npm 11.16.0 therefore compiles a package that ships a
working prebuild for this exact platform.

This is **not in this piece's ownership** (`package.json` and its lockfile
belong to another builder this session). The fix belongs to whoever owns
dependency management. Candidates, none of them verified here beyond what is
noted:

1. **A repo-root `.npmrc` with `ignore-scripts=true`** — *rejected.* It would
   also disable `prepare`, `predev`, `prestart` and, critically, `prebuild`,
   which is where `check:secrets` and `guard:no-silent-empty` run. Disabling
   the guards to fix an install is exactly the trade this rebuild refuses. The
   `--ignore-scripts` *flag* is fine precisely because it is install-time only;
   the config setting is not the same thing.
2. **Move `better-sqlite3` to a driver with no `binding.gyp` at all** — Node's
   built-in `node:sqlite` is the obvious candidate on Node 22+, and would
   delete this failure mode rather than document it. Cost: it is a different
   API, so `lib/db/sqlite-adapter.ts` changes. Not attempted here.
3. **Vendor the prebuilt binary** and skip the resolution entirely.
4. **A newer npm may record or honour `gypfile` on the lockfile path.** This
   was *not* checked — the only npm available here is 11.16.0, and every
   measurement above is against that one. Anyone taking this option should
   confirm it before recording a minimum in `engines`.

Until one of those lands, the README documents the failure and the exact
recovery command, so a newcomer is told rather than left in a gyp stack trace.

---

## What doctor now catches that it did not

`npm run doctor` runs *after* `npm install`, so it can never prevent the
failure above. What it can do — and now does — is recognise its aftermath.

**Doctor was reporting a fake green in exactly that state**, which is the
failure mode its own header says it exists to prevent. Measured in the trial
clone with `node_modules/better-sqlite3/prebuilds/` removed — the state a
failed `npm install` leaves behind:

```
Environment
───────────
[boot-migrate] boot migration failed: Cannot find module '…better_sqlite3.node'
Require stack:
- …\node_modules\better-sqlite3\lib\binding.js
- …\lib\db\boot-migrate.ts
  db provider     sqlite
  db location     …\db.sqlite  (843776 bytes)
  missing required env vars: 0

Summary
───────
  OK — this host can run Todero.

=== EXIT 0 ===
```

It said **OK** and **exited 0**. The same checkout, at the same moment:

```
$ curl /api/health
{"ok":false,"db":{"reachable":false,"error":"Cannot find module '…better_sqlite3.node'"}}
```

The app could not read a single row. The only signal doctor gave was a raw
`Require stack:` dump printed by `lib/db/boot-migrate.ts` into the middle of
an unrelated section — and it was printed *above* the reassuring lines, so it
read as noise before a pass.

The cause is that `requiredEnvReport()` resolves the provider *name* from the
environment without ever touching the driver. Asking the environment a
question cannot detect a broken binary. Doctor now opens an in-memory database
and round-trips a row instead — a `require` alone is not enough, because
`better-sqlite3` resolves its `.node` file lazily on first construction.

Three states, all measured after the change:

| State of `node_modules/better-sqlite3` | `Native modules` says | Exit |
|---|---|---|
| healthy | `13.0.3   binding loads, in-memory query OK` | **0** |
| present, `prebuilds/` removed | `13.0.3   BINDING WILL NOT LOAD` + the npm/lockfile explanation + `Recover with: npm install --ignore-scripts` | **1** |
| directory absent | `not installed` + "run `npm install` first" | **1** |

A fourth case — a binding built for a different Node ABI — is detected
separately (`NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED`) and gets the
different remedy it needs, `npm rebuild better-sqlite3`, because "you changed
Node" and "npm compiled instead of using the prebuild" do not have the same
fix. That branch is written but was **not** reproduced on this host; the other
three were.

The printed recovery command was verified rather than assumed: from the
`not installed` state, running the exact string doctor prints returned doctor
to `binding loads, in-memory query OK`, exit 0.

Failing is scoped to when it matters: a broken driver only fails doctor when
`sqlite` is the *active* provider. On a Postgres or Supabase install it is
reported and stays news.

## What the README got wrong, and now does not

| README said | Reality measured in the trial |
|---|---|
| "Prerequisite: **Node 22+**. Nothing else" | On Windows with the committed lockfile, `npm install` needs Visual Studio Build Tools or the recovery command |
| "the result is a working board with real data in it" | A fresh clone's board is **empty** — `{"data":[],"total":0}`, `projects: []`. The schema is real; the data is not there |
| "`better-sqlite3` ships prebuilt binaries … so on those hosts `npm install` needs no compiler" | The prebuild exists and works; npm invokes the compiler anyway on the lockfile path |

`.env.local.template` also described the `sqlite` adapter as going "through
Node's own `node:sqlite`". It goes through `better-sqlite3` — which is the
whole reason a compiler enters this story at all. Corrected.

---

## Portability notes beyond this host

- `start.sh` in the repo root is bash-only and is **not** referenced by the
  README quickstart or by any `package.json` script. It is dead weight for a
  Windows newcomer but blocks nothing.
- `scripts/setup.mjs` and `scripts/doctor.mjs` both special-case Windows when
  spawning `npm` (a `.cmd` shim Node will not spawn without a shell). Both
  handle it correctly; verified by both commands exiting 0 here.
- `scripts/smoke-test-layout.sh` and the other `.sh` scripts require bash. Not
  on the clone-to-running path, so not a portability defect for this goal.
- Paths resolved by `lib/paths.ts` were all correct Windows paths in the trial
  clone, including `LOG_DIR` and `WORKTREE_ROOT` under the OS temp directory.
