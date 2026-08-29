# CLI Reference

Todero CLI now supports both:

- installation and lifecycle management (`install`, `uninstall`, `update`, `upgrade`, `service`)
- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Security: safe invocation for content-bearing arguments

Use `npx todero` for any command whose argument can hold untrusted or
semi-trusted content. Untrusted content includes issue text, comment bodies,
Markdown, pasted snippets, and model output. `npx` runs the CLI binary directly.
It passes the argument as an inert `argv` value. It does not run a shell over the
value. `npx todero` works on any machine with Node: it runs a local install
of the `todero` package, and it fetches the published package when no local
install is present.

Do not use `pnpm todero` for a content-bearing argument. `pnpm todero`
is a `package.json` script. `pnpm` builds a `/bin/sh` command string and appends
the argument to it, so the shell reads the argument first. The shell interprets
these spans before the CLI starts:

- command substitution: a backtick pair or `$( )`
- variable expansion: `$NAME` or `${NAME}` (this can leak a secret value into the persisted argument)

A crafted value can run an arbitrary command as the invoking user. A crafted
value can also expand an environment variable into the stored argument. No
CLI-side check stops this, because the shell runs before `cli/src` starts. This
is true even when the argument comes from a quoted shell variable, because `pnpm`
re-evaluates the value in its own shell.

Safe forms:

- `npx todero <command> <args>` — the documented default. It passes an inert
  `argv` value and runs on any machine.
- `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts <command> <args>` —
  the safe form to run the local source from a monorepo checkout. It is the exact
  command that the `pnpm todero` script wraps, but it runs directly, so no
  shell reads the argument. Use it when you must test your local `cli/src`
  changes with a content-bearing argument.

Unsafe or broken forms:

- `pnpm todero <command> <args>` — unsafe. `pnpm` runs the argument through a
  shell first.
- `pnpm run <script> -- <args>`, or any `package.json` script that wraps the CLI —
  unsafe for the same reason.
- `pnpm exec todero <command> <args>` — broken. The root workspace does not
  depend on the `todero` package, so `pnpm` does not link its binary into
  `node_modules/.bin`. The command fails with `Command "todero" not found`,
  even after a build. Do not use it.

Static placeholders only: a document must show a static placeholder such as
`<host>` in a command example, never a live `$( )` or `$NAME` span. The reader's
own shell expands such a span on paste, before any CLI or `npx` receives argv, so
a direct-exec form does not stop it.

`pnpm todero` stays acceptable only for a fully literal local lifecycle or
setup command. A fully literal command carries no substitutable value. It has no
placeholder, no example value the reader replaces, no interpolation, no path, no
ref, no id, and no name. It holds the subcommand and, at most, flags that take no
value.

The allowlist of literal commands lives in one place:
`server/src/__tests__/cli-invocation-safety.test.ts`. A guard test enforces it
fail-closed. Any `pnpm todero` line whose command string is not an exact
allowlist entry is an offender. The allowlist holds commands such as `run`,
`onboard`, `onboard --yes`, `doctor`, `configure --section <name>`, `connect`,
`env-lab up`, `env-lab down`, `context show`, `context list`,
`worktree ensure-seeded`, and `worktree env`.

Every invocation that carries a positional value or an option value uses
`npx todero` instead. This covers a hostname (`allowed-hostname`), an import
URL or folder (`company import`), an identifier or secret (`--company-id`,
`--agent-id`, `--claim-secret`), a payload (`--payload-json`), free text
(`--body`, `--title`, `--comment`), a data directory (`--data-dir`), an instance
(`--instance`), a bind preset (`--bind`), a context-profile name, and every
worktree path, ref, id, or name option. A runtime value counts as non-fixed even
when it looks safe. The private-hostname guard builds `allowed-hostname <value>`
from the request Host header, so it uses `npx todero`.

For a command that must run the local checked-out source with a value, use the
direct-exec form: `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts
<command> <args>`.

The `pnpm --filter @todero/*` build and test commands are not CLI
invocation. They do not change.

### Offline and air-gapped use

`npx todero` runs offline when the `todero` package is already in a
local install or in the npm cache. It reaches the network only when the package
is in neither place.

To force cache-only resolution and block any network attempt, run
`npx --offline todero <command> <args>`. Use `npx --prefer-offline
todero` when you accept a fetch only for a missing package.

To prepare an air-gapped host, install the package one time while the host is
online. Run `npm install -g todero`, or run the documented `install.sh`
path. After that step, both `npx todero` and the installed `todero`
binary run offline. Both pass an inert `argv` value.

To move the package without a registry, run `npm pack todero` on an online
host. Copy the tarball to the air-gapped host. Run `npm install -g
./todero-<version>.tgz`.

Do not use `pnpm todero` as an offline fallback for a content-bearing
argument. It runs the argument through a shell first, offline or online. It also
resolves only inside a monorepo checkout.

A monorepo contributor who works offline uses the direct-exec form that this
section documents above: `node cli/node_modules/tsx/dist/cli.mjs
cli/src/index.ts <command> <args>`. It passes an inert `argv` value and runs the
local source.

## Base Usage

Use repo script in development:

```sh
pnpm todero --help
```

Recommended installation and interactive onboarding:

