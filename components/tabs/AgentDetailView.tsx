'use client'
import React, { useState, useEffect } from 'react'
import { Chip, Dot } from '@/lib/mc-atoms'
import { Button, Input, StatCard, EmptyState } from '@/components/ui'
import {
  LayoutDashboard, BookOpen, Zap, Settings, PlayCircle,
  ChevronRight, X, RefreshCw, Clock, CheckCircle2, Code2,
  AlertCircle, FileText, Activity, BarChart3, DollarSign,
  Edit3, Save, Pause, Plus, Heart, Trash2
} from 'lucide-react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, useApiData, formatApiError, type ApiError } from '@/hooks/useApiData'
import { dbUrl } from '@/lib/db/browser'
import { estimateModelRateUsd } from '@/lib/model-rates'
import type { VaultBadgeInfo } from '@/lib/vault-badge'
import AgentLaunchControl from '@/components/tabs/AgentLaunchControl'
import AgentRunTrace from '@/components/tabs/AgentRunTrace'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Agent {
  id: string
  name: string
  emoji: string
  role: string
  status: string
  model: string
  modelShort: string
  color: string
  desc: string
  capabilities: string[]
  workspace?: string
  ago?: number | null
  lastUpdatedAt?: number
  currentTask?: string | null
  type?: 'consultant' | 'permanent'
  // Liveness as /api/agents reports it — derived from heartbeats the server
  // actually received, never inferred. Optional so call sites that hold a
  // partial agent object (search results, office sprites) still compile; a
  // missing value renders as "liveness unknown", not as "Idle".
  liveness?: 'live' | 'stale' | 'idle' | 'never'
  lastSeenAt?: number | null
  livenessSource?: 'heartbeat' | 'none'
  // 'registered' means this row exists only because it POSTed to
  // /api/connect — no AGENTS.md names it. Only those rows can be hard-deleted
  // from the "Remove" action below; an AGENTS.md-defined agent has no
  // registration row for DELETE /api/agents/{id} to remove.
  rosterSource?: string
<<<<<<< Updated upstream
  // Brain2 vault manifest data for this id, or null/undefined when the
  // vault does not name it. Optional for the same reason as the liveness
  // fields above — a partial agent object should still compile.
  vault?: VaultBadgeInfo | null
=======
>>>>>>> Stashed changes
}

interface Issue {
  id: string
  title: string
  status: string
  priority: string
  task_key?: string
  type?: string
  updated_at?: string
}

interface AgentFiles {
  soul: string
  heartbeat: string
  agents: string
}

// agent_runs row shape (see migrations/017_agent_runs_cost.sql + app/api/run-agent/route.ts
// insert). No `type` column exists yet to distinguish heartbeat from task runs — every row
// here is a task run until that lands.
interface AgentRun {
  id: string
  agent_id: string
  task_id?: string | null
  task_title?: string | null
  status?: string | null
  started_at?: string | null
  finished_at?: string | null
  type?: string | null
}

interface AgentDetailViewProps {
  agent: Agent
  onClose: () => void
  /** Called after a successful hard delete, so the caller can drop this
   *  agent from whatever roster state it is holding without waiting for the
   *  next poll. Optional so older call sites still compile; when absent the
   *  card still closes and the DELETE still lands, it just relies on the
   *  next /api/agents poll to reflect it. */
  onRemoved?: (agentId: string) => void
}

// ── Tab types ──────────────────────────────────────────────────────────────────
type TabId = 'dashboard' | 'instructions' | 'skills' | 'configuration' | 'runs' | 'budget'

const TABS: { id: TabId; label: string; icon: React.FC<any> }[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'instructions',  label: 'Instructions',   icon: BookOpen },
  { id: 'skills',        label: 'Skills',         icon: Zap },
  { id: 'configuration', label: 'Configuration',  icon: Settings },
  { id: 'runs',          label: 'Runs',           icon: PlayCircle },
  { id: 'budget',        label: 'Budget',         icon: DollarSign },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(s: string) {
  if (s === 'in_progress') return 'text-amber-400'
  if (s === 'code_review') return 'text-purple-400'
  if (s === 'open')        return 'text-blue-400'
  if (s === 'closed' || s === 'completed' || s === 'released') return 'text-emerald-400'
  if (s === 'backlog')     return 'text-white/30'
  return 'text-white/50'
}

function priorityBadge(p: string) {
  const cls = p === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : p === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : p === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    : 'bg-white/5 text-white/40 border-white/10'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase ${cls}`}>{p}</span>
}

function relTime(ms: number | undefined | null): string {
  if (!ms) return 'Never'
  const diff = Math.round((Date.now() - ms) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`
  return `${Math.round(diff / 1440)}d ago`
}

