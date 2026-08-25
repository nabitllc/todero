# PIECE: Chat runs on the local model and nothing else

id: finish-openrouter-removal
lane: Surface

## Why this piece matters
A UI option labelled 'Private, free, offline' currently ships the prompt to openrouter.ai. The owner has ruled out OpenRouter entirely: local only, for now.

## Build instruction
Remove every OpenRouter reference from app/api/chat/*, components/tabs/ChatTab.tsx and anywhere else it appears. Route chat through the LLM_BASE_URL seam to Ollama. The model dropdown must be populated from a live GET of ${LLM_BASE_URL}/models — no hardcoded vendor names anywhere in components/tabs. An unknown model id returns 400 naming the id; never silently substitute another vendor model. With Ollama stopped, the tab shows an explicit error naming the URL that failed.

## How you are graded — READ THIS
Your acceptance checks are already written, by the orchestrator, in
scripts/acceptance/checks-truth.mjs . You did not write them and you must not
edit them. Run them:

    node scripts/acceptance/run.mjs --piece finish-openrouter-removal

That command is the gate. A model critic only looks at your work AFTER those
checks pass, and it judges what a script cannot: whether the result is honest,
and whether it is better than how the best mission controls handle this.

If you believe a check is wrong, say so in knownGaps with your reasoning — do
not edit the check to make it pass. Editing your own grader is the one thing
that invalidates the whole exercise.