```sh
curl -fsSLO https://todero.vercel.app/install.sh
curl -fsSLO https://todero.vercel.app/install.sh.sha256
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c install.sh.sha256
else
  shasum -a 256 -c install.sh.sha256
fi
bash install.sh
```

The checksum detects transfer or publishing mistakes but is served from the
same origin as the installer. Use a release-tag or commit-pinned GitHub copy
when you need an independently hosted source. Piped installs require supported
Node.js, npm, and npx to already be installed; download the script first before
allowing it to bootstrap Node.js with privileged package-manager commands.

First-time local bootstrap from a source checkout:

```sh
pnpm todero run
```

Choose local instance:

```sh
npx todero run --instance dev
```

## Install, Update, And Uninstall

Managed installs keep CLI payloads under `~/.todero/cli`, expose a stable
`~/.local/bin/todero` shim, switch versions atomically, and retain two
previous payloads for rollback.

```sh
todero install
todero install --canary
todero install --version <version>
todero install --ref <branch|tag|sha> [--repo owner/repo]
todero update
todero update --latest|--canary|--version <version>
todero update --rollback
todero upgrade
todero uninstall
```

`upgrade` aliases `update`. `uninstall` removes managed code and the shim but
preserves instance data under `~/.todero/instances/`. See
`doc/INSTALLING.md` for installation methods, security notes, PATH setup, and
the complete update and rollback behavior.

## Onboarding And Service Management

Interactive onboarding offers to install a background service on supported
platforms. `--yes` never installs it implicitly; automation must opt in.

```sh
todero onboard
todero onboard --yes
todero onboard --yes --install-service
todero onboard --yes --no-install-service
```

Service lifecycle commands remain under the `service` namespace:

```sh
todero service install [--no-start-now] [--no-start-on-login]
todero service uninstall
todero service start
todero service stop
todero service restart [--wait]
todero service status [--json]
todero service logs [-f]
```

Every service verb supports `--instance <id>` and `--json`. Linux and WSL2 use
a systemd user unit when available; macOS uses a LaunchAgent. Unsupported
environments receive foreground `todero run` guidance.

`todero doctor` includes managed-install and service-health diagnostics in
addition to configuration, storage, database, logging, and port checks.

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `todero onboard` and `todero configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `todero run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `PAPERCLIP_DEPLOYMENT_MODE`
- `todero run` and `todero doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
npx todero allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm todero env-lab up
pnpm todero env-lab doctor
pnpm todero env-lab status --json
pnpm todero env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

API base resolution order:

1. `--api-base <url>`
2. `PAPERCLIP_API_URL`
3. selected context profile `apiBase`
4. local Todero config server port
5. `http://localhost:3100`

Connection failures include the attempted URL and a `GET /api/health` check hint.

## Connect Wizard

```sh
pnpm todero connect
```

`connect` confirms the resolved API base, verifies `GET /api/health`, authenticates board access when needed, and saves a persona-aware profile:

- `persona=board` for board operator profiles
- `persona=agent` with `agentId` and `agentName` for agent profiles

Profiles store token env-var names, not plaintext tokens. The wizard prints shell exports for the newly created token.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.todero`:

```sh
npx todero run --data-dir ./tmp/todero-dev
npx todero issue list --data-dir ./tmp/todero-dev
```

## Context Profiles

Store local defaults in `~/.todero/context.json`:

```sh
npx todero context set --api-base http://localhost:3100 --company-id <company-id>
npx todero context set --persona agent --agent-id <agent-id> --api-key-env-var-name PAPERCLIP_API_KEY
pnpm todero context show
pnpm todero context list
npx todero context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
npx todero context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

## Organization Commands

```sh
npx todero company list
npx todero company get <company-id>
npx todero company current [--company-id <company-id>]
npx todero company stats
npx todero company create --payload-json '{...}'
npx todero company update <company-id> --payload-json '{...}'
npx todero company branding:update <company-id> --payload-json '{...}'
npx todero company archive <company-id>
npx todero company export <company-id> --out ./company --include company,agents,projects,issues,skills
npx todero company export:preview <company-id> --payload-json '{...}'
npx todero company export:api <company-id> --payload-json '{...}'
npx todero company import ./company --target new --new-company-name "Imported Company"
npx todero company import:preview <company-id> --payload-json '{...}'
npx todero company import:apply <company-id> --payload-json '{...}'
npx todero company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
npx todero company delete PAP --yes --confirm PAP
npx todero company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- With agent authentication, `company list` and `company current` are
  agent-safe company selectors. `company list` first tries the board-wide list;
  if that is forbidden, it uses `--company-id`, `PAPERCLIP_COMPANY_ID`, context,
  or `/api/agents/me` and then reads only that scoped company.
- `company create` requires board/instance-admin authentication because it is
  an instance-wide setup command.
- Deletion is server-gated by `PAPERCLIP_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `PAPERCLIP_COMPANY_ID`), not another company.

## Issue Commands

```sh
npx todero issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
npx todero issue get <issue-id-or-identifier>
npx todero issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
npx todero issue update <issue-id> [--status in_progress] [--comment "..."]
npx todero issue delete <issue-id> --yes
npx todero issue comment <issue-id> --body "..." [--reopen]
npx todero issue comments <issue-id> [--limit 50]
npx todero issue comment:get <issue-id> <comment-id>
npx todero issue comment:delete <issue-id> <comment-id>
npx todero issue runs <issue-id-or-identifier>
npx todero issue live-runs <issue-id-or-identifier>
npx todero issue active-run <issue-id-or-identifier>
npx todero issue heartbeat-context <issue-id>
npx todero issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
npx todero issue release <issue-id>
npx todero issue force-release <issue-id>
```

