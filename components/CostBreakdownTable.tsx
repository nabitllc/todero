'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { ChevronUp, ChevronDown, Download } from 'lucide-react'

interface CostBreakdownRow {
  project: string
  agent: string
  cost_usd: number
  total_tokens: number
}

type SortDir = 'asc' | 'desc'

function getDefaultRange(preset: 'this-month' | 'last-30'): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  if (preset === 'this-month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    return { from, to }
  }
  const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { from, to }
}

function formatTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}K`
  return String(t)
}

function exportCSV(rows: CostBreakdownRow[], total: { cost_usd: number; total_tokens: number }) {
  const lines = [
    'Project,Agent,Cost (USD),Tokens',
    ...rows.map(r => `${JSON.stringify(r.project)},${JSON.stringify(r.agent)},${r.cost_usd.toFixed(6)},${r.total_tokens}`),
    `Total,,${total.cost_usd.toFixed(6)},${total.total_tokens}`,
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cost-breakdown.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SkeletonRow() {
  return (
    <tr>
      {[120, 80, 60, 60].map((w, i) => (
        <td key={i} className="px-3 py-2">
          <div className="h-3 rounded bg-white/10 animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

export default function CostBreakdownTable() {
  const [preset, setPreset] = useState<'this-month' | 'last-30' | 'custom'>('this-month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rows, setRows] = useState<CostBreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const activeRange = preset === 'custom'
    ? { from: customFrom, to: customTo }
    : getDefaultRange(preset)

  const fetch_ = useCallback(async () => {
    const { from, to } = activeRange
    if (!from || !to) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/costs/breakdown?${params}`)
      if (res.ok) {
        const data: CostBreakdownRow[] = await res.json()
        setRows(data)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [activeRange.from, activeRange.to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch_()
  }, [fetch_])

  const sorted = [...rows].sort((a, b) =>
    sortDir === 'desc' ? b.cost_usd - a.cost_usd : a.cost_usd - b.cost_usd
  )

  const total = rows.reduce(
    (acc, r) => ({ cost_usd: acc.cost_usd + r.cost_usd, total_tokens: acc.total_tokens + r.total_tokens }),
    { cost_usd: 0, total_tokens: 0 }
  )

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1">
          {(['this-month', 'last-30'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={
                'px-3 py-1.5 rounded-lg text-xs transition-all border ' +
                (preset === p
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-transparent border-white/10 text-white/40 hover:text-white/60 hover:border-white/20')
              }
            >
              {p === 'this-month' ? 'This Month' : 'Last 30 Days'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); setPreset('custom') }}
            className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white/60 focus:outline-none focus:border-white/30"
            aria-label="From date"
          />
          <span className="text-white/30 text-xs">–</span>
          <input
            type="date"
            value={customTo}
            onChange={e => { setCustomTo(e.target.value); setPreset('custom') }}
            className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white/60 focus:outline-none focus:border-white/30"
            aria-label="To date"
          />
        </div>

        <button
          onClick={() => exportCSV(sorted, total)}
          disabled={loading || rows.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/50 hover:text-white/70 hover:bg-white/10 transition-all disabled:opacity-40"
          aria-label="Export CSV"
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-xs" aria-label="Cost breakdown">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="px-3 py-2 text-left text-white/50 font-medium">Project</th>
              <th className="px-3 py-2 text-left text-white/50 font-medium">Agent</th>
              <th
                className="px-3 py-2 text-right text-white/50 font-medium cursor-pointer select-none hover:text-white/70 transition-colors"
                onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  Cost (USD)
                  {sortDir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                </span>
              </th>
              <th className="px-3 py-2 text-right text-white/50 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-white/30">
                  No cost data for this period
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-3 py-2 text-white/80">{row.project}</td>
                  <td className="px-3 py-2 text-white/60">{row.agent}</td>
                  <td className="px-3 py-2 text-right text-white/80 font-mono">
                    ${row.cost_usd.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 text-right text-white/60 font-mono">
                    {formatTokens(row.total_tokens)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/20 bg-white/[0.03]">
                <td className="px-3 py-2 text-white font-medium" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right text-white font-medium font-mono">
                  ${total.cost_usd.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right text-white/70 font-mono">
                  {formatTokens(total.total_tokens)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
