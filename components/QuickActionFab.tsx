// INF-208: Quick-action floating button — UI component
'use client'
import React, { useState, useRef, useEffect } from 'react'
// TOD: kill-fake-infra-greens — imports the client-safe constants module, not
// lib/quick-actions.ts, which pulls in lib/db.ts's postgres adapter
// (Node-only `pg`, needs `fs`) and broke the client bundle for every route.
import { DEFAULT_QUICK_ACTIONS } from '@/lib/quick-actions-constants'
import type { QuickActionType } from '@/lib/quick-actions-constants'

interface QuickActionFabProps {
  onNavigate: (tab: string) => void
  onCreateIssue?: () => void
  onStartChat?: () => void
  onRunAgent?: (agent: string) => void
}

export default function QuickActionFab({ onNavigate, onCreateIssue, onStartChat, onRunAgent }: QuickActionFabProps) {
  const [open, setOpen] = useState(false)
  const fabRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  function handleAction(actionType: QuickActionType, payload: Record<string, unknown>) {
    setOpen(false)
    switch (actionType) {
      case 'create_issue':
        onCreateIssue?.()
        break
      case 'start_chat':
        onStartChat?.()
        break
      case 'run_agent':
        onRunAgent?.(payload.agent as string)
        break
      case 'navigate':
        onNavigate(payload.tab as string)
        break
    }
  }

  return (
    <div ref={fabRef} className="fixed bottom-6 right-6 z-50 no-print" style={{ pointerEvents: 'auto' }}>
      {/* Action menu */}
      {open && (
        <div className="absolute bottom-14 right-0 mb-2 w-48 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
             style={{ background: '#0f0f0f', animation: 'slideUp 0.15s ease-out' }}>
          {DEFAULT_QUICK_ACTIONS.filter(a => a.enabled).map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action.action_type, action.payload)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors border-b border-white/5 last:border-0"
            >
              <span className="text-base">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={
          'w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-all ' +
          (open
            ? 'bg-white/20 text-white rotate-45'
            : 'bg-blue-600 hover:bg-blue-500 text-white hover:scale-105')
        }
        title="Quick actions"
        aria-label="Quick actions"
      >
        +
      </button>
    </div>
  )
}