Issue subresources are exposed as Todero API wrappers. Commands that map to broad server schemas accept JSON payloads and validate them with shared schemas before sending.

```sh
npx todero issue child:create <issue-id> --payload-json '{"title":"Child task"}'
npx todero issue approvals <issue-id>
npx todero issue approval:link <issue-id> <approval-id>
npx todero issue approval:unlink <issue-id> <approval-id>
npx todero issue read <issue-id>
npx todero issue unread <issue-id>
npx todero issue archive <issue-id>
npx todero issue unarchive <issue-id>
npx todero issue recovery-actions <issue-id>
npx todero issue recovery:resolve <issue-id> --outcome restored --source-issue-status todo
```

```sh
npx todero issue documents <issue-id> [--include-system]
npx todero issue document:get <issue-id> <key>
npx todero issue document:put <issue-id> <key> --body-file ./plan.md [--title Plan]
npx todero issue document:lock <issue-id> <key>
npx todero issue document:unlock <issue-id> <key>
npx todero issue document:revisions <issue-id> <key>
npx todero issue document:restore <issue-id> <key> <revision-id>
npx todero issue document:delete <issue-id> <key>
```

```sh
npx todero issue work-products <issue-id>
npx todero issue work-product:create <issue-id> --payload-json '{"type":"pull_request","provider":"github","title":"PR"}'
npx todero issue work-product:update <work-product-id> --payload-json '{"status":"archived"}'
npx todero issue work-product:delete <work-product-id>
npx todero issue interactions <issue-id>
npx todero issue interaction:create <issue-id> --payload-json '{"kind":"request_confirmation","payload":{"version":1,"prompt":"Continue?"}}'
npx todero issue interaction:accept <issue-id> <interaction-id> [--selected-client-keys key1,key2]
npx todero issue interaction:reject <issue-id> <interaction-id> [--reason "..."]
npx todero issue interaction:respond <issue-id> <interaction-id> --answers-json '[{"questionId":"q1","optionIds":["yes"]}]'
npx todero issue interaction:cancel <issue-id> <interaction-id> [--reason "..."]
```

```sh
npx todero issue tree-state <issue-id>
npx todero issue tree-preview <issue-id> --payload-json '{"mode":"pause"}'
npx todero issue tree-holds <issue-id> [--status active] [--include-members]
npx todero issue tree-hold:create <issue-id> --payload-json '{"mode":"pause","reason":"review"}'
npx todero issue tree-hold:get <issue-id> <hold-id>
npx todero issue tree-hold:release <issue-id> <hold-id> [--payload-json '{"reason":"done"}']
npx todero issue attachments <issue-id>
npx todero issue attachment:upload <issue-id> --company-id <company-id> --file ./artifact.txt
npx todero issue attachment:download <attachment-id> [--out ./artifact.txt]
npx todero issue attachment:delete <attachment-id>
npx todero issue label:list --company-id <company-id>
npx todero issue label:create --company-id <company-id> --name bug --color '#ff0000'
npx todero issue label:delete <label-id>
npx todero issue feedback:votes <issue-id>
npx todero issue feedback:vote <issue-id> --payload-json '{"targetType":"issue_comment","targetId":"...","vote":"up"}'
```

## Project Commands

```sh
npx todero project list --company-id <company-id>
npx todero project get <project-id-or-shortname> [--company-id <company-id>]
npx todero project create --company-id <company-id> --name "Launch Site" [--goal-ids <id1,id2>] [--lead-agent-id <id>]
npx todero project update <project-id-or-shortname> [--status in_progress] [--company-id <company-id>]
npx todero project delete <project-id-or-shortname> --yes [--company-id <company-id>]
```

Advanced project fields accept JSON:

```sh
npx todero project create --company-id <company-id> --name "Ops" --env-json '{"OPENAI_API_KEY":{"kind":"secret","secretName":"openai-api-key"}}'
npx todero project update <project-id> --execution-workspace-policy-json '{"enabled":true,"defaultMode":"shared_workspace"}'
```

## Goal Commands

```sh
npx todero goal list --company-id <company-id>
npx todero goal get <goal-id>
npx todero goal create --company-id <company-id> --title "Grow revenue" [--level company] [--status active]
npx todero goal update <goal-id> [--title "..."] [--status achieved]
npx todero goal delete <goal-id> --yes
```

## Agent Commands

