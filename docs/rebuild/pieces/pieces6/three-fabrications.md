# three-fabrications — a sentence on screen that its own data contradicts

Three critics each found one claim the code does not back. Not a missing
feature, not an ugly screen: a **guard describing enforcement it does not
perform**, which is the worst class in `docs/rebuild/HANDOFF.md` because it is
trusted. Each fix below is finished only when the listed item is observable —
by a test that fails against the old code, or by a rendered string.

---

## 1. `registered_at` must never be laundered into "heartbeat N ago"

`lib/agent-registrations.ts:120` read `toEpochMs(row.last_seen_at) ??
registeredAt`, so a registration row with no recorded check-in inherited its
REGISTRATION timestamp as `lastSeenAt`. That flowed through
`app/api/agents/route.ts` into `AgentDto.lastSeenAt`, and `lib/fleet-liveness.ts`
worded it as a heartbeat. Measured with the heartbeat store empty and
`last_seen_at` NULL, the screen read:

```
state from hook events, never inferred · last event 4m ago
Agent | live | heartbeat 4m ago
```

with zero hook events in existence.

### ACCEPTANCE

1. `AgentRegistration` exposes the RECORDED check-in separately from the
   fallback: `recordedLastSeenAt` is `null` when `last_seen_at` is NULL. It is
   never silently replaced by `registeredAt`.
2. `AgentDto` carries `lastSeenSource: 'heartbeat' | 'registration' | 'none'`
   alongside `lastSeenAt`, set by every builder in `app/api/agents/route.ts`
   from the branch it actually took — the heartbeat store, the registration
   row, or nothing.
3. A registration row whose `last_seen_at` is NULL produces
   `lastSeenAt: null`, `lastSeenSource: 'none'`, `liveness: 'never'`. `never`
   is reachable again.
4. `FleetLivenessInput` requires a `source`. `classifyFleetLiveness` returns
   `never` for any row whose source is not `'heartbeat'`, the same way it
   already returns `unknown` for an unread store — a registration timestamp
   cannot be classified as a hook event.
5. `describeLiveness` for a registration-sourced row renders the registration
   age and says no hook event has arrived. It never renders the words
   `heartbeat N ago` for it.
6. `summarizeFleet().lastEventAt` counts only heartbeat-sourced rows, so
   `fleetProvenanceLine` on a fleet of registration-only rows renders
   `no hook event has ever arrived` rather than `last event 4m ago`.
7. `components/tabs/CrewTab.tsx` passes the DTO's `lastSeenSource` through and
   fails CLOSED: a row that carries no source is treated as not-a-heartbeat.
8. `app/api/connect/route.ts` stops discarding `recordHeartbeat()`'s result.
   A failed or degraded heartbeat write surfaces in the POST /api/connect
   response body (`heartbeat_warning` / `heartbeat_recorded`) instead of
   silently becoming a "heartbeat" for ten minutes.
9. A test in `lib/__tests__/fleet-liveness.test.ts` reproduces the measured
   fleet — heartbeat store readable, one registration-sourced row, zero hook
   events — and asserts the two exact strings. It FAILS against the old
   two-field `FleetLivenessInput`.

---

## 2. `runTouchedPaidProvider` must read what its name and its sentence claim

`lib/run-trace.ts` named a function `runTouchedPaidProvider` and answered
`steps.some(s => s.cost_usd !== null)`; `components/tabs/RunTraceCard.tsx`
printed the design rule verbatim: *"The dollar column appears only when a run
touches a paid provider."* Measured: a step with `provider = 'anthropic'` and
`cost_usd = NULL` rendered *"no step recorded a dollar cost … The dollar column
appears only when a run touches a paid provider"* while the row it described
said `anthropic`. `run_steps.provider` was validated, stored, returned by the
API, and read by nothing.

**Choice: read `provider`. NO MIGRATION IS NEEDED — migration prefix 063 is
not used by this piece.** Dropping the column would need a migration this
piece does not own, and the column already carries real data. But the schema does
not record whether a provider CHARGES, so the sentence is also corrected to
what is actually known.

