'use client'
// ─── components/tabs/CrewTab.tsx — Fleet ▸ Team ─────────────────────────────
//
// fleet-cards piece. This surface used to be three stacked <h2> sections with
// no card contract at all: a static role legend, a member list, and the legacy
// AgentsTab grid. design/Fleet.dc.html asks for a Roster that answers one
// question with one number and says where every row came from, and the piece
// brief's complaint is precise — the roster showed sixteen rows all reading
// `never`, and nothing said whether that meant "no agent has ever checked in"
// or "we did not look".
//
// What changed, and why each thing is the way it is:
//
// 1. Everything renders inside components/nav/Card.tsx — the same shell Work
//    and Settings use. One question per title, one number from a real query,
//    the query printed underneath, a collapse that persists, an empty state
//    that names the fleet, and an error that REPLACES the body.
//
// 2. Liveness is classified by lib/fleet-liveness.ts, against the window
//    design/Fleet.dc.html states in words ("Offline after 10m of silence"),
//    and it has the state the old vocabulary lacked: `unknown`, for a
//    heartbeat store that could not be read. `never` is now a claim the
//    server earned by reading the store and finding nothing.
//
// 3. The legacy AgentsTab grid is no longer rendered. It words the same
//    timestamp with GET /api/agents' 60-second `live | stale | idle`
//    vocabulary (lib/agent-liveness.ts), and two roster renderings on one
//    screen disagreeing about the same heartbeat is exactly the confusion
//    this piece exists to remove.
//
//    Being precise about the consequence rather than reassuring about it:
//    CrewTab was AgentsTab's ONLY caller, so components/tabs/AgentsTab.tsx is
//    now unrendered (app/page.tsx still imports its `RosterMeta` type). The
//    file is untouched — it is not this piece's to delete — but everything it
//    put on screen had to be carried over here, and is: the agent detail
//    modal it hosted (AgentDetailView, with the pause/remove/heartbeat
//    controls) is mounted at the bottom of this file, and the three envelope
//    warnings it rendered — roster, vault registry, and vault-sync-not-
//    persisted — are rendered by RosterCard below. If something else it did
//    is missing, that is a defect in this piece, not an intended trim.
//
// 4. The Run control is DISABLED with the dispatch reason, never armed and
//    then refused. lib/dispatch-guard.ts is untouched: this asks the server
//    `POST /api/run-agent?dryRun=1` whether a dispatch would be allowed, and
//    when the answer is no it renders a control that sends nothing.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import { Lock, Trash2 } from 'lucide-react'
import Card from '@/components/nav/Card'
import AgentDetailView from '@/components/tabs/AgentDetailView'
import AgentLaunchControl from '@/components/tabs/AgentLaunchControl'
import FleetRegisterCard from '@/components/tabs/FleetRegisterCard'
import MemberDetailView from '@/components/tabs/MemberDetailView'
import type { RosterMeta } from '@/components/tabs/AgentsTab'
import type { WorkspaceMember } from '@/lib/rbac-types'
import type { VaultBadgeInfo } from '@/lib/vault-badge'
import type { AgentRunStatus } from '@/hooks/useAgentStatus'
import {
  activityHeadline,
  classifyFleetLiveness,
  describeActivity,
  describeLiveness,
  fleetHeadline,
  fleetProvenanceLine,
  summarizeActivity,
  summarizeFleet,
  type FleetActivity,
  type FleetActivityInput,
  type FleetLiveness,
  type FleetLivenessInput,
} from '@/lib/fleet-liveness'

// ── Types over the two endpoints this file reads ─────────────────────────────

