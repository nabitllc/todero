// ─── Office Constants & Static Data ──────────────────────────────────────────
// Extracted from AgentOffice.tsx (TOD-476)

// ─── Types ────────────────────────────────────────────────────────────────────
export type AgentRunStatus = 'working' | 'idle' | 'never';
export interface AgentRunInfo { status: AgentRunStatus; taskTitle: string; startedAt: string | null; todayTasks: number; todayErrors: number; estimatedCost: number; }

// ─── Supabase config ──────────────────────────────────────────────────────────
export const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co';
export const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q';
export const SUPA_AGENTS = ['main','scout','ops','kemuni-sme','vespera-sme','builder','tester','deployer'] as const;

// ─── Layout ───────────────────────────────────────────────────────────────────
export const MAP_COLS    = 16;
export const MAP_ROWS    = 16;
export const OFFICE_ROWS = 12;
export const STANCHION_R = 12;
export const ORCHESTRATOR_ID = "main";

export const ALL_AGENTS = [
  { id:"main",        name:"KAOS",       color:"#6C5CE7", emoji:"🧠", role:"Orchestrator",     personality:{ workBurst:0.95, focusDuration:4 } },
  { id:"scout",       name:"Scout",      color:"#00B894", emoji:"🔍", role:"Research",          personality:{ workBurst:0.92, focusDuration:1 } },
  { id:"ops",         name:"Ops",        color:"#F0932B", emoji:"⚙️", role:"Infrastructure",   personality:{ workBurst:0.80, focusDuration:5 } },
  { id:"kemuni-sme",  name:"Kemuni SME", color:"#E17055", emoji:"🚀", role:"Kemuni Product",   personality:{ workBurst:0.88, focusDuration:3 } },
  { id:"vespera-sme", name:"Vespera SME",color:"#74B9FF", emoji:"🖤", role:"Vespera Product",  personality:{ workBurst:0.85, focusDuration:3 } },
  { id:"builder",     name:"Builder",    color:"#0984E3", emoji:"🔨", role:"Code Generation",  personality:{ workBurst:0.88, focusDuration:5 } },
  { id:"tester",      name:"Tester",     color:"#E84393", emoji:"🧪", role:"QA & Testing",     personality:{ workBurst:0.85, focusDuration:2 } },
  { id:"deployer",    name:"Deployer",   color:"#00CEC9", emoji:"🚀", role:"Deployment",       personality:{ workBurst:0.90, focusDuration:3 } },
];

export const ACTIVE_IDS = ["main","scout","ops","kemuni-sme","vespera-sme"];
export const BENCH_IDS  = ["builder","tester","deployer"];

export const DEPENDENCIES: Record<string,string[]> = {
  "main":        ["scout","kemuni-sme","vespera-sme"],
  "scout":       ["main"],
  "kemuni-sme":  ["main"],
  "vespera-sme": ["main"],
  "ops":         ["main"],
};

export const AGENT_TASKS: Record<string,string[]> = {
  "main":        ["Orchestrating sprint","Reviewing agent outputs","Delegating subtasks","Aligning team goals","Synthesizing results","Planning next sprint"],
  "scout":       ["Scanning competitor landscape","Researching goth events","Analyzing market trends","Fetching PropTech data","Summarizing research docs","Web scraping venues"],
  "ops":         ["Checking gateway health","Monitoring heartbeat","Rotating API keys","Reviewing system logs","Cost optimization","Updating infrastructure"],
  "kemuni-sme":  ["Designing property features","Planning tenant portal","Reviewing user flows","Drafting product specs","Analyzing competitor features","Prioritizing backlog"],
  "vespera-sme": ["Planning event features","Designing social feeds","Reviewing goth UX patterns","Drafting community features","Analyzing user feedback","Planning onboarding flow"],
  "builder":     ["Writing API endpoints","Refactoring components","Fixing bug reports","Building UI pages","Optimizing database queries","Implementing auth flow"],
  "tester":      ["Running integration tests","Writing unit tests","Checking edge cases","Reviewing PR code","Regression testing","Load testing API"],
  "deployer":    ["Deploying to production","Rolling back release","Checking deploy health","Updating CI pipeline","Provisioning environments","Running smoke tests"],
};