/**
 * The one place liveness turns into words. Every state names what the SERVER
 * knows, so no reading is ever invented:
 *   live   — a heartbeat arrived in the last minute
 *   stale  — one arrived recently but the agent has missed its last beats
 *   idle   — it checked in at some point, but not for over ten minutes
 *   never  — no heartbeat has EVER been received for this agent
 * The old view showed "Idle" for all four, which made a roster that has never
 * reported anything look identical to one whose agents had just gone quiet.
 */
function livenessLabel(agent: Agent): { text: string; live: boolean; tone: string } {
  const seen = relTime(agent.lastSeenAt ?? null)
  switch (agent.liveness) {
    case 'live':  return { text: `Running — heartbeat ${seen}`, live: true,  tone: 'text-emerald-400' }
    case 'stale': return { text: `Stale — last heartbeat ${seen}`, live: false, tone: 'text-amber-400' }
    case 'idle':  return { text: `Idle — last heartbeat ${seen}`, live: false, tone: 'text-white/40' }
    case 'never': return { text: 'Never checked in', live: false, tone: 'text-white/40' }
    default:      return { text: 'Liveness unknown — no heartbeat data', live: false, tone: 'text-white/40' }
  }
}

// ── Markdown renderer (simple) ────────────────────────────────────────────────
function SimpleMarkdown({ content }: { content: string }) {
  if (!content) return <p className="text-white/30 text-sm italic">No content available.</p>
  const lines = content.split('\n')
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('# '))  return <h1 key={i} className="text-white font-bold text-base mt-4 mb-1">{line.slice(2)}</h1>
        if (line.startsWith('## ')) return <h2 key={i} className="text-white/80 font-semibold text-sm mt-3 mb-1">{line.slice(3)}</h2>
        if (line.startsWith('### ')) return <h3 key={i} className="text-white/70 font-semibold text-xs mt-2 mb-0.5 uppercase tracking-wider">{line.slice(4)}</h3>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <div key={i} className="flex gap-2 text-white/60"><span className="text-white/30 shrink-0">•</span><span>{line.slice(2)}</span></div>
        if (line.startsWith('> '))
          return <blockquote key={i} className="border-l-2 border-white/20 pl-3 text-white/50 italic">{line.slice(2)}</blockquote>
        if (line.match(/^[0-9]+\. /))
          return <div key={i} className="flex gap-2 text-white/60 ml-2"><span className="text-white/30 shrink-0">{line.match(/^[0-9]+/)?.[0]}.</span><span>{line.replace(/^[0-9]+\. /, '')}</span></div>
        if (line.trim() === '') return <div key={i} className="h-1" />
        if (line.startsWith('```')) return <div key={i} className="text-white/20 text-[10px] font-mono">{line}</div>
        return <p key={i} className="text-white/60">{line}</p>
      })}
    </div>
  )
}

