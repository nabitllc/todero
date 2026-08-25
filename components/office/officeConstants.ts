// ─── Office Constants & Static Data ──────────────────────────────────────────
// Extracted from AgentOffice.tsx (TOD-476)

// ─── Types ────────────────────────────────────────────────────────────────────
// 'live' = actively running and within the staleness window; 'stale' = a
// 'running' row that outlived the staleness window without a terminal
// status (orphaned); 'ended' = has a terminal status; 'never' = no run row
// exists for this agent at all. See hooks/useAgentStatus.ts:runLiveness for
// the single place this is computed.
export type AgentRunStatus = 'live' | 'stale' | 'ended' | 'never';
export interface AgentRunInfo { status: AgentRunStatus; taskTitle: string; startedAt: string | null; todayTasks: number; todayErrors: number; estimatedCost: number | null; }

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
  { id:"ops",         name:"Ingo",        color:"#F0932B", emoji:"⚙️", role:"Infrastructure",   personality:{ workBurst:0.80, focusDuration:5 } },
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
