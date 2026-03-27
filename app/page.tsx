'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import AgentOffice from '@/components/AgentOffice'

const KEMUNI_START     = new Date('2026-03-21')
const KEMUNI_DEADLINE  = new Date('2026-04-20')
const VESPERA_DEADLINE = new Date('2026-03-29')
const VESPERA_START    = new Date('2026-03-22')

function daysUntil(d: Date) { return Math.max(0, Math.ceil((d.getTime()-Date.now())/86400000)) }
function daysSince(d: Date) { return Math.floor((Date.now()-d.getTime())/86400000) }
function miniPct(a: number, b: number) { return Math.min(100, Math.round((a/b)*100)) }

const AGENT_DISPLAY: Record<string,{name:string;emoji:string;role:string;color:string;desc:string;capabilities:string[];modelShort?:string}> = {
  main:          {name:'KAOS',        emoji:'🧠', role:'Chief of Staff',    color:'#6b7280', desc:'Main orchestrator. Strategy, memory, delegation, comms.', capabilities:['Orchestration','Memory','Strategy','Comms','Delegation']},
  scout:         {name:'Scout',       emoji:'🔍', role:'Research Agent',    color:'#a855f7', desc:'Morning scan: goth scene, competitors, PropTech trends.', capabilities:['Web Research','Summarization','Trends']},
  ops:           {name:'Ops',         emoji:'⚙️', role:'Operations Agent',  color:'#6b7280', desc:'Infrastructure monitoring, deployment ops, system health.', capabilities:['Monitoring','Deploys','Health Checks']},
  'kemuni-sme':  {name:'Kemuni SME',  emoji:'🚀', role:'Kemuni Specialist', color:'#3b82f6', desc:'Domain expert for Kemuni platform. PropTech strategy & features.', capabilities:['PropTech','Strategy','Features']},
  'vespera-sme': {name:'Vespera SME', emoji:'🖤', role:'Vespera Specialist',color:'#a855f7', desc:'Domain expert for Vespera. Goth community, events, culture.', capabilities:['Events','Community','Culture']},
  builder:       {name:'Builder',     emoji:'🔨', role:'Coding Agent',      color:'#3b82f6', desc:'On-demand coding. Next.js, Supabase, Vespera and Kemuni builds.', capabilities:['Next.js','Supabase','TypeScript','APIs']},
  tester:        {name:'Tester',      emoji:'🧪', role:'QA Agent',          color:'#ef4444', desc:'Automated testing, bug detection, regression checks.', capabilities:['Testing','QA','Bug Detection']},
}

const PLANNED_AGENTS = [
  { id:'quill',   name:'Quill',        emoji:'✍️', role:'Content Writer',    status:'planned' as const,
    model:'ollama/gemma3:4b',  modelShort:'Gemma 3 4B', color:'#10b981',
    desc:'Landing pages, blog posts, Vespera event copy. Free via Ollama.',
    capabilities:['Copywriting','SEO','Event Descriptions'],
    activatesWhen:'Vespera ships — landing page copy needed' },
  { id:'echo',    name:'Echo',         emoji:'📢', role:'Community Manager', status:'planned' as const,
    model:'ollama/gemma3:4b',  modelShort:'Gemma 3 4B', color:'#f59e0b',
    desc:'Discord/Telegram engagement, social posts, community replies.',
    capabilities:['Discord','Telegram','Social Posts'],
    activatesWhen:'Community reaches 50+ members' },
  { id:'ralph',   name:'Ralph',        emoji:'🧪', role:'QA Reviewer',       status:'planned' as const,
    model:'claude-sonnet-4-6', modelShort:'Sonnet 4.6', color:'#ef4444',
    desc:'Reviews Builder code, catches bugs before deploy.',
    capabilities:['Code Review','Testing','Bug Detection'],
    activatesWhen:'First full feature ready for pre-deploy review' },
  { id:'analyst', name:'Analyst',      emoji:'📊', role:'Data Analyst',      status:'planned' as const,
    model:'claude-sonnet-4-6', modelShort:'Sonnet 4.6', color:'#0ea5e9',
    desc:'Analytics, reporting, metrics dashboards, data insights.',
    capabilities:['Analytics','Reporting','Metrics'],
    activatesWhen:'Kemuni reaches beta with real user data' },
]

// Legacy fallback for when API is not available
const ALL_AGENTS = [
  { id:'main',    name:'KAOS', emoji:'🧠', role:'Chief of Staff',    status:'active',
    model:'claude-sonnet-4-6', modelShort:'Sonnet 4.6', color:'#6b7280',
    desc:'Main orchestrator. Strategy, memory, delegation, comms.',
    capabilities:['Orchestration','Memory','Strategy','Comms','Delegation'],
    floor: true },
  { id:'builder', name:'Builder',      emoji:'🔨', role:'Coding Agent',      status:'active',
    model:'anthropic/claude-sonnet-4-6', modelShort:'Sonnet 4.6', color:'#3b82f6',
    desc:'Ships clean PRs for Vespera and Kemuni. Runs nightly from task queue.',
    capabilities:['Next.js','Supabase','TypeScript','APIs'],
    floor: true },
  { id:'tester',  name:'Tester',       emoji:'🧪', role:'QA Reviewer',      status:'active',
    model:'anthropic/claude-haiku-4-5', modelShort:'Haiku 4.5', color:'#a855f7',
    desc:'Reviews PRs from Builder. Catches bugs before they reach production.',
    capabilities:['Code Review','Testing','Bug Detection','PR Review'],
    floor: true },
  { id:'scout',   name:'Scout',        emoji:'🔍', role:'Research Agent',    status:'scheduled',
    model:'ollama/gemma3:4b',  modelShort:'Gemma 3 4B', color:'#a855f7',
    desc:'Morning scan: goth scene, competitors, PropTech trends.',
    capabilities:['Web Research','Summarization','Trends'],
    floor: true },
]

const CRONS = [
  { id:'morning-brief',      time:'6:00 AM', hour:6,  min:0, days:'daily',  model:'Haiku',  project:'Kemuni',  status:'active',  desc:'Morning brief to Telegram' },
  { id:'trending-alerts',    time:'6:00 AM', hour:6,  min:0, days:'daily',  model:'Haiku',  project:'Kemuni',  status:'active',  desc:'PropTech trends scan' },
  { id:'overnight-employee', time:'2:00 AM', hour:2,  min:0, days:'daily',  model:'Sonnet', project:'Kemuni',  status:'active',  desc:'Autonomous task completion' },
  { id:'billing-review',     time:'9:00 AM', hour:9,  min:0, days:'daily',  model:'n8n',    project:'Ops',     status:'active',  desc:'OpenRouter balance to Telegram' },
  { id:'security-audit',     time:'9:00 AM', hour:9,  min:0, days:'Mon',    model:'Sonnet', project:'Ops',     status:'active',  desc:'Weekly audit to Discord' },
  { id:'scout-morning',      time:'8:00 AM', hour:8,  min:0, days:'daily',  model:'Gemma',  project:'Vespera', status:'planned', desc:'Goth scene research to Telegram' },
]

const INFRA = [
  { name:'Claude Pro',   note:'OAuth subscription, sonnet-4-6 + haiku', status:'ok' },
  { name:'OpenRouter',   note:'$9.57 / $10.00 remaining',               status:'ok' },
  { name:'Telegram',     note:'@KemuniClaw1Bot, 2 channels',            status:'ok' },
  { name:'Discord',      note:'Kemuni Server, 8 channels',              status:'ok' },
  { name:'n8n',          note:'v2.12.3, :5678, LaunchAgent',            status:'ok' },
  { name:'Ollama',       note:'Gemma 3 4B, local/private',              status:'ok' },
  { name:'Vercel',       note:'Free, kemuni.com',                       status:'ok' },
  { name:'Supabase',     note:'Free, Kemuni project',                   status:'ok' },
  { name:'GitHub',       note:'personal + kemuniagent@gmail',           status:'ok' },
]

const LIVE_FEED = [
  { agentId:'main',    action:'memory',   desc:'Distilled session into MEMORY.md',      ago:2  },
  { agentId:'builder', action:'code',     desc:'Scaffolded Mission Control sidebar',    ago:5  },
  { agentId:'main',    action:'cron',     desc:'Morning brief sent to Telegram',        ago:60 },
  { agentId:'scout',   action:'research', desc:'Queued: goth scene scan for 8am',       ago:15 },
  { agentId:'main',    action:'delegate', desc:'Assigned Vespera auth to Builder',      ago:45 },
  { agentId:'builder', action:'code',     desc:'Vespera: Next.js layout scaffolded',    ago:120},
]

const ACTION_COLORS: Record<string,string> = {
  memory:'#6b7280', code:'#3b82f6', cron:'#10b981',
  research:'#a855f7', delegate:'#f59e0b', session:'#6366f1',
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const NAV = [
  { id:'overview',  label:'Overview',  icon:'📊' },
  { id:'activity',  label:'Activity',  icon:'📡' },
  { id:'team',      label:'Team',      icon:'👥' },
  { id:'calendar', label:'Calendar', icon:'📅' },
  { id:'automations', label:'Automations', icon:'⚡' },
  { id:'office',   label:'Office',   icon:'🏢' },
  { id:'memory',   label:'Memory',   icon:'🧠' },
  { id:'board',    label:'Board',    icon:'📋' },
  { id:'chat',     label:'Chat',     icon:'💬' },
  { id:'infra',    label:'Infra',    icon:'⚙️' },
] as const
type Tab = typeof NAV[number]['id']

// Chat types
interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; model?: string; ts?: number; attachments?: string[] }
interface ChatConversation { id: string; title: string; model: string; messages: ChatMessage[]; createdAt: number; updatedAt: number }

const FLOOR_DESKS = [
  { id:'main',    left:'8%',  top:'10%', screenColor:'#1e3a5f' },
  { id:'builder', left:'60%', top:'10%', screenColor:'#1e3060' },
  { id:'scout',   left:'8%',  top:'56%', screenColor:'#2d1b69' },
]

function pColor(p: string) {
  return p==='Vespera'?'#a855f7':p==='Ops'?'#6b7280':'#3b82f6'
}

function getNextRuns() {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}))
  const etH = et.getHours(), etM = et.getMinutes()
  const out: {cron:typeof CRONS[0]; mins:number}[] = []
  for(const c of CRONS){
    if(c.status==='planned') continue
    const daysOff = c.days==='Mon' ? ((8-et.getDay())%7||7) : 0
    const diff = daysOff*1440 + (c.hour*60+c.min) - (etH*60+etM)
    out.push({cron:c, mins: diff<0 ? diff+1440 : diff})
  }
  return out.sort((a,b)=>a.mins-b.mins).slice(0,3)
}

function fmtMins(m: number) {
  if(m<60) return m+'m'
  const h=Math.floor(m/60), mm=m%60
  return mm ? h+'h '+mm+'m' : h+'h'
}

// ── Atoms ──────────────────────────────────────────────────────────────────
function Dot({status,sm}:{status:string;sm?:boolean}) {
  const sz = sm ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const cls = status==='active'||status==='ok' ? 'bg-emerald-500 anim-pg'
    : status==='scheduled' ? 'bg-yellow-500 anim-py'
    : status==='planned' ? 'bg-zinc-700'
    : 'bg-zinc-600'
  return <span className={'inline-block rounded-full shrink-0 '+sz+' '+cls} />
}

function Chip({label,color}:{label:string;color?:string}) {
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border"
      style={color
        ?{color,borderColor:color+'40',background:color+'15'}
        :{color:'#555',borderColor:'#2a2a2a',background:'#141414'}}>
      {label}
    </span>
  )
}

function Bar({v,color='#fff',bg='#1e1e1e'}:{v:number;color?:string;bg?:string}) {
  return (
    <div className="w-full rounded-full h-1" style={{background:bg}}>
      <div className="h-1 rounded-full transition-all" style={{width:v+'%',background:color}} />
    </div>
  )
}

function SH({icon,children,sub}:{icon:string;children:React.ReactNode;sub?:string}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span>{icon}</span>
      <span className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">{children}</span>
      {sub && <span className="text-[10px] text-zinc-700 italic">{sub}</span>}
      <div className="flex-1 h-px bg-zinc-800/70" />
    </div>
  )
}

// ── Chat Component ────────────────────────────────────────────────────────
function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        code: ({ inline, children }: any) =>
          inline
            ? <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 text-[11px] font-mono">{children}</code>
            : <pre className="my-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800 overflow-x-auto"><code className="text-[11px] font-mono text-emerald-300 whitespace-pre">{children}</code></pre>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-zinc-400">{children}</em>,
        h1: ({ children }) => <h1 className="text-base font-bold text-white mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-white mb-1.5 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-200 mb-1 mt-2">{children}</h3>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{children}</a>,
        hr: () => <hr className="border-zinc-700 my-3" />,
      }}>
      {content}
    </ReactMarkdown>
  )
}

function groupChatsByDate(chats: ChatConversation[]): { label: string; items: ChatConversation[] }[] {
  const now = Date.now()
  const DAY = 86400000
  const groups: { label: string; items: ChatConversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const c of chats) {
    const age = now - c.updatedAt
    if (age < DAY) groups[0].items.push(c)
    else if (age < DAY * 2) groups[1].items.push(c)
    else if (age < DAY * 7) groups[2].items.push(c)
    else groups[3].items.push(c)
  }
  return groups.filter(g => g.items.length > 0)
}

