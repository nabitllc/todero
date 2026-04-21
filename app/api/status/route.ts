// Agent activity is sourced from the agent_runs table.
import { NextResponse } from 'next/server'
import fs from 'fs'
import { createAdminClient } from '@/lib/hub-client'

const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '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'
const N8N_KEY = process.env.N8N_API_KEY || ''

function getVercelToken(): string | null {
  try {
    const raw = fs.readFileSync('/Users/kemuniagent/Library/Application Support/com.vercel.cli/auth.json', 'utf-8')
    const data = JSON.parse(raw)
    if (data.token) return data.token
    if (data.tokens && typeof data.tokens === 'object') {
      const vals = Object.values(data.tokens)
      if (vals.length > 0) return vals[0] as string
    }
    return null
  } catch { return null }
}

export async function GET() {
  const [openrouter, ollama, n8n, vercel] = await Promise.allSettled([
    // OpenRouter
    fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
      cache: 'no-store',
    }).then(r => r.json()),

    // Ollama
    fetch('http://localhost:11434/api/tags', { cache: 'no-store' }).then(r => r.json()),

    // n8n — retired but kept for backwards compat; will always fail
    N8N_KEY ? fetch('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
      cache: 'no-store',
    }).then(r => r.json()) : Promise.reject('n8n retired'),

    // Vercel
    (async () => {
      const token = getVercelToken()
      if (!token) throw new Error('No Vercel token')
      const r = await fetch(
        'https://api.vercel.com/v6/deployments?app=vespera&limit=1&teamId=team_BPpNtsCP3vmSt4R0r8MXbxiJ',
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
      return r.json()
    })(),
  ])

  const result: any = { gateway: { running: true } }

  // ── OpenRouter ──
  if (openrouter.status === 'fulfilled' && openrouter.value?.data) {
    const d = openrouter.value.data
    const limit = d.limit ?? 10
    const used = d.usage ?? 0
    result.openrouter = { used: +used.toFixed(3), limit, remaining: +(limit - used).toFixed(3) }
  } else {
    result.openrouter = null
  }

  // ── Ollama ──
  if (ollama.status === 'fulfilled' && ollama.value?.models) {
    result.ollama = { running: true, models: ollama.value.models.map((m: any) => m.name) }
  } else {
    result.ollama = { running: false, models: [] }
  }

  // ── n8n — retired ──
  if (n8n.status === 'fulfilled') {
    const workflows: any[] = n8n.value?.data ?? n8n.value ?? []
    const active = workflows.filter((w: any) => w.active).length
    result.n8n = { running: true, activeWorkflows: active, totalWorkflows: workflows.length }
  } else {
    result.n8n = { running: false, activeWorkflows: 0, totalWorkflows: 0 }
  }

  // ── Vercel ──
  if (vercel.status === 'fulfilled' && vercel.value?.deployments?.length) {
    const d = vercel.value.deployments[0]
    result.vercel = {
      lastDeploy: {
        status: d.state || d.readyState || 'UNKNOWN',
        url: d.url || '',
        createdAt: d.createdAt || d.created || 0,
        commitSha: d.meta?.githubCommitSha || d.gitSource?.sha || '',
        branch: d.meta?.githubCommitRef || d.gitSource?.ref || '',
      },
    }
  } else {
    result.vercel = null
  }

  result.channels = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    discord: !!process.env.DISCORD_BOT_TOKEN,
  }
  result.heartbeats = []

  // ── Agent activity from agent_runs ──
  try {
    const db = createAdminClient()
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { data: runs } = await db
      .from('agent_runs')
      .select('agent_id, task_title, status, started_at, finished_at, tokens_used, cost_usd')
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(50)

    const AGENT_EMOJIS: Record<string, string> = {
      builder: '🔨', po: '📋', tester: '🧪', ops: '⚙️', deployer: '🚀',
      auditor: '🔍', main: '🧠', scout: '🔍'
    }
    const agentCurrentTask: Record<string, string> = {}
    const seen = new Set<string>()
    const allActivity: any[] = []

    for (const r of runs ?? []) {
      const agoMin = r.started_at
        ? Math.floor((Date.now() - new Date(r.started_at).getTime()) / 60000)
        : 999
      if (!seen.has(r.agent_id)) {
        seen.add(r.agent_id)
        const label = (r.task_title || 'Task').slice(0, 48)
        agentCurrentTask[r.agent_id] = r.status === 'running'
          ? `Working: ${label}`
          : agoMin < 30 ? `Completed: ${label} (${agoMin}m ago)` : `Idle · last ${agoMin}m ago`
      }
      allActivity.push({
        agentId: r.agent_id,
        agentName: r.agent_id,
        emoji: AGENT_EMOJIS[r.agent_id] ?? '🤖',
        action: 'run',
        desc: `${r.task_title ?? 'Task'} · ${r.status}`,
        tokens: r.tokens_used ?? 0,
        cost: r.cost_usd ?? 0,
        updatedAt: r.started_at ? new Date(r.started_at).getTime() : 0,
        ago: agoMin,
        startedAt: r.started_at ? new Date(r.started_at).getTime() : 0,
      })
    }

    result.recentActivity = allActivity.slice(0, 20)
    result.agentCurrentTask = agentCurrentTask

    // Usage summary from agent_runs
    const today = new Date().toISOString().slice(0, 10)
    const { data: costRows } = await db
      .from('agent_runs')
      .select('tokens_used, cost_usd, started_at')
      .gte('started_at', today)
    const todayCost = (costRows ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    const todayTokens = (costRows ?? []).reduce((s, r) => s + (r.tokens_used ?? 0), 0)
    result.usage = { totalCost: 0, totalTokens: 0, byModel: {}, todayCost: +todayCost.toFixed(4), todayTokens }
    result.claude = { plan: 'Max', lastChecked: new Date().toISOString(), totalTokens: todayTokens, todayCost }
  } catch {
    result.recentActivity = []
    result.agentCurrentTask = {}
    result.usage = null
    result.claude = null
  }

  return NextResponse.json(result)
}
