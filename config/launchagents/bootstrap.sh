#!/bin/bash
# bootstrap.sh — Install Todero LaunchAgents on a new Mac
# Usage: bash config/launchagents/bootstrap.sh
#
# This script:
#   1. Detects your home dir and Homebrew prefix
#   2. Substitutes __HOME__, __TODERO_DIR__, __HOMEBREW_PREFIX__, __CLAUDE_BIN_DIR__
#      in each plist template
#   3. Copies to ~/Library/LaunchAgents/
#   4. Loads them with launchctl

set -e

TODERO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="$HOME"
HOMEBREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
CLAUDE_BIN_DIR="$(dirname "$(which claude 2>/dev/null || echo /usr/local/bin/claude)")"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_SRC="$TODERO_DIR/config/launchagents"

echo "=== Todero LaunchAgent bootstrap ==="
echo "  TODERO_DIR:       $TODERO_DIR"
echo "  HOME:             $HOME_DIR"
echo "  HOMEBREW_PREFIX:  $HOMEBREW_PREFIX"
echo "  CLAUDE_BIN_DIR:   $CLAUDE_BIN_DIR"
echo ""

# Ensure logs dir exists
mkdir -p "$TODERO_DIR/config/logs"

for plist in "$PLIST_SRC"/*.plist; do
  name="$(basename "$plist")"

  # Skip cloudflared if Vercel is handling the tunnel
  if [[ "$name" == "work.nabit.cloudflared.plist" ]]; then
    read -r -p "Install cloudflared plist? (skip if using Vercel for public access) [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { echo "  skipped: $name"; continue; }
  fi

  dest="$LAUNCH_AGENTS_DIR/$name"

  # Substitute placeholders
  sed \
    -e "s|__HOME__|$HOME_DIR|g" \
    -e "s|__TODERO_DIR__|$TODERO_DIR|g" \
    -e "s|__HOMEBREW_PREFIX__|$HOMEBREW_PREFIX|g" \
    -e "s|__CLAUDE_BIN_DIR__|$CLAUDE_BIN_DIR|g" \
    "$plist" > "$dest"

  # Load (unload first if already installed)
  launchctl unload "$dest" 2>/dev/null || true
  launchctl load "$dest"
  echo "  ✓ loaded: $name"
done

echo ""
echo "Done. All LaunchAgents installed."
echo ""
echo "Next steps:"
echo "  1. Verify .env.local exists at $TODERO_DIR/.env.local"
echo "  2. Run: npm run build (from $TODERO_DIR)"
echo "  3. Check logs: tail -f /tmp/todero.log"
