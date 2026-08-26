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
// Round 2 narrowed "cannot fit inside it" by exactly one term: the top
// record's `attempted` excerpt — this piece's own addition, and itself a
// bounded digest of a log file still on disk — is handed back first, clipped
// with a marker or dropped, and announced both in the injected text and in
// `RetrievalResult.attemptedRefit`. Only then does the budget raise. Nothing
// a human wrote is ever shortened. See `refitAttemptedToBudget` for the
// measured regression that forced it.
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

/**
 * `'available'` — the store was actually searched, whether or not anything
 * matched. `'unavailable'` — the search never happened because the store
 * itself could not be reached (sqlite file missing, `agent_run_records_fts`
 * table not there because migration 041 was never applied, the postgres
 * table missing, a query error from the driver). These two must never be
 * collapsed into the same "empty" result: "zero matches" is a fact about the
 * task, "unavailable" is a fact about the deployment, and a caller silently
 * treating the second as the first would report a clean negative it never
 * actually observed.
 */
export type RetrievalAvailability = 'available' | 'unavailable'

interface EngineSearchResult {
  records: RetrievedRecord[]
  availability: RetrievalAvailability
  /** Present only when availability is 'unavailable' — why the store could not be searched. */
  unavailableReason?: string
  /** Present only on the portable (keyword-overlap) engine — how many of the most recent rows it was able to look at. FTS5 has an index and is never window-bounded, so this stays undefined on that path. */
  scannedWindowRows?: number
  /** True when the scan returned exactly `scannedWindowRows` rows — the store may hold older records this scan never reached. False (not merely absent) when the store held fewer rows than the window, i.e. the scan genuinely saw everything. */
  possiblyIncompleteScan?: boolean
}

/**
 * How many of an agent's most recent run records the portable (postgres/
 * supabase) keyword-overlap fallback looks at per search. FTS5 has a real
 * index and needs no such cap; this engine has none, so it is bounded to
 * keep one search from scanning an agent's entire history. The bound is a
 * real limitation — see `possiblyIncompleteScan` — never a completed search
 * dressed up as one.
 */
export const PORTABLE_SCAN_WINDOW_ROWS = 200

/** True when the active database provider is the sqlite adapter — the only one this repo can run real FTS5 search against directly. */
export function isSqliteProvider(): boolean {
  return DB_PROVIDER === 'sqlite'
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'was', 'were',
  'has', 'have', 'had', 'not', 'are', 'but', 'you', 'your', 'all', 'its',
])

/**
 * An issue-key pattern like `TOD-2401`: a short (2-5 letter) alphabetic
 * prefix, a hyphen, then digits. The prefix is shared by EVERY record this
 * project has ever written (every task_key starts with the same project
 * code), so letting it act as a query term makes every record "match" every
 * other record regardless of what either is actually about — the defect a
 * round-4 critic caught: relevance was asserted, never measured. The numeric
 * half is just as useless as a term (it identifies one specific other
 * ticket, not a topic). Both halves are stripped before ranking; the full,
 * unstripped key is kept separately for an exact `task_key` retry-boost (see
 * `searchSqliteFts` / `searchPortable`) so a genuine retry of the same
 * ticket still finds its own history.
 */
const ISSUE_KEY_PATTERN = /\b([a-z]{2,5})-(\d+)\b/gi

