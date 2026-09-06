# Session Gates

The real verification commands for this repo, read out of `package.json` scripts and
`.github/workflows/pr-trusted.yml`. Every command below was run once on 2026-09-06 (Windows 11,
Node v24.18.0, pnpm 9.15.4) and the result recorded verbatim. Nothing here is inferred.

`AGENTS.md` § 7 is the authoritative policy on *when* to run these; this file records *what they
are* and *which ones work on this machine*.

## There is no jest here, and no eslint

- The unit runner is **Vitest 4** (`vitest.config.ts`, root `devDependencies`). There is no jest
  dependency, so the `--experimental-vm-modules` flag that plagues jest ESM setups does not apply.
  A bare `npx vitest` is also wrong for a different reason: the suite is split into general and
  serialized modes by `scripts/run-vitest-stable.mjs`, and `pnpm test` routes through it.
- There is **no ESLint or Prettier** — no config file, no `lint` script in any workspace. The lint
  role is played by the deterministic check scripts below.

## The gates

### Cheap deterministic checks

| Command | Script | Run 2026-09-06 |
|---|---|---|
| `pnpm check:node-version` | `scripts/check-node-version-policy.mjs` | **PASS** |
| `pnpm check:no-git-push` | `scripts/check-no-git-push.mjs` | **PASS** |
| `pnpm check:tokens` | `scripts/check-forbidden-tokens.mjs` | **PASS** |
| `pnpm check:token-gates` | `scripts/check-token-gates.mjs` | **FAIL** (pre-existing) |

Tails:

```
Node version policy check passed (Node >=24.11.0, @types/node 24.x).
  V  No unapproved `git push` invocations found in adapter/runtime code.
  V  No forbidden tokens found.
```

`pnpm check:token-gates` exits 1 on a clean checkout of `main`:

```
  Files scanned:                 833
  Gate 1 (color literals):       4 violation(s)
  Gate 2 (arbitrary bracket vals): CLEAN
  Gate 3 (raw font-size):        CLEAN
  Gate 4 (legacy hsl(var())):    CLEAN

  ui/src/components/todero/LocalLlmPicker.test.tsx:126  #111111
  ui/src/components/todero/LocalLlmPicker.test.tsx:127  #ffffff
  ui/src/components/todero/LocalLlmPicker.test.tsx:128  #fff
  ui/src/components/todero/LocalLlmPicker.test.tsx:128  #ffffff
```

All four are hex literals inside a **test** file. This is a standing failure, not caused by any
change in this branch. It means the gate cannot currently be used as a pass/fail signal for a UI
change — compare the violation list before and after instead, or fix the four literals.

`check:tokens` and `check:token-gates` are **not** in any CI workflow (grepped
`.github/workflows/`). They are local pre-commit gates, required by `AGENTS.md` § Design system
before committing UI changes.

### Typecheck

`pnpm typecheck` = `pnpm run preflight:workspace-links && pnpm -r typecheck`.

**`pnpm typecheck` fails on this machine before it reaches TypeScript.** The preflight step
(`scripts/ensure-workspace-package-links.ts:104`) creates workspace symlinks and Windows refuses
without Developer Mode or an elevated shell:

```
Error: EPERM: operation not permitted, symlink 'C:\Development\Todero\packages\shared'
  -> '...\packages\plugins\examples\plugin-orchestration-smoke-example\node_modules\@todero\shared'
```

`pnpm -r typecheck` (skipping preflight) gets further and then fails in one package:

```
packages/paperclip-runner typecheck: > cargo fmt --manifest-path runner/Cargo.toml --all -- --check
packages/paperclip-runner typecheck: 'cargo' is not recognized as an internal or external command
```

`packages/paperclip-runner` has a Rust workspace (`runner/Cargo.toml`) and its `typecheck:rust`
needs the Rust toolchain. Per-workspace results:

| Workspace | Command | Result |
|---|---|---|
| `@todero/ui` | `pnpm --filter @todero/ui typecheck` | **PASS** (exit 0) |
| `@todero/db` | `pnpm --filter @todero/db typecheck` | **PASS** (exit 0) |
| `@todero/shared` | `pnpm --filter @todero/shared typecheck` | **PASS** (exit 0) |
| `@todero/server` | `pnpm --filter @todero/server typecheck` | **BLOCKED** (exit 1) |

`@todero/server`'s typecheck starts with `prepare:runner-vendor`, which builds
`@todero/paperclip-runner`, whose `build:binary` is `cargo build --release ...` — the same missing
toolchain. The server's own `tsc --noEmit` is never reached.

