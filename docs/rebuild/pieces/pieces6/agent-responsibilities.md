# PIECE: What each agent is RESPONSIBLE for

id: agent-responsibilities
lane: Fleet

OWNS EXCLUSIVELY:
`migrations/065_agent_responsibilities.sql`,
`migrations/sqlite/065_agent_responsibilities.sql`,
`app/api/agent-responsibilities/**`,
`lib/agent-responsibilities.ts`,
`lib/__tests__/agent-responsibilities.test.ts`,
`components/tabs/ResponsibilitiesCard.tsx`,
`docs/rebuild/pieces/pieces6/agent-responsibilities.md`

DO NOT TOUCH: `app/page.tsx`, `components/nav/**`, `AGENTS.md`,
`lib/agent-capabilities.ts`, `lib/agent-roster.ts`, `lib/agent-queue.ts`,
`lib/agent-budget.ts`, `lib/agent-registrations.ts`, `lib/agent-heartbeats.ts`,
`lib/fleet-liveness.ts`, `app/api/agents/**`, `app/api/issues/**`,
`app/api/inbox/**`, `app/api/conversations/**`, `app/api/commerce/**`,
`app/api/connections/**`, other `components/tabs/*`, `scripts/**`,
`migrations/0[0-6][0-46]*`.

---

## Why this piece exists

The owner's framing for Todero is **"a 0 or 1 person business manager"** —
*"agent orchestration, agents with their own tasks and responsibilities in the
company, all of it."*

Today Todero has:

* a **roster** — `AGENTS.md`, parsed by `loadAgentRoster()`, served by
  `GET /api/agents`. It answers *who exists*.
* a **capability map** — `lib/agent-capabilities.ts`. It answers *what an agent
  can do*: `builder` has `['Coding','PRs','Refactoring','Next.js','Supabase']`.
* a **queue config** — `lib/agent-queue.ts`. It answers *what status an agent
  picks work up from*, and it is dispatch-only.

None of those answers **who owns an area of the business, and who is
accountable when that area stalls.** "Builder can code" is not the same claim
as "Builder is accountable for everything shipping on the build lane, and when
nothing ships, Builder is who you ask." The second claim is the one a business
manager makes, and Todero cannot currently record it, read it back, or show
that an area has nobody.

## The distinction this piece must not blur

| Question | Answered by | Where |
|---|---|---|
| Who exists? | roster | `AGENTS.md` (`loadAgentRoster()`) |
| What *can* this agent do? | capability | `lib/agent-capabilities.ts` |
| What status does it pick up? | queue lane | `lib/agent-queue.ts` |
| **What does it OWN, and who answers when it stalls?** | **responsibility** | **this piece** |

A responsibility row must not restate a capability. The relation between them
is a **join, reported not enforced**: the read path annotates every assignment
with whether the agent's declared capabilities back the area
(`capability_backed`). An unbacked assignment is still allowed — the owner may
deliberately hold `main` accountable for spend — but it is visible.

## The area vocabulary is a DECLARED DECISION, not derived data

This must be stated plainly because the rebuild keeps paying for the opposite.
`AREAS` in `lib/agent-responsibilities.ts` is a **closed, code-declared
vocabulary**. It is not read out of a table, and nothing in this repo currently
enumerates "areas of the business". It is a product decision, and it is closed
so the write path can refuse an unknown area exactly the way
`app/api/hub-settings/route.ts` refuses an unknown key: *"an open key/value
endpoint is an open write to a table the app reads back and trusts."*

Each area carries the artifact in this repo that evidences the work is real, so
the list is auditable rather than asserted.

## Shape

One row per **(business_id, area, agent_id)**, carrying a `level`:

* `accountable` — **at most one per (business_id, area)**, enforced by a partial
  unique index in both dialects. This is what makes "who answers when this
  stalls" a single-valued question.
* `responsible` — does the work; many allowed.

RACI's *consulted* and *informed* are deliberately absent: they create no
obligation, so a table of them would be decoration.

Per-**hub**, not per-project, matching `hub_settings` (058) and
`hub_connections` (059): the owner's model is one hub with many projects, and an
agent's accountability is a standing fact about the company, not about a ticket.

