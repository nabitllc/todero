import { NextResponse } from 'next/server'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const OPENROUTER_KEY = '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'
const N8N_KEY = 'n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac'

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

function getSessionCosts(sessionsPaths: string[]) {
  let totalCost = 0, totalTokens = 0, todayCost = 0, todayTokens = 0
  const byModel: Record<string, number> = {}
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const p of sessionsPaths) {
    try {
      if (!fs.existsSync(p)) continue
      const stat = fs.statSync(p)
      const isToday = stat.mtimeMs >= todayStart
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const items = typeof raw === 'object' && !Array.isArray(raw) ? Object.values(raw) : (Array.isArray(raw) ? raw : [])
      for (const item of items as any[]) {
        const cost = item?.estimatedCostUsd ?? 0
        const tokens = item?.totalTokens ?? 0
        const model = item?.model ?? 'unknown'
        totalCost += cost
        totalTokens += tokens
        byModel[model] = (byModel[model] ?? 0) + cost
        if (isToday) {
          todayCost += cost
          todayTokens += tokens
        }
      }
    } catch { /* skip */ }
  }
  return { totalCost: +totalCost.toFixed(4), totalTokens, byModel, todayCost: +todayCost.toFixed(4), todayTokens }
}

export async function GET() {
  const [openrouter, ollama, n8n, vercel, ocStatus] = await Promise.allSettled([
    // OpenRouter
    fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
      cache: 'no-store',
    }).then(r => r.json()),

    // Ollama
    fetch('http://localhost:11434/api/tags', { cache: 'no-store' }).then(r => r.json()),

    // n8n
    fetch('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
      cache: 'no-store',
    }).then(r => r.json()),

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

    // OpenClaw status (local CLI)
    execAsync('/opt/homebrew/bin/openclaw status --json', { timeout: 8000 }).then(r => JSON.parse(r.stdout)),
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

  // ── n8n ──
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

  // ── OpenClaw (source of truth) ──
  if (ocStatus.status === 'fulfilled') {
    const oc: any = ocStatus.value

    // Version + update
    result.openclaw = {
      version: oc.runtimeVersion,
      upToDate: oc.update?.registry?.latestVersion === oc.runtimeVersion,
      latestVersion: oc.update?.registry?.latestVersion,
      gatewayRunning: oc.gatewayService?.running ?? true,
      gatewayLatencyMs: oc.gateway?.connectLatencyMs,
    }

    // Channels
    const chSummary: string[] = oc.channelSummary ?? []
    result.channels = {
      telegram: chSummary.some((s: string) => s.includes('Telegram: configured')),
      discord: chSummary.some((s: string) => s.includes('Discord: configured')),
    }

    // Heartbeat schedule per agent
    const hbAgents: any[] = oc.heartbeat?.agents ?? []
    result.heartbeats = hbAgents.map((a: any) => ({
      agentId: a.agentId,
      enabled: a.enabled,
      every: a.every,
    }))

    // Token usage from session files
    const sessionPaths: string[] = oc.sessions?.paths ?? []
    const costs = getSessionCosts(sessionPaths)
    result.usage = costs
  } else {
    result.openclaw = null
    result.channels = null
    result.heartbeats = null
    result.usage = null
  }

  // ── Recent Activity + Agent current tasks from all agent sessions ──
  try {
    const AGENT_NAMES: Record<string,string> = {
      main:'KAOS', scout:'Scout', ops:'Ops', 'kemuni-sme':'Kemuni SME', 'vespera-sme':'Vespera SME'
    }
    const AGENT_EMOJIS: Record<string,string> = {
      main:'🧠', scout:'🔍', ops:'⚙️', 'kemuni-sme':'🚀', 'vespera-sme':'🖤'
    }
    const allAgentIds = ['main', 'scout', 'ops', 'kemuni-sme', 'vespera-sme']
    const allActivity: any[] = []
    const agentCurrentTask: Record<string, string> = {}

    for (const agentId of allAgentIds) {
      const sessionsPath = `/Users/kemuniagent/.openclaw/agents/${agentId}/sessions/sessions.json`
      if (!fs.existsSync(sessionsPath)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'))
        const entries = Object.entries(raw as Record<string, any>)
          .filter(([, v]) => v && typeof v === 'object')
          .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

        // Most recent session = current task
        if (entries.length > 0) {
          const [key, val] = entries[0] as [string, any]
          const channel = key.split(':')[2] || 'session'
          const agoMin = Math.floor((Date.now() - (val.updatedAt ?? Date.now())) / 60000)
          const tokens = val.totalTokens ?? 0
          // Check actual session file mtime for real-time "currently processing" detection
          let fileMtimeSec = 9999
          try {
            const sf = (val as any).sessionFile
            if (sf && fs.existsSync(sf)) {
              fileMtimeSec = Math.floor((Date.now() - fs.statSync(sf).mtimeMs) / 1000)
            }
          } catch { /* non-fatal */ }
          const isActive = agoMin < 10 || fileMtimeSec < 30
          const channelLabel = channel === 'telegram' ? 'Telegram' : channel === 'discord' ? 'Discord'
            : channel === 'cron' ? 'Cron' : channel === 'subagent' ? 'Sub-agent' : 'Session'

          // Try to get last user message from session JSONL for real task label
          let lastUserMsg = ''
          try {
            const sessionFile = (val as any).sessionFile
            if (sessionFile && isActive) {
              const jsonlPath = sessionFile.startsWith('/')
                ? sessionFile
                : `/Users/kemuniagent/.openclaw/agents/${agentId}/sessions/${sessionFile}`
              if (fs.existsSync(jsonlPath)) {
                const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean)
                // Walk backwards to find last user message
                for (let i = lines.length - 1; i >= 0; i--) {
                  try {
                    const obj = JSON.parse(lines[i])
                    const msg = obj.message ?? obj
                    if (msg.role === 'user') {
                      const content = msg.content
                      let text = typeof content === 'string' ? content
                        : Array.isArray(content) ? (content.find((b: any) => b.type === 'text')?.text ?? '') : ''
                      // Strip metadata headers from MC/Telegram messages
                      text = text.replace(/^Sender \(untrusted[^)]+\)[^]*?\n\n/m, '')
                        .replace(/^\[.*?\]\s*/m, '')
                        .trim()
                      if (text && text.length > 3 && !text.startsWith('[') && !text.startsWith('Read HEARTBEAT')) {
                        lastUserMsg = text.slice(0, 48).replace(/\n/g, ' ')
                        break
                      }
                    }
                  } catch { continue }
                }
              }
            }
          } catch { /* non-fatal */ }

          const isLive = fileMtimeSec < 30
          agentCurrentTask[agentId] = isActive
            ? (lastUserMsg ? `${isLive ? 'Processing' : 'Active'}: ${lastUserMsg}` : `${isLive ? 'Processing' : 'Active'} on ${channelLabel} · ${(tokens/1000).toFixed(1)}k tokens`)
            : agoMin < 60 ? `Last: ${channelLabel} ${agoMin}m ago` : `Idle · last ${Math.floor(agoMin/60)}h ago`
        }

        // Collect activity entries
        for (const [key, val] of entries.slice(0, 10) as [string, any][]) {
          const channel = key.split(':')[2] || 'session'
          const tokens = val.totalTokens ?? 0
          const cost = val.estimatedCostUsd ?? 0
          const model = (val.model ?? '').includes('haiku') ? 'Haiku' : (val.model ?? '').includes('sonnet') ? 'Sonnet' : 'AI'
          const channelLabel = channel === 'telegram' ? '📱 Telegram' : channel === 'discord' ? '💬 Discord'
            : channel === 'cron' ? '⏱ Cron' : channel === 'subagent' ? '🤖 Sub-agent'
            : channel === 'slash' ? '⚡ Slash' : '🔧 Session'
          const agentName = AGENT_NAMES[agentId] ?? agentId
          allActivity.push({
            agentId,
            agentName,
            emoji: AGENT_EMOJIS[agentId] ?? '🤖',
            action: channel === 'cron' ? 'cron' : channel === 'subagent' ? 'delegate' : 'session',
            channel: channelLabel,
            desc: `${channelLabel} · ${(tokens/1000).toFixed(1)}k tokens · ${model} · $${cost.toFixed(3)}`,
            tokens,
            cost,
            model,
            updatedAt: val.updatedAt ?? 0,
            ago: Math.floor((Date.now() - (val.updatedAt ?? Date.now())) / 60000),
            startedAt: val.startedAt ?? 0,
          })
        }
      } catch { /* skip */ }
    }

    // Sort all activity by recency
    allActivity.sort((a, b) => b.updatedAt - a.updatedAt)
    result.recentActivity = allActivity.slice(0, 20)
    result.agentCurrentTask = agentCurrentTask
  } catch {
    result.recentActivity = []
    result.agentCurrentTask = {}
  }

  return NextResponse.json(result)
}
