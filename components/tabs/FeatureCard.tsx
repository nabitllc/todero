'use client'
import React from 'react'
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui'
import { issuePermalinkPath, navigateToIssuePermalink } from '@/lib/issue-permalink'

// TOD-2463: this card's issue key is a real anchor, like every other one.
//
// CORRECTION, 2026-08-26 (round 2). The comment that stood here claimed
// components/tabs/BoardTab.tsx:538 "is a duplicate local copy that nothing
// renders", and reported a browser measurement of a card this file does not
// render. Both halves were wrong for this file, a critic caught it, and round
// 1's own piece doc (section 1.1 item 3) already disproved the first half.
// Re-verified today by grep:
//
//   BoardTab.tsx:521   const renderBoardCard = (task) => ...
//   BoardTab.tsx:538     <IssueKeyLink .../>      (inside renderBoardCard)
//   BoardTab.tsx:930 / 1015 / 1125   colTasks.map(task => renderBoardCard(task))
//
// That copy is LIVE — it is the card the board's three swimlane modes use. It
// has nothing to do with this file, which is rendered only by
// components/tabs/FeaturesTab.tsx:195. (components/tabs/PipelineTab.tsx:885
// declares a third, unrelated local component of the same name.)
//
// What is true of THIS file is only the shape of the fix: the feature key used
// to render as a bare <span>, so nothing on the Features surface was
// linkable, and it is an <a href> now.
//
// `href` is a real path, so middle-click, Cmd/Ctrl-click and right-click ->
// Copy Link Address are the browser's own handling and nothing here runs for
// them. The onClick returns WITHOUT preventDefault for any modified click,
// which is what leaves those alone. stopPropagation keeps the anchor from also
// firing the card's own click handler.
function IssueKeyLink({ taskKey, className }: { taskKey: string; className?: string }) {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
  return (
    <a
      href={issuePermalinkPath(currentPath, taskKey)}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        navigateToIssuePermalink(taskKey)
      }}
      className={className}
    >
      {taskKey}
    </a>
  )
}

// TOD (no-invented-projects): this used to be PROJECT_COLORS, a four-name
// table (Vespera/Kemuni/Mission Control/Infrastructure). /api/projects sends
// no color field on a project row, so every card now gets the same neutral
// accent rather than a lookup keyed by a hand-written name list.
const DEFAULT_PROJECT_COLOR = '#6b7280'

const ASSIGNEE_EMOJI: Record<string, string> = {
  builder: '🔨', kaos: '🧠', scout: '🔍', tester: '🧪', ops: '⚙️', nabit: '👤',
}

interface Issue {
  id: string; title: string; status: string; assignee?: string;
  task_key?: string; priority?: string;
  status_category?: 'Planned' | 'Ongoing' | 'SignOff' | 'Done' | null;
}

interface Feature {
  id: string; title: string; description?: string; project?: string;
  priority?: string; status: string; children: Issue[];
  acceptance_criteria?: string;
  task_key?: string;
}

interface Props {
  feature: Feature
  expanded: boolean
  onToggle: () => void
  onViewIssues?: () => void
}

