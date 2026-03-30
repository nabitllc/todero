"use client";
import { useState, useCallback } from "react";
import { ALL_AGENTS, ORCHESTRATOR_ID, DEPENDENCIES, AGENT_TASKS } from './officeConstants';

// ─── Props ───────────────────────────────────────────────────────────────────
export interface OfficeSidebarProps {
  // Display data
  roster: any[];
  stats: { working: number; meeting: number; idle: number; completed: number };
  feed: any[];
  feedRef: React.RefObject<HTMLDivElement | null>;
  detail: any;
  selectedId: string | null;
  meetingLogs: any[];
  waterfall: any[];
  leaderboard: any[];
  incidentLog: any[];
  incident: any;
  dialogue: any[];
  timeline: any[];
  realTaskCounts: Record<string, { h24: number; d7: number }>;
  boardTasks: Record<string, string>;
  liveRunsRef: React.MutableRefObject<Record<string, any>>;
  // Theme
  theme: "A" | "B";
  // Sidebar state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  isMobile: boolean;
  // Actions
  setSelectedId: (id: string | null) => void;
  setDetail: (d: any) => void;
  // Canvas context menu
  ctxMenu: any;
  setCtxMenu: (v: any) => void;
  // Agent management
  simRef: React.MutableRefObject<any>;
  addFeed: (text: string, color?: string) => void;
  // Sound
  volume: number;
  changeVolume: (v: number) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function OfficeSidebar(props: OfficeSidebarProps) {
  const {
    roster, stats, feed, feedRef, detail, selectedId, meetingLogs, waterfall,
    leaderboard, incidentLog, incident, dialogue, timeline, realTaskCounts,
    boardTasks, liveRunsRef, theme, sidebarCollapsed, toggleSidebar, isMobile,
    setSelectedId, setDetail, ctxMenu, setCtxMenu, simRef, addFeed,
    volume, changeVolume,
  } = props;

  // ─── Local state ─────────────────────────────────────────────────────────
  const [openPanels, setOpenPanels] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem("office_panels"); return s ? new Set(JSON.parse(s)) : new Set(["feed"]); } catch { return new Set(["feed"]); }
  });
  const togglePanel = (id: string) => setOpenPanels(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem("office_panels", JSON.stringify(Array.from(next))); } catch (e) {}
    return next;
  });

  const [showConfig, setShowConfig] = useState(false);
  const [configAgent, setConfigAgent] = useState<any>(null);
  const [configEdits, setConfigEdits] = useState<any>({});
  const [showSettings, setShowSettings] = useState(false);
  const [lbTimeframe, setLbTimeframe] = useState<'session' | '24h' | '7d'>('session');
  const [panelTimeframe, setPanelTimeframe] = useState<'session' | '24h' | '7d'>('session');
  const [sessionLog, setSessionLog] = useState<any[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const openConfig = (ag: any) => {
    setConfigAgent(ag);
    setConfigEdits({ name: ag.name, color: ag.color, workBurst: ag.personality.workBurst, focusDuration: ag.personality.focusDuration });
    setShowConfig(true);
  };

  const saveConfig = () => {
    if (!configAgent || !simRef.current?.agents) return;
    const ag = simRef.current.agents.find((a: any) => a.id === configAgent.id); if (!ag) return;
    if (configEdits.name) ag.name = configEdits.name;
    if (configEdits.color) ag.color = configEdits.color;
    ag.personality = { ...ag.personality, workBurst: +configEdits.workBurst, focusDuration: +configEdits.focusDuration };
    setShowConfig(false); addFeed(`⚙ ${ag.name} config updated`, ag.color);
  };

  const ctxAction = (action: string) => {
    const ag = simRef.current?.agents?.find((a: any) => a.id === ctxMenu?.agentId);
    if (!ag) { setCtxMenu(null); return; }
    if (action === "task" && ag.state === "idle") {
      const tasks = AGENT_TASKS[ag.id] || [];
      if (tasks.length) { ag.state = "working"; ag.task = tasks[Math.floor(Math.random() * tasks.length)]; ag.progress = 0; addFeed(`⚡ ${ag.name} force-assigned task`, ag.color); }
    } else if (action === "complete" && ag.state === "working") {
      ag.progress = 99.9;
    } else if (action === "config") {
      openConfig(ag);
    }
    setCtxMenu(null);
  };

  return (
    <>
      {/* Config modal */}
      {showConfig && configAgent && (
        <div style={{ position: "fixed", inset: 0, background: "#000000bb", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e: any) => e.target === e.currentTarget && setShowConfig(false)}>
          <div style={{ background: "#0f0f20", border: "1px solid #2a2a4a", borderRadius: 8, padding: 22, width: 300, color: "#8892b0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: "#e0e0ff", letterSpacing: "0.1em" }}>CONFIGURE</span>
              <button onClick={() => setShowConfig(false)} style={{ background: "transparent", border: "none", color: "#7a7a98", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 22 }}>{configAgent.emoji}</span>
              <div style={{ color: configEdits.color || configAgent.color, fontSize: 12, fontWeight: 700 }}>{configEdits.name || configAgent.name}</div>
            </div>
            {[{ l: "Name", k: "name", t: "text" }, { l: "Color", k: "color", t: "color" }].map(f => (
              <div key={f.k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#6a6a8e", marginBottom: 3, letterSpacing: "0.1em" }}>{f.l.toUpperCase()}</div>
                <input type={f.t} value={configEdits[f.k] || ""} onChange={(e: any) => setConfigEdits((p: any) => ({ ...p, [f.k]: e.target.value }))}
                  style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 4, padding: "4px 7px", color: "#e0e0ff", fontFamily: "inherit", fontSize: 10, boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ marginBottom: 14, padding: "8px", background: "#0a0a18", borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: "#6a6a8e", lineHeight: 1.6 }}>Agent behavior is driven by real OpenClaw sessions. Visual config (name/color) is cosmetic only.</div>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={saveConfig} style={{ flex: 1, background: "#6C5CE7", border: "none", borderRadius: 4, color: "#fff", padding: "7px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
              <button onClick={() => setShowConfig(false)} style={{ flex: 1, background: "transparent", border: "1px solid #2a2a4a", borderRadius: 4, color: "#8892b0", padding: "7px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "#000000aa", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e: any) => e.target === e.currentTarget && setShowSettings(false)}>
          <div style={{ background: "#0f0f20", border: "1px solid #2a2a4a", borderRadius: 8, padding: 22, width: 280, color: "#8892b0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: "#e0e0ff", letterSpacing: "0.1em" }}>KEYBOARD SHORTCUTS</span>
              <button onClick={() => setShowSettings(false)} style={{ background: "transparent", border: "none", color: "#7a7a98", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
            <div style={{ padding: "6px 8px", background: "#0a0a18", borderRadius: 3, fontSize: 10, color: "#7a7a98", lineHeight: 1.6 }}>
              {[["Space", "Pause/Resume"], ["M", "Toggle minimap"], ["D", "Dep flow graph"], ["O", "Orchestrator panel"], ["R", "Replay mode"], ["Esc", "Close panels"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <kbd style={{ background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 2, padding: "0 4px", fontSize: 9, color: "#6C5CE7" }}>{k}</kbd>
                  <span style={{ color: "#7a7a98", fontSize: 10 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, color: "#6a6a8e", marginBottom: 6, letterSpacing: "0.1em" }}>VOLUME</div>
              <input type="range" min="0" max="100" value={volume}
                onChange={(e: any) => changeVolume(+e.target.value)}
                style={{ width: "100%", accentColor: "#6C5CE7" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ fontSize: 9, color: "#4a4a6a" }}>🔇</span>
                <span style={{ fontSize: 9, color: "#4a4a6a" }}>{volume}%</span>
                <span style={{ fontSize: 9, color: "#4a4a6a" }}>🔊</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500 }} onClick={() => setCtxMenu(null)}>
          <div style={{ position: "absolute", left: ctxMenu.screenX, top: ctxMenu.screenY,
            background: "#0f0f22", border: "1px solid #2a2a4a", borderRadius: 5,
            overflow: "hidden", minWidth: 160, boxShadow: "0 4px 20px #000a" }}
            onClick={(e: any) => e.stopPropagation()}>
            {(() => {
              const ag = roster.find(a => a.id === ctxMenu.agentId);
              if (!ag) return null;
              return <>
                <div style={{ padding: "6px 12px", borderBottom: "1px solid #1a1a2e", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{ag.emoji}</span>
                  <span style={{ color: ag.color, fontSize: 10, fontWeight: 700 }}>{ag.name}</span>
                </div>
                {[
                  { action: "task", label: "⚡ Assign random task", disabled: ag.state !== "idle" },
                  { action: "complete", label: "✓ Force complete task", disabled: ag.state !== "working" },
                  { action: "config", label: "⚙ Configure agent", disabled: false },
                ].map(item => (
                  <button key={item.action} onClick={() => ctxAction(item.action)} disabled={item.disabled}
                    style={{ display: "block", width: "100%", background: "transparent", border: "none",
                      borderBottom: "1px solid #1e1e35", color: item.disabled ? "#2a2a4a" : "#8892b0",
                      padding: "7px 12px", textAlign: "left", cursor: item.disabled ? "default" : "pointer",
                      fontSize: 9, fontFamily: "inherit" }}>
                    {item.label}
                  </button>
                ))}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div style={{ width: sidebarCollapsed ? 44 : 320, flexShrink: 0, display: isMobile ? "none" : "flex", flexDirection: "column", background: theme === "B" ? "#0a1510" : "#0b0b14", borderLeft: `1px solid ${theme === "B" ? "#162e22" : "#1a1a2e"}`, overflow: "hidden", transition: "width 0.2s ease" }}>

        {/* Collapsed sidebar: icon-only panel indicators */}
        {sidebarCollapsed && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0" }}>
            {detail && <button onClick={() => toggleSidebar()} style={{ background: "transparent", border: "none", color: detail.color, fontSize: 16, cursor: "pointer", padding: "4px" }} title={detail.name}>{detail.emoji}</button>}
            {[{ id: "feed", icon: "📡", label: "Feed" }, { id: "flow", icon: "✓", label: "Tasks" }, { id: "meetings", icon: "📅", label: "Meetings" }, { id: "board", icon: "🏆", label: "Leaderboard" }, { id: "incidents", icon: "🚨", label: "Incidents" }, { id: "deps", icon: "🔗", label: "Dependencies" }].map(p => (
              <button key={p.id} onClick={() => { if (!openPanels.has(p.id)) togglePanel(p.id); toggleSidebar(); }} style={{ background: openPanels.has(p.id) ? "#1a1a2e" : "transparent", border: "none", color: openPanels.has(p.id) ? "#a29bfe" : "#4a4a6a", fontSize: 13, cursor: "pointer", padding: "5px 4px", borderRadius: 3, width: 32, textAlign: "center" }} title={p.label}>{p.icon}</button>
            ))}
          </div>
        )}

        {/* Detail panel — shows when an agent is selected on canvas */}
        {!sidebarCollapsed && detail && (
          <div style={{ flexShrink: 0, borderBottom: "1px solid #1a1a2e", overflowY: "auto", maxHeight: "45%" }}>
            <div style={{ position: "sticky", top: 0, background: "#0b0b14", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 11px 4px", fontSize: 11, letterSpacing: "0.13em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35" }}>
              <span>AGENT DETAIL{detail.id === ORCHESTRATOR_ID ? " 👑" : ""}</span>
              <div style={{ display: "flex", gap: 5 }}>
                {/* Panel button removed — orch content is inline below */}
                <button onClick={() => { setSelectedId(null); setDetail(null); }} style={{ background: "transparent", border: "none", color: "#6a6a8e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>✕</button>
              </div>
            </div>
            <div style={{ padding: "9px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{detail.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: detail.color, fontWeight: 700, fontSize: 14 }}>{detail.name}</div>
                  <div style={{ color: "#7a7a98", fontSize: 11 }}>{detail.role}</div>
                  <div style={{ color: "#4a4a6a", fontSize: 10, marginTop: 1 }}>
                    {detail.lastStateChange
                      ? `Last active ${Math.round((Date.now() - detail.lastStateChange) / 60000)}m ago`
                      : "Not yet active"}
                  </div>
                </div>
                <div style={{ fontSize: 9, padding: "2px 5px", borderRadius: 2, background: detail.state === "working" ? "#00ff8815" : "#1a1a28", color: detail.state === "working" ? "#00ff88" : "#7a7a98" }}>
                  {detail.state?.replace(/_/g, " ")}
                </div>
              </div>
              {/* MC-91: Show model info */}
              {(() => { const liveRun = liveRunsRef.current[detail.id]; return liveRun ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#1a1a2e", color: "#8892b0" }}>Issue: {liveRun.taskTitle || "None"}</span>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#1a1a2e", color: "#8892b0" }}>Today: {liveRun.todayTasks} tasks</span>
                  {liveRun.todayErrors > 0 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#2a0808", color: "#ff4444" }}>{liveRun.todayErrors} errors</span>}
                </div>
              ) : null })()}
              <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                <div style={{ textAlign: "center" }}><div style={{ fontSize: 14, color: detail.color, fontWeight: 700 }}>{detail.tasksCompleted}</div><div style={{ fontSize: 10, color: "#6a6a8e" }}>TASKS</div></div>
                <div style={{ textAlign: "center" }}><div style={{ fontSize: 14, color: "#FDCB6E", fontWeight: 700 }}>{detail.meetingsAttended}</div><div style={{ fontSize: 10, color: "#6a6a8e" }}>MEETINGS</div></div>
              </div>
              {detail.taskHistory?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#6a6a8e", marginBottom: 3, letterSpacing: "0.1em" }}>RECENT TASKS</div>
                  {[...detail.taskHistory].reverse().slice(0, 3).map((t: string, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: "#7a7a98", padding: "2px 0", borderBottom: "1px solid #1e1e35" }}>
                      <span style={{ color: "#4a4a6a", marginRight: 3 }}>↳</span>{t}
                    </div>
                  ))}
                </div>
              )}
              {/* MC-13: View real session log */}
              <div style={{ marginTop: 6 }}>
                <button onClick={() => {
                  setLoadingLog(true);
                  fetch(`/api/status`).then(r => r.json()).then(data => {
                    const activity: any[] = data.recentActivity || [];
                    const agentLogs = activity.filter((a: any) => a.agentId === detail.id).slice(0, 10);
                    setSessionLog(agentLogs);
                    setLoadingLog(false);
                  }).catch(() => { setSessionLog([]); setLoadingLog(false); });
                }} style={{ background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 4, color: "#a29bfe", padding: "4px 10px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>
                  {loadingLog ? "Loading…" : "View Session Log"}
                </button>
                {sessionLog.length > 0 && (
                  <div style={{ marginTop: 6, maxHeight: 150, overflowY: "auto", background: "#06060e", border: "1px solid #1e1e35", borderRadius: 4, padding: "4px 6px" }}>
                    {sessionLog.map((entry: any, i: number) => (
                      <div key={i} style={{ padding: "3px 0", borderBottom: i < sessionLog.length - 1 ? "1px solid #1a1a2e" : "none", fontSize: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: entry.action === 'code' ? '#3b82f6' : entry.action === 'research' ? '#a855f7' : '#8892b0', fontWeight: 600 }}>{entry.action || 'activity'}</span>
                          <span style={{ color: "#4a4a6a", fontSize: 9 }}>{entry.ago != null ? `${entry.ago}m ago` : ''}</span>
                        </div>
                        <div style={{ color: "#7a7a98", lineHeight: 1.4, wordBreak: "break-word" }}>{entry.desc || entry.channel || '—'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* KAOS-specific: read-only exec terminal (MC-18) */}
            {detail && detail.id === ORCHESTRATOR_ID && (
              <div style={{ borderTop: "1px solid #1e1e35", padding: "8px 11px" }}>
                <div style={{ fontSize: 10, color: "#6a6a8e", letterSpacing: "0.1em", marginBottom: 4 }}>EXEC OUTPUT</div>
                <div style={{ background: "#06060e", border: "1px solid #1e1e35", borderRadius: 4, padding: "6px 8px", maxHeight: 180, overflowY: "auto", fontFamily: "'IBM Plex Mono',monospace" }}>
                  {feed.slice(-10).map((e: any) => (
                    <div key={e.id} style={{ display: "flex", gap: 5, alignItems: "flex-start", marginBottom: 2 }}>
                      <span style={{ color: "#4a4a6a", fontSize: 9, flexShrink: 0, marginTop: 1 }}>{e.ts}</span>
                      <span style={{ color: e.color, fontSize: 10, lineHeight: 1.5, wordBreak: "break-word" }}>{e.text}</span>
                    </div>
                  ))}
                  {feed.length === 0 && <div style={{ color: "#4a4a6a", fontSize: 10, textAlign: "center", padding: "8px 0" }}>No exec output yet</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable panels — all in one scrollable container */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: sidebarCollapsed ? "none" : "block" }}>

          {/* ▼ ACTIVITY FEED — always expanded */}
          <div>
            <div onClick={() => togglePanel("feed")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("feed") ? "▼" : "▶"} ACTIVITY FEED</span>
              <span style={{ fontSize: 9, color: "#4a4a6a" }}>{feed.length}</span>
            </div>
            {openPanels.has("feed") && (
              <>
                <div style={{ display: "flex", borderBottom: "1px solid #1e1e35", background: "#0a0a18" }}>
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setPanelTimeframe(tf); }}
                      style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                        background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                        color: panelTimeframe === tf ? "#a29bfe" : "#4a4a6a",
                        borderBottom: panelTimeframe === tf ? "2px solid #6C5CE7" : "2px solid transparent" }}>
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div ref={feedRef} style={{ maxHeight: 200, overflowY: "auto", padding: "3px 0" }}>
                  {feed.slice(-80).filter((e: any) => {
                    if (panelTimeframe === 'session') return true;
                    // feed items don't have ago field — treat session and 24h/7d same for now
                    return true;
                  }).slice(-20).map((e: any) => <div key={e.id} style={{ padding: "2px 11px", display: "flex", gap: 5, alignItems: "flex-start" }}>
                    <span style={{ color: "#4a4a6a", fontSize: 9, flexShrink: 0, marginTop: 2 }}>{e.ts}</span>
                    <span style={{ color: e.color, fontSize: 11, lineHeight: 1.5 }}>{e.text}</span>
                  </div>)}
                </div>
              </>
            )}
          </div>

          {/* ▶ COMPLETED TASKS */}
          <div>
            <div onClick={() => togglePanel("flow")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("flow") ? "▼" : "▶"} COMPLETED TASKS</span>
              <span style={{ fontSize: 9, color: waterfall.length > 0 ? "#00ff88" : "#4a4a6a" }}>{waterfall.length}</span>
            </div>
            {openPanels.has("flow") && (
              <>
                <div style={{ display: "flex", borderBottom: "1px solid #1e1e35", background: "#0a0a18" }}>
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setPanelTimeframe(tf); }}
                      style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                        background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                        color: panelTimeframe === tf ? "#a29bfe" : "#4a4a6a",
                        borderBottom: panelTimeframe === tf ? "2px solid #6C5CE7" : "2px solid transparent" }}>
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {waterfall.length === 0 && <div style={{ padding: "12px 11px", color: "#4a4a6a", fontSize: 11, textAlign: "center", lineHeight: 1.8 }}>Completions appear when agents finish work.</div>}
                  {waterfall.map((wf: any) => {
                    const ag = ALL_AGENTS.find(a => a.id === wf.agentId);
                    if (!ag) return null;
                    const deps = DEPENDENCIES[wf.agentId];
                    return (
                      <div key={wf.id} style={{ padding: "5px 11px", borderBottom: "1px solid #1e1e35" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 11 }}>{ag.emoji}</span>
                          <span style={{ color: ag.color, fontSize: 11, fontWeight: 700 }}>{ag.name}</span>
                          <span style={{ color: "#7a7a98", fontSize: 10 }}>✓ {wf.task}</span>
                          <span style={{ color: "#4a4a6a", fontSize: 9, marginLeft: "auto" }}>{wf.ts}</span>
                        </div>
                        {deps && deps.length > 0 && (
                          <div style={{ paddingLeft: 18, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <span style={{ color: "#6a6a8e", fontSize: 9 }}>triggers →</span>
                            {deps.map(depId => { const dep = ALL_AGENTS.find(a => a.id === depId); return dep ? <span key={depId} style={{ fontSize: 9, color: dep.color, background: dep.color + "15", padding: "1px 4px", borderRadius: 2 }}>{dep.emoji} {dep.name}</span> : null; })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ▶ MEETINGS */}
          <div>
            <div onClick={() => togglePanel("meetings")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("meetings") ? "▼" : "▶"} MEETINGS</span>
              <span style={{ fontSize: 9, color: meetingLogs.length > 0 ? "#FDCB6E" : "#4a4a6a" }}>{meetingLogs.length}</span>
            </div>
            {openPanels.has("meetings") && (
              <>
                <div style={{ display: "flex", borderBottom: "1px solid #1e1e35", background: "#0a0a18" }}>
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setPanelTimeframe(tf); }}
                      style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                        background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                        color: panelTimeframe === tf ? "#a29bfe" : "#4a4a6a",
                        borderBottom: panelTimeframe === tf ? "2px solid #6C5CE7" : "2px solid transparent" }}>
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {meetingLogs.length === 0 && <div style={{ padding: "12px 11px", color: "#4a4a6a", fontSize: 11, textAlign: "center" }}>Transcripts appear after meetings end.</div>}
                  {meetingLogs.map((m: any) => (
                    <div key={m.id} style={{ padding: "7px 11px", borderBottom: "1px solid #1e1e35" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: "#FDCB6E", fontSize: 11, fontWeight: 600 }}>{m.topic}</span>
                        <span style={{ color: "#4a4a6a", fontSize: 9 }}>{m.ts}</span>
                      </div>
                      <div style={{ color: "#6a6a8e", fontSize: 10, marginBottom: 3 }}>{m.attendees.join(", ")}</div>
                      <div style={{ color: "#8892b0", fontSize: 11, lineHeight: 1.7, whiteSpace: "pre-line" }}>{m.summary}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ▶ LEADERBOARD */}
          <div>
            <div onClick={() => togglePanel("board")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("board") ? "▼" : "▶"} LEADERBOARD</span>
              <span style={{ fontSize: 9, color: "#4a4a6a", textTransform: "uppercase" }}>{lbTimeframe}</span>
            </div>
            {openPanels.has("board") && (
              <div>
                {/* Timeframe tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid #1e1e35", background: "#0a0a18" }}>
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setLbTimeframe(tf); }}
                      style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                        background: "transparent", border: "none", cursor: "pointer",
                        color: lbTimeframe === tf ? "#a29bfe" : "#4a4a6a",
                        borderBottom: lbTimeframe === tf ? "2px solid #6C5CE7" : "2px solid transparent" }}>
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {(() => {
                    const ranked = leaderboard.map(a => {
                      const real = realTaskCounts[a.id] || { h24: 0, d7: 0 };
                      const count = lbTimeframe === 'session' ? a.tasksCompleted
                        : lbTimeframe === '24h' ? real.h24
                        : real.d7;
                      return { ...a, displayCount: count };
                    }).sort((a, b) => b.displayCount - a.displayCount || b.efficiency - a.efficiency);
                    if (ranked.every(a => a.displayCount === 0)) return (
                      <div style={{ padding: "12px 11px", color: "#4a4a6a", fontSize: 11, textAlign: "center" }}>
                        {lbTimeframe === 'session' ? 'Collecting data…' : 'No activity in this window'}
                      </div>
                    );
                    return ranked.map((a: any, rank: number) => (
                      <div key={a.id} style={{ padding: "5px 11px", borderBottom: "1px solid #1e1e35", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: rank === 0 ? "#FFD700" : rank === 1 ? "#C0C0C0" : rank === 2 ? "#CD7F32" : "#4a4a6a", width: 14, textAlign: "center", fontWeight: 700 }}>
                          {rank === 0 ? "①" : rank === 1 ? "②" : rank === 2 ? "③" : String(rank + 1)}
                        </span>
                        <span style={{ fontSize: 11 }}>{a.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: a.color, fontSize: 11, fontWeight: 600 }}>{a.name}</div>
                          <div style={{ fontSize: 10, color: "#00ff88" }}>{a.displayCount} {lbTimeframe === 'session' ? 'this session' : lbTimeframe === '24h' ? 'today' : 'this week'}</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* ▶ INCIDENT LOG */}
          <div>
            <div onClick={() => togglePanel("incidents")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("incidents") ? "▼" : "▶"} INCIDENT LOG</span>
              <span style={{ fontSize: 9, color: incidentLog.length > 0 ? "#ff4444" : "#4a4a6a" }}>{incidentLog.length}</span>
            </div>
            {openPanels.has("incidents") && (
              <>
                <div style={{ display: "flex", borderBottom: "1px solid #1e1e35", background: "#0a0a18" }}>
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setPanelTimeframe(tf); }}
                      style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                        background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                        color: panelTimeframe === tf ? "#a29bfe" : "#4a4a6a",
                        borderBottom: panelTimeframe === tf ? "2px solid #6C5CE7" : "2px solid transparent" }}>
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto" }}>
                  {incident && (
                    <div style={{ padding: "6px 11px", background: "#1a0808", borderBottom: "1px solid #2a1010", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11 }}>🔴</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#ff4444", fontSize: 11, fontWeight: 700 }}>{incident.title}</div>
                        <div style={{ color: "#ff7777", fontSize: 10 }}>Active — all hands</div>
                      </div>
                    </div>
                  )}
                  {incidentLog.length === 0 && !incident && <div style={{ padding: "12px 11px", color: "#4a4a6a", fontSize: 11, textAlign: "center" }}>No incidents recorded.</div>}
                  {incidentLog.map((inc: any) => (
                    <div key={inc.id} style={{ padding: "5px 11px", borderBottom: "1px solid #1e1e35", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10 }}>✓</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#7a7a98", fontSize: 11 }}>{inc.title}</div>
                        <div style={{ color: "#4a4a6a", fontSize: 9 }}>Resolved {inc.ts}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ▶ DEPENDENCY CHAINS */}
          <div>
            <div onClick={() => togglePanel("deps")} style={{ padding: "6px 11px", fontSize: 11, letterSpacing: "0.1em", color: "#6a6a8e", borderBottom: "1px solid #1e1e35", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d18", userSelect: "none" }}>
              <span>{openPanels.has("deps") ? "▼" : "▶"} DEPENDENCY CHAINS</span>
              <span style={{ fontSize: 9, color: "#4a4a6a" }}>{Object.keys(DEPENDENCIES).length}</span>
            </div>
            {openPanels.has("deps") && (
              <div style={{ maxHeight: 180, overflowY: "auto", padding: "6px 11px" }}>
                {Object.entries(DEPENDENCIES).map(([src, dsts]) => {
                  const srcAg = roster.find(a => a.id === src);
                  if (!srcAg) return null;
                  return (
                    <div key={src} style={{ marginBottom: 4, padding: "4px 8px", background: "#12122a", borderRadius: 4, border: `1px solid ${srcAg.color}22`, fontSize: 10 }}>
                      <span style={{ color: srcAg.color, fontWeight: 700 }}>{srcAg.emoji} {srcAg.name}</span>
                      <span style={{ color: "#6a6a8e" }}> → </span>
                      {dsts.map(d => { const dag = roster.find(a => a.id === d); return dag ? <span key={d} style={{ color: dag.color, marginRight: 6 }}>{dag.emoji} {dag.name}</span> : null; })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>{/* end expandable panels */}

        {/* Stats bar */}
        <div style={{ flexShrink: 0, borderTop: "1px solid #1a1a2e", display: sidebarCollapsed ? "none" : "flex", padding: "6px 0" }}>
          {[{ l: "DONE", v: stats.completed, c: "#6C5CE7" }, { l: "ACTIVE", v: stats.working, c: "#00ff88" }, { l: "MTG", v: stats.meeting, c: "#FDCB6E" }, { l: "IDLE", v: stats.idle, c: "#3a3a5e" }].map((s, i, arr) => (
            <div key={s.l} style={{ flex: 1, textAlign: "center", borderRight: i < arr.length - 1 ? "1px solid #1a1a2e" : "none" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.c, lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 10, color: "#4a4a6a", letterSpacing: "0.06em", marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Event timeline strip */}
        {timeline.length > 0 && (
          <div style={{ flexShrink: 0, borderTop: "1px solid #1a1a2e", padding: "4px 11px 5px" }}>
            <div style={{ height: 5, background: "#0a0a18", borderRadius: 3, overflow: "hidden", position: "relative" }} title="Session events: green=task, gold=meeting, red=incident">
              {timeline.map((ev: any, i: number) => (
                <div key={i} title={`${ev.ts} — ${ev.label}`} style={{
                  position: "absolute", left: `${(i / Math.max(1, timeline.length - 1)) * 100}%`,
                  top: 0, width: 3, height: "100%",
                  background: ev.color, opacity: 0.7, borderRadius: 1,
                  transform: "translateX(-50%)"
                }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