## THE HONEST LIMIT — this must be on screen, not only in a report

**Nothing in the dispatch path reads these rows today.** `lib/agent-queue.ts`,
`app/api/run-agent`, and the cron lanes do not consult
`agent_responsibilities`. Dispatch is deliberately guarded off
(`lib/dispatch-guard.ts`, `TODERO_DISPATCH_ENABLED`) and this piece does not
weaken that guard by one line.

So this piece ships a **record**, not a **control**. The card must say so in
words on screen, and `GET` must report it as a machine-readable field
(`consulted_by: []`). Rendering a responsibility table that nothing obeys,
without saying so, is the fabrication class this rebuild keeps paying for.

---

## ACCEPTANCE — verified against the RUNNING app

Server already running at `http://localhost:3000`. Do NOT restart it, NEVER
`npm run build`. Auth: `cookie: mc-auth=kaos2026; mc-role=owner`. Every fixture
inserted must be removed and the removal confirmed.

1. **Both dialects apply from empty.** `migrations/065_agent_responsibilities.sql`
   and `migrations/sqlite/065_agent_responsibilities.sql` exist;
   `npm test -- migrations-from-zero` passes (PGlite applies every
   `migrations/*.sql` in order, so 065 is proven against a genuinely empty
   Postgres), and `npm run db:migrate` applies the SQLite copy to `./db.sqlite`
   and records `065_agent_responsibilities.sql` in `schema_migrations`.

2. **The migration comment justifies the shape.** It states, in the file: why a
   row is `(business_id, area, agent_id)` rather than a column per agent; why
   `level` is two values and not four; why `area` is *not* a SQL `CHECK` while
   `level` *is*; and how a responsibility differs from a capability. A reader who
   only opens the migration can reconstruct the decision.

3. **One accountable per area, enforced by the database.** Show the partial
   unique index in both files. Prove it: assign `accountable` for one area,
   then attempt a second `accountable` for the same `(business_id, area)` with a
   different agent and show the API answers **409** naming the incumbent, and
   that the second row is **not** in the table afterwards.

4. **`GET /api/agent-responsibilities?business_id=<id>` returns real rows only.**
   With no assignments it returns `assignments: []` — never a sample, never a
   demo row. The response also carries the declared `areas`, the roster's
   `fleet` (ids + the file they were read from), and `consulted_by`.

5. **An agent id no roster declares is REFUSED, not stored.** `POST` with
   `agent_id: "todero-sme"` (an id with a live queue lane in
   `lib/agent-queue.ts:360` but declared by no `AGENTS.md` in this repo) is
   rejected with a 4xx that names the roster source path and lists the declared
   ids. Show the response, then show `SELECT count(*)` on the table is unchanged.
   Repeat for a clearly bogus id (`vespera-sme`).

6. **An unknown area is refused with the known list**, matching hub-settings'
   fail-closed stance. Show the 400 and its `known` array. Same for an unknown
   `level`.

7. **A missing/unreadable roster refuses the write rather than widening it.**
   Point `AGENTS_MD_PATH` at a path that does not exist and show the write path
   refuses with a message naming the path — it must never fall back to "allow
   any id". (Provable via a unit test if the running server's env cannot be
   changed without a restart; a restart is forbidden, so the unit test is the
   permitted proof and must exist.)

8. **Remove works and is confirmed.** `DELETE` removes exactly one
   `(business_id, area, agent_id)` row; a `DELETE` for a row that is not there
   answers 404 rather than a silent 200. Show the table empty at the end.

9. **`lib/__tests__/agent-responsibilities.test.ts` proves the validators FAIL
   when they should**, not only that they pass: unknown area, unknown level,
   undeclared agent id, empty roster, missing business_id. Every refusal case is
   its own assertion. `npm test -- agent-responsibilities` is green.

10. **No hardcoded agent list — the allowlist IS the roster.** Two proofs, both
    mechanical. (a) `coverage()` emits only agent ids present in its input rows,
    and emits none at all for an empty input — no default owner, no fallback.
    (b) Hand `validateAssignment` a *fabricated* roster containing an
    id that exists nowhere in this repo and watch it ACCEPT that id, while the
    real roster REJECTS `todero-sme`. Same code, opposite verdicts, decided
    entirely by the roster passed in — which is only possible if there is no
    built-in list.

