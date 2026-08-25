# PIECE: The vault registry must actually reach a run

id: registry-reaches-dispatch
lane: Fleet

## Why this piece matters
The critic's finding: "The vault registry never reaches a run. All 13 manifests are merged into the GET /api/agents response at read time and nowhere else — no row is persisted, and lib/agent-queue.ts's hardcoded AGENT_QUEUE_CONFIGS still owns model selection, so every vault agent answers 'Unknown agent' to the dispatcher."

So the Brain2 alignment is currently cosmetic: the roster displays vault data while dispatch uses a hardcoded table. Two sources of truth, and the one that matters is the hardcoded one.

## Build instruction
Persist the vault manifests into the agents table rather than merging them at read time. Make AGENT_QUEUE_CONFIGS derive from that table — model tier, claude_code_alias, preferred, fallback_local and local_eligible all come from the manifest. A vault agent must be dispatchable by name. Where the vault is absent, fall back to Todero's own defaults with a visible notice, as the registry piece already does for the roster.

## How you are graded
Your acceptance checks live in scripts/acceptance/. You did not write them and you
must not edit them. Run:

    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs --piece registry-reaches-dispatch

Measurement runs against the isolated server on :3001, so a stray build cannot
take your grader down. A frontier critic looks at your work only after the gate is
green, and judges what a script cannot.

## The rule that failed in wave 4
A builder reported a live action as verified when it had never happened. The critic
caught it by checking Ollama's own log. If your piece involves something HAPPENING,
your evidence must be a record you did not author — a database row, a third-party
log line, a file on disk. Never your own account of having run it.
