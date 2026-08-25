'use client'
import { useState } from 'react'
import { Plus, X, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui'
import { TypeBadge, PriorityBadge } from '@/components/ui'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'

interface IssueDraft { title: string; type: string; priority: string; assignee: string; acceptance_criteria: string }
interface Props { draft: IssueDraft; project?: string | null }

export default function IssuePreviewCard({ draft, project }: Props) {
  const [state, setState] = useState<'idle' | 'creating' | 'done' | 'dismissed'>('idle')
  const [taskKey, setTaskKey] = useState('')
  const [error, setError] = useState<ApiError | null>(null)

  if (state === 'dismissed') return null

  const create = async () => {
    setState('creating')
    setError(null)
    const r = await fetchJson<{ task_key?: string }>('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, project: project || 'Todero', sprint: new Date().toISOString().split('T')[0] })
    })
    // The green "Created" state must only ever follow a 2xx that actually
    // carried a task_key back — never a fetch failure or a body missing the
    // field, which used to fall through to a fabricated "?" and still show
    // success. See ui-error-surfacing-complete round 3.
    if (r.ok && r.data?.task_key) {
      setTaskKey(r.data.task_key)
      setState('done')
    } else {
      setError(r.ok ? { status: r.status, endpoint: '/api/issues', message: 'response had no task_key' } : r.error)
      setState('idle')
    }
  }

  return (
    <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-sm">
      {state === 'done' ? (
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle size={14}/> Created <strong>{taskKey}</strong> — added to board
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1">
              <div className="flex gap-2 mb-1">
                <TypeBadge value={draft.type} />
                <PriorityBadge value={draft.priority} />
                <span className="text-xs text-white/30">→ {draft.assignee}</span>
              </div>
              <div className="text-white/80 font-medium">{draft.title}</div>
            </div>
            <button onClick={() => setState('dismissed')} className="text-white/20 hover:text-white/50 shrink-0 transition-all" aria-label="Dismiss">
              <X size={14}/>
            </button>
          </div>
          {error && <ApiErrorBanner error={error} onRetry={create} className="mb-2" />}
          <Button
            variant="secondary"
            size="sm"
            loading={state === 'creating'}
            onClick={create}
          >
            <Plus size={12}/> {state === 'creating' ? 'Creating...' : 'Create Issue'}
          </Button>
        </>
      )}
    </div>
  )
}
