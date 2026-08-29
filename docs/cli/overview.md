---
title: CLI Overview
summary: CLI installation and setup
---

The Todero CLI handles instance setup, diagnostics, and control-plane operations.

## Usage

```sh
pnpm todero --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--data-dir <path>` | Local Todero data root (isolates from `~/.todero`) |
| `--api-base <url>` | API base URL |
| `--api-key <token>` | API authentication token |
| `--context <path>` | Context file path |
| `--profile <name>` | Context profile name |
| `--json` | Output as JSON |

Company-scoped commands also accept `--company-id <id>`.

For clean local instances, pass `--data-dir` on the command you run:

```sh
npx todero run --data-dir ./tmp/todero-dev
```

## Context Profiles

Store defaults to avoid repeating flags:

```sh
# Set defaults
npx todero context set --api-base http://localhost:3100 --company-id <id>

# View current context
pnpm todero context show

# List profiles
pnpm todero context list

# Switch profile
npx todero context use default
```

To avoid storing secrets in context, use an env var:

```sh
npx todero context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

Secret operations are available under `todero secrets`:

```sh
npx todero secrets declarations --company-id <company-id> --kind secret
npx todero secrets create --company-id <company-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
npx todero secrets link --company-id <company-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
npx todero secrets doctor --company-id <company-id>
npx todero secrets migrate-inline-env --company-id <company-id> --apply
```

Context is stored at `~/.todero/context.json`.

## Command Categories

The CLI has two categories:

1. **[Setup commands](/cli/setup-commands)** — instance bootstrap, diagnostics, configuration
2. **[Control-plane commands](/cli/control-plane-commands)** — issues, agents, approvals, activity
