// LAYOUT STRUCTURE — DO NOT BREAK (TOD-2381, nav-six-destinations):
// <div min-h-screen flex>
//   <BusinessRail />          ← w-14, always visible (business switcher, incl. mobile)
//   <PrimaryNav hidden lg:flex>  ← six-destination sidebar, desktop only
//   <main flex-1>             ← content: DestinationShell wraps each destination
//   <MobileNav lg:hidden>     ← six-destination bar pinned to the viewport foot, phones only
//   <ChatOverlay />           ← ⌘J, overlays whatever is on screen, never navigates
// </div>
//
// See the builder report (nav-six-destinations piece) for why the sidebar keeps
// the `lg:` breakpoint pairing with the phone nav instead of CLAUDE.md's literal
// `hidden md:flex` text — switching only the sidebar to `md:` while the phone
// nav stays `lg:hidden` would show both at once between 768 and 1023px wide.
'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { AGENT_DISPLAY, TOAST_COLORS, AGENT_EMOJI } from '@/lib/mc-constants'
import BusinessRail from '@/components/BusinessRail'
import OnboardingWizard from '@/components/OnboardingWizard'
import OverviewTab from '@/components/tabs/OverviewTab'
import ActivityTab from '@/components/tabs/ActivityTab'
import { type RosterMeta } from '@/components/tabs/AgentsTab'
import CrewTab from '@/components/tabs/CrewTab'
import CalendarTab from '@/components/tabs/CalendarTab'
import OfficeTab from '@/components/tabs/OfficeTab'
import MemoryTab, { type MemFile } from '@/components/tabs/MemoryTab'
import BoardTab from '@/components/tabs/BoardTab'
import FeaturesTab from '@/components/tabs/FeaturesTab'
import PipelineTab from '@/components/tabs/PipelineTab'
import IssuesTab from '@/components/tabs/IssuesTab'
import AutomationsTab from '@/components/tabs/AutomationsTab'
import InfraTab from '@/components/tabs/InfraTab'
import SettingsTab from '@/components/tabs/SettingsTab'
import ProductBoardTab from '@/components/tabs/ProductBoardTab'
import ProjectsTab from '@/components/tabs/ProjectsTab'
import InboxTab from '@/components/tabs/InboxTab'
import AIServicesTab from '@/components/tabs/AIServicesTab'
import EpicMapTab from '@/components/tabs/EpicMapTab'
import QuickActionFab from '@/components/QuickActionFab'
import SearchOverlay from '@/components/SearchOverlay'
import TopBar from '@/components/TopBar'
import InboxDrawer from '@/components/InboxDrawer'
import PrimaryNav from '@/components/nav/PrimaryNav'
import MobileNav from '@/components/nav/MobileNav'
import DestinationShell from '@/components/nav/DestinationShell'
import ChatOverlay from '@/components/nav/ChatOverlay'
import RunsView from '@/components/nav/RunsView'
import NowSignal from '@/components/nav/NowSignal'
import { DEFAULT_VIEW, LEGACY_TAB_MAP, isDestinationId, viewsOf, destinationOf, type DestinationId } from '@/components/nav/config'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { fetchJson, formatApiError, useApiData, type ApiError } from '@/hooks/useApiData'
import { runLiveness, type AgentRunStatus } from '@/hooks/useAgentStatus'

const BIZ_EMOJI: Record<string, string> = {
  'Vespera': '🖤', 'Kemuni': '🚀', 'Mission Control': '🧠', 'Todero': '🧠',
  'Infrastructure': '⚙️', 'KAOS': '🤖',
}

function bizToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

