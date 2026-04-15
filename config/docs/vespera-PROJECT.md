# PROJECT.md - Vespera Dossier

## What It Is
Vespera is the digital home of Colombia's goth/alternative subculture.
Events, community, social graph, ticketing — built for a scene that has no dedicated platform.

## Target Users

### Primary: Event Attendees (Bogotá goth community, ~2,000 people)
- Pain: Events scattered across Facebook, Instagram, WhatsApp groups
- Want: One place to find all goth events, know who's going, not miss anything

### Secondary: Organizers / Promoters / Venues
- Pain: Marketing fragmentation, cash-at-door only, no audience data, high platform fees
- Want: Reach their exact audience, pre-sale revenue, lower fees, ticket verification

## Market Size
- Colombia: ~4,000 active goth/alternative community members
- LATAM: ~40,000+ (Mexico, Argentina, Chile, Brazil)
- Year 1 target: 20-30% capture of Colombia = 800-1,200 users

## Revenue Model (when ready)
1. Ticketing: 8% + COP $2,000 per ticket (primary)
2. Promoted listings: $20-50/event (secondary)
3. Organizer subscriptions: $50-100/month (future)
4. Affiliate links: Month 6+ (tertiary)

## Competitive Advantage
- Facebook: can't focus on goth scene, algorithm dilutes subculture
- Instagram: no deep discussion, buries old content, can't build event archive
- WhatsApp: scales to 256 max, no discovery, no archive
- Eventbrite: just transactions, no community, niche-hostile fees

## Tech Stack
- Frontend: Vanilla JS (ES Modules) + Tailwind CSS + Vite
- Backend: Firebase (Auth, Firestore, Storage, Analytics, Hosting)
- Architecture: Multi-page modular PWA
- Status: Old codebase exists, rebuild decision pending

## Current State (2026-03-22)
- 0 users, 0 revenue
- Old codebase: functional PWA, 7 pages, 64 modules, Firebase
- Launch target: under 1 week
- Key missing from old build: social features, badge system, photo upload, activity feed

## MVP Scope (for this sprint)
Must have:
- Event discovery (comprehensive archive 150+ events)
- User auth + profiles
- "Going / Interested" on events
- Basic social: follow system, friend indicators on events

Cut for now:
- Ticketing (no payment integration in week 1)
- Spotify integration (complex OAuth)
- Badge system (gamification, not core community)
- Activity feed (nice to have, not day-1 essential)
- Push notifications

## Key Metrics to Track
- WAU/MAU ratio (north star)
- Profile completion rate
- Events per user per week viewed
- Daily logins
