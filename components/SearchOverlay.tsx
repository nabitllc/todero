'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
  onNavigate: (tab: string) => void
}

interface SearchResult {
  task_key: string
  title: string
  status: string
}


export default function SearchOverlay({ open, onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery] = useState('')
  // null means "not searched yet / search failed" — never coerced to [] on
  // a failure, so the overlay can't render "No results found" over a
  // permission error or a 500.
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setQuery(''); setResults(null); setError(null); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!query.trim()) { setResults(null); setError(null); return }
    const timeout = setTimeout(async () => {
      setLoading(true)
      const encoded = encodeURIComponent('%' + query + '%')
      const r = await fetchJson<SearchResult[]>(
        dbUrl('issues?or=(title.ilike.' + encoded + ',task_key.ilike.' + encoded + ')&order=updated_at.desc&limit=15&select=task_key,title,status'),
        { headers: dbRestHeaders() }
      )
      if (r.ok) {
        setResults(r.data)
        setError(null)
      } else {
        setResults(null)
        setError(r.error)
      }
      setLoading(false)
    }, 300)
    return () => clearTimeout(timeout)
  }, [query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-[480px] mx-4 bg-[#111] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Search size={15} className="text-white/30 shrink-0" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search issues by title or key..." className="flex-1 bg-transparent text-sm text-white/80 placeholder-white/25 outline-none" />
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06] text-white/30"><X size={14} /></button>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {loading && <div className="px-4 py-3 text-xs text-white/25">Searching...</div>}
          {!loading && error && <div className="px-2 py-2"><ApiErrorBanner error={error} /></div>}
          {!loading && !error && query && results !== null && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-white/25">No results found</div>
          )}
          {(results ?? []).map(r => (
            <button key={r.task_key} onClick={() => { onNavigate('board'); onClose() }} className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-white/[0.03] flex items-center gap-3">
              <span className="text-[10px] font-mono text-white/30 shrink-0">{r.task_key}</span>
              <span className="text-xs text-white/60 truncate flex-1">{r.title}</span>
              <span className="text-[9px] text-white/20 shrink-0">{(r.status || '').replace(/_/g, ' ')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