/** The fields of GET /api/agents' AgentDto this surface renders. */
export interface RosterRowData {
  id: string
  name: string
  emoji?: string
  role?: string
  model?: string
  lastSeenAt: number | null
  livenessSource?: 'heartbeat' | 'none'
  /**
   * WHERE `lastSeenAt` came from. Optional only because this is a wire type
   * and an older server may not send it; `livenessOf()` below then FAILS
   * CLOSED and treats the row as carrying no hook event, rather than
   * defaulting to the flattering answer. See lib/fleet-liveness.ts.
   */
  lastSeenSource?: 'heartbeat' | 'registration' | 'none'
  rosterSource?: string
  rosterPath?: string | null
  /** Brain2 manifest fields, or null when the vault does not name this id. */
  vault?: VaultBadgeInfo | null
  /**
   * What GET /api/agents says this agent is on. Optional because it is a wire
   * field; `activityOf()` below fails closed when it is absent.
   */
  currentTask?: string | null
  /**
   * WHICH FACT `currentTask` is — the agent's own heartbeat, or a board row
   * that merely names it. Same provenance discipline as `lastSeenSource`, and
   * added for the same reason: before it existed this surface had no way to
   * tell "builder said it is doing TOD-42" from "TOD-42 is assigned to
   * builder", so it could only have rendered one of them as the other.
   */
  currentTaskSource?: 'heartbeat' | 'assigned-issue' | 'none'
  /** Epoch ms the assigned ISSUE went in progress. A board fact, not a check-in. */
  workStartedAt?: number | null
  /** The server's read-only budget verdict, or null when within every ceiling. */
  overCeiling?: { ceiling: string; reason: string } | null
}

export interface AgentsEnvelope {
  agents: RosterRowData[]
  rosterPath: string | null
  rosterWarning: string | null
  vaultPath: string | null
  /** Why the Brain2 vault contributed no rows — the ROSTER half of the sync. */
  vaultWarning: string | null
  /** Whether those manifests reached `agent_manifests` — the DISPATCH half. */
  vaultSync?: { source: string; persisted: boolean; warning: string | null } | null
  livenessSource: 'heartbeat' | 'none'
  heartbeatStore: string | null
  heartbeatWarning: string | null
}

/**
 * The envelope-level warnings AgentsTab used to render. They are facts about
 * a SOURCE, not about any one row, so they survive an empty roster — which is
 * the one case they matter most in. Carried over here because CrewTab was
 * AgentsTab's only caller; dropping them would have made a host with an
 * unreadable vault, or one whose manifests silently fail to persist, look
 * exactly like a healthy one.
 */
