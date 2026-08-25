// LAYOUT STRUCTURE — DO NOT BREAK:
// <div min-h-screen flex>
//   <BusinessRail />          ← w-14, always visible
//   <aside hidden lg:flex>    ← sidebar, desktop only
//   <main flex-1>             ← content
//   <MobileNav lg:hidden>     ← mobile bottom nav, hidden on desktop
// </div>
'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { LayoutDashboard, Activity, Users, CalendarDays, Building2, Brain, Kanban, Zap, MessageSquare, Server, Map, Search, List, Settings } from 'lucide-react'
import { AGENT_DISPLAY, PROJECT_COLORS, TYPE_COLORS, TOAST_COLORS, AGENT_EMOJI } from '@/lib/mc-constants'
import { Dot } from '@/lib/mc-atoms'
import BusinessRail from '@/components/BusinessRail'
import OnboardingWizard from '@/components/OnboardingWizard'
import OverviewTab from '@/components/tabs/OverviewTab'
import ActivityTab from '@/components/tabs/ActivityTab'
import AgentsTab, { type RosterMeta } from '@/components/tabs/AgentsTab'
import CrewTab from '@/components/tabs/CrewTab'
import CalendarTab from '@/components/tabs/CalendarTab'
import OfficeTab from '@/components/tabs/OfficeTab'
import MemoryTab, { type MemFile } from '@/components/tabs/MemoryTab'
import BoardTab from '@/components/tabs/BoardTab'
import FeaturesTab from '@/components/tabs/FeaturesTab'
import PipelineTab from '@/components/tabs/PipelineTab'
import IssuesTab from '@/components/tabs/IssuesTab'
import AutomationsTab from '@/components/tabs/AutomationsTab'
import ChatTab from '@/components/tabs/ChatTab'
import InfraTab from '@/components/tabs/InfraTab'
import SettingsTab from '@/components/tabs/SettingsTab'
import ProductBoardTab from '@/components/tabs/ProductBoardTab'
import ProjectsTab from '@/components/tabs/ProjectsTab'
import InboxTab from '@/components/tabs/InboxTab'
import AIServicesTab from '@/components/tabs/AIServicesTab'
import EpicMapTab from '@/components/tabs/EpicMapTab'
import QuickActionFab from '@/components/QuickActionFab'
import SidebarNav from '@/components/SidebarNav'
import SearchOverlay from '@/components/SearchOverlay'
import TopBar from '@/components/TopBar'
import HubSwitcher from '@/components/HubSwitcher'
import InboxDrawer from '@/components/InboxDrawer'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { fetchJson, formatApiError, useApiData, type ApiError } from '@/hooks/useApiData'
import { runLiveness, type AgentRunStatus } from '@/hooks/useAgentStatus'

const LUCIDE_ICONS: Record<string, any> = {
  overview: LayoutDashboard, activity: Activity, team: Users, calendar: CalendarDays,
  office: Building2, memory: Brain, board: Kanban, features: Map, issues: List, automations: Zap, chat: MessageSquare, infra: Server, settings: Settings,
}

const NAV = [
  { id:'overview',     label:'Overview',     icon:'📊' },
  { id:'activity',     label:'Activity',     icon:'📡' },
  { id:'team',         label:'Team',         icon:'👥' },
  { id:'calendar',     label:'Calendar',     icon:'📅' },
  { id:'office',       label:'Office',       icon:'🏢' },
  { id:'memory',       label:'Memory',       icon:'🧠' },
  { id:'board',        label:'Board',        icon:'📋' },
  { id:'features',     label:'Features',     icon:'🗺️' },
  { id:'epic-map',     label:'Epic Map',     icon:'🗂️' },
  { id:'pipeline',     label:'Pipeline',     icon:'🏭' },
  { id:'issues',       label:'Issues',       icon:'📝' },
  { id:'projects',     label:'Projects',     icon:'📦' },
  { id:'product-board', label:'Product Board', icon:'🗓️' },
  { id:'divider' as any, label:'',           icon:'' },
  { id:'automations',  label:'Automations',  icon:'⚡' },
  { id:'chat',         label:'Chat',         icon:'💬' },
  { id:'infra',        label:'Infra',        icon:'⚙️' },
  { id:'ai-services',  label:'AI Services',  icon:'🤖' },
  { id:'inbox',         label:'Inbox',        icon:'📬' },
  { id:'settings',     label:'Settings',     icon:'⚙️' },
] as const
type Tab = typeof NAV[number]['id']

