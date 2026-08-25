# TODERO MISSION CONTROL — SHARED AGENT BRIEF (read this first)

## The goal (verbatim from the owner)
"Finish Todero so it can run in any machine using llm api, and for us and our
testing we will use Todero with local llm."

Todero must stop being a one-Mac appliance and become a Mission Control that a
stranger can clone, configure with an LLM API key (cloud OR local), and run.
Every feature it *shows* must be either genuinely done or honestly absent.
No pretending.

## How to inspect (NEVER trust a builder's summary — look at the running app)
- Dev server is ALREADY RUNNING at http://localhost:3000 (Next.js 14 dev).
- Auth cookie (owner role): `mc-auth=kaos2026; mc-role=owner`
- Example: curl -s -b 'mc-auth=kaos2026; mc-role=owner' http://localhost:3000/api/status
- Browser tools (mcp__Claude_Browser__*) are available: preview_start with the
  url, then read_page / get_page_text / computer screenshot.
  To auth in the browser: navigate to http://localhost:3000/login and submit the
  password `kaos2026`.
- Repo root: C:\Development\Todero  (Windows, git bash available via Bash tool)

## Local LLM available on THIS machine (use it, do not assume it is absent)
Ollama at http://localhost:11434 — OpenAI-compatible endpoint at
http://localhost:11434/v1 . Models present:
  qwen2.5-coder:7b, qwen2.5-coder:14b, qwen2.5-coder:32b   (all support tools)

## Known baseline defects found at session start (2026-08-24)
1. P0 RBAC BUG: role `owner` lacks `issues:read` -> GET /api/issues returns 403.
   Same for /api/memory (memory:read) and /api/run-agent. The core MC API is
   unusable for the highest-privilege role.
2. 500s from missing Supabase tables: public.connections, public.deploy_history,
   public.workspace_members  (=> /api/connections, /api/deploy-history, /api/roles)
