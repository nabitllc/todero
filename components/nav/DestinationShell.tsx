'use client'
// components/nav/DestinationShell.tsx — TOD-2381 (nav-six-destinations)
// Shared header for all six destinations: title, the question it answers
// (design/Nav.dc.html), sub-tab pills for the views it absorbed, and — when
// relevant — an honest scope note that names the selected project instead of
// rendering a blank panel. This wraps EXISTING tab components; it never
// reaches into their internals.

import React from 'react'
import type { Destination } from './config'

interface Props {
  destination: Destination
  activeView: string
  onSelectView: (viewId: string) => void
  children: React.ReactNode
  /** Real project name (e.g. "Limiglow"), or null when nothing is scoped. */
  projectName?: string | null
  /**
   * Real issue total for the scoped project, straight from /api/issues'
   * `total`. null = not loaded / not applicable to this destination. Only
   * destinations whose content is issue-driven pass this — Fleet, Memory and
   * Settings are not "empty" just because a project has zero issues.
   */
  projectIssueTotal?: number | null
}

export default function DestinationShell({ destination, activeView, onSelectView, children, projectName, projectIssueTotal }: Props) {
  const showEmptyNote = !!projectName && projectIssueTotal === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-white text-lg font-semibold">{destination.label}</h1>
        <span className="text-white/75 text-xs italic">&ldquo;{destination.question}&rdquo;</span>
      </div>

      {destination.views.length > 1 && (
        <div className="flex gap-1 flex-wrap bg-white/[0.04] border border-white/10 rounded-lg p-1 w-fit">
          {destination.views.map(v => (
            <button
              key={v.id}
              onClick={() => onSelectView(v.id)}
              aria-current={activeView === v.id ? 'page' : undefined}
              className={
                'text-xs font-medium rounded-md px-3 py-1.5 transition-colors ' +
                (activeView === v.id ? 'bg-white text-black' : 'text-white/60 hover:text-white')
              }
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {showEmptyNote && (
        <div className="flex items-start gap-2.5 bg-blue-500/[0.06] border border-blue-500/20 rounded-lg px-3.5 py-2.5">
          <span className="text-blue-400 text-sm leading-none mt-0.5">i</span>
          <p className="text-xs leading-relaxed text-white/75">
            {/*
              This said "It is a real project (live today as amazoniico.com)" —
              one project's external URL hardcoded into a component whose project
              name is a variable. Any second zero-issue project would have been
              told it was live at amazoniico.com. The name is a prop; the facts
              about it have to be too, or they do not belong on screen.
            */}
            <span className="text-white/85 font-medium">{projectName}</span> has 0 issues yet — that is correct, not
            broken. Todero has not started work on it. This destination fills in as work begins.
          </p>
        </div>
      )}

      {children}
    </div>
  )
}
