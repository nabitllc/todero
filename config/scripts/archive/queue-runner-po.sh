#!/usr/bin/env bash
# queue-runner-po.sh — Durable queue executor for the PO lane
# TOD-566
#
# Claims backlog issues assigned to po, executes one at a time,
# loops until queue is empty, then exits cleanly.
# Run via start-queue-runner.sh or directly.
#
# Usage:
#   ./queue-runner-po.sh           # run continuously
#   ./queue-runner-po.sh --once    # claim + run one issue then exit
#   ./queue-runner-po.sh --dry-run # show what would happen, no writes

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/queue-runner.py" --agent po "$@"