```sh
npx todero agent list --company-id <company-id>
npx todero agent get <agent-id>
npx todero agent create --company-id <company-id> --payload-json '{"name":"Builder","adapterType":"codex_local"}'
npx todero agent hire --company-id <company-id> --payload-json '{...}'
npx todero agent update <agent-id> --payload-json '{"title":"Senior Builder"}'
npx todero agent delete <agent-id> --yes
npx todero agent me
npx todero agent inbox
npx todero agent inbox-mine --user-id <board-user-id>
npx todero agent wake <agent-id-or-shortname> [--company-id <company-id>] [--reason "..."] [--payload '{"issueId":"..."}']
npx todero agent pause <agent-id>
npx todero agent resume <agent-id>
npx todero agent approve <agent-id>
npx todero agent terminate <agent-id>
npx todero agent heartbeat:invoke <agent-id>
npx todero agent claude-login <agent-id>
npx todero agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

Agent configuration and runtime endpoints:

```sh
npx todero agent permissions:update <agent-id> --payload-json '{"canCreateAgents":true,"canCreateSkills":true,"canAssignTasks":true}'
npx todero agent configuration <agent-id>
npx todero agent config-revisions <agent-id>
npx todero agent config-revision:get <agent-id> <revision-id>
npx todero agent config-revision:rollback <agent-id> <revision-id>
npx todero agent runtime-state <agent-id>
npx todero agent runtime-state:reset-session <agent-id> [--task-key <key>]
npx todero agent task-sessions <agent-id>
npx todero agent skills <agent-id>
npx todero agent skills:sync <agent-id> --desired-skills todero,github --mode add
npx todero agent instructions-path:update <agent-id> --payload-json '{"path":"/path/to/AGENTS.md"}'
npx todero agent instructions-bundle <agent-id>
npx todero agent instructions-bundle:update <agent-id> --payload-json '{"mode":"managed"}'
npx todero agent instructions-file:get <agent-id> --path AGENTS.md
npx todero agent instructions-file:put <agent-id> --path AGENTS.md --content-file ./AGENTS.md
npx todero agent instructions-file:delete <agent-id> --path AGENTS.md
```

Agent config, instructions, skills, project env, environment, secret, and workspace edits affect the next run. Active runs finish with the config they started with. When a saved session, reused workspace, or sandbox lease no longer matches the effective next-run config, Todero may start fresh execution and records non-sensitive freshness categories in run result JSON and workspace operation logs.

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Todero agent:

- creates a new long-lived agent API key
- installs missing Todero skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`, and `PAPERCLIP_API_KEY`

Example for shortname-based local setup:

```sh
npx todero agent local-cli codexcoder --company-id <company-id>
npx todero agent local-cli claudecoder --company-id <company-id>
```

## Token Commands

Agent API keys are scoped to one company and one agent. Plaintext tokens are printed once at creation.

```sh
npx todero token agent create --company-id <company-id> --agent <agent-id-or-name> --name external-worker
npx todero token agent list --company-id <company-id> --agent <agent-id-or-name>
npx todero token agent revoke --company-id <company-id> --agent <agent-id-or-name> <key-id>
```

Named board API keys use the board authorization model, support revocation and expiration metadata, and are audited server-side.

```sh
npx todero token board create --company-id <company-id> --name external-admin
npx todero token board create --name short-lived --ttl-days 7
npx todero token board list
npx todero token board revoke <key-id>
```

## Run Commands

`todero run` without a subcommand still bootstraps and starts a local Todero instance. The subcommands below inspect and control API heartbeat runs.

```sh
npx todero run list --company-id <company-id> [--agent-id <agent-id>] [--limit 50]
npx todero run live --company-id <company-id> [--limit 50] [--min-count 0]
npx todero run get <run-id>
npx todero run events <run-id> [--after-seq 0] [--limit 200]
npx todero run log <run-id> [--offset 0] [--limit-bytes 16384] [--text]
npx todero run cancel <run-id>
npx todero run issues <run-id>
npx todero run workspace-operations <run-id>
npx todero run workspace-log <operation-id> [--offset 0] [--limit-bytes 16384] [--text]
npx todero run watchdog-decision <run-id> --decision continue [--reason "..."]
```

## Routine Commands

`todero routines disable-all` remains the local maintenance command. The singular `routine` group maps to the REST API.

```sh
npx todero routine list --company-id <company-id> [--project-id <project-id>]
npx todero routine create --company-id <company-id> --payload-json '{...}'
npx todero routine get <routine-id>
npx todero routine update <routine-id> --payload-json '{...}'
npx todero routine revisions <routine-id>
npx todero routine revision:restore <routine-id> <revision-id>
npx todero routine runs <routine-id> [--limit 50]
npx todero routine run <routine-id> [--payload-json '{...}']
npx todero routine trigger:create <routine-id> --payload-json '{...}'
npx todero routine trigger:update <trigger-id> --payload-json '{...}'
npx todero routine trigger:delete <trigger-id>
npx todero routine trigger:rotate-secret <trigger-id>
npx todero routine trigger:fire <public-id> [--payload-json '{...}']
```

## Prompt Handoff

Prompt handoff creates Todero work. It does not create a chat session.

```sh
npx todero agent-prompt <agent-name-or-id> <agent-api-key> "Prompt here"
npx todero agent prompt --agent <agent-name-or-id> --api-key-env PAPERCLIP_API_KEY "Prompt here"
npx todero agent prompt --profile my-agent "Prompt here"
npx todero board prompt --company-id <company-id> --agent <agent-name-or-id> "Prompt here"
```

By default the command creates a `todo` issue assigned to the target agent and wakes the agent. Use `--issue <issue-id>` to add a comment to existing work, and `--no-wake` to skip the wakeup.

## Skills Commands

`todero skills` covers three distinct operations:

