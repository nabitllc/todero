'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { WatchButton } from '@/components/WatchButton'

interface Issue {
  id: string
  title: string
  task_key?: string
  status: string
  priority?: string
  description?: string
}

function DuplicateContent() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const reporter = params.get('reporter') ?? 'anonymous'

  const [issue, setIssue] = useState<Issue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/issues?id=${id}`)
      .then(r => r.json())
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data : []
        const found = list.find((i: Issue) => i.id === id) ?? null
        setIssue(found)
        if (!found) setError('Issue not found')
      })
      .catch(() => setError('Could not load issue details'))
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-[#0f0f0f] border border-white/10 rounded-2xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔁</span>
          <h1 className="text-white text-xl font-semibold">Similar Issue Found</h1>
        </div>

        <p className="text-white/50 text-sm leading-relaxed">
          It looks like this issue may already be tracked. Check if the issue below matches what you reported — if so, you can watch it to get notified when it's resolved.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-white/30 text-sm">
            <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full inline-block" />
            Loading issue details…
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        {issue && (
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            {issue.task_key && (
              <span className="text-[10px] font-mono text-white/30 bg-white/10 px-2 py-0.5 rounded-full">
                {issue.task_key}
              </span>
            )}
            <p className="text-white text-sm font-medium">{issue.title}</p>
            {issue.description && (
              <p className="text-xs text-white/40 leading-relaxed line-clamp-3">
                {issue.description}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">
                {issue.status.replace(/_/g, ' ')}
              </span>
              {issue.priority && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">
                  {issue.priority}
                </span>
              )}
            </div>

            <div className="pt-2 border-t border-white/10 space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/30">Watch this issue</p>
              <p className="text-xs text-white/40">
                Watch to get notified when this issue is resolved.
              </p>
              <WatchButton
                issueId={issue.id}
                watcherId={reporter}
                initialWatching={false}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-white/30 text-center">
          If this is not the same issue,{' '}
          <a href="/support/confirm" className="text-blue-400 hover:text-blue-300 underline">
            go back
          </a>{' '}
          and your original ticket will still be submitted.
        </p>
      </div>
    </div>
  )
}

export default function SupportDuplicatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <span className="text-white/30 text-sm">Loading…</span>
      </div>
    }>
      <DuplicateContent />
    </Suspense>
  )
}
