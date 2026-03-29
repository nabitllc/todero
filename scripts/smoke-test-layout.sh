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

echo ""
echo "✅ Smoke test complete"
