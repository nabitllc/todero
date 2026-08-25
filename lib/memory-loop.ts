// TOD-489 repair (memory-loop-write piece) — the post-task learning loop.
//
// Two things used to live in scripts/post-task-memory.sh and
// scripts/promote-hot-patterns.sh, both hardcoding one developer's macOS
// home directory and both writing to loose Markdown files nothing could
// query:
//
//   1. After every agent run, record what was attempted, whether it
//      succeeded, and the rejection reason if any — now a structured row in
//      agent_run_records (migrations/038_agent_run_records.sql) instead of a
//      corrections.md paragraph.
//   2. When the same failure pattern repeats >= 3 times (the threshold TOD-489
//      already tuned — kept as-is), promote it: append to the self_improving
//      HOT tier in agent_memory_files (so the next run's context injection
//      picks it up — app/api/run-agent/route.ts already reads that column),
//      and draft a skill proposal into Mich-Brain2/_pending/skill-updates/
//      for Michael to approve by hand (docs/brain2-integration.md, "§2").
//
// This module is the shared logic; scripts/post-task-memory.mjs and
// scripts/promote-hot-patterns.mjs are thin, portable CLI wrappers around it,
// and app/api/agent-run-records + app/api/promote-hot-patterns expose the
// same behaviour over HTTP for anything that isn't a local script.
//
// SERVER ONLY: imports node builtins (fs/path) and the DB seam.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { db, type DbError } from './db'
import { VAULT_DIR } from './paths'

export const PROMOTION_THRESHOLD = 3

// Round-3 repair: the self_improving HOT-tier row is injected FIRST in
// loadContextFromDB, and the 30_000-byte context cap in
// app/api/run-agent/route.ts drops sections from the END when it overflows.
// Before this fix, promoteHotPatterns() re-appended an identical
// "#### Promoted <ts>" block on every pass over the same data — an
// unboundedly duplicating self_improving block that silently evicted
// long-term and daily memory a few passes in. MEMORY_BUDGET is the hard
// ceiling this row is trimmed to (keeping the most recent blocks) so it can
// never itself become the thing crowding everything else out.
export const MEMORY_BUDGET = 8_000

/**
 * Raised instead of silently truncating when a single promotion block (the
 * one being appended THIS pass) cannot fit inside MEMORY_BUDGET on its own.
 * Per the "a guard written in the prompt is not a guard" rule: a comment
 * saying "this is bounded" is not a bound unless something throws when the
 * bound is violated.
 */
export class PromotionBlockTooLargeError extends Error {
  constructor(agentId: string, blockBytes: number, budget: number) {
    super(
      `promoteHotPatterns(${agentId}): a single promotion block is ${blockBytes} bytes, ` +
      `exceeding MEMORY_BUDGET=${budget} bytes on its own — refusing to silently truncate it`,
    )
    this.name = 'PromotionBlockTooLargeError'
  }
}

export interface RunRecordInput {
  agentId: string
  taskKey: string
  taskTitle?: string | null
  status?: string | null
  attempted?: string | null
  succeeded?: boolean
  failed?: boolean
  rejectionCount?: number
  rejectionReason?: string | null
  reviewerNotes?: string | null
  exitStatus?: number | null
}

/**
 * Insert one structured run record. Never throws — a memory-write failure
 * must not fail the agent run it is trying to record. Returns the DB error
 * message on failure so a caller can log it, and null on success.
 */