function ChatTab() {
  const [chats, setChats] = useState<ChatConversation[]>([])
  const [activeChat, setActiveChat] = useState<string|null>(null)
  const [search, setSearch] = useState('')
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{name: string; content: string}|null>(null)
  const [chatError, setChatError] = useState<string|null>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [lastUserMsg, setLastUserMsg] = useState<ChatMessage|null>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [renamingTitle, setRenamingTitle] = useState<string|null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string>('main')
  const [sidebarFocusIdx, setSidebarFocusIdx] = useState<number>(-1)
  const abortControllerRef = useRef<AbortController|null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const AGENT_OPTIONS = [
    { id: 'main', label: '🧠 KAOS', desc: 'Chief of Staff' },
    { id: 'kemuni-sme', label: '🚀 Kemuni SME', desc: 'Kemuni Specialist' },
    { id: 'vespera-sme', label: '🖤 Vespera SME', desc: 'Vespera Specialist' },
    { id: 'scout', label: '🔍 Scout', desc: 'Research Agent' },
  ]
  const currentAgent = AGENT_OPTIONS.find(a => a.id === selectedAgent) || AGENT_OPTIONS[0]

  // Load chats from Supabase on mount, restore active chat from localStorage
  useEffect(() => {
    const savedActiveChat = typeof window !== 'undefined' ? localStorage.getItem('mc-active-chat') : null
    fetch('/api/chat/conversations')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const normalized: ChatConversation[] = data.map((c: any) => ({
            id: c.id,
            title: c.title,
            model: c.model,
            messages: (c.messages || []).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              model: m.model,
              ts: m.created_at ? new Date(m.created_at).getTime() : undefined,
            })),
            createdAt: new Date(c.created_at).getTime(),
            updatedAt: new Date(c.updated_at).getTime(),
          }))
          setChats(normalized)
          // Restore last active chat if it still exists
          if (savedActiveChat && normalized.find(c => c.id === savedActiveChat)) {
            setActiveChat(savedActiveChat)
          }
        }
      })
      .catch(() => {})
  }, [])

  // Persist active chat to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (activeChat) localStorage.setItem('mc-active-chat', activeChat)
      else localStorage.removeItem('mc-active-chat')
    }
  }, [activeChat])

  // Detect when user scrolls up (so we don't hijack scroll during streaming)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
      setUserScrolledUp(!atBottom)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [activeChat])

  // Auto-scroll to bottom only when user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chats, loading, userScrolledUp])

  // Scroll to bottom when switching chats
  useEffect(() => {
    setUserScrolledUp(false)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50)
  }, [activeChat])

  // Poll active conversation while sending (catches dropped streams on tab switch/refresh)
  const reloadActiveConv = useCallback(async () => {
    if (!activeChat) return
    try {
      const res = await fetch('/api/chat/conversations')
      const data = await res.json()
      if (!Array.isArray(data)) return
      const conv = data.find((c: any) => c.id === activeChat)
      if (!conv) return
      const normalized: ChatConversation = {
        id: conv.id,
        title: conv.title,
        model: conv.model,
        messages: (conv.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model,
          ts: m.created_at ? new Date(m.created_at).getTime() : undefined,
        })),
        createdAt: new Date(conv.created_at).getTime(),
        updatedAt: new Date(conv.updated_at).getTime(),
      }
      setChats(prev => prev.map(c => c.id === activeChat ? normalized : c))
    } catch { /* ignore */ }
  }, [activeChat])

  // On tab visibility restored, reload active conv in case stream completed while away
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadActiveConv()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reloadActiveConv])

  // Cmd+K / arrow-key nav wired up after helpers defined (see below)

  // Auto-grow textarea
  const adjustTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const newChat = async () => {
    const id = 'chat-' + Date.now()
    const conv: ChatConversation = {
      id, title: 'New Chat', model: 'kaos', messages: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    setChats([conv, ...chats])
    setActiveChat(id)
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: 'New Chat', model: 'kaos' }),
    })
  }

  const deleteChat = async (id: string) => {
    setChats(prev => prev.filter(c => c.id !== id))
    if (activeChat === id) setActiveChat(null)
    await fetch(`/api/chat/conversations?id=${id}`, { method: 'DELETE' })
  }

  const renameChat = async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setChats(prev => prev.map(c => c.id === id ? { ...c, title: trimmed } : c))
    setRenamingTitle(null)
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: trimmed }),
    })
  }

  const exportChat = (conv: ChatConversation) => {
    const md = conv.messages.map(m =>
      `### ${m.role === 'user' ? '👤 You' : '🧠 KAOS'}${m.ts ? ` — ${new Date(m.ts).toLocaleTimeString()}` : ''}\n\n${m.content}`
    ).join('\n\n---\n\n')
    const blob = new Blob([`# ${conv.title}\n\n${md}`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeConv = chats.find(c => c.id === activeChat)
  const filteredChats = chats.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  )

  // Cmd+K → new chat; arrow keys → navigate sidebar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        newChat()
        return
      }
      // Arrow nav in sidebar (only when not typing)
      if (document.activeElement === textareaRef.current) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSidebarFocusIdx(i => Math.min(i + 1, filteredChats.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSidebarFocusIdx(i => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredChats.length])

  useEffect(() => {
    if (sidebarFocusIdx < 0 || !filteredChats[sidebarFocusIdx]) return
    setActiveChat(filteredChats[sidebarFocusIdx].id)
  }, [sidebarFocusIdx])

  const persistMessage = async (convId: string, msg: ChatMessage) => {
    await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: msg.id,
        conversation_id: convId,
        role: msg.role,
        content: msg.content,
        model: msg.model || null,
      }),
    })
  }

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const stopGeneration = () => {
    abortControllerRef.current?.abort()
    setIsSending(false)
    setLoading(false)
  }

  const doSend = async (msgContent: string, msgId: string, convToUse: ChatConversation, prevChats: ChatConversation[]) => {
    const isFirstMsg = convToUse.messages.length === 0
    const title = isFirstMsg ? msgContent.slice(0, 40) : convToUse.title

    const userMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content: msgContent,
      ts: Date.now(),
    }
    setLastUserMsg(userMsg)

    const updatedChats = prevChats.map(c =>
      c.id === convToUse.id
        ? { ...c, messages: [...c.messages, userMsg], title, updatedAt: Date.now() }
        : c
    )
    setChats(updatedChats)

    await persistMessage(convToUse.id, userMsg)
    if (isFirstMsg) {
      await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: convToUse.id, title }),
      })
    }

    setLoading(true)
    setIsSending(true)
    setChatError(null)
    const abortCtrl = new AbortController()
    abortControllerRef.current = abortCtrl
    try {
      const allMessages = [...convToUse.messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convToUse.id, messages: allMessages, agentId: selectedAgent }),
        signal: abortCtrl.signal,
      })

      if (!res.ok || !res.body) {
        setChatError('Gateway error — could not stream response')
        setLoading(false)
        setIsSending(false)
        return
      }

      // SSE streaming: insert a placeholder assistant message, append tokens as they arrive
      const streamMsgId = 'msg-stream-' + Date.now()
      const placeholderMsg: ChatMessage = {
        id: streamMsgId,
        role: 'assistant',
        content: '',
        model: 'kaos',
        ts: Date.now(),
      }

      // Add placeholder to chat
      setChats(prev => prev.map(c =>
        c.id === convToUse.id
          ? { ...c, messages: [...c.messages, placeholderMsg], updatedAt: Date.now() }
          : c
      ))
      setLoading(false) // dots go away once streaming starts

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let finalId = streamMsgId

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          try {
            const parsed = JSON.parse(raw)
            if (parsed.error) {
              setChatError(parsed.error)
              break
            }
            if (parsed.done) {
              finalId = parsed.id || streamMsgId
              break
            }
            if (parsed.delta) {
              fullContent += parsed.delta
              // Update the streaming message content in place
              setChats(prev => prev.map(c =>
                c.id === convToUse.id
                  ? {
                      ...c,
                      messages: c.messages.map(m =>
                        m.id === streamMsgId ? { ...m, content: fullContent } : m
                      ),
                    }
                  : c
              ))
            }
          } catch { /* skip bad lines */ }
        }
      }

      // Server-side already persisted the message to Supabase.
      // Just update the local placeholder id to the final server id.
      if (finalId !== streamMsgId) {
        setChats(prev => prev.map(c =>
          c.id === convToUse.id
            ? { ...c, messages: c.messages.map(m => m.id === streamMsgId ? { ...m, id: finalId } : m) }
            : c
        ))
      }

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setChatError('Network error — could not reach LLM')
      }
      setLoading(false)
    } finally {
      setIsSending(false)
      abortControllerRef.current = null
    }
  }

  const handleSend = async () => {
    if (!inputVal.trim() || !activeConv) return
    const MAX_FILE = 32768
    const fileContent = selectedFile
      ? (selectedFile.content.length > MAX_FILE ? selectedFile.content.slice(0, MAX_FILE) + '\n\n[...truncated at 32KB]' : selectedFile.content)
      : null
    const content = fileContent
      ? `[📎 ${selectedFile!.name}]\n\n${fileContent}\n\n---\n${inputVal}`
      : inputVal
    const msgId = 'msg-' + Date.now()
    setInputVal('')
    setSelectedFile(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await doSend(content, msgId, activeConv, chats)
  }

  const handleRetry = async () => {
    if (!lastUserMsg || !activeConv) return
    setChatError(null)
    // Remove the last user message from the conv (we'll re-add it)
    const convWithoutLast = {
      ...activeConv,
      messages: activeConv.messages.filter(m => m.id !== lastUserMsg.id),
    }
    await doSend(lastUserMsg.content, 'msg-retry-' + Date.now(), convWithoutLast, chats)
  }

  const handleFileAttach = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.md,.ts,.tsx,.js,.jsx,.json,.csv,.py,.sh,.yaml,.yml,.env'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      setSelectedFile({ name: file.name, content: text })
    }
    input.click()
  }

  const groupedChats = groupChatsByDate(filteredChats)

  return (
    <div className="flex gap-0 h-[calc(100vh-88px)] -mx-6 -my-5">
      {/* LEFT SIDEBAR */}
      <div className="w-64 shrink-0 border-r border-zinc-800/60 flex flex-col" style={{background:'#0d0d0d'}}>
        {/* New Chat button */}
        <div className="px-3 py-3 border-b border-zinc-800/40">
          <button
            onClick={newChat}
            className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 text-white text-xs font-medium hover:bg-zinc-700 transition-all flex items-center gap-2">
            <span>+</span> New Chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-zinc-800/40">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/60" style={{background:'#111'}}>
            <svg className="w-3 h-3 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-xs text-zinc-300 placeholder-zinc-600 w-full outline-none"
            />
          </div>
        </div>

        {/* Grouped Chats */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filteredChats.length === 0 ? (
            <p className="text-zinc-700 text-xs px-3 py-4">No chats yet</p>
          ) : (
            groupedChats.map(group => (
              <div key={group.label} className="mb-2">
                <p className="text-[9px] uppercase tracking-widest text-zinc-700 font-semibold px-3 py-1.5">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map(c => {
                    const flatIdx = filteredChats.indexOf(c)
                    return (
                    <div
                      key={c.id}
                      className={
                        'group relative w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs cursor-pointer ' +
                        (activeChat === c.id ? 'bg-zinc-800 text-white' : sidebarFocusIdx === flatIdx ? 'bg-zinc-900/70 text-zinc-300 ring-1 ring-zinc-700' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-900')
                      }
                      onClick={() => { setActiveChat(c.id); setSidebarFocusIdx(flatIdx) }}
                    >
                      <p className="font-medium truncate pr-5">{c.title}</p>
                      <p className="text-[9px] opacity-40 mt-0.5">
                        {new Date(c.updatedAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all text-[10px] p-0.5"
                        title="Delete">
                        ✕
                      </button>
                    </div>
                  )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CENTER: CHAT AREA */}
      <div className="flex-1 flex flex-col min-w-0 relative" style={{background:'#0a0a0a'}}>
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">💬</div>
              <p className="text-zinc-400 text-sm font-medium">No conversation selected</p>
              <p className="text-zinc-700 text-xs mt-1">Click "New Chat" to start</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-zinc-800/40 px-6 py-3 shrink-0 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                {renamingTitle !== null ? (
                  <input
                    autoFocus
                    value={renamingTitle}
                    onChange={e => setRenamingTitle(e.target.value)}
                    onBlur={() => renameChat(activeConv.id, renamingTitle)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameChat(activeConv.id, renamingTitle)
                      if (e.key === 'Escape') setRenamingTitle(null)
                    }}
                    className="bg-transparent border-b border-zinc-600 text-white text-sm font-medium outline-none w-full"
                  />
                ) : (
                  <h2
                    className="text-white text-sm font-medium truncate cursor-pointer hover:text-zinc-300 transition-colors"
                    title="Double-click to rename"
                    onDoubleClick={() => setRenamingTitle(activeConv.title)}>
                    {activeConv.title}
                  </h2>
                )}
                <p className="text-zinc-500 text-xs mt-0.5">{currentAgent.label} — Claude Max</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isSending ? (
                  <button
                    onClick={stopGeneration}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition-colors flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => exportChat(activeConv)}
                    className="text-[10px] px-2.5 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 transition-colors">
                    ↓ Export
                  </button>
                )}
              </div>
            </div>

            {/* KAOS is writing status bar */}
            {isSending && (
              <div className="border-b border-zinc-800/40 px-6 py-2 shrink-0 flex items-center gap-2.5" style={{background:'#0d0d0d'}}>
                <div className="flex gap-0.5 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'0ms'}} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'120ms'}} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'240ms'}} />
                </div>
                <span className="text-xs text-zinc-500">🧠 <span className="text-blue-400 font-medium">KAOS</span> is writing…</span>
              </div>
            )}

            {/* Scroll to bottom button */}
            {userScrolledUp && (
              <div className="absolute bottom-28 right-8 z-10">
                <button
                  onClick={() => { setUserScrolledUp(false); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                  className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 text-white text-sm flex items-center justify-center shadow-lg transition-all">
                  ↓
                </button>
              </div>
            )}

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 relative">
              {activeConv.messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-zinc-600 text-sm">Start a conversation</p>
                </div>
              ) : (
                activeConv.messages.map(msg => (
                  <div
                    key={msg.id}
                    className={'group flex gap-3 ' + (msg.role === 'user' ? 'flex-row-reverse' : '')}>
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm mt-0.5"
                      style={{ background: msg.role === 'user' ? '#1e1e1e' : '#3b82f620' }}>
                      {msg.role === 'user' ? '👤' : '🧠'}
                    </div>

                    {/* Bubble */}
                    <div className={'relative ' + (msg.role === 'user' ? 'max-w-[65ch]' : 'max-w-[75ch]')}>
                      <div
                        className={
                          'px-4 py-3 rounded-lg text-sm ' +
                          (msg.role === 'user'
                            ? 'bg-zinc-800 text-white'
                            : 'bg-zinc-900 text-zinc-300')
                        }>
                        {msg.role === 'user'
                          ? <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                          : <MarkdownMessage content={msg.content} />
                        }
                      </div>
                      {/* Timestamp + copy row */}
                      <div className={
                        'flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ' +
                        (msg.role === 'user' ? 'justify-end' : 'justify-start')
                      }>
                        {msg.ts && (
                          <span className="text-[9px] text-zinc-600">
                            {new Date(msg.ts).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}
                          </span>
                        )}
                        <button
                          onClick={() => copyMessage(msg.id, msg.content)}
                          className="text-[9px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1 transition-colors">
                          {copiedId === msg.id ? '✓ Copied' : '⎘ Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm bg-zinc-900/50">
                    🧠
                  </div>
                  <div className="px-4 py-3 rounded-lg bg-zinc-900 text-zinc-500">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'0ms'}} />
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'150ms'}} />
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay:'300ms'}} />
                    </div>
                  </div>
                </div>
              )}
              {chatError && (
                <div className="flex gap-3">
                  <div className="px-4 py-3 rounded-lg bg-red-950/40 border border-red-900/40 text-red-400 text-sm max-w-xl flex items-center gap-3">
                    <span>⚠️ {chatError}</span>
                    <button
                      onClick={handleRetry}
                      className="ml-2 text-xs px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition-colors shrink-0">
                      Retry ↺
                    </button>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-zinc-800/40 px-6 py-4 shrink-0" style={{background:'#0d0d0d'}}>
              {selectedFile && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60">
                  <span className="text-sm">📎</span>
                  <span className="text-xs text-zinc-400 flex-1 truncate">{selectedFile.name}</span>
                  <span className="text-[9px] text-zinc-600">{(selectedFile.content.length / 1024).toFixed(1)}KB</span>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-zinc-600 hover:text-white text-xs ml-1">
                    ✕
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                {/* Paperclip button */}
                <button
                  onClick={handleFileAttach}
                  disabled={isSending}
                  className="p-2 rounded-lg hover:bg-zinc-900 transition-all text-zinc-500 hover:text-zinc-300 shrink-0 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Attach file (text/code)">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>

                {/* Agent selector */}
                <select
                  value={selectedAgent}
                  onChange={e => setSelectedAgent(e.target.value)}
                  disabled={isSending}
                  className="px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/60 text-xs text-zinc-400 shrink-0 mb-0.5 outline-none focus:border-zinc-600 disabled:opacity-50 cursor-pointer"
                  title="Select agent">
                  {AGENT_OPTIONS.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>

                {/* Auto-grow textarea */}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputVal}
                  onChange={(e) => { setInputVal(e.target.value); adjustTextarea() }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    } else if (e.key === 'Enter' && e.shiftKey) {
                      // Let the newline happen, then resize
                      setTimeout(adjustTextarea, 0)
                    }
                  }}
                  disabled={isSending}
                  placeholder={isSending ? 'KAOS is writing…' : 'Message KAOS (Claude Max)...'}
                  className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60 text-white text-sm placeholder-zinc-600 outline-none focus:border-zinc-700 transition-all resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{minHeight:'38px', maxHeight:'160px'}}
                />

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={!inputVal.trim() || isSending}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white shrink-0 mb-0.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9-7-9-7m0 0l-9 7m9-7v7" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center justify-between mt-2">
                <p className="text-zinc-700 text-[10px]">
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500">Enter</kbd> send ·
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 ml-1">⇧ Enter</kbd> newline ·
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 ml-1">⌘K</kbd> new chat
                </p>
                {inputVal.length > 0 && (
                  <span className={`text-[9px] tabular-nums ${inputVal.length > 8000 ? 'text-red-500' : inputVal.length > 4000 ? 'text-yellow-500' : 'text-zinc-700'}`}>
                    {inputVal.length.toLocaleString()} chars
                  </span>
                )}
              </div>
              {selectedFile && selectedFile.content.length > 32768 && (
                <p className="text-[10px] text-yellow-500 mt-1">
                  ⚠️ File is {(selectedFile.content.length / 1024).toFixed(0)}KB — only first 32KB will be sent to avoid context overflow.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Task types ────────────────────────────────────────────────────────────
interface Task {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  due_date?: string; created_at?: string; updated_at?: string;
}

const BOARD_COLUMNS = [
  { id:'backlog',     label:'Backlog',      color:'#3f3f46' },
  { id:'open',        label:'Open',         color:'#3b82f6' },
  { id:'in_progress', label:'In Progress',  color:'#eab308' },
  { id:'in_review',   label:'In Review',    color:'#a855f7' },
  { id:'done',        label:'Done',         color:'#22c55e' },
]

const ASSIGNEE_MAP: Record<string,{emoji:string;name:string}> = {
  main:          {emoji:'🧠', name:'KAOS'},
  scout:         {emoji:'🔍', name:'Scout'},
  ops:           {emoji:'⚙️', name:'Ops'},
  'kemuni-sme':  {emoji:'🚀', name:'Kemuni SME'},
  'vespera-sme': {emoji:'🖤', name:'Vespera SME'},
  builder:       {emoji:'🔨', name:'Builder'},
  tester:        {emoji:'🧪', name:'Tester'},
}

const PRIORITY_COLORS: Record<string,string> = {
  critical:'#ef4444', high:'#f97316', medium:'#3f3f46', low:'#27272a',
}

const PROJECT_COLORS: Record<string,string> = {
  Kemuni:'#3b82f6', Vespera:'#a855f7', Ops:'#6b7280', OpenClaw:'#10b981',
}

function KanbanBoard() {
  const [tasks, setTasks]         = useState<Task[]>([])
  const [loading, setLoading]     = useState(true)
  const [dragId, setDragId]       = useState<string|null>(null)
  const [editTask, setEditTask]   = useState<Task|null>(null)
  const [newTask, setNewTask]     = useState<Partial<Task>|null>(null)
  const [filterProject, setFilterProject]   = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [confirmDelete, setConfirmDelete]   = useState<string|null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      if (res.ok) { const d = await res.json(); setTasks(d) }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const createTask = async (t: Partial<Task>) => {
    const res = await fetch('/api/tasks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(t) })
    if (res.ok) { const d = await res.json(); setTasks(prev => [d, ...prev]); setNewTask(null) }
  }

  const updateTask = async (id: string, fields: Partial<Task>) => {
    const res = await fetch('/api/tasks', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, ...fields}) })
    if (res.ok) { const d = await res.json(); setTasks(prev => prev.map(t => t.id===id ? d : t)); setEditTask(null) }
  }

  const deleteTask = async (id: string) => {
    const res = await fetch(`/api/tasks?id=${id}`, { method:'DELETE' })
    if (res.ok) { setTasks(prev => prev.filter(t => t.id!==id)); setConfirmDelete(null); setEditTask(null) }
  }

  const handleDrop = (status: string) => {
    if (!dragId) return
    updateTask(dragId, { status })
    setTasks(prev => prev.map(t => t.id===dragId ? {...t, status} : t))
    setDragId(null)
  }

  const filtered = tasks.filter(t => {
    if (filterProject && t.project !== filterProject) return false
    if (filterAssignee && t.assignee !== filterAssignee) return false
    if (filterPriority && t.priority !== filterPriority) return false
    return true
  })

  const projects = Array.from(new Set(tasks.map(t=>t.project).filter(Boolean)))
  const assignees = Array.from(new Set(tasks.map(t=>t.assignee).filter(Boolean)))

  const isOverdue = (d?: string) => {
    if (!d) return false
    return new Date(d) < new Date(new Date().toDateString())
  }

  const selectCls = "bg-transparent border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-400 outline-none focus:border-zinc-600"
  const inputCls = "w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-zinc-600 placeholder-zinc-700"
  const labelCls = "text-[10px] uppercase tracking-widest text-zinc-600 mb-1"

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select className={selectCls} value={filterProject} onChange={e=>setFilterProject(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map(p=><option key={p} value={p!}>{p}</option>)}
        </select>
        <select className={selectCls} value={filterAssignee} onChange={e=>setFilterAssignee(e.target.value)}>
          <option value="">All Assignees</option>
          {assignees.map(a=><option key={a} value={a!}>{ASSIGNEE_MAP[a!]?.name??a}</option>)}
        </select>
        <select className={selectCls} value={filterPriority} onChange={e=>setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {['critical','high','medium','low'].map(p=><option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={()=>setNewTask({status:'backlog',priority:'medium'})}
          className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
          + New Task
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-0">
        {BOARD_COLUMNS.map(col => {
          const colTasks = filtered.filter(t => t.status===col.id)
          return (
            <div key={col.id}
              className="flex-shrink-0 w-64 flex flex-col rounded-xl bg-zinc-900/50"
              style={{borderTop:`2px solid ${col.color}`}}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}>
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{background:col.color}} />
                  <span className="text-xs font-semibold text-zinc-400">{col.label}</span>
                </div>
                <span className="text-[10px] text-zinc-600 font-mono">{colTasks.length}</span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
                {loading && <div className="text-zinc-700 text-xs text-center py-4">Loading...</div>}
                {colTasks.map(task => (
                  <div key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setEditTask(task)}
                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                      dragId===task.id ? 'opacity-50' : ''
                    }`}
                    style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a'}}
                    onMouseEnter={e=>(e.currentTarget.style.borderColor='#3f3f46')}
                    onMouseLeave={e=>(e.currentTarget.style.borderColor= dragId===task.id ? '#555' : '#27272a')}>
                    <p className="text-white text-sm font-medium leading-snug mb-2">{task.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {task.project && <Chip label={task.project} color={PROJECT_COLORS[task.project]||undefined} />}
                      {task.type && <Chip label={task.type} />}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {task.priority && (
                        <span className="w-1.5 h-1.5 rounded-full inline-block"
                          style={{background:PRIORITY_COLORS[task.priority]||'#3f3f46'}} />
                      )}
                      {task.assignee && ASSIGNEE_MAP[task.assignee] && (
                        <span className="text-[10px] text-zinc-500">
                          {ASSIGNEE_MAP[task.assignee].emoji} {ASSIGNEE_MAP[task.assignee].name}
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`text-[10px] ml-auto ${isOverdue(task.due_date)?'text-red-500':'text-zinc-600'}`}>
                          {new Date(task.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick-add */}
              <button onClick={()=>setNewTask({status:col.id,priority:'medium'})}
                className="mx-2 mb-2 text-[10px] text-zinc-700 hover:text-zinc-500 transition-colors py-1">
                + Add task
              </button>
            </div>
          )
        })}
      </div>

      {/* New Task Modal */}
      {newTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={()=>setNewTask(null)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 p-6 space-y-4" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm">New Task</h3>
            <div><p className={labelCls}>Title *</p><input className={inputCls} placeholder="Task title..." autoFocus
              value={newTask.title??''} onChange={e=>setNewTask({...newTask,title:e.target.value})} /></div>
            <div><p className={labelCls}>Description</p><textarea className={inputCls+' h-20 resize-none'} placeholder="Details..."
              value={newTask.description??''} onChange={e=>setNewTask({...newTask,description:e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className={labelCls}>Status</p>
                <select className={inputCls} value={newTask.status??'backlog'} onChange={e=>setNewTask({...newTask,status:e.target.value})}>
                  {BOARD_COLUMNS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select></div>
              <div><p className={labelCls}>Priority</p>
                <select className={inputCls} value={newTask.priority??'medium'} onChange={e=>setNewTask({...newTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
              <div><p className={labelCls}>Project</p>
                <input className={inputCls} placeholder="e.g. Kemuni" value={newTask.project??''} onChange={e=>setNewTask({...newTask,project:e.target.value})} /></div>
              <div><p className={labelCls}>Assignee</p>
                <select className={inputCls} value={newTask.assignee??''} onChange={e=>setNewTask({...newTask,assignee:e.target.value})}>
                  <option value="">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k}>{v.emoji} {v.name}</option>)}
                </select></div>
              <div><p className={labelCls}>Type</p>
                <input className={inputCls} placeholder="e.g. feature, bug" value={newTask.type??''} onChange={e=>setNewTask({...newTask,type:e.target.value})} /></div>
              <div><p className={labelCls}>Due Date</p>
                <input type="date" className={inputCls} value={newTask.due_date??''} onChange={e=>setNewTask({...newTask,due_date:e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setNewTask(null)} className="text-xs text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-900">Cancel</button>
              <button onClick={()=>{if(newTask.title?.trim()) createTask(newTask)}}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                disabled={!newTask.title?.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Detail Modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={()=>setEditTask(null)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 p-6 space-y-4" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-white font-semibold text-sm">Edit Task</h3>
              <button onClick={()=>setConfirmDelete(editTask.id)} className="text-[10px] text-red-500/60 hover:text-red-500 transition-colors">Delete</button>
            </div>
            <div><p className={labelCls}>Title</p><input className={inputCls}
              value={editTask.title} onChange={e=>setEditTask({...editTask,title:e.target.value})} /></div>
            <div><p className={labelCls}>Description</p><textarea className={inputCls+' h-20 resize-none'}
              value={editTask.description??''} onChange={e=>setEditTask({...editTask,description:e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className={labelCls}>Status</p>
                <select className={inputCls} value={editTask.status} onChange={e=>setEditTask({...editTask,status:e.target.value})}>
                  {BOARD_COLUMNS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select></div>
              <div><p className={labelCls}>Priority</p>
                <select className={inputCls} value={editTask.priority??'medium'} onChange={e=>setEditTask({...editTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
              <div><p className={labelCls}>Project</p>
                <input className={inputCls} value={editTask.project??''} onChange={e=>setEditTask({...editTask,project:e.target.value})} /></div>
              <div><p className={labelCls}>Assignee</p>
                <select className={inputCls} value={editTask.assignee??''} onChange={e=>setEditTask({...editTask,assignee:e.target.value})}>
                  <option value="">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k}>{v.emoji} {v.name}</option>)}
                </select></div>
              <div><p className={labelCls}>Type</p>
                <input className={inputCls} value={editTask.type??''} onChange={e=>setEditTask({...editTask,type:e.target.value})} /></div>
              <div><p className={labelCls}>Due Date</p>
                <input type="date" className={inputCls} value={editTask.due_date??''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setEditTask(null)} className="text-xs text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-900">Cancel</button>
              <button onClick={()=>updateTask(editTask.id,{title:editTask.title,description:editTask.description,status:editTask.status,
                priority:editTask.priority,project:editTask.project,assignee:editTask.assignee,type:editTask.type,due_date:editTask.due_date})}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={()=>setConfirmDelete(null)}>
          <div className="rounded-2xl border border-zinc-800 p-6 text-center space-y-4" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
            <p className="text-white text-sm">Delete this task?</p>
            <div className="flex justify-center gap-3">
              <button onClick={()=>setConfirmDelete(null)} className="text-xs text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-900">Cancel</button>
              <button onClick={()=>deleteTask(confirmDelete)} className="text-xs font-medium px-4 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab]       = useState<Tab>(()=>{
    if(typeof window!=='undefined'){
      const saved = localStorage.getItem('mc-tab') as Tab|null
      if(saved && ['overview','activity','team','calendar','automations','office','memory','board','chat','infra'].includes(saved)) return saved
    }
    return 'overview'
  })
  const [clock, setClock]   = useState('')
  const [memFiles, setMemFiles] = useState<{date:string;filename:string;preview:string}[]>([])
  const [openMem, setOpenMem] = useState<string|null>(null)
  const [feedIdx, setFeedIdx] = useState(0)
  const [blink, setBlink]   = useState(true)
  const [tick, setTick]     = useState(0)
  const [hoverDesk, setHoverDesk] = useState<string|null>(null)
  const [liveStatus, setLiveStatus] = useState<any>(null)
  const [statusAt, setStatusAt] = useState<number>(0)
  const [agoSec, setAgoSec] = useState<number>(0)
  const [liveAgents, setLiveAgents] = useState<typeof ALL_AGENTS | null>(null)
  const [liveCrons, setLiveCrons] = useState<typeof CRONS | null>(null)
  const [projects, setProjects] = useState<any[]|null>(null)
  const [deployState, setDeployState] = useState<'idle'|'loading'|'done'>('idle')
  const [mobileNav, setMobileNav] = useState(false)
  const [agentModal, setAgentModal] = useState<any>(null)
  const [cronModal, setCronModal] = useState<any>(null)

  const [statusCountdown, setStatusCountdown] = useState(30)
  const [agentsCountdown, setAgentsCountdown] = useState(60)

  const fetchStatus = () => {
    fetch('/api/status').then(r=>r.json()).then(d=>{ setLiveStatus(d); setStatusAt(Date.now()) }).catch(()=>{})
  }
  const fetchAgentsAndCrons = () => {
    fetch('/api/agents').then(r=>r.json()).then(d=>{ if(Array.isArray(d)) setLiveAgents(d) }).catch(()=>{})
    fetch('/api/automations').then(r=>r.json()).then(d=>{ if(Array.isArray(d)) setLiveCrons(d) }).catch(()=>{})
  }

  useEffect(()=>{
    fetchStatus()
    const t=setInterval(()=>{ fetchStatus(); setStatusCountdown(30) },30000)
    const cd=setInterval(()=>setStatusCountdown(s=>Math.max(0,s-1)),1000)
    return ()=>{ clearInterval(t); clearInterval(cd) }
  },[])
  useEffect(()=>{
    fetchAgentsAndCrons()
    const t=setInterval(()=>{ fetchAgentsAndCrons(); setAgentsCountdown(60) },60000)
    const cd=setInterval(()=>setAgentsCountdown(s=>Math.max(0,s-1)),1000)
    return ()=>{ clearInterval(t); clearInterval(cd) }
  },[])
  useEffect(()=>{
    if(!statusAt) return
    const t=setInterval(()=>setAgoSec(Math.floor((Date.now()-statusAt)/1000)),1000)
    return ()=>clearInterval(t)
  },[statusAt])

  useEffect(()=>{
    const t=setInterval(()=>{
      setClock(new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'America/New_York'})+' ET')
    },1000); return ()=>clearInterval(t)
  },[])
  useEffect(()=>{
    fetch('/api/projects').then(r=>r.json()).then(d=>{ if(Array.isArray(d)&&d.length>0) setProjects(d) }).catch(()=>{})
  },[])
  useEffect(()=>{
    fetch('/api/memory').then(r=>r.json()).then(d=>setMemFiles(d.files||[]))
  },[])
  useEffect(()=>{
    const t=setInterval(()=>setFeedIdx(i=>(i+1)%LIVE_FEED.length),4000)
    return ()=>clearInterval(t)
  },[])
  useEffect(()=>{
    const t=setInterval(()=>setBlink(b=>!b),800)
    return ()=>clearInterval(t)
  },[])
  useEffect(()=>{
    const t=setInterval(()=>setTick(n=>n+1),3000)
    return ()=>clearInterval(t)
  },[])

  const kLeft=daysUntil(KEMUNI_DEADLINE), kElap=daysSince(KEMUNI_START), kPct=miniPct(kElap,30)
  const vLeft=daysUntil(VESPERA_DEADLINE), vElap=daysSince(VESPERA_START), vPct=miniPct(vElap,7)

  const sprintProjects = projects ?? [
    {id:'kemuni',name:'Kemuni Launch',desc:'Community & Property SaaS',emoji:'🚀',startDate:'2026-03-21',deadline:'2026-04-20',totalDays:30,color:'#ffffff',borderColor:'border-zinc-800/60',bg:'#0f0f0f',bgDark:'#0f0f0f'},
    {id:'vespera',name:'Vespera Sprint',desc:'Colombia Goth Community',emoji:'🦇',startDate:'2026-03-22',deadline:'2026-03-29',totalDays:7,color:'#a855f7',borderColor:'border-purple-900/30',bg:'#0f0a14',bgDark:'#0f0a14'},
  ]
  const todayIdx=new Date().getDay()
  const nextRuns=getNextRuns()

  const ACTIVITIES: Record<string,string[]> = {
    main:    ['Reviewing sprint goals...','Planning delegations...','Updating MEMORY.md...','Checking crons...'],
    builder: ['Idle — awaiting task','Ready to build...','Standing by...'],
    scout:   ['Scheduled for 8:00 AM','Queued research tasks...','Idle'],
    quill:   ['In the playroom...','Resting...'],
    echo:    ['In the playroom...','Resting...'],
    ralph:   ['In the playroom...','Resting...'],
  }
  const agentCurrentTask: Record<string,string> = liveStatus?.agentCurrentTask ?? {}
  const act=(id:string)=>{
    if(agentCurrentTask[id]) return agentCurrentTask[id]
    const a=ACTIVITIES[id]||['Idle'];return a[tick%a.length]
  }

  const rawFeed = (liveStatus?.recentActivity && liveStatus.recentActivity.length > 0) ? liveStatus.recentActivity : LIVE_FEED
  const feed = Array.from({length:5},(_,i)=>rawFeed[(feedIdx+i)%rawFeed.length])
  const displayAgents = (liveAgents && liveAgents.length > 0 ? liveAgents : ALL_AGENTS) as typeof ALL_AGENTS
  // Ensure all live agents show on floor since they're all real OpenClaw agents
  const displayCrons  = (liveCrons  && liveCrons.length  > 0 ? liveCrons  : CRONS)      as typeof CRONS
  // If using live agents, show all on floor (they're all real); only use floor filter for hardcoded ALL_AGENTS
  const usingLive = liveAgents && liveAgents.length > 0
  const floorAgents = usingLive ? displayAgents : displayAgents.filter((a:any)=>a.floor)
  const playroomAgents = usingLive ? [] : displayAgents.filter((a:any)=>!a.floor)

  return (
    <div className="min-h-screen flex" style={{background:'#080808'}}>

      {/* SIDEBAR */}
      <aside className="w-44 shrink-0 hidden lg:flex flex-col border-r border-zinc-800/60 sticky top-0 h-screen" style={{background:'#0a0a0a'}}>
        <div className="px-4 py-4 border-b border-zinc-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-sm font-bold text-white">N</div>
            <div>
              <p className="text-white text-xs font-semibold leading-tight">Mission</p>
              <p className="text-zinc-600 text-[10px]">Control</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(item=>(
            <button key={item.id} onClick={()=>{ setTab(item.id); if(typeof window!=='undefined') localStorage.setItem('mc-tab',item.id) }}
              className={'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all '+(
                tab===item.id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              )}>
              <span className="text-sm shrink-0">{item.icon}</span>
              <span className="text-xs font-medium">{item.label}</span>
              {tab===item.id && <span className="ml-auto w-1 h-1 rounded-full bg-white shrink-0" />}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-zinc-800/40 space-y-1">
          <div className="flex items-center gap-1.5">
            <Dot status="active" sm />
            <span className="text-zinc-600 text-[10px]">All nominal</span>
          </div>
          <p className="text-zinc-700 text-[10px] font-mono">{clock}</p>
        </div>
      </aside>

      {/* MOBILE HAMBURGER + OVERLAY */}
      <button onClick={()=>setMobileNav(true)} className="lg:hidden fixed top-2 left-2 z-50 w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-lg text-zinc-300 hover:text-white transition-colors">
        ☰
      </button>
      {mobileNav && (
        <div className="lg:hidden fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3" style={{background:'#080808ee'}} onClick={()=>setMobileNav(false)}>
          <p className="text-zinc-600 text-xs mb-4 uppercase tracking-widest">Navigate</p>
          {NAV.map(item=>(
            <button key={item.id} onClick={()=>{ setTab(item.id); setMobileNav(false); if(typeof window!=='undefined') localStorage.setItem('mc-tab',item.id) }}
              className={'flex items-center gap-3 px-6 py-3 rounded-xl transition-all w-56 '+(
                tab===item.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              )}>
              <span className="text-xl">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
              {tab===item.id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
            </button>
          ))}
        </div>
      )}

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-h-screen overflow-auto">
        <header className="border-b border-zinc-800/40 px-6 h-11 flex items-center justify-between shrink-0 sticky top-0 z-20" style={{background:'#090909'}}>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 text-sm font-medium capitalize">{tab}</span>
            <span className="text-zinc-700 text-xs">· Nabit LLC</span>
          </div>
          <span className="text-zinc-600 text-xs">
            {new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
          </span>
        </header>

        <main className="flex-1 px-6 py-5">

          {/* ── OVERVIEW ── */}
          {tab==='overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                {sprintProjects.map(proj=>{
                  const dl=new Date(proj.deadline), st=new Date(proj.startDate)
                  const left=daysUntil(dl), elap=daysSince(st), pct=miniPct(elap,proj.totalDays)
                  const dlLabel=dl.toLocaleDateString('en-US',{month:'short',day:'numeric'})
                  const isUrgent = left<=2 && proj.color!=='#ffffff'
                  return (
                    <div key={proj.id} className={`rounded-2xl p-5 border ${proj.borderColor} card-glow`} style={{background:proj.bg}}>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{color:proj.color==='#ffffff'?'#71717a':proj.color+'b3'}}>{proj.name}</p>
                          <p className="text-white text-sm font-medium">{proj.desc}</p>
                        </div>
                        <span className="text-xl">{proj.emoji}</span>
                      </div>
                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="text-4xl font-bold tabular-nums" style={{color:isUrgent?'#ef4444':proj.color}}>{left}</span>
                        <span className="text-zinc-500 text-sm">days</span>
                        <span className="ml-auto text-zinc-600 text-xs">Day {elap}/{proj.totalDays}</span>
                      </div>
                      <Bar v={pct} color={proj.color} bg={proj.color==='#ffffff'?'#1e1e1e':'#1a0a2a'} />
                      <div className="flex justify-between mt-1.5">
                        <span className="text-zinc-600 text-[10px]">{pct}% elapsed</span>
                        <span className="text-zinc-600 text-[10px]">{dlLabel}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Live Activity Feed (mini) */}
              <div>
                <SH icon="📡" sub={liveStatus?.recentActivity?.length ? '● live' : undefined}>Recent Activity</SH>
                <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {(liveStatus?.recentActivity ?? []).slice(0,5).map((entry:any, i:number, arr:any[])=>{
                    const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                    const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':'#3b82f6'
                    return (
                      <div key={i} className={'flex items-start gap-3 px-4 py-3 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                        <span className="text-base shrink-0 mt-0.5">{entry.emoji || (AGENT_DISPLAY[entry.agentId]?.emoji ?? '🤖')}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-xs font-medium">{entry.agentName || AGENT_DISPLAY[entry.agentId]?.name || entry.agentId}</span>
                            {entry.channel && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                              style={{background:actionColor+'20',color:actionColor}}>
                              {entry.channel}
                            </span>}
                            {entry.model && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-zinc-800 text-zinc-500">{entry.model}</span>}
                            <span className="ml-auto text-zinc-600 text-[10px] shrink-0">{agoStr}</span>
                          </div>
                          <p className="text-zinc-500 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                  {(!liveStatus?.recentActivity || liveStatus.recentActivity.length === 0) && (
                    <p className="text-zinc-700 text-xs px-4 py-4">No activity yet — loading...</p>
                  )}
                </div>
                {(liveStatus?.recentActivity?.length ?? 0) > 5 && (
                  <button onClick={()=>{ setTab('activity'); if(typeof window!=='undefined') localStorage.setItem('mc-tab','activity') }}
                    className="mt-2 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2 rounded-lg border border-zinc-800/40 hover:border-zinc-600 transition-all"
                    style={{background:'#0a0a0a'}}>
                    View All Activity →
                  </button>
                )}
              </div>

              {/* OpenRouter Balance — live */}
              {(()=>{
                const or = liveStatus?.openrouter
                const remaining = or?.remaining ?? 9.57
                const limit = or?.limit ?? 10
                const used = or?.used ?? 0.43
                const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
                return (
                  <div className="rounded-2xl border border-zinc-800/60 p-5" style={{background:'#0f0f0f'}}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm">💳</span>
                      <span className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">OpenRouter Balance</span>
                      {liveStatus && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg" title="Live data" />}
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-2xl font-bold text-white tabular-nums">${remaining.toFixed(2)}</span>
                      <span className="text-zinc-600 text-sm">/ ${limit.toFixed(2)}</span>
                      <span className="ml-auto text-zinc-600 text-xs">${used.toFixed(2)} used</span>
                    </div>
                    <Bar v={pct} color="#3b82f6" bg="#1a1a2a" />
                  </div>
                )
              })()}

            </div>
          )}

          {/* ── ACTIVITY ── */}
          {tab==='activity' && (
            <div className="space-y-5">
              <SH icon="📡" sub={liveStatus?.recentActivity?.length ? `${liveStatus.recentActivity.length} entries · live` : undefined}>Activity Feed</SH>
              {(()=>{
                const items = liveStatus?.recentActivity ?? []
                if(items.length === 0) return <p className="text-zinc-700 text-xs px-4 py-4">No activity yet — loading...</p>
                // Group by date
                const grouped: Record<string, any[]> = {}
                for(const entry of items){
                  const dateKey = entry.date || (entry.ago < 60 ? 'Today' : entry.ago < 1440 ? 'Yesterday' : 'Earlier')
                  if(!grouped[dateKey]) grouped[dateKey] = []
                  grouped[dateKey].push(entry)
                }
                return Object.entries(grouped).map(([date, entries])=>(
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-zinc-600 text-[10px] font-semibold uppercase tracking-widest">{date}</span>
                      <div className="flex-1 h-px bg-zinc-800/50" />
                      <span className="text-zinc-700 text-[10px]">{entries.length}</span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                      {entries.map((entry:any, i:number, arr:any[])=>{
                        const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                        const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':'#3b82f6'
                        return (
                          <div key={i} className={'flex items-start gap-3 px-4 py-3 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                            <span className="text-base shrink-0 mt-0.5">{entry.emoji || (AGENT_DISPLAY[entry.agentId]?.emoji ?? '🤖')}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-xs font-medium">{entry.agentName || AGENT_DISPLAY[entry.agentId]?.name || entry.agentId}</span>
                                {entry.channel && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                                  style={{background:actionColor+'20',color:actionColor}}>
                                  {entry.channel}
                                </span>}
                                {entry.model && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-zinc-800 text-zinc-500">{entry.model}</span>}
                                <span className="ml-auto text-zinc-600 text-[10px] shrink-0">{agoStr}</span>
                              </div>
                              <p className="text-zinc-500 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}

          {/* ── TEAM ── */}
          {tab==='team' && (
            <div className="space-y-6">
              {liveAgents && <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-zinc-600 text-[10px]">Live agent data · {displayAgents.length} agents</span></div>}

              {/* Lead agent card */}
              {displayAgents.length > 0 && <div className="flex justify-center">
                <div className="rounded-2xl p-6 border border-zinc-700/50 card-glow w-80 cursor-pointer hover:border-zinc-600 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setAgentModal(displayAgents[0])}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{background:'#1a1a1a'}}>
                      {displayAgents[0].emoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{displayAgents[0].name}</p>
                        <Dot status={displayAgents[0].status} />
                      </div>
                      <p className="text-zinc-500 text-xs">{displayAgents[0].role}</p>
                      <p className="text-zinc-700 text-[10px] font-mono mt-0.5">{displayAgents[0].model}</p>
                    </div>
                  </div>
                  <p className="text-zinc-500 text-sm mb-4 leading-relaxed">{displayAgents[0].desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {displayAgents[0].capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                  </div>
                </div>
              </div>}
              <div className="flex justify-center">
                <div className="w-px h-6 bg-gradient-to-b from-zinc-600 to-transparent" />
              </div>
              <div className="flex justify-center">
                <div className="w-3/4 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
              </div>

              {/* Active agents */}
              <SH icon="🤖">Active Agents</SH>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayAgents.slice(1).filter((a:any)=>a.status!=='planned').map((a:any)=>(
                  <div key={a.id} className="rounded-2xl p-5 border card-glow cursor-pointer hover:border-zinc-600 transition-colors" style={{background:'#0f0f0f',borderColor:a.color+'28'}} onClick={()=>setAgentModal(a)}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{background:a.color+'18',border:'1px solid '+a.color+'30'}}>
                        {a.emoji}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-white text-sm font-semibold truncate">{a.name}</p>
                          <Dot status={a.status} />
                        </div>
                        <p className="text-zinc-500 text-xs truncate">{a.role}</p>
                        <p className="text-zinc-700 text-[10px] font-mono truncate">{a.modelShort}</p>
                      </div>
                    </div>
                    <p className="text-zinc-500 text-xs leading-relaxed mb-3">{a.desc}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {a.capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Planned agents */}
              {displayAgents.filter((a:any)=>a.status==='planned').length > 0 && (<>
                <SH icon="📋">Planned Agents</SH>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayAgents.filter((a:any)=>a.status==='planned').map((a:any)=>(
                    <div key={a.id} className="rounded-2xl p-5 border border-dashed cursor-pointer hover:border-zinc-600 transition-colors opacity-60 hover:opacity-90" style={{background:'#0a0a0a',borderColor:a.color+'20'}} onClick={()=>setAgentModal(a)}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                          style={{background:a.color+'10',border:'1px dashed '+a.color+'25'}}>
                          {a.emoji}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-zinc-400 text-sm font-semibold truncate">{a.name}</p>
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-500 bg-zinc-900 font-semibold uppercase">Planned</span>
                          </div>
                          <p className="text-zinc-600 text-xs truncate">{a.role}</p>
                          <p className="text-zinc-700 text-[10px] font-mono truncate">{a.modelShort}</p>
                        </div>
                      </div>
                      <p className="text-zinc-600 text-xs leading-relaxed mb-3">{a.desc}</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                      </div>
                      {(a as any).activatesWhen && (
                        <div className="mt-2 pt-2 border-t border-zinc-800/40">
                          <span className="text-[9px] text-zinc-600">Activates: </span>
                          <span className="text-[9px] text-zinc-500">{(a as any).activatesWhen}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>)}

              {/* Activity Feed (moved from Overview) */}
              <div>
                <SH icon="📋" sub={liveStatus?.recentActivity?.length ? `${liveStatus.recentActivity.length} entries` : undefined}>Live Activity Feed</SH>
                <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {(liveStatus?.recentActivity ?? []).slice(0,10).map((entry:any, i:number, arr:any[])=>{
                    const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                    const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':'#3b82f6'
                    return (
                      <div key={i} className={'flex items-start gap-3 px-4 py-3 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                        <span className="text-base shrink-0 mt-0.5">{entry.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-xs font-medium">{entry.agentName}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                              style={{background:actionColor+'20',color:actionColor}}>
                              {entry.channel}
                            </span>
                            <span className="ml-auto text-zinc-600 text-[10px] shrink-0">{agoStr}</span>
                          </div>
                          <p className="text-zinc-500 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                  {(!liveStatus?.recentActivity || liveStatus.recentActivity.length === 0) && (
                    <p className="text-zinc-700 text-xs px-4 py-4">No activity yet — loading...</p>
                  )}
                </div>
              </div>

              {/* Model Routing */}
              <div>
                <SH icon="🧠">Model Routing</SH>
                <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {[
                    {role:'Orchestration · KAOS (main)', model:'claude-sonnet-4-6', cost:'Max sub'},
                    {role:'Coding · Builder 🔨', model:'claude-sonnet-4-6', cost:'Max sub'},
                    {role:'Research · Scout 🔍', model:'ollama/gemma3:4b', cost:'Free — local'},
                    {role:'Content · Quill ✍️  Community · Echo 📢', model:'ollama/gemma3:4b', cost:'Free — local'},
                    {role:'QA · Ralph 🧪', model:'claude-sonnet-4-6', cost:'Max sub'},
                    {role:'Heartbeat + lightweight crons', model:'claude-haiku-4-5', cost:'Max sub'},
                    {role:'n8n automations', model:'n8n only', cost:'~$0/run'},
                  ].map((r,i,arr)=>(
                    <div key={r.role} className={'flex items-center gap-4 px-5 py-3.5 '+(i<arr.length-1?'border-b border-zinc-800/40':'')}>
                      <span className="text-zinc-400 text-xs flex-1">{r.role}</span>
                      <span className="font-mono text-xs text-zinc-400">{r.model}</span>
                      <span className="text-zinc-600 text-xs w-20 text-right">{r.cost}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Detail Modal */}
              {agentModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={()=>setAgentModal(null)}>
                  <div className="w-full max-w-md rounded-2xl border border-zinc-800 p-6 space-y-4" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{background:agentModal.color+'18',border:'1px solid '+agentModal.color+'30'}}>
                        {agentModal.emoji}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white font-semibold text-lg">{agentModal.name}</p>
                          <Dot status={agentModal.status} />
                          {agentModal.status==='planned' && <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-500 bg-zinc-900 font-semibold uppercase">Planned</span>}
                        </div>
                        <p className="text-zinc-500 text-sm">{agentModal.role}</p>
                      </div>
                      <button onClick={()=>setAgentModal(null)} className="ml-auto text-zinc-600 hover:text-white text-lg">✕</button>
                    </div>
                    <div className="space-y-3">
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Model</p><p className="text-zinc-300 text-sm font-mono">{agentModal.model}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Description</p><p className="text-zinc-300 text-sm leading-relaxed">{agentModal.desc}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Capabilities</p><div className="flex flex-wrap gap-1.5">{agentModal.capabilities.map((c:string)=><Chip key={c} label={c} color={agentModal.color}/>)}</div></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Status</p><p className="text-zinc-300 text-sm">{agentModal.status}</p></div>
                      {agentModal.status !== 'planned' && (
                        <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Current Task</p><p className="text-zinc-300 text-sm italic">{act(agentModal.id)}</p></div>
                      )}
                      {(agentModal as any).activatesWhen && (
                        <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Activates When</p><p className="text-zinc-300 text-sm">{(agentModal as any).activatesWhen}</p></div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── CALENDAR ── */}
          {tab==='calendar' && (
            <div className="space-y-5">
              <div>
                <SH icon="⚡">Always Running</SH>
                <div className="flex flex-wrap gap-2">
                  {CRONS.filter(c=>c.days==='daily'&&c.status==='active').map(c=>(
                    <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer hover:brightness-125 transition-all"
                      style={{background:pColor(c.project)+'15',borderColor:pColor(c.project)+'40'}}
                      onClick={()=>setCronModal(c)}>
                      <Dot status="active" sm />
                      <span className="text-xs font-medium" style={{color:pColor(c.project)}}>{c.id}</span>
                      <span className="text-zinc-600 text-[10px]">· {c.time}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{c.model}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <SH icon="📅">This Week</SH>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAYS.map((day,di)=>{
                    const dayCrons = CRONS.filter(c=>{
                      if(c.days==='daily') return true
                      if(c.days===day) return true
                      return false
                    })
                    return (
                    <div key={day} className="flex flex-col gap-1.5">
                      <div className={'text-center text-[10px] font-semibold py-1.5 rounded-lg '+(
                        di===todayIdx ? 'bg-white text-black' : 'text-zinc-500 bg-zinc-900/50'
                      )}>
                        {day}
                        {di===todayIdx && <div className="text-[9px] font-normal opacity-60">today</div>}
                      </div>
                      {dayCrons.map(c=>(
                        <div key={c.id} className={'rounded-lg px-2 py-1.5 border cursor-pointer hover:brightness-125 transition-all '+(c.status==='planned'?'border-dashed':'')}
                          style={{background: c.status==='planned'?'#1e0a2e': c.project==='Kemuni'||c.project==='Ops'&&c.model!=='n8n'?'#1e293b':'#1a1a1a',
                            borderColor: c.status==='planned'?'#a855f750': c.project==='Kemuni'?'#3b82f650':'#6b728050'}}
                          onClick={()=>setCronModal(c)}>
                          <p className="text-[11px] text-zinc-500 font-mono leading-tight">{c.time}</p>
                          <p className={'text-[13px] mt-0.5 font-medium leading-tight '+(c.status==='planned'?'text-purple-400':c.project==='Kemuni'?'text-blue-300':'text-zinc-400')}>{c.id.replace(/-/g,' ')}</p>
                          <span className="inline-block text-[9px] px-1 py-0.5 rounded mt-1 font-mono" style={{background:'#ffffff08',color:'#888'}}>{c.model}</span>
                          {c.status==='planned' && <p className="text-[10px] text-purple-800">planned</p>}
                        </div>
                      ))}
                    </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <SH icon="⏭">Next Up</SH>
                <div className="space-y-2">
                  {nextRuns.map(({cron,mins},i)=>(
                    <div key={cron.id} className="flex items-center gap-4 px-5 py-3 rounded-xl border border-zinc-800/60 cursor-pointer hover:border-zinc-600 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setCronModal(cron)}>
                      <span className="text-zinc-600 text-xs w-4">#{i+1}</span>
                      <Dot status={cron.status} />
                      <span className="font-mono text-xs text-white flex-1">{cron.id}</span>
                      <span className="text-zinc-500 text-xs">{cron.desc}</span>
                      <span className="text-xs font-semibold tabular-nums" style={{color:mins<60?'#f59e0b':'#6b7280'}}>
                        in {fmtMins(mins)}
                      </span>
                      <Chip label={cron.project} color={pColor(cron.project)} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Automations / Crons */}
              <div>
                <SH icon="🤖">Automations</SH>
                <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {displayCrons.map((c,i,arr)=>{
                    const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                    return (
                      <div key={c.id} className={'flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors '+(i<arr.length-1?'border-b border-zinc-800/40':'')}
                        onClick={()=>setCronModal(c)}>
                        <span className="font-mono text-xs text-zinc-400 w-16 shrink-0">{c.time}</span>
                        <span className="text-zinc-600 text-[10px] w-12 shrink-0">{c.days}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                          style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                          {c.model}
                        </span>
                        <Chip label={c.project} color={pColor(c.project)} />
                        <span className="text-zinc-300 text-xs flex-1">{c.desc}</span>
                        <Dot status={c.status} sm />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Cron Detail Modal */}
              {cronModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
                  <div className="w-full max-w-sm rounded-2xl border border-zinc-800 p-6 space-y-3" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-semibold text-sm">{cronModal.id}</h3>
                      <button onClick={()=>setCronModal(null)} className="text-zinc-600 hover:text-white text-lg">✕</button>
                    </div>
                    <div className="space-y-2.5">
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Description</p><p className="text-zinc-300 text-sm">{cronModal.desc}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Time</p><p className="text-zinc-300 text-sm font-mono">{cronModal.time}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Schedule</p><p className="text-zinc-300 text-sm">{cronModal.days}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Runner</p><p className="text-zinc-300 text-sm font-mono">{cronModal.model}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Project</p><Chip label={cronModal.project} color={pColor(cronModal.project)} /></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Status</p><div className="flex items-center gap-2"><Dot status={cronModal.status} /><span className="text-zinc-300 text-sm">{cronModal.status}</span></div></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── OFFICE ── */}
          {tab==='office' && (
            <div className="h-[calc(100vh-88px)] -mx-6 -my-5">
              <AgentOffice />
            </div>
          )}

          {/* ── OLD_OFFICE_REMOVED ── */}
          {false && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4">

                {/* ══ CANVAS ══ */}
                <div className="flex-1 rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0d0d0d'}}>
                  {/* Titlebar */}
                  <div className="px-4 py-2 border-b border-zinc-800/40 flex items-center gap-2">
                    <Dot status="active" sm />
                    <span className="text-zinc-400 text-xs font-medium">Nabit LLC — Office Floor</span>
                    <span className="ml-auto text-zinc-700 text-[10px]">{floorAgents.length} on floor · {playroomAgents.length} waiting</span>
                  </div>

                  {/* Top-down room — strict orthographic, no angle */}
                  <div style={{position:'relative',width:'100%',height:'500px',overflow:'hidden',background:'#18120a'}}>

                    {/* ── FLOOR TILE PATTERN ── */}
                    <div style={{position:'absolute',inset:0,
                      backgroundImage:'linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px)',
                      backgroundSize:'40px 40px'}} />

                    {/* ── WALLS ── */}
                    {/* Top */}
                    <div style={{position:'absolute',left:0,right:0,top:0,height:18,background:'#2e2214',borderBottom:'3px solid #4a3418'}} />
                    {/* Bottom */}
                    <div style={{position:'absolute',left:0,right:0,bottom:0,height:12,background:'#2e2214',borderTop:'2px solid #4a3418'}} />
                    {/* Left */}
                    <div style={{position:'absolute',top:0,bottom:0,left:0,width:12,background:'#2e2214',borderRight:'2px solid #4a3418'}} />
                    {/* Right */}
                    <div style={{position:'absolute',top:0,bottom:0,right:0,width:12,background:'#2e2214',borderLeft:'2px solid #4a3418'}} />

                    {/* Windows in top wall */}
                    {[60,180,320,460,600].map((x,i)=>(
                      <div key={i} style={{position:'absolute',left:x,top:2,width:36,height:14,background:'#1e3a5f',border:'1px solid #3b7dd8',borderRadius:'2px 2px 0 0'}}>
                        <div style={{position:'absolute',top:0,left:0,right:0,height:4,background:'rgba(125,211,252,0.25)'}} />
                        <div style={{position:'absolute',top:0,bottom:0,left:'50%',width:1,background:'rgba(59,130,246,0.3)'}} />
                      </div>
                    ))}

                    {/* ── ZONE LABELS ── */}
                    <span style={{position:'absolute',left:22,top:22,fontSize:7,fontWeight:700,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(180,140,80,0.4)'}}>Active Floor</span>
                    <span style={{position:'absolute',left:22,top:348,fontSize:7,fontWeight:700,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(140,80,80,0.4)'}}>Waitlist</span>

                    {/* ── CONFERENCE TABLE (left-center of active zone) ── */}
                    {(()=>{
                      const TW=200, TH=88, TX=30, TY=55
                      return (
                        <div style={{position:'absolute',left:TX,top:TY,width:TW,height:TH}}>
                          {/* Chairs — top row */}
                          {[TW*.15,TW*.38,TW*.62,TW*.85].map((cx,i)=>(
                            <div key={'t'+i} style={{position:'absolute',left:cx-10,top:-11,width:20,height:10,background:'#2a1e0e',border:'1px solid #4a3020',borderRadius:'3px 3px 0 0'}} />
                          ))}
                          {/* Chairs — bottom row */}
                          {[TW*.15,TW*.38,TW*.62,TW*.85].map((cx,i)=>(
                            <div key={'b'+i} style={{position:'absolute',left:cx-10,top:TH+1,width:20,height:10,background:'#2a1e0e',border:'1px solid #4a3020',borderRadius:'0 0 3px 3px'}} />
                          ))}
                          {/* Chairs — left col */}
                          {[TH*.3,TH*.7].map((cy,i)=>(
                            <div key={'l'+i} style={{position:'absolute',left:-11,top:cy-8,width:10,height:16,background:'#2a1e0e',border:'1px solid #4a3020',borderRadius:'3px 0 0 3px'}} />
                          ))}
                          {/* Chairs — right col */}
                          {[TH*.3,TH*.7].map((cy,i)=>(
                            <div key={'r'+i} style={{position:'absolute',left:TW+1,top:cy-8,width:10,height:16,background:'#2a1e0e',border:'1px solid #4a3020',borderRadius:'0 3px 3px 0'}} />
                          ))}
                          {/* Table top */}
                          <div style={{position:'absolute',inset:0,background:'#5a3e20',border:'2px solid #8a6030',borderRadius:6}}>
                            {/* Wood grain */}
                            {[20,40,60].map(y=>(<div key={y} style={{position:'absolute',left:6,right:6,top:y,height:1,background:'rgba(255,255,255,0.04)'}} />))}
                            {/* Papers */}
                            <div style={{position:'absolute',left:12,top:10,width:28,height:36,background:'#f5edd8',borderRadius:2,transform:'rotate(-6deg)',opacity:0.88}}>
                              {[5,10,15,20,25].map(y=>(<div key={y} style={{position:'absolute',left:3,right:3,top:y,height:1,background:'#bbb'}} />))}
                            </div>
                            <div style={{position:'absolute',left:26,top:16,width:24,height:30,background:'#deeeff',borderRadius:2,transform:'rotate(4deg)',opacity:0.8}}>
                              {[5,10,15,20].map(y=>(<div key={y} style={{position:'absolute',left:3,right:3,top:y,height:1,background:'#99aacc'}} />))}
                            </div>
                            {/* Laptop on table */}
                            <div style={{position:'absolute',right:16,top:14,width:40,height:28,background:'#1c2c48',border:'1px solid #3b6ea8',borderRadius:3}}>
                              {[6,11,16,21].map(y=>(<div key={y} style={{position:'absolute',left:3,right:3,top:y,height:1,background:'rgba(255,255,255,0.2)'}} />))}
                            </div>
                            {/* Coffee */}
                            <div style={{position:'absolute',right:66,bottom:10,width:14,height:14,borderRadius:'50%',background:'#3a1e0a',border:'2px solid #6a3c18'}}>
                              <div style={{position:'absolute',inset:3,borderRadius:'50%',background:'#6b3a18'}} />
                            </div>
                            <span style={{position:'absolute',right:10,bottom:6,fontSize:7,color:'rgba(255,255,255,0.15)',letterSpacing:'0.1em',fontWeight:700}}>CONF</span>
                          </div>
                        </div>
                      )
                    })()}

                    {/* ── ORCHESTRATOR DESK (right side, prominent) ── */}
                    {(()=>{
                      const agent=ALL_AGENTS.find(a=>a.id==='main')
                      if(!agent) return null
                      const isH=hoverDesk==='main'
                      const DX=680, DY=60, DW=120, DH=80
                      return (
                        <div style={{position:'absolute',left:DX,top:DY,cursor:'pointer'}}
                          onMouseEnter={()=>setHoverDesk('main')}
                          onMouseLeave={()=>setHoverDesk(null)}>
                          {/* Chat bubble */}
                          {isH&&(
                            <div style={{position:'absolute',bottom:DH+12,left:'50%',transform:'translateX(-50%)',whiteSpace:'nowrap',zIndex:20}}>
                              <div style={{padding:'4px 8px',borderRadius:8,border:'1px solid #444',background:'#1e1e1e',color:'#ddd',fontSize:10}}>{act('main')}</div>
                              <div style={{width:8,height:8,background:'#1e1e1e',border:'1px solid #444',borderTop:'none',borderLeft:'none',transform:'rotate(45deg)',margin:'-4px auto 0'}} />
                            </div>
                          )}
                          {/* Sprite above desk */}
                          <div className="anim-float" style={{position:'absolute',left:'50%',transform:'translateX(-50%)',top:-30,animationDelay:'0s'}}>
                            <div style={{position:'absolute',left:'50%',top:'100%',transform:'translateX(-50%)',width:16,height:4,borderRadius:'50%',background:'rgba(0,0,0,0.45)'}} />
                            {/* Body */}
                            <div style={{position:'relative',width:24,height:24,borderRadius:'50%',background:agent.color,border:'3px solid '+agent.color+'cc'}}>
                              {/* Hair */}
                              <div style={{position:'absolute',left:3,top:0,width:18,height:8,borderRadius:'50% 50% 0 0',background:agent.color,filter:'brightness(0.7)'}} />
                              {/* Eyes */}
                              <div style={{position:'absolute',left:6,top:9,width:4,height:4,borderRadius:'50%',background:'#0a0a0a'}} />
                              <div style={{position:'absolute',left:14,top:9,width:4,height:4,borderRadius:'50%',background:'#0a0a0a'}} />
                              {/* Smile */}
                              <div style={{position:'absolute',left:7,top:15,width:10,height:4,borderRadius:'0 0 6px 6px',borderBottom:'2px solid #0a0a0a',borderLeft:'1px solid #0a0a0a',borderRight:'1px solid #0a0a0a'}} />
                            </div>
                          </div>
                          {/* Name badge */}
                          <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',top:-46,whiteSpace:'nowrap'}}>
                            <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:4,background:agent.color+'30',color:agent.color,border:'1px solid '+agent.color+'60'}}>★ {agent.name}</span>
                          </div>
                          {/* Desk — L-shaped via two rects */}
                          <div style={{position:'relative',width:DW,height:DH,background:'#4a3418',border:'2px solid #8a6030',borderRadius:6}}>
                            {/* L-shape accent */}
                            <div style={{position:'absolute',right:0,top:0,width:36,height:36,background:'#5a3e20',borderLeft:'1px solid #8a6030',borderBottom:'1px solid #8a6030',borderRadius:'0 5px 0 0'}} />
                            {/* Monitor (large, face-up) */}
                            <div style={{position:'absolute',left:8,top:8,width:58,height:40,background:'#1a2e50',border:'2px solid #3b82f6',borderRadius:3}}>
                              <div style={{position:'absolute',top:2,left:2,right:2,height:2,background:'rgba(59,130,246,0.4)',borderRadius:1}} />
                              {[8,13,18,23,28].map((y,i)=>(
                                <div key={i} style={{position:'absolute',left:4,top:y,width:[80,60,90,50,70][i]+'%',height:2,background:'rgba(255,255,255,0.2)',borderRadius:1}} />
                              ))}
                              <div style={{position:'absolute',left:4,top:34,width:14,height:2,background:blink?agent.color:'transparent',borderRadius:1}} />
                            </div>
                            {/* Keyboard */}
                            <div style={{position:'absolute',left:8,bottom:8,width:40,height:14,background:'#252525',border:'1px solid #444',borderRadius:3}}>
                              {[0,1,2].map(r=>(<div key={r} style={{display:'flex',gap:2,padding:'2px 2px 0'}}>
                                {[0,1,2,3,4].map(cc=>(<div key={cc} style={{flex:1,height:3,background:'#4a4a4a',borderRadius:1}} />))}
                              </div>))}
                            </div>
                            {/* Star */}
                            <span style={{position:'absolute',right:6,bottom:6,fontSize:14,opacity:0.7}}>⭐</span>
                          </div>
                        </div>
                      )
                    })()}

                    {/* ── WORKER DESKS (center grid) ── */}
                    {[
                      {id:'builder', gx:0},
                      {id:'scout',   gx:1},
                    ].map(({id,gx})=>{
                      const agent=ALL_AGENTS.find(a=>a.id===id)
                      if(!agent) return null
                      const sc={builder:'#1a2a50',scout:'#2a1450'} as Record<string,string>
                      const DW=100, DH=68
                      const DX=260+gx*130, DY=68
                      const isH=hoverDesk===id
                      return (
                        <div key={id} style={{position:'absolute',left:DX,top:DY,cursor:'pointer'}}
                          onMouseEnter={()=>setHoverDesk(id)}
                          onMouseLeave={()=>setHoverDesk(null)}>
                          {isH&&(
                            <div style={{position:'absolute',bottom:DH+12,left:'50%',transform:'translateX(-50%)',whiteSpace:'nowrap',zIndex:20}}>
                              <div style={{padding:'4px 8px',borderRadius:8,border:'1px solid #444',background:'#1e1e1e',color:'#ddd',fontSize:10}}>{act(id)}</div>
                              <div style={{width:8,height:8,background:'#1e1e1e',border:'1px solid #444',borderTop:'none',borderLeft:'none',transform:'rotate(45deg)',margin:'-4px auto 0'}} />
                            </div>
                          )}
                          {/* Sprite */}
                          <div className="anim-float" style={{position:'absolute',left:'50%',transform:'translateX(-50%)',top:-30,animationDelay:gx*0.6+'s'}}>
                            <div style={{position:'absolute',left:'50%',top:'100%',transform:'translateX(-50%)',width:14,height:3,borderRadius:'50%',background:'rgba(0,0,0,0.4)'}} />
                            <div style={{position:'relative',width:22,height:22,borderRadius:'50%',background:agent.color,border:'3px solid '+agent.color+'cc'}}>
                              <div style={{position:'absolute',left:3,top:0,width:16,height:7,borderRadius:'50% 50% 0 0',background:agent.color,filter:'brightness(0.65)'}} />
                              <div style={{position:'absolute',left:5,top:8,width:4,height:4,borderRadius:'50%',background:'#0a0a0a'}} />
                              <div style={{position:'absolute',left:13,top:8,width:4,height:4,borderRadius:'50%',background:'#0a0a0a'}} />
                              <div style={{position:'absolute',left:6,top:14,width:9,height:3,borderRadius:'0 0 5px 5px',borderBottom:'2px solid #0a0a0a',borderLeft:'1px solid #0a0a0a',borderRight:'1px solid #0a0a0a'}} />
                            </div>
                          </div>
                          {/* Name */}
                          <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',top:-46,whiteSpace:'nowrap'}}>
                            <span style={{fontSize:9,fontWeight:700,padding:'2px 5px',borderRadius:4,background:agent.color+'25',color:agent.color,border:'1px solid '+agent.color+'50'}}>{agent.emoji} {agent.name}</span>
                          </div>
                          {/* Desk */}
                          <div style={{width:DW,height:DH,background:'#3e2c14',border:'2px solid #6a4a22',borderRadius:5,position:'relative'}}>
                            {/* Monitor face-up */}
                            <div style={{position:'absolute',left:8,top:8,width:50,height:34,background:sc[id],border:'2px solid '+agent.color+'90',borderRadius:3}}>
                              {[7,12,17,22,27].map((y,i)=>(
                                <div key={i} style={{position:'absolute',left:3,top:y,width:[70,45,80,55,65][i]+'%',height:2,background:'rgba(255,255,255,0.2)',borderRadius:1}} />
                              ))}
                              <div style={{position:'absolute',left:3,top:28,width:10,height:2,background:blink?agent.color:'transparent',borderRadius:1}} />
                            </div>
                            {/* Keyboard */}
                            <div style={{position:'absolute',right:8,top:10,width:30,height:18,background:'#222',border:'1px solid #3a3a3a',borderRadius:3}}>
                              {[0,1,2].map(r=>(<div key={r} style={{display:'flex',gap:1,padding:'2px 2px 0'}}>
                                {[0,1,2,3].map(cc=>(<div key={cc} style={{flex:1,height:3,background:'#444',borderRadius:1}} />))}
                              </div>))}
                            </div>
                            {/* Mouse */}
                            <div style={{position:'absolute',right:8,bottom:8,width:12,height:18,borderRadius:'6px 6px 5px 5px',background:'#2a2a2a',border:'1px solid #444'}}>
                              <div style={{position:'absolute',top:5,left:'50%',transform:'translateX(-50%)',width:1,height:6,background:'#555'}} />
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Empty desk slot */}
                    <div style={{position:'absolute',left:520,top:68,width:100,height:68,background:'#2a1e0a',border:'1px dashed #4a3218',borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <span style={{fontSize:9,color:'#5a4228',fontWeight:600}}>+ desk</span>
                    </div>

                    {/* ── STANCHION ROPE ── */}
                    <div style={{position:'absolute',left:12,top:305,right:12,height:3,background:'repeating-linear-gradient(90deg,#c0392b 0px,#c0392b 14px,#7b241c 14px,#7b241c 16px)',borderRadius:2}} />
                    {[18,170,350,530,680].map((x,i)=>(
                      <div key={i}>
                        <div style={{position:'absolute',left:x,top:292,width:10,height:22,borderRadius:'5px 5px 0 0',background:'linear-gradient(180deg,#f5cc3a 0%,#c8960a 100%)',boxShadow:'0 0 6px rgba(245,204,58,0.5)'}} />
                        <div style={{position:'absolute',left:x-3,top:313,width:16,height:5,borderRadius:3,background:'#9a7008'}} />
                      </div>
                    ))}

                    {/* ── WAITLIST AGENTS ── */}
                    {playroomAgents.map((a,i)=>{
                      const positions=[130,360,590]
                      const px=positions[i]||130+i*230
                      return (
                        <div key={a.id} style={{position:'absolute',left:px,top:325,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                          {/* Queue badge */}
                          <div style={{position:'absolute',top:-4,right:-8,width:16,height:16,borderRadius:'50%',background:'#c0392b',color:'white',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10,border:'1px solid #e74c3c'}}>{i+1}</div>
                          {/* Sprite — dimmed */}
                          <div className="anim-float" style={{animationDelay:i*0.7+'s',opacity:0.65}}>
                            <div style={{position:'absolute',left:'50%',top:'100%',transform:'translateX(-50%)',width:14,height:3,borderRadius:'50%',background:'rgba(0,0,0,0.25)'}} />
                            <div style={{position:'relative',width:22,height:22,borderRadius:'50%',background:a.color+'80',border:'3px solid '+a.color+'60'}}>
                              <div style={{position:'absolute',left:3,top:0,width:16,height:7,borderRadius:'50% 50% 0 0',background:a.color+'50'}} />
                              <div style={{position:'absolute',left:5,top:8,width:3,height:3,borderRadius:'50%',background:'#222'}} />
                              <div style={{position:'absolute',left:13,top:8,width:3,height:3,borderRadius:'50%',background:'#222'}} />
                            </div>
                          </div>
                          <span style={{fontSize:10,color:a.color+'70',marginTop:2}}>zzz</span>
                          <span style={{fontSize:9,fontWeight:600,color:a.color+'80'}}>{a.emoji} {a.name}</span>
                          <span style={{fontSize:8,color:'#5a4040'}}>{a.role}</span>
                        </div>
                      )
                    })}

                    {/* ── PLANTS ── */}
                    <div className="anim-breathe" style={{position:'absolute',left:14,bottom:16,fontSize:18,opacity:0.75}}>🪴</div>
                    <div className="anim-breathe" style={{position:'absolute',right:14,bottom:16,fontSize:18,opacity:0.75,animationDelay:'1.2s'}}>🪴</div>
                    <div className="anim-breathe" style={{position:'absolute',right:14,top:22,fontSize:16,opacity:0.5,animationDelay:'0.6s'}}>🌵</div>
                    <div className="anim-breathe" style={{position:'absolute',left:14,top:22,fontSize:14,opacity:0.4,animationDelay:'1.8s'}}>🌿</div>

                    {/* Watermark */}
                    <span style={{position:'absolute',bottom:14,right:20,fontSize:8,letterSpacing:'0.15em',color:'rgba(255,255,255,0.05)',fontFamily:'monospace',fontWeight:700}}>NABIT LLC</span>
                  </div>
                </div>

                {/* ── LIVE FEED ── */}
                <div className="w-60 shrink-0 rounded-2xl border border-zinc-800/60 flex flex-col" style={{background:'#0f0f0f'}}>
                  <div className="px-4 py-2.5 border-b border-zinc-800/40 flex items-center gap-2">
                    <Dot status="active" sm />
                    <p className="text-zinc-400 text-xs font-semibold">Live Activity</p>
                  </div>
                  <div className="flex-1 p-3 space-y-2 overflow-hidden">
                    {feed.map((entry,i)=>{
                      const agent=ALL_AGENTS.find(a=>a.id===entry.agentId)
                      if(!agent) return null
                      return (
                        <div key={i} className="rounded-lg p-2.5 border border-zinc-800/40" style={{background:'#141414'}}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm">{agent.emoji}</span>
                            <span className="text-xs font-medium" style={{color:agent.color}}>{agent.name}</span>
                            <span className="ml-auto text-[9px] text-zinc-600">{entry.ago}m ago</span>
                          </div>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                            style={{background:ACTION_COLORS[entry.action]+'20',color:ACTION_COLORS[entry.action]}}>
                            {entry.action}
                          </span>
                          <p className="text-zinc-500 text-[10px] leading-relaxed mt-1">{entry.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* STATUS CARDS */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <SH icon="👥">On The Floor</SH>
                  <div className="grid grid-cols-3 gap-2">
                    {floorAgents.map(a=>(
                      <div key={a.id} className="rounded-xl p-3 border card-glow" style={{background:'#0f0f0f',borderColor:a.color+'25'}}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span>{a.emoji}</span>
                            <div>
                              <p className="text-white text-xs font-semibold leading-tight">{a.name}</p>
                              <p className="text-[9px]" style={{color:a.color}}>{a.role}</p>
                            </div>
                          </div>
                          <Dot status={a.status} />
                        </div>
                        <p className="text-zinc-600 text-[9px] italic mb-1">{act(a.id)}</p>
                        <span className="text-zinc-700 text-[9px] font-mono">{a.modelShort}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <SH icon="⏳">Waitlist</SH>
                  <div className="grid grid-cols-3 gap-2">
                    {playroomAgents.map((a,i)=>(
                      <div key={a.id} className="rounded-xl p-3 border border-dashed" style={{background:'#0d0d0d',borderColor:a.color+'20'}}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div style={{width:16,height:16,borderRadius:'50%',background:'#c0392b',color:'white',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{i+1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-zinc-400 text-xs font-semibold truncate">{a.emoji} {a.name}</p>
                            <p className="text-zinc-600 text-[9px]">{a.role}</p>
                          </div>
                          <span className="text-[8px] px-1 py-0.5 rounded border border-dashed shrink-0" style={{color:a.color+'70',borderColor:a.color+'30'}}>planned</span>
                        </div>
                        <p className="text-zinc-700 text-[9px] font-mono mb-1">{a.modelShort}</p>
                        <p className="text-zinc-600 text-[9px] leading-relaxed"><span className="text-zinc-700">When: </span>{(a as any).activatesWhen}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ── MEMORY ── */}
          {tab==='memory' && (
            <div className="flex gap-0 h-[calc(100vh-88px)] -mx-6 -my-5">

              {/* Left panel */}
              <div className={`${openMem ? 'hidden md:flex' : 'flex'} w-full md:w-64 shrink-0 border-r border-zinc-800/60 flex-col overflow-hidden`} style={{background:'#0d0d0d'}}>
                {/* Search */}
                <div className="px-3 py-3 border-b border-zinc-800/40">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/60" style={{background:'#111'}}>
                    <svg className="w-3 h-3 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="text-zinc-600 text-xs">Search memory...</span>
                  </div>
                </div>

                {/* Long-Term Memory card */}
                <div className="px-3 py-2.5 border-b border-zinc-800/40 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm"
                    style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)'}}>
                    🧠
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold">Long-Term Memory</p>
                    <p className="text-zinc-600 text-[10px]">MEMORY.md · updated daily</p>
                  </div>
                </div>

                {/* DAILY JOURNAL header */}
                <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                  <span className="text-zinc-500 text-[10px] font-semibold uppercase tracking-widest">Daily Journal</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{background:'#3b82f620',color:'#3b82f6'}}>
                    {memFiles.length} entries
                  </span>
                </div>

                {/* File list */}
                <div className="flex-1 overflow-y-auto">
                  {memFiles.length===0 ? (
                    <p className="text-zinc-700 text-xs px-4 py-3">No memory files yet.</p>
                  ) : (
                    (['today','yesterday','week','month','older'] as const).map(group => {
                      const grouped = (memFiles as any[]).filter(f=>f.group===group)
                      if(!grouped.length) return null
                      const labels: Record<string,string> = {
                        today:'Today', yesterday:'Yesterday',
                        week:'This Week', month:'This Month', older:'Older'
                      }
                      const isCompact = group==='month'||group==='older'
                      return (
                        <div key={group} className="mb-0.5">
                          {/* Group header */}
                          <div className="flex items-center gap-2 px-4 py-1.5">
                            <svg className="w-3 h-3 text-zinc-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isCompact ? "M9 5l7 7-7 7" : "M19 9l-7 7-7-7"} />
                            </svg>
                            <span className="text-zinc-600 text-[10px] font-semibold uppercase tracking-wider">
                              {labels[group]}
                            </span>
                            <span className="text-zinc-700 text-[10px]">({grouped.length})</span>
                          </div>
                          {/* Files */}
                          {!isCompact && grouped.map((f:any)=>(
                            <button key={f.filename}
                              onClick={()=>setOpenMem(openMem===f.filename?null:f.filename)}
                              className={'w-full text-left px-4 py-2 border-l-2 transition-all '+(
                                openMem===f.filename
                                  ? 'border-l-indigo-500 bg-zinc-800/70'
                                  : 'border-l-transparent hover:bg-zinc-900/50 hover:border-l-zinc-700'
                              )}>
                              <div className="flex items-center gap-2">
                                {/* Calendar icon */}
                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                  style={{color: openMem===f.filename ? '#818cf8' : '#52525b'}}>
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2"/>
                                  <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2"/>
                                  <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2"/>
                                  <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2"/>
                                </svg>
                                <span className={'text-xs font-medium '+(openMem===f.filename?'text-white':'text-zinc-400')}>
                                  {f.label}
                                </span>
                              </div>
                              <p className="text-zinc-600 text-[10px] mt-0.5 pl-5">{f.kb} KB · {f.words} words</p>
                            </button>
                          ))}
                          {isCompact && grouped.length>0 && (
                            <p className="text-zinc-700 text-[10px] px-4 pb-1.5">
                              {grouped.length} file{grouped.length>1?'s':''} — click to expand
                            </p>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right panel: journal view */}
              <div className={`${openMem ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`} style={{background:'#0a0a0a'}}>
              {openMem && <button onClick={()=>setOpenMem(null)} className="md:hidden shrink-0 flex items-center gap-2 px-4 py-3 border-b border-zinc-800/40 text-zinc-400 text-xs hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                Back to list
              </button>}
              <div className="flex-1 overflow-y-auto">
                {!openMem ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
                        style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)'}}>🧠</div>
                      <p className="text-zinc-400 text-sm font-medium">Select a journal entry</p>
                      <p className="text-zinc-700 text-xs mt-1">Session logs appear on the left</p>
                    </div>
                  </div>
                ) : (()=>{
                  const file = (memFiles as any[]).find(f=>f.filename===openMem)
                  if(!file) return null
                  const fullDate = new Date(file.date+'T12:00:00').toLocaleDateString('en-US',{
                    weekday:'long', year:'numeric', month:'long', day:'numeric'
                  })
                  return (
                    <div className="px-8 py-7 max-w-3xl">
                      {/* Header */}
                      <div className="mb-7 pb-5 border-b border-zinc-800/50">
                        <p className="text-indigo-400 text-xs font-semibold uppercase tracking-widest mb-1">Daily Journal</p>
                        <h1 className="text-white text-xl font-bold mb-1">
                          Journal: <span className="text-zinc-300 font-medium">{file.date}</span>
                        </h1>
                        <p className="text-zinc-500 text-sm">
                          {fullDate} &nbsp;·&nbsp; {file.kb} KB &nbsp;·&nbsp; {file.words} words
                        </p>
                      </div>

                      {/* Entries */}
                      <div className="space-y-10">
                        {file.entries.map((entry:any, i:number)=>(
                          <div key={i} className="flex gap-4">
                            {/* Left: colored dot + line */}
                            <div className="flex flex-col items-center pt-1 shrink-0">
                              <div className="w-3 h-3 rounded-full shrink-0"
                                style={{background: i%3===0?'#6366f1':i%3===1?'#8b5cf6':'#a78bfa',
                                  boxShadow:'0 0 0 3px '+(i%3===0?'#6366f120':i%3===1?'#8b5cf620':'#a78bfa20')}} />
                              {i < file.entries.length-1 && (
                                <div className="w-px flex-1 mt-2" style={{background:'#1e1e2e',minHeight:'40px'}} />
                              )}
                            </div>
                            {/* Right: content */}
                            <div className="flex-1 pb-2">
                              <h2 className="text-base font-semibold mb-3" style={{color:'#a5b4fc'}}>
                                {entry.title}
                              </h2>
                              {entry.bullets.length>0 ? (
                                <div className="space-y-2">
                                  {entry.bullets.map((b:string,j:number)=>{
                                    const colonIdx = b.indexOf(':')
                                    const hasLabel = colonIdx>0 && colonIdx<40
                                    return (
                                      <div key={j} className="flex gap-2">
                                        <span className="text-zinc-700 mt-1.5 shrink-0">·</span>
                                        <p className="text-zinc-300 text-sm leading-relaxed">
                                          {hasLabel ? (
                                            <>
                                              <span className="text-white font-semibold">{b.slice(0,colonIdx)}</span>
                                              <span className="text-zinc-400">{b.slice(colonIdx)}</span>
                                            </>
                                          ) : b}
                                        </p>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className="text-zinc-400 text-sm leading-relaxed">{entry.body.slice(0,400)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>{/* end inner scroll div */}
              </div>{/* end right panel */}
            </div>
          )}

          {/* ── BOARD ── */}
          {tab==='board' && (
            <KanbanBoard />
          )}

          {/* ── AUTOMATIONS (n8n embed) ── */}
          {tab==='automations' && (
            <div className="h-full flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Automations</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">n8n workflow editor — build and manage automations</p>
                </div>
                <a href="https://n8n.nabit.work" target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg transition-colors">
                  Open in new tab ↗
                </a>
              </div>
              <div className="flex-1 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900" style={{minHeight:'600px'}}>
                <iframe
                  src="https://n8n.nabit.work"
                  className="w-full h-full"
                  style={{minHeight:'600px', border:'none'}}
                  title="n8n Workflow Editor"
                  allow="same-origin"
                />
              </div>
            </div>
          )}

          {/* ── CHAT ── */}
          {tab==='chat' && (
            <ChatTab />
          )}

          {/* ── INFRA ── */}
          {tab==='infra' && (()=>{
            const ls = liveStatus
            const orRemaining = ls?.openrouter?.remaining ?? 9.57
            const orLimit = ls?.openrouter?.limit ?? 10
            const orUsed = ls?.openrouter?.used ?? 0.43
            const orPct = orLimit > 0 ? Math.min(100, Math.round((orUsed / orLimit) * 100)) : 0
            const ollamaOk = ls?.ollama?.running ?? true
            const ollamaModels = ls?.ollama?.models ?? ['gemma3:4b']
            const n8nOk = ls?.n8n?.running ?? true
            const n8nWf = ls?.n8n?.activeWorkflows ?? '?'
            const n8nTotal = ls?.n8n?.totalWorkflows ?? '?'
            const vercelStatus = ls?.vercel?.lastDeploy?.status?.toUpperCase() ?? 'READY'
            const vercelSt = vercelStatus === 'READY' ? 'ok' : vercelStatus === 'ERROR' ? 'warn' : vercelStatus === 'BUILDING' ? 'scheduled' : 'ok'
            const oc = ls?.openclaw
            const ocVersion = oc?.version ?? '2026.3.23-2'
            const ocUpToDate = oc?.upToDate ?? true
            const tgOk = ls?.channels?.telegram ?? true
            const dsOk = ls?.channels?.discord ?? true
            const usageCost = ls?.usage?.totalCost ?? 0
            const usageTokens = ls?.usage?.totalTokens ?? 0
            const usageByModel: Record<string,number> = ls?.usage?.byModel ?? {}
            const todayCost = ls?.usage?.todayCost ?? 0
            const todayTokens = ls?.usage?.todayTokens ?? 0
            const heartbeats: any[] = ls?.heartbeats ?? []

            const liveInfra = [
              { name:'OpenClaw',     note: `v${ocVersion}${ocUpToDate ? ' ✓ up to date' : ' ⚠ update available'}`, status: ocUpToDate ? 'ok' : 'warn' },
              { name:'Claude Max',   note:'OAuth · sonnet-4-6 + haiku-4-5', status:'ok' },
              { name:'OpenRouter',   note:`$${orRemaining.toFixed(2)} / $${orLimit.toFixed(2)} remaining`, status: orRemaining < 1 ? 'warn' : 'ok' },
              { name:'Telegram',     note: tgOk ? '@KemuniClaw1Bot · connected' : 'Disconnected', status: tgOk ? 'ok' : 'warn' },
              { name:'Discord',      note: dsOk ? 'Kemuni Server · connected' : 'Disconnected', status: dsOk ? 'ok' : 'warn' },
              { name:'n8n',          note: n8nOk ? `:5678 · ${n8nWf}/${n8nTotal} active` : 'Offline', status: n8nOk ? 'ok' : 'warn' },
              { name:'Ollama',       note: ollamaOk ? ollamaModels.join(', ') : 'Offline', status: ollamaOk ? 'ok' : 'warn' },
              { name:'Vercel',       note: ls?.vercel ? `vespera-nabit · ${vercelStatus}` : 'Pro · nabit.app', status: vercelSt },
              { name:'Supabase',     note:'Kemuni Agent HQ · Vespera + Agent Brain', status:'ok' },
              { name:'GitHub',       note:'nabitllc org · kemuniagent@gmail.com',    status:'ok' },
              { name:'Brave Search', note:'API · renews Apr 21',                     status:'ok' },
              { name:'Cloudflare',   note:'Tunnel active · trycloudflare.com',       status:'ok' },
            ]

            return (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <SH icon="🔌">Services</SH>
                <div className="flex items-center gap-3 mb-4">
                  {ls && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-zinc-700 text-[10px]">Updated {agoSec}s ago</span></>}
                  {!ls && <span className="text-yellow-600 text-[10px]">Loading…</span>}
                  <span className="text-zinc-700 text-[10px] font-mono tabular-nums" title="Auto-refresh countdown">↻ {statusCountdown}s</span>
                  <button onClick={()=>{fetchStatus();setStatusCountdown(30)}} className="text-zinc-600 hover:text-zinc-400 text-[10px] border border-zinc-800 rounded px-2 py-0.5 transition-colors">Refresh</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {liveInfra.map(svc=>(
                  <div key={svc.name} className="rounded-xl p-4 border border-zinc-800/60 flex items-start gap-3 card-glow" style={{background:'#0f0f0f'}}>
                    <Dot status={svc.status} />
                    <div>
                      <p className="text-white text-sm font-medium">{svc.name}</p>
                      <p className="text-zinc-600 text-xs mt-0.5">{svc.note}</p>
                    </div>
                  </div>
                ))}
              </div>

              <SH icon="💬">Heartbeat Schedule</SH>
              <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                {(heartbeats.length > 0 ? heartbeats : [
                  {agentId:'main', enabled:true, every:'4h'},
                  {agentId:'scout', enabled:false, every:'disabled'},
                  {agentId:'ops', enabled:false, every:'disabled'},
                  {agentId:'kemuni-sme', enabled:false, every:'disabled'},
                  {agentId:'vespera-sme', enabled:false, every:'disabled'},
                ]).map((hb:any, i:number, arr:any[])=>(
                  <div key={hb.agentId} className={'flex items-center gap-4 px-5 py-3 '+(i<arr.length-1?'border-b border-zinc-800/40':'')}>
                    <Dot status={hb.enabled ? 'active' : 'planned'} />
                    <span className="font-mono text-xs text-white w-32 shrink-0">{hb.agentId}</span>
                    <span className="text-zinc-500 text-xs flex-1">{hb.enabled ? `every ${hb.every}` : 'disabled'}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border" style={hb.enabled
                      ? {color:'#10b981',borderColor:'#10b98140',background:'#10b98115'}
                      : {color:'#52525b',borderColor:'#27272a',background:'#18181b'}}>
                      {hb.enabled ? 'active' : 'off'}
                    </span>
                  </div>
                ))}
              </div>

              <SH icon="📊">Token Usage</SH>
              <div className="rounded-2xl border border-zinc-800/60 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-end justify-between mb-4">
                  <div className="flex items-baseline gap-6">
                    <div>
                      <p className="text-zinc-500 text-[10px] mb-1 uppercase tracking-wider">Today</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">${todayCost.toFixed(2)}</span>
                        <span className="text-zinc-600 text-xs">{(todayTokens/1000).toFixed(0)}k tok</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-[10px] mb-1 uppercase tracking-wider">All-time</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">${usageCost.toFixed(2)}</span>
                        <span className="text-zinc-600 text-xs">{(usageTokens/1000).toFixed(0)}k tok</span>
                      </div>
                    </div>
                  </div>
                  {ls && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg" title="Live"/>}
                </div>
                <div className="space-y-2">
                  {Object.entries(usageByModel).sort((a,b)=>b[1]-a[1]).map(([model, cost])=>{
                    const pct = usageCost > 0 ? Math.round((cost/usageCost)*100) : 0
                    return (
                      <div key={model}>
                        <div className="flex justify-between mb-1">
                          <span className="text-zinc-400 text-xs font-mono">{model.split('/').pop()}</span>
                          <span className="text-zinc-500 text-xs">${(cost as number).toFixed(3)} ({pct}%)</span>
                        </div>
                        <Bar v={pct} color={model.includes('haiku')?'#a855f7':'#3b82f6'} bg="#1a1a2a"/>
                      </div>
                    )
                  })}
                  {Object.keys(usageByModel).length === 0 && <p className="text-zinc-700 text-xs">No session data yet</p>}
                </div>
              </div>

              <SH icon="🖥">Hardware</SH>
              <div className="rounded-2xl border border-zinc-800/60 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-start gap-4">
                  <span className="text-3xl">🖥️</span>
                  <div>
                    <p className="text-white font-medium text-sm">Mac mini · Apple Silicon · 8GB · arm64</p>
                    <p className="text-zinc-500 text-xs mt-0.5">Dedicated OpenClaw machine · macOS 26.3.1 · Node 22.22.1</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['OpenClaw :18789','n8n :5678','Ollama :11434','Mission Control :3000','Cloudflare Tunnel'].map(l=><Chip key={l} label={l}/>)}
                    </div>
                  </div>
                </div>
              </div>

              <SH icon="💳">OpenRouter Balance</SH>
              <div className="rounded-2xl border border-zinc-800/60 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-zinc-500 text-xs mb-1">Monthly credit</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-white">${orRemaining.toFixed(2)}</span>
                      <span className="text-zinc-600 text-sm">/ ${orLimit.toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="text-zinc-600 text-xs">${orUsed.toFixed(3)} used · resets monthly</p>
                </div>
                <Bar v={orPct} color="#3b82f6" bg="#1a1a2a" />
                <p className="text-zinc-700 text-xs mt-2">Daily billing report via n8n → Telegram</p>
              </div>
            </div>
            )
          })()}

        </main>
      </div>
    </div>
  )
}
