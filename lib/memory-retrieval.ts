// memory-loop-retrieval piece — the read half of the learning loop TOD-489
// only half-built. `lib/memory-loop.ts` (memory-loop-write) records what an
// agent attempted and why it was rejected, one row per run in
// `agent_run_records`, and consolidates repeating patterns into a capped
// self_improving HOT tier. Nothing ever SEARCHED the run-record store itself
// — `scripts/spawn-context.sh` instead injected `self-improving/corrections.md`
// wholesale: every correction ever written, uncapped, unranked, on every
// spawn regardless of what the task actually was.
//
// Hermes Agent's structural decision (see the comparator analysis this piece
// was scoped from): the always-in-context budget is small on purpose — ~1,300
// tokens — and everything else is retrieved ON DEMAND, ranked, when it is
// relevant to the task at hand. This module is that retrieval: FTS5 search
// over `agent_run_records` (real ranking, sqlite provider — see
// `migrations/sqlite/041_agent_run_records_fts.sql`), a portable keyword-
// overlap fallback for the postgres/supabase providers FTS5 cannot reach
// (honestly labelled as such, not passed off as the same thing), and a hard
// token budget that RAISES when even the single most relevant record cannot
// fit inside it — never a silent truncation. That is the same discipline
// `memory-loop.ts`'s `PromotionBlockTooLargeError` already applies to the
// write side; `RetrievalBudgetExceededError` is its read-side counterpart.
//
// SERVER ONLY: reaches for `better-sqlite3` (lazily, like
// `lib/db/sqlite-adapter.ts` does) and the DB seam.

import { db, DB_PROVIDER } from './db'
import { sqlitePath } from './db/sqlite-adapter'

/**
 * Hermes caps its always-in-context memory at ~1,300 tokens. This is the same
 * number, kept small on purpose: retrieval exists precisely so a spawn does
 * not pay context budget for every past correction on every task — only the
 * handful actually relevant to THIS task. Override with
 * `TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS` for an install that wants more (or
 * less); the default stays small so nobody has to opt into the discipline.
 */
export const CONTEXT_BUDGET_TOKENS_DEFAULT = 1_300

/** Resolve the configured budget, falling back to the small default on anything unset or non-numeric. */
export function getContextBudgetTokens(): number {
  const raw = process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS?.trim()
  if (!raw) return CONTEXT_BUDGET_TOKENS_DEFAULT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CONTEXT_BUDGET_TOKENS_DEFAULT
}

/**
 * A rough, deliberately conservative token estimate (~4 bytes/token, the
 * usual English-text rule of thumb). This never needs to be exact — it only
 * needs to be a stable, monotonic proxy so the budget check below is
 * consistent from one run to the next. Byte length (not `.length`) so
 * multi-byte UTF-8 text is not under-counted.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

/**
 * Raised — never silently swallowed — when the single highest-ranked
 * matching record cannot fit inside the context budget on its own. Chopping
 * that record to fit is exactly the "silently truncated context is how an
 * agent loses the one record that mattered" failure this piece exists to
 * close, so this is a hard stop instead: the caller sees a named error naming
 * the record and the budget, and can raise the budget deliberately or
 * consolidate the record (the same fix `promoteHotPatterns()` already
 * performs on the write side) rather than losing it without noticing.
 */
export class RetrievalBudgetExceededError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly taskKey: string,
    public readonly blockingRecordKey: string,
    public readonly blockTokens: number,
    public readonly budgetTokens: number,
  ) {
    super(
      `buildRetrievedContext(${agentId}, ${taskKey}): the top-ranked matching record ` +
        `(${blockingRecordKey}) is ~${blockTokens} tokens, exceeding the context budget ` +
        `of ${budgetTokens} tokens on its own — refusing to silently truncate it. Raise ` +
        `TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS or consolidate that record via promoteHotPatterns().`,
    )
    this.name = 'RetrievalBudgetExceededError'
  }
}

export interface RetrievedRecord {
  id: string
  taskKey: string
  taskTitle: string | null
  attempted: string | null
  rejectionReason: string | null
  reviewerNotes: string | null
  createdAt: string | null
  /** Lower is more relevant, on both search paths (fts5's bm25() and the portable fallback's negated overlap score) — a shared convention so callers never need to branch on `engine`. */
  rank: number
}

