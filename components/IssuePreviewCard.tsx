'use client'
import { useState } from 'react'
import { Plus, X, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui'
import { TypeBadge, PriorityBadge } from '@/components/ui'

interface IssueDraft { title: string; type: string; priority: string; assignee: string; acceptance_criteria: string }
interface Props { draft: IssueDraft; project?: string | null }

export default function IssuePreviewCard({ draft, project }: Props) {
  const [state, setState] = useState<'idle' | 'creating' | 'done' | 'dismissed'>('idle')
  const [taskKey, setTaskKey] = useState('')

  if (state === 'dismissed') return null

  const create = async () => {
    setState('creating')
    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, project: project || 'Mission Control', sprint: new Date().toISOString().split('T')[0] })
      })
      const data = await res.json()
      setTaskKey(data.task_key || '?')
      setState('done')
    } catch { setState('idle') }
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
