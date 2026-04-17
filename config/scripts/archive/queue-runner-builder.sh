#!/usr/bin/env bash
# queue-runner-builder.sh — Durable queue executor for the Builder lane
# TOD-566
#
# Claims open issues assigned to builder, executes one at a time,
# loops until queue is empty, then exits cleanly.
# Run via start-queue-runner.sh or directly.
#
# Usage:
#   ./queue-runner-builder.sh           # run continuously
#   ./queue-runner-builder.sh --once    # claim + run one issue then exit
#   ./queue-runner-builder.sh --dry-run # show what would happen, no writes

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/queue-runner.py" --agent builder "$@"
