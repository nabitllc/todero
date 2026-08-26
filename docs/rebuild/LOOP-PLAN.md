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

**Stop rule — REPLACED 2026-08-26 by the owner:**

> "continue loop until Todero is shippable with all channels having a score
> higher to competitor. stop only if I ask you to stop."

So: **do not stop on flat scores.** Do not stop at the end of a wave. Do not
stop because the queue emptied — when it does, pick the next-worst channel off
`scripts/board/channels.json` and write a piece for it, or run the
Paperclip.ing feature study. The loop ends when the owner says so, or when
every channel in `channels.json` clears its goal.

A RED gate is still not a reason to stop — it is the next piece. Fix it as the
highest-priority work in the following round and say so on the board. What must
never happen is continuing to BUILD on a red gate while reporting green.

**Update the flight board after EVERY wave** — owner's instruction, 2026-08-26.
Re-score `channels.json` with measured evidence, regenerate, republish to the
one artifact URL. Every raise carries what earned it AND what holds it back, so
a channel cannot drift up on vibes.

## The real scoreboard

`scripts/board/channels.json` — 19 channels, **1 cleared** (Search & Findability),
average **6.47** against a goal average of 8.9.

**The average went DOWN at wave 8, and nothing regressed.** Ten fresh critics
with a mutation-test budget scored ten pieces at 4-8 and found 42 fabrications,
against a board that had most of those channels at 7 or 8. One of those two
numbers was wrong and it was mine. Every score I had raised came from a
builder's own account rather than an adversarial one.

**RULE ADOPTED 2026-08-26, not asked: no channel rises on a builder's
self-report.** A raise needs an independent critic that has not seen the
builder's summary. A wave whose repairs have not been re-judged does not move
the board — it becomes the next wave's judging stage.

Regenerate the live numbers rather than trusting this paragraph:

```
node -e "const a=require('./scripts/board/channels.json').channels;a.map(x=>[x.current,x.goal,x.name]).sort((p,q)=>p[0]-q[0]).forEach(r=>console.log(r[0]+'/'+r[1],r[2]))"
```

Multi-tenancy & Identity sits at 1/8 and is EXEMPT pending an owner decision —
see `scripts/board/decisions.json`, `all-channels-vs-multitenancy`. Until that is
answered the stop rule cannot be satisfied as written, because "every channel
clears its goal" and "multi-tenancy is post-MVP, skip it" contradict.

## DECIDED 2026-08-26 — the OPEN DECISION is closed, and four others with it

The Fleet issues-scope contradiction sat here for two days because picking wrong
widens a security boundary, and no agent was permitted to resolve it. **The owner
chose Option 1:** an explicit `project=eq.<in-scope>` filter satisfies the scope
requirement regardless of which destination the request came from — the smallest
change, and literally what the refusal message already instructs the caller to do.

He did NOT choose Option 2 (let Fleet reads span projects) or Option 3 (Fleet
should not read issues at all). Implement Option 1 and nothing wider. The grant is
an EXPLICIT, IN-SCOPE project filter — not any filter, not a filter-shaped string,
and never the absence of one. `scripts/no-unscoped-issues.mjs` gains probes for
this exact case in BOTH directions.

**All five board decisions are answered. Zero open.** The other four:

* **The stop rule.** Done is 18 of 18 SCORED channels. Multi-tenancy & Identity is
  formally EXEMPT and rendered as exempt rather than failing. This is the one that
  mattered most — "every channel clears its goal" and "multi-tenancy is post-MVP,
  skip it" contradicted, so the loop had been running toward a finish line it had
  already been told to make unreachable.
* **Conversations.** Build the provider-agnostic half; pick no provider. Already
  built. The channel stays capped until the owner names a transport — an outbox
  that cannot send is a draft folder, and that is the honest cap.
* **The dispatch window.** ACCEPTED WITH A CONDITION THAT BINDS THIS LOOP: owner
  present, Limiglow only, short wall-clock cap. **It therefore does not happen in
  a background wave.** Planned as wave 11, and it needs the owner to say when.
  Until then `lib/dispatch-guard.ts` and `TODERO_DISPATCH_ENABLED` stay untouched
  and the ceilings are proven by driving the supervisor's own functions instead.
* **Inventory contention.** Serialize per SKU; keep the honest 409. The queue then
  needs a depth limit and an honest refusal when full, or it is the same defect one
  layer down.

**When a new decision appears, it goes on the BOARD, not into chat** — see the
section below. The owner reads the board from his phone.

## Queue, in order

The queue rule IS the queue: when it empties, pick the next-worst channel off
`channels.json` and write a piece for it.

**In flight (wave 9, dispatched 2026-08-26 ~15:00, ten lanes):** identity-sessions,
approval-surface, agent-visualization, pipeline-humaniser, work-ui-components,
fleet-provenance, commerce-error-paths, run-safety-ceilings, memory-attempted,
llm-provider-sweep.

Wave 9 runs **judge -> build -> verify**, not build -> critic. Wave 8's repair
rounds were never judged, so stage 1 judges them. Stage 3 then re-judges what
stage 2 built, looking specifically for the pattern this program keeps finding:
a gap closed in one place and a weaker version of it introduced somewhere else.

