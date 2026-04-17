'use client'
// TOD-631: Notification bell — agent completions, issue transitions, deploy events

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, Bot, ArrowRightLeft, Rocket, X, CheckCheck } from 'lucide-react'
import { AGENT_DISPLAY } from '@/lib/mc-constants'

interface Notification {
  id: string
  type: 'agent_completion' | 'status_change' | 'deploy'
  title: string
  detail: string
  timestamp: Date
  color: string
  read: boolean
  dbId?: string // notifications table id for mark-read
}

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://twthgapiouiqhavrcnry.supabase.co'
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function timeAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
    const items: Notification[] = []

    // 1. Notifications table (status_change events from issue PATCH)
    try {
      const res = await fetch(
        `${SUPA}/rest/v1/notifications?select=*&created_at=gte.${since}&order=created_at.desc&limit=30`,
        { headers }
      )
      const rows = await res.json()
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const isRelease = r.title?.includes('→ released')
          const isApproved = r.title?.includes('→ approved')
          const isReview = r.title?.includes('→ code_review') || r.title?.includes('→ product_review')
          items.push({
            id: `ntf-${r.id}`,
            type: isRelease ? 'deploy' : 'status_change',
            title: r.title || 'Status change',
            detail: r.body || '',
            timestamp: new Date(r.created_at),
            color: isRelease ? '#a78bfa' : isApproved ? '#34d399' : isReview ? '#60a5fa' : '#71717a',
            read: r.read,
            dbId: r.id,
          })
        }
      }
    } catch { /* ignore */ }

    // 2. Agent completions + errors from agent_runs
    try {
      const res = await fetch(
        `${SUPA}/rest/v1/agent_runs?select=id,agent_id,task_title,status,started_at,finished_at&status=in.(completed,done,error)&finished_at=gte.${since}&order=finished_at.desc&limit=20`,
        { headers }
      )
      const rows = await res.json()
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const agent = AGENT_DISPLAY[r.agent_id]
          const isError = r.status === 'error'
          items.push({
            id: `ar-${r.id}`,
            type: 'agent_completion',
            title: `${agent?.emoji || '🤖'} ${agent?.name || r.agent_id} ${isError ? 'failed' : 'completed'}`,
            detail: (r.task_title || 'Task').slice(0, 60),
            timestamp: new Date(r.finished_at || r.started_at),
            color: isError ? '#f87171' : '#34d399',
            read: false,
          })
        }
      }
    } catch { /* ignore */ }

    // Sort by timestamp desc, deduplicate by title+timestamp proximity
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    // Deduplicate: if a notifications-table entry and an agent_runs entry have similar title, keep the notifications one
    const seen = new Set<string>()
    const deduped = items.filter(n => {
      const key = n.title.slice(0, 30)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setNotifications(deduped.slice(0, 40))
  }, [])

  // Fetch on mount and every 30s
  useEffect(() => {
    fetchNotifications()
    const iv = setInterval(fetchNotifications, 30000)
    return () => clearInterval(iv)
  }, [fetchNotifications])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => setOpen(v => !v)

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_all_read: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    } catch { /* ignore */ }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const typeIcon = (type: Notification['type']) => {
    if (type === 'agent_completion') return <Bot size={12} className="shrink-0" />
    if (type === 'deploy') return <Rocket size={12} className="shrink-0" />
    return <ArrowRightLeft size={12} className="shrink-0" />
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-md hover:bg-white/[0.05] text-white/40 hover:text-white/60 transition-colors"
        title="Notifications"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[340px] max-h-[420px] bg-[#111] border border-white/[0.08] rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-white/80">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                  title="Mark all read"
                >
                  <CheckCheck size={11} />
                  <span>Read all</span>
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/25 text-xs">No notifications yet</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${!n.read ? 'bg-white/[0.02]' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span style={{ color: n.color }}>{typeIcon(n.type)}</span>
                        <span className="text-[11px] font-medium text-white/70 truncate">{n.title}</span>
                      </div>
                      <p className="text-[10px] text-white/35 mt-0.5 truncate">{n.detail}</p>
                    </div>
                    <span className="text-[9px] text-white/20 shrink-0 mt-0.5">{timeAgo(n.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