/** Lowercase alphanumeric terms, 3+ chars, stopwords and issue-key-prefix/number tokens dropped, de-duplicated — shared by both search paths so their notion of "the query terms" agrees. */
function significantTerms(text: string): string[] {
  const issueKeyPrefixes = new Set<string>()
  const issueKeyNumbers = new Set<string>()
  for (const m of Array.from(text.matchAll(ISSUE_KEY_PATTERN))) {
    issueKeyPrefixes.add(m[1].toLowerCase())
    issueKeyNumbers.add(m[2].toLowerCase())
  }
  const terms = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  return Array.from(
    new Set(terms.filter(t => !STOPWORDS.has(t) && !issueKeyPrefixes.has(t) && !issueKeyNumbers.has(t))),
  ).slice(0, 12)
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
 * table. Never throws (a search must not crash the spawn that asked for it),
 * but distinguishes a real empty search from a store that could not be
 * searched at all — see `RetrievalAvailability`.
 */
function searchSqliteFts(agentId: string, query: string, limit: number, exactTaskKey?: string): EngineSearchResult {
  const matchExpr = toFtsMatchExpr(query)
  // No significant terms in the query AND no exact-key retry to attempt is a
  // fact about the query, not the store — the store was never asked
  // anything, so 'available' with zero records is the honest read, not
  // 'unavailable'.
  if (!matchExpr && !exactTaskKey) return { records: [], availability: 'available' }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('fs') as typeof import('fs')
  const file = sqlitePath()
  if (!existsSync(file)) {
    return { records: [], availability: 'unavailable', unavailableReason: `sqlite database not found at ${file}` }
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  // Constructor call is INSIDE the try, not before it: `new Database(...)`
  // throws its own driver errors (a non-database file at this path — "file
  // is not a database" — a permissions failure, corruption) exactly like a
  // query does, and those must degrade through the identical unavailable
  // path below rather than crash `buildRetrievedContext` uncaught. A round-4
  // critic pointed a corrupt store at this exact path and found the opposite:
  // the constructor throwing before the try ever started was an unhandled
  // exception, not an honest 'unavailable'.
  let conn: InstanceType<typeof Database> | undefined
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true })
    // Keyed by id so an exact-key retry-boost hit that was ALSO a genuine
    // term match is only counted once, at its boosted rank.
    const byId = new Map<string, RawRunRecordRow & { rank: number }>()

    if (matchExpr) {
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
      for (const r of rows) {
        // Relevance floor: bm25 is negative-is-better, and by FTS5's own
        // contract a row MATCH actually selected is never non-negative — a
        // row landing at rank >= 0 (the float-noise boundary around exact
        // zero, not a small-but-real negative score) carries no measured
        // relevance at all and must not be returned as "relevant past
        // experience". This is deliberately NOT a larger magnitude cutoff
        // like -0.0001: measured on this repo's own test fixtures, a
        // genuinely-relevant row in a small corpus (a handful of records,
        // typical for a single agent's history) can legitimately land at
        // ~1e-6 too — BM25's IDF term collapses toward zero for ANY term
        // that appears in most of a small corpus, spurious prefix pollution
        // or not, so magnitude alone cannot separate the two cases in this
        // regime. (Verified directly: a row matching solely through a
        // shared issue-key prefix and a row matching through real shared
        // vocabulary produced bm25 scores in the same ~1e-6 band.) The
        // structural fix that actually closes the named defect is
        // significantTerms() never emitting the issue-key prefix/number as
        // a query term in the first place, so a purely-prefix-driven row
        // does not match at all, not merely rank near zero — this floor is
        // the narrow, always-safe backstop on top of that, not the
        // mechanism doing the real work.
        if (r.rank >= -1e-9) continue
        byId.set(r.id, r)
      }
    }

    if (exactTaskKey) {
      // A genuine retry of the same ticket: find its own history by the
      // FULL, unstripped key, independent of whatever term-level relevance
      // scored above. Ranked ahead of every bm25 result — that is what
      // "retry-boost" means here — since a record about this exact ticket
      // is definitionally more useful than one merely about similar words.
      const exactRows = conn
        .prepare(
          `SELECT id, task_key, task_title, attempted, rejection_reason, reviewer_notes, created_at
           FROM agent_run_records
           WHERE task_key = ? AND agent_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(exactTaskKey, agentId, limit) as RawRunRecordRow[]
      for (const r of exactRows) {
        byId.set(r.id, { ...r, rank: -1_000 })
      }
    }

    const merged = Array.from(byId.values())
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)

    return {
      records: merged.map(r => ({
        id: r.id,
        taskKey: r.task_key,
        taskTitle: r.task_title,
        attempted: r.attempted,
        rejectionReason: r.rejection_reason,
        reviewerNotes: r.reviewer_notes,
        createdAt: r.created_at,
        rank: r.rank,
      })),
      availability: 'available',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // EVERY caught error here — the constructor failing to open the file at
    // all ("file is not a database", a permissions error), "no such table"
    // (migration 041 never applied), a malformed MATCH expression, a locked
    // file, corruption mid-query — means the store could not actually be
    // searched. A round-4 critic found the previous version of this catch
    // classifying anything other than a literal "no such table" match as
    // 'available' with zero records: an unobserved store read back as a
    // clean negative, the exact defect this piece exists to close. There is
    // no reliable way to distinguish "queried fine, genuinely zero rows"
    // from "the query itself failed" from inside a catch block — reaching
    // catch at all means the query did not complete — so every path through
    // here is 'unavailable', mirroring searchPortable's `if (error) return
    // {..., availability: 'unavailable', ...}` exactly.
    return { records: [], availability: 'unavailable', unavailableReason: message }
  } finally {
    conn?.close()
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
async function searchPortable(agentId: string, query: string, limit: number, exactTaskKey?: string): Promise<EngineSearchResult> {
  const terms = significantTerms(query)
  // No significant terms AND no exact-key retry to attempt is a fact about
  // the query, not the store — see the matching comment in searchSqliteFts.
  if (terms.length === 0 && !exactTaskKey) return { records: [], availability: 'available' }

  const { data, error } = await db()
    .from('agent_run_records')
    .select('id,task_key,task_title,attempted,rejection_reason,reviewer_notes,created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(PORTABLE_SCAN_WINDOW_ROWS)
  // A query error (missing table, connection failure, ...) means the store
  // itself could not be searched — 'unavailable', not a clean empty result.
  // `data === null` with no error is a real "the table exists, zero rows".
  if (error) return { records: [], availability: 'unavailable', unavailableReason: error.message }
  if (!data) return { records: [], availability: 'available' }
  // This engine has no index to search — it can only ever look at the most
  // recent PORTABLE_SCAN_WINDOW_ROWS records. When the query returned exactly
  // that many, an older, possibly-more-relevant record may sit just past the
  // window edge and this scan never saw it at all. That must never read back
  // as "the store was searched and nothing relevant exists" — see the
  // scannedWindowRows / possiblyIncompleteScan plumbing below, which callers
  // (buildRetrievedContext, scripts/retrieve-context.mjs) surface honestly
  // instead of reporting a bounded scan as a completed search.
  const possiblyIncompleteScan = data.length >= PORTABLE_SCAN_WINDOW_ROWS

  const scored = (data as RawRunRecordRow[])
    .map(r => {
      const haystack = [r.task_key, r.task_title, r.attempted, r.rejection_reason, r.reviewer_notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const score = terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0)
      const isExact = exactTaskKey !== undefined && r.task_key === exactTaskKey
      return { r, score, isExact }
    })
    // Relevance floor: a row with zero term overlap must not be returned as
    // "relevant past experience" — UNLESS it is the exact-key retry-boost
    // hit, which is relevant by definition (same ticket) independent of
    // term overlap.
    .filter(x => x.score > 0 || x.isExact)
    .sort((a, b) => {
      if (a.isExact !== b.isExact) return a.isExact ? -1 : 1
      return b.score - a.score || (b.r.created_at ?? '').localeCompare(a.r.created_at ?? '')
    })
    .slice(0, limit)

  return {
    records: scored.map(({ r, score, isExact }) => ({
      id: r.id,
      taskKey: r.task_key,
      taskTitle: r.task_title,
      attempted: r.attempted,
      rejectionReason: r.rejection_reason,
      reviewerNotes: r.reviewer_notes,
      createdAt: r.created_at,
      // Negated so "lower is more relevant" holds on both paths without
      // callers branching on `engine`; the exact-key retry-boost ranks
      // ahead of every real overlap score, mirroring searchSqliteFts.
      rank: isExact ? -1_000 : -score,
    })),
    availability: 'available',
    scannedWindowRows: PORTABLE_SCAN_WINDOW_ROWS,
    possiblyIncompleteScan,
  }
}

export interface SearchResult {
  records: RetrievedRecord[]
  engine: RetrievalEngine
  availability: RetrievalAvailability
  /** Present only when availability is 'unavailable'. */
  unavailableReason?: string
  /** Present only when `engine === 'keyword-overlap'` — see `EngineSearchResult.scannedWindowRows`. */
  scannedWindowRows?: number
  /** Present only when `engine === 'keyword-overlap'` — see `EngineSearchResult.possiblyIncompleteScan`. */
  possiblyIncompleteScan?: boolean
}

/**
 * Rank the agent's own past run records by relevance to `query` (typically
 * the task key + title being spawned for). Real FTS5 on the sqlite provider;
 * an honestly-labelled portable fallback everywhere else. `availability`
 * tells the caller whether the store was actually searched — see
 * `RetrievalAvailability`.
 */
export async function searchRunRecords(
  agentId: string,
  query: string,
  limit = 8,
  exactTaskKey?: string,
): Promise<SearchResult> {
  const result = isSqliteProvider()
    ? searchSqliteFts(agentId, query, limit, exactTaskKey)
    : await searchPortable(agentId, query, limit, exactTaskKey)
  return {
    records: result.records,
    engine: isSqliteProvider() ? 'fts5' : 'keyword-overlap',
    availability: result.availability,
    unavailableReason: result.unavailableReason,
    scannedWindowRows: result.scannedWindowRows,
    possiblyIncompleteScan: result.possiblyIncompleteScan,
  }
}

/**
 * One retrieved record, formatted as a whole block — never partially, see
 * `buildRetrievedContext`.
 *
 * `attempted` is passed in rather than read off the record so the single
 * budget-refit path below (`refitAttemptedToBudget`) can render the same
 * record with a shorter excerpt without duplicating this layout. Every other
 * caller gets the record's own text.
 */
function formatRecord(r: RetrievedRecord, attempted: string | null = r.attempted): string {
  const lines = [`### ${r.taskKey}${r.taskTitle ? ` — ${r.taskTitle}` : ''}`]
  if (attempted) lines.push(`Attempted: ${attempted}`)
  if (r.rejectionReason) lines.push(`Rejected because: ${r.rejectionReason}`)
  if (r.reviewerNotes) lines.push(`Reviewer notes: ${r.reviewerNotes}`)
  return lines.join('\n')
}

/** What happened to the top record's `attempted` excerpt when it had to be refitted. See `AttemptedRefit`. */
export interface AttemptedRefit {
  /** The record whose excerpt was refitted. */
  taskKey: string
  /** `'clipped'` — a marked excerpt survived. `'omitted'` — there was no room for one at all. */
  state: 'clipped' | 'omitted'
  /** How many characters of `agent_run_records.attempted` are not in the injected text. */
  droppedChars: number
}

/** Below this, a surviving excerpt is too short to tell anyone anything — omit it and say so instead. */
const MIN_ATTEMPTED_EXCERPT_CHARS = 120

/**
 * Give back THIS PIECE's own contribution to a record's size, rather than
 * failing a retrieval that worked before it existed.
 *
 * WHY THIS EXISTS (round-2 repair of a regression this piece caused, measured
 * both ways on a real sqlite DB — see docs/rebuild/pieces/pieces8/
 * memory-attempted.md §11). `agent_run_records.attempted` was null on every
 * row ever written until pieces8/memory-attempted filled it in. Filling it in
 * adds up to `ATTEMPTED_MAX_CHARS` (~300 tokens) to every record
 * `formatRecord()` renders — so a record that fitted the 1,300-token budget
 * yesterday could exceed it today purely because of this piece, and
 * `buildRetrievedContext` would raise `RetrievalBudgetExceededError`, which
 * app/api/run-agent/route.ts answers with a 503 and a reset issue. Measured:
 * one row, 4,600-char `reviewer_notes`, identical query — `attempted: null`
 * retrieved fine at ~1,185 tokens; `attempted` at the cap threw at ~1,468.
 * A dispatch that worked before this piece must not start failing because of
 * it.
 *
 * WHY THIS IS NOT THE "NEVER TRUNCATE" RULE BENDING. The rule exists so that
 * half a rejection reason never reads as the whole story. What is clipped
 * here is already an excerpt: `attempted` is itself a bounded, marked digest
 * of a log file that still exists on disk, and the clip is announced twice —
 * inline in the text, and in `RetrievalResult.attemptedRefit`. The
 * reviewer's and rejecter's own words are never touched. And the pre-piece
 * behaviour is preserved exactly: if the record still does not fit with the
 * excerpt gone entirely, this returns null and the caller raises, exactly as
 * it did before `attempted` was ever written.
 *
 * Returns null when there is nothing to give back (no `attempted`) or when
 * giving all of it back is still not enough.
 */
function refitAttemptedToBudget(
  r: RetrievedRecord,
  budgetTokens: number,
): { block: string; refit: AttemptedRefit } | null {
  if (!r.attempted) return null

  const withoutAttempted = formatRecord(r, null)
  if (estimateTokens(withoutAttempted) > budgetTokens) return null

  const marker = `… [clipped to fit the retrieval budget — full text in agent_run_records.attempted for ${r.taskKey}]`
  // estimateTokens is ceil(bytes/4), so "fits" is exactly "bytes <= budget*4".
  // Start from the byte allowance (never an under-estimate of the character
  // allowance for UTF-8) and shrink until the assembled block really fits.
  const allowanceBytes = budgetTokens * 4 - Buffer.byteLength(withoutAttempted, 'utf8') - Buffer.byteLength(`\nAttempted: ${marker}`, 'utf8')
  let excerpt = r.attempted.slice(0, Math.max(0, allowanceBytes))
  while (excerpt.length > 0 && estimateTokens(formatRecord(r, excerpt + marker)) > budgetTokens) {
    excerpt = excerpt.slice(0, excerpt.length - Math.max(1, Math.ceil(excerpt.length * 0.05)))
  }

  if (excerpt.length >= MIN_ATTEMPTED_EXCERPT_CHARS) {
    return {
      block: formatRecord(r, excerpt + marker),
      refit: { taskKey: r.taskKey, state: 'clipped', droppedChars: r.attempted.length - excerpt.length },
    }
  }

  // No room for an excerpt worth reading. Say so in the text if even that
  // line fits, and either way report it in `attemptedRefit` and the header —
  // an omission a caller cannot see is the silent truncation this file
  // refuses to do.
  const omitted = `[omitted — ~${estimateTokens(r.attempted)} tokens did not fit the retrieval budget; full text in agent_run_records.attempted for ${r.taskKey}]`
  const withNote = formatRecord(r, omitted)
  return {
    block: estimateTokens(withNote) <= budgetTokens ? withNote : withoutAttempted,
    refit: { taskKey: r.taskKey, state: 'omitted', droppedChars: r.attempted.length },
  }
}

export interface RetrievalResult {
  /** Markdown block ready to inject into a spawn prompt. Empty string when nothing matched — not an error. */
  text: string
  recordsUsed: number
  recordsFound: number
  budgetTokens: number
  engine: RetrievalEngine
  /** Whether the store was actually searched — `text: ''` alone cannot say this; see `RetrievalAvailability`. */
  availability: RetrievalAvailability
  /** Present only when availability is 'unavailable'. */
  unavailableReason?: string
  /** Present only when `engine === 'keyword-overlap'` — how many of the most recent rows this scan looked at. */
  scannedWindowRows?: number
  /** Present only when `engine === 'keyword-overlap'` — true when the scan hit its window and older records may hold a match this search never saw. A caller must not report `text === ''` as "no relevant records exist" when this is true; it only means none were found INSIDE the scanned window. */
  possiblyIncompleteScan?: boolean
  /** Present only when the top-ranked record's `attempted` excerpt had to be shortened or dropped to fit the budget — see `refitAttemptedToBudget`. Absent means every record was injected whole. */
  attemptedRefit?: AttemptedRefit
}

/**
 * The retrieval-at-spawn-time entry point: rank this agent's past run
 * records against the task being spawned for, then select whole records
 * (never a partial one) that fit inside the token budget.
 *
 * Budget discipline mirrors `memory-loop.ts`'s `trimToMemoryBudget` /
 * `PromotionBlockTooLargeError` pair exactly, on the read side instead of the
 * write side: any record that would push the running total over budget is
 * skipped (left out, not chopped) and selection CONTINUES to the next
 * lower-ranked one — a single oversized record must not crowd out smaller
 * records ranked below it that still fit — except for the single top-ranked
 * record, which is the one result nothing may silently drop. If IT alone
 * exceeds the budget, that is `RetrievalBudgetExceededError`, raised rather
 * than truncated, exactly as the piece brief specifies.
 *
 * ONE exception, added in round 2 and scoped as narrowly as it can be: before
 * raising on the top-ranked record, the `attempted` EXCERPT — this piece's
 * own addition, itself already a bounded digest of a log file still on disk —
 * is clipped or dropped, and the fact is reported both inside `text` and in
 * `attemptedRefit`. Nothing a human wrote (rejection reason, reviewer notes)
 * is ever shortened, and a record that overflows without the excerpt still
 * raises. See `refitAttemptedToBudget` for the regression that forced this.
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

  // The full, unstripped taskKey is passed through separately as the
  // exact-match retry-boost — significantTerms() strips its issue-key
  // prefix/number out of the ranked query itself (see the comment there),
  // so a genuine retry of the same ticket still finds its own history by
  // exact task_key match, not by the prefix coincidentally matching every
  // other record this project has ever written.
  const { records, engine, availability, unavailableReason, scannedWindowRows, possiblyIncompleteScan } =
    await searchRunRecords(agentId, query, limit, taskKey)

  const blocks: string[] = []
  let usedTokens = 0
  let attemptedRefit: AttemptedRefit | undefined
  for (const record of records) {
    let block = formatRecord(record)
    let blockTokens = estimateTokens(block)

    if (blocks.length === 0 && blockTokens > budgetTokens) {
      // Round-2 repair, applied ONLY here — to the top-ranked record, the one
      // record nothing is allowed to silently drop, and the only place this
      // function can raise. A lower-ranked record that does not fit is still
      // skipped whole (below), because clipping those would change which
      // records get selected, not just how much of one survives.
      //
      // Before raising, hand back this piece's own contribution: `attempted`
      // was null on every row until pieces8/memory-attempted, so raising on a
      // record that only overflows BECAUSE of it would break a dispatch that
      // worked before the feature existed. See `refitAttemptedToBudget`.
      const refitted = refitAttemptedToBudget(record, budgetTokens)
      if (!refitted) {
        // Genuine overflow — the record does not fit even with the
        // `attempted` excerpt gone entirely, exactly as it did not fit
        // pre-piece. Throw rather than silently truncate the reviewer's and
        // rejecter's own words: the exact case the piece brief names ("a
        // silently truncated context is how an agent loses the one record
        // that mattered").
        throw new RetrievalBudgetExceededError(agentId, taskKey, record.taskKey, blockTokens, budgetTokens)
      }
      block = refitted.block
      blockTokens = estimateTokens(block)
      attemptedRefit = refitted.refit
    }
    // A single oversized LOWER-ranked record must not exclude smaller
    // records that still fit under the budget — continue scanning instead
    // of stopping selection outright.
    if (usedTokens + blockTokens > budgetTokens) continue

    blocks.push(block)
    usedTokens += blockTokens
  }

  // The keyword-overlap engine has no index — it can only ever have scanned
  // the most recent `scannedWindowRows` records. When that scan hit its
  // window, this is a fact the injected block itself must carry, not just
  // something a caller can infer from a separate field: whoever reads the
  // spawn prompt sees only `text`, and "no relevant past experience" printed
  // as fact when the search never reached row 201 is exactly the defect this
  // piece exists to close. Real ranking (FTS5) is never window-bounded, so
  // this caveat is specific to the portable fallback.
  const boundedScanNote =
    engine === 'keyword-overlap' && possiblyIncompleteScan
      ? ` — bounded scan of the ${scannedWindowRows} most recent records; an older match may exist beyond that window`
      : ''

  // Same discipline as the bounded-scan caveat above: whoever reads the spawn
  // prompt sees only `text`, so a shortened excerpt is disclosed IN the text,
  // not only in a field a caller would have to think to check.
  const refitNote = attemptedRefit
    ? attemptedRefit.state === 'clipped'
      ? ` — ${attemptedRefit.taskKey}'s Attempted excerpt clipped by ${attemptedRefit.droppedChars} char(s) to fit`
      : ` — ${attemptedRefit.taskKey}'s Attempted excerpt (${attemptedRefit.droppedChars} chars) omitted; it did not fit`
    : ''

  const text =
    blocks.length > 0
      ? `# RELEVANT PAST EXPERIENCE (${engine} search${boundedScanNote}, ${blocks.length}/${records.length} match(es) fit, ~${usedTokens}/${budgetTokens} tokens${refitNote})\n\n${blocks.join('\n\n')}`
      : ''

  return {
    text,
    recordsUsed: blocks.length,
    recordsFound: records.length,
    budgetTokens,
    engine,
    availability,
    unavailableReason,
    scannedWindowRows,
    possiblyIncompleteScan,
    attemptedRefit,
  }
}
