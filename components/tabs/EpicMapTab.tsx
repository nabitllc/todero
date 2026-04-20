'use client'
// TOD-936, TOD-937: Epic Map canvas — epic blocks with feature nesting, pan/keyboard nav

import React, { useEffect, useRef, useState, useCallback } from 'react'

interface Issue {
  id: string
  task_key: string
  title: string
  status: string
  type: string
  parent_id: string | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  backlog:        { bg: 'bg-gray-800',    text: 'text-gray-200',    border: 'border-gray-600', badge: 'border-gray-500 text-gray-300' },
  defined:        { bg: 'bg-indigo-900',  text: 'text-indigo-200',  border: 'border-indigo-700', badge: 'border-indigo-500 text-indigo-300' },
  refined:        { bg: 'bg-purple-900',  text: 'text-purple-200',  border: 'border-purple-700', badge: 'border-purple-500 text-purple-300' },
  underway:       { bg: 'bg-blue-900',    text: 'text-blue-200',    border: 'border-blue-700', badge: 'border-blue-500 text-blue-300' },
  feature_review: { bg: 'bg-amber-900',   text: 'text-amber-200',   border: 'border-amber-700', badge: 'border-amber-500 text-amber-300' },
  approved:       { bg: 'bg-emerald-900', text: 'text-emerald-200', border: 'border-emerald-700', badge: 'border-emerald-500 text-emerald-300' },
  closed:         { bg: 'bg-green-900',   text: 'text-green-200',   border: 'border-green-700', badge: 'border-green-500 text-green-300' },
  draft:          { bg: 'bg-zinc-800',    text: 'text-zinc-300',    border: 'border-zinc-600', badge: 'border-zinc-500 text-zinc-400' },
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', defined: 'Defined', refined: 'Refined', open: 'Open',
  underway: 'Underway', feature_review: 'In Review', approved: 'Approved',
  closed: 'Closed', draft: 'Draft', in_progress: 'In Progress',
}

function getStatusColors(status: string) {
  return STATUS_COLORS[status] ?? STATUS_COLORS.backlog
}

export default function EpicMapTab() {
  const [epics, setEpics] = useState<Issue[]>([])
  const [features, setFeatures] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [pan, setPan] = useState({ x: 24, y: 24 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/issues?limit=500')
        if (res.ok) {
          const all: Issue[] = await res.json()
          setEpics(all.filter(i => i.type === 'epic'))
          setFeatures(all.filter(i => i.type === 'feature'))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    })
  }, [])

  const handleMouseUp = useCallback(() => { dragging.current = false }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 40
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setPan(p => ({ ...p, x: p.x + step })) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPan(p => ({ ...p, x: p.x - step })) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setPan(p => ({ ...p, y: p.y + step })) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setPan(p => ({ ...p, y: p.y - step })) }
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-white/30 text-sm">Loading…</div>
  }

  if (epics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <p className="text-white/30 text-sm">No epics found</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden h-[calc(100vh-8rem)] select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      role="region"
      aria-label="Epic canvas"
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute top-0 left-0"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        <div className="flex flex-wrap gap-4 w-max max-w-[2400px]">
          {epics.map(epic => {
            const sc = getStatusColors(epic.status)
            const epicFeatures = features.filter(f => f.parent_id === epic.id)
            return (
              <div
                key={epic.id}
                className={`rounded-xl border p-4 w-72 flex-shrink-0 ${sc.bg} ${sc.border}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-xs font-semibold ${sc.text} leading-snug`}>{epic.title}</span>
                  <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-black/30 ${sc.badge} capitalize`}>
                    {STATUS_LABEL[epic.status] ?? epic.status}
                  </span>
                </div>
                <p className={`text-[10px] ${sc.text} opacity-50 mb-2`}>{epic.task_key}</p>

                {epicFeatures.length > 0 && (
                  <div className="space-y-1 mt-3 pt-3 border-t border-white/10">
                    {epicFeatures.map(feat => {
                      const fsc = getStatusColors(feat.status)
                      return (
                        <div key={feat.id} className={`rounded-lg border px-2.5 py-1.5 ${fsc.bg} ${fsc.border}`}>
                          <div className="flex items-center justify-between gap-1 min-w-0">
                            <span className={`text-[11px] font-medium ${fsc.text} truncate leading-tight`}>{feat.title}</span>
                            <span className={`shrink-0 text-[9px] ${fsc.text} opacity-70 ml-1`}>
                              {STATUS_LABEL[feat.status] ?? feat.status}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="absolute bottom-3 right-3 text-white/20 text-[10px] pointer-events-none">
        Drag to pan · Arrow keys to navigate
      </div>
    </div>
  )
}