1. **Company install** — adds or updates a row in `company_skills` for the
   whole company. This is what `skills install`, `skills import`, `skills create`,
   and `skills scan-projects` do.
2. **Agent attach** — merges an agent's *desired* company skill set with an
   explicit `add`, `remove`, or `replace` mode (`skills agent sync`/`clear`).
   This is a desired-state operation on the agent's adapter config; it does not
   change the company library.
3. **Adapter runtime sync** — the adapter reconciles the desired skill set
   with files on disk and reports an `AgentSkillSnapshot` (`skills agent list`).
   `skills agent sync` triggers this automatically after updating desired state.

Required Todero runtime skills (heartbeat, etc.) remain server-enforced and
are added on top of whatever the desired set names.

Company skill mutations (`skills install`, `skills import`, `skills create`, and
`skills scan-projects`) are open to same-company actors by default. Missing
`skills:create` grants and `canCreateSkills` settings do not deny these commands;
only an explicit company skill policy restriction does. Core safety and company
boundary checks still apply, and `agents:create` remains required when a command
also creates agents.

### Catalog (app-shipped skills)

The Todero app ships a curated catalog under `@todero/skills-catalog`.
Browse and inspect commands never mutate company state; `install` adds a catalog
skill to the company library.

```sh
npx todero skills browse [--kind bundled|optional] [--category <slug>] [--query <text>]
npx todero skills search "<text>" [--kind bundled|optional] [--category <slug>]
npx todero skills inspect <catalog-id-or-key-or-slug>
npx todero skills install <catalog-id-or-key-or-slug> [--as <slug>] [--force] --company-id <company-id>
```

Catalog semantics:

- **Bundled** skills live in `packages/skills-catalog/catalog/bundled/<category>/<slug>`
  and are recommended defaults for most companies. They use canonical key
  `todero/bundled/<category>/<slug>`.
- **Optional** skills live in `packages/skills-catalog/catalog/optional/<category>/<slug>`
  and are role-specific or domain-specific (browser, AWS ops, etc.). Same key
  shape with `optional` in place of `bundled`.
- `skills install` materializes the catalog files into a company-managed skill
  directory and records provenance (`catalogId`, `catalogKey`, `packageVersion`,
  `originHash`, …) so future updates and audit decisions stay consistent.
- `--as <slug>` overrides the company skill slug. `--force` may replace a
  same-key catalog-managed skill but never bypasses hard validation or hard-stop
  audit findings.

Examples:

```sh
npx todero skills browse --kind bundled --company-id <company-id>
npx todero skills search "pull request" --kind bundled
npx todero skills inspect github-pr-workflow
npx todero skills install github-pr-workflow --company-id <company-id>
npx todero skills install todero:optional:browser:agent-browser --company-id <company-id>
```

External GitHub, skills.sh, local-path, and URL sources still go through
`skills import`; catalog commands are for the app-shipped catalog only.

### Organization library

```sh
npx todero skills list --company-id <company-id>
npx todero skills show <skill-id-or-key-or-slug> --company-id <company-id>
npx todero skills file <skill-id-or-key-or-slug> [--path SKILL.md] --company-id <company-id>
npx todero skills import <source> --company-id <company-id>
npx todero skills create --name "Review PRs" [--slug review-prs] [--description "..."] [--body-file SKILL.md] --company-id <company-id>
npx todero skills scan-projects [--project-id <id>...] [--workspace-id <id>...] --company-id <company-id>
npx todero skills check [skill-id-or-key-or-slug] --company-id <company-id>
npx todero skills update <skill-id-or-key-or-slug> [--force] --company-id <company-id>
npx todero skills update --all [--force] --company-id <company-id>
npx todero skills audit [skill-id-or-key-or-slug] --company-id <company-id>
npx todero skills reset <skill-id-or-key-or-slug> [--yes] [--force] --company-id <company-id>
npx todero skills remove <skill-id-or-key-or-slug> --yes --company-id <company-id>
```

`skills import <source>` accepts a skills.sh URL, the equivalent
`<owner>/<repo>/<skill>` shorthand, a GitHub URL, a local path, or an
`npx skills add …` command. See `references/company-skills.md` in the agent
skill bundle for the source-type table.

`skills check`, `skills update`, `skills audit`, and `skills reset` are the
maintenance loop for catalog-installed skills:

- `check` reports whether each skill's installed bytes match its pinned origin
  (`hasUpdate`, `installedHash`, `originHash`, `updateHoldReason`,
  `auditVerdict`).
- `update` installs the pinned update through the existing install-update API.
  `--all` checks every company skill and updates only those with
  `hasUpdate=true`. `--force` discards local-modification or soft-audit holds;
  hard-stop audit findings still block the update.
- `audit` re-scans installed bytes and reports findings without executing
  anything.
- `reset` reinstalls a catalog-managed skill from its pinned origin, discarding
  local edits. Prompts in a TTY; requires `--yes` for non-interactive use.

### Agent attach

```sh
npx todero skills agent list <agent-id-or-shortname> --company-id <company-id>
npx todero skills agent sync <agent-id-or-shortname> --skill <skill-id-or-key-or-slug> [--skill <skill-id-or-key-or-slug>...] --mode <add|remove|replace> --company-id <company-id>
npx todero skills agent clear <agent-id-or-shortname> --yes --company-id <company-id>
```

