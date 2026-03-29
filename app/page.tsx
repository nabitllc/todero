'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AgentOffice from '@/components/AgentOffice'
import { LayoutDashboard, Activity, Users, CalendarDays, Building2, Brain, Kanban, Zap, MessageSquare, Server, Map, Search, List } from 'lucide-react'
import FeaturesTab from '@/components/tabs/FeaturesTab'
import PipelineTab from '@/components/tabs/PipelineTab'
import IssuesTab from '@/components/tabs/IssuesTab'

const KEMUNI_START     = new Date('2026-03-21')
const KEMUNI_DEADLINE  = new Date('2026-04-20')
const VESPERA_DEADLINE = new Date('2026-03-31')
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

const LUCIDE_ICONS: Record<string, any> = {
  overview: LayoutDashboard, activity: Activity, team: Users, calendar: CalendarDays,
  office: Building2, memory: Brain, board: Kanban, features: Map, issues: List, automations: Zap, chat: MessageSquare, infra: Server,
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
  { id:'divider' as any, label:'',           icon:'' },
  { id:'automations',  label:'Automations',  icon:'⚡' },
  { id:'chat',         label:'Chat',         icon:'💬' },
  { id:'infra',        label:'Infra',        icon:'⚙️' },
] as const
type Tab = typeof NAV[number]['id']

// Chat types
interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; model?: string; ts?: number; attachments?: string[]; image_url?: string; bookmarked?: boolean }
interface ChatConversation { id: string; title: string; model: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; pinned?: boolean; project?: string|null; agent_id?: string; system_prompt?: string|null; forked_from?: string|null }

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
    : status==='error' ? 'bg-red-500'
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

