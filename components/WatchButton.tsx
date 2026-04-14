'use client'

import { useState } from 'react'

interface WatchButtonProps {
  issueId: string
  watcherId: string
  initialWatching: boolean
  className?: string
}

export function WatchButton({ issueId, watcherId, initialWatching, className }: WatchButtonProps) {
  const [watching, setWatching] = useState(initialWatching)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    const method = watching ? 'DELETE' : 'POST'
    try {
      const res = await fetch(`/api/issues/${issueId}/watch`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watcherId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Failed to update watch')
        return
      }
      setWatching(!watching)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={className}>
      <button
        onClick={toggle}
        disabled={loading}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
          watching
            ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
            : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70'
        }`}
      >
        {loading ? (
          <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full inline-block" />
        ) : (
          <span>{watching ? '👁' : '👁'}</span>
        )}
        {watching ? 'Unwatch' : 'Watch'}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
