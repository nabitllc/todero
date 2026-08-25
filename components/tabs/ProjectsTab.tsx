'use client'
import React from 'react'
import { PROJECT_PREFIX } from '@/lib/constants'
import { useApiList } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'

interface Issue {
  id: string
  project?: string
  status?: string
}

interface ProjectRow {
  name: string
  key: string
  description: string
  emoji: string
  issueCount: number
  openCount: number
}

const PROJECT_META: Record<string, { description: string; emoji: string }> = {
  'Todero':          { description: 'Todero platform — MC app, agent infra, sprint tooling', emoji: '🧠' },
  'Kemuni':          { description: 'Community & Property SaaS',                              emoji: '🚀' },
  'Vespera':         { description: 'Colombia Goth Community',                                emoji: '🦇' },
  'Mission Control': { description: 'Mission Control — legacy project key',                   emoji: '📡' },
  'Infrastructure':  { description: 'Dev infrastructure, CI/CD, tooling',                     emoji: '⚙️' },
}

const KNOWN_PROJECTS = Object.keys(PROJECT_PREFIX)

export default function ProjectsTab({ projectFilter }: { projectFilter?: string | null }) {
  const { items, error, loading, refetch } = useApiList<Issue>('/api/issues?limit=0')

  // Counts are only meaningful once the issue list actually arrived — on a
  // failed load we render the banner instead of a table full of zeroes.
  const issues = items ?? []
  const projects = projectFilter ? [projectFilter] : KNOWN_PROJECTS
  const rows: ProjectRow[] = items === null ? [] : projects.map(name => {
    const matching = issues.filter(i => i.project === name)
    const open = matching.filter(i => i.status && !['backlog', 'closed', 'cancelled'].includes(i.status)).length
    const meta = PROJECT_META[name] ?? { description: '', emoji: '📦' }
    return {
      name,
      key: PROJECT_PREFIX[name] ?? '—',
      description: meta.description,
      emoji: meta.emoji,
      issueCount: matching.length,
      openCount: open,
    }
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-white/30 text-sm">
        Loading projects…
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">Projects</h2>
          <span className="text-white/30 text-xs">data unavailable</span>
        </div>
        <ApiErrorBanner error={error} onRetry={refetch} />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-white/30 text-sm">
        <span className="text-3xl">📦</span>
        <p>No projects found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-base">Projects</h2>
        <span className="text-white/30 text-xs">{rows.length} project{rows.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="text-left text-white/40 font-medium px-4 py-2.5 text-xs">Project</th>
              <th className="text-left text-white/40 font-medium px-4 py-2.5 text-xs">Key</th>
              <th className="text-left text-white/40 font-medium px-4 py-2.5 text-xs hidden md:table-cell">Description</th>
              <th className="text-right text-white/40 font-medium px-4 py-2.5 text-xs">Issues</th>
              <th className="text-right text-white/40 font-medium px-4 py-2.5 text-xs hidden sm:table-cell">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.name}
                className={`border-b border-white/5 hover:bg-white/5 transition-colors ${i === rows.length - 1 ? 'border-b-0' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{row.emoji}</span>
                    <span className="text-white font-medium text-sm">{row.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                    {row.key}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-white/40 text-xs">{row.description || '—'}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-white text-sm font-semibold">{row.issueCount}</span>
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell">
                  <span className="text-emerald-400 text-sm">{row.openCount}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