3. /api/agents 500s: hardcoded path to `~/kaos-config/AGENTS.md`
4. macOS hardcoding across the repo: `/Users/kemuniagent/...`, `/opt/homebrew/...`,
   launchctl / LaunchAgents plists, bash-only scripts.
   Files: lib/runtimes/{claude-code,codex,cursor}.ts, app/api/{agents,automations,
   files,issues,run-agent,status}/route.ts, components/tabs/{AutomationsTab,
   CalendarTab}.tsx, config/scripts/*, scripts/*
5. lib/runtimes/openai-api.ts hardcodes hostname 'api.openai.com' -> cannot point
   at Ollama / LM Studio / OpenRouter / Azure without a code change.
6. /api/office-stream took 12s. /api/cron/watchdog 4.1s. /api/cron/queue-refill 2.9s.
7. Supabase is a hard dependency for boot; db.sqlite exists but is 0 bytes.

Full route probe: see api-baseline.txt in this same directory.

## App surface (what it claims to be)
20 tabs: overview, activity, team(crew), calendar, office, memory, board,
features, pipeline, issues, projects, automations, chat, infra, product-board,
settings, epic-map, ai-services, inbox.
67 API routes under app/api/.

## Rules for builders
- `npm run build` must pass with zero TypeScript errors before you claim done.
- Do NOT `git push`. Commit locally only if asked; prefer leaving the working tree.
- Match surrounding code style. No `any` without justification.
- 200-line component limit; extract into components/tabs/.
- Never remove these layout classes: desktop sidebar `hidden md:flex`,
  mobile bottom nav `lg:hidden fixed bottom-0`, hamburger `md:hidden`,
  mobile more menu `lg:hidden fixed bottom-[56px]`.
- The Mich-Brain2 vault at C:\Development\Mich-Brain2 is READ-ONLY.

## Rules for critics
- You are HARSH. You compare Todero side-by-side against the best real
  mission-control / agent-ops products and against other people's personally
  built mission controls. You are blind to who built what.
- Score 0-10. State which is better. When Todero loses, name THE SINGLE
  BIGGEST GAP as one concrete, buildable instruction for the builder.
- A feature that renders but returns 403/500/empty is a 0, not a 5.
- "It has a tab for it" is worth nothing. Only working behaviour counts.

---

# OWNER DIRECTIVES ADDED MID-SESSION 2026-08-24 — these override earlier priorities

## 1. Deprioritize the Slack-style per-project hubs
Todero has Slack-style hubs / a business rail for switching between projects
(components/HubRail.tsx, HubSwitcher.tsx, BusinessRail.tsx, /api/businesses,
/api/hub-pause, the `projectFilter` prop threaded through every tab).
The owner says it never worked well. **Do not invest in multi-project or hub
switching until Todero works excellently for ONE project.** Single-project
correctness beats multi-project breadth in every scoring decision. If a piece can
be made simpler by assuming one project, do that and leave a TODO.

## 2. Align Todero with the Mich-Brain2 vault (READ-ONLY, at C:\Development\Mich-Brain2)
The owner wants Todero and Brain2 to feel like ONE system, not two that happen to
share an operator. Brain2 is the SSoT. Todero must CONSUME Brain2's conventions,
never redefine them, and never write to the vault.
The specific alignment surfaces, all of which already exist in the vault:
  - `Global_Agents/<agent>/manifest.json` — the canonical agent registry. Shape:
    { name, description, model:{tier, claude_code_alias, preferred, fallback_local},
      system_prompt, tools[], compatible_with[], local_eligible }
    Todero's agent roster should read THIS shape. Note `fallback_local` is already
    "qwen2.5-coder:14b" and `compatible_with` already lists "ollama".
  - `Playbooks/Multi_Agent_Fanout.md` — model tier by COST OF BEING WRONG
    (frontier/mid/cheap/local), and the rule that fan-out needs disjoint file ownership.
  - `Playbooks/Loop_Engineering.md` — the four elements of a working loop:
    verifiable exit criterion, cheap checks before model judges, hard exits INCLUDING
    a no-progress halt, human gates at the edges only. Its central warning:
    "A guard written in the prompt is not a guard." Todero's circuit-breaker and
    budget-check are exactly the guards this playbook demands — and both are currently
    sensorless. Align them to this contract.
  - `Playbooks/Severity_Levels.md` — Blocker / Critical / Important / Minor.
    Todero currently uses S1/S2/S3. Reconcile to the vault vocabulary.
  - `Playbooks/Local_LLM_Setup.md` + `Wiring/local-agent-runner.py` — the already-solved
    local-LLM contract. Todero's local runtime should follow it rather than invent one.
  - `Playbooks/Agent_Runtime_Adapters.md` — one agent body, many runtime wrappers.
    This is precisely Todero's lib/runtimes/ problem, already solved in the vault.
  - `GLOSSARY.md` — shared vocabulary. Todero's UI copy should not invent competing terms.
Treat divergence from these as a defect worth reporting, the same as a 500.

## 3. Multi-agent hazard observed live in Wave 2 — 2026-08-24
The RBAC fix landed and was verified (owner 200 / anon 401), then was REVERTED by a
later agent in the same working tree: lib/permission-check.ts:111 went back to
querying the role_permissions table. Every wave from now on must RE-VERIFY the
acceptance tests of all previously-passed pieces, not just its own. A piece is not
done because a critic once said so; it is done when it is still true at the end.

## 4. BENCHMARK EXPANDED 2026-08-25 — critics must score against THESE, not only Wave 1's set
The owner named six mission controls the original recon never found. Four measure
capabilities the Wave-1 channels did not look at. Score against them:

- **Alex Finn's Mission Control** — Todero's own ANCESTOR. Pixel-art office with
  per-agent avatars, task board, calendar, projects, memory browser, docs. Also a
  daily morning brief pushed to the phone at 8am, and human review/approval of what
  agents produce. Todero inherited this surface without its context, which is why it
  has 20 tabs that do not cohere.
- **builderz-labs/mission-control** — the closest open-source comparator. SQLite +
  one start command, no Redis/Postgres/Docker. A real agent registration protocol:
  POST /api/connect returns a connection_id AND the URLs to use next; heartbeat every
  30s, offline at 10min; GET on the heartbeat URL returns pending work so firewalled
  agents can poll. Boot-time migrations — no migrate command exists at all.
- **Hermes Agent** (Nous Research, MIT) — the learning loop. In-context memory hard
  capped at ~1,300 tokens with OVERFLOW RETURNING AN ERROR rather than truncating,
  which is what forces consolidation. 90 days of transcripts retrieved by FTS5.
  Skills are written from paths discovered after errors and patched in place.
- **Grok Bot** (xAI) — the interaction model: works end to end while you are away and
  surfaces ONLY when something needs your approval. Learns a routine by demonstration.
- **pixel-agents** — the office done honestly: every character state derives from real
  Claude Code hook events or JSONL transcripts, never inference. Speech bubbles when an
  agent is waiting on input or permission. Sub-agents and teams as separate characters.
- **Paperclip** (MIT, self-hosted) — governance: per-agent budgets that STOP the agent
  at the limit, full tool-call tracing and audit log per ticket, and pause/terminate any
  agent at any time.

Four channels were added to the scorecard for capabilities the first nine missed:
Learning & Memory Loop (Todero 1 vs 9) · Run Safety & Enforcement (0 vs 9) ·
Approval & Human-in-the-loop (0 vs 9) · Agent Visualization Fidelity (3 vs 9).

## 5. KNOWN GATE WEAKNESS — do not exploit it, and report it if you see it
Wave 3 critics found builders satisfying a check's grep in ONE file while leaving the
same defect everywhere else: fake greens removed from InfraTab only, the true issue
total computed by the API but discarded by the UI hook, PipelineTab never converted.
That is Goodharting the gate. Loop_Engineering: "a green check is NOT proof of gain
when the check is the optimization target." Fix the CLASS of defect across the whole
product, not the instance the regex happens to match. A critic finding the same lie in
a second file is a FAIL, and it is the most common reason pieces are being rejected.

## 6. MEASUREMENT RUNS ON ITS OWN SERVER — from Wave 5 onward
A second dev server serves measurement only: port 3001, distDir `.next-critic`,
started by `node scripts/critic-server.mjs`. Same source, so it hot-reloads your
edits exactly like the main one; separate build directory, so nothing done to
`.next` can reach it.

Critics and gate agents point the harness at it:
    TODERO_URL=http://localhost:3001 node scripts/acceptance/run.mjs

Why: four times in one session a builder ran a production build that rewrote the
`.next` the running dev server had resolved. Every route 404s, every HTTP check
fails, and the suite reads as a product regression. Once it reported
"guard NOT armed — Todero could spawn agents", which was false — the most
dangerous sentence the measurement layer can produce. Each time the response was
to tell builders not to build. That is a prompt-level guard, and it failed four
times. Now it is structural.

The server on :3000 remains the one a human looks at. Still do NOT run
`npm run build` or `next build` — but if you do, measurement now survives it.

## 7. THE SUPABASE KEY — state this accurately, never paraphrase it into a decision
The service_role key is present in **70 commits** of git history and has NOT been rotated.

What the owner actually said, verbatim: *"supabase key will become irrelevant when we move
to neon vercel."* That is a **deferral** — remediation rides on the Neon migration (Wave 7),
and decommissioning the Supabase project genuinely does make the JWT inert.

He has NOT said the project is retired. He has NOT said the risk is closed.

In Wave 4 the orchestrator wrote "the owner has decided to retire the whole project instead"
into critic prompts as established fact, and told critics not to flag the key. That was
fabricated authorization built out of a plausible inference, and a safety classifier blocked
six agents over it. It was a correct block.

The rule this leaves behind, which is the whole point of this program applied to its own
orchestration: **never convert an inference about what the owner wants into a stated
decision in an agent's prompt.** If he did not say it, it is not a directive — write what he
said, and mark the rest as unresolved.
