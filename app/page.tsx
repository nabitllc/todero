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
import { AGENT_DISPLAY, CRONS, LIVE_FEED, getNextRuns, ALL_AGENTS, PROJECT_COLORS, TYPE_COLORS, DEFAULT_SPRINT_PROJECTS, ACTIVITIES, TOAST_COLORS, AGENT_EMOJI } from '@/lib/mc-constants'
import { Dot } from '@/lib/mc-atoms'
import BusinessRail from '@/components/BusinessRail'
import OnboardingWizard from '@/components/OnboardingWizard'
import OverviewTab from '@/components/tabs/OverviewTab'
import ActivityTab from '@/components/tabs/ActivityTab'
import AgentsTab from '@/components/tabs/AgentsTab'
import CrewTab from '@/components/tabs/CrewTab'
import CalendarTab from '@/components/tabs/CalendarTab'
import OfficeTab from '@/components/tabs/OfficeTab'
import MemoryTab from '@/components/tabs/MemoryTab'
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
import QuickActionFab from '@/components/QuickActionFab'
import SidebarNav from '@/components/SidebarNav'
import SearchOverlay from '@/components/SearchOverlay'
import TopBar from '@/components/TopBar'
import HubSwitcher from '@/components/HubSwitcher'

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
  { id:'pipeline',     label:'Pipeline',     icon:'🏭' },
  { id:'issues',       label:'Issues',       icon:'📝' },
  { id:'projects',     label:'Projects',     icon:'📦' },
  { id:'product-board', label:'Product Board', icon:'🗓️' },
  { id:'divider' as any, label:'',           icon:'' },
  { id:'automations',  label:'Automations',  icon:'⚡' },
  { id:'chat',         label:'Chat',         icon:'💬' },
  { id:'infra',        label:'Infra',        icon:'⚙️' },
  { id:'settings',     label:'Settings',     icon:'⚙️' },
] as const
type Tab = typeof NAV[number]['id']

const VALID_TABS = ['overview','activity','team','calendar','office','memory','board','features','pipeline','issues','projects','product-board','automations','chat','infra','settings']

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

