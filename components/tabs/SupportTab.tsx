'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { FormGroup } from '@/components/ui/FormGroup'

interface DuplicateMatch {
  id: string
  task_key: string
  title: string
  status: string
  description?: string
}

type SubmitState = 'idle' | 'matches' | 'success' | 'error'

export default function SupportTab() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [useCase, setUseCase] = useState('')
  const [touched, setTouched] = useState({ title: false, description: false, useCase: false })
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<DuplicateMatch[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [createdKey, setCreatedKey] = useState('')

  const isValid = title.trim() !== '' && description.trim() !== '' && useCase.trim() !== ''

  function handleBlur(field: keyof typeof touched) {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return

    setLoading(true)
    setMatches([])
    setErrorMsg('')

    try {
      const res = await fetch('/api/issues/feature-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, use_case: useCase }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.')
        setSubmitState('error')
        return
      }

      if (data.matches && data.matches.length > 0) {
        setMatches(data.matches)
        setSubmitState('matches')
        return
      }

      setCreatedKey(data.created?.task_key ?? '')
      setSubmitState('success')
      setTitle('')
      setDescription('')
      setUseCase('')
      setTouched({ title: false, description: false, useCase: false })
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setSubmitState('error')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setSubmitState('idle')
    setMatches([])
    setErrorMsg('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
      <div>
        <h2 className="text-white text-lg font-semibold">Support</h2>
        <p className="text-white/40 text-sm mt-1">Submit a feature request to the backlog for review.</p>
      </div>

      {submitState === 'success' && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 space-y-2">
          <p className="text-emerald-400 text-sm font-medium">Feature request submitted!</p>
          {createdKey && (
            <p className="text-white/50 text-xs">Created as <span className="text-white/70 font-mono">{createdKey}</span> and added to the backlog.</p>
          )}
          <Button size="sm" variant="ghost" onClick={handleReset}>Submit another</Button>
        </div>
      )}

      {submitState === 'matches' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 space-y-3">
          <p className="text-amber-400 text-sm font-medium">Similar requests already exist</p>
          <p className="text-white/50 text-xs">Check if any of these cover what you need before submitting a new one.</p>
          <ul className="space-y-2">
            {matches.map(m => (
              <li key={m.id} className="rounded bg-white/5 px-3 py-2 text-xs">
                <span className="text-white/40 font-mono mr-2">{m.task_key}</span>
                <span className="text-white/80">{m.title}</span>
                <span className="ml-2 text-white/30">({m.status})</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={handleReset}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              loading={loading}
              disabled={loading}
              onClick={async () => {
                setLoading(true)
                try {
                  const res = await fetch('/api/issues', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      title,
                      description: `${description}\n\n**Use case / Why this matters:**\n${useCase}`,
                      project: 'Todero',
                      type: 'feature',
                      priority: 'medium',
                      assignee: 'po',
                      acceptance_criteria: `Feature request submitted via Support tab.\n\nUse case: ${useCase}`,
                    }),
                  })
                  const data = await res.json()
                  if (!res.ok) {
                    setErrorMsg(data.error ?? 'Failed to create issue.')
                    setSubmitState('error')
                    return
                  }
                  setCreatedKey(data.task_key ?? '')
                  setSubmitState('success')
                  setTitle('')
                  setDescription('')
                  setUseCase('')
                  setTouched({ title: false, description: false, useCase: false })
                } catch {
                  setErrorMsg('Network error.')
                  setSubmitState('error')
                } finally {
                  setLoading(false)
                }
              }}
            >
              Submit anyway
            </Button>
          </div>
        </div>
      )}

      {submitState === 'error' && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-red-400 text-sm">{errorMsg}</p>
          <button className="text-white/30 hover:text-white/60 text-xs shrink-0 cursor-pointer" onClick={handleReset}>Dismiss</button>
        </div>
      )}

      {(submitState === 'idle' || submitState === 'error') && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormGroup
            label="Title"
            required
            error={touched.title && !title.trim() ? 'Title is required' : undefined}
          >
            <Input
              placeholder="Short, descriptive title for your request"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => handleBlur('title')}
              error={touched.title && !title.trim()}
              disabled={loading}
            />
          </FormGroup>

          <FormGroup
            label="Description"
            required
            error={touched.description && !description.trim() ? 'Description is required' : undefined}
          >
            <Textarea
              placeholder="What should this feature do? Be as specific as possible."
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => handleBlur('description')}
              error={touched.description && !description.trim()}
              rows={4}
              disabled={loading}
            />
          </FormGroup>

          <FormGroup
            label="Use case / Why this matters"
            required
            error={touched.useCase && !useCase.trim() ? 'Use case is required' : undefined}
          >
            <Textarea
              placeholder="Who benefits from this? What problem does it solve?"
              value={useCase}
              onChange={e => setUseCase(e.target.value)}
              onBlur={() => handleBlur('useCase')}
              error={touched.useCase && !useCase.trim()}
              rows={3}
              disabled={loading}
            />
          </FormGroup>

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={!isValid || loading}
          >
            Submit feature request
          </Button>
        </form>
      )}
    </div>
  )
}