11. **`ResponsibilitiesCard.tsx` honours the `components/nav/Card.tsx`
    contract**: one question as the title, one number from a real query, the
    query printed as `source`, an empty state that names the fleet (agent count
    and the file it was read from), and an error that **replaces** the body
    rather than sitting beside a stale number.

12. **The card states the honest limit on screen.** It renders, in words a
    non-engineer reads, that nothing consults these assignments yet and that
    dispatch is off — sourced from the API's `consulted_by`, not a hardcoded
    sentence that could go stale silently.

13. **Nothing is seeded.** Grep the migration and the lib for any `INSERT`; there
    is none. An empty table reads as "no responsibilities are assigned yet",
    naming the fleet size, never as a populated demo.

14. **The dispatch guard is untouched.** `git diff` shows no change to
    `lib/dispatch-guard.ts`, and `node scripts/acceptance/run.mjs` still reports
    `dispatch-guard-untouched  503 DISPATCH_DISABLED`.

15. **Gates green.** `npx tsc --noEmit` clean; `node scripts/acceptance/run.mjs`
    still 45/45 in about 4s; `node scripts/no-invented-projects.mjs` exit 0;
    `npm test` shows no new failures beyond the known five
    (`agents-route`, `agents-unconfigured`, `spawn-live`).

16. **The card is not wired into a page by this piece**, because `app/page.tsx`
    is owned by another builder this round. The report must state exactly what
    the wiring is — the import path, the props, and where in the Fleet
    destination it belongs — so the owning builder can do it in one line.

---

## WIRING — for whoever owns `app/page.tsx`

Two lines, inside the Fleet destination, alongside the roster/live/office cards:

```tsx
import ResponsibilitiesCard from '@/components/tabs/ResponsibilitiesCard'
// …
<ResponsibilitiesCard hubName={hubName} />
```

`hubName` is the same prop `BoltScheduleCard` already takes — the hub's
`businesses.name`. The card resolves the id itself from `/api/businesses`, so
nothing else has to be threaded through. It renders its own loading, empty and
error states and needs no wrapper.

## VERIFIED, not assumed: the `todero-sme` / `infra-sme` claim

Checked 2026-08-26 against this tree rather than taken on report.

* `lib/agents-config.ts:5-6` does make the claim, in its own header:
  *"it invented `infra-sme` and `todero-sme`, which no AGENTS.md on any host
  declares"*.
* **The claim is true for this repo.** There are 19 `AGENTS.md` files here (the
  root one plus nine `workspace-*/` and nine `config/workspace-*/` copies).
  Only the root file has a roster table at all; the workspace copies contain no
  `|` table rows. Neither `todero-sme` nor `infra-sme` appears in any of them.
  `loadAgentRoster()` on this host returns exactly 14 ids and neither is among
  them — asserted, not eyeballed, in
  `lib/__tests__/agent-responsibilities.test.ts`.
* **Both still have live queue lanes.** `lib/agent-queue.ts:360` (`todero-sme`)
  and `:399` (`infra-sme`) are full `AGENT_QUEUE_CONFIGS` entries, reachable via
  `getQueueConfig()`/`getAllQueueAgentIds()`, with prompt text instructing the
  agent to `POST /api/issues`. They also have model, filter, escalation, domain
  and source defaults in `app/api/agent-config/route.ts:32-106`,
  `app/api/issues/route.ts` auto-assigns epics to them at `:1279-1280`, and
  `lib/issue-type-config.ts:54,56` offers both in an assignee dropdown.
* **Why the existing guard does not catch them, and is right not to.**
  `scripts/no-invented-projects.mjs` validates an `<x>-sme` id by asking whether
  `<x>` is a prefix of a canonical project. `Todero` and `Infrastructure` ARE
  canonical, so both ids pass. This is a *different defect class* from
  `kemuni-sme`: not an invented PROJECT, but an **undeclared AGENT**. The
  project guard was never built to see it.
* This piece does not fix that — those files belong to other builders — but it
  refuses to compound it. `todero-sme` is exactly the id acceptance item 5 uses
  as its refusal fixture.
