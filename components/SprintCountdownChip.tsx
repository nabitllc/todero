'use client'
// TOD-2233: Sprint countdown chip — shows days/hours remaining in active sprint

import React, { useState, useEffect } from 'react'
import { Timer } from 'lucide-react'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }

interface SprintInfo {
  sprint_number: number
  end_date: string
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'ended'
  const totalSecs = Math.floor(ms / 1000)
  const days = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export default function SprintCountdownChip() {
  const [sprint, setSprint] = useState<SprintInfo | null>(null)
  const [remaining, setRemaining] = useState('')

  // Fetch active sprint once on mount, re-fetch every 5 min
  useEffect(() => {
    const fetchSprint = () => {
      fetch(`${SUPA_URL}/rest/v1/sprints?status=eq.active&select=sprint_number,end_date&limit=1`, { headers: HEADERS })
        .then(r => r.json())
        .then((rows: SprintInfo[]) => {
          if (Array.isArray(rows) && rows.length > 0) setSprint(rows[0])
        })
        .catch(() => {})
    }
    fetchSprint()
    const iv = setInterval(fetchSprint, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [])

  // Update countdown every second without page reload
  useEffect(() => {
    if (!sprint?.end_date) return
    const tick = () => {
      // end_date is YYYY-MM-DD; treat as EOD ET (23:59:59)
      const endMs = new Date(sprint.end_date + 'T23:59:59-05:00').getTime()
      setRemaining(formatRemaining(endMs - Date.now()))
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [sprint])

  if (!sprint || !remaining) return null

  const isUrgent = remaining !== 'ended' && remaining.startsWith('0') === false
    && !remaining.includes('d') && parseInt(remaining) < 4 // < 4 hours

  return (
    <div
      className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-medium transition-colors ${
        isUrgent
          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          : 'bg-white/[0.04] text-white/35 border border-white/[0.06]'
      }`}
      title={`Sprint ${sprint.sprint_number} ends ${sprint.end_date}`}
      aria-label={`Sprint ${sprint.sprint_number}: ${remaining} remaining`}
    >
      <Timer size={10} aria-hidden="true" />
      <span>{remaining}</span>
    </div>
  )
}
