#!/usr/bin/env bash
# Thin wrapper — the guard itself is Node so it runs on every supported OS.
exec node "$(dirname "$0")/check-no-secrets.js" "$@"