export type RetrievalEngine = 'fts5' | 'keyword-overlap'

/** True when the active database provider is the sqlite adapter — the only one this repo can run real FTS5 search against directly. */
export function isSqliteProvider(): boolean {
  return DB_PROVIDER === 'sqlite'
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'was', 'were',
  'has', 'have', 'had', 'not', 'are', 'but', 'you', 'your', 'all', 'its',
])

/** Lowercase alphanumeric terms, 3+ chars, stopwords dropped, de-duplicated — shared by both search paths so their notion of "the query terms" agrees. */
function significantTerms(text: string): string[] {
  const terms = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  return Array.from(new Set(terms.filter(t => !STOPWORDS.has(t)))).slice(0, 12)
}

/**
 * FTS5 query string: each significant term double-quoted (so a term
 * containing an FTS5 operator character can never be parsed as query syntax)
 * and OR-ed together — "any of these terms", ranked by SQLite's own bm25().
 */
function toFtsMatchExpr(query: string): string | null {
  const terms = significantTerms(query)
  return terms.length > 0 ? terms.map(t => `"${t}"`).join(' OR ') : null
}

interface RawRunRecordRow {
  id: string
  task_key: string
  task_title: string | null
  attempted: string | null
  rejection_reason: string | null
  reviewer_notes: string | null
  created_at: string | null
}

/**
 * Real FTS5 search over `agent_run_records_fts`
 * (migrations/sqlite/041_agent_run_records_fts.sql), scoped to one agent.
 * Opens the same file `lib/db/sqlite-adapter.ts` serves the app's reads and
 * writes through (`sqlitePath()`), read-only — this module never mutates the
 * table. Degrades to an empty result (never throws) when the file or the FTS
 * table is not there yet: an unmigrated index must make retrieval return
 * nothing this run, not crash the spawn that asked for it.
 */
