// Shared constants for Mission Control
// These were previously defined inline in page.tsx

export const KEMUNI_START     = new Date('2026-03-21')
export const KEMUNI_DEADLINE  = new Date('2026-04-20')
export const VESPERA_DEADLINE = new Date('2026-03-31')
export const VESPERA_START    = new Date('2026-03-22')

export function daysUntil(d: Date) { return Math.max(0, Math.ceil((d.getTime()-Date.now())/86400000)) }
export function daysSince(d: Date) { return Math.floor((Date.now()-d.getTime())/86400000) }
export function miniPct(a: number, b: number) { return Math.min(100, Math.round((a/b)*100)) }

export const AGENT_DISPLAY: Record<string,{name:string;emoji:string;role:string;color:string;desc:string;capabilities:string[];modelShort?:string}> = {
  main:          {name:'KAOS',        emoji:'🧠', role:'Chief of Staff',    color:'#6b7280', desc:'Main orchestrator. Strategy, memory, delegation, comms.', capabilities:['Orchestration','Memory','Strategy','Comms','Delegation']},
  scout:         {name:'Scout',       emoji:'🔍', role:'Research Agent',    color:'#a855f7', desc:'Morning scan: goth scene, competitors, PropTech trends.', capabilities:['Web Research','Summarization','Trends']},
  ops:           {name:'Ingo',         emoji:'⚙️', role:'Operations Agent',  color:'#6b7280', desc:'Infrastructure monitoring, deployment ops, system health.', capabilities:['Monitoring','Deploys','Health Checks']},
  'kemuni-sme':  {name:'Kemuni SME',  emoji:'🚀', role:'Kemuni Specialist', color:'#3b82f6', desc:'Domain expert for Kemuni platform. PropTech strategy & features.', capabilities:['PropTech','Strategy','Features']},
  'vespera-sme': {name:'Vespera SME', emoji:'🖤', role:'Vespera Specialist',color:'#a855f7', desc:'Domain expert for Vespera. Goth community, events, culture.', capabilities:['Events','Community','Culture']},
  builder:       {name:'Builder',     emoji:'🔨', role:'Coding Agent',      color:'#3b82f6', desc:'On-demand coding. Next.js, Supabase, Vespera and Kemuni builds.', capabilities:['Next.js','Supabase','TypeScript','APIs']},
  tester:        {name:'Tester',      emoji:'🧪', role:'QA Agent',          color:'#ef4444', desc:'Automated testing, bug detection, regression checks.', capabilities:['Testing','QA','Bug Detection']},
}

// TOD (agent-roster-truth, round 2): LIVE_FEED — a hardcoded scripted feed
// ("Distilled session into MEMORY.md", ago:2) that rotated on a 4s interval
// forever, regardless of whether anything real had happened — was deleted
// along with the `feedIdx` interval in app/page.tsx that drove it. Real
// activity comes from /api/activity-feed and /api/agents; nothing here
// stands in for it.

export const ACTION_COLORS: Record<string,string> = {
  memory:'#6b7280', code:'#3b82f6', cron:'#10b981',
  research:'#a855f7', delegate:'#f59e0b', session:'#6366f1',
}

export function pColor(p: string) {
  return p==='Vespera'?'#a855f7':p==='Infrastructure'?'#6b7280':'#3b82f6'
}

export function fmtMins(m: number) {
  if(m<60) return m+'m'
  const h=Math.floor(m/60), mm=m%60
  return mm ? h+'h '+mm+'m' : h+'h'
}

// TOD (agent-roster-truth): ALL_AGENTS — a hardcoded 4-agent array
// (KAOS/Builder/Tester/Scout) — used to be here as the fallback whenever
// /api/agents failed or returned nothing. It declared those four agents
// "active"/"scheduled" regardless of whether they were real, running, or
// even existed on the host. Deleted along with every read of it: a failed
// roster fetch now renders an explicit error naming the endpoint and status
// (see AgentsTab / CrewTab / OfficeTab), and an empty roster renders "no
// agents configured" — never a plausible-looking invented list.

export const PROJECT_COLORS: Record<string,string> = { Kemuni:'#3b82f6', Vespera:'#a855f7', Ops:'#6b7280' }
export const TYPE_COLORS: Record<string,string> = { feature:'#3b82f6', bug:'#ef4444', task:'#71717a', ops:'#f59e0b', epic:'#a855f7', subtask:'#64748b' }

export const DEFAULT_SPRINT_PROJECTS = [
  {id:'kemuni',name:'Kemuni Launch',desc:'Community & Property SaaS',emoji:'🚀',startDate:'2026-03-21',deadline:'2026-04-20',totalDays:30,color:'#ffffff',borderColor:'border-white/10',bg:'#0f0f0f',bgDark:'#0f0f0f'},
  {id:'vespera',name:'Vespera',desc:'Colombia Goth Community',emoji:'🦇',startDate:'2026-03-22',deadline:'2026-03-31',totalDays:9,color:'#a855f7',borderColor:'border-purple-900/30',bg:'#0f0a14',bgDark:'#0f0a14'},
]

// TOD (agent-roster-truth, round 2): ACTIVITIES — a hardcoded per-agent list
// of scripted status lines ("Reviewing sprint goals...", "Standing by...")
// that page.tsx's `act()` helper cycled through on a 3s tick as if it were
// live activity, whether or not the agent existed or had ever run. Deleted
// along with `act()` and the `tick` interval that drove it, and the `act`
// prop threaded through CrewTab -> AgentsTab (never actually called there).
// `agentCurrentTask` (from /api/status, itself sourced from real issue rows)
// is the only "what is this agent doing" signal this app shows now.

// Toast color tokens
export const TOAST_COLORS = { started: '#60a5fa', done: '#34d399', error: '#f87171', default: '#00ff88' }

// Agent emoji map for toasts
export const AGENT_EMOJI: Record<string,string> = { main:'🧠', builder:'🔨', tester:'🧪', scout:'🔍', ops:'⚙️', 'kemuni-sme':'🚀', 'vespera-sme':'🖤', deployer:'🚀' }