`skills agent sync` requires a merge mode and returns the resulting adapter
`AgentSkillSnapshot`. `add` preserves all unnamed assignments, `remove` deletes
only named assignments, and `replace` destructively overwrites the complete
non-required desired skill set.
`skills agent clear` sends an empty desired list. Required Todero skills are
still enforced by the server in both cases.

### Notes

- Skill references accept company skill `id`, canonical `key`, or unique
  `slug`; catalog references accept catalog `id`, `key`, or unique `slug`.
- `skills file` prints raw file content in human mode so it can be piped.
- `skills create --body-file -` reads the skill markdown body from stdin.
- `skills remove`, `skills reset`, and `skills agent clear` prompt in a TTY and
  require `--yes` in non-interactive use.
- `--json` prints the raw API result for each command.

## Teams Commands

`todero teams` works with the app-shipped team catalog in
`@todero/teams-catalog`. Browse, search, inspect, and file reads do not
change company state. `preview` runs the company import planner, and `install`
imports the catalog team into an existing company.

```sh
npx todero teams browse [--kind bundled|optional] [--category <slug>] [--query <text>]
npx todero teams search "<text>" [--kind bundled|optional] [--category <slug>]
npx todero teams inspect <catalog-id-or-key-or-slug> [--file TEAM.md]
npx todero teams preview <catalog-id-or-key-or-slug> --company-id <company-id>
npx todero teams install <catalog-id-or-key-or-slug> --company-id <company-id>
```

Preview/install options:

- Under agent authentication, use `todero company list --json`,
  `todero company current --json`, or `PAPERCLIP_COMPANY_ID` to select the
  target company. `company list` falls back to the scoped current company when
  board-wide listing is forbidden. `teams install` creates agents and therefore
  requires board authentication, an `agents:create` grant, or an agent with
  explicit `canCreateAgents` permission.
- `--request-approval-on-forbidden` turns a 403 install denial into a linked
  board approval request instead of a raw failed command; use
  `--approval-issue-id <id>` to attach it to a specific issue. During Todero
  task runs with `PAPERCLIP_TASK_ID` set, this fallback is automatic so
  agent-run walkthroughs leave a pending approval path instead of a raw 403.
- `--target-manager-agent-id <id>` or `--target-manager-slug <slug>` reparents
  catalog root agents under an existing manager.
- `--agent <slug>` and `--selected-file <path>` narrow the import.
- `--collision-strategy rename|skip|replace` controls name/key collisions.
- `--allow-external-sources`, `--allow-unpinned-optional-sources`, and
  `--allow-local-path-sources` explicitly opt into higher-trust source policy.
  Local-path sources are development-only and stay blocked unless that flag is
  passed.

## Secrets Commands

```sh
npx todero secrets list --company-id <company-id>
npx todero secrets declarations --company-id <company-id> [--include agents,projects] [--kind secret]
npx todero secrets create --company-id <company-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
npx todero secrets link --company-id <company-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
npx todero secrets doctor --company-id <company-id>
npx todero secrets provider-configs --company-id <company-id>
npx todero secrets provider-config:create --company-id <company-id> --payload-json '{...}'
npx todero secrets provider-config:discovery-preview --company-id <company-id> --payload-json '{...}'
npx todero secrets provider-config:get <config-id>
npx todero secrets provider-config:update <config-id> --payload-json '{...}'
npx todero secrets provider-config:default <config-id>
npx todero secrets provider-config:health <config-id>
npx todero secrets provider-config:delete <config-id>
npx todero secrets remote-import:preview --company-id <company-id> --payload-json '{...}'
npx todero secrets remote-import --company-id <company-id> --payload-json '{...}'
npx todero secrets migrate-inline-env --company-id <company-id> [--apply]
```

Secret listing and declarations never print secret values. `create` accepts
`--value-env` so shell history does not capture the value. `link` records
provider-owned references without copying the secret value into Todero.
For AWS-backed secrets, `secrets doctor` reports missing non-secret provider
env and the expected AWS SDK runtime credential source; do not store AWS
bootstrap credentials in Todero secrets.