### ACCEPTANCE

1. `runTouchedPaidProvider` is gone. `runTouchedProvider(steps)` is true when
   any step recorded a `provider` OR a `cost_usd` — `provider` is read.
2. A run whose only evidence is `provider = 'anthropic'`, `cost_usd = NULL`
   renders the dollar column; that step's cell reads
   `anthropic · cost not measured` (the provider named beside the absence),
   not `—` and not a hidden column, and the panel sentence carries the phrase
   `provider recorded, cost not measured` verbatim.
3. The panel sentence no longer claims the schema knows what is paid. It
   names the columns: the dollar column appears when a step recorded a
   `cost_usd` or named a `provider`, and a provider is not a price.
4. The dollar total's denominator counts only steps that recorded a cost:
   `$0.5000 across 1 of 3 steps` plus the same carve-out the token panel
   already gets — `2 steps recorded no cost_usd and are excluded — not counted
   as zero.`
5. `costByStep` no longer lets a tool with a cost but no tokens vanish:
   `costOnlyGroups` names each such tool and its dollars, and
   `barredCostUsd` is the sum the bars actually account for. The card renders
   that line, so the visible rows can no longer sum to less than the printed
   total without saying so.
6. Tests in `lib/__tests__/run-trace.test.ts` cover: provider-only run is
   `true`; the cost denominator; and a cost-without-tokens tool appearing in
   `costOnlyGroups`. They FAIL against the old cost-only implementation.

---

## 3. No Approve button the server always refuses

`components/tabs/ApprovalCard.tsx:10-13` claimed *"A label therefore cannot
promise an effect the server would refuse."* The import-time check it cited
compares type-key SETS only; it cannot see the per-row preflight, and
`describeApproval()` never calls `preflightDecision()`. Measured: of four
approval cards rendered live, two carried an Approve button the server refuses
with 409 — `NO_AGENT` (empty agent id) and `TARGET_MISSING` (vanished issue).

`lib/approvals.ts` is owned by another agent this round, so the gate is built
in the card from that module's own exported `preflightDecision` — the same
function the route calls, not a second copy of its rules.

### ACCEPTANCE

1. `approveGate(row, lookup)` in `components/tabs/ApprovalCard.tsx` calls
   `preflightDecision({ row, decision: 'approved', lookup })` and returns the
   button's enabled state plus **the server's own `reason` string**, verbatim,
   for EVERY `PreflightRefusalCode` — not only `NO_REGISTERED_EFFECT`.
2. A row with `agent: null` and no `context.agent_id` renders a DISABLED
   Approve button carrying the server's `NO_AGENT` sentence. Clicking is
   impossible; the refusal is readable before the click.
3. A row whose target issue no longer exists renders a DISABLED Approve
   button carrying the server's `TARGET_MISSING` sentence.
4. Existence is looked up, never assumed. Until the lookup answers, the button
   is disabled and says so; a lookup that FAILS leaves it disabled (fail
   closed) rather than promising an effect that may be refused.
5. A row with no registered effect still renders NO approve button at all
   (unchanged), and the card now shows the server's `NO_REGISTERED_EFFECT`
   reason for it.
6. A clean, approvable row renders an ENABLED Approve button with the label
   `describeApproval` produced. No regression to the working case.
7. The file's own comment stops claiming the import-time set check makes a
   label safe, and says what actually makes it safe.
8. A test asserts 2, 3, 5, 6 and FAILS against the old
   `d.approveLabel`-only rendering.

---

## Cross-cutting

- `node scripts/acceptance/run.mjs` stays 45/45.
- `npm test` stays at its known pre-existing failures (`agents-route`,
  `agents-unconfigured`, `spawn-live`) and no others.
- `npx tsc --noEmit` is clean.
- Every fixture inserted into `./db.sqlite` is removed and the removal
  confirmed.
