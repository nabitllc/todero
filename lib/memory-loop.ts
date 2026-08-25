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
import { db } from './db'
import { VAULT_DIR } from './paths'

export const PROMOTION_THRESHOLD = 3

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

export interface PatternHit {
  word: string
  count: number
  examples: string[]
}

// Same "significant word" heuristic as the original promote-hot-patterns.sh
// (`[a-z]{4,}`) — a 4+ letter lowercase token — kept identical on purpose so
// the promotion behaviour does not silently change while the transport does.
const WORD_RE = /[a-z]{4,}/g
const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their',
  'which', 'when', 'what', 'about', 'because', 'should', 'would', 'could',
  'into', 'over', 'again', 'each', 'more', 'than', 'then', 'also', 'still',
])

/**
 * Group free-text rejection reasons / reviewer notes by repeated
 * significant word, mirroring the Counter(phrases).most_common(10) logic
 * `promote-hot-patterns.sh` used. Returns hits meeting `threshold`,
 * most frequent first, each carrying up to 3 example snippets so a proposal
 * can show its work instead of asserting a bare word.
 */
export function extractPatterns(
  texts: Array<{ text: string; example: string }>,
  threshold = PROMOTION_THRESHOLD,
): PatternHit[] {
  const counts = new Map<string, { count: number; examples: string[] }>()
  for (const { text, example } of texts) {
    if (!text) continue
    const words = Array.from(
      new Set((text.toLowerCase().match(WORD_RE) ?? []).filter(w => !STOPWORDS.has(w))),
    )
    for (const word of words) {
      const entry = counts.get(word) ?? { count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3 && example && !entry.examples.includes(example)) {
        entry.examples.push(example)
      }
      counts.set(word, entry)
    }
  }
  return Array.from(counts.entries())
    .filter(([, v]) => v.count >= threshold)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([word, v]) => ({ word, count: v.count, examples: v.examples }))
}

/** Filesystem-safe slug for a pattern word, used in both filenames and dedupe checks. */
function slugify(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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
  const slug = slugify(hit.word)
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
**Pattern:** \`${hit.word}\`
**Occurrences:** ${hit.count} (threshold: ${PROMOTION_THRESHOLD})
**Drafted:** ${new Date().toISOString()}

## What Todero observed

The word \`${hit.word}\` recurred ${hit.count} times across ${agentId}'s
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
  proposals: ProposalResult[]
}

/**
 * The promotion pass: read this agent's failed/rejected agent_run_records,
 * group by repeated pattern, and for every pattern clearing the threshold —
 * append it to the self_improving HOT tier (agent_memory_files) and draft a
 * vault proposal. Returns a summary rather than throwing so a caller (CLI or
 * HTTP) can report partial progress instead of an opaque failure.
 */
export async function promoteHotPatterns(agentId: string): Promise<PromotionSummary> {
  const summary: PromotionSummary = {
    agentId, rowsExamined: 0, hits: [], promotedToHot: [], proposals: [],
  }

  const { data, error } = await db()
    .from('agent_run_records')
    .select('task_key,rejection_reason,reviewer_notes,failed,rejection_count')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data) return summary

  const rows = data as Array<{
    task_key: string; rejection_reason: string | null; reviewer_notes: string | null
    failed: boolean; rejection_count: number
  }>
  const relevant = rows.filter(r => r.failed || r.rejection_count > 0)
  summary.rowsExamined = relevant.length

  const texts = relevant.flatMap(r => {
    const out: Array<{ text: string; example: string }> = []
    if (r.rejection_reason) out.push({ text: r.rejection_reason, example: `[${r.task_key}] ${r.rejection_reason}` })
    if (r.reviewer_notes) out.push({ text: r.reviewer_notes, example: `[${r.task_key}] ${r.reviewer_notes}` })
    return out
  })

  const hits = extractPatterns(texts)
  summary.hits = hits
  if (hits.length === 0) return summary

  const timestamp = new Date().toISOString()
  const promotionText = hits
    .map(h => `- **${h.word}** appeared ${h.count} times across ${agentId}'s corrections`)
    .join('\n')

  try {
    const existing = await db()
      .from('agent_memory_files')
      .select('content')
      .eq('agent_id', agentId)
      .eq('memory_type', 'self_improving')
      .is('date_key', null)
      .limit(1)
    const priorContent = (existing.data?.[0] as { content?: string } | undefined)?.content ?? ''
    const separator = priorContent && !priorContent.endsWith('\n') ? '\n' : ''
    const updated = `${priorContent}${separator}\n#### Promoted ${timestamp}\n${promotionText}\n`

    const { error: upsertError } = await db()
      .from('agent_memory_files')
      .upsert(
        { agent_id: agentId, memory_type: 'self_improving', date_key: null, content: updated, updated_at: timestamp },
        { onConflict: 'agent_id,memory_type,date_key' },
      )
    if (!upsertError) summary.promotedToHot = hits.map(h => h.word)
  } catch {
    // Best-effort — a failed HOT-tier write should not block the vault
    // proposal below; the caller sees promotedToHot stay empty.
  }

  for (const hit of hits) {
    summary.proposals.push(draftSkillProposal(agentId, hit))
  }

  return summary
}
