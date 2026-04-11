'use client'
// TOD-631: Notification bell — agent completions, issue transitions, deploy events
// - Data fetched through /api/notifications (no client-side Supabase key)
// - a11y: role="dialog", aria-label, aria-expanded, Escape-to-close, 44px touch target
// - responsive: drawer width capped by viewport so it doesn't overflow on small phones

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

function timeAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function mapRowToNotification(r: any): Notification {
  const title: string = r.title ?? 'Status change'
  const isRelease = title.includes('→ released')
  const isApproved = title.includes('→ approved')
  const isReview = title.includes('→ code_review') || title.includes('→ product_review')
  return {
    id: `ntf-${r.id}`,
    type: isRelease ? 'deploy' : 'status_change',
    title,
    detail: r.body || '',
    timestamp: new Date(r.created_at),
    color: isRelease ? '#a78bfa' : isApproved ? '#34d399' : isReview ? '#60a5fa' : '#71717a',
    read: !!r.read,
    dbId: r.id,
  }
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=40', { cache: 'no-store' })
      if (!res.ok) return
      const rows = await res.json()
      if (!Array.isArray(rows)) return
      const items = rows.map(mapRowToNotification)
      items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      setNotifications(items.slice(0, 40))
    } catch {
      /* network error — leave existing notifications in place */
    }
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

  // Close on Escape + return focus to bell button (a11y)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
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
  const bellLabel = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'

  const typeIcon = (type: Notification['type']) => {
    if (type === 'agent_completion') return <Bot size={12} className="shrink-0" aria-hidden="true" />
    if (type === 'deploy') return <Rocket size={12} className="shrink-0" aria-hidden="true" />
    return <ArrowRightLeft size={12} className="shrink-0" aria-hidden="true" />
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        type="button"
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-panel"
        // 44×44 hit target (WCAG 2.5.5) while the icon stays visually small
        className="relative flex items-center justify-center w-11 h-11 rounded-md hover:bg-white/[0.05] text-white/40 hover:text-white/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <Bell size={15} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1 leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
          className="absolute right-0 top-full mt-1 w-[340px] max-w-[calc(100vw-12px)] max-h-[420px] bg-[#111] border border-white/[0.08] rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-white/80" id="notification-panel-title">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  type="button"
                  aria-label="Mark all notifications as read"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <CheckCheck size={11} aria-hidden="true" />
                  <span>Read all</span>
                </button>
              )}
              <button
                onClick={() => { setOpen(false); buttonRef.current?.focus() }}
                type="button"
                aria-label="Close notifications"
                className="p-0.5 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* List */}
          <ul className="flex-1 overflow-y-auto" aria-labelledby="notification-panel-title">
            {notifications.length === 0 ? (
              <li className="px-4 py-8 text-center text-white/25 text-xs list-none">No notifications yet</li>
            ) : (
              notifications.map(n => (
                <li
                  key={n.id}
                  className={`px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors list-none ${!n.read ? 'bg-white/[0.02]' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" aria-label="Unread" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span style={{ color: n.color }}>{typeIcon(n.type)}</span>
                        <span className="text-[11px] font-medium text-white/70 truncate">{n.title}</span>
                      </div>
                      <p className="text-[10px] text-white/35 mt-0.5 truncate">{n.detail}</p>
                    </div>
                    <time className="text-[9px] text-white/20 shrink-0 mt-0.5" dateTime={n.timestamp.toISOString()}>{timeAgo(n.timestamp)}</time>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
