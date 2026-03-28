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
      }
    })

    return NextResponse.json(agents, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    // Fallback: return empty so UI uses hardcoded defaults
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
  }
}
