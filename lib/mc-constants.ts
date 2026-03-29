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
  ops:           {name:'Ops',         emoji:'⚙️', role:'Operations Agent',  color:'#6b7280', desc:'Infrastructure monitoring, deployment ops, system health.', capabilities:['Monitoring','Deploys','Health Checks']},
  'kemuni-sme':  {name:'Kemuni SME',  emoji:'🚀', role:'Kemuni Specialist', color:'#3b82f6', desc:'Domain expert for Kemuni platform. PropTech strategy & features.', capabilities:['PropTech','Strategy','Features']},
  'vespera-sme': {name:'Vespera SME', emoji:'🖤', role:'Vespera Specialist',color:'#a855f7', desc:'Domain expert for Vespera. Goth community, events, culture.', capabilities:['Events','Community','Culture']},
  builder:       {name:'Builder',     emoji:'🔨', role:'Coding Agent',      color:'#3b82f6', desc:'On-demand coding. Next.js, Supabase, Vespera and Kemuni builds.', capabilities:['Next.js','Supabase','TypeScript','APIs']},
  tester:        {name:'Tester',      emoji:'🧪', role:'QA Agent',          color:'#ef4444', desc:'Automated testing, bug detection, regression checks.', capabilities:['Testing','QA','Bug Detection']},
}

export const CRONS = [
  { id:'morning-brief',      time:'6:00 AM', hour:6,  min:0, days:'daily',  model:'Haiku',  project:'Kemuni',  status:'active',  desc:'Morning brief to Telegram' },
  { id:'trending-alerts',    time:'6:00 AM', hour:6,  min:0, days:'daily',  model:'Haiku',  project:'Kemuni',  status:'active',  desc:'PropTech trends scan' },
  { id:'overnight-employee', time:'2:00 AM', hour:2,  min:0, days:'daily',  model:'Sonnet', project:'Kemuni',  status:'active',  desc:'Autonomous task completion' },
  { id:'billing-review',     time:'9:00 AM', hour:9,  min:0, days:'daily',  model:'n8n',    project:'Ops',     status:'active',  desc:'OpenRouter balance to Telegram' },
  { id:'security-audit',     time:'9:00 AM', hour:9,  min:0, days:'Mon',    model:'Sonnet', project:'Ops',     status:'active',  desc:'Weekly audit to Discord' },
  { id:'scout-morning',      time:'8:00 AM', hour:8,  min:0, days:'daily',  model:'Gemma',  project:'Vespera', status:'planned', desc:'Goth scene research to Telegram' },
]

export const LIVE_FEED = [
  { agentId:'main',    action:'memory',   desc:'Distilled session into MEMORY.md',      ago:2  },
  { agentId:'builder', action:'code',     desc:'Scaffolded Mission Control sidebar',    ago:5  },
  { agentId:'main',    action:'cron',     desc:'Morning brief sent to Telegram',        ago:60 },
  { agentId:'scout',   action:'research', desc:'Queued: goth scene scan for 8am',       ago:15 },
  { agentId:'main',    action:'delegate', desc:'Assigned Vespera auth to Builder',      ago:45 },
  { agentId:'builder', action:'code',     desc:'Vespera: Next.js layout scaffolded',    ago:120},
]

export const ACTION_COLORS: Record<string,string> = {
  memory:'#6b7280', code:'#3b82f6', cron:'#10b981',
  research:'#a855f7', delegate:'#f59e0b', session:'#6366f1',
}

export function pColor(p: string) {
  return p==='Vespera'?'#a855f7':p==='Ops'?'#6b7280':'#3b82f6'
}

export function getNextRuns(crons: typeof CRONS) {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}))
  const etH = et.getHours(), etM = et.getMinutes()
  const out: {cron:typeof CRONS[0]; mins:number}[] = []
  for(const c of crons){
    if(c.status==='planned') continue
    const daysOff = c.days==='Mon' ? ((8-et.getDay())%7||7) : 0
    const diff = daysOff*1440 + (c.hour*60+c.min) - (etH*60+etM)
    out.push({cron:c, mins: diff<0 ? diff+1440 : diff})
  }
  return out.sort((a,b)=>a.mins-b.mins).slice(0,3)
}

export function fmtMins(m: number) {
  if(m<60) return m+'m'
  const h=Math.floor(m/60), mm=m%60
  return mm ? h+'h '+mm+'m' : h+'h'
}
