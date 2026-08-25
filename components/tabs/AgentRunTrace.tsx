'use client'
import React from 'react'
import { Wrench, MessageSquare, DollarSign, Hash } from 'lucide-react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'

// run-agent-locally piece, hard requirement #2: a drillable structure, not a
// flat list of sentence fragments. Renders GET /api/run-agent/trace's
// run -> steps (model calls, tool calls) -> tokens/cost-per-step shape.

interface TraceStep {
  type: string
  iter?: number
  tokensIn?: number
  tokensOut?: number
  tool?: string
  args?: string
  result?: string
  finishReason?: string
  status?: string
  error?: string
  [key: string]: unknown
}

interface TraceResponse {
  run: { id: string; agent_id: string; task_title: string | null; status: string | null }
  steps: TraceStep[]
  totals: { tokensIn: number; tokensOut: number; costUsd: number; toolCalls: number }
  note?: string
  rawLogTail?: string
}

function StepRow({ step, i }: { step: TraceStep; i: number }) {
  if (step.type === 'tool_call') {
    return (
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 border border-blue-500/20 bg-blue-500/5">
        <Wrench size={12} className="text-blue-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-blue-300 text-xs font-mono">tool_call: {step.tool}</p>
          {typeof step.args === 'string' && <p className="text-white/30 text-[10px] font-mono truncate mt-0.5">args: {step.args}</p>}
          {typeof step.result === 'string' && <p className="text-white/40 text-[10px] font-mono truncate mt-0.5">→ {step.result.slice(0, 160)}</p>}
        </div>
      </div>
    )
  }
  if (step.type === 'model_call') {
    return (
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
        <MessageSquare size={12} className="text-emerald-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-white/70 text-xs">model_call — iteration {step.iter} {step.finishReason ? `(${step.finishReason})` : ''}</p>
          <p className="text-white/30 text-[10px] font-mono mt-0.5">
            tokens in {step.tokensIn ?? 0} · out {step.tokensOut ?? 0}
            {Array.isArray(step.toolCalls) && step.toolCalls.length > 0 ? ` · requested tools: ${(step.toolCalls as string[]).join(', ')}` : ''}
          </p>
          {step.error && <p className="text-red-400 text-[10px] mt-0.5">{String(step.error)}</p>}
        </div>
      </div>
    )
  }
  if (step.type === 'run_start' || step.type === 'run_end') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-white/20 shrink-0" />
        <p className="text-white/30 text-[10px] font-mono">
          {step.type} {step.status ? `— ${step.status}` : ''} {step.model ? `— ${step.model}` : ''}
        </p>
      </div>
    )
  }
  return (
    <div key={i} className="text-white/30 text-[10px] font-mono px-3 py-1">{JSON.stringify(step)}</div>
  )
}

export default function AgentRunTrace({ runId }: { runId: string }) {
  const [data, setData] = React.useState<TraceResponse | null>(null)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    setLoading(true)
    fetchJson<TraceResponse>(`/api/run-agent/trace?runId=${encodeURIComponent(runId)}`).then(r => {
      if (!r.ok) { setError(r.error); setData(null); setLoading(false); return }
      setError(null)
      setData(r.data)
      setLoading(false)
    })
  }, [runId])

  if (loading) return <p className="text-white/20 text-xs px-1 py-2">Loading trace…</p>
  if (error) return <ApiErrorBanner error={error} />
  if (!data) return null

  return (
    <div className="space-y-2 mt-2 rounded-xl border border-white/10 bg-[#080808] p-3">
      <div className="flex items-center gap-4 text-[10px] text-white/40 px-1">
        <span className="flex items-center gap-1"><Hash size={10} /> {data.totals.toolCalls} tool call(s)</span>
        <span>tokens in {data.totals.tokensIn} / out {data.totals.tokensOut}</span>
        <span className="flex items-center gap-1"><DollarSign size={10} /> ${data.totals.costUsd.toFixed(4)}</span>
      </div>
      {data.note && (
        <p className="text-amber-300/80 text-[10px] px-1 border-l-2 border-amber-500/40 pl-2">{data.note}</p>
      )}
      {data.steps.length > 0 ? (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {data.steps.map((s, i) => <StepRow key={i} step={s} i={i} />)}
        </div>
      ) : data.rawLogTail ? (
        <pre className="text-white/40 text-[10px] font-mono whitespace-pre-wrap max-h-[240px] overflow-y-auto px-1">{data.rawLogTail}</pre>
      ) : (
        <p className="text-white/20 text-xs italic px-1">No trace steps recorded for this run.</p>
      )}
    </div>
  )
}
