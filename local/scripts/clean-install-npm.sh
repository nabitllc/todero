#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PC_INSTALL_DRIVER="${PC_INSTALL_DRIVER:-source}"

PC_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/todero-clean-install.XXXXXX")"
PC_HOME="$PC_TEST_ROOT/home"
PC_CACHE="$PC_TEST_ROOT/npm-cache"
mkdir -p "$PC_HOME" "$PC_CACHE"
trap 'rm -rf "$PC_TEST_ROOT"' EXIT

export HOME="$PC_HOME"
export PAPERCLIP_HOME="$PC_HOME/.todero"
export npm_config_cache="$PC_CACHE"
export npm_config_userconfig="$PC_HOME/.npmrc"
export PATH="$PC_HOME/.local/bin:$PATH"

if [ "$PC_INSTALL_DRIVER" = "published" ]; then
  (cd "$PC_TEST_ROOT" && npx --yes --registry https://registry.npmjs.org todero install)
else
  (cd "$REPO_ROOT" && pnpm todero install --yes)
fi

test -x "$PC_HOME/.local/bin/todero"
test -L "$PAPERCLIP_HOME/cli/current"
test -f "$PAPERCLIP_HOME/cli/install.json"
todero --version

mkdir -p "$PAPERCLIP_HOME/instances/default"
touch "$PAPERCLIP_HOME/instances/default/user-data-marker"
(cd "$REPO_ROOT" && pnpm todero uninstall)

test ! -e "$PAPERCLIP_HOME/cli"
test ! -e "$PC_HOME/.local/bin/todero"
test -f "$PAPERCLIP_HOME/instances/default/user-data-marker"