**Next, after wave 9:** the Paperclip.ing feature study, and whichever channels
are then worst.

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

## Fan out with a WORKFLOW, not one-off agent calls

The owner caught this at wave 8: the waves had shrunk to five or six agents.
The reason turned out to be a defect rather than caution — a wave 6 builder had
been HUNG FOR FIVE HOURS holding four files, so every wave since had been routed
around it. It is also the agent that ran `git stash pop`, broke webpack, took
every route to 500, and then spent five hours failing to clean up while two other
builders reported its damage as their own failure.

**Check `ListAgents` for a stuck agent before blaming the plan.** An agent that
has been running many times longer than its peers is hung, not thorough.

Waves 8 and 9 use the `Workflow` tool: ten lanes, three stages each, thirty
agents, `pipeline()` so no lane waits on another. Wave 8 ran 30 agents with zero
errors in ~69 minutes. That is the shape to keep.

Two patterns worth repeating:

* **A test that is RED ON PURPOSE.** A lane that could not apply its own seam
  shipped `runs-permalink-seam.test.ts`, which failed for exactly as long as
  `app/page.tsx` lacked the seam, and whose failure message PRINTED THE ENTIRE
  DIFF. Incompleteness moved out of prose and into the gate, where it cannot be
  forgotten. This is now the house pattern for a seam an agent cannot apply.
* **A standing instruction to explain, not route around.** Three of the five
  "known failures" had been red for the ENTIRE program, and eight waves of gate
  reports — mine included — said "5 known failures" and moved on. One lane was
  told to find out why or prove them obsolete. They are fixed.

## An automatic checkpointer commits everything, on a timer

Discovered 2026-08-25 23:00. Something in this environment commits the whole
working tree as `checkpoint: <timestamp>` at intervals — it is where every
`checkpoint:` commit in this repo's history comes from, including the ones on
`main` and `feat/tod-2328`.

**This defeats "only the orchestrator commits."** Commit `30ebb3a` captured
seven agents' mid-flight work at once, including a builder's half-written
`lib/connections.ts` that does not compile and a temp fixture file. HEAD was
red for reasons no round introduced.

What this changes:

- **A checkpoint is a safety net, never a reviewed commit.** Never cite one as
  evidence that work landed, and never assume HEAD is gated just because it is
  recent.
- **The wave-boundary commit is the one that must be clean.** Gate the
  COMBINATION, then commit with explicit paths and a message that says what was
  verified. That commit — not the checkpoints around it — is the record.
- **Staging discipline still matters** for what the orchestrator asserts, but it
  cannot prevent mid-flight capture. The defence against a bad checkpoint is
  gating before the wave commit, not staging hygiene.
- **A red gate mid-wave is not automatically a stop-rule trigger.** Check who
  owns the failing file first: a builder still running will have inconsistent
  intermediate state, which is expected. Only a red that survives after all
  builders report is a real red.

## Migration number registry — allocate BEFORE dispatching a builder

Two builders picking the same prefix is a collision the acceptance harness
already checks for (`no-colliding-migrations`). The orchestrator allocates;
builders never choose their own.

| # | Owner | What |
|---|---|---|
| 058-066 | earlier waves | LANDED |
| 067, 068, 069 | wave 6 | allocated, WENT UNUSED — no schema change was needed |
| 070 | conversations builder | threading + idempotency. LANDED, both dialects. |
| 071 | boolean-columns builder | allocated, WENT UNUSED — the builder deliberately did not leave a migration on disk where an unattended `db:migrate` could pick it up before a maintenance window exists |
| 072 | hub-connections builder | allocated, went unused |
| 073 | — | free |
| 074 | commerce builder (wave 8) | `order_line_items.fulfilled_quantity` — partial fulfilment. LANDED, both dialects. |
| 075 | memory lane (wave 9) | reserved, may go unused |

Next free: **076**.

Three of wave 6's allocations went unused, and that is the registry working as
intended rather than waste: a number is reserved BEFORE dispatch so two builders
cannot collide, and a builder that finds it needs no schema change should say so
rather than inventing one to justify its allocation.

## Integration is the orchestrator's job, and it is a real job

The owner: *"you are the one who commits and combines their work making sure
the code doesn't break each other"*, and *"between waves, spawn one fresh agent
to test what was built and smooth it into one coherent thing."*

So the wave boundary has three distinct steps, and skipping any one of them is
how a green wave ships a broken app:

1. **Wire** — the orchestrator alone edits `app/page.tsx` and
   `components/nav/config.ts` to mount what builders produced. Builders never
   touch either; that is why they can run concurrently at all.
2. **Gate the COMBINATION, not the pieces.** Each builder gates its own work in
   isolation, which proves nothing about the merge. After wiring, run
   `npx tsc --noEmit`, `node scripts/acceptance/run.mjs`, `npx jest`, and
   `bash scripts/smoke-test-layout.sh` over the combined tree.