export default function FeatureCard({ feature, expanded, onToggle, onViewIssues }: Props) {
  const done = feature.children.filter(c => c.status_category === 'SignOff' || c.status_category === 'Done').length
  const total = feature.children.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const projColor = DEFAULT_PROJECT_COLOR
  const acPending = 'Acceptance criteria pending — update before sprint.'
  const isReady = !!(feature.acceptance_criteria?.trim()) && feature.acceptance_criteria.trim() !== acPending

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-white/5 transition-all">
        <div className="flex items-center gap-2 flex-wrap">
          {feature.task_key && (
            <IssueKeyLink taskKey={feature.task_key} className="text-[10px] font-mono font-bold text-white/40 shrink-0 hover:text-white/70 hover:underline" />
          )}
          <span className="text-white text-sm font-medium truncate flex-1 min-w-0">{feature.title}</span>
          {/* `project` is optional on Feature, and this chip was unconditional —
              a row without one rendered an empty bordered pill, which reads as a
              value that failed to load rather than as a field that is absent. */}
          {feature.project && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ background: projColor + '20', color: projColor, border: `1px solid ${projColor}30` }}>
              {feature.project}
            </span>
          )}
          {feature.priority && (
            <PriorityBadge value={feature.priority} />
          )}
          <StatusBadge value={feature.status} />
          <Badge
            label={isReady ? 'Ready' : 'Not Ready'}
            className={isReady
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}
          />
        </div>
        {feature.description && (
          <p className="text-white/40 text-xs mt-1.5 line-clamp-2">{feature.description}</p>
        )}
        {/* The progress bar is the card's one metric, and it was rendered as
            two bare <div>s and the string "3/7" — no role, no accessible name,
            no unit. A screen reader got nothing at all from it, and a sighted
            reader got a ratio whose denominator was unstated ("3/7" of what?).
            role="progressbar" with the aria-value* triple is the standard way
            to say the same thing the pixels say, and the visible text now
            carries its noun.

            ROUND 2, 2026-08-26: a feature with ZERO children rendered
            role="progressbar" aria-valuemin="0" aria-valuemax="0"
            aria-valuenow="0". aria-valuemax must be greater than aria-valuemin,
            so that is a malformed widget, and assistive tech is entitled to
            report it as 0% or as nothing at all. There is no progress to
            report on an empty feature, so at total === 0 the bar carries no
            role at all: it is decoration (aria-hidden) and the text beside it
            states the fact instead of the ratio "0/0". */}
        <div className="mt-2.5 flex items-center gap-3">
          {total > 0 ? (
            <div
              className="flex-1 rounded-full h-1.5 bg-white/5"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={`${done} of ${total} child ${total === 1 ? 'issue' : 'issues'} done`}
              aria-label={`${feature.title} progress`}
            >
              <div className="h-1.5 rounded-full transition-all bg-green-400" style={{ width: pct + '%' }} />
            </div>
          ) : (
            <div className="flex-1 rounded-full h-1.5 bg-white/5" aria-hidden="true" />
          )}
          <span className="text-white/40 text-[10px] shrink-0">
            {total > 0 ? `${done}/${total} done` : 'no child issues'}
          </span>
          {onViewIssues && (
            <button onClick={e => { e.stopPropagation(); onViewIssues() }}
              className="text-[10px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded-lg hover:bg-white/5 transition-all shrink-0">
              View Issues →
            </button>
          )}
          <span className="text-white/25 text-[10px] shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && feature.children.length > 0 && (
        <div className="border-t border-white/10 px-4 py-2 space-y-1.5">
          {feature.children.map(child => (
            <div key={child.id} className="flex items-center gap-2 py-1">
              {child.task_key && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-lg bg-white/5 text-white/40 shrink-0">
                  {child.task_key}
                </span>
              )}
              <span className="text-white/60 text-xs truncate flex-1 min-w-0">{child.title}</span>
              {child.assignee && (
                <span className="text-sm shrink-0" title={child.assignee}>
                  {ASSIGNEE_EMOJI[child.assignee.toLowerCase()] ?? '👤'}
                </span>
              )}
              <StatusBadge value={child.status} />
            </div>
          ))}
        </div>
      )}

      {/* "No child issues" named nothing and could equally have meant the
          children failed to load. This card is handed its children already
          resolved by its parent, so an empty array here is a FACT about this
          feature, not an unknown — and saying which feature is what makes it
          read as a state rather than as breakage. */}
      {expanded && feature.children.length === 0 && (
        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-white/40 text-xs">
            {feature.task_key ? `${feature.task_key} has` : 'This feature has'} no child issues yet — that is correct, not broken.
          </p>
        </div>
      )}
    </div>
  )
}
