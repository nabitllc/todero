#!/usr/bin/env bash
# queue-runner-tester.sh — Durable queue executor for the Tester lane
# TOD-566
#
# Claims in_review issues assigned to tester, executes one at a time,
# loops until queue is empty, then exits cleanly.
# Run via start-queue-runner.sh or directly.
#
# Usage:
#   ./queue-runner-tester.sh           # run continuously
#   ./queue-runner-tester.sh --once    # claim + run one issue then exit
#   ./queue-runner-tester.sh --dry-run # show what would happen, no writes

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/queue-runner.py" --agent tester "$@"
