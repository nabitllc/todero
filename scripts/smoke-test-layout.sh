#!/bin/bash
# MC-175: Layout integrity smoke test
# Verifies sidebar, mobile nav, and responsive breakpoints haven't been broken.
# Run after every commit that touches page.tsx, nav, or sidebar code.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAGE="$REPO_DIR/app/page.tsx"
ERRORS=0

echo "[layout-check] Verifying layout integrity in app/page.tsx..."

# 1. Desktop sidebar must exist with hidden md:flex pattern
if grep -q 'hidden md:flex' "$PAGE"; then
  echo "  [PASS] Desktop sidebar has 'hidden md:flex' (visible on md+, hidden on mobile)"
else
  echo "  [FAIL] Desktop sidebar missing 'hidden md:flex' pattern"
  ERRORS=$((ERRORS + 1))
fi

# 2. Mobile bottom nav must have lg:hidden
if grep -q 'lg:hidden fixed bottom-0' "$PAGE"; then
  echo "  [PASS] Mobile bottom nav has 'lg:hidden fixed bottom-0'"
else
  echo "  [FAIL] Mobile bottom nav missing 'lg:hidden fixed bottom-0' pattern"
  ERRORS=$((ERRORS + 1))
fi

# 3. Hamburger menu button must have md:hidden
if grep -q 'md:hidden.*shrink-0' "$PAGE"; then
  echo "  [PASS] Hamburger menu button has 'md:hidden'"
else
  echo "  [FAIL] Hamburger menu button missing 'md:hidden' pattern"
  ERRORS=$((ERRORS + 1))
fi

# 4. Mobile more menu must have lg:hidden
if grep -q 'lg:hidden fixed bottom-\[56px\]' "$PAGE"; then
  echo "  [PASS] Mobile more menu has 'lg:hidden'"
else
  echo "  [FAIL] Mobile more menu missing 'lg:hidden' pattern"
  ERRORS=$((ERRORS + 1))
fi

# 5. Sidebar border-r must exist (structural marker)
if grep -q 'border-r border-zinc-800' "$PAGE"; then
  echo "  [PASS] Sidebar border-r structural marker present"
else
  echo "  [FAIL] Sidebar border-r structural marker missing"
  ERRORS=$((ERRORS + 1))
fi

# 6. Build check
echo "[layout-check] Running npm run build..."
cd "$REPO_DIR"
if npm run build > /dev/null 2>&1; then
  echo "  [PASS] Build succeeded"
else
  echo "  [FAIL] Build failed"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "[layout-check] FAILED — $ERRORS error(s) found. Fix before committing."
  exit 1
else
  echo "[layout-check] ALL CHECKS PASSED"
  exit 0
fi
