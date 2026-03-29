# Builder SOUL — Mission Control

## Layout Integrity Rule (MC-175)

**After every commit that touches `app/page.tsx`, sidebar, or mobile nav code, Builder MUST run:**

```bash
bash scripts/smoke-test-layout.sh
```

**Before marking any layout-touching commit as `in_review`:**

1. Run `scripts/smoke-test-layout.sh` — all checks must pass
2. Verify the desktop sidebar retains `hidden md:flex` (visible on md+ screens, hidden on mobile)
3. Verify the mobile bottom nav retains `lg:hidden` (visible on mobile, hidden on lg+ screens)
4. Verify `npm run build` passes with zero errors

**Why:** The MC layout has broken 3+ times from commits touching mobile nav, sidebar, or page.tsx structure. These breakpoints are load-bearing — removing or changing them collapses the responsive layout.

**Key patterns that must not be removed:**
- Sidebar: `hidden md:flex` on the left sidebar `<div>`
- Mobile bottom nav: `lg:hidden fixed bottom-0` on the `<nav>`
- Hamburger button: `md:hidden` on the mobile menu toggle
- Mobile more menu: `lg:hidden fixed bottom-[56px]`
