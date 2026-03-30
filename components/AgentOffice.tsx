"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { THEMES } from "./office/officeConstants";
import type { AgentRunInfo, ThemeKey } from "./office/officeConstants";
import { nowts } from "./office/officeDrawing";
import { useAgentStatus } from "../hooks/useAgentStatus";
import OfficeCanvas from "./office/OfficeCanvas";
import OfficeSidebar from "./office/OfficeSidebar";

export default function AgentOffice() {
  const simRef=useRef<any>(null), feedRef=useRef<HTMLDivElement>(null), feedIdRef=useRef(1);
  const liveRunsRef=useRef<Record<string,AgentRunInfo>>({}), boardTasksRef=useRef<Record<string,string>>({});
  const subagentCountRef=useRef<number>(0), subagentSessionsRef=useRef<any[]>([]);
  const [feed,setFeed]=useState<any[]>([{id:0,ts:nowts(),text:"KAOS agents online. 24/7/365.",color:"#00ff88"}]);
  const [roster,setRoster]=useState<any[]>([]), [paused,setPaused]=useState(false);
  const [stats,setStats]=useState({working:0,meeting:0,idle:0,completed:0});
  const [selectedId,setSelectedId]=useState<string|null>(null), [detail,setDetail]=useState<any>(null);
  const [toasts,setToasts]=useState<any[]>([]), [meetingLogs,setMeetingLogs]=useState<any[]>([]);
  const [incidentLog,setIncidentLog]=useState<any[]>([]), [incident,setIncident]=useState<any>(null);
  const [waterfall,setWaterfall]=useState<any[]>([]), [leaderboard,setLeaderboard]=useState<any[]>([]);
  const [dialogue,setDialogue]=useState<any[]>([]), [timeline,setTimeline]=useState<any[]>([]);
  const [boardTasks,setBoardTasks]=useState<Record<string,string>>({});
  const [realTaskCounts,setRealTaskCounts]=useState<Record<string,{h24:number;d7:number}>>({});
  const [showMinimap,setShowMinimap]=useState(true), [showDepGraph,setShowDepGraph]=useState(false);
  const [showGrid,setShowGrid]=useState(true), [showLegend,setShowLegend]=useState(true);
  const [replayMode,setReplayMode]=useState(false), [replayLen,setReplayLen]=useState(0);
  const [soundOn,setSoundOn]=useState(()=>{try{return localStorage.getItem("office_sound")!=="off";}catch{return true;}});
  const [volume,setVolume]=useState(()=>{try{return parseInt(localStorage.getItem("office_volume")||"50",10);}catch{return 50;}});
  const [simSpeed,setSimSpeed]=useState(1);
  const [theme,setTheme]=useState<ThemeKey>(()=>{try{return(localStorage.getItem("office_theme")||"A")as ThemeKey;}catch{return"A";}});
  const [isMobile,setIsMobile]=useState(false), [canvasScale,setCanvasScale]=useState(1);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{try{return localStorage.getItem("office_sidebar_collapsed")==="true";}catch{return false;}});
  const [tab,setTab]=useState("roster"), [ctxMenu,setCtxMenu]=useState<any>(null);

  // ─── Callbacks ───────────────────────────────────────────────────────────
  const addToast = useCallback((text: string, color = "#00ff88") => {
    const id = feedIdRef.current++;
    setToasts(t => { const next = [...t, { id, text, color }]; return next.length > 5 ? next.slice(next.length - 5) : next; });
    setTimeout(() => setToasts(t => t.filter((x: any) => x.id !== id)), 3000);
  }, []);
  const addFeed = useCallback((text: string, color = "#8892b0") => {
    setFeed(p => [...p, { id: feedIdRef.current++, ts: nowts(), text, color }].slice(-80));
  }, []);
  const switchTheme = (t: ThemeKey) => { setTheme(t); try { localStorage.setItem("office_theme", t); } catch (e) {} };
  const toggleSidebar = () => { setSidebarCollapsed(p => { const next = !p; try { localStorage.setItem("office_sidebar_collapsed", String(next)); } catch (e) {} return next; }); };
  const togglePause = () => { setPaused(p => !p); };
  const toggleSound = () => { const next = !soundOn; setSoundOn(next); try { localStorage.setItem("office_sound", next ? "on" : "off"); } catch (e) {} };
  const changeVolume = (v: number) => { setVolume(v); if (v === 0) setSoundOn(false); else setSoundOn(true); try { localStorage.setItem("office_volume", String(v)); localStorage.setItem("office_sound", v > 0 ? "on" : "off"); } catch (e) {} };

  // ─── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [feed]);
  useEffect(() => {
    const check = () => { const w = window.innerWidth; setIsMobile(w < 768); setCanvasScale(Math.min(1, w / 900)); if (w < 1024 && w >= 768) setSidebarCollapsed(true); };
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check);
  }, []);

  // ─── Data hooks ──────────────────────────────────────────────────────────
  useAgentStatus({ simRef, liveRunsRef, boardTasksRef, subagentCountRef, subagentSessionsRef, addFeed, setBoardTasks });

  const thm = THEMES[theme] || THEMES.A;

  return (
    <div style={{ height: "100%", minHeight: isMobile ? "100%" : "600px", display: "flex", flexDirection: "column",
      background: theme === "B" ? "#091410" : "#060610",
      fontFamily: "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace", overflow: "hidden",
      color: theme === "B" ? "#7ab89a" : "#8892b0" }}>

      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}`}</style>

      {/* Toasts */}
      <div style={{ position: "absolute", top: 52, right: 330, zIndex: 300, display: "flex", flexDirection: "column", gap: 5, pointerEvents: "none" }}>
        {toasts.map((t: any) => <div key={t.id} style={{ background: "#0f0f22ee", border: `1px solid ${t.color}55`, borderLeft: `3px solid ${t.color}`, padding: "5px 12px", borderRadius: 4, fontSize: 10, color: t.color, animation: "slideIn 0.15s ease", whiteSpace: "nowrap", maxWidth: 280 }}>{t.text}</div>)}
      </div>

      {/* Header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "0 8px" : "0 14px", height: 44, background: thm.header, borderBottom: `1px solid ${thm.borderSub}`, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: paused ? "#3a3a5e" : incident ? "#ff4444" : "#00ff88", boxShadow: paused ? "none" : incident ? "0 0 8px #ff444466" : "0 0 8px #00ff8866" }} />
          {!isMobile && <span style={{ color: "#e0e0ff", fontSize: 13, letterSpacing: "0.14em", fontWeight: 700 }}>NABIT LLC</span>}
          {!isMobile && <span style={{ color: "#4a4a6a" }}>·</span>}
          <span style={{ color: incident ? "#ff4444" : "#8892b0", fontSize: 12, letterSpacing: "0.09em" }}>{incident ? incident.title : "AGENT OFFICE"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: "#0f0f20", border: "1px solid #1a1a2e", borderRadius: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#00ff88" }}>{stats.working}</span><span style={{ fontSize: 11, color: "#6a6a8e" }}>working</span>
            <span style={{ fontSize: 11, color: "#3a3a5e" }}>·</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#6C5CE7" }}>{stats.completed}</span><span style={{ fontSize: 11, color: "#6a6a8e" }}>done</span>
            {(() => { const tc = Object.values(liveRunsRef.current).reduce((s, r) => s + (r?.estimatedCost || 0), 0); return tc > 0 ? <><span style={{ fontSize: 11, color: "#3a3a5e" }}>·</span><span style={{ fontSize: 12, fontWeight: 700, color: "#4a6a5a" }}>${tc.toFixed(2)}</span><span style={{ fontSize: 11, color: "#6a6a8e" }}>today</span></> : null; })()}
          </div>
          {!isMobile && <>
            <div style={{ display: "flex", gap: 2, padding: "2px", background: "#0a0a18", borderRadius: 4, border: "1px solid #1a1a2e" }}>
              {(["A", "B"] as const).map(t => (
                <button key={t} onClick={() => switchTheme(t)} style={{ background: theme === t ? (t === "A" ? "#6C5CE7" : "#00b894") : "transparent", border: "none", borderRadius: 3, color: theme === t ? "#fff" : "#6a6a8e", padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{t === "A" ? "Space" : "Green"}</button>
              ))}
            </div>
            <button onClick={() => setShowGrid(s => !s)} style={{ background: "transparent", border: "1px solid #2a2a4a", color: showGrid ? "#8892b0" : "#6a6a8e", padding: "3px 9px", borderRadius: 3, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }} title="Toggle grid">#</button>
            <button onClick={() => setShowDepGraph(s => !s)} style={{ background: showDepGraph ? "#1a1a3a" : "transparent", border: `1px solid ${showDepGraph ? "#6C5CE7" : "#2a2a4a"}`, color: showDepGraph ? "#a29bfe" : "#7a7a98", padding: "3px 9px", borderRadius: 3, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>⟡ FLOW</button>
            <button onClick={() => setShowLegend(s => !s)} style={{ background: "transparent", border: "1px solid #2a2a4a", color: showLegend ? "#8892b0" : "#6a6a8e", padding: "3px 9px", borderRadius: 3, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }} title="Toggle legend">◉</button>
            <button onClick={() => setShowMinimap(s => !s)} style={{ background: "transparent", border: "1px solid #2a2a4a", color: showMinimap ? "#8892b0" : "#6a6a8e", padding: "3px 9px", borderRadius: 3, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }} title="Toggle minimap">🗺</button>
            <button onClick={() => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); }} style={{ background: "transparent", border: "1px solid #2a2a4a", color: "#7a7a98", padding: "3px 9px", borderRadius: 3, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }} title="Fullscreen">⛶</button>
            <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 6px", background: "#0a0a18", border: "1px solid #1a1a2e", borderRadius: 3 }}>
              <span style={{ fontSize: 9, color: "#6a6a8e" }}>⏩</span>
              {([0.5, 1, 2] as const).map(s => (
                <button key={s} onClick={() => setSimSpeed(s)} style={{ background: simSpeed === s ? "#6C5CE7" : "transparent", border: "none", borderRadius: 2, color: simSpeed === s ? "#fff" : "#6a6a8e", padding: "1px 5px", fontSize: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: simSpeed === s ? 700 : 400 }}>{s}x</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 6px", background: "#0a0a18", border: "1px solid #1a1a2e", borderRadius: 3 }}>
              <button onClick={toggleSound} style={{ background: "transparent", border: "none", color: soundOn ? "#8892b0" : "#6a6a8e", padding: "0 2px", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{soundOn ? "🔊" : "🔇"}</button>
              <input type="range" min="0" max="100" value={volume} onChange={(e: any) => changeVolume(+e.target.value)} style={{ width: 50, height: 3, accentColor: "#6C5CE7" }} />
            </div>
          </>}
          <button onClick={togglePause} style={{ background: "transparent", border: "1px solid #2a2a4a", color: paused ? "#00ff88" : "#8892b0", padding: "3px 11px", borderRadius: 3, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}>{paused ? "▶ RUN" : "⏸ LIVE"}</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: isMobile ? "auto" : "hidden" }}>
        <OfficeCanvas
          selectedId={selectedId} theme={theme} paused={paused} soundOn={soundOn} volume={volume}
          showMinimap={showMinimap} showDepGraph={showDepGraph} showGrid={showGrid} showLegend={showLegend}
          simSpeed={simSpeed} replayMode={replayMode} isMobile={isMobile} canvasScale={canvasScale}
          setPaused={setPaused} setSelectedId={setSelectedId} setDetail={setDetail} setRoster={setRoster}
          setStats={setStats} setMeetingLogs={setMeetingLogs} setWaterfall={setWaterfall} setTimeline={setTimeline}
          setLeaderboard={setLeaderboard} setDialogue={setDialogue} setIncidentLog={setIncidentLog}
          setIncident={setIncident} setReplayLen={setReplayLen} setRealTaskCounts={setRealTaskCounts}
          setShowMinimap={setShowMinimap} setShowDepGraph={setShowDepGraph} setReplayMode={setReplayMode}
          setTab={setTab} addFeed={addFeed} addToast={addToast}
          simRef={simRef} liveRunsRef={liveRunsRef} boardTasksRef={boardTasksRef}
          subagentCountRef={subagentCountRef} subagentSessionsRef={subagentSessionsRef} setCtxMenu={setCtxMenu}
        />

        {/* Mobile agent cards */}
        {isMobile && (
          <div style={{ background: theme === "B" ? "#091410" : "#09090f", padding: "12px", borderTop: `1px solid ${thm.borderSub}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff8866" }} />
              <span style={{ color: thm.textMid, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em" }}>AGENT STATUS</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {roster.filter(a => a.active).map(a => (
                <div key={a.id} style={{ background: theme === "B" ? "#0c1a14" : "#0f0f1a", border: `1px solid ${thm.borderSub}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{a.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#e0e0ff", fontSize: 12, fontWeight: 700 }}>{a.name}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 9,
                        background: a.state === "working" ? "#00ff8820" : a.state === "meeting" ? "#6C5CE720" : "#3a3a5e20",
                        color: a.state === "working" ? "#00ff88" : a.state === "meeting" ? "#a29bfe" : "#6a6a8e",
                        border: `1px solid ${a.state === "working" ? "#00ff8840" : a.state === "meeting" ? "#6C5CE740" : "#3a3a5e40"}`,
                        textTransform: "uppercase" }}>{a.state === "working" ? "working" : a.state === "meeting" ? "meeting" : "idle"}</span>
                    </div>
                    <div style={{ color: thm.textDim, fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.task ? (a.task.length > 40 ? a.task.slice(0, 40) + "…" : a.task) : "Standing by"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sidebar toggle */}
        {!isMobile && (
          <button onClick={toggleSidebar} style={{ position: "absolute", right: sidebarCollapsed ? 40 : 316, top: 52, zIndex: 200, background: thm.sidebar, border: `1px solid ${thm.borderSub}`, borderRight: "none", borderRadius: "4px 0 0 4px", padding: "4px 3px", cursor: "pointer", color: "#6a6a8e", fontSize: 11, fontFamily: "inherit" }}>{sidebarCollapsed ? "◀" : "▶"}</button>
        )}

        <OfficeSidebar
          roster={roster} stats={stats} feed={feed} feedRef={feedRef} detail={detail} selectedId={selectedId}
          meetingLogs={meetingLogs} waterfall={waterfall} leaderboard={leaderboard} incidentLog={incidentLog}
          incident={incident} dialogue={dialogue} timeline={timeline} realTaskCounts={realTaskCounts}
          boardTasks={boardTasks} liveRunsRef={liveRunsRef} theme={theme}
          sidebarCollapsed={sidebarCollapsed} toggleSidebar={toggleSidebar} isMobile={isMobile}
          setSelectedId={setSelectedId} setDetail={setDetail}
          ctxMenu={ctxMenu} setCtxMenu={setCtxMenu}
          simRef={simRef} addFeed={addFeed} volume={volume} changeVolume={changeVolume}
        />
      </div>

      {/* Status bar */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", height: 28,
        background: theme === "B" ? "#0a1510" : "#08081a", borderTop: `1px solid ${thm.borderSub}`,
        fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#6a6a8e", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#00ff88", fontWeight: 700 }}>{stats.working}</span><span>active</span>
          <span style={{ color: "#3a3a5e" }}>·</span>
          <span style={{ color: "#FDCB6E", fontWeight: 700 }}>{stats.meeting}</span><span>in meeting</span>
          <span style={{ color: "#3a3a5e" }}>·</span>
          <span style={{ color: "#6C5CE7", fontWeight: 700 }}>{stats.completed}</span><span>done</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {(() => { const tc = Object.values(liveRunsRef.current).reduce((s, r) => s + (r?.estimatedCost || 0), 0); return tc > 0 ? <span style={{ color: "#4a6a5a" }}>💰 ${tc.toFixed(2)} today</span> : null; })()}
          <span style={{ color: "#4a4a6a" }}>{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} ET</span>
        </div>
      </div>
    </div>
  );
}
