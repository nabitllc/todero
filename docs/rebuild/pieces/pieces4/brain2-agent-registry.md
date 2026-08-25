# PIECE: Read the agent roster from the Brain2 vault instead of a missing Markdown file

id: brain2-agent-registry
lane: Fleet

## Why this piece matters
Todero parses AGENTS.md from a directory that does not exist on this machine. Meanwhile the vault already holds a structured registry at Global_Agents/<agent>/manifest.json carrying model.tier, claude_code_alias, preferred, fallback_local (already qwen2.5-coder:14b) and local_eligible. The owner wants Todero and Brain2 to feel like one system.

## Build instruction
Read C:\\Development\\Mich-Brain2\\Global_Agents\\*/manifest.json, resolved from TODERO_VAULT_DIR. Map each manifest into the agents table: tier drives model selection, local_eligible drives whether a run may be routed to Ollama, fallback_local names the model to use. Read docs/brain2-integration.md in this repo FIRST — it is the binding contract. The vault is READ-ONLY: you may not create, modify or delete anything under it, and the only writable path in the entire vault is _pending/, which this piece does not touch. Todero must run correctly when the vault is ABSENT: degrade to Todero's own defaults with a visible notice naming the path searched. Never crash, and never substitute invented agents.

## How you are graded
Your acceptance checks are written by the orchestrator in
scripts/acceptance/checks-anywhere.mjs . You did not write them and you must
not edit them. Run:

    node scripts/acceptance/run.mjs --piece brain2-agent-registry

That is the gate. A frontier critic looks at your work only after it is green,
and judges what a script cannot: whether the result is honest, and whether it
beats the comparator. If you think a check is wrong, say so in knownGaps with
your reasoning — never edit your own grader.

## Reference
The full comparator analysis is at C:/Users/msaen/AppData/Local/Temp/claude/C--Development-Todero/9ddc17d7-6e60-4b28-bbea-9d05df164c88/scratchpad/comparator-diff.md —
read the sections relevant to your piece. It contains the concrete shapes to
copy from builderz-labs/mission-control and Hermes Agent, and a list of things
that could NOT be verified. Do not treat an unverified item as fact.
