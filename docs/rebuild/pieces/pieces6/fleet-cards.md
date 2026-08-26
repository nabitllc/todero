# PIECE: Fleet — a roster that knows what is alive, and says how it knows

id: fleet-cards
lane: Operator
channel: Agent Fleet Operations (2 -> 9), Agent Visualization Fidelity (4 -> 9)

OWNS EXCLUSIVELY: components/tabs/CrewTab.tsx, components/tabs/OfficeTab.tsx,
components/tabs/FleetRegisterCard.tsx (new), app/page.tsx (the Fleet branch only)

DO NOT TOUCH: components/tabs/WorkViewCard.tsx, components/nav/config.ts,
lib/bolt-time.ts, app/api/issues/route.ts — settled or owned elsewhere.

## Why

Two channels sit at 2/9 and 4/9. `design/Fleet.dc.html` specifies a surface the
app does not have, and the gap is not decoration — it is provenance:

> "4 registered · 2 live · 1 waiting on you"
> **"state from hook events, never inferred · last event 4s ago"**

That second line is the piece. Today the roster shows 16 rows all reading
`liveness: "never"`, and nothing on screen says whether that means "no agent has
ever checked in" or "we did not look". Those are different facts and the
operator cannot tell them apart.

## Build instruction

### 1. Fleet gets cards, on the WorkViewCard pattern
`components/nav/Card.tsx` now has three consumers. Use it. Per card: the
question as the title, one number from a real query, the query printed, an
empty state naming the fleet, and an error that REPLACES the body.

**Roster** — "Which agents exist, and which are alive?" Number: registered
count. Each row carries name, tier, model, and its OWN last-seen, from a real
timestamp. The artboard's roster line reads "from Brain2 manifests" — say where
each row came from, and if a row has no manifest, say that instead of implying
one.

**Office** — "Where is each agent working?" The artboard positions agents by the
workspace folder they are in. If that data does not exist, the office must SAY
it is decorative rather than implying position means something. Do not invent
positions and render them as if measured.

### 2. Liveness must distinguish three states, not two
- `live` — a heartbeat inside the window
- `offline` — a heartbeat exists but is older than the window
- `never` — no heartbeat has ever arrived

Today everything collapses to `never`. `design/Fleet.dc.html` states the rule:
**"Heartbeat every 30s. Offline after 10m of silence."** Implement that window
and render which of the three each row is, with the actual last-event time.

### 3. The provenance line
Render the artboard's line honestly: "state from hook events, never inferred ·
last event <t> ago". If no hook event has EVER arrived, it must say so — not
render a plausible-looking age. This line is the single most-repeated element
across all seven artboards and it is the honesty rule made visible.

### 4. Registration card
`POST /api/connect` already returns `connection_id` and a heartbeat url — the
acceptance harness proves it. Surface it: show the endpoint, what it returns,
and the artboard's rule that "a GET on the heartbeat URL returns pending work,
so an agent behind a firewall can poll."

### 5. The Run control must not lie
`design/Fleet.dc.html` is explicit:
> "Run is disabled because dispatch is off. Set TODERO_DISPATCH_ENABLED=1 to arm
> it — **the control never appears live and then refuses.**"
The dispatch guard is a deliberate kill switch. Do not remove it. Render the
control as disabled WITH the reason, never enabled-then-503.

## ACCEPTANCE — verified against the RUNNING app

Server running at http://localhost:3000. Do NOT restart it, NEVER `npm run build`.
Auth: `cookie: mc-auth=kaos2026; mc-role=owner`. URLs are path-based:
`/b/todero/p/limiglow/fleet/team`. Every claim needs a FIXTURE, then removed.

1. Fleet's views render inside cards with a title, a printed source, and a
   collapse that survives reload. Show each.
2. The roster's count is an exact count from a real query, not `rows.length` of
   a page. Show the query and the number.
3. Insert a heartbeat 5 seconds old and show that row renders `live`.
4. Insert a heartbeat 15 minutes old and show that row renders `offline`, NOT
   `live` and NOT `never`. State the window used.
5. A row with no heartbeat at all renders `never`, and the UI distinguishes it
   in words from `offline`. Show both on screen at once.
6. The provenance line states the real last-event time. With zero events it says
   no event has arrived rather than rendering an age. Show both cases.
7. The Run control renders DISABLED with the dispatch reason. Prove it: show
   `TODERO_DISPATCH_ENABLED` unset, the control disabled, and that no request is
   sent when clicked. Then show `/api/run-agent` still answers 503
   DISPATCH_DISABLED — the guard is untouched.
8. No agent, tier, or model name on screen is hardcoded. Grep for the roster
   names and show each traces to a manifest or a table row.
9. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes,
   `node scripts/acceptance/run.mjs` reports 45/45 in about 4s. Slow or
   mass-failing means the SERVER is unhealthy — say so.