Per-company provider vaults (multiple vault instances per provider, default
vault selection, coming-soon GCP/Vault) can be configured from the board UI under
`Organization Settings → Secrets → Provider vaults` or through the provider-config CLI
commands above. See the
[secrets deploy guide](../docs/deploy/secrets.md#provider-vaults) and
[API reference](../docs/api/secrets.md#provider-vaults) for the contract.

## Approval Commands

```sh
npx todero approval list --company-id <company-id> [--status pending]
npx todero approval get <approval-id>
npx todero approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
npx todero approval approve <approval-id> [--decision-note "..."]
npx todero approval reject <approval-id> [--decision-note "..."]
npx todero approval request-revision <approval-id> [--decision-note "..."]
npx todero approval resubmit <approval-id> [--payload '{"...":"..."}']
npx todero approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
npx todero activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
npx todero activity create --company-id <company-id> --payload-json '{...}'
npx todero activity issue <issue-id>
```

## Dashboard Commands

```sh
npx todero dashboard get --company-id <company-id>
```

## Org And Agent Config Commands

```sh
npx todero whoami
npx todero openapi
npx todero org get --company-id <company-id>
npx todero org svg --company-id <company-id> [--out org.svg]
npx todero org png --company-id <company-id> [--out org.png]
npx todero agent-config list --company-id <company-id>
```

## Access, Profile, And Instance Commands

```sh
npx todero profile session
npx todero profile get
npx todero profile update --payload-json '{...}'
npx todero profile company-user <user-slug> --company-id <company-id>
npx todero invite list --company-id <company-id>
npx todero invite create --company-id <company-id> --payload-json '{...}'
npx todero invite revoke <invite-id>
npx todero invite show <token>
npx todero invite accept <token> [--payload-json '{...}']
npx todero invite onboarding:text <token>
npx todero join list --company-id <company-id> [--status pending_approval]
npx todero join approve <request-id> --company-id <company-id>
npx todero join reject <request-id> --company-id <company-id>
npx todero join claim-key <request-id> --claim-secret <secret>
npx todero member list --company-id <company-id>
npx todero member update <member-id> --company-id <company-id> --payload-json '{...}'
npx todero member role-and-grants <member-id> --company-id <company-id> --payload-json '{...}'
npx todero member permissions <member-id> --company-id <company-id> --payload-json '{...}'
npx todero member archive <member-id> --company-id <company-id> [--payload-json '{...}']
npx todero admin user list [--query <text>]
npx todero admin user promote <user-id>
npx todero admin user demote <user-id>
npx todero admin user company-access <user-id>
npx todero admin user company-access:update <user-id> --payload-json '{...}'
```

CLI auth challenge endpoints are also exposed for tooling that needs the raw challenge lifecycle:

```sh
npx todero auth challenge create --payload-json '{...}'
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> npx todero auth challenge get <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> npx todero auth challenge approve <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> npx todero auth challenge cancel <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
npx todero auth revoke-current
```

`--token <challenge-secret>` is still supported for compatibility, but `--token-env` avoids putting challenge secrets in shell history or process arguments.

## Instance Settings Commands

```sh
npx todero instance scheduler-heartbeats
npx todero instance settings:general
npx todero instance settings:general:update --payload-json '{...}'
npx todero instance settings:experimental
npx todero instance settings:experimental:update --payload-json '{...}'
npx todero instance database-backup
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

```sh
npx todero sidebar preferences
npx todero sidebar preferences:update --payload-json '{...}'
npx todero sidebar project-preferences --company-id <company-id>
npx todero sidebar project-preferences:update --company-id <company-id> --payload-json '{...}'
npx todero sidebar badges --company-id <company-id>
npx todero inbox dismissals --company-id <company-id>
npx todero inbox dismiss --company-id <company-id> --payload-json '{"itemKey":"run:<run-id>"}'
npx todero board-claim show <token>
npx todero board-claim claim <token> [--payload-json '{...}']
npx todero openclaw invite-prompt --company-id <company-id> --payload-json '{...}'
npx todero available-skill list
npx todero available-skill index
npx todero available-skill get <skill-name>
npx todero llm agent-configuration
npx todero llm agent-configuration:adapter <adapter-type>
npx todero llm agent-icons
```

Hermes gateway uses the generic invite/join commands above rather than
`openclaw invite-prompt`. Create an agent invite, read
`invite onboarding:text`, submit a join request with
`adapterType: "hermes_gateway"` and `agentDefaultsPayload.apiBaseUrl` /
`agentDefaultsPayload.apiKey`, then approve and claim the key with the `join`
commands. See [HERMES_GATEWAY_ONBOARDING.md](./HERMES_GATEWAY_ONBOARDING.md).

## Adapter, Asset, And Skill Commands

```sh
npx todero adapter list
npx todero adapter install --payload-json '{"packageName":"@scope/adapter","version":"1.2.3"}'
npx todero adapter get <adapter-type>
npx todero adapter update <adapter-type> --payload-json '{"disabled":true}'
npx todero adapter override <adapter-type> --payload-json '{"paused":true}'
npx todero adapter reload <adapter-type>
npx todero adapter reinstall <adapter-type>
npx todero adapter delete <adapter-type>
npx todero adapter config-schema <adapter-type>
npx todero adapter ui-parser <adapter-type>
npx todero adapter models <adapter-type> --company-id <company-id> [--refresh] [--environment-id <id>]
npx todero adapter model-profiles <adapter-type> --company-id <company-id>
npx todero adapter detect-model <adapter-type> --company-id <company-id>
npx todero adapter test-environment <adapter-type> --company-id <company-id> --payload-json '{...}'
```

```sh
npx todero asset image:upload --company-id <company-id> --file ./image.png [--namespace docs] [--alt "..."]
npx todero asset logo:upload --company-id <company-id> --file ./logo.svg
npx todero asset content <asset-id> --out ./asset.bin
```

```sh
npx todero skill list --company-id <company-id>
npx todero skill get <skill-id> --company-id <company-id>
npx todero skill file <skill-id> --company-id <company-id> [--path SKILL.md]
npx todero skill create --company-id <company-id> --payload-json '{...}'
npx todero skill file:update <skill-id> --company-id <company-id> --payload-json '{...}'
npx todero skill import --company-id <company-id> --payload-json '{"source":"github:owner/repo/path"}'
npx todero skill scan-projects --company-id <company-id> --payload-json '{...}'
npx todero skill update-status <skill-id> --company-id <company-id>
npx todero skill install-update <skill-id> --company-id <company-id>
npx todero skill delete <skill-id> --company-id <company-id>
```

## Cost, Finance, And Budget Commands

```sh
npx todero cost summary --company-id <company-id>
npx todero cost by-agent --company-id <company-id>
npx todero cost by-agent-model --company-id <company-id>
npx todero cost by-provider --company-id <company-id>
npx todero cost by-biller --company-id <company-id>
npx todero cost by-project --company-id <company-id>
npx todero cost window-spend --company-id <company-id>
npx todero cost quota-windows --company-id <company-id>
npx todero cost issue <issue-id>
npx todero cost event:create --company-id <company-id> --payload-json '{...}'
```

```sh
npx todero finance event:create --company-id <company-id> --payload-json '{...}'
npx todero finance events --company-id <company-id>
npx todero finance summary --company-id <company-id>
npx todero finance by-biller --company-id <company-id>
npx todero finance by-kind --company-id <company-id>
npx todero budget overview --company-id <company-id>
npx todero budget policy:upsert --company-id <company-id> --payload-json '{...}'
npx todero budget company:update --company-id <company-id> --payload-json '{...}'
npx todero budget agent:update <agent-id> --payload-json '{...}'
npx todero budget incident:resolve <incident-id> --company-id <company-id> [--payload-json '{...}']
```

## Workspace And Environment Commands

```sh
npx todero workspace list --company-id <company-id>
npx todero workspace get <execution-workspace-id>
npx todero workspace close-readiness <execution-workspace-id>
npx todero workspace operations <execution-workspace-id>
npx todero workspace update <execution-workspace-id> --payload-json '{...}'
npx todero workspace runtime-service <execution-workspace-id> start --payload-json '{...}'
npx todero workspace runtime-command <execution-workspace-id> run --payload-json '{...}'
```

```sh
npx todero environment list --company-id <company-id>
npx todero environment capabilities --company-id <company-id>
npx todero environment create --company-id <company-id> --payload-json '{...}'
npx todero environment get <environment-id>
npx todero environment leases <environment-id>
npx todero environment lease <lease-id>
npx todero environment update <environment-id> --payload-json '{...}'
npx todero environment delete <environment-id>
npx todero environment probe <environment-id>
npx todero environment probe-config --company-id <company-id> --payload-json '{...}'
```

```sh
npx todero project-workspace list <project-id>
npx todero project-workspace create <project-id> --payload-json '{...}'
npx todero project-workspace update <project-id> <workspace-id> --payload-json '{...}'
npx todero project-workspace delete <project-id> <workspace-id>
npx todero project-workspace runtime-service <project-id> <workspace-id> restart --payload-json '{...}'
npx todero project-workspace runtime-command <project-id> <workspace-id> run --payload-json '{...}'
```

## Plugin Commands

Existing plugin lifecycle commands remain available: `plugin init`, `list`, `install`, `uninstall`, `enable`, `disable`, `inspect`, and `examples`.

```sh
npx todero plugin ui-contributions
npx todero plugin tools
npx todero plugin tool:execute --payload-json '{...}'
npx todero plugin health <plugin-id>
npx todero plugin logs <plugin-id>
npx todero plugin upgrade <plugin-id>
npx todero plugin config <plugin-id> --company-id <company-id>
npx todero plugin config:set <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
npx todero plugin config:test <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
npx todero plugin jobs <plugin-id>
npx todero plugin job:runs <plugin-id> <job-id>
npx todero plugin job:trigger <plugin-id> <job-id> [--payload-json '{...}']
npx todero plugin webhook <plugin-id> <endpoint-key> [--payload-json '{...}']
npx todero plugin dashboard <plugin-id>
npx todero plugin bridge:data <plugin-id> --payload-json '{...}'
npx todero plugin bridge:action <plugin-id> --payload-json '{...}'
npx todero plugin bridge:stream <plugin-id> <channel> [--duration-ms 10000]
npx todero plugin data <plugin-id> <key> --payload-json '{...}'
npx todero plugin action <plugin-id> <key> --payload-json '{...}'
npx todero plugin local-folders <plugin-id> --company-id <company-id>
npx todero plugin local-folder:status <plugin-id> <folder-key> --company-id <company-id>
npx todero plugin local-folder:validate <plugin-id> <folder-key> --company-id <company-id> [--payload-json '{...}']
npx todero plugin local-folder:set <plugin-id> <folder-key> --company-id <company-id> --payload-json '{...}'
```

Feedback traces can be fetched directly by ID when automating export workflows:

```sh
npx todero feedback trace <trace-id>
npx todero feedback bundle <trace-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
npx todero heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Local Todero data lives under the selected instance root. `PAPERCLIP_HOME` chooses the home directory and `PAPERCLIP_INSTANCE_ID` chooses the instance.

```text
~/.todero/                                     # PAPERCLIP_HOME
└── instances/
    └── default/                                  # instance root (PAPERCLIP_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── companies/                            # per-company adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not company-scoped)
```

Default paths for the canonical install:

- config: `~/.todero/instances/default/config.json`
- embedded db: `~/.todero/instances/default/db`
- logs: `~/.todero/instances/default/logs`
- storage: `~/.todero/instances/default/data/storage`
- secrets key: `~/.todero/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm todero run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm todero configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
