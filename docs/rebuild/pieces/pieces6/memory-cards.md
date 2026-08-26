# PIECE: Memory — a learning loop that says what it actually knows

id: memory-cards
lane: Operator
channel: Learning & Memory Loop (1 -> 9)

OWNS EXCLUSIVELY: components/tabs/MemoryTab.tsx,
components/tabs/MemoryBudgetCard.tsx (new), lib/memory-budget.ts (new),
lib/__tests__/memory-budget.test.ts (new),
docs/rebuild/pieces/pieces6/memory-cards.md (this file)

DO NOT TOUCH: app/page.tsx, components/nav/**, app/api/**,
components/tabs/CrewTab.tsx, components/tabs/OfficeTab.tsx,
components/tabs/WorkViewCard.tsx, components/tabs/OverviewTab.tsx,
lib/bolt-time.ts, scripts/**, migrations/** — settled or owned elsewhere.

## Why

`design/Memory.dc.html` specifies the one surface where this app is supposed to
show its own learning loop: what it tried, what it now knows, and how much of
that it can afford to carry into every spawn. The app today ships none of it.
`components/tabs/MemoryTab.tsx` is a two-pane Markdown file browser over
`GET /api/memory` — a daily journal viewer. It has no budget, no run records,
no skills, and no statement of the vault rule.

Meanwhile the machinery the artboard depicts is **real and already built**:

| Artboard element | Real source in this repo |
|---|---|
| the token ceiling | `lib/memory-retrieval.ts` `CONTEXT_BUDGET_TOKENS_DEFAULT = 1_300` |
| "always-in-context" | `loadIdentityContext()` in `app/api/run-agent/route.ts`, budget `getContextBudgetTokens() * IDENTITY_CONTEXT_BUDGET_MULTIPLIER (6)` = 7,800 |
| "agent body" | `agent_documents` rows `doc_type in (soul, agents)` |
| "skills loaded" | `agent_documents` rows `doc_type = 'skill'` |
| "retrieved records" | `agent_run_records`, ranked by `buildRetrievedContext()` |
| "overflow raises an error" | `RetrievalBudgetExceededError` (`lib/memory-retrieval.ts`) |
| "goes to `_pending/`" | `draftSkillProposal()` (`lib/memory-loop.ts`) |

So the gap is not that the numbers are unknowable. It is that nothing renders
them, and the previous surface renders a *different* thing (journal files) as
if it were the memory system.

The second half of the gap is the honesty half. Several artboard figures have
**no read-only source in this codebase**, and this piece must render their
absence rather than a plausible substitute. Those are enumerated in
§"Unsourceable" below and each one has an acceptance item.

## Build instruction

### 1. Memory becomes cards, on the `components/nav/Card.tsx` contract
One question per card title, one number from a real query, the query printed in
the card's `source`, an empty state that names its subject, and an error that
**replaces** the body. No card may render a count or a bar while its own
request failed.

### 2. The budget card is the signature control
`components/tabs/MemoryBudgetCard.tsx` renders the always-in-context budget for
one selected agent, as `loadIdentityContext()` actually computes it:

- sections built in the same order and with the same headers
  (`# SOUL`, `# <AGENT> SOUL`, `# AGENTS HANDBOOK`, `# SKILL: <slug>`,
  `# DAILY MEMORY (<date>)`),
- token estimate by the same rule (`ceil(utf8 bytes / 4)`),
- the same selection discipline: the first section alone over budget is a
  raised `RetrievalBudgetExceededError`, any later section that does not fit is
  **dropped by name**, and selection continues past it.

The shared math lives in `lib/memory-budget.ts` (pure, no node builtins, so a
client component can import it) and is unit-tested.

The bar's ceiling is the **identity** budget (7,800 = 6 x 1,300), not 1,300.
The artboard's single 1,300-token bar covering agent body + skills + retrieved
records does not exist in this codebase: identity and retrieval have two
separate budgets, and retrieval's is per-task, not always-in-context. Render
both, labelled, rather than merging them into a number nobody computes.

### 3. Say what it tried — from `agent_run_records`, columns only
Task, when, the rejection reason, the reviewer notes, the attempt text, the
agent, and the record's own id as the run id. No field may be synthesised.

### 4. Skills — from `agent_documents where doc_type = 'skill'`
Each row is `active` by definition: a skill doc in that table is loaded into
every matching spawn's identity context. There is no `proposed` row type in
this database, and no endpoint lists the vault's `_pending/skill-updates/`
directory, so a proposed-skill list cannot be rendered. Say that; do not
invent one.

### 5. The vault rule, with a real path
`GET /api/agents` returns `vaultPath` — the `Global_Agents` directory actually
scanned on this host, or `null` when the vault is absent. Derive and render the
vault root from it, plus the fixed relative outbox `_pending/skill-updates/`
from `draftSkillProposal()`, plus the rule: Todero drafts there and never
approves its own proposal. When `vaultPath` is `null`, say the vault is not
mounted instead of printing a path that does not exist.

## Unsourceable — rendered as absent, not as a number

1. **"1,204 records · 9 skills · 2 proposed"** — the record and skill counts are
   real queries (rendered as such); **`2 proposed` has no read-only source** and
   is rendered as an explicit "not exposed" instead of a count.
2. **"seen 4x"** (pattern recurrence) — computed only inside
   `promoteHotPatterns()`, which WRITES (a HOT-tier row and a vault proposal).
   A render must not trigger it. The real per-row `rejection_count` column is
   rendered instead, under its own name.
3. **"what WORKED"** — `agent_run_records` has `attempted`, `rejection_reason`,
   `reviewer_notes`, and a boolean `succeeded`. There is **no free-text column
   recording what worked**. The boolean is rendered; the missing text is stated.
4. **The effective token ceiling** — `TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS` can
   override 1,300 on the server and **no endpoint reports the effective value**.
   The ceiling is labelled as the built-in default with that caveat.
5. **`agent_documents` / `agent_memory_files` totals** — `/api/db/<table>` has no
   count envelope, so a fetch that comes back at its own row cap must be
   reported as a bounded scan, not as a total.

## ACCEPTANCE — verified against the RUNNING app

Server already running at http://localhost:3000. Do NOT restart it, NEVER run
`npm run build`. Auth: `cookie: mc-auth=kaos2026; mc-role=owner`. URL:
`/b/todero/p/limiglow/memory/memory`. Every populated claim needs a FIXTURE
inserted into `./db.sqlite`, observed, then REMOVED and the removal confirmed.

1. **Cards, not panes.** Every section of the Memory destination renders inside
   `components/nav/Card.tsx`: a `<section>` with a `<button aria-expanded>`
   header, a printed `source` line, and a collapse that survives a page reload
   (localStorage key `todero:now-card-collapsed:<id>`). Name each card id and
   show one collapse persisting across a reload.
2. **Zero is rendered as zero, in words.** With `agent_documents`,
   `agent_memory_files` and `agent_run_records` all empty, quote the exact
   on-screen strings. No card may show a non-zero count, a filled bar segment,
   or a record row. Each empty state names its own table.
3. **The ceiling is 7,800 and it is derived, not typed.** Show the rendered
   ceiling string and show `lib/memory-budget.ts` computing it as
   `RETRIEVAL_BUDGET_TOKENS_DEFAULT * IDENTITY_CONTEXT_BUDGET_MULTIPLIER`.
   A test must fail if either constant drifts from
   `lib/memory-retrieval.ts`'s `CONTEXT_BUDGET_TOKENS_DEFAULT` or from
   `app/api/run-agent/route.ts`'s `IDENTITY_CONTEXT_BUDGET_MULTIPLIER`.
   Prove the test fails by mutating the local constant.
4. **The bar is measured.** Insert `agent_documents` fixtures with known byte
   lengths (a global `soul`, an `agents` handbook, a `skill`) and one
   `agent_memory_files` daily row. Show the rendered per-segment token numbers
   equal `ceil(utf8_bytes_of("# HEADER\n\n" + content) / 4)` computed by hand
   for each fixture, and that the segment widths are those numbers over 7,800.
5. **Overflow is named, never silent.** With a budget small enough to overflow:
   (a) a later section that does not fit is listed by its section label with its
   token cost, and selection continues to a smaller section after it (prove the
   smaller one is still selected); (b) when the FIRST section alone exceeds the
   budget the card renders the raised-error state naming
   `RetrievalBudgetExceededError`, and renders no bar. Both are unit-tested and
   at least (a) is shown on screen.
6. **The two budgets are not merged.** The rendered text distinguishes the
   always-in-context identity budget (7,800) from the per-task retrieval budget
   (1,300) and states that retrieval is loaded per task. Quote both strings.
7. **`2 proposed` is rendered as absent.** Quote the exact on-screen string; it
   must contain neither a count of proposals nor a fabricated list. Grep the two
   component files for the literal `proposed` and show every occurrence is
   either a column-free explanation or the word inside that explanation.
8. **Records come from columns.** Insert one `agent_run_records` fixture with
   known `task_key`, `rejection_reason`, `reviewer_notes`, `rejection_count`,
   `succeeded`. Show every rendered field traces to a column, that the run id
   shown is the row's own `id`, and that the card states no column records what
   worked.
9. **Skills come from `agent_documents`.** Insert one `doc_type='skill'` row and
   show it rendered with its slug, its scope (`skill` = shared vs a per-agent
   id), and its measured token cost. Show the card states the database has no
   `proposed` skill row type.
10. **The vault path is read, not typed.** Show the rendered vault outbox string
    matches the root derived from `GET /api/agents` -> `vaultPath`
    (`C:\Development\Mich-Brain2\Global_Agents` on this host). Grep both
    component files: no hardcoded absolute vault path may appear.
11. **Errors replace bodies.** For each card, make its request fail (403 via a
    stripped auth cookie, or an unreachable endpoint) and show
    `data unavailable — <status> from <endpoint>` rendered by
    `ApiErrorBanner` **in place of** the body. No empty state and no count may
    render at the same time.
12. **Fixtures removed.** Show the `DELETE` for every fixture and a follow-up
    `SELECT COUNT(*)` returning 0 for each table touched.
13. **Gates.** `npx tsc --noEmit` clean; `npx jest lib/__tests__/memory-budget.test.ts`
    green; `node scripts/no-silent-empty.mjs` clean;
    `node scripts/acceptance/run.mjs` reports 45/45 in about 4s (slower or
    mass-failing means the SERVER is unhealthy — say so, do not "fix" it here).
