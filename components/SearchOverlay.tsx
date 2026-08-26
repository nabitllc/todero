'use client'
// components/SearchOverlay.tsx — search-and-jump piece (Wave 6)
//
// Was: one debounced `ilike` over issues whose every row, whichever issue it
// named, called `onNavigate('board')`. A row that reads as a link to an issue
// and is a link to a tab. No arrow keys, no Enter, no destinations, no
// statement of where anything came from.
//
// Now: a command palette. Three legs, each with its own success/failure —
//   1. IDENTIFIER  `TOD-1` -> GET /api/issues?task_key=TOD-1 (scoped server-side)
//   2. GO TO       destinations + views, derived from components/nav/config.ts
//   3. ISSUES      the text search, through the scoped /api/db seam
// — plus exactly one action (`Open chat`), because that is the only
// keyboard-reachable verb this app actually exposes. See
// docs/rebuild/pieces/pieces6/search-and-jump.md.
//
// SCOPE: this file adds no endpoint and no scope logic. Both issue legs go
// through seams whose boundary scripts/no-unscoped-issues.mjs already proves
// with live requests: /api/issues?task_key= answers 404 (never 403) for a key
// outside the caller's project so the palette cannot be used to enumerate
// other projects, and /api/db/issues fails closed without a resolvable scope.
// The 404 is rendered as "not found in <project>" and nothing more.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, X, CornerDownLeft } from 'lucide-react'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import {
  COMMANDS,
  COMMAND_SOURCE,
  matchCommands,
  normalizeTaskKey,
  pathForView,
  projectFromPath,
  issueSearchQuery,
  type PaletteCommand,
} from '@/lib/search-commands'

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
  /** app/page.tsx's `navigate` — resolves a legacy tab id or a destination id. */
  onNavigate: (tab: string) => void
}

interface IssueRow {
  task_key?: string
  title?: string
  status?: string
  type?: string
  priority?: string
  assignee?: string
  sprint?: string
  project?: string
}

/**
 * The surface that lists issues. There is no per-issue route, modal or focus
 * signal anywhere in this app (see the piece doc, structural fact 2), so an
 * issue row can honestly offer the list that contains it and nothing more —
 * and it says so on the row. Looked up in COMMANDS rather than hardcoded as a
 * token: if that view is renamed the lookup returns undefined and the rows
 * become non-activatable, which is visible, instead of silently landing
 * somewhere else.
 */
const ISSUE_LIST_KEY = 'work/list'
const ISSUE_SURFACE: PaletteCommand | undefined =
  COMMANDS.find(c => c.key === ISSUE_LIST_KEY) ??
  COMMANDS.find(c => c.destination === ISSUE_LIST_KEY.split('/')[0] && c.isDestinationRow)

/** The one action. `navigate('chat')` is special-cased by app/page.tsx to open
 *  ChatOverlay — a real, verified effect, which is the only reason it is here.
 *  No "assign to…", no "move to bolt": this app exposes no keyboard-reachable
 *  mutation, and a row that looks actionable and is not is worse than none. */
const CHAT_TOKEN = 'chat'

type Leg<T> = { state: 'idle' | 'loading' | 'ok' | 'missing'; data: T | null; error: ApiError | null }
const IDLE: Leg<never> = { state: 'idle', data: null, error: null }

/** An activatable row. Non-activatable rows (a 404 line, an error banner) are
 *  deliberately NOT options — Enter must never land on something inert. */
interface Option {
  id: string
  run: () => void
}

/** The dim monospace provenance treatment components/nav/Card.tsx established
 *  for its `source` prop — every group in this palette states where its rows
 *  came from, in the same style the design artboards call `.prov`. */
const PROV = 'font-mono text-[10px] leading-snug text-white/35 break-all'

function GroupHeader({ id, title, source }: { id: string; title: string; source: string }) {
  return (
    <div className="px-4 pt-3 pb-1.5">
      <div id={id} className="text-[10px] uppercase tracking-wider text-white/45 font-medium">{title}</div>
      <p className={PROV}>{source}</p>
    </div>
  )
}

