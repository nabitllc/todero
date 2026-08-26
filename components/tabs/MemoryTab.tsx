'use client'
// ─── components/tabs/MemoryTab.tsx ───────────────────────────────────────────
//
// memory-cards piece (docs/rebuild/pieces/pieces6/memory-cards.md).
//
// This tab used to be a two-pane Markdown file browser over GET /api/memory —
// a daily-journal viewer standing in for the learning loop. design/Memory.dc.html
// specifies the loop itself: the always-in-context budget, what the agents
// tried, the skills that came out of it, and the rule that a proposal goes to
// the vault's outbox and waits for a human. All four are built here on the
// `components/nav/Card.tsx` contract; the journal survives as one more card
// rather than as the whole surface.
//
// HONESTY NOTES (each has an acceptance item in the piece doc):
//   * the artboard's "2 proposed" has no read-only source — no endpoint lists
//     Mich-Brain2/_pending/skill-updates/ — so it is rendered as absent;
//   * the artboard's "seen 4×" is pattern recurrence computed only inside
//     promoteHotPatterns(), which WRITES. A render must not trigger it, so the
//     per-row `rejection_count` column is shown under its own name instead;
//   * `agent_run_records` has no free-text column for what WORKED. The boolean
//     `succeeded` is shown and the missing text is stated.

import React from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import Card from '@/components/nav/Card'
import MemoryBudgetCard from '@/components/tabs/MemoryBudgetCard'
import { useApiData, type ApiError } from '@/hooks/useApiData'
import { dbUrl } from '@/lib/db/browser'
import { estimateTokens, relativeTime } from '@/lib/memory-budget'

/** One journal entry inside a memory file. */
export interface MemEntry { title: string; bullets: string[]; body: string }

/** A row of /api/memory's `files` array. */
export interface MemFile {
  filename: string
  label: string
  date: string
  /** The route formats this with toFixed(1), so it arrives as a string. */
  kb: string | number
  words: number
  group: 'today' | 'yesterday' | 'week' | 'month' | 'older'
  entries: MemEntry[]
}

/** A row of agent_run_records, exactly as the table stores it. */
interface RunRecord {
  id: string
  agent_id: string | null
  task_key: string | null
  task_title: string | null
  status: string | null
  attempted: string | null
  succeeded: boolean | number | null
  failed: boolean | number | null
  rejection_count: number | null
  rejection_reason: string | null
  reviewer_notes: string | null
  created_at: string | null
}

interface SkillDoc { agent_id: string; slug: string; content: string | null }

const RECORDS_QUERY = '/api/agent-run-records?limit=100'
const SKILLS_QUERY = 'agent_documents?select=agent_id,slug,content&doc_type=eq.skill&order=slug.asc&limit=200'

const truthy = (v: boolean | number | null) => v === true || v === 1

