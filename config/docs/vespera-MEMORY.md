# MEMORY.md - Vespera Long-Term Memory

## Product
- **Name:** Vespera
- **Type:** Goth/alternative community platform — events, social, ticketing
- **Market:** Colombia (Bogotá primary), expanding to Latin America
- **Stack:** Vanilla JS (ES Modules) + Tailwind CSS + Firebase (Auth, Firestore, Storage) + Vite + Firebase Hosting
- **Old codebase:** `/Users/kemuniagent/.openclaw/workspace/vespera-old/` — Firebase PWA, 7 HTML pages + 64 JS modules
- **Architecture:** Multi-page modular PWA

## North Star Metric
WAU/MAU ratio (Weekly Active / Monthly Active Users)
- < 20% = just an event calendar (replaceable)
- 40% = becoming a habit (sticky)
- 60% = cultural institution (defensible)
Revenue comes AFTER 60%, not before.

## Strategic Decisions
- Community-first, revenue later (explicit pivot made Dec 19, 2025)
- No monetization until community is sticky
- Ticketing is revenue stream #1 when ready (8% + COP $2,000 fee per ticket)
- Promoted listings #2, subscriptions #3

## Launch Context
- Original target: Dec 31, 2025 (missed — was pre-launch at 0 users)
- Current target: Under 1 week from 2026-03-22
- Rebuild needed: old codebase = Firebase PWA, need to assess what carries forward vs. rebuild

## Supabase (Vespera)
- Project URL: https://pxuyvmijevxnlxyobajh.supabase.co
- Anon key: stored in workspace-vespera/app/.env.local
- Vercel project: nabit/app — https://app-nabit.vercel.app
- Vercel token: stored, project-scoped to nabit/app

## Key Files (old codebase)
- `docs/BUSINESS_STRATEGY.md` — full revenue model and projections
- `docs/COMMUNITY_FIRST_STRATEGY.md` — community building roadmap
- `docs/MVP_LAUNCH_CHECKLIST.md` — feature list and sprint plan
- `architecture/AI_CONTEXT_PROMPT.md` — technical context and stack details
- `architecture/database-schema.md` — Firestore schema
- `architecture/code-organization.md` — module structure