const VALID_TABS = ['overview','activity','team','calendar','office','memory','board','features','epic-map','pipeline','issues','projects','product-board','automations','chat','infra','settings','ai-services','inbox']

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

function parseURL(): { tab: string; business: string | null } {
  if (typeof window === 'undefined') return { tab: 'overview', business: null }
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'b' && parts[1]) {
    const biz = slugToBizName(parts[1])
    const tab = parts[2] && VALID_TABS.includes(parts[2]) ? parts[2] : 'overview'
    return { tab, business: biz }
  }
  if (parts[0] && VALID_TABS.includes(parts[0])) {
    return { tab: parts[0], business: null }
  }
  return { tab: 'overview', business: null }
}

function buildPath(business: string | null, tab: string): string {
  if (business) {
    const slug = bizToSlug(business)
    return tab === 'overview' ? `/b/${slug}` : `/b/${slug}/${tab}`
  }
  return tab === 'overview' ? '/' : `/${tab}`
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
  // MC-hydration: start with SSR-safe default; apply URL/localStorage after mount to avoid hydration mismatch
  const [tab, setTab] = useState<Tab>('overview')
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currentIdentity, setCurrentIdentity] = useState<string | null>(null)
  const [clock, setClock] = useState('')
  const [openMem, setOpenMem] = useState<string | null>(null)
  const [showMobileMore, setShowMobileMore] = useState(false)
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

  // MC-hydration: restore tab/business/feature from URL/localStorage after mount
  useEffect(() => {
    const { tab: urlTab, business: urlBiz } = parseURL()
    if (urlBiz) setSelectedBusiness(urlBiz)
    if (urlTab && VALID_TABS.includes(urlTab)) {
      setTab(urlTab as Tab)
    } else {
      try {
        const saved = localStorage.getItem('mc-tab') as Tab | null
        if (saved && VALID_TABS.includes(saved)) setTab(saved)
      } catch (_) { /* private browsing */ }
    }
    const p = new URLSearchParams(window.location.search)
    const feat = p.get('feature')
    if (feat) setBoardFeatureFilter(feat)
  }, [])

  // Auto-trigger onboarding wizard when no businesses exist (workspace not yet onboarded)
  useEffect(() => {
    // Only a confirmed-empty 200 means "not onboarded yet"; a 403/500 must
    // never auto-open the wizard as though the workspace were blank.
    fetchJson<unknown>('/api/businesses').then(r => {
      if (r.ok && Array.isArray(r.data) && r.data.length === 0) setShowOnboarding(true)
    })
  }, [])

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
        // canvas and AgentsTab use, so nothing here can disagree with them.
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
  }, [])

  // Calendar issues
  useEffect(() => {
    const calUrl = dbUrl(`issues?due_date=not.is.null&select=id,task_key,title,due_date,project,status&limit=200`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(calUrl, { headers: dbRestHeaders() }).then(res => {
      if (!res.ok) { setCalendarError(res.error); setCalendarIssues(null); return }
      setCalendarError(null)
      setCalendarIssues(Array.isArray(res.data) ? res.data : [])
    })
  }, [])

  // Issue activity feed
  useEffect(() => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(dbUrl(`issues?updated_at=gte.${since}&order=updated_at.desc&limit=200&select=task_key,title,status,assignee,updated_at,resolution_type,sprint,type`), {
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
  }, [tab, activityReload])

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
      const { tab: t, business } = parseURL()
      if (VALID_TABS.includes(t)) { setTab(t as Tab); try { localStorage.setItem('mc-tab', t) } catch (_) {} }
      setSelectedBusiness(business)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Replace initial history entry so back works correctly.
  // Must describe the URL that was actually loaded: seeding it from the initial
  // `tab` state (always 'overview' on mount) rewrote deep links like /issues
  // back to "/", which then made the hydration effect above resolve the tab as
  // 'overview'. Keep the path, only attach the state object.
  useEffect(() => {
    const { tab: t, business } = parseURL()
    window.history.replaceState({ biz: business, tab: t }, '', window.location.pathname + window.location.search)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => { if (tab !== 'office') return; const iv = setInterval(() => { loadAgents() }, 30000); return () => clearInterval(iv) }, [tab, loadAgents])
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

  const pushURL = useCallback((biz: string | null, t: string) => {
    const path = buildPath(biz, t)
    if (window.location.pathname !== path) window.history.pushState({ biz, tab: t }, '', path)
  }, [])

  const navigate = useCallback((t: string) => {
    setTab(t as Tab)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('mc-tab', t) } catch (_) { /* private browsing */ }
      pushURL(selectedBusiness, t)
    }
  }, [selectedBusiness, pushURL])

  const selectBusiness = useCallback((name: string | null) => {
    setSelectedBusiness(name)
    pushURL(name, tab)
  }, [tab, pushURL])

  return (
    <div className="min-h-screen flex bg-neutral-950">
      <BusinessRail selected={selectedBusiness} onSelect={selectBusiness} onNew={() => setShowOnboarding(true)} refreshKey={businessRailRefresh} />
      {showOnboarding && <OnboardingWizard onComplete={(name) => { selectBusiness(name); setShowOnboarding(false); setBusinessRailRefresh(k => k + 1) }} onClose={() => setShowOnboarding(false)} />}

      {/* SIDEBAR — TOD-538: grouped nav extracted to SidebarNav component */}
      <SidebarNav
        tab={tab}
        navigate={navigate}
        unreadChat={unreadChat}
        setUnreadChat={setUnreadChat}
        clock={clock}
        onSearchOpen={() => setSearchOpen(true)}
        selectedBusiness={selectedBusiness}
        onSelectBusiness={selectBusiness}
        onNewBusiness={() => setShowOnboarding(true)}
        businessRailRefresh={businessRailRefresh}
        liveStatus={liveStatus}
      />

      {/* MOBILE BOTTOM NAV */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-neutral-950 border-t border-white/10 flex justify-around px-1" style={{paddingBottom:'env(safe-area-inset-bottom, 16px)'}}>
        {(['overview','board','office','chat','calendar'] as Tab[]).map(id => {
          const item = NAV.find(n => n.id === id)!; const LIcon = LUCIDE_ICONS[id]; if (!item) return null
          return <button key={id} onClick={() => { navigate(id); setShowMobileMore(false); if (id === 'chat') setUnreadChat(false) }}
            className={'flex flex-col items-center gap-0.5 px-2 py-2 min-w-0 flex-1 text-xs transition-colors ' + (tab === id ? 'text-white' : 'text-white/50')}>
            {LIcon ? <LIcon size={18} /> : <span>{item.icon}</span>}<span className="text-[9px]">{item.label.split(' ')[0]}</span>
          </button>
        })}
        <button onClick={() => setShowMobileMore(v => !v)} className={'flex flex-col items-center gap-0.5 px-2 py-2 flex-1 text-xs transition-colors ' + (showMobileMore ? 'text-white' : 'text-white/50')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          <span className="text-[9px]">More</span>
        </button>
      </nav>
      {showMobileMore && (
        <div className="lg:hidden fixed bottom-[56px] left-0 right-0 z-50 border-t border-white/10 bg-neutral-950">
          {/* TOD-1197: Hub switcher — mobile More menu */}
          <div className="px-2 py-2 border-b border-white/[0.07]">
            <p className="px-1 mb-1 text-[9px] font-semibold uppercase tracking-widest text-white/20 select-none">Hub</p>
            <HubSwitcher
              selected={selectedBusiness}
              onSelect={(name) => { selectBusiness(name); setShowMobileMore(false) }}
              onNew={() => { setShowOnboarding(true); setShowMobileMore(false) }}
              refreshKey={businessRailRefresh}
            />
          </div>
          <div className="grid grid-cols-3 gap-px p-2">
            {NAV.filter(n => n.id !== 'divider' && !['overview','board','office','chat','calendar'].includes(n.id)).map(item => {
              const LIcon = LUCIDE_ICONS[item.id]
              return <button key={item.id} onClick={() => { navigate(item.id); setShowMobileMore(false); if (item.id === 'chat') setUnreadChat(false) }}
                className={'flex flex-col items-center gap-1 p-3 rounded-xl text-xs ' + (tab === item.id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5')}>
                {LIcon ? <LIcon size={20} /> : <span className="text-lg">{item.icon}</span>}<span className="text-[10px]">{item.label}</span>
              </button>
            })}
          </div>
        </div>
      )}

      {/* MAIN */}
      <div className="flex-1 flex flex-col h-screen overflow-auto">
        {/* TOD-630: Top bar — logo left, search center, actions right */}
        <TopBar
          tab={tab}
          selectedBusiness={selectedBusiness}
          onSearchOpen={() => setSearchOpen(true)}
          onNavigate={navigate}
          liveAgents={liveAgents}
          agentsError={agentsError}
          unreadChat={unreadChat}
          inboxPendingCount={inboxPendingCount}
          onOpenInbox={() => setInboxOpen(true)}
        />

        {/* Business context header */}
        {selectedBusiness && (
          <div className="px-4 md:px-6 py-3 border-b border-white/10 bg-[#0a0a0a]">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{BIZ_EMOJI[selectedBusiness] || '🏢'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-white text-sm font-semibold truncate">{selectedBusiness}</h2>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 font-medium">Business</span>
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Active</span>
                </div>
                <p className="text-white/30 text-[10px] mt-0.5">Viewing all {selectedBusiness} data across tabs</p>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 md:px-6 py-5 pb-20 lg:pb-5 overflow-x-hidden">
          {tab === 'overview' && <OverviewTab globalSync={globalSync} syncing={syncing} liveStatus={liveStatus} sprintProjects={sprintProjects} projectsError={projectsError} onRetryProjects={loadProjects} onNavigate={navigate} projectFilter={selectedBusiness} />}
          {tab === 'activity' && <ActivityTab liveStatus={liveStatus} statusAt={statusAt} setLiveStatus={setLiveStatus} setStatusAt={setStatusAt} issueActivity={issueActivity} activityError={activityError} onRetryActivity={() => setActivityReload(n => n + 1)} statusError={statusError} onRetryStatus={loadStatus} displayAgents={displayAgents} projectFilter={selectedBusiness} />}
          {tab === 'team' && <CrewTab agentsError={agentsError} userRole={userRole} currentIdentity={currentIdentity} displayAgents={displayAgents} agentLiveStatus={agentLiveStatus} agentRunsData={agentRunsData} liveAgents={liveAgents} rosterMeta={rosterMeta} agentModal={agentModal} setAgentModal={setAgentModal} projectFilter={selectedBusiness} onAgentRemoved={(id) => setLiveAgents((rows) => rows ? rows.filter((a: any) => a.id !== id) : rows)} />}
          {tab === 'calendar' && <CalendarTab calendarIssues={calendarIssues} calendarError={calendarError ?? projectsError} sprintProjects={sprintProjects} calendarView={calendarView} setCalendarView={setCalendarView} displayCrons={displayCrons} nextRuns={nextRuns} cronModal={cronModal} setCronModal={setCronModal} projectFilter={selectedBusiness} cronsMeta={cronsMeta} />}
          {tab === 'office' && <OfficeTab agentRunsData={agentRunsData} />}
          {tab === 'memory' && <MemoryTab memFiles={memFiles} error={memError} onRetry={refetchMem} openMem={openMem} setOpenMem={setOpenMem} />}
          {tab === 'board' && <BoardTab featureFilter={boardFeatureFilter} featureFilterName={boardFeatureFilterName} onClearFeatureFilter={() => { setBoardFeatureFilter(undefined); setBoardFeatureFilterName(undefined) }} projectFilter={selectedBusiness} />}
          {tab === 'features' && <FeaturesTab onViewIssues={(featureId, featureName) => { setBoardFeatureFilter(featureId); setBoardFeatureFilterName(featureName); navigate('board') }} projectFilter={selectedBusiness} />}
          {tab === 'pipeline' && <PipelineTab projectFilter={selectedBusiness} />}
          {tab === 'issues' && <IssuesTab projectFilter={selectedBusiness} />}
          {tab === 'projects' && <ProjectsTab projectFilter={selectedBusiness} />}
          {tab === 'automations' && <AutomationsTab displayCrons={displayCrons} cronsError={cronsError} cronsMeta={cronsMeta} />}
          {tab === 'chat' && <ChatTab selectedBusiness={selectedBusiness} />}
          {tab === 'infra' && <InfraTab liveStatus={liveStatus} statusError={statusError} agoSec={agoSec} statusCountdown={statusCountdown} onRefresh={() => { fetchStatus(); setStatusCountdown(30) }} />}
          {tab === 'product-board' && <ProductBoardTab projectFilter={selectedBusiness} />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'epic-map' && <EpicMapTab />}
          {tab === 'ai-services' && <AIServicesTab />}
          {tab === 'inbox' && <InboxTab />}
        </main>
      </div>

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
