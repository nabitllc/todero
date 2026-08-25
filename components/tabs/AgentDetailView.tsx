'use client'
import React, { useState, useEffect } from 'react'
import { Chip, Dot } from '@/lib/mc-atoms'
import { Button, Input, StatCard, EmptyState } from '@/components/ui'
import {
  LayoutDashboard, BookOpen, Zap, Settings, PlayCircle,
  ChevronRight, X, RefreshCw, Clock, CheckCircle2, Code2,
  AlertCircle, FileText, Activity, BarChart3, DollarSign,
  Edit3, Save, Pause, Plus, Heart
} from 'lucide-react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'

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

interface AgentDetailViewProps {
  agent: Agent
  onClose: () => void
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

  const isRunning = agent.status === 'running'

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
        <span className={`text-xs font-medium ${isRunning ? 'text-emerald-400' : 'text-white/40'}`}>
          {isRunning ? `Running — ${relTime(agent.lastUpdatedAt)}` : 'Idle'}
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
function ConfigurationTab({ agent }: { agent: Agent }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent config row
  const [config, setConfig] = useState<any>(null)
  const [configError, setConfigError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wide health payload
    fetchJson<any>('/api/status')
      .then(r => {
        if (!r.ok) { setConfigError(r.error); setConfig(null); setLoading(false); return }
        setConfigError(null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent rows
        const agentsList: any[] = r.data?.agents?.agents ?? []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent rows
        const found = agentsList.find((a: any) => a.id === agent.id)
        setConfig(found ?? null)
        setLoading(false)
      })
  }, [agent.id])

  const heartbeatCfg = config?.heartbeat ?? {}
  const workspacePath = config?.workspaceDir ?? agent.workspace ?? ''

  const rows: { label: string; value: string | undefined }[] = [
    { label: 'Default Model',    value: config?.model ?? agent.model },
    { label: 'Model (fallback)', value: 'See AGENTS.md routing table' },
    { label: 'Model (escalate)', value: 'See AGENTS.md routing table' },
    { label: 'Heartbeat',        value: heartbeatCfg.every ? `Every ${heartbeatCfg.every}` : 'Disabled' },
    { label: 'Workspace',        value: workspacePath },
    { label: 'Sessions',         value: config?.sessionsCount != null ? String(config.sessionsCount) : '—' },
    { label: 'Agent ID',         value: agent.id },
  ]

  return (
    <div className="space-y-3">
      {configError && <ApiErrorBanner error={configError} />}
      {loading && !configError && <p className="text-white/20 text-xs">Loading…</p>}
      {rows.map(r => (
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
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/agents/${agent.id}/runs`)
      .then(r => {
        if (!r.ok) throw new Error('No runs')
        return r.json()
      })
      .then(data => setRuns(Array.isArray(data) ? data : []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }, [agent.id])

  const lastActiveStr = relTime(agent.lastUpdatedAt)
  const hasActivity = agent.lastUpdatedAt && agent.lastUpdatedAt > 0

  const filteredRuns = runs.filter(r => subTab === 'heartbeat' ? r.type === 'heartbeat' : r.type !== 'heartbeat')

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
      {loading ? (
        <p className="text-white/20 text-xs">Loading…</p>
      ) : filteredRuns.length > 0 ? (
        <div className="space-y-2">
          {filteredRuns.map((run: any, i: number) => (
            <div key={run.id ?? i} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <PlayCircle size={12} className="text-white/30" />
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs truncate">{run.title ?? run.task ?? `Run #${i + 1}`}</p>
                <p className="text-white/30 text-[10px]">{run.created_at ? relTime(new Date(run.created_at).getTime()) : '—'}</p>
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${
                run.status === 'success' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : run.status === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : 'bg-white/5 text-white/40 border-white/10'
              }`}>{run.status ?? 'unknown'}</span>
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
function BudgetTab({ agent }: { agent: Agent }) {
  const [budgetLimit, setBudgetLimit] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent config row
  const [config, setConfig] = useState<any>(null)
  const [budgetError, setBudgetError] = useState<ApiError | null>(null)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wide health payload
    fetchJson<any>('/api/status')
      .then(r => {
        if (!r.ok) { setBudgetError(r.error); setConfig(null); return }
        setBudgetError(null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent rows
        const agentsList: any[] = r.data?.agents?.agents ?? []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent rows
        const found = agentsList.find((a: any) => a.id === agent.id)
        setConfig(found ?? null)
      })
  }, [agent.id])

  // Calculate projected monthly cost
  const heartbeatEvery = config?.heartbeat?.everyMinutes ?? 60
  const avgTokens = 2000
  const modelRates: Record<string, number> = {
    'claude-haiku-4-5': 0.80,
    'claude-sonnet-4-6': 3.00,
  }
  const rate = modelRates[agent.model] ?? 3.00
  const projected = ((1440 / heartbeatEvery) * 30 * avgTokens / 1_000_000 * rate).toFixed(2)

  function saveBudgetLimit() {
    fetch(`/api/agents/${agent.id}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgetLimit: Number(budgetLimit) }),
    })
      .then(r => { if (!r.ok) throw new Error('Failed') })
      .catch(() => alert('Failed to save budget limit'))
  }

