# PIECE: No tab may render an empty state over a non-ok response

id: ui-error-surfacing
baseline score: 0/10
effort: M

## Why this piece matters
Highest leverage single UI fix in the repo: one shared anti-pattern causes five separate tabs to lie. It is also the piece that makes every subsequent audit trustworthy — while tabs render '0 issues' over a 403, a critic cannot tell a fixed feature from a broken one, and the owner cannot tell a working system from a dead one. It directly implements the brief's 'no pretending' rule.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Replace the shared pattern `.then(r=>r.json()).then(d => setIssues(Array.isArray(d)?d:d?.data??[]))` with a check on res.ok before parsing, in components/tabs/IssuesTab.tsx:49-52, FeaturesTab.tsx:65, EpicMapTab.tsx:48-56 (which wraps in `if (res.ok)` and silently leaves arrays empty), ProductBoardTab.tsx:167 and ProjectsTab.tsx:35. Extract it into one shared hook (e.g. hooks/useApiData.ts) that returns {data, error, status} and have every tab render a visible red banner reading 'data unavailable — <status> from <endpoint>: <server message>' instead of falling through to an empty state. Give BoardTab's createTask/updateTask/deleteTask (components/tabs/BoardTab.tsx:304-317) an else branch that reads the API error body, reverts the optimistic setTasks, and raises a toast — currently handleDrop calls setTasks unconditionally so a card moves even when the PATCH returned 403. n8n's per-node input/output view is the standard: the operator always sees what actually came back.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app, with a temporary server-side block returning 403 for /api/issues: loading /issues, /features, /epic-map, /product-board and /projects each renders a visible error banner containing the status code and the server's message, and NONE of them shows 'No issues found', '0 features', 'No epics found' or a zero count. Then with the block removed and RBAC fixed, all five render real data as owner. Separately: monkey-patch fetch to 403 all PATCH /api/issues, drag a card on /board — the card must snap back to its original column and a toast must appear.
