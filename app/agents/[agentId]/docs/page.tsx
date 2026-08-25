'use client'

import { useEffect, useState, useCallback } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import { useParams } from 'next/navigation'

interface AgentDoc {
  id: string
  agent_id: string
  doc_type: string
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

interface HistoryEntry {
  id: string
  changed_by: string | null
  changed_at: string
  content: string
}

export default function AgentDocsPage() {
  const params = useParams()
  const agentId = params.agentId as string

  const [docs, setDocs] = useState<AgentDoc[]>([])
  const [selected, setSelected] = useState<AgentDoc | null>(null)
  const [editContent, setEditContent] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [docsError, setDocsError] = useState<ApiError | null>(null)

  useEffect(() => {
    fetchJson<{ docs?: AgentDoc[] }>(`/api/agent-docs?agent_id=${agentId}`).then(r => {
      // TOD-654: a refused doc list must not render as "no docs".
      if (!r.ok) { setDocsError(r.error); setDocs([]); return }
      setDocsError(null)
      setDocs(r.data?.docs ?? [])
    })
  }, [agentId])

  const selectDoc = useCallback(async (doc: AgentDoc) => {
    const r = await fetchJson<AgentDoc & { content: string }>(`/api/agent-docs/${doc.id}`)
    if (!r.ok) { setDocsError(r.error); return }
    setDocsError(null)
    const full = r.data
    setSelected(full)
    setEditContent(full.content)
    setHistory([])
    setShowHistory(false)
    setSaveMsg('')
  }, [])

  const save = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    setSaveMsg('')
    const res = await fetch(`/api/agent-docs/${selected.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent, updated_by: 'michael' }),
    })
    setSaving(false)
    if (res.ok) {
      setSaveMsg('Saved.')
      setDocs(prev => prev.map(d => d.id === selected.id ? { ...d, updated_at: new Date().toISOString() } : d))
    } else {
      setSaveMsg('Error saving — check console')
    }
  }, [selected, editContent])

  const loadHistory = useCallback(async () => {
    if (!selected) return
    const r = await fetchJson<{ history?: HistoryEntry[] }>(`/api/agent-docs/${selected.id}/history`)
    if (!r.ok) { setDocsError(r.error); return }
    setDocsError(null)
    setHistory(r.data?.history ?? [])
    setShowHistory(true)
  }, [selected])

  const docTypeOrder = ['soul', 'agents', 'skill', 'heartbeat']
  const sorted = [...docs].sort((a, b) => {
    const ta = docTypeOrder.indexOf(a.doc_type)
    const tb = docTypeOrder.indexOf(b.doc_type)
    if (ta !== tb) return ta - tb
    return a.slug.localeCompare(b.slug)
  })

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-mono text-sm">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Agent</div>
          <div className="font-bold text-white">{agentId}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sorted.map(doc => (
            <button
              key={doc.id}
              onClick={() => selectDoc(doc)}
              className={`w-full text-left px-4 py-3 border-b border-gray-900 hover:bg-gray-900 transition-colors ${selected?.id === doc.id ? 'bg-gray-900 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="text-xs text-gray-500 uppercase">{doc.doc_type}</div>
              <div className="text-gray-200 truncate">{doc.slug}</div>
              <div className="text-xs text-gray-600">{new Date(doc.updated_at).toLocaleDateString()}</div>
            </button>
          ))}
          {/* TOD-654: never claim "no documents" over a refused request. */}
          {docsError && <div className="p-3"><ApiErrorBanner error={docsError} /></div>}
          {!docsError && docs.length === 0 && (
            <div className="p-4 text-gray-600 text-xs">No documents. Run seed-agent-db.ts first.</div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
              <div>
                <span className="text-xs text-gray-500 uppercase mr-2">{selected.doc_type}</span>
                <span className="text-white font-bold">{selected.slug}</span>
                <span className="text-xs text-gray-600 ml-3">agent: {selected.agent_id}</span>
              </div>
              <div className="flex items-center gap-3">
                {saveMsg && <span className="text-xs text-green-400">{saveMsg}</span>}
                <button
                  onClick={loadHistory}
                  className="text-xs text-gray-400 hover:text-white px-3 py-1 border border-gray-700 rounded"
                >
                  History
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1 rounded"
                >
                  {saving ? 'Saving\u2026' : 'Save'}
                </button>
              </div>
            </div>

            {showHistory ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-bold">Edit History</div>
                  <button onClick={() => setShowHistory(false)} className="text-xs text-gray-500 hover:text-white">&larr; Back to editor</button>
                </div>
                {history.length === 0 && <div className="text-gray-600 text-xs">No history yet.</div>}
                {history.map(h => (
                  <div key={h.id} className="mb-6 border border-gray-800 rounded">
                    <div className="flex justify-between items-center px-4 py-2 bg-gray-900 text-xs text-gray-400">
                      <span>{new Date(h.changed_at).toLocaleString()}</span>
                      <span>{h.changed_by ?? 'unknown'}</span>
                    </div>
                    <pre className="p-4 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{h.content.slice(0, 1000)}{h.content.length > 1000 ? '\n\u2026' : ''}</pre>
                    <div className="px-4 pb-3">
                      <button
                        onClick={() => { setEditContent(h.content); setShowHistory(false) }}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Restore this version
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="flex-1 bg-gray-950 text-gray-100 p-6 resize-none outline-none font-mono text-sm leading-relaxed"
                spellCheck={false}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-700">
            Select a document to edit
          </div>
        )}
      </div>
    </div>
  )
}