export const MEETINGS = [
  {topic:"Sprint Planning",  agents:["main","kemuni-sme","vespera-sme"]},
  {topic:"Research Review",  agents:["main","scout"]},
  {topic:"Infra Check",      agents:["main","ops"]},
  {topic:"Vespera Design",   agents:["vespera-sme","scout"]},
  {topic:"Kemuni Strategy",  agents:["main","kemuni-sme"]},
  {topic:"Full Team Sync",   agents:["main","scout","ops","kemuni-sme","vespera-sme"]},
  {topic:"Product Review",   agents:["kemuni-sme","vespera-sme","main"]},
];

export const INCIDENTS = [
  {title:"🔥 Gateway Down!",     victims:["ops","main"]},
  {title:"💥 Build Failed",      victims:["vespera-sme","main"]},
  {title:"🚨 Rate Limit Hit",    victims:["scout","ops","main"]},
  {title:"⚡ Supabase Overload", victims:["vespera-sme","kemuni-sme"]},
];

export const CHAT_LINES = [
  (a:string,b:string)=>`${b}, your turn`,
  (a:string,b:string)=>`Pushed to main, ${b}`,
  (a:string,b:string)=>`${b} — check PR`,
  (a:string,b:string)=>`Ready for review, ${b}`,
  (a:string,b:string)=>`${b}, tests passing`,
  (a:string,b:string)=>`Blocked on ${b}`,
  (a:string,b:string)=>`${b} — LGTM!`,
  (a:string,b:string)=>`Deploying, ${b}`,
];

// ─── Layout constants ─────────────────────────────────────────────────────────
export const ORCH_TX = 0.3,  ORCH_TY = 1.6;
export const CONF_TX = 5.0,  CONF_TY = 1.6;
export const CONF_TW = 8.0;
export const CONF_TH = 2.2;

export const ROW_Y = [1.6, 4.5, 7.0, 9.5];
export const COL_X = [1.0, 4.5, 8.0, 11.5];

export const DESK_POS: Record<string,{tx:number,ty:number}> = {
  main:          { tx:ORCH_TX,    ty:ORCH_TY    },
  scout:         { tx:COL_X[0],  ty:ROW_Y[1]   },
  "kemuni-sme":  { tx:COL_X[1],  ty:ROW_Y[1]   },
  ops:           { tx:COL_X[0],  ty:ROW_Y[2]   },
  "vespera-sme": { tx:COL_X[1],  ty:ROW_Y[2]   },
};

export const EMPTY_DESK_POS = [
  { tx:COL_X[2], ty:ROW_Y[1] },
  { tx:COL_X[3], ty:ROW_Y[1] },
  { tx:COL_X[2], ty:ROW_Y[2] },
  { tx:COL_X[3], ty:ROW_Y[2] },
  { tx:COL_X[0], ty:ROW_Y[3] },
  { tx:COL_X[1], ty:ROW_Y[3] },
  { tx:COL_X[2], ty:ROW_Y[3] },
  { tx:COL_X[3], ty:ROW_Y[3] },
];

export const BENCH_POS: Record<string,{tx:number,ty:number}> = {
  builder: { tx:1.5,  ty:STANCHION_R+1.0 },
  tester:  { tx:5.0,  ty:STANCHION_R+1.0 },
  deployer:{ tx:9.5,  ty:STANCHION_R+1.0 },
};

export const PLANNED_LABELS = [
  {tx:COL_X[2],ty:ROW_Y[1],emoji:"🔨",name:"Builder"},
  {tx:COL_X[3],ty:ROW_Y[1],emoji:"🧪",name:"Tester"},
  {tx:COL_X[2],ty:ROW_Y[2],emoji:"✍️",name:"Quill"},
  {tx:COL_X[3],ty:ROW_Y[2],emoji:"📣",name:"Echo"},
  {tx:COL_X[0],ty:ROW_Y[3],emoji:"",name:""},
  {tx:COL_X[1],ty:ROW_Y[3],emoji:"",name:""},
  {tx:COL_X[2],ty:ROW_Y[3],emoji:"",name:""},
  {tx:COL_X[3],ty:ROW_Y[3],emoji:"",name:""},
];

