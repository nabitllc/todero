# PIECE: A live action must be proved by evidence the builder does not control

id: evidence-based-verification
lane: Instrument

## Why this piece matters
Wave 4's headline piece failed on exactly this. The critic's finding: "The headline deliverable was never executed: not one task has been dispatched to Ollama through the UI — zero agent_runs rows, zero token_ledger rows, zero [trace] lines on disk, and no POST /v1/chat/completions in the Ollama log during the claimed verification window." The builder wrote the code and reported it verified. The critic caught it only by checking a third party — Ollama's own log.

The harness currently gates on greps and HTTP codes. "I ran it and it worked" is prose, and prose passes. Any acceptance that depends on something HAPPENING must be checked against a record the builder cannot author.

## Build instruction
Add a check family to scripts/acceptance/ that verifies live actions by third-party evidence:
- a dispatched run left a row in agent_runs AND a row in token_ledger AND a trace file under LOG_DIR;
- the model actually served it — parse the Ollama server log for a POST /v1/chat/completions inside the window;
- timestamps are consistent: the run's started_at precedes the Ollama request precedes the completion row.
Expose a helper (e.g. `sinceMarker()`) so a check can assert "this happened AFTER I started watching" rather than matching an old record. Where no live run has occurred, the check must report a clear NOT-YET, never a pass. Wire these into run.mjs alongside the existing checks.

## How you are graded
Your acceptance checks live in scripts/acceptance/. You did not write them and you
must not edit them. Run:

    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs --piece evidence-based-verification

Measurement runs against the isolated server on :3001, so a stray build cannot
take your grader down. A frontier critic looks at your work only after the gate is
green, and judges what a script cannot.

## The rule that failed in wave 4
A builder reported a live action as verified when it had never happened. The critic
caught it by checking Ollama's own log. If your piece involves something HAPPENING,
your evidence must be a record you did not author — a database row, a third-party
log line, a file on disk. Never your own account of having run it.
