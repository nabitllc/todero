// ─── lib/memory-budget.ts — the always-in-context budget, as a pure function ──
//
// memory-cards piece (docs/rebuild/pieces/pieces6/memory-cards.md).
//
// `design/Memory.dc.html` puts a token bar at the top of the Memory
// destination: how much of the context window every spawn pays for before it
// has read a single line of the task. That number is not decorative and it is
// not new — `loadIdentityContext()` in app/api/run-agent/route.ts already
// assembles exactly those sections and already applies exactly this budget
// discipline on every dispatch. What did not exist was any way to SEE it.
//
// This module is that computation, extracted so a client component can run it
// over the same rows the server reads. It is deliberately:
//
//   * PURE — no `fs`, no `better-sqlite3`, no `db()`. `lib/memory-retrieval.ts`
//     and `lib/memory-loop.ts` are both SERVER ONLY (they reach for node
//     builtins at module scope), so a 'use client' card cannot import either.
//     Importing this one is safe in both environments.
//   * A MIRROR, not a second opinion. Section headers, ordering, the token
//     estimate and the selection rule are copied from `loadIdentityContext`
//     line for line. `lib/__tests__/memory-budget.test.ts` re-reads BOTH source
//     files and fails when either drifts — the only thing keeping a mirror
//     honest is a test that breaks when the original moves.
//
// Nothing here invents a number. Every token figure is measured from content
// this app actually stores; a row that is not present contributes nothing, and
// a caller with no rows at all gets an empty section list, not a placeholder.

/**
 * Mirrors `CONTEXT_BUDGET_TOKENS_DEFAULT` in lib/memory-retrieval.ts — the
 * per-task RETRIEVAL budget, ~1,300 tokens, kept small on purpose so a spawn
 * does not pay context for every past correction on every task.
 *
 * NOT importable from there: that module opens sqlite. Duplicated here and
 * pinned by `memory-budget.test.ts`, which imports the real constant and fails
 * on any divergence.
 *
 * CAVEAT the UI must render: `TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS` overrides
 * this on the server, and no endpoint reports the effective value — so a
 * browser can only ever show the built-in default, and must say so.
 */
export const RETRIEVAL_BUDGET_TOKENS_DEFAULT = 1_300

/**
 * Mirrors `IDENTITY_CONTEXT_BUDGET_MULTIPLIER` in app/api/run-agent/route.ts.
 * Identity docs are static guidance read once per spawn rather than per-task
 * retrieval, so they get a larger allowance than the retrieval budget.
 */
export const IDENTITY_CONTEXT_BUDGET_MULTIPLIER = 6

/** The always-in-context ceiling: 6 x 1,300 = 7,800 tokens by default. */
export function identityBudgetTokens(
  retrievalBudget: number = RETRIEVAL_BUDGET_TOKENS_DEFAULT,
): number {
  return retrievalBudget * IDENTITY_CONTEXT_BUDGET_MULTIPLIER
}

/**
 * The same deliberately-conservative ~4-bytes-per-token estimate
 * `lib/memory-retrieval.ts` uses. UTF-8 BYTE length, not `.length`, so
 * multi-byte text is not under-counted. `TextEncoder` rather than `Buffer` so
 * this runs unchanged in a browser.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4)
}

/** Which of `loadIdentityContext`'s five section kinds a row became. */
export type SectionKind = 'soul' | 'agent-soul' | 'handbook' | 'skill' | 'daily'

/** One `agent_documents` row, as `/api/db/agent_documents?select=...` returns it. */
export interface ContextDoc {
  agent_id: string
  doc_type: string
  slug: string
  content: string | null
}

/** One `agent_memory_files` row, as `/api/db/agent_memory_files?select=...` returns it. */
export interface ContextMemoryFile {
  agent_id: string
  memory_type: string
  date_key: string | null
  content: string | null
}

/** One assembled identity section — the unit the budget is spent in. */
export interface IdentitySection {
  /** The section's own header text, exactly as it appears in the spawn prompt. */
  label: string
  kind: SectionKind
  tokens: number
  /** Where this section's bytes came from, for the card's provenance line. */
  source: string
}

/** Segment colours are the caller's business; this is the ordering the bar follows. */
export const SECTION_KIND_ORDER: SectionKind[] = ['soul', 'agent-soul', 'handbook', 'skill', 'daily']

/**
 * Rebuild the identity sections `loadIdentityContext(agentId)` would assemble,
 * in the same order, from rows already fetched by the caller.
 *
 * Selection rules copied from that function:
 *   - global soul  : agent_id = 'global',  doc_type = 'soul'
 *   - agent soul   : agent_id = agentId,   doc_type = 'soul'
 *   - handbook     : agent_id = 'global',  doc_type = 'agents'
 *   - skills       : doc_type = 'skill' AND agent_id in (agentId, 'skill')
 *                    — note that a `global` skill doc is NOT loaded unless the
 *                    agent literally is 'global'; that asymmetry is the
 *                    server's, reproduced rather than corrected here.
 *   - daily notes  : memory_type = 'daily', agent_id in ('global', agentId),
 *                    date_key in (today, yesterday), newest date first.
 *
 * `today`/`yesterday` are parameters rather than read from the clock so the
 * whole computation is deterministic under test.
 */
