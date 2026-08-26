'use client'
import React from 'react'
import { Lock } from 'lucide-react'
import type { Task } from '@/lib/issues'
import { issuePermalinkPath, navigateToIssuePermalink } from '@/lib/issue-permalink'
import { formatAgo } from '@/lib/time'

// TOD-2463: a render site for an issue key on the board.
//
// CORRECTION, 2026-08-26 (round 2). The comment that stood here said
// components/tabs/BoardTab.tsx:538 "is a duplicate local copy that nothing
// renders." That is FALSE of the shipped code, a critic caught it, and it was
// false in both this file and components/tabs/FeatureCard.tsx while round 1's
// own piece doc (section 1.1 item 3) proved it false. Verified again today:
//
//   BoardTab.tsx:521   const renderBoardCard = (task) => ...
//   BoardTab.tsx:538     <IssueKeyLink .../>      (inside renderBoardCard)
//   BoardTab.tsx:930 / 1015 / 1125   colTasks.map(task => renderBoardCard(task))
//   BoardTab.tsx:1199  <KanbanCard .../>          (this file)
//
// So BoardTab has TWO card treatments and renders BOTH: `renderBoardCard` with
// its own local IssueKeyLink in the three swimlane modes (feature / sprint /
// business), and this card in the default 'together' mode. Deleting that copy
// as dead code would blank the issue key in a third of the board's view modes.
//
// What IS true, and is why this anchor exists: TOD-174 was on the board and
// `a[href*="/i/"]` counted ZERO, because the element the DEFAULT mode rendered
// was a SPAN carrying this file's className. That measurement was of this card,
// not of BoardTab's.
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

// ─── color maps ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'Critical' },
  high:     { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'High'     },
  medium:   { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium'   },
  low:      { bg: 'bg-zinc-500/20',   text: 'text-zinc-400',   label: 'Low'      },
}

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  task:    { bg: 'bg-zinc-600/30',    text: 'text-zinc-300'   },
  bug:     { bg: 'bg-red-500/20',     text: 'text-red-400'    },
  feature: { bg: 'bg-blue-500/20',    text: 'text-blue-400'   },
  ops:     { bg: 'bg-amber-500/20',   text: 'text-amber-400'  },
  epic:    { bg: 'bg-purple-500/20',  text: 'text-purple-400' },
  subtask: { bg: 'bg-slate-600/30',   text: 'text-slate-300'  },
}

// no-invented-projects-sweep: 'kemuni-sme' (#3b82f6) and 'vespera-sme'
// (#a855f7) were entries in this map and in ASSIGNEE_INITIALS below. Neither
// agent exists. Both maps are keyed lookups with a fallback, so an id that is
// absent simply renders as the neutral unknown-assignee avatar.
const ASSIGNEE_COLORS: Record<string, string> = {
  main:         '#818cf8',
  scout:        '#3b82f6',
  ops:          '#f59e0b',
  builder:      '#f97316',
  tester:       '#22c55e',
  michael:      '#6b7280',
  designer:     '#ec4899',
  auditor:      '#14b8a6',
  growth:       '#10b981',
  po:           '#6366f1',
  ux:           '#ec4899',
}