### Tests

`pnpm test` = `pnpm test:run` = preflight + `node scripts/run-vitest-stable.mjs`.

**The stable runner does not start on Windows:**

```
[test:run] general-server server suites excluding 140 serialized suites
[test:run] Failed to start Vitest: spawnSync pnpm ENOENT
```

`scripts/run-vitest-stable.mjs:289` calls `spawnSync("pnpm", ["exec", "vitest", ...])` without
`shell: true`; on Windows the executable is `pnpm.cmd`, so the spawn fails. Work around it by
driving Vitest directly per project — project names are the package names in `vitest.config.ts`:

| Command | Result |
|---|---|
| `pnpm exec vitest run --project @todero/db` | **PASS** — 33 files, 113 passed, 2 skipped (exit 0) |
| `pnpm exec vitest run --project @todero/shared` | **FAIL** — 71/72 files pass; 4 tests fail (exit 1) |

All four `@todero/shared` failures are in `src/worktree-seed-source.test.ts` and share one cause —
`fs.symlinkSync` raising `EPERM`, the same Windows symlink restriction as the preflight step above.
They are environment failures, not code failures.

Opt-in browser suites (`AGENTS.md` § 7 — run only when your change touches them):

```
pnpm test:e2e                 # Playwright, tests/e2e/playwright.config.ts
pnpm test:release-smoke       # Playwright, tests/release-smoke/playwright.config.ts
pnpm test:storybook-visual    # Storybook visual regression
```

Not run in this pass.

### Build

`pnpm build` = `pnpm run preflight:workspace-links && pnpm -r build`.

**Not run.** It cannot succeed on this machine: `@todero/paperclip-runner`'s `build` runs
`build:binary`, which is `cargo build --release --manifest-path runner/Cargo.toml ...`. Same missing
Rust toolchain. Recorded as not-run rather than reported as a pass.

## What this machine is missing

Two prerequisites explain every failure above except the token gate:

1. **Rust toolchain (`cargo`)** — required by `packages/paperclip-runner` for typecheck and build,
   and transitively by `@todero/server`'s typecheck and by `pnpm build`.
2. **Windows symlink permission** — Developer Mode or an elevated shell. Without it,
   `preflight:workspace-links` and four `@todero/shared` tests fail with `EPERM`.

Also observed during `pnpm run typecheck`:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were
ignored: "pnpm.patchedDependencies", "pnpm.overrides".
```

`package.json` pins `packageManager: pnpm@9.15.4` and `pnpm --version` reports `9.15.4`, so this
warning is worth a look before trusting a local install to match CI — the two patched dependencies
(`embedded-postgres`, `acpx`) and the react/rollup overrides may not have been applied.

## Hand-off gate

`AGENTS.md` § 7 defines the PR-ready check. On a machine with both prerequisites:

```
pnpm -r typecheck
pnpm test:run
pnpm build
```

For normal issue work, run the smallest relevant check first — do not default to repo-wide
typecheck/build/test on every heartbeat. If anything could not be run, report what and why
(`AGENTS.md` § 7, last line).

## CI — what actually gates a PR

`.github/workflows/pr.yml` delegates to `.github/workflows/pr-trusted.yml`. The required check is
named `verify` and aggregates: `gate`, `policy`, `typecheck_release_registry`, `general_tests`,
`build` (`pr-trusted.yml:488-495`). Steps worth knowing:

| CI step | Command | Line |
|---|---|---|
| Validate Dockerfile deps stage | `node ./scripts/check-docker-deps-stage.mjs` | 302 |
| Validate Node version policy | `pnpm check:node-version` | 305 |
| Reject git push in adapter/runtime code | `node ./scripts/check-no-git-push.mjs` | 308 |
| Typecheck build-gap workspaces | `pnpm run typecheck:build-gaps` | 389 |
| General tests (sharded matrix) | `pnpm test:run:general -- --group <g>` | 477-484 |
| Serialized server suites (sharded) | `pnpm test:run:serialized -- --shard-index ...` | 621 |
| Verify Todero Runner | `pnpm --filter @todero/paperclip-runner check:all` | 556 |
| Build | `pnpm build` | 559 |
| e2e shards | `pnpm run test:e2e $specs` | 716 |

`e2e` is a separate aggregate check (`pr-trusted.yml:731`). Storybook visual regression runs from
`.github/workflows/storybook-visual.yml` on PRs to `main`.

Per `CONTRIBUTING.md`: all CI gates must be green and Greptile must score 5/5 with no open P2+
comments before a merge.