function searchSqliteFts(agentId: string, query: string, limit: number): RetrievedRecord[] {
  const matchExpr = toFtsMatchExpr(query)
  if (!matchExpr) return []

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('fs') as typeof import('fs')
  const file = sqlitePath()
  if (!existsSync(file)) return []

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const conn = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = conn
      .prepare(
        `SELECT r.id, r.task_key, r.task_title, r.attempted, r.rejection_reason, r.reviewer_notes, r.created_at,
                bm25(agent_run_records_fts) AS rank
         FROM agent_run_records_fts
         JOIN agent_run_records r ON r.rowid = agent_run_records_fts.rowid
         WHERE agent_run_records_fts MATCH ? AND r.agent_id = ?
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(matchExpr, agentId, limit) as Array<RawRunRecordRow & { rank: number }>
    return rows.map(r => ({
      id: r.id,
      taskKey: r.task_key,
      taskTitle: r.task_title,
      attempted: r.attempted,
      rejectionReason: r.rejection_reason,
      reviewerNotes: r.reviewer_notes,
      createdAt: r.created_at,
      rank: r.rank,
    }))
  } catch {
    // No such table (this database predates migration 041), a malformed MATCH
    // expression, or any other driver error — none of these should crash a
    // spawn over a search. Same "search is best-effort, never fatal" contract
    // Hermes's own `session_search` degrades under.
    return []
  } finally {
    conn.close()
  }
}

/**
 * Portable fallback for the postgres/supabase providers, which FTS5 (a
 * SQLite-specific virtual table type) cannot reach at all. Real ranking, not
 * a fake pass-through: scores each of the agent's recent run records by how
 * many of the query's significant terms appear in its text, keeps only
 * records that match at least one term, and breaks ties by recency. This is
 * genuinely weaker than FTS5's bm25 (term frequency / field length are not
 * weighted), and is labelled as such in `RetrievalResult.engine` rather than
 * silently presented as equivalent.
 */
async function searchPortable(agentId: string, query: string, limit: number): Promise<RetrievedRecord[]> {
  const terms = significantTerms(query)
  if (terms.length === 0) return []

  const { data, error } = await db()
    .from('agent_run_records')
    .select('id,task_key,task_title,attempted,rejection_reason,reviewer_notes,created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) return []

  const scored = (data as RawRunRecordRow[])
    .map(r => {
      const haystack = [r.task_key, r.task_title, r.attempted, r.rejection_reason, r.reviewer_notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0)
      return { r, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.r.created_at ?? '').localeCompare(a.r.created_at ?? ''))
    .slice(0, limit)

  return scored.map(({ r, score }) => ({
    id: r.id,
    taskKey: r.task_key,
    taskTitle: r.task_title,
    attempted: r.attempted,
    rejectionReason: r.rejection_reason,
    reviewerNotes: r.reviewer_notes,
    createdAt: r.created_at,
    // Negated so "lower is more relevant" holds on both paths without callers branching on `engine`.
    rank: -score,
  }))
}

export interface SearchResult {
  records: RetrievedRecord[]
  engine: RetrievalEngine
}

/**
 * Rank the agent's own past run records by relevance to `query` (typically
 * the task key + title being spawned for). Real FTS5 on the sqlite provider;
 * an honestly-labelled portable fallback everywhere else.
 */
export async function searchRunRecords(agentId: string, query: string, limit = 8): Promise<SearchResult> {
  if (isSqliteProvider()) {
    return { records: searchSqliteFts(agentId, query, limit), engine: 'fts5' }
  }
  return { records: await searchPortable(agentId, query, limit), engine: 'keyword-overlap' }
}

/** One retrieved record, formatted as a whole block — never partially, see `buildRetrievedContext`. */
function formatRecord(r: RetrievedRecord): string {
  const lines = [`### ${r.taskKey}${r.taskTitle ? ` — ${r.taskTitle}` : ''}`]
  if (r.attempted) lines.push(`Attempted: ${r.attempted}`)
  if (r.rejectionReason) lines.push(`Rejected because: ${r.rejectionReason}`)
  if (r.reviewerNotes) lines.push(`Reviewer notes: ${r.reviewerNotes}`)
  return lines.join('\n')
}

export interface RetrievalResult {
  /** Markdown block ready to inject into a spawn prompt. Empty string when nothing matched — not an error. */
  text: string
  recordsUsed: number
  recordsFound: number
  budgetTokens: number
  engine: RetrievalEngine
}

/**
 * The retrieval-at-spawn-time entry point: rank this agent's past run
 * records against the task being spawned for, then select whole records
 * (never a partial one) that fit inside the token budget.
 *
 * Budget discipline mirrors `memory-loop.ts`'s `trimToMemoryBudget` /
 * `PromotionBlockTooLargeError` pair exactly, on the read side instead of the
 * write side: once the running total would exceed the budget, selection
 * simply STOPS (lower-ranked records are left out, not chopped) — except for
 * the single top-ranked record, which is the one result nothing may silently
 * drop. If IT alone exceeds the budget, that is `RetrievalBudgetExceededError`,
 * raised rather than truncated, exactly as the piece brief specifies.
 */
export async function buildRetrievedContext(
  agentId: string,
  taskKey: string,
  taskTitle: string,
  opts: { limit?: number; budgetTokens?: number } = {},
): Promise<RetrievalResult> {
  const budgetTokens = opts.budgetTokens ?? getContextBudgetTokens()
  const limit = opts.limit ?? 8
  const query = [taskKey, taskTitle].filter(Boolean).join(' ')

  const { records, engine } = await searchRunRecords(agentId, query, limit)

  const blocks: string[] = []
  let usedTokens = 0
  for (const record of records) {
    const block = formatRecord(record)
    const blockTokens = estimateTokens(block)

    if (blocks.length === 0 && blockTokens > budgetTokens) {
      // Hard budget overflow on the single most relevant record: throw
      // rather than silently truncate it — this is the exact case the piece
      // brief names ("a silently truncated context is how an agent loses the
      // one record that mattered").
      throw new RetrievalBudgetExceededError(agentId, taskKey, record.taskKey, blockTokens, budgetTokens)
    }
    if (usedTokens + blockTokens > budgetTokens) break // whole lower-ranked records are left out, never chopped

    blocks.push(block)
    usedTokens += blockTokens
  }

  const text =
    blocks.length > 0
      ? `# RELEVANT PAST EXPERIENCE (${engine} search, ${blocks.length}/${records.length} match(es) fit, ~${usedTokens}/${budgetTokens} tokens)\n\n${blocks.join('\n\n')}`
      : ''

  return { text, recordsUsed: blocks.length, recordsFound: records.length, budgetTokens, engine }
}