3. **Smooth** — one fresh agent that owns nothing, greps everything, and tests
   the app as a whole: duplicated logic across pieces, two components solving
   the same problem differently, a defect sitting in the gap between two
   ownership boundaries. `HANDOFF.md` records why this is mandatory — a
   hardcoded emoji table survived two sweeps by living exactly there.

Only then do the per-piece critics' verdicts mean anything about the product.

## The board's shape is the owner's spec, not mine

Owner feedback, 2026-08-26, after reading it on his phone. Every one of these is
a standing requirement, not a one-off tidy:

1. **Short and easy to read.** The long evidence paragraph now lives behind a
   collapsed `<details>` on each channel card. Nothing was deleted.
2. **Rebuilt and republished at the END OF EVERY WAVE.** Not when it occurs to
   me. He commented twice that the wave log was stale, and he was right both
   times — I had been updating `channels.json` and never `waves.json`.
3. **A table of contents at the top**, numbered to match the section headings.
4. **Every fact appears ONCE.** The spend figure was in three places and stale in
   all of them. It is in the Ledger and nowhere else.
5. **Each channel carries: title, status, score, goal, and PROGRESS BY WAVE** —
   short bullets of what was worked on, what the next step toward the goal is,
   and what that wave moved the score by. `channels.json` grew `next` and
   `progress: [{wave, delta, did[]}]` for this.
6. **Keep the wave format**, append one entry per wave.
7. **Decisions and Harness collapse.** Decisions opens itself when something is
   awaiting him; Harness opens itself only when it is failing.
8. **No trailing Ledger duplicate** of what the header already says.

`scripts/board/build-board.mjs` is the only thing that writes the board. If a new
fact needs to appear, it appears in exactly one section.

## Decisions for the owner go on the BOARD, not into chat

Owner instruction, 2026-08-26: *"Add Decisions needed by me to Flight Board and
I will answer them when I see you added them."*

He reads the board from his phone and misses questions buried in a long reply.
`scripts/board/decisions.json` already existed and the board already renders the
section with an open count — it simply had nothing open in it.

Rules for adding one:

* Status `recommended` = open and waiting. Status `accepted` = he answered.
* Every entry carries a **recommendation**, the **why**, and the **tradeoff of
  picking against it** — including where the recommendation is least certain.
  A decision presented without a recommendation is work pushed back onto him.
* Only raise what genuinely cannot be resolved from the code, the brief, or a
  sensible default. Manufacturing decisions to look thorough wastes the one
  channel he actually reads.
* Do NOT block the whole wave waiting for an answer. Build everything that does
  not depend on it, and say plainly in the piece what stays unbuilt until he
  chooses.

Five are open as of wave 7. The first — that the stop rule cannot be satisfied
as written, because "every channel clears its goal" and "multi-tenancy is
post-MVP, skip it" contradict — is the one that matters most, since the loop has
been running toward a finish line it had already been told to make unreachable.

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

**GATE BASELINE, and it moves — never quote an older one.** As of wave 8:
`npx tsc --noEmit` clean; `npm test` ~1967 passing with **ONE** known failure,
`spawn-live`, a real environment dependency; `node scripts/acceptance/run.mjs`
45/45 at ~2200ms; `bash scripts/smoke-test-layout.sh` **nine** guards.

`agents-route` and `agents-unconfigured` are NO LONGER known failures. They were
red for the entire program and eight waves of gate reports said "5 known
failures" and moved past them. Judge by the FAILURE SET, never the total — the
total rises every wave as lanes land tests.

**A slow acceptance run is a loaded server, not a broken product.** Normal is
~2200ms. A run at 7000ms+ reporting 44/45 means thirty agents are hammering the
host. Re-run on a quiet server before reporting it — this has produced a false
alarm twice, and one lane's own doc independently recorded the same one.


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
- **CHANGED 2026-08-26: Limiglow NO LONGER has zero issues, and that is DELIBERATE.**
  The owner asked to see the product working; the database held one archived row,
  so every screen showed an honest empty state and nothing he could click. I
  seeded a realistic set — **TOD-504 to TOD-514**, two features with bugs and a
  task under them, an ops issue, an auto-created epic, and two moved into a
  sprint so the board has a Queue and an Active column.
  **DO NOT DELETE THEM.** The old rule was "Limiglow must end at 0 issues", and
  an agent following it literally would wipe the owner's demo data. The rule is
  now: delete every fixture YOU create, and leave TOD-504 through TOD-514 alone
  unless the owner says otherwise. Fixtures you create should still be removed —
  use titles that make yours obviously yours.
- Limiglow having zero issues WAS correct, and would be again if the demo data
  were removed. It is not a defect either way.
- Every fixture inserted must be removed, and the removal confirmed.
- `TOD-1` restore values: `archived_at = "2026-08-25 19:36:02"`,
  `archived_reason = "Pre-Limiglow history. Todero the tool is built against the Flight Board, not its own backlog."`

## Vault

Keep adding to `C:\Development\Mich-Brain2\_pending\2026-08-26-todero-loop-learnings.md`.
The vault is READ-ONLY outside `_pending/`. Six items so far.
