#!/usr/bin/env bash
# scripts/no-silent-empty.sh — TOD-654 guard.
#
# WHY THIS EXISTS
# ---------------
# The single most damaging UI bug in this repo was not a crash. It was this:
#
#     fetch('/api/issues').then(r => r.json()).then(d => setIssues(d?.data ?? []))
#
# A 403 body is an object, `d?.data` is undefined, `?? []` makes it an empty
# array, and the tab renders "No issues found" over a permission error. The
# operator cannot tell a working-but-empty system from a dead one, and neither
# can an auditor. Every loader must therefore branch on `res.ok`.
#
# This guard fails the build if the raw pattern reappears anywhere under app/ or
# components/. The sanctioned replacements are:
#
#   * hooks/useApiData.ts  -> useApiData / useApiList  (React components)
#   * lib/fetch-json.ts    -> fetchJson / fetchJsonOrNull / fetchJsonOrThrow
#
# Both keep the failure instead of coercing it into emptiness. Render it with
# <ApiErrorBanner error={error} onRetry={refetch} />.
#
# Usage: bash scripts/no-silent-empty.sh   (exit 0 = clean, 1 = violations)

set -uo pipefail

cd "$(dirname "$0")/.."

# `.then(x => x.json())` in any single-expression form: `r`, `res`, `(r)`, `(res)`.
# A block body — `.then(async r => { if (!r.ok) throw ... })` — is deliberately
# NOT matched: it has already looked at the response.
PATTERN='\.then\(\s*\(?[A-Za-z_$][A-Za-z0-9_$]*\)?\s*=>\s*[A-Za-z_$][A-Za-z0-9_$]*\.json\(\)\s*\)'

# The two modules that are allowed to touch a raw Response body.
ALLOWLIST='hooks/useApiData.ts|lib/fetch-json.ts'

if command -v rg >/dev/null 2>&1; then
  HITS=$(rg --no-heading --line-number --pcre2 "$PATTERN" app components 2>/dev/null || true)
else
  HITS=$(grep -rEn "$PATTERN" app components 2>/dev/null || true)
fi

# Drop the sanctioned modules (they live outside app/ and components/, but keep
# the filter so the guard stays correct if they ever move).
HITS=$(printf '%s\n' "$HITS" | grep -Ev "^($ALLOWLIST):" | grep -v '^$' || true)

if [ -n "$HITS" ]; then
  echo "FAIL: raw '.then(r => r.json())' found — a non-ok response would be parsed as data."
  echo ""
  printf '%s\n' "$HITS"
  echo ""
  echo "Fix: use useApiData/useApiList from hooks/useApiData.ts (components) or"
  echo "     fetchJson/fetchJsonOrNull/fetchJsonOrThrow from lib/fetch-json.ts,"
  echo "     and render <ApiErrorBanner error={error} onRetry={refetch} /> instead"
  echo "     of falling through to an empty state."
  exit 1
fi

echo "PASS: no unchecked JSON parsing under app/ or components/"

# Second check: the shared error surface must still exist and be wired up.
MISSING=0
for f in hooks/useApiData.ts lib/fetch-json.ts components/ApiErrorBanner.tsx; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f is missing — the honest-error contract has been deleted."
    MISSING=1
  fi
done
[ "$MISSING" -eq 1 ] && exit 1

if ! grep -q 'data unavailable' hooks/useApiData.ts lib/fetch-json.ts; then
  echo "FAIL: the 'data unavailable — <status> from <endpoint>: <message>' wording is gone."
  exit 1
fi

echo "PASS: shared error surface intact (useApiData + fetch-json + ApiErrorBanner)"
exit 0
