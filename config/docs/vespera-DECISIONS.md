# DECISIONS.md - Decision Log

Every significant product, technical, or strategic decision goes here.
Format: date | decision | rationale | alternatives considered

---

## 2025-12-19
**Community-first pivot**
Shifted from revenue-first (ticketing) to community-first (WAU/MAU).
Rationale: No trust, no users → no adoption. Community stickiness unlocks monetization naturally.
Alternatives: Stay revenue-first (rejected — cold start problem fatal).

## 2026-03-22
**Stack: Next.js + Supabase + Vercel (full rebuild)**
Decision: CONFIRMED by Michael 2026-03-22
Rationale: Clean architecture, SQL over Firestore NoSQL, better DX, scales to LATAM expansion. Old Firebase PWA had too much debt and missed its Dec 2025 launch.
Stack:
  - Frontend: Next.js (App Router)
  - Backend/DB: Supabase (Auth, PostgreSQL, Storage, Realtime)
  - Hosting: Vercel
  - Styling: Tailwind CSS
Keep from old build: product logic, community-first strategy, event data model concepts
Discard: entire old codebase (Vanilla JS, Firebase, Vite)

## 2026-03-22
**Launch target: under 1 week from today**
Scope must be aggressively cut. MVP = minimum viable community, not full feature list.
