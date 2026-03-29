'use client'
import { useState } from 'react'
import { Plus, X, CheckCircle } from 'lucide-react'

interface IssueDraft { title: string; type: string; priority: string; assignee: string; acceptance_criteria: string }
interface Props { draft: IssueDraft; project?: string | null }

const TYPE_COLORS: Record<string, string> = { feature: 'text-purple-400', bug: 'text-red-400', task: 'text-blue-400' }
const PRIORITY_COLORS: Record<string, string> = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400' }

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
                <span className={`text-xs capitalize ${TYPE_COLORS[draft.type] || 'text-white/50'}`}>{draft.type}</span>
                <span className={`text-xs capitalize ${PRIORITY_COLORS[draft.priority] || 'text-white/50'}`}>{draft.priority}</span>
                <span className="text-xs text-white/30">→ {draft.assignee}</span>
              </div>
              <div className="text-white/80 font-medium">{draft.title}</div>
            </div>
            <button onClick={() => setState('dismissed')} className="text-white/20 hover:text-white/50 shrink-0"><X size={14}/></button>
          </div>
          <button onClick={create} disabled={state === 'creating'}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-xs text-white transition-all disabled:opacity-50">
            <Plus size={12}/> {state === 'creating' ? 'Creating...' : 'Create Issue'}
          </button>
        </>
      )}
    </div>
  )
}
