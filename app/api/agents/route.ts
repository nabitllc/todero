import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Maps OpenClaw agent IDs to display metadata
const AGENT_META: Record<string, { name: string; emoji: string; role: string; color: string; capabilities: string[]; floor: boolean; [key: string]: any }> = {
  'main':        { name: 'KAOS',        emoji: '🧠', role: 'Chief Orchestrator',   color: '#6b7280', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true },
  'scout':       { name: 'Scout',       emoji: '🔍', role: 'Research Agent',        color: '#a855f7', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true },
  'ops':         { name: 'Ops',         emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true },
  'kemuni-sme':  { name: 'Kemuni SME',  emoji: '🚀', role: 'Kemuni Product Expert', color: '#3b82f6', capabilities: ['Product Strategy', 'Kemuni', 'PropTech'], floor: true },
  'vespera-sme': { name: 'Vespera SME', emoji: '🖤', role: 'Vespera Product Expert', color: '#ec4899', capabilities: ['Product Strategy', 'Vespera', 'Community'], floor: true },
  'builder':     { name: 'Builder',     emoji: '🔨', role: 'Coding Agent',           color: '#f59e0b', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true },
  'tester':      { name: 'Tester',      emoji: '🧪', role: 'QA Agent',               color: '#06b6d4', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true },
  'deployer':    { name: 'Deployer',    emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true },
  'ux':          { name: 'UX Designer',      emoji: '🎨', role: 'UX & Design Agent',        color: '#ec4899', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false },
  'po':          { name: 'Product Owner',    emoji: '📋', role: 'Product Owner',             color: '#f59e0b', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false },
  'growth':      { name: 'Growth',           emoji: '📈', role: 'Growth Strategist',         color: '#10b981', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false },
  'security':    { name: 'Security',         emoji: '🔐', role: 'Security Auditor',          color: '#ef4444', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false },
  'community':   { name: 'Community Mgr',    emoji: '🖤', role: 'Community Manager',         color: '#a78bfa', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false },
  'content':     { name: 'Content Creator',  emoji: '✍️', role: 'Content Creator',           color: '#60a5fa', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false },
  'auditor':     { name: 'Auditor',     emoji: '🔎', role: 'System Truth Enforcer',  color: '#ef4444', capabilities: ['Drift Detection', 'Config Audit', 'Task Hygiene'], floor: true },
}

export async function GET() {
  try {
    const { stdout } = await execAsync('/opt/homebrew/bin/openclaw status --json', { timeout: 8000 })
    const status = JSON.parse(stdout)
    const rawAgents: any[] = status?.agents?.agents ?? []
    const now = Date.now()
    const fiveMin = 5 * 60 * 1000

    // Determine active agents from lastUpdatedAt (sessions is not an array in status --json)
    const activeIds = new Set(
      rawAgents
        .filter((a: any) => now - (a.lastUpdatedAt ?? 0) < fiveMin)
        .map((a: any) => a.id)
    )

    const agents = rawAgents.map((a: any) => {
      const meta = AGENT_META[a.id] ?? { name: a.id, emoji: '🤖', role: a.id, color: '#6b7280', capabilities: [], floor: false }
      const identity = a.identity ?? {}
      const isActive = activeIds.has(a.id) || (now - (a.lastUpdatedAt ?? 0) < fiveMin)

      const rawModel = a.model ?? 'anthropic/claude-sonnet-4-6'
      const modelShort = rawModel.includes('haiku') ? 'Haiku 4.5'
        : rawModel.includes('sonnet') ? 'Sonnet 4.6'
        : rawModel.includes('gemma') ? 'Gemma 3 4B'
        : rawModel.split('/').pop() ?? rawModel

      const lastUpdatedAt = a.lastUpdatedAt ?? 0
      const agoMin = lastUpdatedAt ? Math.round((now - lastUpdatedAt) / 60000) : null
      const currentTask = (a.currentTask ?? a.task ?? '').slice(0, 80) || null

      return {
        id: a.id,
        name: meta.name ?? a.name ?? a.id,
        emoji: meta.emoji,
        role: meta.role ?? a.id,
        status: isActive ? 'active' : (a.id === 'ops' ? 'scheduled' : 'idle'),
        model: rawModel,
        modelShort,
        color: meta.color,
        desc: meta.role ?? '',
        capabilities: meta.capabilities,
        floor: meta.floor,
        workspace: a.workspaceDir,
        sessions: a.sessionsCount ?? 0,
        ago: agoMin,
        lastUpdatedAt,
        currentTask,
      }
    })

    return NextResponse.json(agents, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    // Fallback: return empty so UI uses hardcoded defaults
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
  }
}