const ASSIGNEE_INITIALS: Record<string, string> = {
  main:         'K',
  scout:        'S',
  ops:          'O',
  builder:      'B',
  tester:       'T',
  michael:      'M',
  designer:     'D',
  auditor:      'A',
  growth:       'G',
  po:           'P',
  ux:           'D',
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

/**
 * How much of `blocked_by` the VISIBLE chip may show.
 *
 * A kanban column is narrow and the blocker chip shares its row with the
 * priority badge, the type badge and the age chip. A task key ("TOD-2411") is
 * 8-9 characters and fits; a sentinel like "system:ceiling_stop:no_progress"
 * is 31 and does not — it was wrapping the badge row on a real board. 18 keeps
 * every task key whole and clips only the long machine-generated values, which
 * stay complete in the tooltip and for assistive tech.
 */
const BLOCKER_CHIP_MAX = 18

// ─── how long has this been sitting here ─────────────────────────────────────
//
// ROUND 2. The benchmark this lane is measured against is Linear, and the
// sentence is "the board tells you where work is stuck WITHOUT you asking".
// A critic pointed out that round 1 rendered ZERO time signal on this card —
// `grep -niE "ago|updated_at|Date.now|elapsed" components/KanbanCard.tsx`
// returned nothing — while `updated_at` and `started_at` are already on the
// Task interface (lib/issues.ts) and already in the route's default column list
// (app/api/issues/route.ts:1122, SELECT_COLS). That is the identical argument
// round 1 used to justify rendering `blocked_by`, declined for the one field
// the benchmark is actually about. It was right.
//
// WHAT THIS IS NOT: Linear shows true time-in-state, and this app cannot. There
// is no status_changed_at column and no status history table — verified today
// by grep across app/, lib/ and migrations/. So the card says only what the two
// real columns support, and labels which one it is showing:
//
//   in_progress + started_at  ->  "started 4h 12m ago"
//        /api/issues sets started_at on entry to in_progress and clears it on
//        a return to backlog/refined/open (route.ts:1955-1963), so for a row
//        currently in progress this IS the age of the work. It is the same
//        column the stale-claim watchdog keys off.
//   anything else             ->  "updated 6d ago"
//        `updated_at` moves on ANY edit, so it is a last-touched signal and is
//        NOT called anything else. Naming it "in this column for 6d" would be
//        the fabrication.
//
// No fabricated zero: an absent timestamp renders no chip at all. `formatAgo`
// (lib/time.ts, the canonical formatter this repo is consolidating on) already
// returns the empty string for an absent or unparseable input.
export const IN_PROGRESS_ATTENTION_MS = 24 * 60 * 60 * 1000

export interface TimeSignal {
  /** Visible chip text, e.g. "started 4h 12m ago". */
  label: string
  /** The same fact spelled out for a screen reader. */
  accessibleLabel: string
  /** Work that has been in progress past IN_PROGRESS_ATTENTION_MS. */
  needsAttention: boolean
}

/**
 * The card's one time fact, or null when the row carries no usable timestamp.
 *
 * `needsAttention` fires only for in-progress work older than 24h, and only
 * there, because that is the one case where the underlying column means what
 * the warning would claim. 24h is chosen to match the app's own bolt window
 * (see lib/time.ts formatCountdown, rule 3) rather than invented; a `now`
 * argument is taken so this is deterministic under test.
 */
export function timeSignalFor(task: Task, now: number = Date.now()): TimeSignal | null {
  if (task.status === 'in_progress' && task.started_at) {
    const ago = formatAgo(task.started_at, now)
    if (!ago) return null
    const startedMs = Date.parse(task.started_at)
    return {
      label: `started ${ago}`,
      accessibleLabel: `work started ${ago}`,
      needsAttention: Number.isFinite(startedMs) && now - startedMs > IN_PROGRESS_ATTENTION_MS,
    }
  }
  if (task.updated_at) {
    const ago = formatAgo(task.updated_at, now)
    if (!ago) return null
    // Deliberately "updated", never "waiting" or "in this column": updated_at
    // moves on any edit and cannot carry the stronger claim.
    return { label: `updated ${ago}`, accessibleLabel: `last updated ${ago}`, needsAttention: false }
  }
  return null
}

// ─── component ─────────────────────────────────────────────────────────────────

export interface KanbanCardProps {
  task: Task
  dragging?: boolean
  /** Injectable clock, so the age chip is deterministic under test. */
  now?: number
  onClick?: (task: Task) => void
  onDragStart?: (task: Task) => void
  onDragEnd?: (task: Task) => void
}

export function KanbanCard({ task, dragging, onClick, onDragStart, onDragEnd, now }: KanbanCardProps) {
  const signal = timeSignalFor(task, now)
  const assigneeKey = task.assignee?.toLowerCase() ?? ''
  const dotColor    = ASSIGNEE_COLORS[assigneeKey] ?? '#6b7280'
  const initials    = ASSIGNEE_INITIALS[assigneeKey]
    ?? (task.assignee?.slice(0, 2).toUpperCase() || '?')

  const priority = task.priority?.toLowerCase() ?? ''
  const pb       = PRIORITY_BADGE[priority]

  const type = task.type?.toLowerCase() ?? ''
  const tb   = TYPE_BADGE[type]

  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(task)}
      onDragEnd={() => onDragEnd?.(task)}
      onClick={() => onClick?.(task)}
      // ─── ROUND 3: the card was mouse-only ────────────────────────────────
      //
      // A critic measured this root as `<div draggable onClick=…>` with no
      // role, no tabIndex and no key handler, and drew the right conclusion:
      // a keyboard user could not open a card at all, so the previous round
      // had spent itself adding sr-only labels to a target no assistive-tech
      // user could reach. `grep -c "onKeyDown" components/KanbanCard.tsx`
      // returned 0.
      //
      // The role/tabIndex/handler are attached ONLY when there is a real
      // `onClick` to reach. A focusable element that does nothing is worse
      // than an unfocusable one: it puts a stop in the tab order and pays
      // nothing back.
      //
      // Space is preventDefault-ed because on a focusable element the browser
      // scrolls the page on Space, which would move the board out from under
      // the card the operator just activated.
      //
      // What this is NOT: a claim that the card is fully accessible. The
      // column MOVE is still HTML5 drag-and-drop, which is mouse-only —
      // opening a card and moving a card are different gestures and only the
      // first is fixed here. And a `role`/`tabIndex` prop is not a screen
      // reader: nothing in this lane can dispatch a real focus or hear an
      // announcement. Both gaps are written up in the piece doc rather than
      // implied away.
      {...(onClick
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-label': `${task.task_key ? `${task.task_key}: ` : ''}${task.title}`,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onClick(task)
            },
          }
        : {})}
      className={[
        'group relative rounded-lg border cursor-pointer transition-colors bg-[#0f0f0f]',
        dragging ? 'opacity-50 border-zinc-600' : 'border-zinc-800 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="px-2.5 pt-2 pb-2 pr-8">
        {/* task key */}
        {task.task_key && (
          <div className="mb-1">
            <IssueKeyLink taskKey={task.task_key} className="text-[10px] font-mono font-bold text-white/40 hover:text-white/70 hover:underline" />
          </div>
        )}

        {/* title */}
        <p className="text-white text-xs font-medium leading-snug mb-2">
          {truncate(task.title)}
        </p>

        {/* badges row */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* priority badge */}
          {pb && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${pb.bg} ${pb.text}`}>
              {pb.label}
            </span>
          )}

          {/* type badge */}
          {tb && (
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${tb.bg} ${tb.text} capitalize`}>
              {type}
            </span>
          )}

          {/* Blocked indicator.
              The benchmark for this board is that it says where work is stuck
              WITHOUT being asked. A bare padlock does not: it says "stuck" and
              withholds the one fact that makes it actionable, which is what it
              is stuck ON. `blocked_by` is already on the row (lib/issues.ts
              Task) and was already fetched — it simply was not rendered, so the
              operator had to open the detail overlay to learn what it was.

              CORRECTION, ROUND 3. The sentence here used to end "…to learn a
              key that fits in eight characters", and that is FALSE of live
              data. `blocked_by` is not constrained to a task key. A critic
              fetched the only Limiglow row on the running server over
              authenticated HTTP and it carried
              `blocked_by: "system:ceiling_stop:no_progress"` — 31 characters —
              which this card then rendered untruncated inside a kanban column,
              while the file's own `truncate()` was applied to the title only.
              So the visible chip is truncated now (BLOCKER_CHIP_MAX below) and
              the WHOLE value is kept where length costs nothing: the `title`
              tooltip and the sr-only text. Shortening what a screen reader
              hears in order to fit a column would be the same trade in the
              wrong direction.

              The padlock also carried NO accessible name, so a screen reader
              got an unlabelled icon where a sighted user got a signal.
              components/tabs/BoardTab.tsx's own card already labelled its
              equivalent; this one is the card the default board actually
              renders, and it did not. */}
          {(task.is_blocked || task.blocked_by) && (
            <span
              className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-medium text-red-400"
              title={task.blocked_by ? `blocked by ${task.blocked_by}` : 'blocked'}
            >
              <Lock size={10} className="shrink-0" aria-hidden="true" />
              <span className="sr-only">{task.blocked_by ? `blocked by ${task.blocked_by}` : 'blocked'}</span>
              {task.blocked_by && (
                <span aria-hidden="true">{truncate(task.blocked_by, BLOCKER_CHIP_MAX)}</span>
              )}
            </span>
          )}

          {/* Age. See timeSignalFor above for exactly what each wording means
              and why nothing stronger is claimed. */}
          {signal && (
            <span
              className={`text-[9px] font-medium shrink-0 tabular-nums ${signal.needsAttention ? 'text-amber-400' : 'text-white/35'}`}
              title={signal.accessibleLabel}
            >
              <span aria-hidden="true">{signal.label}</span>
              <span className="sr-only">{signal.accessibleLabel}</span>
            </span>
          )}
        </div>
      </div>

      {/* assignee avatar — bottom-right */}
      <div
        className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
        style={{ background: dotColor }}
        title={task.assignee ?? ''}
      >
        {initials}
      </div>
    </div>
  )
}

export default KanbanCard
