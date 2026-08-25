# PIECE: Remove the Supabase service_role key from the browser bundle

id: client-service-role-key-leak
baseline score: 0/10
effort: M

## Why this piece matters
A live credential exposure, not a code-smell: seven 'use client' components embed a JWT with role=service_role for the production database, and it is retrievable from .next/static/chunks with curl and no cookies. The app is served publicly through a Cloudflare tunnel at kaos.nabit.work. Anyone who reaches the origin has full read/write/delete on production Postgres. The team's own backlog item TOD-1993 for this is still open.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Delete the SUPA_URL/SUPA_KEY constant pairs from all seven client components: components/tabs/PipelineTab.tsx:6-8, components/tabs/OverviewTab.tsx:15 and :55, components/tabs/ActivityTab.tsx, components/ActiveAgentsCard.tsx, components/AgentOfficeCore.tsx, components/office/officeConstants.ts and components/SearchOverlay.tsx. Repoint every direct PostgREST call behind a server route — PipelineTab's fetchIssues()/moveToColumn() (lines 77-80, 111-112) go to GET/PATCH /api/issues so they inherit the MC API's lifecycle validation and Discord notifications rather than bypassing them. Move SUPABASE_SERVICE_ROLE_KEY to a server-only env var that is never imported from a file carrying 'use client', and add a CI grep that fails the build if the string 'service_role' or the JWT prefix appears anywhere under components/ or in .next/static. Then rotate the key in Supabase — the old one must be treated as compromised. Every benchmark product (Langfuse, Helicone, Mission Control) keeps privileged credentials server-side without exception.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app: (1) `npm run build` then `curl -s http://localhost:3000/_next/static/chunks/app/page.js | grep -c service_role` -> 0; (2) `grep -rn 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' components/` -> no matches; (3) the Pipeline tab at http://localhost:3000/pipeline still renders its real backlog issues while the browser network panel shows requests to /api/issues and ZERO requests to any *.supabase.co host; (4) a drag on the Pipeline board still persists after reload.
