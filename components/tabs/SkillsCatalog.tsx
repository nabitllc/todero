'use client'
import React from 'react'
import { Chip } from '@/lib/mc-atoms'

const SKILLS = [
  { id: 'bug-report',      name: 'Bug Report',      emoji: '🐛', desc: 'File structured bug reports to the MC issue board with one command.',                        tags: ['Reporting', 'Issues', 'MC API'] },
  { id: 'issue-routing',   name: 'Issue Routing',   emoji: '🔀', desc: 'Determine correct type, assignee, and hierarchy for any issue before creation.',             tags: ['Routing', 'Issues', 'Pipeline'] },
  { id: 'self-improving',  name: 'Self-Improving',  emoji: '📈', desc: 'Evaluate own work, catch mistakes, and improve through corrections and reflection.',         tags: ['Memory', 'Learning', 'Quality'] },
  { id: 'proactivity',     name: 'Proactivity',     emoji: '⚡', desc: 'Anticipate needs, keep work moving, and surface next steps without being asked.',            tags: ['Automation', 'Execution'] },
  { id: 'agent-creation',  name: 'Agent Creation',  emoji: '🤖', desc: 'Spin up new agents with workspace files, queue config, and AGENTS.md registration.',        tags: ['Agents', 'Setup'] },
  { id: 'agent-setup',     name: 'Agent Setup',     emoji: '⚙️', desc: 'Configure workspace context files and register an agent in the queue config.',              tags: ['Agents', 'Config'] },
  { id: 'blogwatcher',     name: 'Blog Watcher',    emoji: '📰', desc: 'Monitor RSS/Atom feeds and blogs for updates, triggering alerts on new posts.',              tags: ['Research', 'Monitoring'] },
  { id: 'nano-pdf',        name: 'Nano PDF',        emoji: '📄', desc: 'Edit PDFs with natural-language instructions via the nano-pdf CLI.',                         tags: ['Documents', 'CLI'] },
]

export default function SkillsCatalog() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {SKILLS.map(s => (
        <div key={s.id} className="rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-colors" style={{background:'#0f0f0f'}}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{background:'#1a1a1a'}}>
              {s.emoji}
            </div>
            <p className="text-white text-sm font-semibold">{s.name}</p>
          </div>
          <p className="text-white/50 text-xs leading-relaxed mb-3">{s.desc}</p>
          <div className="flex flex-wrap gap-1">
            {s.tags.map(t => <Chip key={t} label={t} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