// ── Tab: Dashboard ────────────────────────────────────────────────────────────
function DashboardTab({ agent }: { agent: Agent }) {
  // TOD-654: null = failed/not loaded. Never [] on a non-ok response.
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [issuesError, setIssuesError] = useState<ApiError | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchJson<Issue[] | { data?: Issue[] }>(`/api/issues?assignee=${encodeURIComponent(agent.id)}&limit=0`)
      .then(r => {
        if (!r.ok) { setIssuesError(r.error); setIssues(null); setLoading(false); return }
        setIssuesError(null)
        const data = r.data
        setIssues(Array.isArray(data) ? data : data?.data ?? [])
        setLoading(false)
      })
  }, [agent.id, reload])

  const loaded     = issues ?? []
  const inProgress = loaded.filter(i => i.status === 'in_progress').length
  const inReview   = loaded.filter(i => i.status === 'code_review').length
  const open       = loaded.filter(i => i.status === 'open').length
  const active     = loaded.filter(i => ['in_progress','code_review','open'].includes(i.status))

  // `agent.status` is one of active/scheduled/idle — it was never 'running',
  // so this indicator was hard-wired off. Liveness now comes from the same
  // heartbeat field /api/agents computes it from.
  const live = livenessLabel(agent)
  const isRunning = live.live

  return (
    <div className="space-y-5">
      {/* TOD-654: a refused issue query is stated, never rendered as 0 counts. */}
      {issuesError && <ApiErrorBanner error={issuesError} onRetry={() => setReload(n => n + 1)} />}
      {/* Live Run indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isRunning
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-white/10 bg-[#0f0f0f]'
      }`}>
        <span className={`inline-block w-2 h-2 rounded-full ${
          isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'
        }`} />
        <span className={`text-xs font-medium ${live.tone}`}>
          {live.text}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'In Progress', value: inProgress, icon: Activity,      color: 'text-amber-400' },
          { label: 'In Review',   value: inReview,   icon: Code2,         color: 'text-purple-400' },
          { label: 'Open',        value: open,        icon: AlertCircle,   color: 'text-blue-400' },
          { label: 'Cost this week', value: '—',      icon: DollarSign,    color: 'text-white/40' },
        ].map(s => (
          <div key={s.label} className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
            <s.icon size={14} className={`${s.color} mb-1`} />
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-white/30 text-[10px]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Last active */}
      <div className="flex items-center gap-2 text-white/40 text-xs">
        <Clock size={12} />
        <span>Last active: <span className="text-white/60">{relTime(agent.lastUpdatedAt)}</span></span>
        {agent.currentTask && (
          <span className="ml-2 text-emerald-400/70 truncate max-w-[200px]">↳ {agent.currentTask}</span>
        )}
      </div>

      {/* Charts placeholder row */}
      <div className="grid grid-cols-2 gap-3">
        {['Run Activity', 'Issues by Priority', 'Issues by Status', 'Success Rate'].map(title => (
          <div key={title} className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-white/30" />
              <p className="text-white/50 text-xs font-semibold">{title}</p>
            </div>
            <p className="text-white/20 text-xs italic">Chart coming soon</p>
          </div>
        ))}
      </div>

      {/* Active issues list */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Active Issues</p>
        {loading && <p className="text-white/20 text-xs">Loading…</p>}
        {!loading && active.length === 0 && (
          <p className="text-white/20 text-xs italic">No active issues assigned.</p>
        )}
        <div className="space-y-2">
          {active.slice(0, 10).map(issue => (
            <div key={issue.id} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <CheckCircle2 size={12} className={statusColor(issue.status)} />
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs truncate">{issue.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {issue.task_key && <span className="text-[9px] text-white/30 font-mono">{issue.task_key}</span>}
                  <span className={`text-[9px] ${statusColor(issue.status)}`}>{issue.status.replace('_',' ')}</span>
                </div>
              </div>
              {issue.priority && priorityBadge(issue.priority)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab: Instructions ─────────────────────────────────────────────────────────
function InstructionsTab({ agent }: { agent: Agent }) {
  const [files, setFiles] = useState<AgentFiles | null>(null)
  const [filesError, setFilesError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFile, setActiveFile] = useState<'soul' | 'heartbeat' | 'agents'>('soul')
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    fetchJson<AgentFiles>(`/api/agents/${agent.id}/files`)
      .then(r => {
        if (!r.ok) { setFilesError(r.error); setFiles(null); setLoading(false); return }
        setFilesError(null)
        setFiles(r.data)
        setLoading(false)
      })
  }, [agent.id])

  // Reset edit mode on file tab switch
  useEffect(() => {
    setIsEditing(false)
    setSaveError('')
  }, [activeFile])

  function startEditing() {
    setEditContent(files?.[activeFile] ?? '')
    setSaveError('')
    setIsEditing(true)
  }

  function cancelEditing() {
    setIsEditing(false)
    setSaveError('')
  }

  function saveFile() {
    setSaveError('')
    fetch(`/api/agents/${agent.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: activeFile, content: editContent }),
    })
      .then(r => {
        if (!r.ok) throw new Error('Save failed')
        return r.json()
      })
      .then(() => {
        setFiles(prev => prev ? { ...prev, [activeFile]: editContent } : prev)
        setIsEditing(false)
      })
      .catch(() => setSaveError('Failed to save'))
  }

  const tabs: { key: typeof activeFile; label: string; icon: string }[] = [
    { key: 'soul',      label: 'SOUL.md',      icon: '🧠' },
    { key: 'heartbeat', label: 'HEARTBEAT.md', icon: '💓' },
    { key: 'agents',    label: 'AGENTS.md',    icon: '📋' },
  ]

  return (
    <div className="space-y-4">
      {filesError && <ApiErrorBanner error={filesError} />}
      <div className="flex items-center gap-2">
        <div className="flex gap-2 flex-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveFile(t.key)}
              className={`px-2.5 py-1 rounded-lg text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ${
                activeFile === t.key
                  ? 'border-white/20 bg-white/10 text-white'
                  : 'border-white/10 bg-transparent text-white/40 hover:text-white/60'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <Edit3 size={12} className="mr-1" /> Edit
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-white/10 p-4 min-h-[300px] overflow-y-auto max-h-[500px] bg-[#080808]">
        {loading ? (
          <p className="text-white/20 text-xs">Loading…</p>
        ) : isEditing ? (
          <div className="space-y-3">
            <textarea
              className="w-full min-h-[280px] bg-transparent text-white/70 text-sm font-mono resize-y outline-none border border-white/10 rounded-lg p-3"
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
            />
            {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={saveFile}>
                <Save size={12} className="mr-1" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEditing}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <SimpleMarkdown content={files?.[activeFile] ?? ''} />
        )}
      </div>
    </div>
  )
}

// ── Tab: Skills ───────────────────────────────────────────────────────────────
function SkillsTab({ agent }: { agent: Agent }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped skill rows
  const [skills, setSkills] = useState<any[]>([])
  const [skillsError, setSkillsError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wide health payload
    fetchJson<any>('/api/status')
      .then(r => {
        if (!r.ok) { setSkillsError(r.error); setSkills([]); setLoading(false); return }
        setSkillsError(null)
        const data = r.data
        const agentSkills = data?.skills ?? data?.agents?.skills ?? []
        if (Array.isArray(agentSkills)) {
          setSkills(agentSkills)
        } else {
          // Fallback: parse skills from the capabilities of the agent
          setSkills(agent.capabilities.map(c => ({ name: c, description: '', location: '' })))
        }
        setLoading(false)
      })
      .catch(() => {
        setSkills(agent.capabilities.map(c => ({ name: c, description: '', location: '' })))
      })
      .finally(() => setLoading(false))
  }, [agent.id])

  // Also list capabilities as built-in
  const builtIn = agent.capabilities.map(c => ({ name: c, description: `Built-in capability: ${c}`, location: 'system', builtin: true }))

  return (
    <div className="space-y-4">
      {skillsError && <ApiErrorBanner error={skillsError} />}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Built-in Capabilities</p>
        <div className="space-y-2">
          {builtIn.map(s => (
            <div key={s.name} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <Zap size={12} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-white/70 text-xs font-medium">{s.name}</p>
                {s.description && <p className="text-white/30 text-[10px] mt-0.5">{s.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!loading && skills.length > 0 && (
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Installed Skills</p>
          <div className="space-y-2">
            {skills.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
                <FileText size={12} className="text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-white/70 text-xs font-medium">{s.name ?? s.id ?? `Skill ${i + 1}`}</p>
                  {s.description && <p className="text-white/30 text-[10px] mt-0.5">{s.description}</p>}
                  {s.location && <p className="text-white/20 text-[9px] font-mono mt-0.5">{s.location}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && <p className="text-white/20 text-xs">Loading skills…</p>}
    </div>
  )
}

// ── Tab: Configuration ────────────────────────────────────────────────────────
//
// agent-config-panel-truth piece (round 3): the model rows come from GET
// /api/run-agent?info=1&agent=<id> — the same guard-free resolver
// (lib/resolve-dispatch-model.ts's `resolveDispatchModel()`, walking
// `modelChain` then `mapModel()` against the live `${LLM_BASE_URL}/models`
// roster when openai-api wins) that POST /api/run-agent's real spawn path
// uses AND that GET /api/agents now uses to compute every row's
// `model`/`modelShort` — so this panel and the header badge above it (which
// just renders `agent.modelShort`, no client-side re-derivation any more)
// can never disagree again. A 4xx/5xx from that endpoint, or a null
// `mapModel()` result, renders "not resolvable — <the endpoint's own
// message>"; nothing here ever falls back to `agent.model`, AGENTS.md text,
// or an env-URL heuristic (the deleted lib/vault-badge.ts's
// resolveVaultBadge() + `localProviderConfigured`).
interface RunAgentInfoAlternative {
  label: string
  reason: string
}

interface RunAgentInfo {
  agent: string
  resolvedRuntime: string
  modelAlias: string
  resolvedModelId: string | null
  resolvedModelError: string | null
  alternatives: RunAgentInfoAlternative[]
  chainLength: number
  dispatchEnabled: boolean
}

function ConfigurationTab({ agent }: { agent: Agent }) {
  const [row, setRow] = useState<Agent | null>(null)
  const [configError, setConfigError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<RunAgentInfo | null>(null)
  const [infoError, setInfoError] = useState<ApiError | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchJson<{ agents?: Agent[] }>('/api/agents')
      .then(r => {
        if (!r.ok) { setConfigError(r.error); setRow(null); setLoading(false); return }
        setConfigError(null)
        const agentsList: Agent[] = Array.isArray(r.data?.agents) ? r.data.agents : []
        const found = agentsList.find(a => a.id === agent.id)
        setRow(found ?? null)
        setLoading(false)
      })
  }, [agent.id])

  useEffect(() => {
    setInfoLoading(true)
    fetchJson<RunAgentInfo>(`/api/run-agent?info=1&agent=${encodeURIComponent(agent.id)}`)
      .then(r => {
        if (!r.ok) { setInfoError(r.error); setInfo(null); setInfoLoading(false); return }
        setInfoError(null)
        setInfo(r.data)
        setInfoLoading(false)
      })
  }, [agent.id])

  // Prefer the fresh /api/agents row; fall back to the prop this modal was
  // opened with (same shape, one poll older) while the fetch above is still
  // in flight or failed — never a fabricated intermediate value.
  const live: Agent = row ?? agent

  // Same three states livenessLabel() already renders on the Dashboard tab,
  // plus the one case that is not a state at all: livenessSource === 'none'
  // means the server could not read a heartbeat store this request, so no
  // liveness claim — live, stale, idle, OR "Disabled" — can honestly be made.
  const heartbeatValue = live.livenessSource === 'none' ? 'not measured' : livenessLabel(live).text

  let wouldRunLabel: string
  if (infoError) {
    wouldRunLabel = `not resolvable — ${formatApiError(infoError, 'endpoint error')}`
  } else if (infoLoading || !info) {
    wouldRunLabel = 'Loading…'
  } else if (info.resolvedRuntime === 'openai-api') {
    wouldRunLabel = info.resolvedModelId
      ? `openai-api · ${info.resolvedModelId}`
      : `not resolvable — ${info.resolvedModelError ?? 'the endpoint gave no reason'}`
  } else {
    wouldRunLabel = `${info.resolvedRuntime} · ${info.modelAlias}`
  }

  const alternatives = info?.alternatives ?? []

  const otherRows: { label: string; value: string | undefined }[] = [
    { label: 'Heartbeat',  value: heartbeatValue },
    { label: 'Workspace',  value: live.workspace || '—' },
    { label: 'Agent ID',   value: live.id },
  ]

  return (
    <div className="space-y-3">
      {configError && <ApiErrorBanner error={configError} />}
      {loading && !configError && <p className="text-white/20 text-xs">Loading…</p>}

      <div className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 border border-white/10 bg-[#0f0f0f]">
        <p className="text-white/30 text-[10px] uppercase tracking-wider">Would run</p>
        <p className="text-white/70 text-xs font-mono break-all">{wouldRunLabel}</p>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg px-3 py-2.5 border border-white/10 bg-[#0f0f0f]">
        <p className="text-white/30 text-[10px] uppercase tracking-wider">Alternatives</p>
        {infoError ? (
          <p className="text-white/40 text-xs">{formatApiError(infoError, 'endpoint error')}</p>
        ) : infoLoading && !info ? (
          <p className="text-white/20 text-xs">Loading…</p>
        ) : alternatives.length === 0 ? (
          <p className="text-white/40 text-xs">none — this agent has no other binding to fall back to</p>
        ) : (
          <ul className="space-y-1.5">
            {alternatives.map((a, i) => (
              <li key={`${a.label}-${i}`} className="text-xs leading-snug">
                <span className="text-white/60 font-mono break-all">{a.label}</span>
                <span className="text-white/30"> — {a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {otherRows.map(r => (
        <div key={r.label} className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 border border-white/10 bg-[#0f0f0f]">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">{r.label}</p>
          <p className="text-white/70 text-xs font-mono break-all">{r.value ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}

// ── Tab: Runs ─────────────────────────────────────────────────────────────────
function RunsTab({ agent }: { agent: Agent }) {
  const [subTab, setSubTab] = useState<'task' | 'heartbeat'>('task')
  // run-agent-locally piece: which run's trace is expanded, if any. One at a
  // time — a second click on the same row collapses it.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  // Real agent_runs rows for this agent, through the same session-gated db proxy
  // OfficeCanvas/useAgentStatus already use — not a bespoke /api/agents/:id/runs
  // endpoint that never existed. A failed load leaves `runs` null so the empty
  // state below can never paint over a 403/500/network error.
  const { data: runs, error, loading, refetch } = useApiData<AgentRun[]>(
    dbUrl(`agent_runs?agent_id=eq.${encodeURIComponent(agent.id)}&order=started_at.desc&limit=50`)
  )

  const lastActiveStr = relTime(agent.lastUpdatedAt)
  const hasActivity = agent.lastUpdatedAt && agent.lastUpdatedAt > 0

  const filteredRuns = (runs ?? []).filter(r => subTab === 'heartbeat' ? r.type === 'heartbeat' : r.type !== 'heartbeat')

  return (
    <div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {(['task', 'heartbeat'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ${
              subTab === t
                ? 'bg-white/10 text-white border border-white/20'
                : 'text-white/40 hover:text-white/60 border border-transparent'
            }`}
          >
            {t === 'task' ? 'Task Runs' : 'Heartbeat Runs'}
          </button>
        ))}
      </div>

      {/* Last Session card */}
      {hasActivity && (
        <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-emerald-400" />
            <p className="text-white/70 text-xs font-semibold">Last Session</p>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/30">Last active</span>
              <span className="text-white/60">{lastActiveStr}</span>
            </div>
            {agent.currentTask && (
              <div className="flex justify-between text-xs">
                <span className="text-white/30">Current task</span>
                <span className="text-white/60 truncate max-w-[60%]">{agent.currentTask}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-white/30">Model</span>
              <span className="text-white/60 font-mono">{agent.modelShort}</span>
            </div>
          </div>
        </div>
      )}

      {/* Runs list */}
      {error ? (
        <ApiErrorBanner error={error} onRetry={refetch} />
      ) : loading ? (
        <p className="text-white/20 text-xs">Loading…</p>
      ) : filteredRuns.length > 0 ? (
        <div className="space-y-2">
          {filteredRuns.map((run, i: number) => (
            <div key={run.id ?? i}>
              <button
                type="button"
                onClick={() => run.id && setExpandedRunId(id => id === run.id ? null : run.id!)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f] text-left hover:border-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                title="Open this run's trace — every model call and tool call it made"
              >
                <PlayCircle size={12} className="text-white/30 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white/70 text-xs truncate">{run.task_title ?? `Run #${i + 1}`}</p>
                  <p className="text-white/30 text-[10px]">{run.started_at ? relTime(new Date(run.started_at).getTime()) : '—'}</p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${
                  run.status === 'done' || run.status === 'success' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : run.status === 'error' || run.status === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'bg-white/5 text-white/40 border-white/10'
                }`}>{run.status ?? 'unknown'}</span>
              </button>
              {expandedRunId === run.id && run.id && <AgentRunTrace runId={run.id} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <PlayCircle size={32} className="text-white/20" />
          <p className="text-white/40 text-sm">No run history yet</p>
          <p className="text-white/20 text-xs">Run data will appear here once the agent has been active.</p>
        </div>
      )}
    </div>
  )
}

// ── Tab: Budget ───────────────────────────────────────────────────────────────
//
// TOD-2381 (agent-budget-stop) round 3: this tab used to POST to
// /api/agents/{id}/config, a route that has never existed (a 404 every save
// silently swallowed), and its "Projected Monthly" figure multiplied a
// hardcoded avgTokens=2000 guess by a heartbeat cadence — never a real number.
// It now reads and writes the actual enforcement path: GET/PATCH
// /api/agents/{id}/budget, backed by lib/agent-budget.ts and the same
// agent_runs/token_ledger rows the dispatch and heartbeat ceiling checks read.
interface BudgetGetResponse {
  budget: {
    period: 'run' | 'daily' | 'monthly'
    limitUsd: number | null
    maxConcurrentPerAgent: number
    maxRunMs: number
    noProgressHeartbeats: number
    maxRunsPerPeriod: number
    source: 'row' | 'default' | 'unavailable'
  }
  spend: {
    runningNow: number
    runningTotalAllAgents: number
    runsInLast24h: number
    spendUsdThisPeriod: number | null
    spendError: string | null
    overConcurrency: boolean
    overRunCount: boolean
    overDollarBudget: boolean
  }
  overCeiling: { ceiling: string; reason?: string } | null
}

function BudgetTab({ agent }: { agent: Agent }) {
  const { data, error, loading, refetch } = useApiData<BudgetGetResponse>(`/api/agents/${agent.id}/budget`)
  const [limitUsd, setLimitUsd] = useState('')
  const [maxRunsPerPeriod, setMaxRunsPerPeriod] = useState('')
  const [maxConcurrentPerAgent, setMaxConcurrentPerAgent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(null)

  // Seed the editable fields from the server once per load — never on every
  // render, or a keystroke would be stomped by the next poll.
  useEffect(() => {
    if (!data) return
    setLimitUsd(data.budget.limitUsd == null ? '' : String(data.budget.limitUsd))
    setMaxRunsPerPeriod(String(data.budget.maxRunsPerPeriod))
    setMaxConcurrentPerAgent(String(data.budget.maxConcurrentPerAgent))
  }, [data])

  async function saveBudget() {
    setSaving(true)
    setSaveError(null)
    const body: Record<string, unknown> = {
      maxRunsPerPeriod: Number(maxRunsPerPeriod),
      maxConcurrentPerAgent: Number(maxConcurrentPerAgent),
      limitUsd: limitUsd.trim() === '' ? null : Number(limitUsd),
    }
    const r = await fetchJson<{ ok: boolean }>(`/api/agents/${agent.id}/budget`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!r.ok) { setSaveError(r.error); return }
    refetch()
  }

  const rate = estimateModelRateUsd(agent.model)
  const schemaUnavailable = data?.budget.source === 'unavailable'

  return (
    <div className="space-y-5">
      {error && <ApiErrorBanner error={error} />}
      {saveError && <ApiErrorBanner error={saveError} />}
      <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Budget &amp; Ceilings</p>

      {loading && !data && <p className="text-white/20 text-xs">Loading…</p>}

      {schemaUnavailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          Ceiling schema not migrated on this database — every dispatch for this
          agent is being refused (fail-closed) rather than run with an
          unverifiable ceiling. Apply migrations/038_agent_budgets_and_ceilings.sql.
        </div>
      )}

      {data?.overCeiling && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 font-medium">
          Over ceiling — {data.overCeiling.ceiling}
          {data.overCeiling.reason ? `: ${data.overCeiling.reason}` : ''}
        </div>
      )}

      {/* Stat cards — real numbers from the enforcement path, never an estimate */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Spend (period)', value: data?.spend.spendUsdThisPeriod != null ? `$${data.spend.spendUsdThisPeriod.toFixed(4)}` : data?.spend.spendError ? 'error' : '—' },
          { label: 'Runs (24h)', value: data ? `${data.spend.runsInLast24h}/${data.budget.maxRunsPerPeriod}` : '—' },
          { label: 'Running now', value: data ? `${data.spend.runningNow}/${data.budget.maxConcurrentPerAgent}` : '—' },
        ].map(s => (
          <div key={s.label} className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
            <p className="text-white/30 text-[10px] mb-1">{s.label}</p>
            <p className="text-white/70 text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Ceilings — the operator's lever. PATCH /api/agents/{id}/budget is
          how "set a deliberately tiny limit and show it refuse" is done for
          real (piece brief's own words for the required demonstration). */}
      <div className="rounded-xl border border-white/10 p-4 space-y-3 bg-[#0f0f0f]">
        <p className="text-white/50 text-xs font-semibold">Ceilings</p>
        <div className="space-y-2">
          <label className="block">
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Max runs / 24h — bounds a self-retriggering loop</span>
            <Input
              type="number"
              value={maxRunsPerPeriod}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxRunsPerPeriod(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Max concurrent runs (this agent)</span>
            <Input
              type="number"
              value={maxConcurrentPerAgent}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxConcurrentPerAgent(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Dollar limit — dormant on a local-model host (rate ${rate.toFixed(2)}/1M)</span>
            <Input
              type="number"
              placeholder="No limit set"
              value={limitUsd}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimitUsd(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
        <Button variant="secondary" size="sm" onClick={saveBudget} disabled={saving || !data}>
          {saving ? 'Saving…' : 'Save ceilings'}
        </Button>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AgentDetailView({ agent, onClose, onRemoved }: AgentDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  // agent-config-panel-truth piece (round 3): `agent.modelShort`/`agent.model`
  // now ARE the resolved-dispatch label — GET /api/agents computes them
  // server-side via lib/resolve-dispatch-model.ts's `resolveDispatchModel()`,
  // the same chain walk the Configuration tab's GET /api/run-agent?info=1
  // call runs, for every row. This header used to re-derive its own label
  // via the deleted lib/vault-badge.ts's resolveVaultBadge() + an env-URL
  // heuristic — which is exactly what let this modal show the header badge
  // "qwen2.5-coder:14b" one screen above a Configuration panel that called
  // that same model "not selected". No client-side re-derivation needed
  // any more: `agent` already carries the truth.
  const displayAgent: Agent = agent
  const [isEditing, setIsEditing] = useState(false)
  // Result of the header's two write actions. A refused write shows the
  // server's real status and message in the same ApiErrorBanner every loader
  // in this file uses — never an alert() that says the action succeeded
  // because the promise happened to resolve.
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  // Two clicks to remove: the first arms it (button switches to "Confirm
  // Remove"), the second actually sends the DELETE. Cheaper than a modal for
  // a destructive-but-recoverable-by-reconnecting action, and it means no
  // click can hard-delete a row by accident.
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Reset edit mode on tab switch
  useEffect(() => {
    setIsEditing(false)
  }, [activeTab])

  async function handleAssignTask() {
    setActionError(null); setActionNote(null)
    const r = await fetchJson<{ task_key?: string }>('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Task for ' + agent.name,
        assignee: agent.id,
        project: 'Mission Control',
        type: 'task',
        priority: 'medium',
        status: 'backlog',
        acceptance_criteria: 'Define acceptance criteria',
      }),
    })
    if (!r.ok) { setActionError(r.error); return }
    setActionNote(`Task ${r.data?.task_key ?? ''} assigned to ${agent.name}`.replace('  ', ' '))
  }

  async function handleRunHeartbeat() {
    setActionError(null); setActionNote(null)
    // POST /api/agents/<id>/heartbeat records a check-in; the response carries
    // the timestamp and the liveness the server derived from it, so the button
    // reports what was actually written instead of asserting success.
    const r = await fetchJson<{ last_seen?: string; liveness?: string; warning?: string | null }>(
      `/api/agents/${agent.id}/heartbeat`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
    )
    if (!r.ok) { setActionError(r.error); return }
    const when = r.data?.last_seen ? new Date(r.data.last_seen).toLocaleTimeString() : 'now'
    setActionNote(
      `Heartbeat recorded at ${when} — ${agent.name} is ${r.data?.liveness ?? 'live'}` +
      (r.data?.warning ? ` (${r.data.warning})` : ''),
    )
  }

  // Permanent removal — only real for a self-registered agent, since
  // DELETE /api/agents/{id} hard-deletes the `agent_registrations` row and
  // an AGENTS.md-defined agent has no such row to delete.
  async function handleRemove() {
    if (!confirmingRemove) { setConfirmingRemove(true); return }
    setActionError(null); setActionNote(null); setRemoving(true)
    const r = await fetchJson<{ ok?: boolean; warning?: string | null }>(
      `/api/agents/${encodeURIComponent(agent.id)}`,
      { method: 'DELETE' },
    )
    setRemoving(false)
    if (!r.ok) { setActionError(r.error); setConfirmingRemove(false); return }
    onRemoved?.(agent.id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl md:rounded-2xl rounded-t-2xl border border-white/10 bg-[#080808] flex flex-col max-h-[92vh] md:max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
          <div
            className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-2xl md:text-3xl shrink-0"
            style={{ background: agent.color + '18', border: '1px solid ' + agent.color + '30' }}
          >
            {agent.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-white font-semibold text-base">{agent.name}</p>
              <Dot status={agent.status} />
              {agent.status === 'planned' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/50 bg-[#0f0f0f] font-semibold uppercase">Planned</span>
              )}
              {agent.type === 'consultant' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/50 text-purple-300 bg-purple-500/10 font-semibold">Consultant</span>
              )}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{displayAgent.modelShort}</span>
              {agent.vault && (
                <span
                  className="text-[8px] px-1.5 py-0.5 rounded-full border border-purple-500/40 text-purple-300 bg-purple-500/10 font-semibold"
                  title="Resolved from the Brain2 vault manifest (Global_Agents/<id>/manifest.json)"
                >
                  Brain2
                </span>
              )}
            </div>
            <p className="text-white/50 text-xs">{agent.role}</p>
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <AgentLaunchControl agentId={agent.id} vault={agent.vault} />
            <Button variant="secondary" size="sm" onClick={handleAssignTask}>
              <Plus size={12} className="mr-1" /> Assign Task
            </Button>
            <Button variant="secondary" size="sm" onClick={handleRunHeartbeat}>
              <Heart size={12} className="mr-1" /> Run Heartbeat
            </Button>
            <Button variant="ghost" size="sm" disabled>
              <Pause size={12} className="mr-1" /> Pause
            </Button>
            {/* Only a self-registered agent (rosterSource 'registered') has a
                row DELETE /api/agents/{id} can actually remove — an
                AGENTS.md-defined agent has none, so the button does not even
                render for it rather than offering an action that would 404. */}
            {agent.rosterSource === 'registered' && (
              <Button
                variant={confirmingRemove ? 'danger' : 'ghost'}
                size="sm"
                onClick={handleRemove}
                disabled={removing}
                title="Hard-delete this agent's registration — the roster stops naming it at all"
              >
                <Trash2 size={12} className="mr-1" />
                {removing ? 'Removing…' : confirmingRemove ? 'Confirm Remove' : 'Remove'}
              </Button>
            )}
            <Button variant="icon" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Outcome of the header actions — stated, never assumed. */}
        {(actionError || actionNote) && (
          <div className="px-5 pt-3 shrink-0">
            {actionError && <ApiErrorBanner error={actionError} />}
            {actionNote && (
              <p className="text-emerald-400/80 text-[11px] rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                {actionNote}
              </p>
            )}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-white/10 overflow-x-auto shrink-0 no-scrollbar">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs whitespace-nowrap transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-white/30 ${
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                }`}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'dashboard'     && <DashboardTab     agent={displayAgent} />}
          {activeTab === 'instructions'  && <InstructionsTab  agent={displayAgent} />}
          {activeTab === 'skills'        && <SkillsTab        agent={displayAgent} />}
          {activeTab === 'configuration' && <ConfigurationTab agent={displayAgent} />}
          {activeTab === 'runs'          && <RunsTab          agent={displayAgent} />}
          {activeTab === 'budget'        && <BudgetTab        agent={displayAgent} />}
        </div>
      </div>
    </div>
  )
}
