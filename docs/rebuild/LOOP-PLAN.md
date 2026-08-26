# Overnight loop plan — 2026-08-26

Read this FIRST on every wake-up. It is the resume point; `HANDOFF.md` is the
background brief.

## Standing orders (from the owner, 2026-08-25)

> "Make Todero a shippable, working product, keep building and judging until
> each channel gets a score better than what it compares to. Keep using the
> gauntlet loop. If you're done before the 10h, find a feature Paperclip.ing has
> that would make a big impact in Todero that we don't have, build our version
> and loop until ours scores higher."

Authority granted for unattended turns: build + critic the remaining
destinations; fix in-scope defects critics find; the invented-projects sweep;
schema migrations.

**Git: commit to `rebuild/2026-08-26` ONLY. Never `main`. Never push.**

**Stop rule:** halt and wait if the harness goes red and one round cannot fix
it, or if two consecutive critics score flat WITH no new defect found. A flat
score WITH a new defect found is convergence — keep going. Moving to the next
channel is not stopping.

## The real scoreboard

`scripts/board/channels.json` — 19 channels, **0 cleared**, average **2.42**
against a goal average of **8.9**. This, not the destination list, is the
measure of "shippable". Ten hours cannot clear 19 channels; it can clear the
closest and lift the worst off zero.

| current -> goal | channel | route to move it |
|---|---|---|
| 1 -> 9 | Secrets & Credential Custody | Discord as a per-hub connection (FEEDBACK item 9). A live bot token sits in 29 files on main and the scanner passes it. Highest ratio of impact to effort in this table. |
| 0 -> 9 | Approval & Human-in-the-loop | The inbox approve path answers 404, not 5xx, but there is no approval SURFACE. Now's "Needs you" card is the seam. |
| 1 -> 9 | Learning & Memory Loop | Memory destination. `design/Memory.dc.html` is the most specified artboard: budget bar, what-it-tried records, skills with proposed state. |
| 2 -> 9 | Agent Fleet Operations | Fleet destination. `design/Fleet.dc.html` — roster with real liveness, office, registration. |
| 2 -> 9 | Run Safety & Enforcement | Ceilings exist and the dispatch guard holds; Runs has no surface for either. |
| 4 -> 9 | Agent Visualization Fidelity | Fleet office. |
| 6 -> 8 | Identity, Auth & Access Control | Blocked on real sessions replacing three shared passwords. Bigger than a round. |

## Queue, in order

1. **Work cards critic** — in flight at handoff time. Apply its single named gap.
2. **Fleet destination** (`design/Fleet.dc.html`) — cards + real liveness.
   Moves Agent Fleet Operations and Agent Visualization Fidelity.
3. **Memory destination** (`design/Memory.dc.html`) — moves Learning & Memory Loop.
4. **Settings/Connections + Discord per-hub** — moves Secrets & Credential
   Custody off 1, and removes the token from source. `hub_settings` (migration
   058) already exists for it.
5. **Runs destination** (`design/Run.dc.html`) — moves Run Safety & Enforcement.
   Note `RunsView` honestly refuses to render per-step cost because
   `agent_runs` has no step table; that refusal is correct and the fix is a
   schema addition, which is authorised.
6. **Invented-projects sweep** — 24 source files. `app/api/issues/route.ts`
   auto-assigns to `kemuni-sme` at :1141 and :1644; the four-project emoji
   table at :139 has already survived two sweeps. Also `sprint-start` sets
   `sprints.project` from the BUSINESS name, so a bolt started from the UI
   never appears on the Limiglow-scoped card.
7. **Paperclip.ing feature study** — only if the queue empties.

## Fan out. Do not build serially.

The owner caught this on 2026-08-25: six rounds were built by the orchestrator
alone while the loop's own design is a fan-out. `HANDOFF.md`'s "one piece at a
time with a written spec and **exclusive file ownership**" — that ownership
clause exists BECAUSE agents run in parallel. Read as a serialization rule it
makes the orchestrator the bottleneck, which is exactly what happened.

**Default: 3-5 builders concurrently, then their critics concurrently.**

Two constraints that are real, not caution:

1. **The shared seams are `app/page.tsx` and `components/nav/config.ts`.**
   Every destination has to be wired through them, so no builder may touch
   either. The orchestrator does all wiring, serially, after builders land.
2. **Builders must not run git at all.** The orchestrator stages explicit paths
   and commits. On 2026-08-25 a blanket `git add -A` swept a critic's temporary
   edit into two commits and shipped `/api/issues` with project scoping
   disabled — and the scope guard passed it, because that guard could not fail
   (TOD-2419). Concurrency plus blanket staging is how that happens.

**After every fan-out, run one pass that owns nothing and greps everything.**
`HANDOFF.md` records why: a hardcoded emoji table survived two rounds of a
sweep whose job was removing exactly that, because it sat between two
ownership boundaries. Disjoint ownership stops agents clobbering each other AND
lets a defect sit untouched in the gap.

Give every builder: its spec, its exclusive file list, the DO-NOT-TOUCH list,
the environment traps below, and the instruction to report what it could NOT do
honestly. A builder that reports a gap is worth more than one that reports
success.

## Per round, without exception

1. Write the piece spec to `docs/rebuild/pieces/pieces6/<id>.md` with a numbered
   ACCEPTANCE list. No spec, no round.
2. Build.
3. Cheap gate BEFORE any critic: `npx tsc --noEmit`, `node scripts/acceptance/run.mjs`,
   `bash scripts/smoke-test-layout.sh`, plus the piece's own tests.
4. Critic with fresh context. Barred from `wave*-report.md` and commit bodies —
   **NOT** from `HANDOFF.md` or `FEEDBACK.md`. Barring a critic from the
   decision record produced a confident false positive on 2026-08-25.
5. Commit pass or fail, with what failed in the message.
6. Update `scripts/board/channels.json` + `waves.json`, regenerate, republish to
   the ONE artifact URL.

## Environment, non-negotiable

- Dev server runs at http://localhost:3000. **NEVER `npm run build`** — it
  clobbers `.next` and kills the server. Five times so far.
  If the server is genuinely dead, `npm run dev` in the background is fine.
- `node scripts/acceptance/run.mjs` takes ~4s and reports 45/45. Slow or
  mass-failing means the SERVER is unhealthy, not the product.
- Auth: `cookie: mc-auth=kaos2026; mc-role=owner`
- URLs are PATH-based: `/b/todero/p/limiglow/<destination>/<view>`.
- `/api/issues` GET has a **30-second response cache keyed by query string**. A
  stale-looking count probably is stale. This already fooled one check.
- `/api/issues?...&limit=0` means EVERY ROW, not "count only". Use `limit=1`
  and read `total` for an exact count.
- `issues` CHECK constraint: status open/in_progress/in_review requires a
  non-null `sprint`. Use `backlog` for fixtures.
- Limiglow has ZERO issues. That is CORRECT.
- Every fixture inserted must be removed, and the removal confirmed.
- `TOD-1` restore values: `archived_at = "2026-08-25 19:36:02"`,
  `archived_reason = "Pre-Limiglow history. Todero the tool is built against the Flight Board, not its own backlog."`

## Vault

Keep adding to `C:\Development\Mich-Brain2\_pending\2026-08-26-todero-loop-learnings.md`.
The vault is READ-ONLY outside `_pending/`. Six items so far.
