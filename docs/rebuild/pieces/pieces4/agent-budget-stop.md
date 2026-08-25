# PIECE: A per-agent budget that actually stops the agent

id: agent-budget-stop
lane: Operator

## Why this piece matters

This is the most important safety feature in the wave, and it is the one the
owner's own vault learned the hard way.

`Mich-Brain2/Playbooks/Loop_Engineering.md` records a measured incident from
2026-08-24: an overnight run was told in its own prompt to stop at 06:00 and was
launched with `--max-budget-usd 50`. It ran **17 hours**, past the deadline by
eleven, and did not halt on budget. A second loop the same night reached **$688**.
The playbook's conclusion:

> **Both guards were instructions the loop was free to reason past; neither was
> enforced by anything outside it.** Treat a prompt-level stop condition as
> documentation of intent, never as a control.

Todero today is worse than that. Its spend guard, `/api/heartbeat/budget-check`,
was audited as *arithmetically incapable of firing* — the comparison it makes can
never be true. And the cost ledger it would read from has 66,879 spawn stubs and
**zero finalized rows**, because the function that closes a row is dead code. So
there is no budget, and there is no data a budget could read.

Paperclip (MIT, self-hosted, model-agnostic) ships the behaviour Todero needs, in
one sentence: *"Monthly budgets per agent. When they hit the limit, they stop.
No runaway costs."* Portkey enforces the same thing in the request path with
per-key spend caps. This is a solved problem and Todero should stop improvising it.

This piece must land BEFORE or WITH `run-agent-locally`. Dispatching a real agent
without an enforceable ceiling is how the $688 night happens on this machine.

## SCOPE CORRECTION — read before building

This piece is a feature **inside Todero**, bounding agents that **Todero**
dispatches. It is not a bound on the Claude session that is building Todero;
that one is bounded separately by the orchestration script.

And the obvious guard is the wrong one first. Todero targets a **local** model
(Ollama on this host), so a run costs essentially zero dollars — it costs GPU
time and wall clock. A monthly dollar budget per agent, which is what Paperclip
ships, is correct for a cloud fleet and close to useless here today.

The runaway that can actually happen on this machine is already documented in
lib/dispatch-guard.ts: a detached watcher that re-POSTs /api/run-agent every time
its child exits. That loop is free in dollars and unbounded in time. A dollar cap
would never have stopped it.

So build the ceilings in this order:
  1. **Concurrency** — a hard cap on simultaneous runs per agent and overall.
  2. **Wall clock** — a maximum run duration, enforced by the supervisor and not
     by the agent. Exceeding it stops the run.
  3. **No-progress halt** — stop when state stops changing across N heartbeats,
     BEFORE any other ceiling is reached. Loop_Engineering element 3 is explicit
     that this is the cheap signal that catches a dead end early, and it is the
     one that would have caught the self-kicking watcher.
  4. **Run count per period** — a simple counter, which is what actually bounds
     a self-retriggering loop.
  5. **Dollar budget** — build it, wire it to the ledger, but understand it is
     dormant until a run is routed to a paid provider. It must not be the only
     ceiling, and it must not be the first one you implement.

Every one of these is enforced by the supervisor, outside the agent. The agent is
never asked to respect its own limits and is never trusted to report them.

## Build instruction

1. **Close the ledger first.** A budget that reads an empty table is theatre.
   Find why `lib/runtimes/token-ledger.ts` never finalizes a row — the closing
   function is dead code and nothing calls it — and wire it into the real run
   lifecycle so every run ends with actual token counts and a computed cost.
   Backfilling the 66,879 orphan stubs is out of scope; mark them and move on.

2. **Per-agent budget records.** A budget per agent, with a period, a limit, and
   spend-to-date derived from the ledger — not from an estimate and never from a
   hardcoded constant. Expose current spend against limit through the API.

3. **Enforce it outside the agent.** The check runs in the dispatch path, before
   a run starts, and again on each heartbeat for a run already in flight. Over
   the limit means the run does not start, and an in-flight run is stopped. The
   agent is never asked to respect its own budget and is never trusted to report
   it. An agent that is over budget is marked as such in the roster with the
   reason visible.

4. **Make the stop observable.** When a budget stops something, that is an event
   the owner can see: which agent, which limit, what it had spent, what was
   halted. A silent stop is nearly as bad as no stop, because the operator
   concludes the agent is broken rather than capped.

5. **Fix or delete `/api/heartbeat/budget-check`.** If it becomes the enforcement
   path, make its arithmetic correct and prove it fires. If it does not, delete
   it — an endpoint that advertises a guard it cannot provide is the exact
   dishonesty this reconstruction exists to remove.

## How you are graded

Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must not
edit them. Run:

    node scripts/acceptance/run.mjs --piece agent-budget-stop

The critic will additionally require evidence that the stop **actually fired** —
set a deliberately tiny limit, attempt a run, and show it being refused. A budget
that has never been observed stopping anything has not been demonstrated to work,
and per the playbook above, that is precisely the failure mode being guarded
against. "The code looks correct" is not evidence here.
