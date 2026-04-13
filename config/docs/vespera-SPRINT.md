# SPRINT.md - Active Sprint

## Current Sprint: Vespera Launch
**Deadline:** ~2026-03-29 (under 1 week from 2026-03-22)
**Goal:** Ship a working community platform the goth scene can actually use

---

## Stack Decision — RESOLVED ✅
- **Full rebuild: Next.js + Supabase + Vercel** (decided 2026-03-22 by Michael)
- Old Firebase codebase is reference only — do not extend

---

## MVP Feature List (proposed)

### Must Ship
- [ ] Event discovery — 150+ events in database
- [ ] User auth — signup, login, profile
- [ ] "Going / Interested" on events
- [ ] Basic follow system (who's going to events)
- [ ] Mobile-responsive UI

### Cut (post-launch)
- Ticketing / payments
- Spotify integration
- Badge / gamification system
- Activity feed
- Push notifications
- Event photo upload

---

## Daily Log
*Update each day with what was done, what's blocked, what changed.*

### 2026-03-22
- Workspace structure built: MEMORY, PROJECT, DECISIONS, PEOPLE, RESEARCH, SPRINT
- Rebuild vs. extend decision pending
- No code written yet — foundation being set

### 2026-03-26
- Builder: Scaffold PR #1 shipped — i18n (next-intl, en/es-CO), Supabase schema (users/events/rsvps/follows + RLS), auth flow (email + Google OAuth), dark gothic Tailwind theme, .env.example
- Tester: Reviewing PR #1 (checking build, i18n wiring, schema completeness, security)
- Infrastructure: Permanent URLs live (kaos.nabit.work, n8n.nabit.work), Cloudflare tunnel, task-done webhook, error alerting, daily stand-up
- Recommendations: 5 of 10 completed (n8n error alerts, stand-up automation, ops monitoring, routing table, Kemuni SME)

---

## Blockers
- None currently — PR #1 in review. Next: merge scaffold → start feature work (event import, profile completion, AI features)