export function composeIdentitySections(
  agentId: string,
  docs: ContextDoc[],
  dailyFiles: ContextMemoryFile[],
  today: string,
  yesterday: string,
): IdentitySection[] {
  const sections: IdentitySection[] = []
  const push = (label: string, kind: SectionKind, content: string, source: string) => {
    sections.push({ label, kind, tokens: estimateTokens(`${label}\n\n${content}`), source })
  }

  const globalSoul = docs.find(d => d.agent_id === 'global' && d.doc_type === 'soul')
  if (globalSoul) push('# SOUL', 'soul', globalSoul.content ?? '', `agent_documents · global/soul/${globalSoul.slug}`)

  const agentSoul = docs.find(d => d.agent_id === agentId && d.doc_type === 'soul')
  if (agentSoul) push(`# ${agentId.toUpperCase()} SOUL`, 'agent-soul', agentSoul.content ?? '', `agent_documents · ${agentId}/soul/${agentSoul.slug}`)

  const handbook = docs.find(d => d.agent_id === 'global' && d.doc_type === 'agents')
  if (handbook) push('# AGENTS HANDBOOK', 'handbook', handbook.content ?? '', `agent_documents · global/agents/${handbook.slug}`)

  for (const skill of docs.filter(d => (d.agent_id === agentId || d.agent_id === 'skill') && d.doc_type === 'skill')) {
    push(`# SKILL: ${skill.slug}`, 'skill', skill.content ?? '', `agent_documents · ${skill.agent_id}/skill/${skill.slug}`)
  }

  const daily = dailyFiles
    .filter(m => m.memory_type === 'daily')
    .filter(m => m.agent_id === 'global' || m.agent_id === agentId)
    .filter(m => m.date_key === today || m.date_key === yesterday)
    .sort((a, b) => (b.date_key ?? '').localeCompare(a.date_key ?? ''))
  for (const m of daily) {
    push(`# DAILY MEMORY (${m.date_key})`, 'daily', m.content ?? '', `agent_memory_files · ${m.agent_id}/daily/${m.date_key}`)
  }

  return sections
}

/**
 * What the budget pass decided. `overflow` is the read-side equivalent of the
 * server THROWING `RetrievalBudgetExceededError`: the very first section does
 * not fit on its own, so the spawn would raise instead of loading a truncated
 * identity. A card seeing this must render the error, not a bar.
 */
export interface BudgetSelection {
  selected: IdentitySection[]
  /** Sections that did not fit — kept, named and costed, never silently discarded. */
  dropped: IdentitySection[]
  usedTokens: number
  budgetTokens: number
  overflow: { label: string; tokens: number } | null
}

/**
 * The same whole-section discipline `loadIdentityContext` applies:
 *
 *   - the FIRST section, alone over budget, is a hard stop
 *     (`RetrievalBudgetExceededError` server-side) — reported here as
 *     `overflow`, with nothing selected;
 *   - any later section that would push the total over budget is DROPPED and
 *     recorded, and the scan CONTINUES, so one oversized skill doc mid-list
 *     cannot silently exclude every smaller section behind it.
 *
 * Never truncates a section's text to fit. That is the whole point.
 */
export function selectWithinBudget(
  sections: IdentitySection[],
  budgetTokens: number,
): BudgetSelection {
  const selected: IdentitySection[] = []
  const dropped: IdentitySection[] = []
  let usedTokens = 0

  for (const section of sections) {
    if (selected.length === 0 && section.tokens > budgetTokens) {
      return { selected: [], dropped: [], usedTokens: 0, budgetTokens, overflow: { label: section.label, tokens: section.tokens } }
    }
    if (usedTokens + section.tokens > budgetTokens) {
      dropped.push(section)
      continue
    }
    selected.push(section)
    usedTokens += section.tokens
  }

  return { selected, dropped, usedTokens, budgetTokens, overflow: null }
}

/** One bar segment: a kind, its measured cost, and how many sections produced it. */
export interface BudgetSegment {
  kind: SectionKind
  label: string
  tokens: number
  sections: number
  /** Share of the WHOLE budget (not of the used portion) — the bar is drawn against the ceiling. */
  percentOfBudget: number
}

const KIND_LABEL: Record<SectionKind, string> = {
  soul: 'global soul',
  'agent-soul': 'agent soul',
  handbook: 'agents handbook',
  skill: 'skills loaded',
  daily: 'daily notes',
}

/**
 * Collapse the selected sections into one segment per kind, in
 * `SECTION_KIND_ORDER`. Kinds with no selected section are omitted entirely —
 * a zero-width segment with a legend entry would read as "this exists and is
 * tiny" when the truth is "no such row exists".
 */
export function summarizeSelection(selection: BudgetSelection): BudgetSegment[] {
  const out: BudgetSegment[] = []
  for (const kind of SECTION_KIND_ORDER) {
    const inKind = selection.selected.filter(s => s.kind === kind)
    if (inKind.length === 0) continue
    const tokens = inKind.reduce((sum, s) => sum + s.tokens, 0)
    out.push({
      kind,
      label: KIND_LABEL[kind],
      tokens,
      sections: inKind.length,
      percentOfBudget: selection.budgetTokens > 0 ? (tokens / selection.budgetTokens) * 100 : 0,
    })
  }
  return out
}

/** Remaining budget — never negative, because `selectWithinBudget` never overspends. */
export function headroomTokens(selection: BudgetSelection): number {
  return Math.max(0, selection.budgetTokens - selection.usedTokens)
}

/**
 * "in 4 minutes" / "3h ago" / "" for an unparseable or absent timestamp.
 * Returns the empty string rather than a guess so a caller can decide what to
 * print when a row has no `created_at` — the Fleet lesson: a missing time must
 * not render as a plausible age.
 */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const deltaSec = Math.round((now - t) / 1000)
  const abs = Math.abs(deltaSec)
  const unit =
    abs < 60 ? `${abs}s` :
    abs < 3600 ? `${Math.floor(abs / 60)}m` :
    abs < 86400 ? `${Math.floor(abs / 3600)}h` :
    `${Math.floor(abs / 86400)}d`
  return deltaSec >= 0 ? `${unit} ago` : `in ${unit}`
}