function AttentionAndShipped({agents}:{agents:any[]}) {
  const [data, setData] = React.useState<{attention:any[];shipped:any[]}>({attention:[],shipped:[]})
  React.useEffect(()=>{
    const today = new Date().toISOString().slice(0,10)
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    Promise.all([
      fetch(`${SUPA}/rest/v1/issues?priority=eq.critical&status=in.(open,backlog)&select=task_key,title,project,assignee&limit=5`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}}).then(r=>r.json()),
      fetch(`${SUPA}/rest/v1/issues?status=eq.done&updated_at=gte.${today}T00:00:00&limit=10&order=updated_at.desc`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}}).then(r=>r.json()),
    ]).then(([attn, ship])=>{
      const idleAgents = (agents||[]).filter((a:any)=>a.ago>1440&&['ops','deployer','main'].includes(a.id))
        .map((a:any)=>({title:`${a.name} idle ${Math.floor(a.ago/60)}h`,project:'agent'}))
      setData({attention:[...(Array.isArray(attn)?attn:[]),...idleAgents], shipped:Array.isArray(ship)?ship:[]})
    }).catch(()=>{})
  },[])
  return (
    <div className="space-y-5">
      <div>
        <SH icon="🚨">Needs Attention</SH>
        <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
          {data.attention.length===0
            ? <div className="px-4 py-4 flex items-center gap-2 text-emerald-400 text-sm"><span>🟢</span><span>All clear</span></div>
            : data.attention.slice(0,5).map((t:any,i:number,arr:any[])=>(
              <div key={i} className={'flex items-center gap-3 px-4 py-3 border-l-2 border-red-800 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                <span className="text-xs">🔴</span>
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  {t.task_key && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">{t.task_key}</span>}
                  <p className="text-white text-xs truncate">{t.title}</p>
                  {t.project && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{background:'#ffffff10',color:'#a1a1aa',border:'1px solid #27272a'}}>{t.project}</span>}
                </div>
              </div>
            ))
          }
        </div>
      </div>
      {data.shipped.length>0&&(
        <div>
          <SH icon="✅" sub={`${data.shipped.length} tasks`}>Shipped Today</SH>
          <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
            {data.shipped.map((t:any,i:number,arr:any[])=>(
              <div key={t.id||i} className={'flex items-center gap-3 px-4 py-2.5 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                <span className="text-emerald-500 text-xs">✓</span>
                <p className="text-zinc-300 text-xs truncate flex-1">{t.title}</p>
                <span className="text-zinc-600 text-[10px] shrink-0">{t.project}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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

const EmptyState = ({icon, message, action}: {icon:string, message:string, action?:string}) => (
  <div className='flex flex-col items-center justify-center py-16 text-zinc-500'>
    <span className='text-4xl mb-3'>{icon}</span>
    <p className='text-sm'>{message}</p>
    {action && <button className='mt-3 text-xs text-zinc-400 border border-zinc-700 px-3 py-1 rounded hover:bg-zinc-800'>{action}</button>}
  </div>
)

// ── Chat Component ────────────────────────────────────────────────────────
function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        code: ({ inline, children, className }: any) =>
          inline
            ? <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 text-[11px] font-mono">{children}</code>
            : <CodeBlock className={className}>{children}</CodeBlock>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-zinc-400">{children}</em>,
        h1: ({ children }) => <h1 className="text-base font-bold text-white mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-white mb-1.5 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-200 mb-1 mt-2">{children}</h3>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{children}</a>,
        hr: () => <hr className="border-zinc-700 my-3" />,
        table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-sm border-collapse">{children}</table></div>,
        thead: ({ children }) => <thead className="border-b border-zinc-700">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-zinc-800 hover:bg-zinc-800/30 transition-colors">{children}</tr>,
        th: ({ children }) => <th className="text-left px-3 py-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">{children}</th>,
        td: ({ children }) => <td className="px-3 py-1.5 text-xs text-zinc-300">{children}</td>,
      }}>
      {content}
    </ReactMarkdown>
  )
}

function groupChatsByDate(chats: ChatConversation[]): { label: string; items: ChatConversation[]; pinned?: boolean }[] {
  const now = Date.now()
  const DAY = 86400000
  const pinned = chats.filter(c => c.pinned)
  const unpinned = chats.filter(c => !c.pinned)
  const groups: { label: string; items: ChatConversation[]; pinned?: boolean }[] = []
  if (pinned.length > 0) groups.push({ label: 'Pinned', items: pinned, pinned: true })
  const dateGroups: { label: string; items: ChatConversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const c of unpinned) {
    const age = now - c.updatedAt
    if (age < DAY) dateGroups[0].items.push(c)
    else if (age < DAY * 2) dateGroups[1].items.push(c)
    else if (age < DAY * 7) dateGroups[2].items.push(c)
    else dateGroups[3].items.push(c)
  }
  for (const g of dateGroups) if (g.items.length > 0) groups.push(g)
  return groups
}

function stripMarkdownPreview(text: string): string {
  return text
    .replace(/[*#>`\-]/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

const AGENT_MODEL_MAP: Record<string, string> = {
  'main': 'Claude Max',
  'kemuni-sme': 'Claude Max',
  'vespera-sme': 'Claude Max',
  'scout': 'Gemma 3 4B (local)',
}

// Model options available in chat (maps to OpenClaw agent or model override)
// Grouped by provider with context window sizes
const MODEL_OPTIONS: { id: string; label: string; desc: string; provider: string; ctx?: string }[] = [
  { id: 'default',                       label: '⚡ Agent default',          desc: 'Use the selected agent\'s default model', provider: 'System' },
  // Anthropic
  { id: 'anthropic/claude-sonnet-4-6',   label: '🟣 Claude Sonnet 4.6',     desc: 'Best for complex tasks',     provider: 'Anthropic', ctx: '200k' },
  { id: 'anthropic/claude-haiku-4-5',    label: '🔵 Claude Haiku 4.5',      desc: 'Fast, lightweight',          provider: 'Anthropic', ctx: '200k' },
  { id: 'anthropic/claude-opus-4-6',     label: '🔶 Claude Opus 4.6',       desc: 'Most powerful',              provider: 'Anthropic', ctx: '200k' },
  // OpenRouter
  { id: 'openrouter/auto',               label: '🔀 OpenRouter auto',        desc: 'Best available via OpenRouter', provider: 'OpenRouter' },
  { id: 'openrouter/google/gemini-2.5-pro', label: '🔷 Gemini 2.5 Pro',     desc: 'Google flagship',            provider: 'OpenRouter', ctx: '1M' },
  { id: 'openrouter/deepseek/deepseek-r1', label: '🧩 DeepSeek R1',         desc: 'Reasoning model',            provider: 'OpenRouter', ctx: '128k' },
  { id: 'openrouter/meta-llama/llama-4-maverick', label: '🦙 Llama 4 Maverick', desc: 'Open weights',          provider: 'OpenRouter', ctx: '1M' },
  { id: 'openrouter/qwen/qwen3-235b-a22b', label: '🌐 Qwen3 235B',         desc: 'MoE reasoning',              provider: 'OpenRouter', ctx: '128k' },
  // Ollama (local)
  { id: 'ollama/gemma3:4b',              label: '🟢 Gemma 3 4B',            desc: 'Private, free, offline',     provider: 'Ollama', ctx: '128k' },
]

const MODEL_PROVIDERS = Array.from(new Set(MODEL_OPTIONS.map(m => m.provider)))

// Expanded file type groups
const FILE_TYPE_GROUPS = [
  { label: 'Code',       accept: '.ts,.tsx,.js,.jsx,.mjs,.cjs,.vue,.svelte,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.cs,.php' },
  { label: 'Config',     accept: '.json,.yaml,.yml,.toml,.env,.ini,.cfg,.conf,.lock' },
  { label: 'Text / Docs', accept: '.txt,.md,.mdx,.rst,.csv,.log,.xml,.html,.css,.scss' },
  { label: 'Shell',      accept: '.sh,.bash,.zsh,.fish,.ps1,.bat,.cmd' },
  { label: 'Any text',   accept: '*' },
]

const AGENT_BADGE_MAP: Record<string, string> = {
  'main': '🧠',
  'kemuni-sme': '🚀',
  'vespera-sme': '🖤',
  'scout': '🔍',
}

const PROJECT_TAG_COLORS: Record<string, string> = {
  'Kemuni': '#3b82f6',
  'Vespera': '#a855f7',
  'Ops': '#6b7280',
  'General': '#10b981',
}
const PROJECT_CYCLE = [null, 'Kemuni', 'Vespera', 'Ops', 'General'] as const

const PROMPT_TEMPLATES = [
  { label: '🗺️ Plan a feature', text: 'Help me plan a new feature for Kemuni. The feature is: ' },
  { label: '🐛 Debug code', text: 'I have a bug in my code. Here\'s what\'s happening:\n\n' },
  { label: '📋 Write a PRD', text: 'Write a product requirements document for: ' },
  { label: '🔍 Research topic', text: 'Research and summarize the latest developments in: ' },
  { label: '✍️ Draft a message', text: 'Draft a professional message to: \n\nContext: ' },
  { label: '⚡ Optimize this', text: 'Review and optimize the following code for performance and readability:\n\n```\n\n```' },
]

// ── Syntax Highlighter ────────────────────────────────────────────────────
function highlightCode(code: string, lang: string): React.ReactNode[] {
  const supported = ['javascript','typescript','js','ts','tsx','jsx','python','py','bash','sh','css','html','json','go','rust','rs','java','sql','yaml','yml']
  if (!supported.includes(lang.toLowerCase())) {
    return [<span key="raw" style={{color:'#a8d5a2'}}>{code}</span>]
  }
  type Token = { type: 'keyword'|'string'|'comment'|'number'|'function'|'plain'; value: string }
  const tokens: Token[] = []
  let remaining = code
  let i = 0

  const KEYWORD_RE = /^(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|default|from|new|this|typeof|instanceof|void|null|undefined|true|false|async|await|try|catch|finally|throw|in|of|type|interface|enum|implements|static|public|private|protected|abstract|readonly|override|def|print|pass|lambda|with|as|and|or|not|is|elif|yield|global|nonlocal|select|from|where|insert|update|delete|create|table|index|join|on|group|by|order|having|limit|func|struct|package|var|map|chan|go|defer|range|make|append|len|cap)\b/
  const FUNC_RE = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/
  const NUM_RE = /^(-?\d+\.?\d*(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+)\b/
  const STR_RE = /^(`[^`]*`|'[^'\\]*(?:\\[\s\S][^'\\]*)*'|"[^"\\]*(?:\\[\s\S][^"\\]*)*")/
  const COMMENT_RE = /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/

  while (remaining.length > 0) {
    i++
    if (i > 5000) break // guard
    let m: RegExpMatchArray|null

    m = remaining.match(COMMENT_RE)
    if (m) { tokens.push({ type: 'comment', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(STR_RE)
    if (m) { tokens.push({ type: 'string', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(KEYWORD_RE)
    if (m) { tokens.push({ type: 'keyword', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(FUNC_RE)
    if (m) { tokens.push({ type: 'function', value: m[1] }); remaining = remaining.slice(m[1].length); continue }

    m = remaining.match(NUM_RE)
    if (m) { tokens.push({ type: 'number', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    tokens.push({ type: 'plain', value: remaining[0] }); remaining = remaining.slice(1)
  }

  const COLOR_MAP: Record<string, React.CSSProperties> = {
    keyword:  { color: '#79b8ff' },
    string:   { color: '#a8d5a2' },
    comment:  { color: '#6b7280', fontStyle: 'italic' },
    number:   { color: '#f97316' },
    function: { color: '#e2c08d' },
    plain:    {},
  }
  return tokens.map((t, idx) => (
    <span key={idx} style={COLOR_MAP[t.type] || {}}>{t.value}</span>
  ))
}

// ── Code Block with copy button ───────────────────────────────────────────
function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const lang = (className || '').replace('language-', '').toLowerCase() || 'text'
  const code = typeof children === 'string' ? children : String(children)
  const highlighted = highlightCode(code, lang)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="group relative my-2">
      <div className="flex items-center justify-between px-3 py-1 rounded-t-lg bg-zinc-900 border border-zinc-800 border-b-0">
        <span className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">{lang}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded transition-all text-zinc-400 hover:text-white"
          style={{ background: '#1a1a1a' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 rounded-b-lg bg-zinc-950 border border-zinc-800 overflow-x-auto">
        <code className="text-[11px] font-mono whitespace-pre">{highlighted}</code>
      </pre>
    </div>
  )
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
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [showFileTypePicker, setShowFileTypePicker] = useState(false)
  const fileTypePickerRef = useRef<HTMLDivElement>(null)
  const [sidebarFocusIdx, setSidebarFocusIdx] = useState<number>(-1)
  // Feature 1: pasted image
  const [pastedImage, setPastedImage] = useState<string|null>(null)
  // Feature 5: system prompt popover
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  // Feature 6: inline edit
  const [editingMsgId, setEditingMsgId] = useState<string|null>(null)
  const [editingMsgContent, setEditingMsgContent] = useState('')
  // Feature 7: unread
  const [unreadChat, setUnreadChat] = useState(false)
  const unreadChatRef = useRef(false)
  // Feature 9: project filter
  const [projectFilter, setProjectFilter] = useState<string|null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Feature 10: sidebar collapsed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mc-chat-sidebar-collapsed') === 'true'
    return false
  })
  // Feature 11: voice input
  const [speechAvailable, setSpeechAvailable] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const speechRecognitionRef = useRef<any>(null)
  // Feature 12: full-text search
  const [searchMode, setSearchMode] = useState<'title'|'messages'>('title')
  const [searchResults, setSearchResults] = useState<Array<{id:string;conversation_id:string;content:string;role:string;created_at:string}>>([])
  const [isSearching, setIsSearching] = useState(false)
  // Feature 13: follow-up suggestions
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([])
  // Feature 14: keyboard cheatsheet
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Feature 16: starred filter
  const [starredFilter, setStarredFilter] = useState(false)
  // Feature 18: export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const printRef = useRef(false)
  // Feature 20: session context viewer
  const [showContextViewer, setShowContextViewer] = useState(false)
  // NEW: Slash command palette
  const [showSlashPalette, setShowSlashPalette] = useState(false)
  const [slashPaletteIdx, setSlashPaletteIdx] = useState(0)
  // NEW: Tool call indicators (ephemeral, local-only)
  const [toolIndicators, setToolIndicators] = useState<Record<string, {name:string;input:string;output?:string;expanded:boolean}[]>>({})
  // NEW: Thinking/reasoning content per stream message
  const [thinkingContent, setThinkingContent] = useState<Record<string,string>>({})
  // NEW: Approval buttons state (per message id, true = used)
  const [approvalUsed, setApprovalUsed] = useState<Record<string,boolean>>({})
  // NEW: File browser modal
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState('')
  const [fileBrowserEntries, setFileBrowserEntries] = useState<{name:string;isDir:boolean;path:string}[]>([])
  // NEW: Image URL input
  const [showImageUrlInput, setShowImageUrlInput] = useState(false)
  const [imageUrlDraft, setImageUrlDraft] = useState('')
  const [imageUrlPreview, setImageUrlPreview] = useState<string|null>(null)
  // Sidebar tabs: mine / openclaw / heartbeats
  const [sidebarTab, setSidebarTab] = useState<'mine'|'openclaw'|'heartbeats'>('mine')
  const [ocSessions, setOcSessions] = useState<any[]>([])
  const [ocLoading, setOcLoading] = useState(false)
  // NEW: Send-to-agent dropdown
  const [showSendToAgent, setShowSendToAgent] = useState(false)
  const sendToAgentRef = useRef<HTMLDivElement>(null)
  // NEW: Drag-and-drop
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // NEW: Prompt templates popover
  const [showPromptTemplates, setShowPromptTemplates] = useState(false)
  const promptTemplatesRef = useRef<HTMLDivElement>(null)
  // NEW: @-mention dropdown
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
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
    { id: 'ops', label: '⚙️ Ops', desc: 'Operations Agent' },
  ]
  const currentAgent = AGENT_OPTIONS.find(a => a.id === selectedAgent) || AGENT_OPTIONS[0]

  // Slash command definitions
  const SLASH_COMMANDS = [
    { cmd: '/new',     icon: '➕', desc: 'Start a new conversation' },
    { cmd: '/clear',   icon: '🗑️', desc: 'Clear all messages in this chat' },
    { cmd: '/status',  icon: '📊', desc: 'Show session info (agent, model, messages)' },
    { cmd: '/compact', icon: '📦', desc: 'Ask AI to summarize conversation so far' },
    { cmd: '/pin',     icon: '📌', desc: 'Toggle pin on current conversation' },
    { cmd: '/export',  icon: '↓',  desc: 'Export this conversation as Markdown' },
    { cmd: '/imagine', icon: '🎨', desc: 'Generate an image: /imagine a purple cat in space' },
    { cmd: '/tasks',   icon: '📋', desc: 'Show open tasks for current sprint' },
    { cmd: '/deploy',  icon: '🚀', desc: 'Trigger a deploy or show deploy status' },
    { cmd: '/agents',  icon: '👥', desc: 'List active agents and their status' },
  ]
  const slashFilter = inputVal.startsWith('/') ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(inputVal.split(' ')[0].toLowerCase())) : SLASH_COMMANDS

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
              image_url: m.image_url || undefined,
              bookmarked: m.bookmarked || false,
            })),
            createdAt: new Date(c.created_at).getTime(),
            updatedAt: new Date(c.updated_at).getTime(),
            pinned: c.pinned || false,
            project: c.project || null,
            agent_id: c.agent_id || 'main',
            system_prompt: c.system_prompt || null,
            forked_from: c.forked_from || null,
          }))
          setChats(normalized)
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

  // Persist sidebar collapsed state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('mc-chat-sidebar-collapsed', String(sidebarCollapsed))
    }
  }, [sidebarCollapsed])

  // Feature 7: unread document title
  useEffect(() => {
    if (unreadChat) {
      document.title = '● Mission Control'
    } else {
      document.title = 'Mission Control'
    }
  }, [unreadChat])

  // Clear unread when ChatTab is mounted/visible
  useEffect(() => {
    setUnreadChat(false)
    unreadChatRef.current = false
    document.title = 'Mission Control'
  }, [])

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

  // Sync system prompt draft when active conv changes
  useEffect(() => {
    const conv = chats.find(c => c.id === activeChat)
    setSystemPromptDraft(conv?.system_prompt || '')
    setShowSystemPrompt(false)
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
          image_url: m.image_url || undefined,
          bookmarked: m.bookmarked || false,
        })),
        createdAt: new Date(conv.created_at).getTime(),
        updatedAt: new Date(conv.updated_at).getTime(),
        pinned: conv.pinned || false,
        project: conv.project || null,
        agent_id: conv.agent_id || 'main',
        system_prompt: conv.system_prompt || null,
        forked_from: conv.forked_from || null,
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

  // Feature 11: detect speech API availability
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SR) setSpeechAvailable(true)
    }
  }, [])

  // Feature 18: close export menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
      if (sendToAgentRef.current && !sendToAgentRef.current.contains(e.target as Node)) {
        setShowSendToAgent(false)
      }
      if (promptTemplatesRef.current && !promptTemplatesRef.current.contains(e.target as Node)) {
        setShowPromptTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Feature 1: paste image listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string
            setPastedImage(dataUrl)
          }
          reader.readAsDataURL(blob)
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // NEW: Load file browser entries when path changes
  useEffect(() => {
    if (!showFileBrowser) return
    fetch(`/api/files?path=${encodeURIComponent(fileBrowserPath)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setFileBrowserEntries(data) })
      .catch(() => {})
  }, [showFileBrowser, fileBrowserPath])

  // Fetch OpenClaw sessions when sidebar tab switches to openclaw/heartbeats
  useEffect(() => {
    if (sidebarTab === 'mine') return
    setOcLoading(true)
    fetch('/api/status').then(r => r.json()).then(data => {
      const activity: any[] = data.recentActivity || []
      setOcSessions(activity)
    }).catch(() => {}).finally(() => setOcLoading(false))
  }, [sidebarTab])

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
      pinned: false, project: null, agent_id: selectedAgent, system_prompt: null,
    }
    setChats([conv, ...chats])
    setActiveChat(id)
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: 'New Chat', model: 'kaos', agent_id: selectedAgent }),
    })
  }

  // NEW: Clear all messages in active conversation
  const clearChat = async (convId: string) => {
    await fetch(`/api/chat/messages?conversation_id=${convId}&clear=true`, { method: 'DELETE' })
    setChats(prev => prev.map(c => c.id === convId ? { ...c, messages: [] } : c))
  }

  // NEW: Execute slash command
  const executeSlashCommand = async (cmd: string) => {
    setInputVal('')
    setShowSlashPalette(false)
    if (!activeConv) return
    if (cmd === '/new') {
      await newChat()
    } else if (cmd === '/clear') {
      await clearChat(activeConv.id)
    } else if (cmd === '/status') {
      const mdl = AGENT_MODEL_MAP[selectedAgent] || 'Claude Max'
      const tokEst = activeConv ? Math.round(activeConv.messages.reduce((sum, m) => sum + m.content.length, 0) / 4) : 0
      const tokLabel = tokEst >= 1000 ? `~${(tokEst/1000).toFixed(1)}k / 200k tokens` : `~${tokEst} / 200k tokens`
      const statusMsg: ChatMessage = {
        id: 'status-' + Date.now(),
        role: 'assistant',
        content: `**Session Status**\n- Session key: \`mc-chat-${activeConv.id}\`\n- Agent: ${selectedAgent} (${currentAgent.label})\n- Model: ${mdl}\n- Messages: ${activeConv.messages.length}\n- Est. tokens: ${tokLabel}\n- Pinned: ${activeConv.pinned ? 'yes' : 'no'}\n- Project: ${activeConv.project || 'none'}`,
        ts: Date.now(),
      }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, statusMsg] } : c))
    } else if (cmd === '/compact') {
      const msgId = 'msg-compact-' + Date.now()
      setInputVal('')
      await doSend('[System: Please summarize our conversation so far in a brief paragraph, then we\'ll continue from that summary]', msgId, activeConv, chats)
    } else if (cmd === '/pin') {
      await togglePin(activeConv.id, !activeConv.pinned)
    } else if (cmd === '/export') {
      exportChat(activeConv)
    } else if (cmd === '/imagine') {
      const prompt = inputVal.replace('/imagine', '').trim()
      if (!prompt) {
        const hint: ChatMessage = { id: 'hint-'+Date.now(), role:'assistant', content:'Usage: `/imagine <description>` — e.g. `/imagine a purple cat floating in space`', ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv?.id ? { ...c, messages: [...c.messages, hint] } : c))
        return
      }
      setLoading(true)
      const userMsg: ChatMessage = { id: 'img-user-'+Date.now(), role:'user', content:`🎨 /imagine ${prompt}`, ts: Date.now() }
      const placeholderId = 'img-'+Date.now()
      const placeholder: ChatMessage = { id: placeholderId, role:'assistant', content:'⏳ Generating image…', ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv?.id ? { ...c, messages: [...c.messages, userMsg, placeholder] } : c))
      try {
        const r = await fetch('/api/imagine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) })
        const d = await r.json()
        if (d.url) {
          setChats(prev => prev.map(c => c.id === activeConv?.id ? {
            ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: `![generated](${d.url})`, image_url: d.url } : m)
          } : c))
        } else {
          setChats(prev => prev.map(c => c.id === activeConv?.id ? {
            ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: `❌ Image gen failed: ${d.error||'unknown error'}` } : m)
          } : c))
        }
      } catch(e) {
        setChats(prev => prev.map(c => c.id === activeConv?.id ? {
          ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: '❌ Network error generating image' } : m)
        } : c))
      } finally {
        setLoading(false)
      }
    } else if (cmd === '/tasks') {
      try {
        const r = await fetch('/api/issues')
        const data = await r.json()
        const open = (Array.isArray(data) ? data : []).filter((i: any) => i.status === 'open' || i.status === 'in_progress')
        const lines = open.slice(0, 15).map((i: any) => `- **${i.task_key || '?'}** ${i.title} — _${i.status}_ (${i.priority || 'med'}) ${i.assignee ? `→ ${i.assignee}` : ''}`).join('\n')
        const tasksMsg: ChatMessage = { id: 'tasks-'+Date.now(), role: 'assistant', content: `**Open Tasks** (${open.length})\n\n${lines || '_No open tasks_'}`, ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, tasksMsg] } : c))
      } catch {
        const errMsg: ChatMessage = { id: 'tasks-err-'+Date.now(), role: 'assistant', content: '❌ Could not fetch tasks', ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, errMsg] } : c))
      }
    } else if (cmd === '/deploy') {
      const deployMsg: ChatMessage = { id: 'deploy-'+Date.now(), role: 'assistant', content: '**Deploy Status**\n\n- Vercel: auto-deploy on push to `main`\n- Last deploy: check [Vercel dashboard](https://vercel.com)\n- To trigger: push to main or run `vercel --prod`\n\n_Tip: Use the chat to ask KAOS to deploy._', ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, deployMsg] } : c))
    } else if (cmd === '/agents') {
      const agentLines = AGENT_OPTIONS.map(a => `- ${a.label} — ${a.desc}`).join('\n')
      const agentsMsg: ChatMessage = { id: 'agents-'+Date.now(), role: 'assistant', content: `**Active Agents**\n\n${agentLines}\n\n_Select an agent using the dropdown above the input._`, ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, agentsMsg] } : c))
    }
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

  // Feature 4: pin/unpin
  const togglePin = async (id: string, pinned: boolean) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, pinned } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pinned }),
    })
  }

  // Feature 9: set project
  const setConvProject = async (id: string, project: string|null) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, project } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, project }),
    })
  }

  // Feature 5: save system prompt
  const saveSystemPrompt = async (id: string, system_prompt: string) => {
    const val = system_prompt.trim() || null
    setChats(prev => prev.map(c => c.id === id ? { ...c, system_prompt: val } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, system_prompt: val }),
    })
  }

  const exportChat = (conv: ChatConversation) => {
    downloadConvMd(conv)
  }

  const activeConv = chats.find(c => c.id === activeChat)

  // Feature 9 + 16: filter by project and/or starred
  const projectFilteredChats = (() => {
    let result = projectFilter ? chats.filter(c => c.project === projectFilter) : chats
    if (starredFilter) {
      result = result.filter(c => c.messages.some(m => m.bookmarked))
    }
    return result
  })()

  const filteredChats = searchMode === 'messages'
    ? chats.filter(c => searchResults.some(r => r.conversation_id === c.id))
    : projectFilteredChats.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase())
      )

  // Feature 15: context budget
  const contextTokenEstimate = activeConv
    ? Math.round(activeConv.messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
    : 0
  const contextTokenColor = contextTokenEstimate > 150000 ? 'text-red-500' : contextTokenEstimate > 50000 ? 'text-yellow-500' : 'text-zinc-600'
  const contextTokenLabel = contextTokenEstimate >= 1000
    ? `~${(contextTokenEstimate / 1000).toFixed(1)}k / 200k tokens`
    : `~${contextTokenEstimate} / 200k tokens`

  // Cmd+K / arrow-key nav wired up after helpers defined (see below)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        newChat()
        return
      }
      // Feature 14: ⌘/ focus input
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        textareaRef.current?.focus()
        return
      }
      // Feature 14: Esc to close panels
      if (e.key === 'Escape') {
        setShowShortcuts(false)
        setShowContextViewer(false)
        setShowExportMenu(false)
        setShowSlashPalette(false)
        setShowFileBrowser(false)
        setShowSendToAgent(false)
        setShowMentionDropdown(false)
        setShowPromptTemplates(false)
        return
      }
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
        image_url: msg.image_url || null,
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

  const doSend = async (msgContent: string, msgId: string, convToUse: ChatConversation, prevChats: ChatConversation[], imageUrl?: string) => {
    const isFirstMsg = convToUse.messages.length === 0
    const title = isFirstMsg ? msgContent.slice(0, 40) : convToUse.title
    setFollowUpSuggestions([])

    const userMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content: msgContent,
      ts: Date.now(),
      image_url: imageUrl || undefined,
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
      // Feature 5: prepend system prompt if set
      const systemPrompt = convToUse.system_prompt
      const historyMessages = [...convToUse.messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))
      const allMessages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...historyMessages]
        : historyMessages

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convToUse.id, messages: allMessages, agentId: selectedAgent, modelOverride: selectedModel !== 'default' ? selectedModel : undefined }),
        signal: abortCtrl.signal,
      })

      if (!res.ok || !res.body) {
        setChatError('Gateway error — could not stream response')
        setLoading(false)
        setIsSending(false)
        return
      }

      const streamMsgId = 'msg-stream-' + Date.now()
      const placeholderMsg: ChatMessage = {
        id: streamMsgId,
        role: 'assistant',
        content: '',
        model: 'kaos',
        ts: Date.now(),
      }

      setChats(prev => prev.map(c =>
        c.id === convToUse.id
          ? { ...c, messages: [...c.messages, placeholderMsg], updatedAt: Date.now() }
          : c
      ))
      setLoading(false)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let finalId = streamMsgId
      let streamThinking = ''

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
            // Tool call visibility: detect tool_use events
            if (parsed.tool_use) {
              const tu = parsed.tool_use
              setToolIndicators(prev => ({
                ...prev,
                [streamMsgId]: [...(prev[streamMsgId] || []), { name: tu.name || 'unknown', input: JSON.stringify(tu.input || {}), expanded: false }]
              }))
            }
            // Also detect tool_use wrapped in delta content blocks
            if (parsed.choices?.[0]?.delta?.content && typeof parsed.choices[0].delta.content === 'string') {
              try {
                const inner = JSON.parse(parsed.choices[0].delta.content)
                if (inner?.type === 'tool_use') {
                  setToolIndicators(prev => ({
                    ...prev,
                    [streamMsgId]: [...(prev[streamMsgId] || []), { name: inner.name || 'unknown', input: JSON.stringify(inner.input || {}), expanded: false }]
                  }))
                }
              } catch { /* not JSON */ }
            }
            // Tool result: capture output for tool calls
            if (parsed.tool_result) {
              const tr = parsed.tool_result
              setToolIndicators(prev => {
                const existing = prev[streamMsgId] || []
                // Attach output to the last tool indicator (most recent tool call)
                if (existing.length > 0) {
                  const updated = [...existing]
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, output: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output || tr.content || '') }
                  return { ...prev, [streamMsgId]: updated }
                }
                return prev
              })
            }
            // Reasoning/thinking blocks
            const thinkingDelta = parsed.choices?.[0]?.delta?.thinking || parsed.thinking
            if (thinkingDelta) {
              streamThinking += thinkingDelta
            }
            if (parsed.delta) {
              fullContent += parsed.delta
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

      // Store thinking content if any
      if (streamThinking) {
        setThinkingContent(prev => ({ ...prev, [finalId !== streamMsgId ? finalId : streamMsgId]: streamThinking }))
      }

      // Feature 7: mark unread if document not visible
      if (document.hidden) {
        setUnreadChat(true)
        unreadChatRef.current = true
        window.dispatchEvent(new CustomEvent('mc-chat-unread'))
      }

      if (finalId !== streamMsgId) {
        // Migrate tool indicators and thinking to new id
        setToolIndicators(prev => {
          if (!prev[streamMsgId]) return prev
          const { [streamMsgId]: old, ...rest } = prev
          return { ...rest, [finalId]: old }
        })
        if (streamThinking) {
          setThinkingContent(prev => {
            const { [streamMsgId]: old, ...rest } = prev
            return { ...rest, [finalId]: old }
          })
        }
        setChats(prev => prev.map(c =>
          c.id === convToUse.id
            ? { ...c, messages: c.messages.map(m => m.id === streamMsgId ? { ...m, id: finalId } : m) }
            : c
        ))
      }

      // Feature 13: generate follow-up suggestions after streaming completes
      if (fullContent) {
        setFollowUpSuggestions(generateSuggestions(fullContent))
      }

      // Feature 17: auto-title for new conversations
      if (isFirstMsg && msgContent) {
        triggerAutoTitle(convToUse.id, msgContent)
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

    // Handle /imagine typed manually
    if (inputVal.trim().startsWith('/imagine ')) {
      await executeSlashCommand('/imagine')
      return
    }

    // Handle slash commands — match exact OR first filtered result from palette
    if (inputVal.startsWith('/')) {
      const typed = inputVal.trim().split(' ')[0]
      const exact = SLASH_COMMANDS.find(c => c.cmd === typed)
      if (exact) { await executeSlashCommand(typed); return }
      // Partial match: if palette is open and exactly one match (or first match), execute or insert
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typed))
      if (filtered.length >= 1 && showSlashPalette) {
        const chosen = filtered[slashPaletteIdx] || filtered[0]
        if (chosen.cmd === '/imagine') {
          setInputVal('/imagine ')
          setShowSlashPalette(false)
          setTimeout(() => textareaRef.current?.focus(), 0)
          return
        }
        await executeSlashCommand(chosen.cmd)
        return
      }
    }

    setFollowUpSuggestions([])
    const MAX_FILE = 32768
    const fileContent = selectedFile
      ? (selectedFile.content.length > MAX_FILE ? selectedFile.content.slice(0, MAX_FILE) + '\n\n[...truncated at 32KB]' : selectedFile.content)
      : null
    // Feature 1: include pasted image
    let content = fileContent
      ? `[📎 ${selectedFile!.name}]\n\n${fileContent}\n\n---\n${inputVal}`
      : inputVal
    let imageUrl: string|undefined
    if (pastedImage) {
      content = `![image](${pastedImage})\n\n${content}`
      imageUrl = pastedImage
      setPastedImage(null)
    }
    // URL image input
    if (imageUrlPreview) {
      content = `![image](${imageUrlPreview})\n\n${content}`
      setImageUrlPreview(null)
      setImageUrlDraft('')
      setShowImageUrlInput(false)
    }
    const msgId = 'msg-' + Date.now()
    setInputVal('')
    setShowSlashPalette(false)
    setSelectedFile(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await doSend(content, msgId, activeConv, chats, imageUrl)
  }

  const handleRetry = async () => {
    if (!lastUserMsg || !activeConv) return
    setChatError(null)
    const convWithoutLast = {
      ...activeConv,
      messages: activeConv.messages.filter(m => m.id !== lastUserMsg.id),
    }
    await doSend(lastUserMsg.content, 'msg-retry-' + Date.now(), convWithoutLast, chats)
  }

  // Feature 6: edit message
  const startEditMessage = (msg: ChatMessage) => {
    setEditingMsgId(msg.id)
    setEditingMsgContent(msg.content)
  }

  const confirmEditMessage = async (msg: ChatMessage) => {
    if (!activeConv || !editingMsgContent.trim()) return
    const editedContent = editingMsgContent.trim()
    const msgTs = msg.ts || Date.now()

    // Remove all messages at or after this message
    const newMessages = activeConv.messages.filter(m => (m.ts || 0) < msgTs)
    const updatedConv = { ...activeConv, messages: newMessages }
    setChats(prev => prev.map(c => c.id === activeConv.id ? updatedConv : c))
    setEditingMsgId(null)

    // Delete from Supabase
    await fetch(`/api/chat/messages?conversation_id=${activeConv.id}&after_ts=${msgTs}`, {
      method: 'DELETE',
    })

    // Re-send the edited message
    await doSend(editedContent, 'msg-edit-' + Date.now(), updatedConv, chats.map(c => c.id === activeConv.id ? updatedConv : c))
  }

  // Feature 11: voice input
  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    if (isListening) {
      speechRecognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInputVal(prev => prev ? prev + ' ' + transcript : transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    speechRecognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  // Feature 12: full-text search
  const doMessageSearch = async (q: string) => {
    if (q.length < 3) return
    setIsSearching(true)
    try {
      const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setSearchResults(data)
      setSearchMode('messages')
    } catch { /* ignore */ }
    finally { setIsSearching(false) }
  }

  // Feature 13: generate follow-up suggestions
  const generateSuggestions = (text: string) => {
    const last200 = text.slice(-200)
    const words = last200.toLowerCase().split(/\W+/).filter(w => w.length > 4)
    const stopWords = new Set(['about','would','should','could','their','there','where','which','these','those','other','after','before','while'])
    const nouns = words.filter(w => !stopWords.has(w)).slice(0, 10)
    const unique = Array.from(new Set(nouns)).slice(0, 4)
    const suggestions: string[] = []
    if (unique[0]) suggestions.push(`Tell me more about ${unique[0]}`)
    if (unique[1]) suggestions.push(`How do I ${unique[1]}?`)
    return suggestions.slice(0, 2)
  }

  // Feature 16: toggle bookmark
  const toggleBookmark = async (msgId: string, current: boolean) => {
    const newVal = !current
    setChats(prev => prev.map(c => c.id === activeChat
      ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, bookmarked: newVal } : m) }
      : c
    ))
    await fetch('/api/chat/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, bookmarked: newVal }),
    })
  }

  // Feature 17: auto-title
  const triggerAutoTitle = (conversationId: string, firstUserMessage: string) => {
    fetch('/api/chat/autotitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, firstUserMessage }),
    }).then(r => r.json()).then(data => {
      if (data.title) {
        setChats(prev => prev.map(c => c.id === conversationId ? { ...c, title: data.title } : c))
      }
    }).catch(() => {})
  }

  // Feature 18: export helpers
  const exportChatMarkdown = (conv: ChatConversation): string => {
    const md = conv.messages.map(m =>
      `### ${m.role === 'user' ? '👤 You' : '🧠 KAOS'}${m.ts ? ` — ${new Date(m.ts).toLocaleTimeString()}` : ''}\n\n${m.content}`
    ).join('\n\n---\n\n')
    return `# ${conv.title}\n\n${md}`
  }

  const copyConvAsMarkdown = (conv: ChatConversation) => {
    navigator.clipboard.writeText(exportChatMarkdown(conv))
    setShowExportMenu(false)
  }

  const downloadConvMd = (conv: ChatConversation) => {
    const blob = new Blob([exportChatMarkdown(conv)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  const printConv = () => {
    printRef.current = true
    setShowExportMenu(false)
    setTimeout(() => { window.print(); printRef.current = false }, 100)
  }

  // Feature 19: fork conversation
  const forkConversation = async (conv: ChatConversation, upToMsgId: string) => {
    const msgIdx = conv.messages.findIndex(m => m.id === upToMsgId)
    const messagesToCopy = conv.messages.slice(0, msgIdx + 1)
    const newId = 'chat-fork-' + Date.now()
    const newTitle = `Fork of: ${conv.title}`
    const newConv: ChatConversation = {
      id: newId,
      title: newTitle,
      model: conv.model,
      messages: messagesToCopy.map(m => ({ ...m, id: 'msg-fork-' + Date.now() + Math.random().toString(36).slice(2) })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      project: conv.project,
      agent_id: conv.agent_id,
      system_prompt: conv.system_prompt,
      forked_from: conv.id,
    }
    setChats(prev => [newConv, ...prev])
    setActiveChat(newId)
    // Persist
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: newTitle, model: conv.model, agent_id: conv.agent_id, forked_from: conv.id }),
    })
    for (const m of newConv.messages) {
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, conversation_id: newId, role: m.role, content: m.content, model: m.model || null }),
      })
    }
  }

  const handleFileAttach = (accept?: string) => {
    setShowFileTypePicker(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept || FILE_TYPE_GROUPS[0].accept
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      setSelectedFile({ name: file.name, content: text })
    }
    input.click()
  }

  // Close file type picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fileTypePickerRef.current && !fileTypePickerRef.current.contains(e.target as Node)) {
        setShowFileTypePicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const groupedChats = groupChatsByDate(filteredChats)

  // Feature 8: model label
  const agentModelLabel = AGENT_MODEL_MAP[selectedAgent] || 'Claude Max'

  // NEW: Send last assistant message to another agent
  const sendToAgent = async (targetAgentId: string) => {
    if (!activeConv) return
    const lastAssistant = [...activeConv.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant) return
    setShowSendToAgent(false)
    try {
      const res = await fetch('/api/chat/send-to-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: targetAgentId, message: lastAssistant.content, sessionKey: `mc-send-${targetAgentId}-${activeConv.id}` }),
      })
      const data = await res.json()
      if (data.ok) {
        // Show a local info message
        const infoMsg: ChatMessage = {
          id: 'send-to-' + Date.now(),
          role: 'assistant',
          content: `↗ **Forwarded to ${AGENT_OPTIONS.find(a=>a.id===targetAgentId)?.label || targetAgentId}**\n\n${data.reply}`,
          ts: Date.now(),
        }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, infoMsg] } : c))
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="flex gap-0 h-[calc(100vh-88px)] -mx-3 md:-mx-6 -my-5">
      {/* LEFT SIDEBAR — Feature 10: collapsible, hidden on mobile */}
      <div
        className={'shrink-0 border-r border-zinc-800/60 hidden md:flex flex-col transition-all duration-200 ' + (sidebarCollapsed ? 'w-10' : 'w-64')}
        style={{background:'#0d0d0d'}}
        ref={sidebarRef}
      >
        {sidebarCollapsed ? (
          /* Collapsed strip */
          <div className="flex flex-col items-center py-2 gap-2">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white transition-colors text-sm"
              title="Expand sidebar">
              ›
            </button>
            <button
              onClick={newChat}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-all text-xs"
              title="New Chat">
              +
            </button>
            {/* Unread dot on nav */}
            {unreadChat && (
              <span className="w-2 h-2 rounded-full bg-red-500" title="Unread messages" />
            )}
            {/* Conversation dots */}
            <div className="flex flex-col gap-1 mt-1">
              {filteredChats.slice(0, 8).map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveChat(c.id)}
                  title={c.title}
                  className={'w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all ' +
                    (activeChat === c.id ? 'bg-zinc-600' : 'bg-zinc-900 hover:bg-zinc-800')}>
                  {AGENT_BADGE_MAP[c.agent_id || 'main'] || '💬'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Sidebar header with collapse button */}
            <div className="px-3 py-3 border-b border-zinc-800/40 flex items-center gap-2">
              <button
                onClick={newChat}
                className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 text-white text-xs font-medium hover:bg-zinc-700 transition-all flex items-center gap-2">
                <span>+</span> New Chat
              </button>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white transition-colors text-sm rounded-lg hover:bg-zinc-800"
                title="Collapse sidebar">
                ‹
              </button>
            </div>

            {/* Sidebar tabs: Mine / OpenClaw / Heartbeats */}
            <div className="flex border-b border-zinc-800 shrink-0">
              {([['mine','💬','Mine'],['openclaw','🤖','OpenClaw'],['heartbeats','⏱','Beats']] as const).map(([id,icon,label])=>(
                <button key={id} onClick={()=>setSidebarTab(id)}
                  className={'flex-1 py-2 text-[10px] font-semibold tracking-wide transition-colors flex flex-col items-center gap-0.5 ' +
                    (sidebarTab===id ? 'text-white border-b-2 border-purple-500' : 'text-zinc-600 hover:text-zinc-400 border-b-2 border-transparent')}>
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Feature 9 + 16: Project filter pills + Starred */}
            {sidebarTab === 'mine' && <div className="px-3 py-2 border-b border-zinc-800/40 flex flex-wrap gap-1">
              <button
                onClick={() => { setProjectFilter(null); setStarredFilter(false) }}
                className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                  (!projectFilter && !starredFilter ? 'bg-zinc-700 text-white border-zinc-600' : 'text-zinc-500 border-zinc-800 hover:border-zinc-700')}>
                All
              </button>
              {Object.entries(PROJECT_TAG_COLORS).map(([proj, color]) => (
                <button
                  key={proj}
                  onClick={() => { setProjectFilter(projectFilter === proj ? null : proj); setStarredFilter(false) }}
                  className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                    (projectFilter === proj ? 'text-white' : 'text-zinc-500 hover:text-zinc-300')}
                  style={projectFilter === proj
                    ? { background: color + '30', borderColor: color + '80', color }
                    : { borderColor: '#27272a' }}>
                  {proj}
                </button>
              ))}
              <button
                onClick={() => { setStarredFilter(v => !v); setProjectFilter(null) }}
                className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                  (starredFilter ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50' : 'text-zinc-500 border-zinc-800 hover:border-zinc-700')}>
                ⭐ Starred
              </button>
            </div>}

            {/* Feature 12: Search + message search */}
            {sidebarTab === 'mine' && <>
            <div className="px-3 py-2.5 border-b border-zinc-800/40">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800/60" style={{background:'#111'}}>
                <svg className="w-3 h-3 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    if (searchMode === 'messages') { setSearchMode('title'); setSearchResults([]) }
                  }}
                  className="bg-transparent text-xs text-zinc-300 placeholder-zinc-600 w-full outline-none"
                />
                {searchMode === 'messages' && (
                  <button onClick={() => { setSearchMode('title'); setSearchResults([]) }} className="text-[9px] text-yellow-400 hover:text-yellow-200">✕</button>
                )}
              </div>
              {search.length >= 3 && searchMode === 'title' && (
                <button
                  onClick={() => doMessageSearch(search)}
                  disabled={isSearching}
                  className="mt-1.5 w-full text-[9px] px-2 py-1 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors text-left flex items-center gap-1.5">
                  {isSearching ? '⟳ Searching messages...' : '🔍 Search message content'}
                </button>
              )}
              {searchMode === 'messages' && searchResults.length > 0 && (
                <p className="mt-1 text-[9px] text-zinc-600">{searchResults.length} message{searchResults.length !== 1 ? 's' : ''} found</p>
              )}
            </div>

            {/* Grouped Chats */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredChats.length === 0 ? (
                <p className="text-zinc-700 text-xs px-3 py-4">No chats yet</p>
              ) : (
                groupedChats.map(group => (
                  <div key={group.label} className="mb-2">
                    <p className={'text-[9px] uppercase tracking-widest font-semibold px-3 py-1.5 ' + (group.pinned ? 'text-amber-600' : 'text-zinc-700')}>
                      {group.pinned ? '📌 ' : ''}{group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map(c => {
                        const flatIdx = filteredChats.indexOf(c)
                        const lastMsg = c.messages[c.messages.length - 1]
                        const preview = searchMode === 'messages'
                          ? searchResults.find(r => r.conversation_id === c.id)?.content.slice(0, 60)
                          : lastMsg ? stripMarkdownPreview(lastMsg.content) : ''
                        const agentBadge = AGENT_BADGE_MAP[c.agent_id || 'main'] || '🧠'
                        const projColor = c.project ? PROJECT_TAG_COLORS[c.project] : null
                        const highlightedPreview = searchMode === 'messages' && preview && search.length >= 3
                          ? (() => {
                              const idx = preview.toLowerCase().indexOf(search.toLowerCase())
                              if (idx < 0) return <span>{preview}</span>
                              return <span>{preview.slice(0, idx)}<span className="bg-yellow-900/40 text-yellow-300">{preview.slice(idx, idx + search.length)}</span>{preview.slice(idx + search.length)}</span>
                            })()
                          : <span>{preview}</span>
                        return (
                          <div
                            key={c.id}
                            className={
                              'group relative w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs cursor-pointer ' +
                              (activeChat === c.id ? 'bg-zinc-800 text-white' : sidebarFocusIdx === flatIdx ? 'bg-zinc-900/70 text-zinc-300 ring-1 ring-zinc-700' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-900')
                            }
                            onClick={() => { setActiveChat(c.id); setSidebarFocusIdx(flatIdx) }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              togglePin(c.id, !c.pinned)
                            }}
                          >
                            {/* Feature 3: agent badge */}
                            <div className="flex items-center justify-between gap-1">
                              <p
                                className="font-medium truncate flex-1 pr-1"
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  setActiveChat(c.id)
                                  setRenamingTitle(c.title)
                                }}>
                                {c.pinned ? '📌 ' : ''}{c.title}
                              </p>
                              <div className="flex items-center gap-1 shrink-0">
                                {/* Feature 19: forked badge */}
                                {c.forked_from && <span className="text-[9px] text-zinc-600" title="Forked conversation">⑂</span>}
                                <span className="text-[10px] opacity-70">{agentBadge}</span>
                              </div>
                            </div>
                            {/* Feature 2: last message preview */}
                            {preview && (
                              <p className="text-zinc-600 text-[9px] truncate mt-0.5">{highlightedPreview}</p>
                            )}
                            <div className="flex items-center justify-between mt-0.5">
                              <p className="text-[9px] opacity-40">
                                {new Date(c.updatedAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}
                              </p>
                              {/* Feature 9: project pill */}
                              {c.project && projColor && (
                                <span
                                  className="text-[8px] px-1.5 py-0 rounded-full"
                                  style={{ background: projColor + '20', color: projColor }}>
                                  {c.project}
                                </span>
                              )}
                            </div>
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
            </>}

            {/* OpenClaw / Heartbeats tab content */}
            {sidebarTab !== 'mine' && (
              <div className="flex-1 overflow-y-auto">
                {ocLoading && <div className="p-4 text-center text-zinc-600 text-xs">Loading…</div>}
                {!ocLoading && (() => {
                  const items = sidebarTab === 'heartbeats'
                    ? ocSessions.filter(s => s.action === 'cron' || s.channel?.includes('Cron'))
                    : ocSessions.filter(s => s.action !== 'cron' && !s.channel?.includes('Cron'))
                  if (items.length === 0) return <div className="p-4 text-center text-zinc-600 text-xs">No sessions found</div>
                  return items.map((s: any, i: number) => (
                    <div key={i} className="px-3 py-2.5 border-b border-zinc-900 hover:bg-zinc-900/50 cursor-default">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-base">{s.emoji || '🤖'}</span>
                        <span className="text-xs font-semibold text-zinc-300">{s.agentName || s.agentId}</span>
                        <span className="ml-auto text-[9px] text-zinc-600">{s.ago != null ? `${s.ago}m ago` : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 pl-7">
                        <span className="text-[10px] text-zinc-500">{s.channel}</span>
                        {s.tokens > 0 && <span className="text-[9px] text-zinc-700">{(s.tokens/1000).toFixed(1)}k tokens</span>}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-72 bg-[#0d0d0d] border-r border-zinc-800 flex flex-col h-full overflow-y-auto">
            <div className="px-3 py-3 border-b border-zinc-800/40 flex items-center gap-2">
              <button onClick={newChat} className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 text-white text-xs font-medium hover:bg-zinc-700 transition-all flex items-center gap-2">
                <span>+</span> New Chat
              </button>
              <button onClick={() => setMobileSidebarOpen(false)} className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white transition-colors text-sm rounded-lg hover:bg-zinc-800">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredChats.length === 0 ? (
                <p className="text-zinc-700 text-xs px-3 py-4">No chats yet</p>
              ) : (
                filteredChats.map(c => (
                  <div
                    key={c.id}
                    className={'w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs cursor-pointer mb-0.5 ' +
                      (activeChat === c.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-900')}
                    onClick={() => { setActiveChat(c.id); setMobileSidebarOpen(false) }}>
                    <p className="font-medium truncate">{c.pinned ? '📌 ' : ''}{c.title}</p>
                    <p className="text-[9px] opacity-40 mt-0.5">{new Date(c.updatedAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}</p>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileSidebarOpen(false)} />
        </div>
      )}

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
            <div className="border-b border-zinc-800/40 px-3 md:px-6 py-3 shrink-0 flex items-center justify-between gap-3">
              <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors text-sm" title="History">☰</button>
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
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-white text-sm font-medium truncate cursor-pointer hover:text-zinc-300 transition-colors"
                      title="Double-click to rename"
                      onDoubleClick={() => setRenamingTitle(activeConv.title)}>
                      {activeConv.title}
                    </h2>
                    {/* Feature 9: project badge in header */}
                    <button
                      onClick={() => {
                        const current = activeConv.project || null
                        const idx = PROJECT_CYCLE.indexOf(current as any)
                        const next = PROJECT_CYCLE[(idx + 1) % PROJECT_CYCLE.length]
                        setConvProject(activeConv.id, next)
                      }}
                      className="text-[9px] px-2 py-0.5 rounded-full border transition-colors shrink-0"
                      style={activeConv.project
                        ? { background: (PROJECT_TAG_COLORS[activeConv.project] || '#555') + '20', color: PROJECT_TAG_COLORS[activeConv.project] || '#aaa', borderColor: (PROJECT_TAG_COLORS[activeConv.project] || '#555') + '50' }
                        : { color: '#555', borderColor: '#2a2a2a', background: '#141414' }}
                      title="Click to cycle project tag">
                      {activeConv.project || '+ project'}
                    </button>
                  </div>
                )}
                {/* Feature 8: model display + Feature 15: context budget */}
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-zinc-500 text-xs">{currentAgent.label} — {agentModelLabel}</p>
                  {activeConv.messages.length > 0 && (
                    <span className={`text-[9px] tabular-nums ${contextTokenColor}`}>{contextTokenLabel}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Feature 20: session context viewer button */}
                <div className="hidden md:block relative">
                  <button
                    onClick={() => { setShowContextViewer(v => !v); setShowSystemPrompt(false) }}
                    className={'text-[10px] px-2.5 py-1 rounded-lg border transition-colors font-mono ' +
                      (showContextViewer ? 'text-emerald-300 border-emerald-800 bg-emerald-900/20' : 'text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600')}
                    title="Session context">
                    {'{ }'}
                  </button>
                  {showContextViewer && (
                    <div className="absolute right-0 top-8 z-20 w-72 rounded-xl border border-zinc-800 shadow-2xl p-3 space-y-1.5" style={{background:'#0f0f0f'}}>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-2">Session Context</p>
                      {[
                        ['Session key', `mc-chat-${activeConv.id}`],
                        ['Agent', `${selectedAgent} (${currentAgent.label})`],
                        ['Model', agentModelLabel],
                        ['Messages', String(activeConv.messages.length)],
                        ['Est. tokens', contextTokenLabel],
                        ['System prompt', activeConv.system_prompt ? activeConv.system_prompt.slice(0, 100) + (activeConv.system_prompt.length > 100 ? '…' : '') : 'none'],
                        ['Forked from', activeConv.forked_from || 'original'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-[9px] text-zinc-600 w-24 shrink-0">{k}</span>
                          <span className="text-[9px] text-zinc-400 break-all">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Feature 5: system prompt gear button */}
                <div className="hidden md:block relative">
                  <button
                    onClick={() => { setShowSystemPrompt(v => !v); setShowContextViewer(false) }}
                    className={'text-[10px] px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ' +
                      (showSystemPrompt ? 'text-blue-300 border-blue-800 bg-blue-900/30' : 'text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600')}
                    title="System prompt">
                    ⚙️
                    {activeConv.system_prompt && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                    )}
                  </button>
                  {showSystemPrompt && (
                    <div className="absolute right-0 top-8 z-20 w-80 rounded-xl border border-zinc-700 shadow-2xl p-3 space-y-2" style={{background:'#0f0f0f'}}>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">System Prompt</p>
                      <textarea
                        rows={4}
                        value={systemPromptDraft}
                        onChange={e => setSystemPromptDraft(e.target.value)}
                        onBlur={() => saveSystemPrompt(activeConv.id, systemPromptDraft)}
                        placeholder="Optional system prompt for this conversation..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600 resize-none"
                      />
                      <p className="text-[9px] text-zinc-700">Auto-saves on blur. Prepended to every message in this conversation.</p>
                    </div>
                  )}
                </div>
                {/* NEW: Send-to-agent */}
                <div className="hidden md:block relative" ref={sendToAgentRef}>
                  <button
                    onClick={() => setShowSendToAgent(v => !v)}
                    className="text-[10px] px-2.5 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 transition-colors flex items-center gap-1"
                    title="Forward last message to another agent">
                    ↗ Send to
                    <span className="text-[8px]">▾</span>
                  </button>
                  {showSendToAgent && (
                    <div className="absolute right-0 top-7 z-30 w-48 rounded-xl border border-zinc-800 shadow-2xl py-1" style={{background:'#0f0f0f'}}>
                      {AGENT_OPTIONS.filter(a => a.id !== selectedAgent).map(a => (
                        <button
                          key={a.id}
                          onClick={() => sendToAgent(a.id)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors">
                          {a.label} <span className="text-zinc-600 text-[9px]">{a.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isSending ? (
                  <button
                    onClick={stopGeneration}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition-colors flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
                    Stop
                  </button>
                ) : (
                  /* Feature 18: export dropdown */
                  <div className="hidden md:block relative" ref={exportMenuRef}>
                    <button
                      onClick={() => setShowExportMenu(v => !v)}
                      className="text-[10px] px-2.5 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 transition-colors flex items-center gap-1">
                      ↓ Export
                      <span className="text-[8px]">▾</span>
                    </button>
                    {showExportMenu && (
                      <div className="absolute right-0 top-7 z-30 w-44 rounded-xl border border-zinc-800 shadow-2xl py-1" style={{background:'#0f0f0f'}}>
                        <button
                          onClick={() => copyConvAsMarkdown(activeConv)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors">
                          ⎘ Copy as Markdown
                        </button>
                        <button
                          onClick={() => downloadConvMd(activeConv)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors">
                          ↓ Download .md
                        </button>
                        <button
                          onClick={printConv}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors">
                          🖨 Print / PDF
                        </button>
                      </div>
                    )}
                  </div>
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
                <span className="text-xs text-zinc-500">🧠 <span className="text-blue-400 font-medium">{currentAgent.label}</span> is writing…</span>
              </div>
            )}

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              className={`flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 relative print-chat`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true) }}
              onDragLeave={(e) => { if (!messagesContainerRef.current?.contains(e.relatedTarget as Node)) setIsDraggingOver(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDraggingOver(false)
                const file = e.dataTransfer.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = (ev) => {
                  const text = ev.target?.result as string
                  setSelectedFile({ name: file.name, content: text })
                }
                reader.readAsText(file)
              }}
            >
              {/* Auto-scroll lock indicator */}
              {userScrolledUp && (
                <div className="absolute top-3 right-4 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold pointer-events-none"
                  style={{background:'#78350f22', border:'1px solid #f59e0b55', color:'#f59e0b'}}>
                  🔒 scroll locked
                </div>
              )}

              {/* Drag overlay */}
              {isDraggingOver && (
                <div className="absolute inset-0 z-30 flex items-center justify-center rounded-lg pointer-events-none"
                  style={{ background: 'rgba(59,130,246,0.08)', border: '2px dashed #3b82f6' }}>
                  <div className="text-center">
                    <div className="text-3xl mb-2">📎</div>
                    <p className="text-blue-400 text-sm font-medium">Drop file to attach</p>
                  </div>
                </div>
              )}

              {activeConv.messages.length === 0 ? (
                <EmptyState icon="💬" message="No messages yet — start the conversation" />
              ) : (
                activeConv.messages.map(msg => (
                  <div
                    key={msg.id}
                    className={'group flex gap-3 ' + (msg.role === 'user' ? 'flex-row-reverse' : '')}>
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm mt-0.5"
                      style={{ background: msg.role === 'user' ? '#1e1e1e' : '#3b82f620' }}>
                      {msg.role === 'user' ? '👤' : (AGENT_BADGE_MAP[selectedAgent] || '🧠')}
                    </div>

                    {/* Bubble */}
                    <div className={'relative ' + (msg.role === 'user' ? 'max-w-[85%] md:max-w-[65ch]' : 'max-w-[85%] md:max-w-[75ch]')}>
                      {/* Feature 6: inline edit mode */}
                      {editingMsgId === msg.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            autoFocus
                            value={editingMsgContent}
                            onChange={e => setEditingMsgContent(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEditMessage(msg) }
                              if (e.key === 'Escape') setEditingMsgId(null)
                            }}
                            className="px-4 py-3 rounded-lg bg-zinc-700 text-white text-sm outline-none border border-zinc-500 resize-none w-full"
                            rows={3}
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => setEditingMsgId(null)}
                              className="text-xs text-zinc-500 hover:text-white px-2 py-1 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors">
                              Cancel
                            </button>
                            <button
                              onClick={() => confirmEditMessage(msg)}
                              className="text-xs text-white px-2 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 transition-colors">
                              ✓ Send
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* NEW: Tool call indicators above assistant messages */}
                          {msg.role === 'assistant' && toolIndicators[msg.id] && toolIndicators[msg.id].map((tool, ti) => (
                            <div key={ti} className="mb-2 rounded-lg border border-zinc-700/50 bg-zinc-950 text-xs overflow-hidden">
                              <button
                                onClick={() => setToolIndicators(prev => ({
                                  ...prev,
                                  [msg.id]: prev[msg.id].map((t, i) => i === ti ? { ...t, expanded: !t.expanded } : t)
                                }))}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:text-zinc-200 transition-colors text-left">
                                <span>🔧</span>
                                <span className="font-mono text-emerald-400">{tool.name}</span>
                                <span className="text-zinc-600 text-[9px] ml-auto">{tool.expanded ? '▲' : '▼'}</span>
                              </button>
                              {tool.expanded && (
                                <div className="px-3 pb-2 space-y-1">
                                  <div>
                                    <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Input</span>
                                    <pre className="text-[10px] font-mono text-zinc-500 overflow-x-auto whitespace-pre-wrap break-words max-h-32">
                                      {tool.input}
                                    </pre>
                                  </div>
                                  {tool.output && (
                                    <div>
                                      <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Output</span>
                                      <pre className="text-[10px] font-mono text-zinc-400 overflow-x-auto whitespace-pre-wrap break-words max-h-32">
                                        {tool.output}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                          {/* NEW: Thinking/reasoning panel above assistant message */}
                          {msg.role === 'assistant' && thinkingContent[msg.id] && (
                            <details className="mb-2 rounded-lg border border-zinc-700/50 overflow-hidden">
                              <summary className="px-3 py-1.5 text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none" style={{background:'#161616'}}>
                                💭 Reasoning <span className="text-[9px] text-zinc-700">(click to expand)</span>
                              </summary>
                              <pre className="px-3 py-2 text-[10px] font-mono text-zinc-500 whitespace-pre-wrap break-words max-h-48 overflow-y-auto" style={{background:'#111'}}>
                                {thinkingContent[msg.id]}
                              </pre>
                            </details>
                          )}
                          {/* Feature 16: bookmarked gold left border */}
                          <div
                            className={
                              'message-bubble px-4 py-3 rounded-lg text-sm ' +
                              (msg.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-zinc-900 text-zinc-300') +
                              (msg.bookmarked ? ' border-l-2 border-yellow-600/50' : '')
                            }>
                            {/* Feature 1: show image if present */}
                            {msg.image_url && (
                              <img src={msg.image_url} alt="pasted" className="max-w-[200px] max-h-[150px] rounded-lg mb-2 object-contain" />
                            )}
                            {msg.role === 'user'
                              ? <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content.replace(/^!\[image\]\(data:[^)]+\)\n\n/, '')}</p>
                              : <MarkdownMessage content={msg.content} />
                            }
                          </div>
                          {/* NEW: Approval flow buttons */}
                          {msg.role === 'assistant' && /\/approve\s+(allow-once|allow-always|deny)/i.test(msg.content) && !approvalUsed[msg.id] && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {[
                                { label: '✓ Allow once', cmd: '/approve allow-once', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50 hover:bg-emerald-900/70' },
                                { label: '✓ Always',     cmd: '/approve allow-always', cls: 'bg-blue-900/40 text-blue-300 border-blue-800/50 hover:bg-blue-900/70' },
                                { label: '✗ Deny',       cmd: '/approve deny',         cls: 'bg-red-900/40 text-red-300 border-red-800/50 hover:bg-red-900/70' },
                              ].map(btn => (
                                <button
                                  key={btn.cmd}
                                  onClick={async () => {
                                    setApprovalUsed(prev => ({ ...prev, [msg.id]: true }))
                                    if (!activeConv) return
                                    const approvalMsgId = 'msg-approval-' + Date.now()
                                    await doSend(btn.cmd, approvalMsgId, activeConv, chats)
                                  }}
                                  className={`text-xs px-3 py-1 rounded-lg border transition-colors ${btn.cls}`}>
                                  {btn.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* Actions row: copy + edit + bookmark + fork */}
                          <div className={
                            'flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ' +
                            (msg.role === 'user' ? 'justify-end' : 'justify-start')
                          }>
                            <button
                              onClick={() => copyMessage(msg.id, msg.content)}
                              className="text-[9px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1 transition-colors">
                              {copiedId === msg.id ? '✓ Copied' : '⎘ Copy'}
                            </button>
                            {/* Feature 16: bookmark */}
                            <button
                              onClick={() => toggleBookmark(msg.id, !!msg.bookmarked)}
                              className={'text-[9px] transition-colors ' + (msg.bookmarked ? 'text-yellow-500 hover:text-yellow-300' : 'text-zinc-600 hover:text-zinc-400')}
                              title={msg.bookmarked ? 'Remove bookmark' : 'Bookmark'}>
                              ★
                            </button>
                            {/* Fork: assistant messages (existing) + user messages (new task 6) */}
                            {activeConv && (
                              <button
                                onClick={() => forkConversation(activeConv, msg.id)}
                                className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
                                title="Fork conversation from here">
                                ⑂ Fork
                              </button>
                            )}
                            {/* Feature 6: edit button for user messages */}
                            {msg.role === 'user' && (
                              <button
                                onClick={() => startEditMessage(msg)}
                                className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
                                title="Edit message">
                                ✏️
                              </button>
                            )}
                            {/* Per-message delete */}
                            <button
                              onClick={() => {
                                if (!activeConv) return
                                const updated = { ...activeConv, messages: activeConv.messages.filter(m => m.id !== msg.id) }
                                setChats(prev => prev.map(c => c.id === activeConv.id ? updated : c))
                                fetch('/api/chat/conversations', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: activeConv.id, messages: updated.messages })
                                })
                              }}
                              className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded"
                              title="Delete message">
                              🗑
                            </button>
                          </div>
                          {/* Task 5: Timestamp on hover, shown below actions row */}
                          {msg.ts && (
                            <div className={
                              'opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 ' +
                              (msg.role === 'user' ? 'text-right' : 'text-left')
                            }>
                              <span className="text-[9px] text-zinc-700">
                                {new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              {/* Feature 13: follow-up suggestions */}
              {followUpSuggestions.length > 0 && !isSending && (
                <div className="flex gap-2 flex-wrap pl-11">
                  {followUpSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setInputVal(s); textareaRef.current?.focus() }}
                      className="px-3 py-1 rounded-full border border-zinc-700 text-zinc-400 text-[11px] hover:bg-zinc-800 hover:text-white cursor-pointer transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
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

            {/* Back to bottom button — fixed bottom-right of chat column */}
            {userScrolledUp && (
              <div className="absolute bottom-24 right-6 z-40">
                <button
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold shadow-xl transition-all"
                  style={{ background: '#18181b', border: '2px solid #a855f7', color: '#e4d4f4', boxShadow: '0 0 12px #a855f744' }}
                  onClick={() => { setUserScrolledUp(false); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                  title="Back to bottom">
                  ↓ Back to bottom
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-zinc-800/40 px-3 md:px-6 py-3 md:py-4 shrink-0" style={{background:'#0d0d0d', paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}>
              {/* Feature 1: pasted image preview */}
              {pastedImage && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60">
                  <img src={pastedImage} alt="paste preview" className="w-12 h-12 object-contain rounded" />
                  <span className="text-xs text-zinc-400 flex-1">Image pasted</span>
                  <button
                    onClick={() => setPastedImage(null)}
                    className="text-zinc-600 hover:text-white text-xs ml-1">
                    ✕
                  </button>
                </div>
              )}
              {selectedFile && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs mb-2"
                  style={{background:'#1a1a2e', border:'1px solid #2a2a4a'}}>
                  <span className="text-base">{
                    selectedFile.name.endsWith('.ts')||selectedFile.name.endsWith('.tsx') ? '🟦' :
                    selectedFile.name.endsWith('.js')||selectedFile.name.endsWith('.jsx') ? '🟨' :
                    selectedFile.name.endsWith('.py') ? '🐍' :
                    selectedFile.name.endsWith('.md') ? '📝' :
                    selectedFile.name.endsWith('.json') ? '📋' :
                    selectedFile.name.endsWith('.css') ? '🎨' :
                    selectedFile.name.endsWith('.html') ? '🌐' : '📄'
                  }</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-300 font-medium truncate">{selectedFile.name}</div>
                    <div className="text-zinc-600 text-[9px]">{(selectedFile.content.length/1024).toFixed(1)} KB</div>
                  </div>
                  <button onClick={() => setSelectedFile(null)} className="text-zinc-600 hover:text-zinc-400 text-xs px-1">✕</button>
                </div>
              )}

              {/* NEW: Image URL preview */}
              {imageUrlPreview && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60">
                  <img src={imageUrlPreview} alt="url preview" className="w-12 h-12 object-contain rounded" onError={() => setImageUrlPreview(null)} />
                  <span className="text-xs text-zinc-400 flex-1 truncate">{imageUrlPreview.slice(0, 50)}…</span>
                  <button onClick={() => { setImageUrlPreview(null); setImageUrlDraft('') }} className="text-zinc-600 hover:text-white text-xs ml-1">✕</button>
                </div>
              )}
              {/* Task 8: @-mention agent dropdown */}
              {showMentionDropdown && (() => {
                const filtered = AGENT_OPTIONS.filter(a =>
                  a.id.toLowerCase().includes(mentionFilter) || a.label.toLowerCase().includes(mentionFilter)
                )
                return filtered.length > 0 ? (
                  <div className="mb-2 rounded-xl border border-zinc-700 overflow-hidden shadow-xl" style={{background:'#0f0f0f'}}>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest px-3 pt-2 pb-1">Route to agent</p>
                    {filtered.map((a, i) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setInputVal(v => v.replace(/@\w*$/, `@${a.id} `))
                          setSelectedAgent(a.id)
                          setShowMentionDropdown(false)
                          textareaRef.current?.focus()
                        }}
                        className={'w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-zinc-800/50 last:border-0 transition-colors ' +
                          (i === mentionIdx ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900')}>
                        <span className="text-sm shrink-0">{a.label.split(' ')[0]}</span>
                        <span className="font-mono text-xs text-blue-400 shrink-0">@{a.id}</span>
                        <span className="text-[10px] text-zinc-600">{a.desc}</span>
                      </button>
                    ))}
                  </div>
                ) : null
              })()}
              {/* NEW: Slash command palette */}
              {showSlashPalette && slashFilter.length > 0 && (
                <div className="mb-2 rounded-xl border border-zinc-700 overflow-hidden shadow-xl" style={{background:'#0f0f0f'}}>
                  {slashFilter.map((c, i) => (
                    <button
                      key={c.cmd}
                      onClick={() => {
                        // For /imagine: insert command into input so user can type their prompt, don't execute
                        if (c.cmd === '/imagine') {
                          setInputVal('/imagine ')
                          setShowSlashPalette(false)
                          setTimeout(() => textareaRef.current?.focus(), 0)
                        } else {
                          executeSlashCommand(c.cmd)
                        }
                      }}
                      className={'w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-zinc-800/50 last:border-0 transition-colors ' +
                        (i === slashPaletteIdx ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900')}>
                      <span className="text-base shrink-0">{c.icon}</span>
                      <span className="font-mono text-xs text-emerald-400 shrink-0">{c.cmd}</span>
                      <span className="text-[10px] text-zinc-600">{c.desc}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Feature 14: keyboard shortcut cheatsheet panel */}
              {showShortcuts && (
                <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 no-print">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Keyboard Shortcuts</p>
                    <button onClick={() => setShowShortcuts(false)} className="text-zinc-600 hover:text-white text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {[
                      ['⌘K', 'New chat'],
                      ['↑/↓', 'Navigate conversations'],
                      ['Enter', 'Send message'],
                      ['⇧ Enter', 'New line'],
                      ['Esc', 'Cancel / close'],
                      ['⌘/', 'Focus input'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center gap-2">
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 font-mono">{key}</kbd>
                        <span className="text-[10px] text-zinc-600">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* Paperclip button + file type picker */}
                <div className="relative shrink-0 hidden sm:block" ref={fileTypePickerRef}>
                  <button
                    onClick={() => setShowFileTypePicker(p => !p)}
                    disabled={isSending}
                    className="p-2 rounded-lg hover:bg-zinc-900 transition-all text-zinc-500 hover:text-zinc-300 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Attach file">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  {showFileTypePicker && (
                    <div className="absolute bottom-10 left-0 z-50 rounded-xl border border-zinc-700 overflow-hidden shadow-xl" style={{background:'#0f0f0f', minWidth:'160px'}}>
                      {FILE_TYPE_GROUPS.map(g => (
                        <button key={g.label}
                          onClick={() => handleFileAttach(g.accept)}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-0">
                          {g.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* NEW: File browser button */}
                <button
                  onClick={() => { setShowFileBrowser(true); setFileBrowserPath('') }}
                  disabled={isSending}
                  className="hidden sm:block p-2 rounded-lg hover:bg-zinc-900 transition-all text-zinc-500 hover:text-zinc-300 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  title="Browse workspace files">
                  📁
                </button>

                {/* NEW: Image URL input button */}
                <div className="hidden sm:block relative shrink-0">
                  <button
                    onClick={() => setShowImageUrlInput(v => !v)}
                    disabled={isSending}
                    className="p-2 rounded-lg hover:bg-zinc-900 transition-all text-zinc-500 hover:text-zinc-300 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                    title="Add image by URL">
                    🔗
                  </button>
                  {showImageUrlInput && (
                    <div className="absolute bottom-10 left-0 z-50 rounded-xl border border-zinc-700 shadow-xl p-2" style={{background:'#0f0f0f', minWidth:'240px'}}>
                      <p className="text-[9px] text-zinc-600 mb-1.5 uppercase tracking-widest">Image URL</p>
                      <input
                        autoFocus
                        type="url"
                        value={imageUrlDraft}
                        onChange={e => setImageUrlDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && imageUrlDraft.trim()) {
                            setImageUrlPreview(imageUrlDraft.trim())
                            setShowImageUrlInput(false)
                          }
                          if (e.key === 'Escape') setShowImageUrlInput(false)
                        }}
                        placeholder="https://example.com/image.png"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600"
                      />
                      <p className="text-[9px] text-zinc-700 mt-1">Press Enter to add preview</p>
                    </div>
                  )}
                </div>

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

                {/* Model selector */}
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  disabled={isSending}
                  className="hidden sm:block px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800/60 text-xs text-zinc-400 shrink-0 mb-0.5 outline-none focus:border-zinc-600 disabled:opacity-50 cursor-pointer"
                  title="Select model">
                  {MODEL_PROVIDERS.map(provider => (
                    <optgroup key={provider} label={provider}>
                      {MODEL_OPTIONS.filter(m => m.provider === provider).map(m => (
                        <option key={m.id} value={m.id} title={m.desc}>
                          {m.label}{m.ctx ? ` (${m.ctx})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                {/* Auto-grow textarea */}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputVal}
                  onChange={(e) => {
                    const val = e.target.value
                    setInputVal(val)
                    adjustTextarea()
                    if (val) setFollowUpSuggestions([])
                    // Slash command palette — hide once user has typed a space after the command (they have their prompt)
                    if (val.startsWith('/') && !val.includes(' ')) {
                      setShowSlashPalette(true)
                      setSlashPaletteIdx(0)
                    } else {
                      setShowSlashPalette(false)
                    }
                    // @-mention routing
                    const atMatch = val.match(/@(\w*)$/)
                    if (atMatch) {
                      setMentionFilter(atMatch[1].toLowerCase())
                      setShowMentionDropdown(true)
                      setMentionIdx(0)
                    } else {
                      setShowMentionDropdown(false)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (showMentionDropdown) {
                      const filtered = AGENT_OPTIONS.filter(a =>
                        a.id.toLowerCase().includes(mentionFilter) || a.label.toLowerCase().includes(mentionFilter)
                      )
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i+1, filtered.length-1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i-1, 0)); return }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        const chosen = filtered[mentionIdx]
                        if (chosen) {
                          setInputVal(v => v.replace(/@\w*$/, `@${chosen.id} `))
                          setSelectedAgent(chosen.id)
                          setShowMentionDropdown(false)
                        }
                        return
                      }
                      if (e.key === 'Escape') { setShowMentionDropdown(false); return }
                    }
                    if (showSlashPalette) {
                      const visible = slashFilter
                      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashPaletteIdx(i => Math.min(i+1, visible.length-1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashPaletteIdx(i => Math.max(i-1, 0)); return }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        const chosen = visible[slashPaletteIdx]
                        if (chosen) {
                          if (chosen.cmd === '/imagine') {
                            setInputVal('/imagine ')
                            setShowSlashPalette(false)
                            setTimeout(() => textareaRef.current?.focus(), 0)
                          } else {
                            executeSlashCommand(chosen.cmd)
                          }
                        }
                        return
                      }
                      if (e.key === 'Escape') { setShowSlashPalette(false); return }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    } else if (e.key === 'Enter' && e.shiftKey) {
                      setTimeout(adjustTextarea, 0)
                    }
                  }}
                  disabled={isSending}
                  placeholder={isListening ? 'Listening...' : isSending ? `${currentAgent.label} is writing…` : `Message ${currentAgent.label} (${agentModelLabel})...`}
                  className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800/60 text-white text-sm placeholder-zinc-600 outline-none focus:border-zinc-700 transition-all resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{minHeight:'38px', maxHeight:'160px'}}
                />

                {/* Feature 11: voice input button */}
                {speechAvailable && (
                  <button
                    onClick={toggleVoiceInput}
                    disabled={isSending}
                    title={isListening ? 'Stop listening' : 'Voice input'}
                    className={
                      'p-2 rounded-lg transition-all text-sm shrink-0 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed ' +
                      (isListening ? 'bg-red-600 text-white anim-mic' : 'hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300')
                    }>
                    🎤
                  </button>
                )}

                {/* Send / Stop button */}
                {loading ? (
                  <button
                    onClick={() => { abortControllerRef.current?.abort(); setLoading(false) }}
                    className="w-9 h-9 rounded-lg bg-red-900/40 border border-red-800/50 text-red-300 hover:bg-red-900/70 transition-colors flex items-center justify-center text-sm shrink-0 mb-0.5"
                    title="Stop generation">
                    ■
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!inputVal.trim() || isSending}
                    className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white shrink-0 mb-0.5">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9-7-9-7m0 0l-9 7m9-7v7" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="hidden md:flex items-center justify-between mt-2 no-print">
                <p className="text-zinc-700 text-[10px]">
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500">Enter</kbd> send ·
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 ml-1">⇧ Enter</kbd> newline ·
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 ml-1">⌘K</kbd> new chat ·
                  <span className="ml-1 text-zinc-700">right-click conv to pin</span>
                </p>
                <div className="flex items-center gap-2">
                  {inputVal.length > 0 && (
                    <span className={`text-[9px] tabular-nums font-mono ${inputVal.length > 8000 ? 'text-red-500' : inputVal.length > 4000 ? 'text-yellow-500' : 'text-zinc-700'}`}>
                      {inputVal.length.toLocaleString()} chars · ~{Math.ceil(inputVal.length/4)} tokens
                    </span>
                  )}
                  {/* Task 7: Prompt templates popover */}
                  <div className="relative" ref={promptTemplatesRef}>
                    <button
                      onClick={() => setShowPromptTemplates(v => !v)}
                      className={'text-[10px] w-5 h-5 rounded flex items-center justify-center border transition-colors ' +
                        (showPromptTemplates ? 'border-zinc-600 text-yellow-400 bg-zinc-800' : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400')}
                      title="Prompt templates">
                      💡
                    </button>
                    {showPromptTemplates && (
                      <div className="absolute bottom-7 right-0 z-50 w-64 rounded-xl border border-zinc-700 shadow-2xl overflow-hidden" style={{background:'#0f0f0f'}}>
                        <p className="text-[9px] text-zinc-600 uppercase tracking-widest px-3 pt-2.5 pb-1.5">Starter prompts</p>
                        {PROMPT_TEMPLATES.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setInputVal(t.text)
                              setShowPromptTemplates(false)
                              setTimeout(() => { textareaRef.current?.focus(); adjustTextarea() }, 50)
                            }}
                            className="w-full text-left px-3 py-2 text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-0">
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Feature 14: keyboard cheatsheet button */}
                  <button
                    onClick={() => setShowShortcuts(v => !v)}
                    className={'text-[10px] w-5 h-5 rounded flex items-center justify-center border transition-colors ' +
                      (showShortcuts ? 'border-zinc-600 text-zinc-400 bg-zinc-800' : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400')}>
                    ?
                  </button>
                </div>
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

      {/* NEW: File Browser Modal */}
      {showFileBrowser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowFileBrowser(false)}>
          <div className="w-96 max-h-[70vh] rounded-2xl border border-zinc-700 shadow-2xl flex flex-col overflow-hidden" style={{background:'#0f0f0f'}} onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span>📁</span>
                <span className="text-xs text-zinc-400 font-medium">Workspace Files</span>
                {fileBrowserPath && <span className="text-[9px] text-zinc-600 font-mono truncate max-w-[160px]">/{fileBrowserPath}</span>}
              </div>
              <div className="flex items-center gap-2">
                {fileBrowserPath && (
                  <button
                    onClick={() => setFileBrowserPath(p => p.split('/').slice(0,-1).join('/'))}
                    className="text-[10px] text-zinc-500 hover:text-white px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500">
                    ← Up
                  </button>
                )}
                <button onClick={() => setShowFileBrowser(false)} className="text-zinc-600 hover:text-white text-xs">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {fileBrowserEntries.length === 0 ? (
                <p className="text-zinc-600 text-xs px-4 py-3">Empty directory</p>
              ) : (
                fileBrowserEntries.map(entry => (
                  <button
                    key={entry.path}
                    onClick={async () => {
                      if (entry.isDir) {
                        setFileBrowserPath(entry.path)
                      } else {
                        // Read file and attach
                        const res = await fetch('/api/files', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path: entry.path}) })
                        const data = await res.json()
                        if (data.content !== undefined) {
                          setSelectedFile({ name: entry.name, content: data.content })
                          setShowFileBrowser(false)
                        }
                      }
                    }}
                    className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-zinc-800/60 transition-colors">
                    <span className="text-sm shrink-0">{entry.isDir ? '📁' : '📄'}</span>
                    <span className="text-xs text-zinc-300 truncate">{entry.name}</span>
                    {!entry.isDir && <span className="text-[9px] text-zinc-600 ml-auto shrink-0">.{entry.name.split('.').pop()}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Task types ────────────────────────────────────────────────────────────
function MultiSelect({ label, options, selected, onToggle, displayFn }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; displayFn?: (v: string) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const display = displayFn ?? ((v: string) => v)
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="bg-transparent border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-400 outline-none focus:border-zinc-600 flex items-center gap-1">
        {selected.length > 0 ? `${label} (${selected.length})` : `All ${label}s`}
        <span className="text-zinc-600 text-[9px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {options.map(opt => (
            <button key={opt} onClick={() => onToggle(opt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-zinc-800 transition-colors">
              <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selected.includes(opt) ? 'bg-blue-500 border-blue-500 text-white' : 'border-zinc-600'}`}>
                {selected.includes(opt) ? '✓' : ''}
              </span>
              <span className="text-zinc-300">{display(opt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SprintProgressCard() {
  const [sprintData, setSprintData] = useState<{total:number;done:number}|null>(null)
  const [priorData, setPriorData] = useState<{total:number;done:number}|null>(null)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
    const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const headers = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    // Current sprint
    fetch(`${SUPA_URL}/rest/v1/issues?sprint=eq.2026-03-28&select=id,status`, { headers })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSprintData({ total: data.length, done: data.filter((i:any) => i.status === 'done').length })
        }
      }).catch(() => {})
    // Prior sprint for velocity comparison
    fetch(`${SUPA_URL}/rest/v1/issues?sprint=eq.2026-03-27&select=id,status`, { headers })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPriorData({ total: data.length, done: data.filter((i:any) => i.status === 'done').length })
        }
      }).catch(() => {})
  }, [])

  useEffect(() => {
    const update = () => {
      const now = new Date()
      // Target: next 7am EDT (UTC-4)
      const target = new Date(now)
      target.setUTCHours(11, 0, 0, 0) // 7am EDT = 11:00 UTC
      if (target <= now) target.setDate(target.getDate() + 1)
      const diff = target.getTime() - now.getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${h}h ${m}m ${s}s`)
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  if (!sprintData || sprintData.total === 0) return null
  const pct = Math.round((sprintData.done / sprintData.total) * 100)
  const velocityDelta = priorData && priorData.done > 0
    ? sprintData.done - priorData.done
    : null

  return (
    <div className="rounded-2xl border border-zinc-800/60 p-4 md:p-5" style={{background:'#0f0f0f'}}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏃</span>
          <span className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Sprint 2026-03-28</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600">Next 7am EDT in</span>
          <span className="text-[11px] font-mono text-zinc-400">{countdown}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-white text-sm font-semibold tabular-nums">{sprintData.done}/{sprintData.total}</span>
        <span className="text-zinc-500 text-xs">done</span>
        {velocityDelta !== null && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
            background: velocityDelta > 0 ? '#10b98120' : velocityDelta < 0 ? '#ef444420' : '#3f3f4620',
            color: velocityDelta > 0 ? '#10b981' : velocityDelta < 0 ? '#ef4444' : '#71717a'
          }}>
            {velocityDelta > 0 ? '+' : ''}{velocityDelta} vs prior
          </span>
        )}
        <span className="ml-auto text-lg font-bold tabular-nums" style={{color: pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b'}}>{pct}%</span>
      </div>
      <div className="w-full rounded-full h-2" style={{background:'#1a1a1a'}}>
        <div className="h-2 rounded-full transition-all duration-500" style={{width: pct+'%', background: pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b'}} />
      </div>
    </div>
  )
}

interface Task {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  due_date?: string; created_at?: string; updated_at?: string;
  resolution_type?: string; acceptance_criteria?: string; sprint?: string;
  steps_to_reproduce?: string; expected_behavior?: string;
  actual_behavior?: string; environment?: string;
  pr_url?: string; blocked_by?: string; parent_id?: string;
}

const RESOLUTION_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'code_change',       label: 'Code Change',       emoji: '✅' },
  { value: 'config_change',     label: 'Config Change',     emoji: '⚙️' },
  { value: 'wont_fix',          label: "Won't Fix",         emoji: '🚫' },
  { value: 'canceled',          label: 'Canceled',          emoji: '❌' },
  { value: 'duplicate',         label: 'Duplicate',         emoji: '🔁' },
  { value: 'cannot_reproduce',  label: "Can't Reproduce",   emoji: '🔬' },
  { value: 'by_design',         label: 'By Design',         emoji: '🎯' },
]

const RESOLUTION_BADGE_COLORS: Record<string, string> = {
  code_change:      '#22c55e',
  config_change:    '#3b82f6',
  by_design:        '#3b82f6',
  canceled:         '#71717a',
  wont_fix:         '#71717a',
  duplicate:        '#eab308',
  cannot_reproduce: '#eab308',
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

const TYPE_COLORS: Record<string,string> = {
  feature:'#3b82f6', bug:'#ef4444', task:'#71717a', ops:'#f59e0b', epic:'#a855f7', subtask:'#64748b',
}

function KanbanBoard({ featureFilter, featureFilterName, onClearFeatureFilter }: { featureFilter?: string; featureFilterName?: string; onClearFeatureFilter?: () => void }) {
  const [tasks, setTasks]         = useState<Task[]>([])
  const [loading, setLoading]     = useState(true)
  const [dragId, setDragId]       = useState<string|null>(null)
  const [editTask, setEditTask]   = useState<Task|null>(null)
  const [newTask, setNewTask]     = useState<Partial<Task>|null>(null)
  const [filterTypes, setFilterTypes]       = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.types ?? [] } catch { return [] } })
  const [filterPriorities, setFilterPriorities] = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.priorities ?? [] } catch { return [] } })
  const [filterAssignees, setFilterAssignees]   = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.assignees ?? [] } catch { return [] } })
  const [filterSprint, setFilterSprint]     = useState('')
  const [quickAddCol, setQuickAddCol]       = useState<string|null>(null)
  const [quickAddTitle, setQuickAddTitle]   = useState('')
  const [confirmDelete, setConfirmDelete]   = useState<string|null>(null)
  const [mobileCol, setMobileCol] = useState('open')
  const [resolutionPending, setResolutionPending] = useState<{taskId:string;source:'drag'|'edit';editFields?:Partial<Task>}|null>(null)
  const [detailTask, setDetailTask] = useState<Task|null>(null)
  const [bugDetailsOpen, setBugDetailsOpen] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [archiveProject, setArchiveProject] = useState('')
  const [closedConfirm, setClosedConfirm] = useState<string|null>(null)
  const [boardLimit, setBoardLimit] = useState(100)
  const [groupByFeature, setGroupByFeature] = useState(() => { try { return localStorage.getItem('board-group-by') === 'feature' } catch { return false } })

  // Persist multiselect filters to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('board-filters', JSON.stringify({ types: filterTypes, priorities: filterPriorities, assignees: filterAssignees }))
    }
  }, [filterTypes, filterPriorities, filterAssignees])

  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setBoardLimit(100)
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
  }
  const removeFilter = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setBoardLimit(100)
    setArr(arr.filter(v => v !== val))
  }
  const clearAllFilters = () => {
    setBoardLimit(100)
    setFilterTypes([]); setFilterPriorities([]); setFilterAssignees([]); setFilterSprint('')
    if (onClearFeatureFilter) onClearFeatureFilter()
  }
  const hasAnyFilter = filterTypes.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0 || filterSprint !== '' || !!featureFilter

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/issues')
      if (res.ok) { const d = await res.json(); setTasks(d) }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const createTask = async (t: Partial<Task>) => {
    const res = await fetch('/api/issues', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(t) })
    if (res.ok) { const d = await res.json(); setTasks(prev => [d, ...prev]); setNewTask(null) }
  }

  const updateTask = async (id: string, fields: Partial<Task>) => {
    const res = await fetch('/api/issues', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, ...fields}) })
    if (res.ok) { const d = await res.json(); setTasks(prev => prev.map(t => t.id===id ? d : t)); setEditTask(null) }
  }

  const deleteTask = async (id: string) => {
    const res = await fetch(`/api/issues?id=${id}`, { method:'DELETE' })
    if (res.ok) { setTasks(prev => prev.filter(t => t.id!==id)); setConfirmDelete(null); setEditTask(null) }
  }

  const closeTask = async (id: string) => {
    setTasks(prev => prev.map(t => t.id===id ? {...t, status:'closed'} : t))
    setClosedConfirm(id)
    setTimeout(() => setClosedConfirm(prev => prev===id ? null : prev), 2000)
    await fetch('/api/issues', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, status:'closed'}) })
  }

  const handleDrop = (status: string) => {
    if (!dragId) return
    if (status === 'done') {
      setResolutionPending({ taskId: dragId, source: 'drag' })
      setDragId(null)
      return
    }
    updateTask(dragId, { status })
    setTasks(prev => prev.map(t => t.id===dragId ? {...t, status} : t))
    setDragId(null)
  }

  const handleResolutionSelect = (resolutionType: string) => {
    if (!resolutionPending) return
    const { taskId, source, editFields } = resolutionPending
    if (source === 'edit' && editFields) {
      updateTask(taskId, { ...editFields, status: 'done', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, ...editFields, status: 'done', resolution_type: resolutionType } : t))
    } else {
      updateTask(taskId, { status: 'done', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, status: 'done', resolution_type: resolutionType } : t))
    }
    setResolutionPending(null)
    setEditTask(null)
  }

  // ESC key closes detail panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDetailTask(null); setBugDetailsOpen(false) }
    }
    if (detailTask) { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }
  }, [detailTask])

  const sprints = Array.from(new Set(tasks.map(t=>t.sprint).filter(Boolean))).sort().reverse()
  const allFiltered = tasks.filter(t => {
    if (t.status === 'closed') return false
    if (filterTypes.length > 0 && !filterTypes.includes(t.type ?? '')) return false
    if (filterPriorities.length > 0 && !filterPriorities.includes(t.priority ?? '')) return false
    if (filterAssignees.length > 0 && !filterAssignees.includes(t.assignee ?? '')) return false
    if (filterSprint && t.sprint !== filterSprint) return false
    if (featureFilter && (t as any).parent_id !== featureFilter) return false
    return true
  })
  const filtered = allFiltered.slice(0, boardLimit)
  const hasMoreBoard = allFiltered.length > boardLimit

  const closedTasks = tasks.filter(t => t.status === 'closed')
  const filteredClosed = closedTasks
    .filter(t => !archiveProject || t.project === archiveProject)
    .filter(t => !archiveSearch || t.title.toLowerCase().includes(archiveSearch.toLowerCase()))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))

  const projects = Array.from(new Set(tasks.map(t=>t.project).filter(Boolean)))
  const assignees = Array.from(new Set(tasks.map(t=>t.assignee).filter(Boolean)))
  const types = Array.from(new Set(tasks.map(t=>t.type).filter(Boolean)))

  const isOverdue = (d?: string) => {
    if (!d) return false
    return new Date(d) < new Date(new Date().toDateString())
  }

  const selectCls = "bg-transparent border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-400 outline-none focus:border-zinc-600"
  const inputCls = "w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-zinc-600 placeholder-zinc-700"
  const labelCls = "text-[10px] uppercase tracking-widest text-zinc-600 mb-1"

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Toolbar — multiselect filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <MultiSelect label="Type" options={types as string[]} selected={filterTypes} onToggle={v => toggleFilter(filterTypes, setFilterTypes, v)} />
          <MultiSelect label="Priority" options={['critical','high','medium','low']} selected={filterPriorities} onToggle={v => toggleFilter(filterPriorities, setFilterPriorities, v)} />
          <MultiSelect label="Assignee" options={assignees as string[]} selected={filterAssignees} onToggle={v => toggleFilter(filterAssignees, setFilterAssignees, v)} displayFn={v => ASSIGNEE_MAP[v]?.name ?? v} />
          <select className={selectCls} value={filterSprint} onChange={e=>{setFilterSprint(e.target.value); setBoardLimit(100)}}>
            <option value="">All Sprints</option>
            {sprints.map(s=><option key={s} value={s!}>{s}</option>)}
          </select>
          {hasAnyFilter && <button onClick={clearAllFilters} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors">Clear all</button>}
          <div className="flex gap-0.5 p-0.5 rounded-lg border border-zinc-800" style={{background:'#0a0a0a'}}>
            <button onClick={() => { setGroupByFeature(false); localStorage.setItem('board-group-by','status') }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${!groupByFeature?'bg-zinc-700 text-white':'text-zinc-500 hover:text-zinc-300'}`}>
              Status
            </button>
            <button onClick={() => { setGroupByFeature(true); localStorage.setItem('board-group-by','feature') }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${groupByFeature?'bg-zinc-700 text-white':'text-zinc-500 hover:text-zinc-300'}`}>
              Feature
            </button>
          </div>
          <button onClick={() => setShowArchive(!showArchive)}
            className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${showArchive ? 'bg-zinc-700 text-white' : 'bg-zinc-800/60 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}>
            📦 Archive{closedTasks.length > 0 && <span className="ml-1 text-zinc-500">({closedTasks.length})</span>}
          </button>
          {!showArchive && <button onClick={()=>setNewTask({status:'backlog',priority:'medium'})}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">
            + New Task
          </button>}
        </div>
        {/* Active filter chips */}
        {hasAnyFilter && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {featureFilter && featureFilterName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                Feature: {featureFilterName}
                <button onClick={onClearFeatureFilter} className="hover:text-white ml-0.5">×</button>
              </span>
            )}
            {filterTypes.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                {v}
                <button onClick={() => removeFilter(filterTypes, setFilterTypes, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
            {filterPriorities.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                {v}
                <button onClick={() => removeFilter(filterPriorities, setFilterPriorities, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
            {filterAssignees.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                {ASSIGNEE_MAP[v]?.name ?? v}
                <button onClick={() => removeFilter(filterAssignees, setFilterAssignees, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Archive View */}
      {showArchive && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Search closed tasks..." value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)}
              className="bg-transparent border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-600 placeholder-zinc-700 w-52" />
            <select className={selectCls} value={archiveProject} onChange={e => setArchiveProject(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p} value={p!}>{p}</option>)}
            </select>
            <span className="text-[10px] text-zinc-600 ml-auto">{filteredClosed.length} closed task{filteredClosed.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {filteredClosed.length === 0 && <p className="text-zinc-700 text-xs text-center py-8">No closed tasks</p>}
            {filteredClosed.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800/60 hover:border-zinc-700 transition-colors" style={{background:'#0f0f0f'}}>
                <p className="text-sm text-zinc-300 flex-1 truncate">{t.title}</p>
                {t.project && <Chip label={t.project} color={PROJECT_COLORS[t.project] || undefined} />}
                {t.resolution_type && <Chip label={RESOLUTION_OPTIONS.find(r => r.value === t.resolution_type)?.label ?? t.resolution_type} color={RESOLUTION_BADGE_COLORS[t.resolution_type] ?? '#71717a'} />}
                {t.assignee && ASSIGNEE_MAP[t.assignee] && <span className="text-[10px] text-zinc-500 whitespace-nowrap">{ASSIGNEE_MAP[t.assignee].emoji} {ASSIGNEE_MAP[t.assignee].name}</span>}
                {t.updated_at && <span className="text-[10px] text-zinc-600 whitespace-nowrap">{new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MC-87: Feature-grouped view */}
      {!showArchive && groupByFeature && (() => {
        // Group tasks by parent_id (feature)
        const features = tasks.filter(t => t.type === 'feature' || t.type === 'epic')
        const featureGroups: { feature: Task | null; label: string; children: Task[] }[] = []
        const parentIds = Array.from(new Set(filtered.map(t => (t as any).parent_id).filter(Boolean)))
        // Add features that have children in filtered set
        for (const pid of parentIds) {
          const feat = features.find(f => f.id === pid)
          featureGroups.push({
            feature: feat || null,
            label: feat?.title || 'Unknown Feature',
            children: filtered.filter(t => (t as any).parent_id === pid)
          })
        }
        // Unassigned: tasks without parent_id
        const unassigned = filtered.filter(t => !(t as any).parent_id)
        if (unassigned.length > 0) featureGroups.push({ feature: null, label: 'Unassigned', children: unassigned })
        // Sort: features with priority, then unassigned last
        featureGroups.sort((a, b) => {
          if (!a.feature && b.feature) return 1
          if (a.feature && !b.feature) return -1
          const pa = a.feature?.priority || 'low'
          const pb = b.feature?.priority || 'low'
          const po = ['critical','high','medium','low']
          return po.indexOf(pa) - po.indexOf(pb)
        })
        const [expandedFeatures, setExpandedFeaturesLocal] = [
          new Set(featureGroups.map(g => g.label)),
          (_: any) => {}
        ]
        return (
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {featureGroups.map(group => {
              const statusCounts = BOARD_COLUMNS.reduce((acc, col) => {
                acc[col.id] = group.children.filter(t => t.status === col.id).length; return acc
              }, {} as Record<string, number>)
              return (
                <div key={group.label} className="rounded-xl border border-zinc-800/60 overflow-hidden" style={{background:'#0a0a0a'}}>
                  <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                    style={{borderLeft: group.feature ? `3px solid ${PRIORITY_COLORS[group.feature.priority||'medium']||'#3f3f46'}` : '3px solid #27272a'}}>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-zinc-200">{group.label}</span>
                      {group.feature?.project && <span className="ml-2 text-[10px] text-zinc-500">{group.feature.project}</span>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {BOARD_COLUMNS.map(col => statusCounts[col.id] > 0 ? (
                        <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                          style={{color: col.color, background: col.color + '18', border: `1px solid ${col.color}30`}}>
                          {statusCounts[col.id]}
                        </span>
                      ) : null)}
                    </div>
                    <span className="text-[10px] text-zinc-600">{group.children.length}</span>
                  </div>
                  <div className="border-t border-zinc-800/40">
                    {group.children.map(task => {
                      const col = BOARD_COLUMNS.find(c => c.id === task.status)
                      return (
                        <div key={task.id} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-800/20 transition-colors cursor-pointer border-b border-zinc-800/30 last:border-b-0"
                          onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{background: col?.color || '#3f3f46'}} />
                          <p className="text-sm text-zinc-300 flex-1 truncate">{task.title}</p>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                            style={{color: col?.color || '#71717a', background: (col?.color || '#71717a') + '18', border: `1px solid ${col?.color || '#71717a'}30`}}>
                            {col?.label || task.status}
                          </span>
                          {task.assignee && ASSIGNEE_MAP[task.assignee] && (
                            <span className="text-[10px] text-zinc-500 shrink-0">{ASSIGNEE_MAP[task.assignee].emoji}</span>
                          )}
                          {(task as any).task_key && <span className="text-[9px] font-mono text-zinc-600 shrink-0">{(task as any).task_key}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {featureGroups.length === 0 && <p className="text-zinc-700 text-xs text-center py-8">No tasks match filters</p>}
          </div>
        )
      })()}

      {/* Mobile column tabs */}
      {!showArchive && !groupByFeature && <div className="flex md:hidden gap-1 overflow-x-auto pb-1">
        {BOARD_COLUMNS.map(col=>(
          <button key={col.id} onClick={()=>setMobileCol(col.id)}
            className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors '+(mobileCol===col.id?'bg-zinc-800 text-white':'text-zinc-500 hover:text-zinc-300')}
            style={mobileCol===col.id?{borderBottom:`2px solid ${col.color}`}:{}}>
            {col.label} <span className="text-zinc-600 ml-1">{filtered.filter(t=>t.status===col.id).length}</span>
          </button>
        ))}
      </div>}

      {/* Columns */}
      {!showArchive && !groupByFeature && <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-0">
        {BOARD_COLUMNS.map(col => {
          const colTasks = filtered.filter(t => t.status===col.id)
          return (
            <div key={col.id}
              className={`flex-shrink-0 w-full md:w-64 flex flex-col rounded-xl bg-zinc-900/50 ${col.id !== mobileCol ? 'hidden md:flex' : ''}`}
              style={{borderTop:`2px solid ${col.color}`}}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}>
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{background:col.color}} />
                  <span className="text-xs font-semibold text-zinc-400">{col.label} ({colTasks.length})</span>
                  {col.id === 'done' && filtered.length > 0 && (
                    <span className="text-[10px] text-zinc-600 font-mono">{Math.round((colTasks.length / filtered.length) * 100)}%</span>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
                {loading && <div className="text-zinc-700 text-xs text-center py-4">Loading...</div>}
                {!loading && colTasks.length === 0 && <div className="flex flex-col items-center py-6 text-zinc-700"><span className="text-2xl mb-1">📋</span><p className="text-[10px]">No tasks</p></div>}
                {colTasks.map(task => (
                  <div key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                    className={`group rounded-xl border p-3 cursor-pointer transition-colors border-l-2 ${
                      task.priority==='critical'?'border-l-red-500':task.priority==='high'?'border-l-orange-400':task.priority==='medium'?'border-l-blue-400':'border-l-zinc-600'
                    } ${dragId===task.id ? 'opacity-50' : ''}`}
                    style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a', borderLeftColor: task.priority==='critical'?'#ef4444':task.priority==='high'?'#fb923c':task.priority==='medium'?'#60a5fa':'#52525b'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderRightColor='#3f3f46';e.currentTarget.style.borderTopColor='#3f3f46';e.currentTarget.style.borderBottomColor='#3f3f46'}}
                    onMouseLeave={e=>{const bc=dragId===task.id?'#555':'#27272a';e.currentTarget.style.borderRightColor=bc;e.currentTarget.style.borderTopColor=bc;e.currentTarget.style.borderBottomColor=bc}}>
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-white text-sm font-medium leading-snug mb-1">{task.title}</p>
                      {col.id === 'done' && closedConfirm === task.id && (
                        <span className="text-[10px] text-green-400 whitespace-nowrap animate-pulse">Archived ✓</span>
                      )}
                      {col.id === 'done' && closedConfirm !== task.id && (
                        <button onClick={e => { e.stopPropagation(); closeTask(task.id) }}
                          className="text-[10px] text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap px-1 py-0.5 rounded hover:bg-zinc-800">
                          × Close
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between mb-1">
                      {task.project && <p className="text-xs text-zinc-500">{task.project}</p>}
                      {(task as any).task_key && <span className="text-[9px] font-mono text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded">{(task as any).task_key}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {task.project && <Chip label={task.project} color={PROJECT_COLORS[task.project]||undefined} />}
                      {task.type && <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{color:TYPE_COLORS[task.type]||'#71717a',background:(TYPE_COLORS[task.type]||'#71717a')+'18',border:`1px solid ${(TYPE_COLORS[task.type]||'#71717a')}30`}}>{task.type}</span>}
                      {task.status === 'done' && task.resolution_type && (
                        <Chip label={RESOLUTION_OPTIONS.find(r=>r.value===task.resolution_type)?.label ?? task.resolution_type}
                          color={RESOLUTION_BADGE_COLORS[task.resolution_type] ?? '#71717a'} />
                      )}
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

              {/* Quick-add inline */}
              {quickAddCol === col.id ? (
                <form className="mx-2 mb-2 flex gap-1" onSubmit={async e=>{
                  e.preventDefault()
                  if(!quickAddTitle.trim()) return
                  await createTask({title:quickAddTitle.trim(),status:col.id,priority:'medium',project:'Infrastructure',assignee:'main',type:'feature',acceptance_criteria:'To be defined'})
                  setQuickAddTitle(''); setQuickAddCol(null)
                }}>
                  <input autoFocus value={quickAddTitle} onChange={e=>setQuickAddTitle(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Escape'){setQuickAddCol(null);setQuickAddTitle('')} }}
                    placeholder="Task title..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-zinc-500 placeholder-zinc-600" />
                  <button type="submit" className="text-[10px] px-2 py-1.5 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600">Add</button>
                  <button type="button" onClick={()=>{setQuickAddCol(null);setQuickAddTitle('')}} className="text-[10px] px-1.5 text-zinc-500 hover:text-zinc-300">✕</button>
                </form>
              ) : (
                <button onClick={()=>{setQuickAddCol(col.id);setQuickAddTitle('')}}
                  className="mx-2 mb-2 text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors py-1 text-left w-[calc(100%-16px)]">
                  + Add task
                </button>
              )}
            </div>
          )
        })}
      </div>}

      {/* Load more */}
      {!showArchive && hasMoreBoard && (
        <button onClick={() => setBoardLimit(prev => prev + 100)}
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg border border-zinc-800/40 hover:border-zinc-600 transition-all"
          style={{background:'#0a0a0a'}}>
          Load 100 more ({allFiltered.length - boardLimit} remaining)
        </button>
      )}

      {/* New Task Modal */}
      {newTask && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setNewTask(null)}>
          <div className="w-full max-w-md md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
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
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setEditTask(null)}>
          <div className="w-full max-w-md md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
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
              <button onClick={()=>{
                const fields = {title:editTask.title,description:editTask.description,status:editTask.status,
                  priority:editTask.priority,project:editTask.project,assignee:editTask.assignee,type:editTask.type,due_date:editTask.due_date}
                const origTask = tasks.find(t=>t.id===editTask.id)
                if (editTask.status==='done' && origTask?.status!=='done') {
                  setResolutionPending({taskId:editTask.id,source:'edit',editFields:fields})
                } else {
                  updateTask(editTask.id,fields)
                }
              }}
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

      {/* Resolution Type Picker */}
      {resolutionPending && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={()=>setResolutionPending(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-zinc-800 p-5 space-y-4" style={{background:'#18181b'}} onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm text-center">How was this resolved?</h3>
            <div className="flex flex-wrap gap-2 justify-center">
              {RESOLUTION_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => handleResolutionSelect(opt.value)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 transition-colors">
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
            <div className="flex justify-center pt-1">
              <button onClick={()=>setResolutionPending(null)} className="text-xs text-zinc-500 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Panel */}
      {detailTask && (() => {
        const t = tasks.find(tk => tk.id === detailTask.id) ?? detailTask
        const hasAcceptance = !!t.acceptance_criteria?.trim()
        const acLines = (t.acceptance_criteria ?? '').split('\n').filter(l => l.trim())
        const isBug = t.type === 'bug'
        const stepsLines = (t.steps_to_reproduce ?? '').split('\n').filter(l => l.trim())
        return (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => { setDetailTask(null); setBugDetailsOpen(false) }}>
            <div className="w-full md:w-[480px] h-full border-l border-zinc-800 overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-zinc-800" style={{background:'#0a0a0a'}}>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditTask(t); setDetailTask(null); setBugDetailsOpen(false) }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800">Edit</button>
                </div>
                <button onClick={() => { setDetailTask(null); setBugDetailsOpen(false) }}
                  className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">&times;</button>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* Blocked banner */}
                {t.blocked_by && (
                  <div className="rounded-xl px-4 py-2.5 border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium">
                    🚫 Blocked by: {t.blocked_by}
                  </div>
                )}

                {/* Title */}
                {(t as any).task_key && <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">{(t as any).task_key}</span>}
                <h2 className="text-white text-lg font-semibold leading-snug">{t.title}</h2>

                {/* Status + Priority badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {t.status && (() => {
                    const col = BOARD_COLUMNS.find(c => c.id === t.status)
                    return col ? <Chip label={col.label} color={col.color} /> : null
                  })()}
                  {t.priority && <Chip label={t.priority} color={PRIORITY_COLORS[t.priority]} />}
                  {t.type && <Chip label={t.type} />}
                </div>

                {/* Assignee + Project */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Assignee</p>
                    <p className="text-sm text-zinc-300">
                      {t.assignee && ASSIGNEE_MAP[t.assignee] ? `${ASSIGNEE_MAP[t.assignee].emoji} ${ASSIGNEE_MAP[t.assignee].name}` : 'Unassigned'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Project</p>
                    <p className="text-sm text-zinc-300">{t.project || '—'}</p>
                  </div>
                </div>

                {/* Description */}
                {t.description && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Description</p>
                    <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">{t.description}</p>
                  </div>
                )}

                {/* DoR / Acceptance Criteria */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600">Acceptance Criteria</p>
                    {hasAcceptance
                      ? <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[10px] flex items-center justify-center">✓</span>
                      : <span className="w-4 h-4 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] flex items-center justify-center">!</span>
                    }
                  </div>
                  {hasAcceptance ? (
                    <div className="space-y-1.5">
                      {acLines.map((line, i) => (
                        <label key={i} className="flex items-start gap-2 text-sm text-zinc-400 cursor-default">
                          <input type="checkbox" className="mt-1 accent-green-500 pointer-events-auto" readOnly />
                          <span>{line.replace(/^[-*•]\s*/, '')}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600 italic">No acceptance criteria defined</p>
                  )}
                </div>

                {/* Bug Details */}
                {isBug && (
                  <div className="border border-zinc-800 rounded-xl overflow-hidden">
                    <button onClick={() => setBugDetailsOpen(!bugDetailsOpen)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-zinc-400 hover:bg-zinc-900/50 transition-colors">
                      <span>🐛 Bug Details</span>
                      <span className="text-zinc-600">{bugDetailsOpen ? '▾' : '▸'}</span>
                    </button>
                    {bugDetailsOpen && (
                      <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">
                        {t.steps_to_reproduce && (
                          <div className="pt-3">
                            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">Steps to Reproduce</p>
                            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1">
                              {stepsLines.map((s, i) => <li key={i}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}
                            </ol>
                          </div>
                        )}
                        {t.expected_behavior && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Expected Behavior</p>
                            <p className="text-sm text-zinc-400">{t.expected_behavior}</p>
                          </div>
                        )}
                        {t.actual_behavior && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Actual Behavior</p>
                            <p className="text-sm text-zinc-400">{t.actual_behavior}</p>
                          </div>
                        )}
                        {t.environment && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Environment</p>
                            <p className="text-sm text-zinc-400">{t.environment}</p>
                          </div>
                        )}
                        {!t.steps_to_reproduce && !t.expected_behavior && !t.actual_behavior && !t.environment && (
                          <p className="text-xs text-zinc-600 italic pt-3">No bug details provided</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* PR URL */}
                {t.pr_url && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Pull Request</p>
                    <a href={t.pr_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 underline break-all">{t.pr_url}</a>
                  </div>
                )}

                {/* Resolution */}
                {t.status === 'done' && t.resolution_type && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Resolution</p>
                    <Chip label={RESOLUTION_OPTIONS.find(r => r.value === t.resolution_type)?.label ?? t.resolution_type!}
                      color={RESOLUTION_BADGE_COLORS[t.resolution_type] ?? '#71717a'} />
                  </div>
                )}

                {/* Timestamps */}
                <div className="pt-4 border-t border-zinc-800 flex flex-wrap gap-x-6 gap-y-1">
                  {t.created_at && (
                    <p className="text-[10px] text-zinc-600">Created: {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  {t.updated_at && (
                    <p className="text-[10px] text-zinc-600">Updated: {new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Search Overlay ──────────────────────────────────────────────────────────
function SearchOverlay({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (tab: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    fetch(`${SUPA}/rest/v1/issues?title=ilike.*${encodeURIComponent(q)}*&limit=20&order=updated_at.desc`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setResults(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" style={{ background: 'rgba(0,0,0,0.80)' }} onClick={onClose}>
      <div className="w-full max-w-xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="rounded-2xl border border-zinc-700 overflow-hidden" style={{ background: '#111' }}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
            <Search size={16} className="text-zinc-500 shrink-0" />
            <input ref={inputRef} value={query} onChange={e => handleChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onClose() }}
              placeholder="Search issues..." className="flex-1 bg-transparent text-white text-sm outline-none placeholder-zinc-600" />
            <kbd className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5">ESC</kbd>
          </div>
          {loading && <div className="px-4 py-3 text-zinc-600 text-xs">Searching...</div>}
          {!loading && results.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto">
              {results.map((r: any) => (
                <button key={r.id} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/60 transition-colors text-left border-b border-zinc-800/30 last:border-0"
                  onClick={() => { onClose(); onNavigate('board') }}>
                  {r.task_key && <span className="text-[9px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded shrink-0">{r.task_key}</span>}
                  <span className="text-sm text-white truncate flex-1">{r.title}</span>
                  {r.project && <Chip label={r.project} color={PROJECT_COLORS[r.project] || undefined} />}
                  {r.type && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ color: TYPE_COLORS[r.type] || '#71717a', background: (TYPE_COLORS[r.type] || '#71717a') + '18' }}>{r.type}</span>}
                </button>
              ))}
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-zinc-600 text-xs">No results found</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab]       = useState<Tab>(()=>{
    if(typeof window!=='undefined'){
      const saved = localStorage.getItem('mc-tab') as Tab|null
      if(saved && ['overview','activity','team','calendar','automations','office','memory','board','features','pipeline','issues','chat','infra'].includes(saved)) return saved
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
  const [showMobileMore, setShowMobileMore] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<any>(null)
  const [statusAt, setStatusAt] = useState<number>(0)
  const [agoSec, setAgoSec] = useState<number>(0)
  const [liveAgents, setLiveAgents] = useState<typeof ALL_AGENTS | null>(null)
  const [liveCrons, setLiveCrons] = useState<typeof CRONS | null>(null)
  const [projects, setProjects] = useState<any[]|null>(null)
  const [deployState, setDeployState] = useState<'idle'|'loading'|'done'>('idle')

  const [agentModal, setAgentModal] = useState<any>(null)
  const [cronModal, setCronModal] = useState<any>(null)
  const [unreadChat, setUnreadChat] = useState(false)
  const [runningWorkflow, setRunningWorkflow] = useState<string|null>(null)
  const [boardFeatureFilter, setBoardFeatureFilter] = useState<string|undefined>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('feature') ?? undefined
    }
    return undefined
  })
  const [boardFeatureFilterName, setBoardFeatureFilterName] = useState<string|undefined>(undefined)
  const [activityLimit, setActivityLimit] = useState(100)
  const [activityFilter, setActivityFilter] = useState<'all'|'issue'|'agent'|'pr'>('all')
  const [issueActivity, setIssueActivity] = useState<any[]>([])
  const [calendarView, setCalendarView] = useState<'week'|'month'>('week')
  const [calendarIssues, setCalendarIssues] = useState<any[]>([])

  // Fetch issues with due_date for calendar
  useEffect(() => {
    const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
    const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const headers = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    fetch(`${SUPA_URL}/rest/v1/issues?due_date=not.is.null&select=id,task_key,title,due_date,project,status&limit=200`, { headers })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCalendarIssues(data) })
      .catch(() => {})
  }, [])

  // Fetch issue status changes for activity feed
  useEffect(() => {
    const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
    const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const headers = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
    // Recent issues updated in last 7 days
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    fetch(`${SUPA_URL}/rest/v1/issues?updated_at=gte.${since}&order=updated_at.desc&limit=200&select=task_key,title,status,assignee,updated_at,resolution_type,sprint,type`, { headers })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return
        const entries = data.map((i: any) => {
          const agoMin = Math.round((Date.now() - new Date(i.updated_at).getTime()) / 60000)
          const assigneeInfo = AGENT_DISPLAY[i.assignee] || null
          return {
            type: 'issue',
            emoji: i.status === 'done' ? '✅' : i.status === 'in_progress' ? '🔧' : i.status === 'in_review' ? '👁' : '📋',
            agentId: i.assignee || 'system',
            agentName: assigneeInfo?.name || i.assignee || 'System',
            channel: i.task_key,
            action: 'issue',
            desc: `${i.title} → ${(i.status || '').replace(/_/g, ' ')}${i.resolution_type ? ` (${i.resolution_type.replace(/_/g, ' ')})` : ''}`,
            ago: agoMin,
            date: agoMin < 60 ? 'Today' : agoMin < 1440 ? 'Yesterday' : 'Earlier',
          }
        })
        setIssueActivity(entries)
      }).catch(() => {})
  }, [tab])

  // Cmd+K search shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Listen for unread event from ChatTab
  useEffect(() => {
    const handler = () => setUnreadChat(true)
    window.addEventListener('mc-chat-unread', handler)
    return () => window.removeEventListener('mc-chat-unread', handler)
  }, [])

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
  // Faster 30s polling when on office tab
  useEffect(() => {
    if (tab !== 'office') return
    const interval = setInterval(async () => {
      const res = await fetch('/api/agents')
      if (res.ok) { const data = await res.json(); if (Array.isArray(data)) setLiveAgents(data) }
    }, 30000)
    return () => clearInterval(interval)
  }, [tab])
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
    {id:'vespera',name:'Vespera',desc:'Colombia Goth Community',emoji:'🦇',startDate:'2026-03-22',deadline:'2026-03-31',totalDays:9,color:'#a855f7',borderColor:'border-purple-900/30',bg:'#0f0a14',bgDark:'#0f0a14'},
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
          {NAV.map(item=>{
            if (item.id === 'divider') return <div key="divider" className="border-t border-zinc-800 my-2" />
            const LIcon = LUCIDE_ICONS[item.id]
            return (
            <button key={item.id} onClick={()=>{ setTab(item.id as Tab); if(item.id==='chat') setUnreadChat(false); if(typeof window!=='undefined') localStorage.setItem('mc-tab',item.id) }}
              className={'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all border-l-2 '+(
                tab===item.id ? 'bg-zinc-800 text-white border-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border-transparent'
              )}>
              {LIcon ? <LIcon size={14} className="shrink-0" /> : <span className="text-sm shrink-0">{item.icon}</span>}
              <span className="text-xs font-medium">{item.label}</span>
              {item.id === 'chat' && unreadChat && tab !== 'chat' && (
                <span className="ml-auto w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
              )}
            </button>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t border-zinc-800/40 space-y-1">
          <div className="flex items-center gap-1.5">
            <Dot status="active" sm />
            <span className="text-zinc-600 text-[10px]">All nominal</span>
          </div>
          <p className="text-zinc-700 text-[10px] font-mono">{clock}</p>
        </div>
      </aside>

      {/* MOBILE BOTTOM TAB BAR */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950 border-t border-zinc-800 flex justify-around px-1" style={{paddingBottom: "env(safe-area-inset-bottom, 16px)"}}>
        {(["overview","office","calendar","chat"] as Tab[]).map(id => {
          const item = NAV.find(n => n.id === id)!
          const LIcon = LUCIDE_ICONS[id]
          return (
            <button key={id} onClick={() => { setTab(id); setShowMobileMore(false); if(id==='chat') setUnreadChat(false); localStorage.setItem("mc-tab", id) }}
              className={"flex flex-col items-center gap-0.5 px-2 py-2 min-w-[50px] text-xs " + (tab === id ? "text-white" : "text-zinc-500")}>
              {LIcon ? <LIcon size={18} /> : <span>{item.icon}</span>}
              <span className="text-[9px]">{item.label.split(" ")[0]}</span>
            </button>
          )
        })}
        {/* More button */}
        <button onClick={() => setShowMobileMore(v => !v)}
          className={"flex flex-col items-center gap-0.5 px-2 py-2 min-w-[50px] text-xs " + (showMobileMore ? "text-white" : "text-zinc-500")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
          <span className="text-[9px]">More</span>
        </button>
      </nav>

      {/* MOBILE MORE MENU */}
      {showMobileMore && (
        <div className="lg:hidden fixed bottom-[56px] left-0 right-0 z-50 border-t border-zinc-800" style={{background:'#0a0a0a', paddingBottom:0}}>
          <div className="grid grid-cols-3 gap-px p-2">
            {NAV.filter(n => n.id !== 'divider' && !["overview","office","calendar","chat"].includes(n.id)).map(item => {
              const LIcon = LUCIDE_ICONS[item.id]
              return (
                <button key={item.id} onClick={() => { setTab(item.id as Tab); setShowMobileMore(false); if(item.id==='chat') setUnreadChat(false); localStorage.setItem("mc-tab", item.id) }}
                  className={"flex flex-col items-center gap-1 p-3 rounded-xl text-xs " + (tab === item.id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900")}>
                  {LIcon ? <LIcon size={20} /> : <span className="text-lg">{item.icon}</span>}
                  <span className="text-[10px]">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* MAIN */}
      <div className="flex-1 flex flex-col h-screen overflow-auto">
        <header className="border-b border-zinc-800/40 px-3 md:px-6 h-11 flex items-center justify-between shrink-0 sticky top-0 z-20" style={{background:'#090909'}}>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 text-sm font-medium capitalize">{tab}</span>
            <span className="text-zinc-700 text-xs">· Nabit LLC</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setSearchOpen(true)} className="text-zinc-600 hover:text-zinc-300 transition-colors" title="Search (⌘K)">
              <Search size={15} />
            </button>
            <span className="text-zinc-600 text-xs">
              {new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-6 py-5 pb-20 lg:pb-5 overflow-x-hidden">

          {/* ── OVERVIEW ── */}
          {tab==='overview' && (
            <div className="space-y-5">

              {/* ── Project Health Card ── */}
              {(()=>{
                const allProjects = sprintProjects.filter(p => p.taskCounts && p.taskCounts.total > 0)
                const sorted = [...allProjects].sort((a,b) => (a.taskProgress ?? 0) - (b.taskProgress ?? 0))
                if (!sorted.length) return null
                return (
                  <div className="rounded-2xl border border-zinc-800/60 p-4 md:p-5" style={{background:'#0f0f0f'}}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">📊</span>
                        <span className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Project Health</span>
                      </div>
                      <span className="text-zinc-700 text-[10px]">sorted by progress ↑</span>
                    </div>
                    <div className="space-y-3.5">
                      {sorted.map(proj => {
                        const tc = proj.taskCounts!
                        const pct = proj.taskProgress ?? 0
                        const isLow = pct < 30
                        const isMid = pct >= 30 && pct < 70
                        const barColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        const statusLabel = isLow ? 'Needs work' : isMid ? 'In progress' : 'Nearly done'
                        const statusColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        return (
                          <div key={proj.id}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base shrink-0">{proj.emoji}</span>
                                <span className="text-white text-xs font-medium truncate">{proj.name}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
                                  style={{background: statusColor+'18', color: statusColor}}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-zinc-400 text-xs tabular-nums font-medium">{tc.done}<span className="text-zinc-700">/{tc.total}</span></span>
                                <span className="text-zinc-600 text-[10px] tabular-nums w-8 text-right">{pct}%</span>
                              </div>
                            </div>
                            <Bar v={pct} color={barColor} bg='#1a1a1a' />
                            {(tc.inProgress > 0 || tc.open > 0) && (
                              <div className="flex gap-3 mt-1">
                                {tc.inProgress > 0 && <span className="text-blue-400 text-[9px]">● {tc.inProgress} in progress</span>}
                                {tc.open > 0 && <span className="text-zinc-600 text-[9px]">○ {tc.open} open</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Sprint Progress Card (MC-102) */}
              <SprintProgressCard />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sprintProjects.map(proj=>{
                  const dl=new Date(proj.deadline), st=new Date(proj.startDate)
                  const left=daysUntil(dl), elap=daysSince(st), pct=miniPct(elap,proj.totalDays)
                  const dlLabel=dl.toLocaleDateString('en-US',{month:'short',day:'numeric'})
                  const isUrgent = left<=2 && proj.color!=='#ffffff'
                  return (
                    <div key={proj.id} className={`rounded-2xl p-4 md:p-5 border ${proj.borderColor} card-glow`} style={{background:proj.bg}}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="min-w-0 flex-1 mr-2">
                          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{color:proj.color==='#ffffff'?'#71717a':proj.color+'b3'}}>{proj.name}</p>
                          <p className="text-white text-xs sm:text-sm font-medium truncate">{proj.desc}</p>
                        </div>
                        <span className="text-xl">{proj.emoji}</span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                        <span className="text-3xl md:text-4xl font-bold tabular-nums" style={{color:isUrgent?'#ef4444':proj.color}}>{left}</span>
                        <span className="text-zinc-500 text-sm"> Days</span>
                        <span className="ml-auto text-zinc-600 text-xs">Day {elap}/{proj.totalDays}</span>
                      </div>
                      <Bar v={pct} color={proj.color} bg={proj.color==='#ffffff'?'#1e1e1e':'#1a0a2a'} />
                      <div className="flex flex-col sm:flex-row justify-between mt-1.5 gap-0.5">
                        <span className="text-zinc-600 text-[10px]">{pct}% elapsed</span>
                        <span className="text-zinc-600 text-[10px]">{dlLabel}</span>
                      </div>
                      {proj.taskCounts && proj.taskCounts.total > 0 && (
                        <div className="mt-3 pt-3 border-t border-zinc-800/40">
                          <div className="flex justify-between mb-1.5">
                            <span className="text-zinc-600 text-[10px]">Issues</span>
                            <span className="text-zinc-500 text-[10px]">{proj.taskCounts.done}/{proj.taskCounts.total} done</span>
                          </div>
                          <Bar v={proj.taskProgress} color='#10b981' bg='#0a1a12' />
                          <div className="flex gap-3 mt-1">
                            {proj.taskCounts.inProgress > 0 && <span className="text-blue-400 text-[9px]">● {proj.taskCounts.inProgress} active</span>}
                            {proj.taskCounts.open > 0 && <span className="text-zinc-600 text-[9px]">○ {proj.taskCounts.open} open</span>}
                          </div>
                        </div>
                      )}
                      {proj.activeFeatures && proj.activeFeatures.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-zinc-800/40">
                          <span className="text-zinc-600 text-[10px] font-semibold uppercase tracking-wider">Active Features</span>
                          <div className="mt-1.5 space-y-1.5">
                            {proj.activeFeatures.slice(0, 3).map((af: any) => (
                              <div key={af.id}>
                                <div className="flex items-center justify-between">
                                  <span className="text-zinc-400 text-[10px] truncate flex-1 min-w-0 mr-2">{af.title}</span>
                                  <span className="text-zinc-600 text-[9px] shrink-0">{af.done}/{af.total}</span>
                                </div>
                                <div className="w-full rounded-full h-1 mt-0.5" style={{background:'#1a1a1a'}}>
                                  <div className="h-1 rounded-full transition-all" style={{width:af.pct+'%',background:'#3b82f6'}} />
                                </div>
                              </div>
                            ))}
                          </div>
                          {proj.activeFeatures.length > 3 && (
                            <p className="text-zinc-600 text-[9px] mt-1">+{proj.activeFeatures.length - 3} more</p>
                          )}
                        </div>
                      )}
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

            </div>
          )}

          {/* ── ACTIVITY ── */}
          {tab==='activity' && (
            <div className="space-y-5">
              <SH icon="📡" sub={liveStatus?.recentActivity?.length ? `${(liveStatus.recentActivity?.length ?? 0) + issueActivity.length} entries · live` : undefined}>Activity Feed</SH>
              {/* Filter bar */}
              <div className="flex items-center gap-2">
                {(['all','agent','issue','pr'] as const).map(f => (
                  <button key={f} onClick={() => setActivityFilter(f)}
                    className={`text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all ${activityFilter === f ? 'border-blue-600 bg-blue-900/30 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}>
                    {f === 'all' ? '📡 All' : f === 'agent' ? '🤖 Agent Runs' : f === 'issue' ? '📋 Issue Changes' : '🔀 PR Events'}
                  </button>
                ))}
              </div>
              {(()=>{
                const agentItems = (liveStatus?.recentActivity ?? []).map((e: any) => ({...e, type: e.type || 'agent'}))
                const issueItems = issueActivity
                let allItems: any[] = []
                if (activityFilter === 'all') allItems = [...agentItems, ...issueItems].sort((a,b) => (a.ago ?? 999) - (b.ago ?? 999))
                else if (activityFilter === 'agent') allItems = agentItems
                else if (activityFilter === 'issue') allItems = issueItems
                else allItems = agentItems.filter((e: any) => e.channel?.includes('PR') || e.desc?.toLowerCase().includes('pr ') || e.desc?.toLowerCase().includes('pull'))
                if(allItems.length === 0) return <EmptyState icon="📡" message={activityFilter === 'all' ? 'No activity runs recorded yet' : `No ${activityFilter} activity found`} action="Refresh" />
                const items = allItems.slice(0, activityLimit)
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
                        const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':entry.action==='issue'?'#22c55e':'#3b82f6'
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
                                {entry.type === 'issue' && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                                  style={{background:'#22c55e20',color:'#22c55e'}}>issue</span>}
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

              {/* Load more activity */}
              {((liveStatus?.recentActivity?.length ?? 0) + issueActivity.length) > activityLimit && (
                <button onClick={() => setActivityLimit(prev => prev + 100)}
                  className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg border border-zinc-800/40 hover:border-zinc-600 transition-all"
                  style={{background:'#0a0a0a'}}>
                  Load 100 more
                </button>
              )}

              {/* Needs Attention + Shipped Today */}
              <AttentionAndShipped agents={displayAgents} />
            </div>
          )}

          {/* ── TEAM ── */}
          {tab==='team' && (
            <div className="space-y-6">
              {liveAgents && <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-zinc-600 text-[10px]">Live agent data · {displayAgents.length} agents</span></div>}
              {displayAgents.length === 0 && <EmptyState icon="👥" message="No agents registered yet" />}

              {/* Lead agent card */}
              {displayAgents.length > 0 && <div className="flex justify-center">
                <div className="rounded-2xl p-4 md:p-6 border border-zinc-700/50 card-glow w-full max-w-xs sm:max-w-sm cursor-pointer hover:border-zinc-600 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setAgentModal(displayAgents[0])}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{background:'#1a1a1a'}}>
                      {displayAgents[0].emoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{displayAgents[0].name}</p>
                        <Dot status={displayAgents[0].status} />
                        {displayAgents[0].modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{displayAgents[0].modelShort}</span>}
                      </div>
                      <p className="text-zinc-500 text-xs">{displayAgents[0].role}</p>
                      <p className="text-amber-600/60 text-[10px] font-mono mt-0.5">Never audited</p>
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
                {displayAgents.slice(1).filter((a:any)=>a.status!=='planned').sort((a:any,b:any)=>{
                  if(a.status==='active'&&b.status!=='active') return -1
                  if(b.status==='active'&&a.status!=='active') return 1
                  return (a.ago??9999)-(b.ago??9999)
                }).map((a:any)=>(
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
                          {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{a.modelShort}</span>}
                          {a.ago > 1440 && ['ops','deployer','main'].includes(a.id) && (
                            <span title="Idle >24h" className="text-yellow-500 text-xs">⚠️</span>
                          )}
                        </div>
                        <p className="text-zinc-500 text-xs truncate">{a.role}</p>
                        <p className="text-zinc-700 text-[10px] font-mono truncate">
                          {a.ago > 0 ? (a.ago < 60 ? `Active ${a.ago}m ago` : a.ago < 1440 ? `Active ${Math.floor(a.ago/60)}h ago` : `Idle ${Math.floor(a.ago/1440)}d`) : a.status === 'active' ? 'Active now' : 'Idle'}
                        </p>
                        <p className="text-amber-600/60 text-[10px] font-mono truncate">Never audited</p>
                      </div>
                    </div>
                    {a.currentTask && <p className="text-zinc-400 text-[10px] mb-2 truncate">↳ {a.currentTask.slice(0,50)}</p>}
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
                            {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{a.modelShort}</span>}
                          </div>
                          <p className="text-zinc-600 text-xs truncate">{a.role}</p>
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


              {/* Agent Detail Modal */}
              {agentModal && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setAgentModal(null)}>
                  <div className="w-full max-w-md md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-2xl md:text-3xl shrink-0" style={{background:agentModal.color+'18',border:'1px solid '+agentModal.color+'30'}}>
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
          {tab==='calendar' && (()=>{
            const calIssues = (calendarIssues ?? []) as any[]
            const calSprints = (sprintProjects ?? []) as any[]
            const calView = calendarView
            // Helper: get week dates
            const getWeekDates = () => {
              const now = new Date()
              const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
              return Array.from({length:7},(_,i)=>{ const d=new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i); return d })
            }
            // Helper: get month dates grid (6 weeks)
            const getMonthDates = () => {
              const now = new Date()
              const first = new Date(now.getFullYear(), now.getMonth(), 1)
              const startDay = first.getDay()
              const start = new Date(first); start.setDate(1 - startDay)
              return Array.from({length:42},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return d })
            }
            const dates = calView === 'week' ? getWeekDates() : getMonthDates()
            const todayStr = new Date().toISOString().slice(0,10)
            // Group issues by due_date
            const issuesByDate: Record<string,any[]> = {}
            calIssues.forEach((iss:any) => {
              if (!iss.due_date) return
              const d = iss.due_date.slice(0,10)
              if (!issuesByDate[d]) issuesByDate[d] = []
              issuesByDate[d].push(iss)
            })
            // Sprint ranges
            const sprintRanges = calSprints.map((p:any)=>({
              name: p.name || p.id,
              color: p.color || '#3b82f6',
              start: p.startDate || p.start_date,
              end: p.deadline || p.end_date,
            })).filter(s=>s.start && s.end)
            const isInSprint = (dateStr:string, s:any) => dateStr >= s.start && dateStr <= s.end
            const projColor = (p:string) => p==='Vespera'?'#a855f7':p==='Kemuni'?'#3b82f6':p==='Infrastructure'?'#f59e0b':'#6b7280'
            // Cron label helper
            const cronLabel = (c:any) => (c.name || c.desc || c.id.replace(/-/g,' '))

            return (
            <div className="space-y-5">
              {/* View toggle */}
              <div className="flex items-center justify-between">
                <SH icon="📅">Calendar</SH>
                <div className="flex gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800/60">
                  {(['week','month'] as const).map(v=>(
                    <button key={v} onClick={()=>setCalendarView(v)}
                      className={'px-3 py-1 text-[11px] font-semibold rounded-md transition-all '+(calView===v?'bg-white text-black':'text-zinc-500 hover:text-zinc-300')}>
                      {v === 'week' ? 'Week' : 'Month'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sprint boundary blocks */}
              {sprintRanges.length>0 && (
                <div className="flex flex-wrap gap-2">
                  {sprintRanges.map((s,i)=>(
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs"
                      style={{borderColor:s.color+'40',background:s.color+'10',color:s.color}}>
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-zinc-500 font-mono text-[10px]">{s.start} — {s.end}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Always Running */}
              <div>
                <SH icon="⚡">Always Running</SH>
                <div className="flex flex-wrap gap-2">
                  {CRONS.filter(c=>c.days==='daily'&&c.status==='active').map(c=>(
                    <div key={c.id} className="flex items-center gap-2 px-2.5 md:px-3 py-1.5 rounded-full border cursor-pointer hover:brightness-125 transition-all"
                      style={{background:pColor(c.project)+'15',borderColor:pColor(c.project)+'40'}}
                      onClick={()=>setCronModal(c)}>
                      <Dot status="active" sm />
                      <span className="text-xs font-medium" style={{color:pColor(c.project)}}>{cronLabel(c)}</span>
                      <span className="text-zinc-600 text-[10px]">· {c.time}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{c.model}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Calendar Grid */}
              <div>
                <SH icon={calView==='week'?"📅":"🗓"}>{ calView==='week'?'This Week':'This Month'}</SH>
                <div className="overflow-x-auto -mx-1 px-1"><div className={'grid grid-cols-7 gap-1 min-w-[580px]'}>
                  {/* Day headers */}
                  {DAYS.map((day,di)=>(
                    <div key={day} className={'text-center text-[10px] font-semibold py-1 rounded-lg '+(
                      di===todayIdx && calView==='week' ? 'bg-white text-black' : 'text-zinc-500 bg-zinc-900/50'
                    )}>
                      {day}
                    </div>
                  ))}
                  {/* Date cells */}
                  {dates.map((d,i)=>{
                    const ds = d.toISOString().slice(0,10)
                    const isToday = ds === todayStr
                    const isCurrentMonth = d.getMonth() === new Date().getMonth()
                    const dayIssues = issuesByDate[ds] || []
                    const dayCrons = displayCrons.filter((c:any)=>{
                      if(c.days==='daily') return true
                      if(c.days===DAYS[d.getDay()]) return true
                      return false
                    })
                    const inSprints = sprintRanges.filter(s=>isInSprint(ds,s))
                    return (
                      <div key={i} className={'rounded-lg border p-1.5 min-h-[60px] '+(calView==='month'?'min-h-[48px]':'')}
                        style={{
                          background: isToday?'#1a1a30':inSprints.length>0?(inSprints[0].color+'08'):'#0a0a0a',
                          borderColor: isToday?'#ffffff30':inSprints.length>0?(inSprints[0].color+'25'):'#1e1e1e',
                          opacity: calView==='month'&&!isCurrentMonth?0.4:1,
                        }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={'text-[10px] font-mono '+(isToday?'text-white font-bold':'text-zinc-500')}>{d.getDate()}</span>
                          {inSprints.map((s,si)=>(
                            <span key={si} className="text-[7px] px-1 rounded" style={{background:s.color+'20',color:s.color}}>{s.name.slice(0,3)}</span>
                          ))}
                        </div>
                        {/* Issue due dates */}
                        {dayIssues.slice(0,3).map((iss:any)=>(
                          <div key={iss.id} className="text-[9px] leading-tight mb-0.5 px-1 py-0.5 rounded truncate cursor-pointer hover:brightness-125"
                            style={{background:projColor(iss.project)+'18',color:projColor(iss.project),borderLeft:`2px solid ${projColor(iss.project)}`}}
                            title={`${iss.task_key}: ${iss.title}`}>
                            {iss.task_key}: {iss.title?.slice(0,20)}
                          </div>
                        ))}
                        {dayIssues.length>3 && <div className="text-[8px] text-zinc-600">+{dayIssues.length-3} more</div>}
                        {/* Cron events (compact in month view) */}
                        {calView==='week' && dayCrons.slice(0,3).map((c:any)=>(
                          <div key={c.id} className="text-[9px] leading-tight mb-0.5 px-1 py-0.5 rounded truncate cursor-pointer hover:brightness-125"
                            style={{background:'#ffffff06',color:'#888'}}
                            onClick={()=>setCronModal(c)}>
                            {c.time} {cronLabel(c)}
                          </div>
                        ))}
                        {calView==='month' && dayCrons.length>0 && (
                          <div className="text-[8px] text-zinc-600">{dayCrons.length} cron{dayCrons.length>1?'s':''}</div>
                        )}
                      </div>
                    )
                  })}
                </div></div>
              </div>
              <div>
                <SH icon="⏭">Next Up</SH>
                <div className="space-y-2">
                  {nextRuns.map(({cron,mins},i)=>(
                    <div key={cron.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 md:px-5 py-3 rounded-xl border border-zinc-800/60 cursor-pointer hover:border-zinc-600 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setCronModal(cron)}>
                      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                        <span className="text-zinc-600 text-xs shrink-0">#{i+1}</span>
                        <Dot status={cron.status} />
                        <span className="font-mono text-xs text-white truncate">{cron.id}</span>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                        <span className="text-zinc-500 text-xs truncate">{cron.desc}</span>
                        <span className="text-xs font-semibold tabular-nums shrink-0" style={{color:mins<60?'#f59e0b':'#6b7280'}}>
                          in {fmtMins(mins)}
                        </span>
                        <Chip label={cron.project} color={pColor(cron.project)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Automations / Crons */}
              <div>
                <SH icon="🤖">Automations</SH>
                <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {/* Group by source */}
                  {(['openclaw-cron','n8n','openclaw'] as const).map(src => {
                    const group = displayCrons.filter((c:any) => (c.source ?? 'n8n') === src)
                    if (group.length === 0) return null
                    const srcLabel = src === 'openclaw-cron' ? '⚡ OpenClaw Crons' : src === 'n8n' ? '🔧 n8n Workflows' : '💓 Heartbeats'
                    return (
                      <div key={src}>
                        <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-600 border-b border-zinc-800/60" style={{background:'#080808'}}>{srcLabel}</div>
                        {group.map((c:any,i:number,arr:any[])=>{
                          const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                          const isError = c.status === 'error' || (c.consecutiveErrors ?? 0) > 0
                          return (
                            <div key={c.id} className={'flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 px-4 md:px-5 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors '+(i<arr.length-1?'border-b border-zinc-800/40':'')}
                              style={isError ? {background:'#1a0808'} : {}}
                              onClick={()=>setCronModal(c)}>
                              <div className="flex items-center gap-2 sm:gap-4">
                                <span className="font-mono text-xs text-zinc-400 shrink-0">{c.time}</span>
                                <span className="text-zinc-600 text-[10px] shrink-0">{c.days}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                                  style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                                  {c.model}
                                </span>
                                <Dot status={isError ? 'error' : c.status} sm />
                                {isError && <span className="text-[9px] text-red-400">⚠ {c.consecutiveErrors}x error</span>}
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <Chip label={c.project} color={pColor(c.project)} />
                                <span className="text-zinc-300 text-xs truncate">{c.name || c.desc}</span>
                                {c.lastRunAtMs && <span className="text-zinc-600 text-[9px] shrink-0 ml-auto">{Math.round((Date.now()-c.lastRunAtMs)/60000)}m ago</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Cron Detail Modal */}
              {cronModal && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
                  <div className="w-full max-w-sm md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-3 max-h-[85vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
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
                      {(cronModal as any).source === 'openclaw-cron' && <>
                        {(cronModal as any).sessionTarget && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Session Target</p><p className="text-zinc-300 text-sm font-mono">{(cronModal as any).sessionTarget}</p></div>}
                        {(cronModal as any).lastRunAtMs && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Run</p><p className="text-zinc-300 text-sm">{new Date((cronModal as any).lastRunAtMs).toLocaleString()}</p></div>}
                        {(cronModal as any).lastRunStatus && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Status</p><p className={`text-sm font-mono ${(cronModal as any).lastRunStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{(cronModal as any).lastRunStatus}</p></div>}
                        {(cronModal as any).consecutiveErrors > 0 && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Consecutive Errors</p><p className="text-red-400 text-sm font-mono">{(cronModal as any).consecutiveErrors}</p></div>}
                      </>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )})()}

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
            <KanbanBoard featureFilter={boardFeatureFilter} featureFilterName={boardFeatureFilterName} onClearFeatureFilter={() => { setBoardFeatureFilter(undefined); setBoardFeatureFilterName(undefined) }} />
          )}

          {/* ── FEATURES ── */}
          {tab==='features' && (
            <FeaturesTab onViewIssues={(featureId, featureName) => { setBoardFeatureFilter(featureId); setBoardFeatureFilterName(featureName); setTab('board'); if (typeof window !== 'undefined') localStorage.setItem('mc-tab', 'board') }} />
          )}

          {/* ── PIPELINE ── */}
          {tab==='pipeline' && (
            <PipelineTab />
          )}

          {/* ── ISSUES ── */}
          {tab==='issues' && (
            <IssuesTab />
          )}

          {/* ── AUTOMATIONS (n8n embed) ── */}
          {tab==='automations' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Automations</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">All scheduled jobs — OpenClaw crons, n8n workflows, and heartbeats</p>
                </div>
                <a href="https://n8n.nabit.work" target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg transition-colors">
                  Open n8n editor ↗
                </a>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  {label:'Total jobs', value: displayCrons.length, color:'#a855f7'},
                  {label:'Active', value: displayCrons.filter((c:any)=>c.status==='active'||c.status==='ok').length, color:'#10b981'},
                  {label:'Errors', value: displayCrons.filter((c:any)=>c.status==='error'||(c as any).consecutiveErrors>0).length, color:'#ef4444'},
                ].map(s=>(
                  <div key={s.label} className="rounded-xl border border-zinc-800/60 px-4 py-3" style={{background:'#0f0f0f'}}>
                    <div className="text-xl font-bold" style={{color:s.color}}>{s.value}</div>
                    <div className="text-[10px] text-zinc-600 uppercase tracking-wider mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Grouped cron list */}
              <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
                {(['openclaw-cron','n8n','openclaw'] as const).map(src => {
                  const group = displayCrons.filter((c:any) => (c.source ?? 'n8n') === src)
                  if (group.length === 0) return null
                  const srcLabel = src === 'openclaw-cron' ? '⚡ OpenClaw Crons' : src === 'n8n' ? '🔧 n8n Workflows' : '💓 Heartbeats'
                  return (
                    <div key={src}>
                      <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-600 border-b border-zinc-800/60" style={{background:'#080808'}}>{srcLabel}</div>
                      {group.map((c:any, i:number, arr:any[]) => {
                        const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                        const isError = c.status === 'error' || (c.consecutiveErrors ?? 0) > 0
                        return (
                          <div key={c.id}
                            className={'flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors ' + (i<arr.length-1?'border-b border-zinc-800/40':'')}
                            style={isError ? {background:'#1a0808'} : {}}
                            onClick={()=>setCronModal(c)}>
                            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                              <Dot status={isError ? 'error' : c.status} sm />
                              <span className="font-mono text-xs text-zinc-400 w-12 shrink-0">{c.time}</span>
                              <span className="text-zinc-600 text-[10px] w-14 shrink-0">{c.days}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                                style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                                {c.model}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Chip label={c.project} color={pColor(c.project)} />
                              <span className="text-zinc-300 text-xs truncate">{c.name || c.desc}</span>
                              {isError && <span className="text-[9px] text-red-400 shrink-0">⚠ {c.consecutiveErrors}x</span>}
                              {c.lastRunAtMs && <span className="text-zinc-600 text-[9px] shrink-0 ml-auto">{Math.round((Date.now()-c.lastRunAtMs)/60000)}m ago</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* Cron Detail Modal */}
              {cronModal && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
                  <div className="w-full max-w-sm md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-3 max-h-[85vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-semibold text-sm">{(cronModal as any).name || cronModal.id}</h3>
                      <button onClick={()=>setCronModal(null)} className="text-zinc-600 hover:text-white text-lg">✕</button>
                    </div>
                    <div className="space-y-2.5">
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Schedule</p><p className="text-zinc-300 text-sm font-mono">{cronModal.time} · {cronModal.days}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Runner</p><p className="text-zinc-300 text-sm font-mono">{cronModal.model}</p></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Project</p><Chip label={cronModal.project} color={pColor(cronModal.project)} /></div>
                      <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Status</p><div className="flex items-center gap-2"><Dot status={cronModal.status} /><span className="text-zinc-300 text-sm">{cronModal.status}</span></div></div>
                      {(cronModal as any).source === 'openclaw-cron' && <>
                        {(cronModal as any).sessionTarget && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Session Target</p><p className="text-zinc-300 text-sm font-mono">{(cronModal as any).sessionTarget}</p></div>}
                        {(cronModal as any).lastRunAtMs && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Run</p><p className="text-zinc-300 text-sm">{new Date((cronModal as any).lastRunAtMs).toLocaleString()}</p></div>}
                        {(cronModal as any).lastRunStatus && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Status</p><p className={`text-sm font-mono ${(cronModal as any).lastRunStatus==='ok'?'text-emerald-400':'text-red-400'}`}>{(cronModal as any).lastRunStatus}</p></div>}
                        {(cronModal as any).consecutiveErrors > 0 && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Consecutive Errors</p><p className="text-red-400 text-sm font-mono">{(cronModal as any).consecutiveErrors}</p></div>}
                      </>}
                    </div>
                  </div>
                </div>
              )}
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
              { name:'Vercel',       note: ls?.vercel ? `${vercelStatus}${ls.vercel.lastDeploy?.branch?' · '+ls.vercel.lastDeploy.branch:''}${ls.vercel.lastDeploy?.commitSha?' · '+ls.vercel.lastDeploy.commitSha.slice(0,7):''}${ls.vercel.lastDeploy?.createdAt?' · '+new Date(ls.vercel.lastDeploy.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}` : 'Unknown', status: vercelSt },
              { name:'Supabase',     note:'Kemuni Agent HQ · Vespera + Agent Brain', status:'ok' },
              { name:'GitHub',       note:'nabitllc org · kemuniagent@gmail.com',    status:'ok' },
              { name:'Brave Search', note:'API · renews Apr 21',                     status:'ok' },
              { name:'Cloudflare',   note:'Tunnel active · trycloudflare.com',       status:'ok' },
            ]

            return (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <SH icon="🔌">Services</SH>
                <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-wrap">
                  {ls && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-zinc-700 text-[10px]">Updated {agoSec}s ago</span></>}
                  {!ls && <span className="text-yellow-600 text-[10px]">Loading…</span>}
                  <span className="text-zinc-700 text-[10px] font-mono tabular-nums" title="Auto-refresh countdown">↻ {statusCountdown}s</span>
                  <button onClick={()=>{fetchStatus();setStatusCountdown(30)}} className="text-zinc-600 hover:text-zinc-400 text-[10px] border border-zinc-800 rounded px-2 py-0.5 transition-colors">Refresh</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {liveInfra.map(svc=>(
                  <div key={svc.name} className="rounded-xl p-3 md:p-4 border border-zinc-800/60 flex items-start gap-3 card-glow" style={{background:'#0f0f0f'}}>
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
                  <div key={hb.agentId} className={'flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3 '+(i<arr.length-1?'border-b border-zinc-800/40':'')}>
                    <Dot status={hb.enabled ? 'active' : 'planned'} />
                    <span className="font-mono text-xs text-white shrink-0">{hb.agentId}</span>
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
              <div className="rounded-2xl border border-zinc-800/60 p-4 md:p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-end justify-between mb-4">
                  <div className="flex items-baseline gap-4 md:gap-6 flex-wrap">
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
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={(t) => { setTab(t as Tab); if (typeof window !== 'undefined') localStorage.setItem('mc-tab', t) }} />
    </div>
  )
}
