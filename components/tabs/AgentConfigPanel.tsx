'use client'
// TOD-1332: Read-only agent configuration display panel

import React, { useEffect, useState } from 'react'
import { FileText, Cpu, Filter, Zap, AlertTriangle } from 'lucide-react'
import type { AgentConfig } from '@/app/api/agent-config/route'

interface AgentConfigPanelProps {
  agentId: string
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-white/40 text-[10px] uppercase tracking-widest font-semibold">
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-white/30 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/70"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function CodeValue({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-white/30 text-xs">—</span>
  return (
    <code className="text-xs font-mono text-emerald-400/80 bg-emerald-400/5 px-2 py-1 rounded block break-all">
      {value}
    </code>
  )
}

export default function AgentConfigPanel({ agentId }: AgentConfigPanelProps) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    setError(null)
    fetch(`/api/agent-config?id=${encodeURIComponent(agentId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setConfig(data)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  }, [agentId])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 bg-white/5 rounded" />
        ))}
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="flex items-center gap-2 text-red-400/70 text-xs p-4">
        <AlertTriangle size={14} />
        {error ?? 'Config unavailable'}
      </div>
    )
  }

  return (
    <div className="space-y-5 p-4">
      {/* System Prompt Source */}
      <Section icon={<FileText size={11} />} label="System Prompt">
        <CodeValue value={config.systemPromptSource} />
      </Section>

      {/* Model */}
      <Section icon={<Cpu size={11} />} label="Model">
        <CodeValue value={config.model} />
      </Section>

      {/* Queue Filter */}
      <Section icon={<Filter size={11} />} label="Queue Pickup Filter">
        <CodeValue value={config.queueFilter} />
      </Section>

      {/* Skills */}
      <Section icon={<Zap size={11} />} label="Skills">
        <TagList items={config.skills} />
      </Section>

      {/* Escalation Triggers */}
      <Section icon={<AlertTriangle size={11} />} label="Escalation Triggers">
        {config.escalationTriggers.length ? (
          <ul className="space-y-1">
            {config.escalationTriggers.map((t) => (
              <li key={t} className="flex items-start gap-1.5 text-xs text-white/60">
                <span className="mt-0.5 text-amber-400/60 shrink-0">·</span>
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-white/30 text-xs">—</span>
        )}
      </Section>
    </div>
  )
}