  return (
    <div className="space-y-5">
      {budgetError && <ApiErrorBanner error={budgetError} />}
      <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Budget &amp; Token Usage</p>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'This Week', value: '—' },
          { label: 'This Month', value: '—' },
          { label: 'Projected Monthly', value: `$${projected}` },
        ].map(s => (
          <div key={s.label} className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
            <p className="text-white/30 text-[10px] mb-1">{s.label}</p>
            <p className="text-white/70 text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Projection formula */}
      <div className="rounded-xl border border-white/10 p-3 bg-[#0f0f0f]">
        <p className="text-white/30 text-[10px] mb-1">Projection formula</p>
        <p className="text-white/40 text-[10px] font-mono">
          (1440/{heartbeatEvery}) × 30 × {avgTokens} / 1M × ${rate.toFixed(2)} = ${projected}/mo
        </p>
      </div>

      {/* Budget limit */}
      <div className="rounded-xl border border-white/10 p-4 space-y-3 bg-[#0f0f0f]">
        <p className="text-white/50 text-xs font-semibold">Budget Limit</p>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="No limit set"
            value={budgetLimit}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetLimit(e.target.value)}
            className="flex-1"
          />
          <Button variant="secondary" size="sm" onClick={saveBudgetLimit}>Save</Button>
        </div>
      </div>

      {/* Token breakdown */}
      <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
        <p className="text-white/50 text-xs font-semibold mb-3">Token Breakdown</p>
        <div className="space-y-2">
          {['Input tokens', 'Output tokens', 'Cached'].map(label => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-white/30">{label}</span>
              <span className="text-white/50 font-mono">—</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AgentDetailView({ agent, onClose }: AgentDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [isEditing, setIsEditing] = useState(false)

  // Reset edit mode on tab switch
  useEffect(() => {
    setIsEditing(false)
  }, [activeTab])

  function handleAssignTask() {
    fetch('/api/issues', {
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
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        alert('Task assigned to ' + agent.name)
      })
      .catch(() => alert('Failed to create task'))
  }

  function handleRunHeartbeat() {
    fetch(`/api/agents/${agent.id}/heartbeat`, { method: 'POST' })
      .then(() => alert('Heartbeat triggered'))
      .catch(() => alert('Failed to trigger heartbeat'))
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
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{agent.modelShort}</span>
            </div>
            <p className="text-white/50 text-xs">{agent.role}</p>
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <Button variant="secondary" size="sm" onClick={handleAssignTask}>
              <Plus size={12} className="mr-1" /> Assign Task
            </Button>
            <Button variant="secondary" size="sm" onClick={handleRunHeartbeat}>
              <Heart size={12} className="mr-1" /> Run Heartbeat
            </Button>
            <Button variant="ghost" size="sm" disabled>
              <Pause size={12} className="mr-1" /> Pause
            </Button>
            <Button variant="icon" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

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
          {activeTab === 'dashboard'     && <DashboardTab     agent={agent} />}
          {activeTab === 'instructions'  && <InstructionsTab  agent={agent} />}
          {activeTab === 'skills'        && <SkillsTab        agent={agent} />}
          {activeTab === 'configuration' && <ConfigurationTab agent={agent} />}
          {activeTab === 'runs'          && <RunsTab          agent={agent} />}
          {activeTab === 'budget'        && <BudgetTab        agent={agent} />}
        </div>
      </div>
    </div>
  )
}
