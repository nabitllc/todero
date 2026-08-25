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

// PROJECT_META and KNOWN_PROJECTS were here: five hardcoded rows — Todero,
// Kemuni, Vespera, Mission Control, Infrastructure — with hand-written
// descriptions and emoji, rendered whenever no project was scoped, which is
// the default state. Michael described the effect verbatim: "Showing a large
// mess with things about Todero, Vespera, Kemuni (when only single project
// selected 'Todero' was selected) showed a mess."
//
// They could not be filtered away because they were never queried. Projects
// now come from the projects table, which is the only thing that knows which
// projects exist.

export default function ProjectsTab({ projectFilter }: { projectFilter?: string | null }) {
  const { items, total, error, loading, refetch } = useApiList<Issue>('/api/issues?limit=0')
  const { items: projectRows } = useApiList<{ id?: string; name?: string; description?: string }>('/api/projects')

  // Counts are only meaningful once the issue list actually arrived — on a
  // failed load we render the banner instead of a table full of zeroes.
  const issues = items ?? []
  const known = (projectRows ?? []).map(p => p.name ?? p.id ?? '').filter(Boolean)
  const describe = new Map((projectRows ?? []).map(p => [p.name ?? p.id ?? '', p.description ?? '']))
  const projects = projectFilter ? [projectFilter] : known
  const rows: ProjectRow[] = items === null ? [] : projects.map(name => {
    const matching = issues.filter(i => i.project === name)
    const open = matching.filter(i => i.status && !['backlog', 'closed', 'cancelled'].includes(i.status)).length
    const meta = { description: describe.get(name) ?? '', emoji: '📦' }
    return {
      name,
      key: PROJECT_PREFIX[name] ?? '—',
      description: meta.description,
      emoji: meta.emoji,
      issueCount: matching.length,
      openCount: open,
    }
  })

  // The DB carries more distinct `project` values than KNOWN_PROJECTS (the 5
  // names in PROJECT_PREFIX) — issues under those other values used to be
  // silently dropped from this table with nothing to say so. Roll them into
  // one honest "Other" row instead of pretending they don't exist.
  if (items !== null && !projectFilter) {
    const other = issues.filter(i => !i.project || !known.includes(i.project))
    if (other.length > 0) {
      const open = other.filter(i => i.status && !['backlog', 'closed', 'cancelled'].includes(i.status)).length
      rows.push({
        name: 'Other',
        key: '—',
        description: known.length ? `Issues with a project not in ${known.join(', ')}` : 'Issues whose project is not in the projects table',
        emoji: '❓',
        issueCount: other.length,
        openCount: open,
      })
    }
  }

  // True total across every row shown, cross-checked against the server's
  // count so a stale KNOWN_PROJECTS list can never silently under-report.
  const shownTotal = rows.reduce((sum, r) => sum + r.issueCount, 0)
  const trueTotal = items !== null ? (total ?? issues.length) : null

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
        <span className="text-white/30 text-xs">
          {rows.length} project{rows.length !== 1 ? 's' : ''}
          {trueTotal !== null && ` · ${shownTotal} of ${trueTotal} issues`}
        </span>
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
