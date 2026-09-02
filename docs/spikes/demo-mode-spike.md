## Spike: `/demo` as the real UI on a fake backend

**Date:** 2026-09-02
**Question:** Can the real `local/ui` run in a browser-only demo mode — every screen real, every click working, nothing leaving the browser — at a size we can build and keep from drifting?
**Time spent:** ~1.5 h
**Hypothesis:** the UI funnels every call through one client, so a fetch-level fake covering the screens a stranger visits is a bounded job — far below the server's full surface.

### Method

1. Static: mapped every `pages/*.tsx` to the API paths reachable through its import graph (`scratchpad/apimap.mjs`). Result: 460 distinct paths in 47 API modules, and one page "reaches" 346 of them. The graph is too dense to scope by — an upper bound only.
2. Runtime: drove the running local instance (`:3100`, serves UI + API, no auth on localhost) through 16 read-only routes with Playwright, recording `/api` request method + normalized path. No screenshots, no payloads, no clicks on mutating controls.

### Findings

- **One choke point.** All UI traffic goes through `request()` in `local/ui/src/api/client.ts` → `/api/*` with `credentials: "include"`. A fetch-level interceptor (MSW in the browser) fakes everything without touching the 47 API modules.
- **52 distinct endpoints** across 16 screens (dashboard, tasks, task detail, agents, approvals, activity, goals, projects, routines, inbox, org chart, settings, organizations; `apps`, `cases`, `board-chat` redirected to the dashboard on this instance — plugin/flag-gated). Server has 649 routes; the demo needs ~8%.
- **21 of the 52 are the shell** — fired on every screen (session, companies, `me`, agents, approvals, dashboard, issues, projects, routines, skills, sidebar badges/preferences, live-runs, heartbeat-runs, instance settings, plugins, health). Fake these once and every screen boots.
- **Task detail is the deepest screen:** 16 endpoints of its own (activity, comments, attachments, runs, live-runs, cost summary, plan document, work products, interactions, tree-control state, tree holds, feedback votes, read receipt).
- **One WebSocket:** `/api/companies/:id/events/ws` (`LiveUpdatesProvider`). Needs a fake socket that emits from the in-memory store, or a no-op — the UI already tolerates a closed socket.
- **Two non-GETs fire without a click:** `POST /api/issues/:id/read` (read receipt) and `POST /api/todero/vault/recommended/ensure` (Second Brain bootstrap). Both must succeed in demo mode.
- **Not measured:** write handlers for the demo's six interactions (create task, move status, comment, approve, hire an agent, board chat). By API-module inspection they are ≈15–25 endpoints. Measure in slice 1 of the PRD by recording those clicks on a throwaway company.
- **Build seams that don't exist yet:** Vite has no `base`; the Next site has no rewrite for a nested SPA; there is no MSW dependency; `startServiceWorkerUpdates`, Sentry, and the plugin bridge are unconditional in `main.tsx`.
- **Typing is available:** `local/packages/shared` holds the server's response types, so handlers can be typed against the product — a schema change fails the demo build, not the demo.

### Sizing

| Slice | Content | Days |
|---|---|---|
| 1 | Record the write endpoints for the six interactions; `demo` build mode; MSW seam; fake socket; shell handlers (21) | 1.5 |
| 2 | Seed: one invented company, five agents, one bolt with items, approvals, activity, canned run transcript; in-memory store with `sessionStorage` persistence + Reset; remaining read handlers (31) + write handlers (~20) | 3 |
| 3 | Host at `/demo` (Vite `base`, Next rewrite, retire the canned fixture); one-line demo banner | 1 |
| 4 | Drift gate: CI builds the demo and runs a Playwright smoke through the 16 screens; unmatched request in demo mode is a visible error | 1 |
| 5 | Landing "or see a bolt →" deep-links to the seeded bolt | 0.25 |

**≈7 build days.** Risk sits in slice 1 (the seam) and in the shape of the six write flows.

### Recommendation

- [x] **PRD** — viable and bounded. Proceed to `prd_writer` with this document as input.
- [ ] Defer
- [ ] Abort

### Constraints to carry into the PRD

- No model runs in the demo; agent runs replay canned transcripts (`ui/src/fixtures/runTranscriptFixtures.ts` exists).
- Demo data is an invented company. Never the operator's companies, tasks, or identifiers.
- The demo must fail loudly on an unhandled endpoint — a silent 200 is the drift we are trying to prevent.
- Vault rule: the landing's `/demo` link is the only public entry; the local app's invites, members, and sign-up stay untouched.