export default function MemoryTab({ memFiles, error, onRetry, openMem, setOpenMem }: {
  memFiles: MemFile[] | null
  error?: ApiError | null
  onRetry?: () => void
  openMem: string | null
  setOpenMem: (f: string | null) => void
}) {
  const records = useApiData<{ records?: RunRecord[] }>(RECORDS_QUERY)
  const skills = useApiData<SkillDoc[]>(dbUrl(SKILLS_QUERY))
  const roster = useApiData<{ agents?: Array<{ id: string }>; vaultPath?: string | null; vaultWarning?: string | null }>('/api/agents')

  const recordRows = records.error ? null : records.data?.records ?? null
  const skillRows = skills.error ? null : skills.data ?? null
  const journal = error ? null : memFiles
  const agentIds = roster.error ? null : roster.data?.agents?.map(a => a.id) ?? null

  // The vault root is derived from the Global_Agents directory the server
  // actually scanned — never a path typed into this file.
  const vaultGlobalAgents = roster.error ? null : roster.data?.vaultPath ?? null
  const vaultRoot = vaultGlobalAgents ? vaultGlobalAgents.replace(/[\\/]Global_Agents[\\/]?$/, '') : null

  return (
    <div className="flex flex-col gap-4 pb-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-white text-lg font-semibold">Memory</h1>
        <span className="font-mono text-xs text-white/50">
          {/* "loading" and "the request failed" are different facts, and a
              counter must never claim either is the other. */}
          {records.loading ? 'run records loading…' : recordRows === null ? 'run records unavailable' : `${recordRows.length} run record${recordRows.length === 1 ? '' : 's'}`}
          {' · '}
          {skills.loading ? 'skill docs loading…' : skillRows === null ? 'skill docs unavailable' : `${skillRows.length} skill doc${skillRows.length === 1 ? '' : 's'}`}
          {' · proposed: not exposed by any endpoint'}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-white/40">Todero&rsquo;s own store — the vault stays read-only</span>
      </header>

      <MemoryBudgetCard agentIds={agentIds} />

      {/* ── What it tried ─────────────────────────────────────────────────── */}
      <Card
        id="memory-run-records"
        title="What has it tried, and what got rejected?"
        metric={recordRows ? { value: recordRows.length, label: 'records' } : undefined}
        source={
          <>
            GET {RECORDS_QUERY} · table agent_run_records (id, task_key, attempted, rejection_reason, reviewer_notes,
            rejection_count, succeeded, created_at) · the endpoint returns no total, so this is the 100 most recent rows,
            not a count of the store
          </>
        }
        empty={{
          active: !records.error && !records.loading && recordRows?.length === 0,
          message:
            'agent_run_records is empty — no agent run has been recorded on this database yet. Rows are written by ' +
            'recordRunOnExit() when a dispatched run\'s process exits, and dispatch is off on this instance.',
        }}
      >
        {records.error ? (
          <ApiErrorBanner error={records.error} onRetry={records.refetch} />
        ) : records.loading ? (
          <p className="text-white/40 text-xs">Loading run records…</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {(recordRows ?? []).map(r => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-[#111] px-3.5 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: truthy(r.succeeded) ? '#4ade80' : truthy(r.failed) ? '#f87171' : '#71717a' }} />
                  <span className="text-white text-xs font-semibold">{r.task_key ?? '(no task_key)'}</span>
                  {r.task_title && <span className="text-white/55 text-xs truncate">{r.task_title}</span>}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-white/45">{relativeTime(r.created_at) || 'created_at is null'}</span>
                </div>
                <Field label="ATTEMPTED" tone="text-white/50" value={r.attempted} missing="agent_run_records.attempted is null for this row" />
                <Field label="FAILED" tone="text-red-400" value={r.rejection_reason} missing="rejection_reason is null" />
                <Field label="NOTES" tone="text-white/50" value={r.reviewer_notes} missing="reviewer_notes is null" />
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  <Chip>succeeded: {String(truthy(r.succeeded))}</Chip>
                  <Chip>rejection_count: {r.rejection_count ?? 0}</Chip>
                  {r.status && <Chip>status: {r.status}</Chip>}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-white/35">run {r.id}{r.agent_id ? ` · ${r.agent_id}` : ''}</span>
                </div>
              </div>
            ))}
            <p className="font-mono text-[10px] leading-snug text-white/35">
              No column records what WORKED — agent_run_records stores attempted, rejection_reason, reviewer_notes and a
              boolean succeeded, so the working path is shown as that flag, not as prose nobody wrote. Recurrence
              (&ldquo;seen n times&rdquo;) is counted only by promoteHotPatterns(), which writes; the per-row
              rejection_count column is shown instead.
            </p>
          </div>
        )}
      </Card>

      {/* ── Skills ────────────────────────────────────────────────────────── */}
      <Card
        id="memory-skills"
        title="Which skills are loaded into every spawn?"
        metric={skillRows ? { value: skillRows.length, label: 'skill docs' } : undefined}
        source={<>GET /api/db/{SKILLS_QUERY} · a row here is loaded by loadIdentityContext() as &ldquo;# SKILL: &lt;slug&gt;&rdquo;</>}
        empty={{
          active: !skills.error && !skills.loading && skillRows?.length === 0,
          message:
            'agent_documents holds no doc_type=\'skill\' row, so no skill is loaded into any spawn. Skills reach this ' +
            'table by hand or through the agent-docs API; the promotion pass writes patterns to agent_memory_files, not here.',
        }}
      >
        {skills.error ? (
          <ApiErrorBanner error={skills.error} onRetry={skills.refetch} />
        ) : skills.loading ? (
          <p className="text-white/40 text-xs">Loading skill docs…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(skillRows ?? []).map(s => (
              <div key={`${s.agent_id}/${s.slug}`} className="rounded-xl border border-white/10 bg-[#111] px-3.5 py-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-semibold flex-1 min-w-0 truncate">{s.slug}</span>
                  <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-400">active</span>
                </div>
                <p className="text-white/60 text-[11.5px] leading-relaxed line-clamp-3">{s.content?.trim() || '(row has empty content)'}</p>
                <span className="font-mono text-[10px] text-white/35">
                  agent_documents · {s.agent_id === 'skill' ? 'shared (agent_id=skill)' : `agent_id=${s.agent_id}`} · ~{estimateTokens(`# SKILL: ${s.slug}\n\n${s.content ?? ''}`).toLocaleString()} tokens
                </span>
              </div>
            ))}
            <p className="font-mono text-[10px] leading-snug text-white/35">
              Every row is <span className="text-white/60">active</span> by definition: a doc_type=&lsquo;skill&rsquo; row is
              loaded into the identity context of every matching spawn. This database has no <span className="text-white/60">proposed</span> skill
              row type at all — proposals are files in the vault outbox, see below.
            </p>
          </div>
        )}
      </Card>

      {/* ── The vault rule ────────────────────────────────────────────────── */}
      <Card
        id="memory-vault-outbox"
        title="Where does a proposed skill go?"
        source={<>GET /api/agents → vaultPath (the Global_Agents directory this host actually scanned) · outbox path from draftSkillProposal() in lib/memory-loop.ts</>}
      >
        {roster.error ? (
          <ApiErrorBanner error={roster.error} onRetry={roster.refetch} />
        ) : roster.loading ? (
          <p className="text-white/40 text-xs">Locating the vault…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-white/70 text-[12px] leading-relaxed">
              Proposals go to{' '}
              <span className="font-mono text-white/90">{vaultRoot ? `${vaultRoot}\\_pending\\skill-updates\\` : '_pending/skill-updates/'}</span>{' '}
              and wait for you. Todero never writes to the vault itself, and never approves its own proposal.
            </p>
            {vaultRoot ? (
              <p className="font-mono text-[10px] leading-snug text-white/35">
                vault root derived from vaultPath = {vaultGlobalAgents}
              </p>
            ) : (
              <p className="font-mono text-[10px] leading-snug text-amber-400/80">
                /api/agents reported no vaultPath — the vault is not mounted on this host, so the path above is the
                relative outbox only. {roster.data?.vaultWarning ?? ''}
              </p>
            )}
            <p className="font-mono text-[10px] leading-snug text-white/35">
              How many proposals are waiting cannot be shown here: no endpoint lists that directory, and reading it is a
              filesystem call this surface does not make. The count in design/Memory.dc.html (&ldquo;2 proposed&rdquo;) has
              no read-only source in this codebase.
            </p>
          </div>
        )}
      </Card>

      {/* ── Daily journal (the surface this tab used to be) ────────────────── */}
      <Card
        id="memory-daily-journal"
        title="What did each day's journal say?"
        metric={journal ? { value: journal.length, label: 'days' } : undefined}
        source={<>GET /api/memory · agent_memory_files where agent_id=&lsquo;global&rsquo; and memory_type=&lsquo;daily&rsquo;, 30 most recent date_keys</>}
        empty={{
          active: !error && journal?.length === 0,
          message: 'No daily journal file exists yet — agent_memory_files has no agent_id=\'global\', memory_type=\'daily\' row.',
        }}
      >
        {error ? (
          <ApiErrorBanner error={error} onRetry={onRetry} />
        ) : journal === null ? (
          <p className="text-white/40 text-xs">Loading memory…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {journal.map(f => {
              const open = openMem === f.filename
              return (
                <div key={f.filename} className="rounded-xl border border-white/10 bg-[#111]">
                  <button
                    onClick={() => setOpenMem(open ? null : f.filename)}
                    aria-expanded={open}
                    className="w-full text-left px-3.5 py-2.5 flex items-center gap-2"
                  >
                    <span className="text-white/85 text-xs font-medium">{f.label}</span>
                    <span className="font-mono text-[10px] text-white/40">{f.date}</span>
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] text-white/40">{f.kb} KB · {f.words} words · {f.entries.length} entries</span>
                  </button>
                  {open && (
                    <div className="px-3.5 pb-3 flex flex-col gap-3">
                      {f.entries.length === 0 && <p className="text-white/40 text-[11.5px]">This file has no &ldquo;## &rdquo; sections.</p>}
                      {f.entries.map((e, i) => (
                        <div key={i} className="flex flex-col gap-1">
                          <h3 className="text-indigo-300 text-[12.5px] font-semibold">{e.title}</h3>
                          {e.bullets.length > 0
                            ? e.bullets.map((b, j) => <p key={j} className="text-white/65 text-[11.5px] leading-relaxed">· {b}</p>)
                            : <p className="text-white/55 text-[11.5px] leading-relaxed whitespace-pre-wrap">{e.body}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[9.5px] text-white/50 bg-white/[0.05] rounded px-1.5 py-0.5">{children}</span>
}

/** A record field that prints the column's absence rather than an empty line. */
function Field({ label, value, tone, missing }: { label: string; value: string | null; tone: string; missing: string }) {
  return (
    <div className="flex gap-2 items-start">
      <span className={`font-mono text-[9.5px] ${tone} min-w-[62px] pt-[3px] shrink-0`}>{label}</span>
      {value?.trim()
        ? <span className="text-white/75 text-[11.5px] leading-relaxed">{value}</span>
        : <span className="font-mono text-[10px] text-white/30 pt-[3px]">{missing}</span>}
    </div>
  )
}