export async function writeRunRecord(entry: RunRecordInput): Promise<string | null> {
  try {
    const { error } = await db()
      .from('agent_run_records')
      .insert({
        agent_id: entry.agentId,
        task_key: entry.taskKey,
        task_title: entry.taskTitle ?? null,
        status: entry.status ?? null,
        attempted: entry.attempted ?? null,
        succeeded: entry.succeeded ?? false,
        failed: entry.failed ?? false,
        rejection_count: entry.rejectionCount ?? 0,
        rejection_reason: entry.rejectionReason ?? null,
        reviewer_notes: entry.reviewerNotes ?? null,
        exit_status: entry.exitStatus ?? null,
      })
    return error ? error.message : null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export interface ExitRecordInput {
  /** opts.agentId from the spawn — which agent this run was */
  agentId: string
  /** opts.taskId from the spawn — the issue's DB id, when the caller had one */
  taskId?: string | null
}

/**
 * Round-2 repair (was: nothing called writeRunRecord at all). Called from
 * every runtime adapter's `watchChildExit` callback — the only place in the
 * codebase a spawned run's process exit is actually observed — so every
 * dispatched agent run produces exactly one `agent_run_records` row instead
 * of recording nothing.
 *
 * `watchChildExit` only confirms the OS pid is gone (`process.kill(pid, 0)`
 * failing); it does not capture a real exit code or signal, and it has no
 * way to know whether the task's review ultimately passed. Those fields are
 * therefore left unset here (not guessed) so `writeRunRecord`'s own
 * defaults are what land, not a fabricated "this succeeded" — the only
 * things filled in are read fresh from the issue row at the moment of exit:
 * task_key, status, rejection_count, last_rejection_reason and
 * reviewer_notes, which genuinely are known at that instant.
 *
 * Never throws and never fails the exit callback: a missing taskId (not
 * every spawn attaches one) or a DB error means this exit produces no row —
 * skipped and logged, not fabricated with a placeholder task_key.
 */
export async function recordRunOnExit(entry: ExitRecordInput): Promise<void> {
  if (!entry.taskId) {
    console.warn(`[memory-loop] no taskId on exit for agent=${entry.agentId} — skipping agent_run_records write`)
    return
  }
  try {
    const { data, error } = await db()
      .from('issues')
      .select('task_key,status,rejection_count,last_rejection_reason,reviewer_notes')
      .eq('id', entry.taskId)
      .limit(1)
    if (error) {
      console.warn(`[memory-loop] issue lookup failed for exit record (${entry.agentId}/${entry.taskId}): ${error.message}`)
      return
    }
    const issue = ((data ?? [])[0] ?? undefined) as {
      task_key?: string | null
      status?: string | null
      rejection_count?: number | null
      last_rejection_reason?: string | null
      reviewer_notes?: string | null
    } | undefined

    const taskKey = issue?.task_key ?? null
    if (!taskKey) {
      console.warn(`[memory-loop] issue ${entry.taskId} has no task_key — skipping exit record for ${entry.agentId} (agent_run_records.task_key is required)`)
      return
    }

    const dbError = await writeRunRecord({
      agentId: entry.agentId,
      taskKey,
      status: issue?.status ?? null,
      rejectionCount: issue?.rejection_count ?? undefined,
      rejectionReason: issue?.last_rejection_reason ?? null,
      reviewerNotes: issue?.reviewer_notes ?? null,
      // Genuinely unobservable from a pid-liveness watcher — explicit null,
      // not a guessed 0 ("succeeded") or 1 ("failed").
      exitStatus: null,
    })
    if (dbError) {
      console.warn(`[memory-loop] writeRunRecord failed on exit for ${entry.agentId}/${taskKey}: ${dbError}`)
    }
  } catch (err) {
    console.warn(`[memory-loop] recordRunOnExit failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface PatternHit {
  /** The recurring pattern itself — a normalized whole phrase, not a bare word (round-2 repair, see below). */
  phrase: string
  count: number
  examples: string[]
}

// Round-2 repair: the promotion unit used to be a single 4+ letter word
// (`[a-z]{4,}`, stopword-filtered), mirroring promote-hot-patterns.sh's
// original `Counter(words).most_common(10)`. That meant one repeated
// rejection SENTENCE — say "build failed before responding: timeout waiting
// on step finish" — exploded into up to 10 independent word-level patterns
// (build/failed/before/responding/timeout/waiting/step/finish/…), each
// separately clearing the threshold and each drafting its OWN vault
// proposal: seven duplicate proposals in Mich-Brain2/_pending/skill-updates/
// for what a human reading them would recognise instantly as one recurring
// complaint. The unit is now the whole normalized phrase — the same
// rejection sentence, lowercased and punctuation-collapsed so trivial
// formatting differences (a trailing period, doubled whitespace, different
// capitalisation) still count as the same recurrence — so three occurrences
// of the same sentence draft exactly one proposal.
//
// Round-4 repair: "three occurrences" was still wrong in a second way. One
// `agent_run_records` ROW is one run — but promoteHotPatterns() fed BOTH its
// rejection_reason and its reviewer_notes into this function as two
// independent text entries. A single run whose rejection_reason and
// reviewer_notes normalize to the same phrase (a reviewer routinely echoes
// the rejection reason into their notes) therefore counted as TWO
// occurrences of one run. Proven by seeding two rows for one agent, each
// with the same sentence duplicated across both columns: the old code
// returned count: 4 and promoted at ~1.5 real runs, and the drafted vault
// proposal read "Occurrences: 4 (threshold: 3)" while listing only 2 example
// tasks — a number nobody measured, handed to the owner as if it were.
// The unit is now the RUN RECORD, not the text field: every text entry
// carries the id of the record it came from, and a signature's count is the
// number of *distinct record ids* that produced it, not the number of text
// entries. A row that says the same thing twice still counts once.
const MIN_PHRASE_LENGTH = 8

/** Lowercase, strip punctuation, collapse whitespace — same sentence, same signature. */
function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Group free-text rejection reasons / reviewer notes by repeated whole
 * phrase (see round-2 comment above for why this replaced word-level
 * grouping). Returns hits meeting `threshold`, most frequent first, each
 * carrying up to 3 example snippets so a proposal can show its work instead
 * of asserting a bare claim.
 *
 * `id` identifies the source agent_run_records row each text entry came
 * from (round-4 repair). Counting is per distinct id, not per text entry —
 * see the comment above `MIN_PHRASE_LENGTH` — so a run contributing the
 * same phrase via both rejection_reason and reviewer_notes still increments
 * the pattern's count by exactly one.
 */
export function extractPatterns(
  texts: Array<{ id: string; text: string; example: string }>,
  threshold = PROMOTION_THRESHOLD,
): PatternHit[] {
  const counts = new Map<string, { ids: Set<string>; examples: string[]; display: string }>()
  for (const { id, text, example } of texts) {
    if (!text) continue
    const signature = normalizePhrase(text)
    if (signature.length < MIN_PHRASE_LENGTH) continue
    const entry = counts.get(signature) ?? { ids: new Set<string>(), examples: [], display: text.trim() }
    entry.ids.add(id)
    if (entry.examples.length < 3 && example && !entry.examples.includes(example)) {
      entry.examples.push(example)
    }
    counts.set(signature, entry)
  }
  return Array.from(counts.values())
    .filter(v => v.ids.size >= threshold)
    .sort((a, b) => b.ids.size - a.ids.size)
    .slice(0, 10)
    .map(v => ({ phrase: v.display, count: v.ids.size, examples: v.examples }))
}

/**
 * Filesystem-safe slug for a pattern phrase, used in both filenames and
 * dedupe checks. Truncated — the unit promoted is now a whole sentence, not
 * a single word, so an untruncated slug could run to hundreds of characters.
 */
function slugify(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export interface ProposalResult {
  written: boolean
  path?: string
  reason: string
}

/**
 * Draft a skill-update proposal into Mich-Brain2/_pending/skill-updates/ —
 * the ONLY path under the vault Todero may write to (docs/brain2-integration.md).
 * Never edits or deletes an existing file; only ever adds a new one, and never
 * touches anything outside _pending/skill-updates/.
 *
 * Idempotent: if a proposal for this agent+pattern already exists (by
 * filename), this is a no-op — otherwise every re-run of promote-hot-patterns
 * would draft the same proposal again, and a human reviewing _pending/ would
 * see the same request duplicated on every sprint cycle.
 *
 * Degrades to `written: false` with a named reason when the vault is absent —
 * never throws, per the "must run correctly when the vault is absent" rule.
 */
export function draftSkillProposal(
  agentId: string,
  hit: PatternHit,
): ProposalResult {
  if (!existsSync(VAULT_DIR)) {
    return { written: false, reason: `vault not found at ${VAULT_DIR} (set TODERO_VAULT_DIR) — proposal skipped, not lost: rerun once the vault is mounted` }
  }

  const outDir = join(VAULT_DIR, '_pending', 'skill-updates')
  const slug = slugify(hit.phrase)
  const existing = existsSync(outDir)
    ? readdirSync(outDir).filter(f => f.includes(`${agentId}-${slug}`))
    : []
  if (existing.length > 0) {
    return { written: false, reason: `already proposed: ${existing[0]}` }
  }

  try {
    mkdirSync(outDir, { recursive: true })
  } catch (err) {
    return { written: false, reason: `could not create ${outDir}: ${err instanceof Error ? err.message : String(err)}` }
  }

  const date = new Date().toISOString().slice(0, 10)
  const filename = `${date}-${agentId}-${slug}.md`
  const outPath = join(outDir, filename)

  const body = `# Skill proposal (draft — NOT approved)

**Source:** Todero \`promote-hot-patterns\` (memory-loop-write, TOD-489 repair)
**Agent:** ${agentId}
**Pattern:** \`${hit.phrase}\`
**Occurrences:** ${hit.count} (threshold: ${PROMOTION_THRESHOLD})
**Drafted:** ${new Date().toISOString()}

## What Todero observed

The phrase \`${hit.phrase}\` recurred ${hit.count} times across ${agentId}'s
rejection reasons / reviewer notes — this repo's tuned threshold for "this is
a pattern, not a coincidence."

## Examples

${hit.examples.map(e => `- ${e.replace(/\n/g, ' ').slice(0, 300)}`).join('\n') || '_(no example text captured)_'}

## Proposed action

Michael: review whether this belongs as a durable skill/playbook rule. If
approved, move the relevant guidance into the vault by hand (Skills/ or
Playbooks/, whichever fits) and delete this file. Todero does not — and must
not — approve or apply its own proposals; this file existing changes nothing
until a human acts on it.
`

  try {
    writeFileSync(outPath, body, 'utf8')
  } catch (err) {
    return { written: false, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { written: true, path: outPath, reason: 'proposal drafted' }
}

export interface PromotionSummary {
  agentId: string
  rowsExamined: number
  hits: PatternHit[]
  promotedToHot: string[]
  /**
   * Hits that cleared the threshold this pass but were already present in
   * the self_improving row's content (by phrase) from a prior pass — dropped
   * before the HOT-tier write instead of re-appended, which is what makes a
   * second promoteHotPatterns() call over unchanged data a no-op instead of
   * a duplicate block.
   */
  alreadyPromoted: string[]
  proposals: ProposalResult[]
  /**
   * Set when the `agent_run_records` read itself failed (e.g. the table has
   * never been migrated onto this database). Round-2 repair: this used to
   * be silently swallowed by `if (error || !data) return summary`, so a
   * table that DOES NOT EXIST reported the exact same
   * `{ rowsExamined: 0, hits: [] }` shape as "table exists, genuinely
   * nothing to promote yet" — a false "0 rows examined" instead of the
   * honest 424 `GET /api/agent-run-records` already gives for the same
   * failure. The caller (POST /api/promote-hot-patterns) checks this field
   * and returns the matching error response instead of a clean 200.
   */
  dbError?: DbError
}

/**
 * The promotion pass: read this agent's failed/rejected agent_run_records,
 * group by repeated pattern, and for every pattern clearing the threshold —
 * append it to the self_improving HOT tier (agent_memory_files) and draft a
 * vault proposal. Returns a summary rather than throwing so a caller (CLI or
 * HTTP) can report partial progress instead of an opaque failure — but a
 * failed *read* is reported via `dbError`, never disguised as "0 rows".
 */
export async function promoteHotPatterns(agentId: string): Promise<PromotionSummary> {
  const summary: PromotionSummary = {
    agentId, rowsExamined: 0, hits: [], promotedToHot: [], alreadyPromoted: [], proposals: [],
  }

  const { data, error } = await db()
    .from('agent_run_records')
    .select('id,task_key,rejection_reason,reviewer_notes,failed,rejection_count')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    summary.dbError = error
    return summary
  }
  if (!data) return summary

  const rows = data as Array<{
    id: string; task_key: string; rejection_reason: string | null; reviewer_notes: string | null
    failed: boolean; rejection_count: number
  }>
  const relevant = rows.filter(r => r.failed || r.rejection_count > 0)
  summary.rowsExamined = relevant.length

  // Round-4 repair: this gate used to live only in
  // scripts/promote-hot-patterns.mjs, so the CLI skipped a promotion pass
  // below PROMOTION_THRESHOLD rows but POST /api/promote-hot-patterns (the
  // other caller of this function) did not — same class of bug, guarded in
  // only one of its two callers. Moved here so both callers share one gate.
  if (summary.rowsExamined < PROMOTION_THRESHOLD) return summary

  const texts = relevant.flatMap(r => {
    const out: Array<{ id: string; text: string; example: string }> = []
    if (r.rejection_reason) out.push({ id: r.id, text: r.rejection_reason, example: `[${r.task_key}] ${r.rejection_reason}` })
    if (r.reviewer_notes) out.push({ id: r.id, text: r.reviewer_notes, example: `[${r.task_key}] ${r.reviewer_notes}` })
    return out
  })

  const hits = extractPatterns(texts)
  summary.hits = hits
  if (hits.length === 0) return summary

  const timestamp = new Date().toISOString()

  // Deliberately NOT `.upsert(..., { onConflict: 'agent_id,memory_type,date_key' })`
  // here: SQL treats every NULL as distinct from every other NULL, so a
  // unique constraint that includes `date_key` never matches two rows that
  // both have it NULL — which self_improving rows always do, this one
  // included. An upsert against that target silently INSERTs a new row on
  // every single run instead of merging into one, so promoteHotPatterns
  // would grow an unbounded pile of near-duplicate HOT-tier rows rather
  // than accumulating into the one the retrieval side reads. Select the
  // row's id first and choose update vs. insert explicitly instead.
  const existing = await db()
    .from('agent_memory_files')
    .select('id,content')
    .eq('agent_id', agentId)
    .eq('memory_type', 'self_improving')
    .is('date_key', null)
    .limit(1)
  const existingRow = existing.data?.[0] as { id?: string; content?: string } | undefined
  const priorContent = existingRow?.content ?? ''

  // Round-3 repair: without this filter, every pass over the same data
  // re-appended the same bullet under a fresh "#### Promoted <ts>" header —
  // verified as two identical blocks after two runs with no new rows. Drop
  // any hit whose phrase is already present in a prior promoted block
  // instead of re-writing it.
  const newHits = hits.filter(h => !priorContent.includes(`**${h.phrase}**`))
  summary.alreadyPromoted = hits.filter(h => !newHits.includes(h)).map(h => h.phrase)

  if (newHits.length > 0) {
    const promotionText = newHits
      .map(h => `- **${h.phrase}** appeared ${h.count} times across ${agentId}'s corrections`)
      .join('\n')
    const newBlock = `#### Promoted ${timestamp}\n${promotionText}\n`

    const blockBytes = Buffer.byteLength(newBlock, 'utf8')
    if (blockBytes > MEMORY_BUDGET) {
      // Named error, not a silent truncation — a promotion block big enough
      // to blow the entire budget on its own is a signal something upstream
      // (an unbounded example, a runaway phrase) needs fixing, not clipping.
      throw new PromotionBlockTooLargeError(agentId, blockBytes, MEMORY_BUDGET)
    }

    const separator = priorContent && !priorContent.endsWith('\n') ? '\n' : ''
    const combined = `${priorContent}${separator}\n${newBlock}`
    const updated = trimToMemoryBudget(combined, MEMORY_BUDGET)

    try {
      const { error: writeError } = existingRow?.id
        ? await db().from('agent_memory_files').update({ content: updated, updated_at: timestamp }).eq('id', existingRow.id)
        : await db().from('agent_memory_files').insert({ agent_id: agentId, memory_type: 'self_improving', date_key: null, content: updated, updated_at: timestamp })
      if (!writeError) summary.promotedToHot = newHits.map(h => h.phrase)
    } catch (err) {
      // Best-effort — a failed HOT-tier write should not block the vault
      // proposal below; the caller sees promotedToHot stay empty. (Only DB
      // failures land here: PromotionBlockTooLargeError is thrown above,
      // outside this try, and always propagates.)
      void err
    }
  }

  for (const hit of hits) {
    summary.proposals.push(draftSkillProposal(agentId, hit))
  }

  return summary
}

/**
 * Keep the self_improving row's most recent "#### Promoted " blocks and drop
 * older ones from the front once the row exceeds `budget` bytes — the
 * bounded half of the round-3 repair (idempotency alone stops the row from
 * growing when nothing changed, but a long-running agent with genuinely new
 * patterns every week still needs a ceiling).
 */
function trimToMemoryBudget(content: string, budget: number): string {
  if (Buffer.byteLength(content, 'utf8') <= budget) return content

  const blocks = content.split(/\n(?=#### Promoted )/).filter(b => b.trim().length > 0)
  const kept: string[] = []
  let total = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    const joiner = kept.length > 0 ? 1 : 0
    const size = Buffer.byteLength(block, 'utf8') + joiner
    if (total + size > budget) break
    kept.unshift(block)
    total += size
  }
  return kept.join('\n')
}
