# PIECE: Read AGENTS.md from the repo instead of a directory that does not exist

id: agents-api
baseline score: 0/10
effort: S

## Why this piece matters
Cheapest high-leverage fix in the wave. One line causes a hard 500 that makes liveAgents permanently null, which silently degrades the Crew tab, the Office roster and three call sites in app/page.tsx to a hardcoded 4-agent array that contradicts live data. The file it wants is already committed at the repo root.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Change app/api/agents/route.ts:43 from `join(process.env.HOME ?? '/Users/kemuniagent', 'kaos-config', 'AGENTS.md')` to `process.env.AGENTS_MD_PATH ?? join(process.cwd(), 'AGENTS.md')`. When the file is genuinely absent, return HTTP 200 with an empty roster plus a `warning` field naming the path it looked in — never a 500 — so consumers can render 'no agents configured' honestly instead of falling back to fiction. Also fix the 5.19s response time by not retrying the failed read. Then delete the ALL_AGENTS fallback at app/page.tsx:334 so a failed roster fetch shows an error, not four invented agents.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app: (1) `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/agents` -> 200 in under 1s; (2) the body lists more than 4 agents, including ops and deployer, matching the roster in the repo's AGENTS.md; (3) with AGENTS_MD_PATH pointed at a nonexistent file, the response is 200 with an empty roster and a warning naming that path, and the Team tab renders an explicit empty state rather than KAOS/Builder/Tester/Scout.
