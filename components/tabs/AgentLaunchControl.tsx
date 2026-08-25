'use client'
import React from 'react'
import { Rocket, Lock } from 'lucide-react'
import { Button } from '@/components/ui'
import { fetchJson } from '@/hooks/useApiData'
import type { VaultBadgeInfo } from '@/lib/vault-badge'

// run-agent-locally piece — the headline proof of the wave: a real launch
// control on the agent surface, wired to lib/dispatch-guard.ts.
//
// Two things this must never do (piece brief, verbatim):
//   1. Render as armed and then 503 on click — so it always asks the server
//      "would a dispatch work right now?" (POST ?dryRun=1) BEFORE it ever
//      renders as clickable, and disables itself the moment dispatch is off,
//      naming the exact env var (TODERO_DISPATCH_ENABLED) that turns it on.
//   2. Weaken or route around lib/dispatch-guard.ts — this component only
//      ever calls the real POST /api/run-agent; a 503 DISPATCH_DISABLED from
//      that call is treated as correct, expected behavior, not an error to
//      work around.
//
// Routes through the LLM_BASE_URL seam to Ollama explicitly (`runtime=
// openai-api`) using the vault registry's resolved local model
// (`vault.localModel` — server-computed from `local_eligible` +
// `fallback_local`, lib/vault-badge.ts) rather than the agent's default
// Claude alias, which is the "tier and fallback_local from the agent
// registry" the brief asks for.

interface DryRunReport {
  dryRun: true
  runtime?: string
  runtimeAvailable?: boolean
  unavailableReason?: string | null
  dispatchEnabled?: boolean
  wouldSpawn?: boolean
  error?: string
}

interface LaunchResult {
  ok?: boolean
  agent?: string
  runtime?: string
  spawned?: boolean
  pid?: number | null
  spawnError?: string | null
  task?: { id: string; title: string; taskKey: string | null }
  message?: string
  error?: string
  code?: string
  hint?: string
}

export default function AgentLaunchControl({
  agentId,
  vault,
}: {
  agentId: string
  vault?: VaultBadgeInfo | null
}) {
  const [report, setReport] = React.useState<DryRunReport | null>(null)
  const [checking, setChecking] = React.useState(true)
  const [launching, setLaunching] = React.useState(false)
  const [result, setResult] = React.useState<LaunchResult | null>(null)

  const localModel = vault?.localEligible ? vault.localModel : null

  const refreshStatus = React.useCallback(() => {
    setChecking(true)
    const q = new URLSearchParams({ dryRun: '1', agent: agentId, runtime: 'openai-api' })
    fetchJson<DryRunReport>(`/api/run-agent?${q.toString()}`, { method: 'POST' })
      .then(r => setReport(r.ok ? r.data : { dryRun: true, error: r.error.message }))
      .finally(() => setChecking(false))
  }, [agentId])

  React.useEffect(() => { refreshStatus() }, [refreshStatus])

  const dispatchEnabled = report?.dispatchEnabled === true
  const wouldSpawn = report?.wouldSpawn === true
  const armed = dispatchEnabled && wouldSpawn

  async function launch() {
    setLaunching(true)
    setResult(null)
    const q = new URLSearchParams({ agent: agentId, runtime: 'openai-api' })
    if (localModel) q.set('model', localModel)
    const r = await fetchJson<LaunchResult>(`/api/run-agent?${q.toString()}`, { method: 'POST' })
    setLaunching(false)
    setResult(r.ok ? r.data : { ok: false, error: r.error.message, code: String(r.error.status ?? '') })
    refreshStatus()
  }

  const disabledReason = !dispatchEnabled
    ? 'Dispatch is disabled on this instance. Set TODERO_DISPATCH_ENABLED=1 to allow Todero to spawn agents (lib/dispatch-guard.ts).'
    : !wouldSpawn
      ? (report?.unavailableReason ?? report?.error ?? 'The local model endpoint is not reachable right now.')
      : null

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={armed ? 'primary' : 'ghost'}
        size="sm"
        onClick={launch}
        disabled={checking || launching || !armed}
        title={disabledReason ?? `Dispatch ${agentId} to Ollama via LLM_BASE_URL${localModel ? ` (${localModel})` : ''}`}
      >
        {armed ? <Rocket size={12} className="mr-1" /> : <Lock size={12} className="mr-1" />}
        {launching ? 'Launching…' : checking ? 'Checking…' : armed ? 'Launch (Local)' : 'Launch — disabled'}
      </Button>
      {disabledReason && !checking && (
        <p className="text-white/30 text-[10px] max-w-[220px] text-right leading-tight">{disabledReason}</p>
      )}
      {result && (
        <p className={`text-[10px] max-w-[240px] text-right leading-tight ${result.ok !== false ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
          {result.ok !== false
            ? `Dispatched — pid ${result.pid ?? '?'}, task ${result.task?.taskKey ?? result.task?.id ?? '?'}`
            : `${result.code ? `[${result.code}] ` : ''}${result.error ?? result.message ?? 'launch failed'}`}
        </p>
      )}
    </div>
  )
}
