---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `todero run`

One-command bootstrap and start:

```sh
pnpm todero run
```

Does:

1. Auto-onboards if config is missing
2. Runs `todero doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx todero run --instance dev
```

## `todero onboard`

Interactive first-time setup:

```sh
pnpm todero onboard
```

If Todero is already configured, rerunning `onboard` keeps the existing config in place. Use `todero configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm todero onboard --run
```

Non-interactive defaults + immediate start (prints the URL without opening a browser):

```sh
pnpm todero onboard --yes
```

Browser opening is opt-in. Set the environment variable explicitly when that is the desired behavior:

```sh
PAPERCLIP_OPEN_ON_LISTEN=true pnpm todero onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Todero with that setup.

## `todero doctor`

Health checks with optional auto-repair:

```sh
pnpm todero doctor
pnpm todero doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `todero configure`

Update configuration sections:

```sh
pnpm todero configure --section server
pnpm todero configure --section secrets
pnpm todero configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `todero env`

Show resolved environment configuration:

```sh
pnpm todero env
```

This now includes bind-oriented deployment settings such as `PAPERCLIP_BIND` and `PAPERCLIP_BIND_HOST` when configured.

## `todero allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx todero allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.todero/instances/default/config.json` |
| Database | `~/.todero/instances/default/db` |
| Logs | `~/.todero/instances/default/logs` |
| Storage | `~/.todero/instances/default/data/storage` |
| Secrets key | `~/.todero/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm todero run
```

Or pass `--data-dir` directly on any command:

```sh
npx todero run --data-dir ./tmp/todero-dev
npx todero doctor --data-dir ./tmp/todero-dev
```
