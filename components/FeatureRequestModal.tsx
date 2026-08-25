// TOD-1214: Feature Request Modal — POST to /api/issues with success/error state
'use client'
import React, { useEffect, useState } from 'react'
import { X, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FormGroup } from '@/components/ui/FormGroup'
import { Input, Textarea } from '@/components/ui/Input'

interface CreatedIssue {
  id: string
  task_key: string
  title: string
}

interface FeatureRequestModalProps {
  onClose: () => void
}

export default function FeatureRequestModal({ onClose }: FeatureRequestModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedIssue | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The project was hardcoded to 'Todero'. That name is not in the projects
  // table any more, so every feature request created here wrote a row under a
  // project that does not exist — a fabrication with a database row behind it,
  // which is worse than one on screen. The project comes from the table now,
  // and if the table has none, the form refuses rather than inventing one.
  const [projects, setProjects] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/projects')
      .then(r => (r.ok ? r.json() : null))
      .then(rows => {
        if (!live) return
        setProjects(Array.isArray(rows) ? rows.map((p: { name?: string; id?: string }) => p.name ?? p.id ?? '').filter(Boolean) : [])
      })
      .catch(() => { if (live) setProjects([]) })
    return () => { live = false }
  }, [])

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && acceptanceCriteria.trim().length > 0
    && !!projects && projects.length > 0

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          acceptance_criteria: acceptanceCriteria.trim(),
          type: 'feature',
          project: projects![0],
          priority: 'medium',
          assignee: 'po',
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `API error ${res.status}`)
      }

      const issue: CreatedIssue = await res.json()
      setCreated(issue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success state ───────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6 text-center">
          <CheckCircle size={40} className="text-emerald-400 mx-auto mb-4" />
          <h2 className="text-white font-semibold text-base mb-1">Feature request submitted</h2>
          <p className="text-white/50 text-sm mb-4">
            Your request has been created as{' '}
            <span className="text-white font-mono">{created.task_key}</span> and will be reviewed by the product team.
          </p>
          <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-left mb-5">
            <p className="text-white/40 text-xs mb-0.5">Issue</p>
            <p className="text-white text-sm font-medium">{created.title}</p>
            <p className="text-white/30 text-xs mt-0.5">{created.task_key}</p>
          </div>
          <div className="flex gap-2 justify-center">
            <a
              href={`https://kaos.nabit.work/?tab=board`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 transition-all"
            >
              View on board <ExternalLink size={12} />
            </a>
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Form state ──────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-white text-sm font-semibold">Request a Feature</h2>
            <p className="text-white/40 text-xs mt-0.5">Describe what you need and why it matters</p>
          </div>
          <Button variant="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-4">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-lg px-3.5 py-3">
              <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-red-400 text-xs font-medium">Submission failed</p>
                <p className="text-red-400/70 text-xs mt-0.5">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400/50 hover:text-red-400 text-xs shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          <FormGroup label="Title" required helper="One sentence describing the capability you want">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Export issues to CSV"
              maxLength={120}
              autoFocus
            />
          </FormGroup>

          <FormGroup label="Description" required helper="What problem does this solve? Who benefits?">
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the use case, current workaround, and expected outcome…"
              rows={4}
            />
          </FormGroup>

          <FormGroup label="Acceptance Criteria" required helper="What does 'done' look like? Use numbered steps.">
            <Textarea
              value={acceptanceCriteria}
              onChange={e => setAcceptanceCriteria(e.target.value)}
              placeholder={"1. User can click Export on the issues list\n2. A CSV downloads with all visible columns\n3. Filtered results match the export"}
              rows={4}
            />
          </FormGroup>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10 shrink-0">
          <p className="text-white/30 text-xs">
            Creates a <span className="font-mono">feature</span> issue assigned to product review
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              title={projects && projects.length === 0 ? 'No project exists to file this against' : undefined}
              loading={submitting}
            >
              Submit request
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