function EnvelopeWarnings({ env }: { env: AgentsEnvelope | null }) {
  if (!env) return null
  const notices: { key: string; label: string; text: string; tone: string }[] = []
  if (env.rosterWarning) {
    notices.push({ key: 'roster', label: 'Roster', text: env.rosterWarning, tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300' })
  }
  if (env.vaultWarning) {
    notices.push({
      key: 'vault',
      label: env.vaultPath ? 'Brain2 registry' : 'Brain2 registry not read',
      text: env.vaultWarning,
      tone: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
    })
  }
  if (env.vaultSync?.warning) {
    notices.push({
      key: 'vault-sync',
      label: 'Vault manifests not persisted',
      text: env.vaultSync.warning,
      tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    })
  }
  if (notices.length === 0) return null
  return (
    <div className="space-y-1.5 mb-2">
      {notices.map(n => (
        <div key={n.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${n.tone}`}>
          <span className="text-[11px] font-medium shrink-0">{n.label}</span>
          <span className="text-white/60 text-[10px] leading-relaxed break-all">{n.text}</span>
        </div>
      ))}
    </div>
  )
}

const ROSTER_QUERY = '/api/agents'
const DISPATCH_PROBE = '/api/run-agent?dryRun=1'

/**
 * Only the two states an operator must ACT on get a loud colour. `working` is
 * quietly good, `assigned` is quietly normal, `idle` is quietly nothing — if
 * all five shouted, none of them would.
 */
const ACTIVITY_TONE: Record<FleetActivity, string> = {
  blocked: 'text-red-300 border-red-500/40 bg-red-500/10',
  stalled: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  working: 'text-emerald-400/90 border-emerald-500/30 bg-emerald-500/5',
  assigned: 'text-sky-300/80 border-sky-500/25 bg-sky-500/5',
  idle: 'text-white/40 border-white/10 bg-white/5',
}

const LIVENESS_TONE: Record<FleetLiveness, string> = {
  live: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  offline: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  never: 'text-white/45 border-white/15 bg-white/5',
  unknown: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
}

/**
 * One roster row -> the three facts lib/fleet-liveness.ts classifies on.
 *
 * ONE place, used by both the per-row badge and the fleet summary, so the
 * headline and the row it counts can never disagree about a provenance.
 *
 * FAILS CLOSED on `lastSeenSource`: a server that does not report it is a
 * server whose provenance is unknown, and unknown provenance is not a hook
 * event. The alternative default — assuming 'heartbeat' — is precisely the
 * fabrication this field was added to end: a registration timestamp worded as
 * "heartbeat 4m ago" over a fleet with zero hook events.
 */
function livenessOf(env: AgentsEnvelope | null) {
  return (row: RosterRowData): FleetLivenessInput => ({
    lastSeenAt: row.lastSeenAt ?? null,
    observed: (row.livenessSource ?? env?.livenessSource) === 'heartbeat',
    source: row.lastSeenSource ?? 'none',
  })
}

/**
 * One roster row -> the five facts lib/fleet-liveness.ts classifies activity on.
 *
 * Paired with `livenessOf()` above and sharing its liveness result, so the
 * activity badge and the liveness badge on the same line can never be built
 * from two different readings of the same timestamp.
 *
 * FAILS CLOSED on `currentTaskSource` for the same reason `livenessOf` fails
 * closed on `lastSeenSource`: a server too old to report provenance is a
 * server whose provenance is unknown, and unknown provenance may not be
 * upgraded to "the agent said so".
 */
export function activityOf(env: AgentsEnvelope | null, now: number) {
  const liveness = livenessOf(env)
  // `now` is threaded rather than left to Date.now() so the activity badge and
  // the liveness badge on the same line are classified against the SAME
  // instant. Two clocks a few milliseconds apart is exactly how a row would
  // come to read `live` and `stalled` at once.
  return (row: RosterRowData): FleetActivityInput => ({
    currentTask: row.currentTask ?? null,
    currentTaskSource: row.currentTaskSource ?? 'none',
    workStartedAt: row.workStartedAt ?? null,
    overCeiling: row.overCeiling ?? null,
    liveness: classifyFleetLiveness(liveness(row), now),
  })
}

/**
 * Where this row came from, in words. A row with no Brain2 manifest SAYS it
 * has none rather than borrowing a tier or a model from somewhere plausible —
 * "if a roster row has no manifest, say so instead of implying one".
 */
function rowProvenance(row: RosterRowData, env: AgentsEnvelope | null): string {
  const manifest = row.vault
    ? `Brain2 manifest ${env?.vaultPath ? `${env.vaultPath}\\${row.id}\\manifest.json` : `for "${row.id}"`}`
    : 'no Brain2 manifest for this id'
  switch (row.rosterSource) {
    case 'registered':
      return `self-registered through POST /api/connect · ${manifest}`
    case 'vault':
      return manifest
    case 'agents-md':
      return `${row.rosterPath ?? env?.rosterPath ?? 'AGENTS.md'} · ${manifest}`
    default:
      return `${row.rosterSource ?? 'source not reported by /api/agents'} · ${manifest}`
  }
}

// ── The Run control ──────────────────────────────────────────────────────────

/**
 * design/Fleet.dc.html: "the control never appears live and then refuses."
 *
 * `dispatchEnabled` is a fact about the instance, not about one agent, and it
 * is read from the server's own dry run rather than guessed from anything in
 * the browser. While that answer is still in flight nothing clickable is
 * rendered at all. When dispatch IS armed the per-agent control takes over —
 * it runs its own per-agent dry run, because a runtime that is missing for
 * one agent is not a fact this shared probe can know.
 *
 * ROUND 2 (2026-08-26) — THIS FILE WAS BREAKING ITS OWN QUOTED RULE.
 *
 * The two probes it consults answer two different questions, and only one of
 * them was being asked:
 *
 *   * `POST /api/run-agent?dryRun=1` returns at app/api/run-agent/route.ts:380
 *     — SIXTY LINES BEFORE `checkDispatchCeilings()` at :440, whose refusal is
 *     the only 429 in that file. So a dry run reports `wouldSpawn: true` for an
 *     agent a real POST would refuse. Verified live: with `builder` carrying
 *     `overCeiling: { ceiling: 'concurrency_per_agent' }` in the same
 *     GET /api/agents payload, the dry run still answered `wouldSpawn: true`.
 *
 *   * `AgentDto.overCeiling` IS that ceiling verdict, read-only
 *     (`getCeilingStatus`), and this row already renders it in red as
 *     "A dispatch would be refused right now."
 *
 * The consequence was masked only by this instance having dispatch disabled.
 * Set `TODERO_DISPATCH_ENABLED=1` and, before this change, a red "blocked …
 * a dispatch would be refused right now" badge sat beside an armed
 * "Launch (Local)" button on the same line. That is precisely "appears live
 * and then refuses", one field away from the field that could have stopped it.
 *
 * So the ceiling gates the control too. Wording is deliberately about the last
 * read, not about the future: the roster refetches every 30s and a ceiling can
 * clear in between, so this says what the server said, not what it will say.
 */
function RunControl({
  dispatchEnabled,
  reason,
  row,
}: {
  dispatchEnabled: boolean | null
  reason: string | null
  row: RosterRowData
}) {
  if (dispatchEnabled === null) {
    return <span className="text-white/25 text-[10px] font-mono shrink-0">checking dispatch…</span>
  }
  if (dispatchEnabled) {
    // Per-agent refusal outranks the instance-wide "armed": the ceiling is a
    // fact about THIS agent that the shared dry run never checked.
    const blocked = ceilingRefusal(row)
    if (blocked) {
      return (
        <button
          type="button"
          disabled
          title={blocked}
          className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300/60 border border-amber-400/25 rounded-md px-2.5 py-1 cursor-not-allowed shrink-0"
        >
          <Lock size={10} />
          Run — over ceiling
        </button>
      )
    }
    return <AgentLaunchControl agentId={row.id} vault={row.vault ?? null} />
  }
  return (
    <button
      type="button"
      disabled
      title={reason ?? undefined}
      className="flex items-center gap-1.5 text-[11px] font-medium text-white/30 border border-white/12 rounded-md px-2.5 py-1 cursor-not-allowed shrink-0"
    >
      <Lock size={10} />
      Run — disabled
    </button>
  )
}

/**
 * The reason a dispatch for this row would be refused right now, or null when
 * the last roster read found no ceiling over.
 *
 * Exported so the gate is testable without a DOM (the same reason
 * `activityOf` is). `RunControl` is the only caller; the assertion that
 * matters is that a row carrying `overCeiling` never yields null, because
 * yielding null is what arms the button.
 *
 * FAILS CLOSED on a malformed verdict: a row whose `overCeiling` is present
 * but whose `reason` is empty still returns a non-null string, so a server
 * that reports a ceiling without wording it still disables the control rather
 * than arming it on a falsy reason.
 */
export function ceilingRefusal(row: RosterRowData): string | null {
  const over = row.overCeiling
  if (!over) return null
  const reason = (over.reason ?? '').trim()
  const ceiling = (over.ceiling ?? '').trim() || 'budget'
  return (
    `Over the ${ceiling} ceiling as of the last roster read` +
    (reason ? `: ${reason}` : ' (the server reported no reason text)') +
    '. POST /api/run-agent would answer 429 — see app/api/run-agent/route.ts. ' +
    'The dry run this card uses to arm the control returns before that check, so it cannot see this.'
  )
}

// ── Roster card ──────────────────────────────────────────────────────────────

function RosterCard({
  onOpen,
}: {
  onOpen: (row: RosterRowData) => void
}) {
  const [env, setEnv] = useState<AgentsEnvelope | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dispatch, setDispatch] = useState<{ enabled: boolean; reason: string | null } | null>(null)
  // Re-render on a timer so the ages below stay true without a reload; the
  // fetch itself is what refreshes the timestamps.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const r = await fetchJson<AgentsEnvelope>(ROSTER_QUERY)
    if (r.ok && Array.isArray(r.data?.agents)) {
      setEnv(r.data)
      setError(null)
    } else {
      setEnv(null)
      setError(r.ok ? { status: r.status, endpoint: ROSTER_QUERY, message: 'response carried no agents array' } : r.error)
    }
    setNow(Date.now())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(iv)
  }, [load])

  // One probe for the whole roster. `dispatchEnabled` comes from
  // lib/dispatch-guard.ts server-side; this only reads it.
  useEffect(() => {
    let cancelled = false
    void fetchJson<{ dispatchEnabled?: boolean; unavailableReason?: string | null; error?: string }>(
      DISPATCH_PROBE,
      { method: 'POST' },
    ).then(r => {
      if (cancelled) return
      if (!r.ok) {
        setDispatch({ enabled: false, reason: `could not ask the server whether dispatch is armed: ${r.error.message}` })
        return
      }
      setDispatch({
        enabled: r.data?.dispatchEnabled === true,
        reason:
          r.data?.dispatchEnabled === true
            ? null
            : 'Dispatch is disabled on this instance. Set TODERO_DISPATCH_ENABLED=1 to arm it (lib/dispatch-guard.ts).',
      })
    })
    return () => { cancelled = true }
  }, [])

  const rows = env?.agents ?? []
  const observed = env?.livenessSource === 'heartbeat'
  const inputs = rows.map(livenessOf(env))
  const summary = summarizeFleet(inputs, now)
  const activityInputs = rows.map(activityOf(env, now))
  const activity = summarizeActivity(activityInputs, now)

  // GET /api/agents takes no limit or offset — it returns the union of every
  // source in full — so this length is an exact count, not the size of a page.
  const source = (
    <>
      GET {ROSTER_QUERY} — full roster envelope, no limit/offset, so the count is exact
      <br />
      {fleetProvenanceLine(inputs, now)}
      <br />
      liveness: lib/fleet-liveness.ts, offline after 10m of silence (design/Fleet.dc.html). The agent detail
      view applies the server&apos;s narrower 60s window (lib/agent-liveness.ts) to this same timestamp.
      {env?.heartbeatStore && <> · heartbeats read from {env.heartbeatStore}</>}
    </>
  )

  const hasNotices = Boolean(env?.rosterWarning || env?.vaultWarning || env?.vaultSync?.warning)
  const emptyMessage = `No agent is declared in ${env?.rosterPath ?? 'this host’s AGENTS.md'}, no Brain2 manifest was found in ${env?.vaultPath ?? 'the vault registry'}, and no agent has self-registered — so this fleet has no roster.`

  if (error) {
    return (
      <Card id="fleet-roster" title="Which agents exist, and which are alive?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <Card
      id="fleet-roster"
      title="Which agents exist, and which are alive?"
      source={source}
      // Card's one number is how many rows the union produced; the per-state
      // breakdown is the first line of the body rather than the header,
      // because the header truncates and a truncated "…· 1 live" is worse
      // than no breakdown.
      //
      // The label is "in the fleet", NOT "registered", even though the field
      // behind it is `FleetSummary.registered`. On this host that read
      // "28 registered" while the same envelope's `rosterSource` breakdown had
      // exactly ONE registered agent — `registered` means "self-registered
      // through POST /api/connect" everywhere else on this surface (see
      // `rowProvenance` above and app/api/agents/fleet-roster.ts). Two
      // meanings for one word, twenty-seven apart, on one card.
      metric={loaded ? { value: summary.registered, label: 'in the fleet' } : undefined}
      // Card renders `empty.message` INSTEAD of children, so an empty roster
      // would swallow the source warnings below — and an empty roster is the
      // case those warnings exist to explain. When there is a warning to
      // show, the empty sentence moves into the body next to it instead.
      empty={
        loaded && rows.length === 0 && !hasNotices
          ? { active: true, message: emptyMessage }
          : undefined
      }
    >
      <EnvelopeWarnings env={env} />
      {loaded && rows.length === 0 && <p className="text-white/45 text-xs">{emptyMessage}</p>}
      {rows.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {/* What the fleet IS. */}
          <p className="font-mono text-[11px] text-white/60">{fleetHeadline(summary)}</p>
          {/* What the fleet is DOING — the second half of the question this
              card's title asks, and the half the roster used to leave out
              entirely. Ends in either a count of rows that need the operator
              or the words "nothing is waiting on you", never in silence. */}
          <p
            className={`font-mono text-[11px] ${activity.needsAttention > 0 ? 'text-amber-300/90' : 'text-white/45'}`}
          >
            {activityHeadline(activity)}
          </p>
        </div>
      )}
      {env?.heartbeatWarning && (
        <p className="text-amber-300/80 text-[11px] leading-relaxed mb-2 break-words">{env.heartbeatWarning}</p>
      )}
      {!observed && rows.length > 0 && (
        <p className="text-purple-300/85 text-[11px] leading-relaxed mb-2">
          The heartbeat store could not be read on this host, so every row below reads <em>not measured</em>. That is
          not the same as &ldquo;no agent has ever checked in&rdquo; — nothing was looked at.
        </p>
      )}
      <ul className="divide-y divide-white/5">
        {rows.map(row => {
          const desc = describeLiveness(livenessOf(env)(row), now)
          const act = describeActivity(activityOf(env, now)(row), now)
          return (
            <li key={row.id} className="py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="flex items-center gap-2 min-w-0 text-left rounded hover:bg-white/5 -mx-1 px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-white/40"
                  aria-label={`Open details for ${row.name}`}
                >
                  <span className="text-sm shrink-0" aria-hidden="true">{row.emoji ?? '•'}</span>
                  <span className="text-white text-[13px] font-semibold truncate">{row.name}</span>
                </button>
                <span className={`font-mono text-[10px] rounded px-1.5 py-0.5 border shrink-0 ${LIVENESS_TONE[desc.state]}`}>
                  {desc.badge}
                </span>
                {/* Two badges, two different questions: the first is "is it
                    checking in", this one is "what is it doing". They are
                    classified from the same instant (see activityOf) so they
                    cannot contradict each other. */}
                <span
                  className={`font-mono text-[10px] rounded px-1.5 py-0.5 border shrink-0 ${ACTIVITY_TONE[act.state]}`}
                  title={act.label}
                >
                  {act.badge}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-white/50 bg-white/5 rounded px-1.5 py-0.5 shrink-0">
                  {row.vault ? `tier ${row.vault.tier}` : 'no tier declared'}
                </span>
              </div>
              <p className="font-mono text-[10.5px] text-white/55 break-all">{row.model ?? 'no model reported by /api/agents'}</p>
              <p className="font-mono text-[10px] text-white/42 leading-snug">{desc.label}</p>
              {/* The activity sentence always names WHICH FACT it was built
                  from — "its own last heartbeat said so" vs "that is a board
                  row, not a check-in" — so the two can never be read as each
                  other. Only the two states an operator must act on are
                  coloured; the rest stay quiet. */}
              <p
                className={`font-mono text-[10px] leading-snug break-words ${
                  act.needsAttention ? 'text-amber-300/85' : 'text-white/42'
                }`}
              >
                {act.label}
              </p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-[10px] text-white/30 leading-snug break-all min-w-0">{rowProvenance(row, env)}</p>
                <span className="flex-1" />
                <RunControl dispatchEnabled={dispatch === null ? null : dispatch.enabled} reason={dispatch?.reason ?? null} row={row} />
              </div>
            </li>
          )
        })}
      </ul>
      {dispatch && !dispatch.enabled && (
        <p className="flex items-start gap-2 text-white/40 text-[11px] leading-relaxed mt-2 pt-2 border-t border-white/5">
          <Lock size={12} className="shrink-0 mt-0.5" />
          <span>
            Run is disabled because dispatch is off. Set{' '}
            <span className="font-mono text-white/65">TODERO_DISPATCH_ENABLED=1</span> to arm it — the control never
            appears live and then refuses. Asked of the server at{' '}
            <span className="font-mono text-white/55">POST {DISPATCH_PROBE}</span>; the real{' '}
            <span className="font-mono text-white/55">POST /api/run-agent</span> answers 503 DISPATCH_DISABLED while
            it is off.
          </span>
        </p>
      )}
    </Card>
  )
}

// ── Workspace members ────────────────────────────────────────────────────────

const ROLE_LINE: Record<string, string> = {
  owner: 'full access, including role management and workspace settings',
  member: 'full board and issue access; cannot manage roles or workspace settings',
  viewer: 'read-only; cannot create, edit, or transition',
}

function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [identity, setIdentity] = useState('')
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!identity.trim()) return
    setSaving(true)
    setError(null)
    const r = await fetchJson<{ error?: string }>('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: identity.trim(), role }),
    })
    setSaving(false)
    if (!r.ok) { setError(r.error.message); return }
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-white font-semibold text-sm mb-4">Add workspace member</h3>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-white/50 text-xs block mb-1">Identity (username, email, or agent id)</span>
            <input
              autoFocus
              value={identity}
              onChange={e => setIdentity(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30"
            />
          </label>
          <label className="block">
            <span className="text-white/50 text-xs block mb-1">Role</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value as typeof role)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
            >
              {(['owner', 'member', 'viewer'] as const).map(r => (
                <option key={r} value={r}>{r} — {ROLE_LINE[r]}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !identity.trim()} className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {saving ? 'Adding…' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CrewCard({
  isOwner,
  currentIdentity,
  onSelect,
}: {
  isOwner: boolean
  currentIdentity: string | null
  onSelect: (m: WorkspaceMember) => void
}) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    const r = await fetchJson<WorkspaceMember[]>('/api/roles')
    if (r.ok && Array.isArray(r.data)) { setMembers(r.data); setError(null) }
    else { setMembers([]); setError(r.ok ? { status: r.status, endpoint: '/api/roles', message: 'response was not a list of members' } : r.error) }
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])

  const source = 'GET /api/roles — every workspace role row, no limit/offset, so the count is exact'

  if (error) {
    return (
      <Card id="fleet-crew" title="Who can change what in this workspace?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <>
      <Card
        id="fleet-crew"
        title="Who can change what in this workspace?"
        source={source}
        metric={loaded ? { value: members.length, label: 'members' } : undefined}
        action={isOwner ? { label: 'Add member', onClick: () => setShowAdd(true) } : undefined}
        empty={loaded && members.length === 0 ? { active: true, message: 'No human or agent identity holds a role in this workspace yet, so nobody but the owner cookie can act on this fleet.' } : undefined}
      >
        <ul className="divide-y divide-white/5">
          {members.map(m => {
            const isMe = currentIdentity !== null && currentIdentity === m.identity
            return (
              <li key={m.id} className="flex items-center gap-2.5 py-2">
                <span className={`w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-[11px] font-medium shrink-0${isMe ? ' ring-2 ring-blue-500/60' : ''}`}>
                  {m.identity.charAt(0).toUpperCase()}
                </span>
                <button type="button" onClick={() => onSelect(m)} className="flex-1 min-w-0 text-left rounded hover:bg-white/5 px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-white/40">
                  <span className="text-white text-[13px] font-medium truncate block">{m.identity}{isMe && <span className="text-blue-300 text-[10px] ml-1.5">you</span>}</span>
                  <span className="text-white/30 text-[10px]">{m.assigned_by ? `assigned by ${m.assigned_by}` : 'no assigning identity recorded'}</span>
                </button>
                {isOwner ? (
                  <select
                    value={m.role}
                    onChange={async e => {
                      const r = await fetchJson('/api/roles', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: m.id, role: e.target.value }),
                      })
                      if (!r.ok) setError(r.error)
                      await load()
                    }}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/30"
                  >
                    {(['owner', 'member', 'viewer'] as const).map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <span className="text-white/50 text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10">{m.role}</span>
                )}
                {isOwner && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove ${m.identity} from workspace?`)) return
                      const r = await fetchJson(`/api/roles?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
                      if (!r.ok) setError(r.error)
                      await load()
                    }}
                    className="text-white/20 hover:text-red-400 transition-colors p-1 shrink-0"
                    title={`Remove ${m.identity}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-white/30 text-[10px] leading-relaxed mt-2 pt-2 border-t border-white/5">
          {(['owner', 'member', 'viewer'] as const).map(r => `${r}: ${ROLE_LINE[r]}`).join(' · ')}
        </p>
      </Card>
      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </>
  )
}

// ── CrewTab ──────────────────────────────────────────────────────────────────

export default function CrewTab({
  agentsError,
  userRole,
  currentIdentity,
  agentModal,
  setAgentModal,
  onAgentRemoved,
}: {
  /** Why app/page.tsx's own /api/agents load failed, if it did. The roster
   *  card below re-fetches on its own 30s timer and renders its own error, so
   *  this is only a banner for the surrounding page's copy of that state. */
  agentsError?: ApiError | null
  userRole: string | null
  currentIdentity: string | null
  // Props app/page.tsx passes that this surface no longer reads. The roster
  // card asks /api/agents itself so its numbers and its ages refresh on the
  // Team view, which the page-level loader only polls on the Office view.
  displayAgents?: unknown[]
  agentLiveStatus?: (agentId: string) => { dot: 'green' | 'amber' | 'grey'; label: string }
  agentRunsData?: Record<string, { taskTitle: string; startedAt: string | null; status: AgentRunStatus }>
  liveAgents?: unknown[] | null
  rosterMeta?: RosterMeta | null
  projectFilter?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentDetailView's own prop type
  agentModal: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentDetailView's own prop type
  setAgentModal: (a: any) => void
  onAgentRemoved?: (agentId: string) => void
}) {
  const isOwner = userRole === 'owner' || userRole === 'god' || userRole === 'admin'
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null)

  return (
    <div className="space-y-4">
      {agentsError && <ApiErrorBanner error={agentsError} />}

      <RosterCard onOpen={setAgentModal} />
      <FleetRegisterCard />
      <CrewCard isOwner={isOwner} currentIdentity={currentIdentity} onSelect={setSelectedMember} />

      {agentModal && (
        <AgentDetailView agent={agentModal} onClose={() => setAgentModal(null)} onRemoved={onAgentRemoved} />
      )}

      {selectedMember && (
        <MemberDetailView
          member={{
            id: selectedMember.id,
            name: selectedMember.identity,
            emoji: '👤',
            role: selectedMember.role,
            joinDate: selectedMember.assigned_by ? `assigned by ${selectedMember.assigned_by}` : '',
          }}
          onClose={() => setSelectedMember(null)}
          onNavigateToIssue={issueId => { window.location.href = `/?issue=${encodeURIComponent(issueId)}` }}
        />
      )}
    </div>
  )
}