function slugToBizName(slug: string): string {
  const special: Record<string, string> = { 'kaos': 'KAOS' }
  if (special[slug]) return special[slug]
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Project slugs: only one project ("Limiglow") exists today, and it round-trips
// cleanly through this simple scheme. Not a project registry — see BOOTSTRAP.md
// on avoiding invented constants; this is a URL codec, not a source of project
// identity. The actual project names always come from /api/projects.
function projectToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}
function slugToProjectName(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

interface ParsedURL {
  destination: DestinationId
  view: string
  business: string | null
  project: string | null
  /** True only for the legacy /chat bookmark — Chat is an overlay now, not a route. */
  openChat: boolean
}

function parseURL(): ParsedURL {
  if (typeof window === 'undefined') return { destination: 'now', view: 'overview', business: null, project: null, openChat: false }
  const parts = window.location.pathname.split('/').filter(Boolean)
  let business: string | null = null
  let rest = parts
  if (parts[0] === 'b' && parts[1]) {
    business = slugToBizName(parts[1])
    rest = parts.slice(2)
  }
  const params = new URLSearchParams(window.location.search)
  const projParam = params.get('project')
  const project = projParam ? slugToProjectName(projParam) : null

  const first = rest[0]
  if (first === 'chat') {
    return { destination: 'now', view: 'overview', business, project, openChat: true }
  }
  if (first && LEGACY_TAB_MAP[first]) {
    const [destination, view] = LEGACY_TAB_MAP[first]
    return { destination, view, business, project, openChat: false }
  }
  if (first && isDestinationId(first)) {
    const destination = first as DestinationId
    const second = rest[1]
    const view = second && viewsOf(destination).includes(second) ? second : DEFAULT_VIEW[destination]
    return { destination, view, business, project, openChat: false }
  }
  return { destination: 'now', view: 'overview', business, project, openChat: false }
}

function buildPath(business: string | null, destination: DestinationId, view: string, project: string | null): string {
  const defaultView = DEFAULT_VIEW[destination]
  const segs = view !== defaultView ? [destination, view] : [destination]
  let base: string
  if (business) {
    base = `/b/${bizToSlug(business)}/${segs.join('/')}`
  } else if (destination === 'now' && view === 'overview') {
    base = '/'
  } else {
    base = `/${segs.join('/')}`
  }
  const qs = project ? `?project=${projectToSlug(project)}` : ''
  return base + qs
}

/**
 * Pull the row array out of an API response that is either a bare array
 * (legacy) or an honest envelope — `{ agents, configured, error }` /
 * `{ automations, configured, error }`. Those routes answer 503 when the host
 * is not configured but still ship the rows they do know about, so read the
 * body regardless of HTTP status instead of dropping it. Null = nothing usable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload is untyped JSON from fetch
function rowsFrom(payload: any, key: 'agents' | 'automations'): any[] | null {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload[key])) return payload[key]
  return null
}

export default function Home() {
  // MC-hydration: start with SSR-safe defaults; apply URL after mount to avoid hydration mismatch
  const [destination, setDestination] = useState<DestinationId>('now')
  const [view, setView] = useState<string>('overview')
  const [chatOpen, setChatOpen] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currentIdentity, setCurrentIdentity] = useState<string | null>(null)
  const [clock, setClock] = useState('')
  const [openMem, setOpenMem] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [inboxPendingCount, setInboxPendingCount] = useState(0)
  const [liveStatus, setLiveStatus] = useState<any>(null)
  const [statusAt, setStatusAt] = useState<number>(0)
  // TOD-654: every loader below records *why* it failed instead of leaving
  // its state empty. The tab that renders the data renders the banner.
  const [statusError, setStatusError] = useState<ApiError | null>(null)
  const [agentsError, setAgentsError] = useState<ApiError | null>(null)
  const [cronsError, setCronsError] = useState<ApiError | null>(null)
  const [projectsError, setProjectsError] = useState<ApiError | null>(null)
  const [activityError, setActivityError] = useState<ApiError | null>(null)
  const [calendarError, setCalendarError] = useState<ApiError | null>(null)
  const [activityReload, setActivityReload] = useState(0)
  const [agoSec, setAgoSec] = useState<number>(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent DTO rows from /api/agents
  const [liveAgents, setLiveAgents] = useState<any[] | null>(null)
  // Where /api/agents got its roster, and why it is empty when it is. Held on
  // the envelope so it survives a roster with zero rows.
  const [rosterMeta, setRosterMeta] = useState<RosterMeta | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped automation rows from /api/automations
  const [liveCrons, setLiveCrons] = useState<any[] | null>(null)
  // TOD (kill-fake-automations): the envelope's own account of what it checked,
  // so an empty list can say WHY instead of reading as "you have no automations".
  const [cronsMeta, setCronsMeta] = useState<{ source: string; scheduler: string; warnings: string[] } | null>(null)
  const [projects, setProjects] = useState<any[] | null>(null)
  const [globalToasts, setGlobalToasts] = useState<{id:number;text:string;color:string}[]>([])
  const globalToastIdRef = React.useRef(0)
  const addGlobalToast = React.useCallback((text: string, color = TOAST_COLORS.default) => {
    const id = ++globalToastIdRef.current
    setGlobalToasts(t => { const next = [...t, {id,text,color}]; return next.length > 4 ? next.slice(-4) : next })
    setTimeout(() => setGlobalToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])
  // ---------------------------------------------------------------------------
  // Loaders. TOD-654: none of these may fall through to an empty collection on a
  // non-ok response. `null` means "not loaded / refused"; `[]` means "the server
  // said there is nothing". The tabs branch on that difference.
  // ---------------------------------------------------------------------------
  const loadStatus = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- /api/status is a wide untyped health payload
    const r = await fetchJson<any>('/api/status')
    if (!r.ok) { setStatusError(r.error); setLiveStatus(null); return }
    setStatusError(null); setLiveStatus(r.data); setStatusAt(Date.now())
  }, [])

  const loadAgents = useCallback(async () => {
    // /api/agents answers 503 with the roster rows it does know about when
    // the host is not configured — the roster is real even when Supabase run
    // state isn't. `fetchJson` deliberately discards the body on any non-2xx
    // status (see lib/fetch-json.ts), which is right for callers that only
    // want a clean payload, but wrong here: it turned an honest 503-with-rows
    // into an infinite "Loading agent roster…" because `rows` stayed null
    // forever. Read the body ourselves, independent of the status, so a
    // failed roster fetch still shows the 16 real rows under the error
    // banner instead of hiding them behind a spinner that never resolves.
    let res: Response
    try {
      res = await fetch('/api/agents')
    } catch (e) {
      setAgentsError({
        status: 0,
        endpoint: '/api/agents',
        message: e instanceof Error ? e.message : 'could not reach the server',
      })
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- envelope or bare array
    let body: any = null
    try { body = await res.json() } catch { /* non-JSON body: rows/env stay null below */ }
    const rows = rowsFrom(body, 'agents')
    if (rows) setLiveAgents(rows)
    // The roster warning lives on the ENVELOPE, not the rows. Reading it off
    // row[0] — which the tabs used to do — lost it in the one case it matters:
    // an empty roster has no row 0, so "no AGENTS.md at <path>" silently became
    // a generic "no agents configured" with nothing to act on.
    const env = body && typeof body === 'object' && !Array.isArray(body) ? body : null
    setRosterMeta(env ? {
      source: typeof env.rosterSource === 'string' ? env.rosterSource : 'none',
      warning: typeof env.rosterWarning === 'string' ? env.rosterWarning : null,
      path: typeof env.rosterPath === 'string' ? env.rosterPath : null,
      // Brain2 vault provenance (docs/brain2-integration.md) — independent
      // of the AGENTS.md fields above, so a good roster and an unreachable
      // vault can both be true of the same response.
      vaultPath: typeof env.vaultPath === 'string' ? env.vaultPath : null,
      vaultWarning: typeof env.vaultWarning === 'string' ? env.vaultWarning : null,
      // registry-reaches-dispatch piece, round 2: the dispatch-side sync
      // result — did the vault manifests this roster shows actually get
      // written to agent_manifests. Envelope may predate this field (older
      // cached response, or a test double), so every sub-field is guarded.
      vaultSync: env.vaultSync && typeof env.vaultSync === 'object' ? {
        source: typeof env.vaultSync.source === 'string' ? env.vaultSync.source : 'none',
        persisted: env.vaultSync.persisted === true,
        warning: typeof env.vaultSync.warning === 'string' ? env.vaultSync.warning : null,
      } : null,
    } : null)
    if (res.ok) {
      setAgentsError(null)
    } else {
      const message = typeof env?.error === 'string' ? env.error : (res.statusText || 'request failed')
      setAgentsError({ status: res.status, endpoint: '/api/agents', message })
    }
  }, [])

  const loadCrons = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- envelope or bare array
    const r = await fetchJson<any>('/api/automations')
    const rows = rowsFrom(r.ok ? r.data : null, 'automations')
    if (rows) setLiveCrons(rows)
    if (r.ok && r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
      setCronsMeta({
        source: r.data.source ?? 'none',
        scheduler: r.data.scheduler ?? '',
        warnings: Array.isArray(r.data.warnings) ? r.data.warnings : [],
      })
    }
    setCronsError(r.ok ? null : r.error)
  }, [])

  const loadProjects = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
    const r = await fetchJson<any[]>('/api/projects')
    if (!r.ok) { setProjectsError(r.error); setProjects(null); return }
    setProjectsError(null)
    if (Array.isArray(r.data)) setProjects(r.data)
  }, [])

  // Memory files. `memPayload` stays null on 403/500, so MemoryTab can never
  // print "0 entries" or "No memory files yet." over a refused request.
  const { data: memPayload, error: memError, refetch: refetchMem } =
    useApiData<{ files?: MemFile[] }>('/api/memory')
  const memFiles: MemFile[] | null = memError ? null : memPayload ? memPayload.files ?? [] : null

  const [syncing, setSyncing] = useState(false)
  const globalSync = async () => {
    setSyncing(true)
    await Promise.all([loadStatus(), loadAgents(), loadCrons(), loadProjects()])
    setStatusCountdown(30)
    setSyncing(false)
  }
  const [agentModal, setAgentModal] = useState<any>(null)
  const [cronModal, setCronModal] = useState<any>(null)
  const [unreadChat, setUnreadChat] = useState(false)
  // MC-hydration: start null; apply from URL after mount
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null)
  // TOD-2381 (nav-six-destinations): a real project scope, DISTINCT from the
  // business rail. The old app/page.tsx wired every tab's `projectFilter`
  // prop straight off the selected BUSINESS — the business ("Todero") never
  // matched an issue's `project` field ("Limiglow"), so the filter silently
  // matched nothing and every tab rendered unfiltered data. This is the fix:
  // a project name, derived from
  // /api/projects for the selected business, living in the URL as `?project=`.
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [businessRailRefresh, setBusinessRailRefresh] = useState(0)
  // MC-hydration: start undefined; apply from URL params after mount
  const [boardFeatureFilter, setBoardFeatureFilter] = useState<string | undefined>(undefined)
  const [boardFeatureFilterName, setBoardFeatureFilterName] = useState<string | undefined>(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped issue rows
  const [issueActivity, setIssueActivity] = useState<any[] | null>(null)
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped issue rows
  const [calendarIssues, setCalendarIssues] = useState<any[] | null>(null)
  // `status` here is a *liveness* value (see runLiveness in hooks/useAgentStatus.ts),
  // never the raw agent_runs.status column. An orphaned `running` row (process
  // died without reporting) must read as 'stale', not 'live' — every consumer
  // of this state (TopBar, AgentsTab, OfficeTab) relies on that.
  const [agentRunsData, setAgentRunsData] = useState<Record<string, {taskTitle:string; startedAt:string|null; status:AgentRunStatus}>>({})
  const [agentIssueCounts, setAgentIssueCounts] = useState<Record<string, number>>({})
  // Real /api/issues `total` for the selected project — never estimated, never
  // reused across projects. Drives the honest "0 issues, that's correct" note
  // (DestinationShell) and the Work sidebar badge. null = no project scoped,
  // or the count hasn't come back yet.
  const [projectIssueTotal, setProjectIssueTotal] = useState<number | null>(null)

  // Read mc-role cookie (not httpOnly — accessible to JS) for RBAC-aware UI
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)mc-role=([^;]+)/)
    if (match) {
      const raw = decodeURIComponent(match[1])
      const colonIdx = raw.indexOf(':')
      if (colonIdx !== -1) {
        setCurrentIdentity(raw.slice(0, colonIdx))
        setUserRole(raw.slice(colonIdx + 1))
      } else {
        setUserRole(raw)
      }
    }
  }, [])

  // MC-hydration: restore destination/view/business/project from the URL after
  // mount, then replace the initial history entry with the CANONICAL path (this
  // also resolves a legacy /chat bookmark to an overlay instead of a route, with
  // no extra back-button entry).
  useEffect(() => {
    const { destination: d, view: v, business, project, openChat } = parseURL()
    setDestination(d)
    setView(v)
    if (business) setSelectedBusiness(business)
    if (project) setSelectedProject(project)
    if (openChat) setChatOpen(true)
    window.history.replaceState({ biz: business, destination: d, view: v, project }, '', buildPath(business, d, v, project))
    const p = new URLSearchParams(window.location.search)
    const feat = p.get('feature')
    if (feat) setBoardFeatureFilter(feat)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-trigger onboarding wizard when no businesses exist (workspace not yet onboarded)
  useEffect(() => {
    // Only a confirmed-empty 200 means "not onboarded yet"; a 403/500 must
    // never auto-open the wizard as though the workspace were blank.
    fetchJson<unknown>('/api/businesses').then(r => {
      if (r.ok && Array.isArray(r.data) && r.data.length === 0) setShowOnboarding(true)
    })
  }, [])

  // TOD-2381: derive the real project scope for the selected business. There is
  // exactly one business and one project today, so this never renders a
  // switcher (design/Nav.dc.html: "Hubs and project switching are deliberately
  // absent until one project works well") — it just auto-scopes to the single
  // project a business owns, without ever overriding an explicit choice
  // already restored from the URL.
  useEffect(() => {
    if (!selectedBusiness) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows, joined with businesses.name
    fetchJson<any[]>('/api/projects').then(r => {
      if (!r.ok || !Array.isArray(r.data)) return
      const mine = r.data.filter((p: any) => p?.businesses?.name === selectedBusiness && p.status !== 'archived')
      if (mine.length === 1) {
        setSelectedProject(prev => prev ?? mine[0].name)
      }
    })
  }, [selectedBusiness])

  // Real issue total for the scoped project — never a placeholder, never carried
  // over from a different project.
  useEffect(() => {
    if (!selectedProject) { setProjectIssueTotal(null); return }
    fetchJson<{ total?: number }>(`/api/issues?project=${encodeURIComponent(selectedProject)}&limit=0`).then(r => {
      setProjectIssueTotal(r.ok && r.data && typeof r.data.total === 'number' ? r.data.total : null)
    })
  }, [selectedProject])

  // Agent runs + issue counts polling
  useEffect(() => {
    const prevRunsRef: { current: Record<string,string> } = { current: {} }
    const fetchRuns = () => {
      const runsUrl = dbUrl(`agent_runs?select=agent_id,task_title,status,started_at&order=started_at.desc&limit=50`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
      fetchJson<any[]>(runsUrl, { headers: dbRestHeaders() }).then(res => {
        if (!res.ok) { addGlobalToast(formatApiError(res.error, 'agent runs unavailable'), TOAST_COLORS.error); return }
        const rows = res.data
        if (!Array.isArray(rows)) return
        // Two views of the same latest-row-per-agent data: `rawStatusByAgent`
        // is the literal agent_runs.status column, used only to decide which
        // toast to fire on a transition (started/done/error). `byAgent` is
        // what every other consumer reads, and it must never carry an
        // unclosed 'running' row as if it were live — it goes through
        // runLiveness() (hooks/useAgentStatus.ts), the same rule the office
        // canvas and Fleet use, so nothing here can disagree with them.
        const byAgent: Record<string, {taskTitle:string; startedAt:string|null; status:AgentRunStatus}> = {}
        const rawStatusByAgent: Record<string, string> = {}
        for (const r of rows) {
          if (byAgent[r.agent_id]) continue
          byAgent[r.agent_id] = { taskTitle: (r.task_title || '').slice(0, 40), startedAt: r.started_at, status: runLiveness(r) }
          rawStatusByAgent[r.agent_id] = r.status
        }
        for (const [agentId, rawStatus] of Object.entries(rawStatusByAgent)) {
          const prev = prevRunsRef.current[agentId]; const e = AGENT_EMOJI[agentId] || '🤖'
          const info = byAgent[agentId]
          if (prev && prev !== rawStatus) {
            if (rawStatus === 'running') addGlobalToast(`${e} ${agentId} started: ${info.taskTitle}`, TOAST_COLORS.started)
            else if (rawStatus === 'completed' || rawStatus === 'done') addGlobalToast(`${e} ${agentId} done: ${info.taskTitle}`, TOAST_COLORS.done)
            else if (rawStatus === 'error') addGlobalToast(`${e} ${agentId} error: ${info.taskTitle}`, TOAST_COLORS.error)
          }
          prevRunsRef.current[agentId] = rawStatus
        }
        setAgentRunsData(byAgent)
      })
    }
    const fetchAgentIssues = () => {
      const countsUrl = dbUrl(`issues?status=in.(open,in_progress,code_review,product_review,approved,released)&sprint=not.is.null&select=assignee&limit=500`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
      fetchJson<any[]>(countsUrl, { headers: dbRestHeaders() }).then(res => {
        // A failed poll leaves the previous counts alone rather than zeroing them.
        if (!res.ok || !Array.isArray(res.data)) return
        const counts: Record<string, number> = {}
        for (const r of res.data) { if (r.assignee) counts[r.assignee] = (counts[r.assignee] || 0) + 1 }
        setAgentIssueCounts(counts)
      })
    }
    fetchRuns(); fetchAgentIssues()
    const iv = setInterval(() => { fetchRuns(); fetchAgentIssues() }, 30000)
    return () => clearInterval(iv)
    // Agent-level aggregates, not per-issue project-labeled content — Fleet and
    // Runs are deliberately agent-centric, not scoped to one project's issues
    // (design/Nav.dc.html: "which agents exist... what did that agent do").
  }, [])

  // Calendar issues — scoped to the selected project so Work's due-dates view
  // and Settings' job-timing view never show another project's issue.
  useEffect(() => {
    const projectClause = selectedProject ? `&project=eq.${encodeURIComponent(selectedProject)}` : ''
    const calUrl = dbUrl(`issues?due_date=not.is.null${projectClause}&select=id,task_key,title,due_date,project,status&limit=200`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(calUrl, { headers: dbRestHeaders() }).then(res => {
      if (!res.ok) { setCalendarError(res.error); setCalendarIssues(null); return }
      setCalendarError(null)
      setCalendarIssues(Array.isArray(res.data) ? res.data : [])
    })
  }, [selectedProject])

  // Issue activity feed — same project scoping as above (nav-six-destinations
  // piece, acceptance item 4: no panel may show an issue outside the scoped
  // project). Refetches on destination change to keep Now/Activity reasonably
  // fresh when the operator navigates back to it, same as before this rewrite.
  useEffect(() => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const projectClause = selectedProject ? `&project=eq.${encodeURIComponent(selectedProject)}` : ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(dbUrl(`issues?updated_at=gte.${since}${projectClause}&order=updated_at.desc&limit=200&select=task_key,title,status,assignee,updated_at,resolution_type,sprint,type`), {
      headers: dbRestHeaders()
    }).then(res => {
      if (!res.ok) { setActivityError(res.error); setIssueActivity(null); return }
      setActivityError(null)
      const data = res.data
      if (!Array.isArray(data)) { setIssueActivity([]); return }
      setIssueActivity(data.map((i: any) => {
        const agoMin = Math.round((Date.now() - new Date(i.updated_at).getTime()) / 60000)
        const ai = AGENT_DISPLAY[i.assignee] || null
        return { type:'issue', emoji: ['completed','closed','released'].includes(i.status)?'✅':i.status==='in_progress'?'🔧':['code_review','product_review','approved'].includes(i.status)?'👁':'📋', agentId: i.assignee||'system', agentName: ai?.name||i.assignee||'System', channel: i.task_key, action:'issue', desc: `${i.title} → ${(i.status||'').replace(/_/g,' ')}${i.resolution_type?` (${i.resolution_type.replace(/_/g,' ')})`:''}`, ago: agoMin, date: agoMin<60?'Today':agoMin<1440?'Yesterday':'Earlier' }
      }))
    })
  }, [destination, activityReload, selectedProject])

  // Cmd+K search
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  // Cmd+[ inbox drawer
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '[') { e.preventDefault(); setInboxOpen(v => !v) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  // Cmd+J Chat overlay — opens over whatever is on screen, never navigates.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'j') { e.preventDefault(); setChatOpen(v => !v) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  // Inbox pending count polling
  useEffect(() => {
    const fetch_ = () => {
      // A failed poll must not zero the badge — leave the last known count.
      fetchJson<unknown>('/api/inbox?status=pending').then(r => {
        if (r.ok && Array.isArray(r.data)) setInboxPendingCount(r.data.length)
      })
    }
    fetch_()
    const iv = setInterval(fetch_, 30000)
    return () => clearInterval(iv)
  }, [])

  // Browser back/forward
  useEffect(() => {
    const onPop = () => {
      const { destination: d, view: v, business, project } = parseURL()
      setDestination(d); setView(v); setSelectedBusiness(business); setSelectedProject(project)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Unread chat event
  useEffect(() => {
    const h = () => setUnreadChat(true)
    window.addEventListener('mc-chat-unread', h); return () => window.removeEventListener('mc-chat-unread', h)
  }, [])

  const [statusCountdown, setStatusCountdown] = useState(30)
  const fetchStatus = loadStatus
  const fetchAgentsAndCrons = useCallback(() => { loadAgents(); loadCrons() }, [loadAgents, loadCrons])
  useEffect(() => { fetchStatus(); const t = setInterval(() => { fetchStatus(); setStatusCountdown(30) }, 30000); const cd = setInterval(() => setStatusCountdown(s => Math.max(0, s - 1)), 1000); return () => { clearInterval(t); clearInterval(cd) } }, [])
  useEffect(() => { fetchAgentsAndCrons(); const t = setInterval(() => { fetchAgentsAndCrons() }, 60000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!(destination === 'fleet' && view === 'office')) return; const iv = setInterval(() => { loadAgents() }, 30000); return () => clearInterval(iv) }, [destination, view, loadAgents])
  useEffect(() => { if (!statusAt) return; const t = setInterval(() => setAgoSec(Math.floor((Date.now() - statusAt) / 1000)), 1000); return () => clearInterval(t) }, [statusAt])
  useEffect(() => { const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'America/New_York'}) + ' ET'), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  // null means "/api/projects has not answered yet, or refused" — it is never
  // stood in for. The bundled DEFAULT_SPRINT_PROJECTS carry no taskCounts, so
  // using them as a placeholder made the Overview's front page render
  // "Vespera 0% done 0/0" before any request had even been made, and keep
  // rendering it forever whenever the app bundle failed to boot. Consumers
  // render the null as a skeleton or a banner, never as a number.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
  const sprintProjects: any[] | null = projectsError ? null : projects
  const agentCurrentTask: Record<string,string> = liveStatus?.agentCurrentTask ?? {}
  const agentLiveStatus = (agentId: string): {dot:'green'|'amber'|'grey'; label:string} => {
    // Liveness is the heartbeat the server actually received (/api/agents ->
    // lib/agent-heartbeats.ts), never an inference from a run row or a ticket.
    // The grey state used to read "Idle" for every agent, which is a claim
    // about a running agent that went quiet — an agent that has NEVER reported
    // anything now says exactly that instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent DTO row
    const row = (liveAgents ?? []).find((a: any) => a.id === agentId)
    const seen: number | null = typeof row?.lastSeenAt === 'number' ? row.lastSeenAt : null
    const seenAgo = seen ? `${Math.max(0, Math.round((Date.now() - seen) / 60000))}m ago` : 'never'
    const open = agentIssueCounts[agentId] ?? 0
    const openSuffix = open > 0 ? ` · ${open} open issue${open > 1 ? 's' : ''}` : ''
    if (row?.liveness === 'live') {
      // Deliberately NOT falling back to the newest agent_runs title: that row
      // is hours old and never closed, so it described work that had finished.
      return { dot: 'green', label: row.currentTask || 'Heartbeat just now' }
    }
    if (row?.liveness === 'stale') return { dot: 'amber', label: `Stale — last heartbeat ${seenAgo}${openSuffix}` }
    if (row?.liveness === 'idle')  return { dot: 'grey',  label: `Idle — last heartbeat ${seenAgo}${openSuffix}` }
    return { dot: 'grey', label: `Never checked in${openSuffix}` }
  }
  // TOD (agent-roster-truth): never fall back to a hardcoded agent list — a
  // roster fetch that failed or hasn't loaded yet must render its own error
  // or loading state, not a fabricated set of agents wearing the real UI.
  // `liveAgents` is null until /api/agents answers successfully at least
  // once; consumers branch on that (not on emptiness) to tell "not loaded"
  // apart from "genuinely zero agents".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent DTO rows
  const displayAgents = (liveAgents ?? []) as any[]
  // TOD (kill-fake-automations): never fall back to a hardcoded job list —
  // an empty real answer is the truth; a fake one is not.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped automation rows
  const displayCrons = (liveCrons ?? []) as any[]
  // A countdown only renders for a row where the API computed a real
  // nextRunAtMs from an actual schedule expression it parsed — never guessed.
  const nextRuns = displayCrons
    .filter((c: any) => typeof c.nextRunAtMs === 'number')
    .map((c: any) => ({ cron: c, mins: Math.max(0, Math.round((c.nextRunAtMs - Date.now()) / 60000)) }))
    .sort((a: any, b: any) => a.mins - b.mins)
    .slice(0, 3)

  const pushURL = useCallback((biz: string | null, dest: DestinationId, v: string, project: string | null) => {
    const path = buildPath(biz, dest, v, project)
    const current = window.location.pathname + window.location.search
    if (current !== path) window.history.pushState({ biz, destination: dest, view: v, project }, '', path)
  }, [])

  // The single navigation entry point every child component already calls
  // with an old flat tab id (SearchOverlay, OverviewTab, QuickActionFab,
  // TopBar) — resolved through LEGACY_TAB_MAP so none of them needed to
  // change. 'chat' opens the overlay instead of navigating; a bare
  // destination id (from PrimaryNav/MobileNav) goes to its default view.
  const goTo = useCallback((dest: DestinationId, v?: string) => {
    const resolved = v && viewsOf(dest).includes(v) ? v : DEFAULT_VIEW[dest]
    setDestination(dest)
    setView(resolved)
    pushURL(selectedBusiness, dest, resolved, selectedProject)
  }, [selectedBusiness, selectedProject, pushURL])

  const navigate = useCallback((id: string) => {
    if (id === 'chat') { setChatOpen(true); return }
    if (LEGACY_TAB_MAP[id]) { const [d, v] = LEGACY_TAB_MAP[id]; goTo(d, v); return }
    if (isDestinationId(id)) { goTo(id as DestinationId); return }
  }, [goTo])

  const selectBusiness = useCallback((name: string | null) => {
    const projectStays = name === selectedBusiness
    if (!projectStays) setSelectedProject(null)
    setSelectedBusiness(name)
    pushURL(name, destination, view, projectStays ? selectedProject : null)
  }, [selectedBusiness, selectedProject, destination, view, pushURL])

  return (
    <div className="min-h-screen flex bg-neutral-950">
      <BusinessRail selected={selectedBusiness} onSelect={selectBusiness} onNew={() => setShowOnboarding(true)} refreshKey={businessRailRefresh} />
      {showOnboarding && <OnboardingWizard onComplete={(name) => { selectBusiness(name); setShowOnboarding(false); setBusinessRailRefresh(k => k + 1) }} onClose={() => setShowOnboarding(false)} />}

      {/* SIDEBAR — TOD-2381: six destinations, replaces the flat 20-item SidebarNav */}
      <PrimaryNav
        destination={destination}
        onSelectDestination={(d) => goTo(d)}
        onOpenChat={() => setChatOpen(true)}
        badges={{
          needsYou: inboxPendingCount,
          fleetLive: liveAgents ? liveAgents.filter((a: any) => a.liveness === 'live').length : null,
          workIssues: projectIssueTotal,
          memoryFiles: memFiles ? memFiles.length : null,
        }}
        ollama={liveStatus?.ollama ? {
          running: !!liveStatus.ollama.running,
          model: Array.isArray(liveStatus.ollama.models) && liveStatus.ollama.models[0] ? liveStatus.ollama.models[0] : null,
        } : null}
        clock={clock}
      />

      {/* MOBILE BOTTOM NAV — six destinations, no "more" menu (they all fit) */}
      <MobileNav destination={destination} onSelectDestination={(d) => goTo(d)} needsYou={inboxPendingCount} />

      {/* MAIN */}
      <div className="flex-1 flex flex-col h-screen overflow-auto">
        {/* TOD-630: Top bar — logo left, search center, actions right */}
        <TopBar
          tab={destination}
          selectedBusiness={selectedBusiness}
          onSearchOpen={() => setSearchOpen(true)}
          onNavigate={navigate}
          liveAgents={liveAgents}
          agentsError={agentsError}
          unreadChat={unreadChat}
          inboxPendingCount={inboxPendingCount}
          onOpenInbox={() => setInboxOpen(true)}
        />

        {/* Business + project context header */}
        {selectedBusiness && (
          <div className="px-4 md:px-6 py-3 border-b border-white/10 bg-[#0a0a0a]">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{BIZ_EMOJI[selectedBusiness] || '🏢'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-white text-sm font-semibold truncate">{selectedBusiness}</h2>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 font-medium">Business</span>
                  {selectedProject && (
                    <>
                      <span className="text-white/20 text-xs">/</span>
                      <h2 className="text-white text-sm font-semibold truncate">{selectedProject}</h2>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 font-medium">Project</span>
                    </>
                  )}
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Active</span>
                </div>
                <p className="text-white/30 text-[10px] mt-0.5">
                  {selectedProject
                    ? `Every panel below is scoped to ${selectedProject} only — never another project's issues`
                    : `Viewing all ${selectedBusiness} data across destinations`}
                </p>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 md:px-6 py-5 pb-20 lg:pb-5 overflow-x-hidden">
          <DestinationShell
            destination={destinationOf(destination)}
            activeView={view}
            onSelectView={(v) => goTo(destination, v)}
            projectName={selectedProject}
            projectIssueTotal={destination === 'now' || destination === 'work' ? projectIssueTotal : null}
          >
            {destination === 'now' && view === 'overview' && (
              <OverviewTab globalSync={globalSync} syncing={syncing} liveStatus={liveStatus} sprintProjects={sprintProjects} projectsError={projectsError} onRetryProjects={loadProjects} onNavigate={navigate} projectFilter={selectedProject} />
            )}
            {destination === 'now' && view === 'inbox' && <InboxTab />}
            {destination === 'now' && view === 'activity' && (
              <ActivityTab liveStatus={liveStatus} statusAt={statusAt} setLiveStatus={setLiveStatus} setStatusAt={setStatusAt} issueActivity={issueActivity} activityError={activityError} onRetryActivity={() => setActivityReload(n => n + 1)} statusError={statusError} onRetryStatus={loadStatus} displayAgents={displayAgents} projectFilter={selectedProject} />
            )}
            {destination === 'now' && view === 'signal' && (
              <NowSignal
                inboxPendingCount={inboxPendingCount}
                liveAgents={liveAgents}
                rollup={liveStatus?.rollup ?? null}
                onOpenInbox={() => goTo('now', 'inbox')}
                onOpenFleet={() => goTo('fleet', 'team')}
              />
            )}

            {destination === 'work' && view === 'board' && (
              <BoardTab featureFilter={boardFeatureFilter} featureFilterName={boardFeatureFilterName} onClearFeatureFilter={() => { setBoardFeatureFilter(undefined); setBoardFeatureFilterName(undefined) }} projectFilter={selectedProject} />
            )}
            {destination === 'work' && view === 'issues' && <IssuesTab projectFilter={selectedProject} />}
            {destination === 'work' && view === 'features' && (
              <FeaturesTab onViewIssues={(featureId, featureName) => { setBoardFeatureFilter(featureId); setBoardFeatureFilterName(featureName); goTo('work', 'board') }} projectFilter={selectedProject} />
            )}
            {destination === 'work' && view === 'pipeline' && <PipelineTab projectFilter={selectedProject} />}
            {destination === 'work' && view === 'product-board' && <ProductBoardTab projectFilter={selectedProject} />}
            {destination === 'work' && view === 'epic-map' && <EpicMapTab />}
            {destination === 'work' && view === 'projects' && <ProjectsTab projectFilter={selectedProject} />}
            {destination === 'work' && view === 'calendar' && (
              <CalendarTab calendarIssues={calendarIssues} calendarError={calendarError ?? projectsError} sprintProjects={sprintProjects} calendarView={calendarView} setCalendarView={setCalendarView} displayCrons={displayCrons} nextRuns={nextRuns} cronModal={cronModal} setCronModal={setCronModal} projectFilter={selectedProject} cronsMeta={cronsMeta} />
            )}

            {destination === 'fleet' && view === 'team' && (
              <CrewTab agentsError={agentsError} userRole={userRole} currentIdentity={currentIdentity} displayAgents={displayAgents} agentLiveStatus={agentLiveStatus} agentRunsData={agentRunsData} liveAgents={liveAgents} rosterMeta={rosterMeta} agentModal={agentModal} setAgentModal={setAgentModal} projectFilter={selectedProject} onAgentRemoved={(id) => setLiveAgents((rows) => rows ? rows.filter((a: any) => a.id !== id) : rows)} />
            )}
            {destination === 'fleet' && view === 'office' && <OfficeTab agentRunsData={agentRunsData} />}

            {destination === 'runs' && <RunsView projectName={selectedProject} />}

            {destination === 'memory' && (
              <MemoryTab memFiles={memFiles} error={memError} onRetry={refetchMem} openMem={openMem} setOpenMem={setOpenMem} />
            )}

            {destination === 'settings' && view === 'settings' && <SettingsTab />}
            {destination === 'settings' && view === 'ai-services' && <AIServicesTab />}
            {destination === 'settings' && view === 'automations' && <AutomationsTab displayCrons={displayCrons} cronsError={cronsError} cronsMeta={cronsMeta} />}
            {destination === 'settings' && view === 'infra' && (
              <InfraTab liveStatus={liveStatus} statusError={statusError} agoSec={agoSec} statusCountdown={statusCountdown} onRefresh={() => { fetchStatus(); setStatusCountdown(30) }} />
            )}
            {destination === 'settings' && view === 'calendar' && (
              <CalendarTab calendarIssues={calendarIssues} calendarError={calendarError ?? projectsError} sprintProjects={sprintProjects} calendarView={calendarView} setCalendarView={setCalendarView} displayCrons={displayCrons} nextRuns={nextRuns} cronModal={cronModal} setCronModal={setCronModal} projectFilter={selectedProject} cronsMeta={cronsMeta} />
            )}
          </DestinationShell>
        </main>
      </div>

      <ChatOverlay open={chatOpen} onClose={() => { setChatOpen(false); setUnreadChat(false) }} selectedBusiness={selectedBusiness} />

      <QuickActionFab
        onNavigate={navigate}
        onCreateIssue={() => navigate('board')}
        onStartChat={() => navigate('chat')}
      />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={navigate} />
      <InboxDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} pendingCount={inboxPendingCount} />
      {globalToasts.length > 0 && (
        <div className="fixed bottom-[72px] right-4 z-[9999] flex flex-col gap-1.5 pointer-events-none">
          {globalToasts.map(t => (
            <div key={t.id} className="bg-neutral-950/95 border rounded-lg px-3.5 py-2 text-[11px] max-w-[280px] shadow-lg" style={{borderColor: t.color + '40', borderLeftWidth: 3, borderLeftColor: t.color, color: t.color}}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
