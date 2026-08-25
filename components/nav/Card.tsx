'use client'
// components/nav/Card.tsx — cards-and-identity piece (Wave 6)
//
// The shared card shell design/Main.dc.html's sections were rebuilt against
// (build instruction 3). One card = one question, one number with its
// source, one action or none, collapsible with a persisted collapsed state,
// a single column at every width (it is a block element; any internal
// multi-column layout is the caller's grid, not this file's), and an empty
// state that names the thing it is empty about instead of reading as
// breakage.
//
// Built here (Now/OverviewTab.tsx is this piece's only card CONSUMER) so the
// five other destinations — later pieces, per the piece doc — inherit the
// same contract instead of each inventing its own card chrome.

import React, { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface CardMetric {
  /** The one number that matters. A string/number, never a guess — callers
   *  pass `undefined` (omit `metric` entirely) rather than a fabricated 0
   *  while the real value is still in flight. */
  value: React.ReactNode
  /** Unit/label rendered right after the value, e.g. "waiting", "agents". */
  label: string
  tone?: 'default' | 'amber' | 'emerald' | 'red'
}

export interface CardAction {
  label: string
  onClick: () => void
}

export interface CardEmptyState {
  active: boolean
  /** Must name the thing this card is empty about (a project, a fleet, a
   *  window) — never a bare "nothing here". Rendered in place of children. */
  message: string
}

export interface CardProps {
  /** Stable, globally-unique id — the localStorage key for the collapsed
   *  state, and the source of the header's aria-controls/aria-expanded
   *  wiring. Two cards sharing an id would share collapsed state, so this is
   *  required, not inferred from the title. */
  id: string
  /** The one question this card answers. */
  title: string
  metric?: CardMetric
  /** The query/endpoint that produced `metric` (and the body below) — real
   *  text, not decoration. Rendered in the same dim monospace
   *  design/Main.dc.html uses for provenance (`.prov`). Can be more than one
   *  line for a card that merges more than one source (see NeedsYouCard). */
  source?: React.ReactNode
  /** The one action this card offers. Omit entirely for none — never a
   *  button that does nothing real. */
  action?: CardAction
  empty?: CardEmptyState
  children?: React.ReactNode
}

const METRIC_TONE: Record<NonNullable<CardMetric['tone']>, string> = {
  default: 'text-white',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
  red: 'text-red-400',
}

function useCollapsed(id: string): [boolean, () => void] {
  const storageKey = `todero:now-card-collapsed:${id}`
  const [collapsed, setCollapsed] = useState(false)
  // Read the persisted value after mount only — reading localStorage during
  // the initial render would disagree with the server-rendered markup
  // (always expanded) and trip a hydration mismatch.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey) === '1')
    } catch {
      // Storage unavailable (private mode, disabled) — stay expanded, the
      // safe default; a card that silently starts collapsed for no visible
      // reason reads as missing content, not as a preference.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      try { window.localStorage.setItem(storageKey, next ? '1' : '0') } catch { /* best effort */ }
      return next
    })
  }
  return [collapsed, toggle]
}

export default function Card({ id, title, metric, source, action, empty, children }: CardProps) {
  const [collapsed, toggle] = useCollapsed(id)
  const bodyId = `${id}-body`
  const isEmpty = !!empty?.active

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0f0f0f] overflow-hidden">
      <div className="flex items-center gap-3 px-4 md:px-5 py-3">
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <ChevronDown
            size={14}
            className={`text-white/40 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <h2 className="text-white text-sm font-semibold shrink-0">{title}</h2>
          {metric && (
            <span className={`text-xs font-mono ${METRIC_TONE[metric.tone ?? 'default']} truncate`}>
              {metric.value} <span className="text-white/50">{metric.label}</span>
            </span>
          )}
        </button>
        {action && !collapsed && (
          <button
            onClick={action.onClick}
            className="text-xs font-medium text-white/70 hover:text-white border border-white/15 rounded-md px-2.5 py-1 shrink-0 transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
      {!collapsed && (
        <div id={bodyId} className="px-4 md:px-5 pb-3.5 md:pb-4">
          {source && (
            <p className="font-mono text-[10px] leading-snug text-white/35 mb-2.5 break-all">{source}</p>
          )}
          {isEmpty ? <p className="text-white/45 text-xs">{empty!.message}</p> : children}
        </div>
      )}
    </section>
  )
}