export default function Home() {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const fromURL = parseURL()
      if (fromURL.tab && VALID_TABS.includes(fromURL.tab)) return fromURL.tab as Tab
      // MC-522: wrap localStorage in try/catch — throws on iOS private browsing
      try {
        const saved = localStorage.getItem('mc-tab') as Tab | null
        if (saved && VALID_TABS.includes(saved)) return saved
      } catch (_) { /* private browsing — ignore */ }
    }
    return 'overview'
  })
  const [userRole, setUserRole] = useState<string | null>(null)
  const [clock, setClock] = useState('')
  const [memFiles, setMemFiles] = useState<any[]>([])
  const [openMem, setOpenMem] = useState<string | null>(null)
  const [feedIdx, setFeedIdx] = useState(0)
  const [tick, setTick] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<any>(null)
  const [statusAt, setStatusAt] = useState<number>(0)
  const [agoSec, setAgoSec] = useState<number>(0)
  const [liveAgents, setLiveAgents] = useState<typeof ALL_AGENTS | null>(null)
  const [liveCrons, setLiveCrons] = useState<typeof CRONS | null>(null)
  const [projects, setProjects] = useState<any[] | null>(null)
  const [globalToasts, setGlobalToasts] = useState<{id:number;text:string;color:string}[]>([])
  const globalToastIdRef = React.useRef(0)
  const addGlobalToast = React.useCallback((text: string, color = TOAST_COLORS.default) => {
    const id = ++globalToastIdRef.current
    setGlobalToasts(t => { const next = [...t, {id,text,color}]; return next.length > 4 ? next.slice(-4) : next })
    setTimeout(() => setGlobalToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])
  const [syncing, setSyncing] = useState(false)
  const globalSync = async () => {
    setSyncing(true)
    await Promise.all([
      fetch('/api/status').then(r => r.json()).then(d => { setLiveStatus(d); setStatusAt(Date.now()) }).catch(() => {}),
      fetch('/api/agents').then(r => r.json()).then(d => { if (Array.isArray(d)) setLiveAgents(d) }).catch(() => {}),
      fetch('/api/automations').then(r => r.json()).then(d => { if (Array.isArray(d)) setLiveCrons(d) }).catch(() => {}),
      fetch('/api/projects').then(r => r.json()).then(d => { if (Array.isArray(d) && d.length > 0) setProjects(d) }).catch(() => {}),
    ])
    setStatusCountdown(30)
    setSyncing(false)
  }
  const [agentModal, setAgentModal] = useState<any>(null)
  const [cronModal, setCronModal] = useState<any>(null)
  const [unreadChat, setUnreadChat] = useState(false)
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const fromURL = parseURL()
      if (fromURL.business) return fromURL.business
    }
    return null
  })
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [businessRailRefresh, setBusinessRailRefresh] = useState(0)
  const [boardFeatureFilter, setBoardFeatureFilter] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') { const p = new URLSearchParams(window.location.search); return p.get('feature') ?? undefined }
    return undefined
  })
  const [boardFeatureFilterName, setBoardFeatureFilterName] = useState<string | undefined>(undefined)
  const [issueActivity, setIssueActivity] = useState<any[]>([])
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  const [calendarIssues, setCalendarIssues] = useState<any[]>([])
  const [agentRunsData, setAgentRunsData] = useState<Record<string, {taskTitle:string; startedAt:string|null; status:string}>>({})
  const [agentIssueCounts, setAgentIssueCounts] = useState<Record<string, number>>({})

  // Read mc-role cookie (not httpOnly — accessible to JS) for RBAC-aware UI
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)mc-role=([^;]+)/)
    if (match) setUserRole(decodeURIComponent(match[1]))
  }, [])

  // Agent runs + issue counts polling
  useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const prevRunsRef: { current: Record<string,string> } = { current: {} }
    const fetchRuns = () => {
      fetch(`${SUPA}/rest/v1/agent_runs?select=agent_id,task_title,status,started_at&order=started_at.desc&limit=50`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
      }).then(r => r.json()).then((rows: any[]) => {
        if (!Array.isArray(rows)) return
        const byAgent: Record<string, {taskTitle:string; startedAt:string|null; status:string}> = {}
        for (const r of rows) { if (!byAgent[r.agent_id]) byAgent[r.agent_id] = { taskTitle: (r.task_title || '').slice(0, 40), startedAt: r.started_at, status: r.status } }
        for (const [agentId, info] of Object.entries(byAgent)) {
          const prev = prevRunsRef.current[agentId]; const e = AGENT_EMOJI[agentId] || '🤖'
          if (prev && prev !== info.status) {
            if (info.status === 'running') addGlobalToast(`${e} ${agentId} started: ${info.taskTitle}`, TOAST_COLORS.started)
            else if (info.status === 'completed' || info.status === 'done') addGlobalToast(`${e} ${agentId} done: ${info.taskTitle}`, TOAST_COLORS.done)
            else if (info.status === 'error') addGlobalToast(`${e} ${agentId} error: ${info.taskTitle}`, TOAST_COLORS.error)
          }
          prevRunsRef.current[agentId] = info.status
        }
        setAgentRunsData(byAgent)
      }).catch(() => {})
    }
    const fetchAgentIssues = () => {
      fetch(`${SUPA}/rest/v1/issues?status=in.(open,in_progress,code_review,product_review,approved,released)&sprint=not.is.null&select=assignee&limit=500`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
      }).then(r => r.json()).then((rows: any[]) => {
        if (!Array.isArray(rows)) return
        const counts: Record<string, number> = {}
        for (const r of rows) { if (r.assignee) counts[r.assignee] = (counts[r.assignee] || 0) + 1 }
        setAgentIssueCounts(counts)
      }).catch(() => {})
    }
    fetchRuns(); fetchAgentIssues()
    const iv = setInterval(() => { fetchRuns(); fetchAgentIssues() }, 30000)
    return () => clearInterval(iv)
  }, [])

  // Calendar issues
  useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    fetch(`${SUPA}/rest/v1/issues?due_date=not.is.null&select=id,task_key,title,due_date,project,status&limit=200`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then(data => { if (Array.isArray(data)) setCalendarIssues(data) }).catch(() => {})
  }, [])

  // Issue activity feed
  useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    fetch(`${SUPA}/rest/v1/issues?updated_at=gte.${since}&order=updated_at.desc&limit=200&select=task_key,title,status,assignee,updated_at,resolution_type,sprint,type`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then(data => {
      if (!Array.isArray(data)) return
      setIssueActivity(data.map((i: any) => {
        const agoMin = Math.round((Date.now() - new Date(i.updated_at).getTime()) / 60000)
        const ai = AGENT_DISPLAY[i.assignee] || null
        return { type:'issue', emoji: ['completed','closed','released'].includes(i.status)?'✅':i.status==='in_progress'?'🔧':['code_review','product_review','approved'].includes(i.status)?'👁':'📋', agentId: i.assignee||'system', agentName: ai?.name||i.assignee||'System', channel: i.task_key, action:'issue', desc: `${i.title} → ${(i.status||'').replace(/_/g,' ')}${i.resolution_type?` (${i.resolution_type.replace(/_/g,' ')})`:''}`, ago: agoMin, date: agoMin<60?'Today':agoMin<1440?'Yesterday':'Earlier' }
      }))
    }).catch(() => {})
  }, [tab])

  // Cmd+K search
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
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

  // Replace initial history entry so back works correctly
  useEffect(() => {
    window.history.replaceState({ biz: selectedBusiness, tab }, '', buildPath(selectedBusiness, tab))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unread chat event
  useEffect(() => {
    const h = () => setUnreadChat(true)
    window.addEventListener('mc-chat-unread', h); return () => window.removeEventListener('mc-chat-unread', h)
  }, [])

  const [statusCountdown, setStatusCountdown] = useState(30)
  const fetchStatus = () => { fetch('/api/status').then(r => r.json()).then(d => { setLiveStatus(d); setStatusAt(Date.now()) }).catch(() => {}) }
  const fetchAgentsAndCrons = () => {
    fetch('/api/agents').then(r => r.json()).then(d => { if (Array.isArray(d)) setLiveAgents(d) }).catch(() => {})
    fetch('/api/automations').then(r => r.json()).then(d => { if (Array.isArray(d)) setLiveCrons(d) }).catch(() => {})
  }
  useEffect(() => { fetchStatus(); const t = setInterval(() => { fetchStatus(); setStatusCountdown(30) }, 30000); const cd = setInterval(() => setStatusCountdown(s => Math.max(0, s - 1)), 1000); return () => { clearInterval(t); clearInterval(cd) } }, [])
  useEffect(() => { fetchAgentsAndCrons(); const t = setInterval(() => { fetchAgentsAndCrons() }, 60000); return () => clearInterval(t) }, [])
  useEffect(() => { if (tab !== 'office') return; const iv = setInterval(async () => { const res = await fetch('/api/agents'); if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setLiveAgents(d) } }, 30000); return () => clearInterval(iv) }, [tab])
  useEffect(() => { if (!statusAt) return; const t = setInterval(() => setAgoSec(Math.floor((Date.now() - statusAt) / 1000)), 1000); return () => clearInterval(t) }, [statusAt])
  useEffect(() => { const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'America/New_York'}) + ' ET'), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { fetch('/api/projects').then(r => r.json()).then(d => { if (Array.isArray(d) && d.length > 0) setProjects(d) }).catch(() => {}) }, [])
  useEffect(() => { fetch('/api/memory').then(r => r.json()).then(d => setMemFiles(d.files || [])) }, [])
  useEffect(() => { const t = setInterval(() => setFeedIdx(i => (i + 1) % LIVE_FEED.length), 4000); return () => clearInterval(t) }, [])
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 3000); return () => clearInterval(t) }, [])

  const sprintProjects = projects ?? DEFAULT_SPRINT_PROJECTS
  const nextRuns = getNextRuns(CRONS)
  const agentCurrentTask: Record<string,string> = liveStatus?.agentCurrentTask ?? {}
  const act = (id: string) => { if (agentCurrentTask[id]) return agentCurrentTask[id]; const a = ACTIVITIES[id] || ['Idle']; return a[tick % a.length] }
  const agentLiveStatus = (agentId: string): {dot:'green'|'amber'|'grey'; label:string} => {
    const ar = agentRunsData[agentId]
    if (ar?.startedAt) { const mins = Math.round((Date.now() - new Date(ar.startedAt).getTime()) / 60000); if (ar.status === 'running' || mins < 5) return { dot: 'green', label: ar.taskTitle || 'Working...' } }
    if ((agentIssueCounts[agentId] ?? 0) > 0) return { dot: 'amber', label: `${agentIssueCounts[agentId]} open issue${agentIssueCounts[agentId] > 1 ? 's' : ''}` }
    return { dot: 'grey', label: 'Idle' }
  }
  const displayAgents = (liveAgents && liveAgents.length > 0 ? liveAgents : ALL_AGENTS) as typeof ALL_AGENTS
  const displayCrons = (liveCrons && liveCrons.length > 0 ? liveCrons : CRONS) as typeof CRONS

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
          agentRunsData={agentRunsData}
          unreadChat={unreadChat}
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
          {tab === 'overview' && <OverviewTab globalSync={globalSync} syncing={syncing} liveStatus={liveStatus} sprintProjects={sprintProjects} onNavigate={navigate} projectFilter={selectedBusiness} />}
          {tab === 'activity' && <ActivityTab liveStatus={liveStatus} statusAt={statusAt} setLiveStatus={setLiveStatus} setStatusAt={setStatusAt} issueActivity={issueActivity} displayAgents={displayAgents} projectFilter={selectedBusiness} />}
          {tab === 'team' && <CrewTab userRole={userRole} displayAgents={displayAgents} agentLiveStatus={agentLiveStatus} agentRunsData={agentRunsData} liveAgents={liveAgents} act={act} agentModal={agentModal} setAgentModal={setAgentModal} projectFilter={selectedBusiness} />}
          {tab === 'calendar' && <CalendarTab calendarIssues={calendarIssues} sprintProjects={sprintProjects} calendarView={calendarView} setCalendarView={setCalendarView} displayCrons={displayCrons} nextRuns={nextRuns} cronModal={cronModal} setCronModal={setCronModal} />}
          {tab === 'office' && <OfficeTab agentRunsData={agentRunsData} />}
          {tab === 'memory' && <MemoryTab memFiles={memFiles} openMem={openMem} setOpenMem={setOpenMem} />}
          {tab === 'board' && <BoardTab featureFilter={boardFeatureFilter} featureFilterName={boardFeatureFilterName} onClearFeatureFilter={() => { setBoardFeatureFilter(undefined); setBoardFeatureFilterName(undefined) }} projectFilter={selectedBusiness} />}
          {tab === 'features' && <FeaturesTab onViewIssues={(featureId, featureName) => { setBoardFeatureFilter(featureId); setBoardFeatureFilterName(featureName); navigate('board') }} projectFilter={selectedBusiness} />}
          {tab === 'pipeline' && <PipelineTab projectFilter={selectedBusiness} />}
          {tab === 'issues' && <IssuesTab projectFilter={selectedBusiness} />}
          {tab === 'projects' && <ProjectsTab projectFilter={selectedBusiness} />}
          {tab === 'automations' && <AutomationsTab displayCrons={displayCrons} />}
          {tab === 'chat' && <ChatTab selectedBusiness={selectedBusiness} />}
          {tab === 'infra' && <InfraTab liveStatus={liveStatus} agoSec={agoSec} statusCountdown={statusCountdown} onRefresh={() => { fetchStatus(); setStatusCountdown(30) }} />}
          {tab === 'product-board' && <ProductBoardTab projectFilter={selectedBusiness} />}
          {tab === 'settings' && <SettingsTab />}
        </main>
      </div>

      <QuickActionFab
        onNavigate={navigate}
        onCreateIssue={() => navigate('board')}
        onStartChat={() => navigate('chat')}
      />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={navigate} />
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
