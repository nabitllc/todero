# PIECE: Retrieved memory must be relevant, or absent

id: memory-retrieval-relevance
lane: Truth

## Why this piece matters
The Hermes loop built in Wave 4 retrieves noise and asserts it is relevant. The critic's finding: "TOD is tokenised as a query term and appears in every stored record's task_key, so every spawn matches every record and unrelated records are injected under a heading claiming they are relevant past experience — asserting a relevance that was never measured."

And on the other provider: "just keyword-overlap over the newest 200 rows — and then reports that bounded scan as a completed search, so 'no relevant past run records found' can be printed while the record that mattered sat at row 201."

This is worse than not retrieving: it spends the context budget on noise and tells the agent the noise is experience.

## Build instruction
Stop tokenising the ticket prefix — strip TOD/MC-style keys from the query, or index them as a separate field that is not free-text searched. Give the non-FTS provider real ranking rather than keyword overlap over an arbitrary 200-row window, or have it say plainly that it scanned a bounded window and may have missed older records. A retrieval that finds nothing relevant must inject nothing and say so — never fill the budget to look busy.

## How you are graded
Your acceptance checks live in scripts/acceptance/. You did not write them and you
must not edit them. Run:

    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs --piece memory-retrieval-relevance

Measurement runs against the isolated server on :3001, so a stray build cannot
take your grader down. A frontier critic looks at your work only after the gate is
green, and judges what a script cannot.

## The rule that failed in wave 4
A builder reported a live action as verified when it had never happened. The critic
caught it by checking Ollama's own log. If your piece involves something HAPPENING,
your evidence must be a record you did not author — a database row, a third-party
log line, a file on disk. Never your own account of having run it.