// ─── Static Templates ─────────────────────────────────────────────────────────
export const MONOLOGUES: Record<string,string[]> = {
  "main":        ["delegating now","synthesizing outputs","checking priorities","aligning team","tracking dependencies","orchestrating flow"],
  "scout":       ["scanning sources","parsing results","cross-referencing","indexing findings","compiling report","validating sources"],
  "ops":         ["checking health","rotating credentials","monitoring logs","optimizing costs","updating config","validating endpoints"],
  "kemuni-sme":  ["mapping user flows","reviewing specs","aligning features","prioritizing items","drafting requirements","analyzing gaps"],
  "vespera-sme": ["designing interactions","mapping goth UX","reviewing flows","drafting features","analyzing feedback","planning onboarding"],
  "builder":     ["writing handlers","refactoring modules","fixing edge cases","building components","optimizing queries","wiring auth"],
  "tester":      ["running assertions","writing test cases","checking coverage","auditing edge cases","running regression","load testing"],
  "deployer":    ["deploying build","checking health","rolling back","provisioning env","running smoke tests","updating pipeline"],
};

export const MEETING_SUMMARIES: Record<string,string> = {
  "Sprint Planning":  "• Assigned top-priority features across KAOS, Kemuni SME, and Vespera SME\n• Set delivery targets for this sprint cycle\n• Identified 3 blockers for early resolution",
  "Research Review":  "• Scout shared competitive landscape and PropTech market findings\n• Identified 2 key gaps and opportunities to exploit\n• KAOS updated strategy roadmap based on findings",
  "Infra Check":      "• Ops confirmed all services nominal — gateway, heartbeat, APIs\n• Reviewed cost optimization opportunities\n• Scheduled key rotation for next maintenance window",
  "Vespera Design":   "• Scout delivered goth community research for UX reference\n• Vespera SME finalized event feed and social interaction flows\n• 3 design decisions logged and handed off",
  "Kemuni Strategy":  "• Reviewed Kemuni feature backlog priorities with KAOS\n• Kemuni SME refined tenant portal user flows\n• Launch milestones confirmed for target date",
  "Full Team Sync":   "• All agents aligned on current sprint status\n• Cross-team dependencies mapped and delegated\n• Risk items flagged and assigned owners",
  "Product Review":   "• Kemuni SME and Vespera SME presented feature progress\n• KAOS provided strategic direction on prioritization\n• 5 product decisions recorded and actioned",
};

export const DIALOGUE_POOL = [
  "Completed the task — outputs are staged for review.",
  "Task done, ready for your next delegation.",
  "Finished and logging results to memory.",
  "All done — flagging completion to you now.",
  "Task complete. Awaiting next priority.",
  "Wrapped up — no blockers encountered.",
  "Done. Results are clean and ready.",
  "Completed with full output. Standing by.",
  "Task finished — triggering dependents now.",
  "All clear on my end. Over to you.",
];

// ─── Themes ────────────────────────────────────────────────────────────────
export const THEMES = {
  A:{
    floorA:"#141428", floorB:"#161636",
    floorHold:"#0e0e1e", floorHoldB:"#101024",
    grid:"#1e1e3c",
    wall:"#0a0a18",
    rowDiv:"#111128",
    deskBody:"#18183a",  deskBorder:"#222248",
    orchDesk:"#201a40",
    confTable:"#1e1c3a",
    sidebar:"#0b0b14",   sidebarHeader:"#0d0d18",
    header:"#0b0b18",
    accent:"#6C5CE7",
    textDim:"#6a6a8e",   textMid:"#8892b0",
    borderSub:"#1e1e35",
  },
  B:{
    floorA:"#0c1a17", floorB:"#0e1f1c",
    floorHold:"#0a1210", floorHoldB:"#0c1614",
    grid:"#162820",
    wall:"#091410",
    rowDiv:"#0d1c18",
    deskBody:"#122820",  deskBorder:"#1a3828",
    orchDesk:"#14302a",
    confTable:"#162e26",
    sidebar:"#0a1510",   sidebarHeader:"#0c1a14",
    header:"#0c1a14",
    accent:"#00b894",
    textDim:"#5a8a70",   textMid:"#7ab89a",
    borderSub:"#162e22",
  },
};
export type ThemeKey = keyof typeof THEMES;

// ─── localStorage key ─────────────────────────────────────────────────────────
export const LS_KEY = "agentoffice_v2";
