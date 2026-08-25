#!/bin/bash
# Portability smoke test — proves Todero is not a one-Mac appliance.
#
# Three things get checked, in increasing order of what they prove:
#   1. no-host-literals  — source contains no hardcoded /Users, Homebrew,
#                          /bin/bash or /tmp/ paths
#   2. agents-list-503   — GET /api/agents with SUPABASE_SERVICE_ROLE_KEY unset
#                          answers 503 with a non-null `error`, never an empty
#                          200. This is the fresh-machine path, exercised rather
#                          than assumed.
#   3. live-endpoints    — the four portability-sensitive routes answer 200 on a
#                          configured host (skipped when no server is running)
#
# Usage: bash scripts/smoke-test-portability.sh [base-url]
#   base-url defaults to http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"
COOKIE="${MC_COOKIE:-mc-auth=kaos2026; mc-role=owner}"
cd "$(dirname "$0")/.." || exit 1

FAILED=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
skip() { echo "SKIP  $1"; }

echo "Portability smoke test — $BASE_URL"
echo

# ── 1. no-host-literals ───────────────────────────────────────────────────────
HITS=$(grep -rnE '/Users/|/opt/homebrew|/bin/bash|/tmp/' \
  --include='*.ts' --include='*.tsx' app/ lib/ 2>/dev/null \
  | grep -v node_modules | wc -l | tr -d ' ')
if [ "$HITS" = "0" ]; then
  pass "no-host-literals (0 hardcoded host paths in app/ and lib/)"
else
  fail "no-host-literals ($HITS hardcoded host paths)"
  grep -rnE '/Users/|/opt/homebrew|/bin/bash|/tmp/' \
    --include='*.ts' --include='*.tsx' app/ lib/ 2>/dev/null | grep -v node_modules
fi

# ── 2. agents-list-503 ────────────────────────────────────────────────────────
# Runs the route handler in-process with the key unset — the dev server always
# has one, so this cannot be probed over HTTP.
JEST_LOG=$(mktemp 2>/dev/null || echo "./.portability-jest.log")
if npx jest --silent __tests__/api/agents-unconfigured.test.ts >"$JEST_LOG" 2>&1; then
  pass "agents-list-503 (unset key -> 503 + non-null error + roster still returned)"
else
  fail "agents-list-503 — GET /api/agents does not report an unconfigured host"
  tail -30 "$JEST_LOG"
fi
rm -f "$JEST_LOG"

# ── 3. live-endpoints ─────────────────────────────────────────────────────────
if ! curl -s -o /dev/null --max-time 3 "$BASE_URL/api/status" 2>/dev/null; then
  skip "live-endpoints (no server reachable at $BASE_URL)"
else
  for route in /api/agents /api/status /api/files /api/automations; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -b "$COOKIE" "$BASE_URL$route")
    if [ "$CODE" = "200" ]; then
      pass "live-endpoints $route -> 200"
    else
      fail "live-endpoints $route -> $CODE (expected 200 on a configured host)"
    fi
  done

  # /api/status must not leak a filesystem error into its body
  if curl -s --max-time 20 -b "$COOKIE" "$BASE_URL/api/status" | grep -q ENOENT; then
    fail "live-endpoints /api/status body contains ENOENT"
  else
    pass "live-endpoints /api/status body has no ENOENT"
  fi
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "Portability smoke test: all checks passed"
else
  echo "Portability smoke test: FAILURES above"
fi
exit "$FAILED"
