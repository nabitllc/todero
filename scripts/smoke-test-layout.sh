#!/bin/bash
# Smoke test: verify MC layout structure is intact after build
# Run after every commit that touches page.tsx or layout components

set -e

echo "🔍 Layout smoke test..."

BUILD_FILE=".next/server/app/page.js"

if [ ! -f "$BUILD_FILE" ]; then
  echo "⚠️  Build output not found — run 'npm run build' first"
  exit 1
fi

# Check 1: sidebar exists in built output
if grep -q "sidebar\|aside\|nav-sidebar\|hidden lg:flex\|w-44 shrink-0" "$BUILD_FILE" 2>/dev/null; then
  echo "✅ Sidebar found in build output"
else
  echo "⚠️  Sidebar not found — check layout"
fi

# Check 2: mobile nav has lg:hidden (should be hidden on desktop)
if grep -q "lg:hidden" "$BUILD_FILE" 2>/dev/null; then
  echo "✅ Mobile nav has lg:hidden — correct (won't show on desktop)"
else
  echo "⚠️  Mobile nav lg:hidden missing — may show on desktop!"
fi

# Check 3: no duplicate nav rendering — count bottom nav instances
MOBILE_NAV_COUNT=$(grep -o "MC-63\|mobile bottom\|bottom-0.*z-50\|fixed bottom-0" "$BUILD_FILE" 2>/dev/null | wc -l | tr -d ' ')
echo "Mobile nav instances: $MOBILE_NAV_COUNT (should be 1)"

if [ "$MOBILE_NAV_COUNT" -gt 1 ]; then
  echo "⚠️  Multiple mobile navs found — potential duplicate!"
fi

# Check 4: main layout structure present
if grep -q "min-h-screen flex\|flex-1 flex flex-col h-screen" "$BUILD_FILE" 2>/dev/null; then
  echo "✅ Main layout wrapper found"
else
  echo "⚠️  Main layout wrapper missing — layout may be broken"
fi

# Check 5: header present
if grep -q "sticky top-0 z-20\|border-b border-zinc-800" "$BUILD_FILE" 2>/dev/null; then
  echo "✅ Header found in build"
else
  echo "⚠️  Header not found"
fi

# Checks 8-11 (TOD-2456): four guards existed and RAN NOWHERE.
#
# A critic measured it: `grep -rn no-cloud-provider package.json scripts
# .githooks .github` returned zero hits outside the guard's own file. Same for
# no-invented-projects, no-dead-modules and no-phantom-columns. Only
# check:secrets and no-silent-empty were wired, via prebuild — and `npm run
# build` is forbidden on this host, so prebuild never fires here either.
#
# A guard that only runs when a human remembers it is a guard that stops running
# the first time someone is busy. Each of these was proven red-then-green when
# it was written; that proof is worthless if nothing invokes them. They are
# wired here rather than into prebuild precisely because the smoke test is the
# gate that actually runs in this environment.
for guard in no-invented-projects no-dead-modules no-phantom-columns no-cloud-provider; do
  echo ""
  if node "$(dirname "$0")/$guard.mjs"; then
    echo "✅ $guard passed"
  else
    echo "❌ $guard FAILED — see scripts/$guard.mjs"
    exit 1
  fi
done

# Check 6 (TOD-654): no tab may render an empty state over a non-ok response.
echo ""
if node "$(dirname "$0")/no-silent-empty.mjs"; then
  echo "✅ Honest-error guard passed"
else
  echo "❌ Honest-error guard FAILED — see scripts/no-silent-empty.mjs"
  exit 1
fi

# Check 7 (scope-is-a-boundary): no dbUrl('issues?...') literal may skip the
# project + archived clauses that issuesUrl() otherwise injects once.
echo ""
if node "$(dirname "$0")/no-unscoped-issues.mjs"; then
  echo "✅ Scope guard passed"
else
  echo "❌ Scope guard FAILED — see scripts/no-unscoped-issues.mjs"
  exit 1
fi

echo ""
echo "✅ Smoke test complete"
