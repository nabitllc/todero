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

// TOD (agent-roster-truth): the hardcoded 8-agent roster constant (and its
// ACTIVE_IDS/BENCH_IDS/DESK_POS/BENCH_POS/PLANNED_LABELS layout tables)
// (KAOS/Scout/Ingo/Kemuni SME/Vespera SME/Builder/Tester/Deployer) with a
// literal id → desk-position table, plus two invented "planned" hires
// ("Quill", "Echo") drawn at empty desks. The office rendered that fixed
// cast forever, independent of what /api/agents actually reports — an agent
// could be running a task and the canvas would still show it "on the bench",
// or a genuinely idle process would sit at a desk marked active. All of it
// is deleted. The office now takes its roster from the real /api/agents
// response (see AgentOffice.tsx / OfficeCanvas.tsx) and computes desk/bench
// placement from each agent's *own* `active` field — nothing here asserts
// who exists or what they are doing.

// ─── Layout ───────────────────────────────────────────────────────────────────
export const MAP_COLS    = 16;
export const MAP_ROWS    = 16;
export const OFFICE_ROWS = 12;
export const STANCHION_R = 12;

// ─── Layout constants ─────────────────────────────────────────────────────────
export const ORCH_TX = 0.3,  ORCH_TY = 1.6;
export const CONF_TX = 5.0,  CONF_TY = 1.6;
export const CONF_TW = 8.0;
export const CONF_TH = 2.2;

export const ROW_Y = [1.6, 4.5, 7.0, 9.5];
export const COL_X = [1.0, 4.5, 8.0, 11.5];

// Pure geometry — an ordered pool of desk/bench slots with no agent identity
// attached. initAgents() (officeDrawing.ts) hands the Nth active agent the
// Nth desk slot and the Nth inactive agent the Nth bench slot, generating
// extra rows on the fly if the real roster is bigger than the base grid.
const DESK_ROWS = [ROW_Y[1], ROW_Y[2], ROW_Y[3]];
export function deskSlot(i: number): { tx: number; ty: number } {
  const col = COL_X[i % COL_X.length];
  const rowIdx = Math.floor(i / COL_X.length);
  const ty = rowIdx < DESK_ROWS.length ? DESK_ROWS[rowIdx] : DESK_ROWS[DESK_ROWS.length - 1] + (rowIdx - DESK_ROWS.length + 1) * 2.5;
  return { tx: col, ty };
}

const BENCH_COLS = [1.5, 5.0, 9.5];
export function benchSlot(i: number): { tx: number; ty: number } {
  const col = BENCH_COLS[i % BENCH_COLS.length];
  const rowIdx = Math.floor(i / BENCH_COLS.length);
  return { tx: col, ty: STANCHION_R + 1.0 + rowIdx * 1.8 };
}

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