export default function SearchOverlay({ open, onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [keyLeg, setKeyLeg] = useState<Leg<IssueRow>>(IDLE)
  const [textLeg, setTextLeg] = useState<Leg<IssueRow[]>>(IDLE)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const taskKey = normalizeTaskKey(query)
  const trimmed = query.trim()
  const textQuery = trimmed.length >= 2 ? trimmed : ''

  // The scope the SERVER will use for these requests, read off the same
  // `/p/<slug>` segment middleware.ts resolves it from — so the project this
  // overlay names is always the project that actually refused.
  const [scopeProject, setScopeProject] = useState<string | null>(null)
  useEffect(() => {
    if (open) setScopeProject(projectFromPath(window.location.pathname))
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery(''); setActive(0); setKeyLeg(IDLE); setTextLeg(IDLE)
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Escape closes even if focus has left the input (the arrow keys live on the
  // input, which keeps focus; this is the safety net the old overlay had).
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  // ── leg 1: identifier ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !taskKey) { setKeyLeg(IDLE); return }
    const ctrl = new AbortController()
    const endpoint = `/api/issues?task_key=${encodeURIComponent(taskKey)}`
    const t = setTimeout(async () => {
      setKeyLeg({ state: 'loading', data: null, error: null })
      const r = await fetchJson<IssueRow>(endpoint, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      // FOUND WHILE BUILDING THIS, and fixed here because the leaking file is
      // not this piece's to edit: `/api/issues?task_key=` only applies its 404
      // when middleware.ts resolved a scope. On Fleet, Runs and Settings →
      // Projects — the destinations middleware.ts deliberately marks
      // CROSS-PROJECT — no scope resolves, so that branch hands over ANY key's
      // full row. Verified live: on /p/limiglow/fleet/office, `TOD-1`
      // (project Todero) came back 200 with its title and project.
      //
      // app/api/db/[...path]/route.ts already refuses `issues` for exactly
      // those destinations, and its comment names THIS COMPONENT as the reason:
      // "SearchOverlay is mounted unconditionally, so Cmd-K pressed on the
      // Fleet screen returned another project's backlog". The task_key branch
      // is the same hole in a different door.
      //
      // The server's 404 remains the boundary; this is the palette declining
      // to be the one surface that renders a row from outside the project its
      // own URL names. It widens nothing and it is not claimed as enforcement.
      if (r.ok && r.data && scopeProject && r.data.project && r.data.project !== scopeProject) {
        setKeyLeg({ state: 'missing', data: null, error: null })
      }
      else if (r.ok) setKeyLeg({ state: 'ok', data: r.data, error: null })
      // 404 is the scope boundary doing its job, and it is indistinguishable —
      // deliberately — from a key that does not exist at all. Say only that.
      else if (r.status === 404) setKeyLeg({ state: 'missing', data: null, error: null })
      else setKeyLeg({ state: 'idle', data: null, error: r.error })
    }, 180)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [open, taskKey, scopeProject])

  // ── leg 3: issue text search ───────────────────────────────────────────────
  const textEndpoint = useMemo(
    () => (textQuery ? dbUrl(issueSearchQuery(textQuery)) : null),
    [textQuery],
  )
  useEffect(() => {
    if (!open || !textEndpoint) { setTextLeg(IDLE); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setTextLeg({ state: 'loading', data: null, error: null })
      const r = await fetchJson<IssueRow[]>(textEndpoint, { headers: dbRestHeaders(), signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      // `data` stays null on failure — never coerced to [], so "No matches"
      // can never render over a refused request.
      if (r.ok) setTextLeg({ state: 'ok', data: r.data ?? [], error: null })
      else setTextLeg({ state: 'idle', data: null, error: r.error })
    }, 260)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [open, textEndpoint])

  // ── activation ─────────────────────────────────────────────────────────────
  const go = useCallback((cmd: PaletteCommand) => {
    if (cmd.nav.kind === 'token') {
      onNavigate(cmd.nav.token)
    } else {
      // No onNavigate token can name this (destination, view). Push the
      // canonical URL and dispatch popstate — app/page.tsx's own back/forward
      // listener re-parses the URL and sets both, so this is the app's own
      // routing path, not a bypass of it.
      const path = pathForView(window.location.pathname, cmd.nav.destination, cmd.nav.view)
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    onClose()
  }, [onNavigate, onClose])

  const commands = useMemo(() => matchCommands(query), [query])
  const chatMatches =
    !trimmed || 'chat'.startsWith(trimmed.toLowerCase()) || 'open chat'.startsWith(trimmed.toLowerCase())
  const issueRows = textLeg.data ?? []

  // Flat option list, in render order — the single source of truth for both
  // the arrow keys and `aria-activedescendant`.
  const options = useMemo<Option[]>(() => {
    const out: Option[] = []
    if (keyLeg.state === 'ok' && keyLeg.data && ISSUE_SURFACE) {
      out.push({ id: 'opt-key', run: () => go(ISSUE_SURFACE) })
    }
    commands.forEach(c => out.push({ id: `opt-cmd-${c.key}`, run: () => go(c) }))
    if (chatMatches) out.push({ id: 'opt-chat', run: () => { onNavigate(CHAT_TOKEN); onClose() } })
    if (ISSUE_SURFACE) {
      issueRows.forEach((r, i) => out.push({ id: `opt-issue-${r.task_key ?? i}`, run: () => go(ISSUE_SURFACE) }))
    }
    return out
  }, [keyLeg.state, keyLeg.data, commands, chatMatches, issueRows, go, onNavigate, onClose])

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    if (active >= options.length) setActive(options.length ? options.length - 1 : 0)
  }, [options.length, active])

  const activeId = options[active]?.id
  useEffect(() => {
    if (!activeId) return
    listRef.current?.querySelector(`#${CSS.escape(activeId)}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (!options.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + options.length) % options.length) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); options[active]?.run() }
  }

  if (!open) return null

  const scopeName = scopeProject ?? 'this project'
  // Rows are matched to options BY ID, never by a parallel counter: if a row
  // is ever rendered that the option list does not contain, it degrades to
  // inert rather than firing whatever action happened to sit at that index.
  const row = (id: string) => {
    const i = options.findIndex(o => o.id === id)
    const selected = activeId === id
    return {
      id,
      role: 'option' as const,
      'aria-selected': selected,
      'aria-disabled': i < 0 ? true : undefined,
      onMouseEnter: () => { if (i >= 0) setActive(i) },
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onClick: () => options[i]?.run(),
      className:
        'w-full text-left px-4 py-2 cursor-pointer border-b border-white/[0.03] flex items-center gap-3 ' +
        (selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'),
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[560px] mx-4 bg-[#111] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Search size={15} className="text-white/30 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={true}
            aria-controls="search-palette-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search issues, jump to a destination, or type an issue key"
            placeholder="Jump to a destination, or type an issue key (TOD-1)…"
            className="flex-1 bg-transparent text-sm text-white/80 placeholder-white/25 outline-none"
          />
          <button onClick={onClose} aria-label="Close search" className="p-1 rounded hover:bg-white/[0.06] text-white/30">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div ref={listRef} id="search-palette-listbox" role="listbox" aria-label="Search results" className="max-h-[52vh] overflow-y-auto pb-2">

          {/* ── 1. identifier ─────────────────────────────────────────────── */}
          {taskKey && (
            <div role="group" aria-labelledby="grp-key">
              <GroupHeader
                id="grp-key"
                title={`Issue ${taskKey}`}
                // Factual, not a claim about enforcement: the request, and the
                // rule this palette applies to its answer.
                source={
                  scopeProject
                    ? `GET /api/issues?task_key=${taskKey} — shown only if it belongs to ${scopeProject}`
                    : `GET /api/issues?task_key=${taskKey} — this URL names no project, so no project filter applies`
                }
              />
              {keyLeg.state === 'loading' && <div className="px-4 py-2 text-xs text-white/30">Resolving {taskKey}…</div>}
              {keyLeg.error && <div className="px-2 pb-2"><ApiErrorBanner error={keyLeg.error} /></div>}
              {keyLeg.state === 'missing' && (
                // The server answered 404. That is the same answer for "no such
                // key" and "that key belongs to another project" — on purpose,
                // so a scoped caller cannot enumerate other projects. Say
                // exactly that, and make the row inert.
                <div aria-disabled="true" className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] font-mono text-white/30 shrink-0">{taskKey}</span>
                  <span className="text-xs text-white/45">not found in {scopeName}</span>
                </div>
              )}
              {keyLeg.state === 'ok' && keyLeg.data && (
                <div {...row('opt-key')}>
                  <span className="text-[10px] font-mono text-white/45 shrink-0">{keyLeg.data.task_key ?? taskKey}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-white/80 truncate">{keyLeg.data.title ?? '(no title on this row)'}</span>
                    <span className="block text-[10px] text-white/35 truncate">
                      {[keyLeg.data.status?.replace(/_/g, ' '), keyLeg.data.type, keyLeg.data.priority,
                        keyLeg.data.assignee, keyLeg.data.sprint, keyLeg.data.project]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-[10px] text-white/30 shrink-0 flex items-center gap-1">
                    {/* Honest label: nothing in this app opens a single issue. */}
                    <CornerDownLeft size={10} aria-hidden="true" />
                    {ISSUE_SURFACE ? `Open ${ISSUE_SURFACE.label}` : 'no list view'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── 2. destinations ───────────────────────────────────────────── */}
          {commands.length > 0 && (
            <div role="group" aria-labelledby="grp-go">
              <GroupHeader id="grp-go" title="Go to" source={COMMAND_SOURCE} />
              {commands.map(c => (
                <div key={c.key} {...row(`opt-cmd-${c.key}`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-white/80 truncate">{c.label}</span>
                    <span className="block text-[10px] text-white/35 truncate">{c.question}</span>
                  </span>
                  {/* The CURRENT canonical id, always from config — never the
                      legacy token the nav plan happens to use, or this badge
                      would print `sprint` under a row labelled "Bolt board". */}
                  <span className="text-[9px] font-mono text-white/25 shrink-0">
                    {c.isDestinationRow ? c.destination : c.key}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── the one action ────────────────────────────────────────────── */}
          {chatMatches && (
            <div role="group" aria-labelledby="grp-act">
              <GroupHeader
                id="grp-act"
                title="Action"
                source="app/page.tsx navigate('chat') — opens the Chat overlay (⌘J)"
              />
              <div {...row('opt-chat')}>
                <span className="min-w-0 flex-1 text-xs text-white/80">Open chat</span>
                <span className="text-[9px] font-mono text-white/25 shrink-0">chat</span>
              </div>
            </div>
          )}

          {/* ── 3. issue text search ──────────────────────────────────────── */}
          {textEndpoint && (
            <div role="group" aria-labelledby="grp-issues">
              <GroupHeader
                id="grp-issues"
                title={`Issues matching “${textQuery}”`}
                source={`GET ${textEndpoint} — project and archived clauses injected server-side`}
              />
              {textLeg.state === 'loading' && <div className="px-4 py-2 text-xs text-white/30">Searching…</div>}
              {/* A failed leg shows its failure. It is never collapsed into
                  "no matches", and the destination group above keeps working. */}
              {textLeg.error && <div className="px-2 pb-2"><ApiErrorBanner error={textLeg.error} /></div>}
              {textLeg.state === 'ok' && issueRows.length === 0 && (
                <div className="px-4 py-2 text-xs text-white/30">
                  no issue in {scopeName} matches “{textQuery}”
                </div>
              )}
              {issueRows.map((r, i) => (
                <div key={r.task_key ?? i} {...row(`opt-issue-${r.task_key ?? i}`)}>
                  <span className="text-[10px] font-mono text-white/30 shrink-0">{r.task_key}</span>
                  <span className="text-xs text-white/70 truncate flex-1">{r.title}</span>
                  <span className="text-[9px] text-white/25 shrink-0">{(r.status ?? '').replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Last resort only: no group above rendered anything at all (a
              one-character query too short to search on). When a group IS
              present it already states its own outcome — an empty result, or
              its error — and repeating "nothing matches" under it would put a
              second, vaguer verdict next to the specific one. */}
          {options.length === 0 && !taskKey && !textEndpoint && (
            <div className="px-4 py-6 text-center text-xs text-white/25">
              nothing matches “{trimmed}” — no destination, no action, no issue
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/[0.06] flex items-center gap-3 text-[10px] text-white/25">
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
          <span className="ml-auto font-mono">{options.length} result{options.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
