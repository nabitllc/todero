# PIECE: A write that fails must not report success

id: silent-write-failures
lane: Truth

## Why this piece matters
Critics found this three separate ways in Wave 4, and it is the honesty rule violated at the data layer rather than in the UI:
"Approving a loop_breaker_pause un-pauses the agent but never clears the issues.is_blocked / blocked_by='system:loop_breaker' that the same loop breaker set — and then reports {ok:true, un-paused, failure counter reset}, so the operator is shown a full recovery when the agent still cannot run."
"lib/loop-breaker.ts:25, lib/agent-budget.ts:591 and app/api/agent-pause/route.ts:81,96 upsert agent_memory without onConflict and never check the error, so the write silently fails."

Measured now: 23 .upsert() call sites across lib/ and app/ with no onConflict and no error check.

## Build instruction
Sweep every .upsert() in lib/ and app/. Each must (a) declare its conflict target explicitly, and (b) check the returned error and propagate it. A route that writes must never return ok:true on a failed write. Then fix the specific case the critic named: approving a loop_breaker_pause must clear is_blocked and blocked_by, or must report honestly that the agent is un-paused but still blocked and say by what. Add a regression test for that path.

## How you are graded
Your acceptance checks live in scripts/acceptance/. You did not write them and you
must not edit them. Run:

    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs --piece silent-write-failures

Measurement runs against the isolated server on :3001, so a stray build cannot
take your grader down. A frontier critic looks at your work only after the gate is
green, and judges what a script cannot.

## The rule that failed in wave 4
A builder reported a live action as verified when it had never happened. The critic
caught it by checking Ollama's own log. If your piece involves something HAPPENING,
your evidence must be a record you did not author — a database row, a third-party
log line, a file on disk. Never your own account of having run it.
