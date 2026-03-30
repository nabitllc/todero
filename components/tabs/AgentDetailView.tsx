'use client'
import React, { useState, useEffect } from 'react'
import { Chip, Dot } from '@/lib/mc-atoms'
import { Button } from '@/components/ui'
import {
  LayoutDashboard, BookOpen, Zap, Settings, PlayCircle,
  ChevronRight, X, RefreshCw, Clock, CheckCircle2, Code2,
  AlertCircle, FileText, Activity
} from 'lucide-react'

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
type TabId = 'dashboard' | 'instructions' | 'skills' | 'configuration' | 'runs'

const TABS: { id: TabId; label: string; icon: React.FC<any> }[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'instructions',  label: 'Instructions',   icon: BookOpen },
  { id: 'skills',        label: 'Skills',         icon: Zap },
  { id: 'configuration', label: 'Configuration',  icon: Settings },
  { id: 'runs',          label: 'Runs / Budget',  icon: PlayCircle },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(s: string) {
  if (s === 'in_progress') return 'text-amber-400'
  if (s === 'code_review') return 'text-purple-400'
  if (s === 'open')        return 'text-blue-400'
  if (s === 'done' || s === 'completed' || s === 'released') return 'text-emerald-400'
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
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/issues')
      .then(r => r.json())
      .then((all: Issue[]) => {
        const mine = all.filter((i: any) => i.assignee === agent.id || i.assignee === agent.name.toLowerCase())
        setIssues(mine)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [agent.id])

  const inProgress = issues.filter(i => i.status === 'in_progress').length
  const inReview   = issues.filter(i => i.status === 'code_review').length
  const open       = issues.filter(i => i.status === 'open').length
  const active     = issues.filter(i => ['in_progress','code_review','open'].includes(i.status))

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'In Progress', value: inProgress, icon: Activity,      color: 'text-amber-400' },
          { label: 'In Review',   value: inReview,   icon: Code2,         color: 'text-purple-400' },
          { label: 'Open',        value: open,        icon: AlertCircle,   color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 border border-white/10" style={{ background: '#0f0f0f' }}>
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

      {/* Active issues list */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Active Issues</p>
        {loading && <p className="text-white/20 text-xs">Loading…</p>}
        {!loading && active.length === 0 && (
          <p className="text-white/20 text-xs italic">No active issues assigned.</p>
        )}
        <div className="space-y-2">
          {active.slice(0, 10).map(issue => (
            <div key={issue.id} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/[0.06]" style={{ background: '#0f0f0f' }}>
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
  const [loading, setLoading] = useState(true)
  const [activeFile, setActiveFile] = useState<'soul' | 'heartbeat' | 'agents'>('soul')

  useEffect(() => {
    fetch(`/api/agents/${agent.id}/files`)
      .then(r => r.json())
      .then(setFiles)
      .catch(() => setFiles({ soul: '', heartbeat: '', agents: '' }))
      .finally(() => setLoading(false))
  }, [agent.id])

  const tabs: { key: typeof activeFile; label: string; icon: string }[] = [
    { key: 'soul',      label: 'SOUL.md',      icon: '🧠' },
    { key: 'heartbeat', label: 'HEARTBEAT.md', icon: '💓' },
    { key: 'agents',    label: 'AGENTS.md',    icon: '📋' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveFile(t.key)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
              activeFile === t.key
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-white/[0.06] bg-transparent text-white/40 hover:text-white/60'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] p-4 min-h-[300px] overflow-y-auto max-h-[500px]" style={{ background: '#0a0a0a' }}>
        {loading ? (
          <p className="text-white/20 text-xs">Loading…</p>
        ) : (
          <SimpleMarkdown content={files?.[activeFile] ?? ''} />
        )}
      </div>
    </div>
  )
}

// ── Tab: Skills ───────────────────────────────────────────────────────────────
function SkillsTab({ agent }: { agent: Agent }) {
  const [skills, setSkills] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get skills from openclaw status endpoint
    fetch('/api/status')
      .then(r => r.json())
      .then((data: any) => {
        const agentSkills = data?.skills ?? data?.agents?.skills ?? []
        if (Array.isArray(agentSkills)) {
          setSkills(agentSkills)
        } else {
          // Fallback: parse skills from the capabilities of the agent
          setSkills(agent.capabilities.map(c => ({ name: c, description: '', location: '' })))
        }
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
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Built-in Capabilities</p>
        <div className="space-y-2">
          {builtIn.map(s => (
            <div key={s.name} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/[0.06]" style={{ background: '#0f0f0f' }}>
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
              <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/[0.06]" style={{ background: '#0f0f0f' }}>
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
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then((data: any) => {
        const agentsList: any[] = data?.agents?.agents ?? []
        const found = agentsList.find((a: any) => a.id === agent.id)
        setConfig(found ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [agent.id])

  const heartbeatCfg = config?.heartbeat ?? {}
  const workspacePath = config?.workspaceDir ?? agent.workspace ?? `/Users/kemuniagent/.openclaw/workspace${agent.id !== 'main' ? '-' + agent.id : ''}`

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
      {loading && <p className="text-white/20 text-xs">Loading…</p>}
      {rows.map(r => (
        <div key={r.label} className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 border border-white/[0.06]" style={{ background: '#0f0f0f' }}>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">{r.label}</p>
          <p className="text-white/70 text-xs font-mono break-all">{r.value ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}

// ── Tab: Runs / Budget ────────────────────────────────────────────────────────
function RunsTab({ agent }: { agent: Agent }) {
  // No agent_runs table in current schema — show placeholder with last-active info
  const lastActiveStr = relTime(agent.lastUpdatedAt)
  const hasActivity = agent.lastUpdatedAt && agent.lastUpdatedAt > 0

  return (
    <div className="space-y-4">
      {hasActivity ? (
        <>
          <div className="rounded-xl border border-white/[0.06] p-4" style={{ background: '#0f0f0f' }}>
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

          <div className="rounded-xl border border-white/[0.06] p-4" style={{ background: '#0f0f0f' }}>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw size={14} className="text-white/40" />
              <p className="text-white/70 text-xs font-semibold">Token Usage / Budget</p>
            </div>
            <p className="text-white/30 text-xs italic">
              Detailed token usage and cost tracking not yet available — requires agent_runs table integration.
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <PlayCircle size={32} className="text-white/20" />
          <p className="text-white/40 text-sm">No run history available</p>
          <p className="text-white/20 text-xs">This agent hasn&apos;t been active yet, or run history hasn&apos;t been recorded.</p>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AgentDetailView({ agent, onClose }: AgentDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl md:rounded-2xl rounded-t-2xl border border-white/10 flex flex-col max-h-[92vh] md:max-h-[85vh]"
        style={{ background: '#080808' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
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
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{agent.modelShort}</span>
            </div>
            <p className="text-white/50 text-xs">{agent.role}</p>
          </div>
          <Button variant="icon" onClick={onClose} className="ml-auto shrink-0">
            <X size={16} />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-white/[0.06] overflow-x-auto shrink-0 no-scrollbar">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors shrink-0 ${
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
        </div>
      </div>
    </div>
  )
}
