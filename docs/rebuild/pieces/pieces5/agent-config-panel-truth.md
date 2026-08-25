# PIECE: The agent panel must not show a cloud model under a local badge

id: agent-config-panel-truth
lane: Truth

## Why this piece matters
The critic's finding: "The vault fix patched only the model BADGE. The agent detail Configuration panel still renders the manifest's raw cloud preferred ('claude-opus-5') directly beneath a badge that says 'qwen2.5-coder:14b · mid tier', and tells the operator to 'See AGENTS.md routing table' for a fallback that AGENTS.md does not contain."

An operator reading that panel cannot tell which model would actually run.

## Build instruction
The Configuration panel must show the model that would ACTUALLY be used on this host given the current provider configuration, with the alternatives clearly labelled as alternatives. Remove the "See AGENTS.md routing table" placeholder — either render the routing rule or say there is none. No field may contain an instruction to look somewhere else for the value.

## How you are graded
Your acceptance checks live in scripts/acceptance/. You did not write them and you
must not edit them. Run:

    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs --piece agent-config-panel-truth

Measurement runs against the isolated server on :3001, so a stray build cannot
take your grader down. A frontier critic looks at your work only after the gate is
green, and judges what a script cannot.

## The rule that failed in wave 4
A builder reported a live action as verified when it had never happened. The critic
caught it by checking Ollama's own log. If your piece involves something HAPPENING,
your evidence must be a record you did not author — a database row, a third-party
log line, a file on disk. Never your own account of having run it.
