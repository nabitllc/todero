"use client";
import { useState, useCallback, useEffect } from "react";
import { fetchJson, formatApiError } from '@/hooks/useApiData'
import type { VaultBadgeInfo } from '@/lib/vault-badge'

// ─── Props ───────────────────────────────────────────────────────────────────
export interface OfficeSidebarProps {
  // Display data
  roster: any[];
  stats: { working: number; idle: number; completed: number };
  feed: any[];
  feedRef: React.RefObject<HTMLDivElement | null>;
  detail: any;
  selectedId: string | null;
  waterfall: any[];
  leaderboard: any[];
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
    roster, stats, feed, feedRef, detail, selectedId, waterfall,
    leaderboard, timeline, realTaskCounts,
    boardTasks, liveRunsRef, theme, sidebarCollapsed, toggleSidebar, isMobile,
    setSelectedId, setDetail, ctxMenu, setCtxMenu, simRef, addFeed,
    volume, changeVolume,
  } = props;

  // ─── Local state ─────────────────────────────────────────────────────────
  // Brain2 vault manifest data + the server-resolved model label, keyed by
  // agent id — read from the same /api/agents rows every other model badge
  // in the app reads. `modelById` is GET /api/agents' `model` field, which
  // lib/resolve-dispatch-model.ts's `resolveDispatchModel()` computed
  // server-side from the same chain walk the real spawn path runs — this
  // used to be re-derived client-side via the deleted lib/vault-badge.ts's
  // resolveVaultBadge() + an env-URL heuristic instead of just reading what
  // the server already resolved. The pixel office's sprite roster is a
  // fixed, non-vault list today, so `vaultById` (used only to gate the
  // "Brain2" chip below) is a no-op for every id currently clickable on the
  // canvas; it is wired up so the day a vault-only agent gets a sprite, this
  // file does not stay the one "model badge" view that never learned about it.
  const [vaultById, setVaultById] = useState<Record<string, VaultBadgeInfo>>({});
  const [modelById, setModelById] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchJson<any>('/api/agents').then(r => {
      if (cancelled || !r.ok) return;
      const body = r.data;
      const rows: any[] = Array.isArray(body?.agents) ? body.agents : [];
      const vMap: Record<string, VaultBadgeInfo> = {};
      const mMap: Record<string, string> = {};
      for (const row of rows) {
        if (!row?.id) continue;
        if (row.vault) vMap[row.id] = row.vault;
        if (typeof row.model === 'string' && row.model) mMap[row.id] = row.model;
      }
      setVaultById(vMap);
      setModelById(mMap);
    });
    return () => { cancelled = true; };
  }, []);

  const [openPanels, setOpenPanels] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem("office_panels"); return s ? new Set(JSON.parse(s)) : new Set(["feed"]); } catch { return new Set(["feed"]); }
  });
  const togglePanel = (id: string) => setOpenPanels(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem("office_panels", JSON.stringify(Array.from(next))); } catch (e) {}
    return next;
  });

  // LEADERBOARD's 'session' tab is really tasksCompleted, which is rehydrated
  // from localStorage on every load (officeDrawing.ts initAgents) — it does
  // NOT reset when the browser session does. Label it for what it is: an
  // all-time count kept in this browser, not "this session". The 24h/7d
  // tabs are the honest ones — backed by a real /api/status query.
  const lbTfLabel = (tf: 'session' | '24h' | '7d') => tf === 'session' ? 'ALL TIME (LOCAL)' : tf.toUpperCase();
  const lbCountLabel = (tf: 'session' | '24h' | '7d') => tf === 'session' ? 'all time (local)' : tf === '24h' ? 'today' : 'this week';

  const [showConfig, setShowConfig] = useState(false);
  const [configAgent, setConfigAgent] = useState<any>(null);
  const [configEdits, setConfigEdits] = useState<any>({});
  const [showSettings, setShowSettings] = useState(false);
  const [lbTimeframe, setLbTimeframe] = useState<'session' | '24h' | '7d'>('session');
  const [sessionLog, setSessionLog] = useState<any[]>([]);
  // TOD-654: why the session-log fetch failed, shown next to the button.
  const [logError, setLogError] = useState<string | null>(null);
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
    if (action === "config") {
      openConfig(ag);
    }
    setCtxMenu(null);
  };

  return (
    <>
      {/* Config modal */}
      {showConfig && configAgent && (
        <div className="fixed inset-0 bg-black/70 z-[400] flex items-center justify-center" onClick={(e: any) => e.target === e.currentTarget && setShowConfig(false)}>
          <div className="bg-[#0f0f0f] border border-white/10 rounded-xl p-5 w-[300px] text-white/70">
            <div className="flex justify-between mb-3.5">
              <span className="text-xs text-white/90 tracking-widest font-medium uppercase">CONFIGURE</span>
              <button onClick={() => setShowConfig(false)} className="bg-transparent border-none text-white/50 cursor-pointer text-sm focus:outline-none focus:ring-2 focus:ring-white/30 rounded-lg">✕</button>
            </div>
            <div className="flex items-center gap-2 mb-3.5">
              <span className="text-[22px]">{configAgent.emoji}</span>
              <div style={{ color: configEdits.color || configAgent.color }} className="text-xs font-bold">{configEdits.name || configAgent.name}</div>
            </div>
            {[{ l: "Name", k: "name", t: "text" }, { l: "Color", k: "color", t: "color" }].map(f => (
              <div key={f.k} className="mb-2.5">
                <div className="text-[10px] text-white/50 mb-1 tracking-widest font-medium uppercase">{f.l.toUpperCase()}</div>
                <input type={f.t} value={configEdits[f.k] || ""} onChange={(e: any) => setConfigEdits((p: any) => ({ ...p, [f.k]: e.target.value }))}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1 text-white/90 font-[inherit] text-[10px] box-border focus:outline-none focus:ring-2 focus:ring-white/30" />
              </div>
            ))}
            <div className="mb-3.5 p-2 bg-[#080808] rounded-lg">
              <div className="text-[10px] text-white/50 leading-relaxed">Agent behavior is driven by live agent runs. Visual config (name/color) is cosmetic only.</div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveConfig} className="flex-1 bg-[#6C5CE7] border-none rounded-lg text-white py-2 text-[10px] cursor-pointer font-[inherit] focus:outline-none focus:ring-2 focus:ring-white/30">Save</button>
              <button onClick={() => setShowConfig(false)} className="flex-1 bg-transparent border border-white/10 rounded-lg text-white/70 py-2 text-[10px] cursor-pointer font-[inherit] focus:outline-none focus:ring-2 focus:ring-white/30">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 z-[400] flex items-center justify-center" onClick={(e: any) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="bg-[#0f0f0f] border border-white/10 rounded-xl p-5 w-[280px] text-white/70">
            <div className="flex justify-between mb-3.5">
              <span className="text-xs text-white/90 tracking-widest font-medium uppercase">KEYBOARD SHORTCUTS</span>
              <button onClick={() => setShowSettings(false)} className="bg-transparent border-none text-white/50 cursor-pointer text-sm focus:outline-none focus:ring-2 focus:ring-white/30 rounded-lg">✕</button>
            </div>
            <div className="p-2 bg-[#080808] rounded-lg text-[10px] text-white/50 leading-relaxed">
              {[["Space", "Pause/Resume"], ["M", "Toggle minimap"], ["D", "Dep flow graph"], ["O", "Orchestrator panel"], ["R", "Replay mode"], ["Esc", "Close panels"]].map(([k, v]) => (
                <div key={k} className="flex justify-between mb-0.5">
                  <kbd className="bg-[#1a1a1a] border border-white/10 rounded px-1 text-[9px] text-[#6C5CE7]">{k}</kbd>
                  <span className="text-white/50 text-[10px]">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="text-[10px] text-white/50 mb-1.5 tracking-widest font-medium uppercase">VOLUME</div>
              <input type="range" min="0" max="100" value={volume}
                onChange={(e: any) => changeVolume(+e.target.value)}
                className="w-full accent-[#6C5CE7]" />
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-white/30">🔇</span>
                <span className="text-[9px] text-white/30">{volume}%</span>
                <span className="text-[9px] text-white/30">🔊</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div className="fixed inset-0 z-[500]" onClick={() => setCtxMenu(null)}>
          <div className="absolute bg-[#0f0f0f] border border-white/10 rounded-lg overflow-hidden min-w-[160px] shadow-[0_4px_20px_rgba(0,0,0,0.7)]"
            style={{ left: ctxMenu.screenX, top: ctxMenu.screenY }}
            onClick={(e: any) => e.stopPropagation()}>
            {(() => {
              const ag = roster.find(a => a.id === ctxMenu.agentId);
              if (!ag) return null;
              return <>
                <div className="px-3 py-1.5 border-b border-white/10 flex items-center gap-1.5">
                  <span className="text-sm">{ag.emoji}</span>
                  <span className="text-[10px] font-bold" style={{ color: ag.color }}>{ag.name}</span>
                </div>
                {[
                  { action: "config", label: "⚙ Configure agent", disabled: false },
                ].map(item => (
                  <button key={item.action} onClick={() => ctxAction(item.action)} disabled={item.disabled}
                    className={`block w-full bg-transparent border-none border-b border-white/10 py-2 px-3 text-left cursor-pointer text-[9px] font-[inherit] focus:outline-none focus:ring-2 focus:ring-white/30 ${item.disabled ? 'text-white/10 cursor-default' : 'text-white/70'}`}>
                    {item.label}
                  </button>
                ))}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`flex-shrink-0 flex-col border-l border-white/10 overflow-hidden transition-[width] duration-200 ease-in-out ${isMobile ? 'hidden' : 'flex'} ${theme === 'B' ? 'bg-[#080808]' : 'bg-[#080808]'}`}
        style={{ width: sidebarCollapsed ? 44 : 320 }}>

        {/* Collapsed sidebar: icon-only panel indicators */}
        {sidebarCollapsed && (
          <div className="flex flex-col items-center gap-0.5 py-1.5">
            {detail && <button onClick={() => toggleSidebar()} className="bg-transparent border-none text-base cursor-pointer p-1 min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white/30 rounded-lg" style={{ color: detail.color }} title={detail.name}>{detail.emoji}</button>}
            {[{ id: "feed", icon: "📡", label: "Feed" }, { id: "flow", icon: "✓", label: "Tasks" }, { id: "board", icon: "🏆", label: "Leaderboard" }, { id: "deps", icon: "🔗", label: "Dependencies" }].map(p => (
              <button key={p.id} onClick={() => { if (!openPanels.has(p.id)) togglePanel(p.id); toggleSidebar(); }}
                className={`border-none text-[13px] cursor-pointer rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white/30 ${openPanels.has(p.id) ? 'bg-[#1a1a1a] text-[#a29bfe]' : 'bg-transparent text-white/30'}`}
                title={p.label}>{p.icon}</button>
            ))}
          </div>
        )}

        {/* Detail panel — shows when an agent is selected on canvas */}
        {!sidebarCollapsed && detail && (
          <div className="flex-shrink-0 border-b border-white/10 overflow-y-auto max-h-[45%]">
            <div className="sticky top-0 bg-[#080808] z-[1] flex items-center justify-between px-3 py-1 border-b border-white/10">
              <span className="text-xs text-white/50 uppercase tracking-widest font-medium">AGENT DETAIL{detail.isOrchestrator ? " 👑" : ""}</span>
              <div className="flex gap-1">
                <button onClick={() => { setSelectedId(null); setDetail(null); }} className="bg-transparent border-none text-white/50 cursor-pointer text-xs font-[inherit] p-0 focus:outline-none focus:ring-2 focus:ring-white/30 rounded-lg">✕</button>
              </div>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{detail.emoji}</span>
                <div className="flex-1">
                  <div className="font-bold text-sm" style={{ color: detail.color }}>{detail.name}</div>
                  <div className="text-white/50 text-[11px]">{detail.role}</div>
                  <div className="text-white/30 text-[10px] mt-0.5">
                    {detail.lastStateChange
                      ? `Last active ${Math.round((Date.now() - detail.lastStateChange) / 60000)}m ago`
                      : "Not yet active"}
                  </div>
                </div>
                <div className={`text-[9px] px-1.5 py-0.5 rounded ${detail.state === "working" ? 'bg-[#00ff88]/10 text-[#00ff88]' : 'bg-[#1a1a1a] text-white/50'}`}>
                  {detail.state?.replace(/_/g, " ")}
                </div>
              </div>
              {/* MC-91: Show model info */}
              {(() => { const liveRun = liveRunsRef.current[detail.id]; return liveRun ? (
                <div className="flex gap-1.5 mb-1.5 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-white/70">Issue: {liveRun.taskTitle || "None"}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-white/70">Today: {liveRun.todayTasks} tasks</span>
                  {liveRun.todayErrors > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-950/50 text-red-500">{liveRun.todayErrors} errors</span>}
                </div>
              ) : null })()}
              {/* Server-resolved model label — same GET /api/agents row every
                  other model badge in the app reads. Only renders when the
                  selected sprite's id has a Brain2 manifest. */}
              {detail.id && vaultById[detail.id] && (() => {
                return (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1a1a1a] text-white/70">{modelById[detail.id] ?? '—'}</span>
                    <span
                      className="text-[8px] px-1.5 py-0.5 rounded-full border border-purple-500/40 text-purple-300 bg-purple-500/10 font-semibold"
                      title="Resolved from the Brain2 vault manifest (Global_Agents/<id>/manifest.json)"
                    >
                      Brain2
                    </span>
                  </div>
                )
              })()}
              <div className="flex gap-3 mb-2">
                <div className="text-center"><div className="text-sm font-bold" style={{ color: detail.color }}>{detail.tasksCompleted}</div><div className="text-[10px] text-white/50">TASKS</div></div>
              </div>
              {detail.taskHistory?.length > 0 && (
                <div>
                  <div className="text-[10px] text-white/50 mb-1 tracking-widest font-medium uppercase">RECENT TASKS</div>
                  {[...detail.taskHistory].reverse().slice(0, 3).map((t: string, i: number) => (
                    <div key={i} className="text-[11px] text-white/50 py-0.5 border-b border-white/10">
                      <span className="text-white/30 mr-1">↳</span>{t}
                    </div>
                  ))}
                </div>
              )}
              {/* MC-13: View real session log */}
              <div className="mt-1.5">
                <button onClick={() => {
                  setLoadingLog(true);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wide health payload
                  fetchJson<any>('/api/status').then(res => {
                    if (!res.ok) { setLogError(formatApiError(res.error)); setSessionLog([]); setLoadingLog(false); return }
                    setLogError(null);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped activity rows
                    const activity: any[] = res.data?.recentActivity || [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped activity rows
                    const agentLogs = activity.filter((a: any) => a.agentId === detail.id).slice(0, 10);
                    setSessionLog(agentLogs);
                    setLoadingLog(false);
                  });
                }} className="bg-[#1a1a1a] border border-white/10 rounded-lg text-[#a29bfe] px-2.5 py-1 text-[10px] cursor-pointer font-[inherit] w-full focus:outline-none focus:ring-2 focus:ring-white/30">
                  {loadingLog ? "Loading…" : "View Session Log"}
                </button>
                {logError && (
                  <p className="mt-1.5 text-red-400 text-[10px] break-words">{logError}</p>
                )}
                {sessionLog.length > 0 && (
                  <div className="mt-1.5 max-h-[150px] overflow-y-auto bg-[#080808] border border-white/10 rounded-lg px-1.5 py-1">
                    {sessionLog.map((entry: any, i: number) => (
                      <div key={i} className={`py-1 text-[10px] ${i < sessionLog.length - 1 ? 'border-b border-white/10' : ''}`}>
                        <div className="flex justify-between">
                          <span className={`font-semibold ${entry.action === 'code' ? 'text-blue-500' : entry.action === 'research' ? 'text-purple-400' : 'text-white/70'}`}>{entry.action || 'activity'}</span>
                          <span className="text-white/30 text-[9px]">{entry.ago != null ? `${entry.ago}m ago` : ''}</span>
                        </div>
                        <div className="text-white/50 leading-snug break-words">{entry.desc || entry.channel || '—'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* KAOS-specific: read-only exec terminal (MC-18) */}
            {detail && detail.isOrchestrator && (
              <div className="border-t border-white/10 px-3 py-2">
                <div className="text-xs text-white/50 uppercase tracking-widest font-medium mb-1">EXEC OUTPUT</div>
                <div className="bg-[#080808] border border-white/10 rounded-lg px-2 py-1.5 max-h-[180px] overflow-y-auto font-mono">
                  {feed.slice(-10).map((e: any) => (
                    <div key={e.id} className="flex gap-1 items-start mb-0.5">
                      <span className="text-white/30 text-[9px] flex-shrink-0 mt-0.5">{e.ts}</span>
                      <span className="text-[10px] leading-normal break-words" style={{ color: e.color }}>{e.text}</span>
                    </div>
                  ))}
                  {feed.length === 0 && <div className="text-white/30 text-[10px] text-center py-2">No exec output yet</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable panels — all in one scrollable container */}
        <div className={`flex-1 min-h-0 overflow-y-auto ${sidebarCollapsed ? 'hidden' : 'block'}`}>

          {/* ▼ ACTIVITY FEED — always expanded. feed is an in-memory array
              that starts empty on every page load — there is no 24h/7d
              window to filter by, so no timeframe tabs are offered here
              (contrast LEADERBOARD below, whose 24h/7d tabs are backed by a
              real /api/status query). */}
          <div>
            <div onClick={() => togglePanel("feed")} className="px-3 py-1.5 border-b border-white/10 cursor-pointer flex items-center justify-between bg-[#0f0f0f] select-none">
              <span className="text-xs text-white/50 uppercase tracking-widest font-medium">{openPanels.has("feed") ? "▼" : "▶"} ACTIVITY FEED</span>
              <span className="text-[9px] text-white/30">{feed.length} this session</span>
            </div>
            {openPanels.has("feed") && (
              <div ref={feedRef} className="max-h-[200px] overflow-y-auto py-1">
                {feed.slice(-20).map((e: any) => <div key={e.id} className="px-3 py-0.5 flex gap-1 items-start">
                  <span className="text-white/30 text-[9px] flex-shrink-0 mt-0.5">{e.ts}</span>
                  <span className="text-[11px] leading-normal" style={{ color: e.color }}>{e.text}</span>
                </div>)}
                {feed.length === 0 && <div className="text-white/30 text-[10px] text-center py-3">No agent events observed yet</div>}
              </div>
            )}
          </div>

          {/* ▶ COMPLETED TASKS — same in-memory, session-only array as the
              feed above; no timeframe tabs for the same reason. */}
          <div>
            <div onClick={() => togglePanel("flow")} className="px-3 py-1.5 border-b border-white/10 cursor-pointer flex items-center justify-between bg-[#0f0f0f] select-none">
              <span className="text-xs text-white/50 uppercase tracking-widest font-medium">{openPanels.has("flow") ? "▼" : "▶"} COMPLETED TASKS</span>
              <span className={`text-[9px] ${waterfall.length > 0 ? 'text-[#00ff88]' : 'text-white/30'}`}>{waterfall.length} this session</span>
            </div>
            {openPanels.has("flow") && (
              <>
                <div className="max-h-[200px] overflow-y-auto">
                  {waterfall.length === 0 && <div className="px-3 py-3 text-white/30 text-[11px] text-center leading-relaxed">Completions appear when agents finish work.</div>}
                  {waterfall.map((wf: any) => {
                    const ag = roster.find(a => a.id === wf.agentId);
                    if (!ag) return null;
                    return (
                      <div key={wf.id} className="px-3 py-1 border-b border-white/10">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px]">{ag.emoji}</span>
                          <span className="text-[11px] font-bold" style={{ color: ag.color }}>{ag.name}</span>
                          <span className="text-white/50 text-[10px]">✓ {wf.task}</span>
                          <span className="text-white/30 text-[9px] ml-auto">{wf.ts}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ▶ LEADERBOARD */}
          <div>
            <div onClick={() => togglePanel("board")} className="px-3 py-1.5 border-b border-white/10 cursor-pointer flex items-center justify-between bg-[#0f0f0f] select-none">
              <span className="text-xs text-white/50 uppercase tracking-widest font-medium">{openPanels.has("board") ? "▼" : "▶"} LEADERBOARD</span>
              <span className="text-[9px] text-white/30 uppercase">{lbTfLabel(lbTimeframe)}</span>
            </div>
            {openPanels.has("board") && (
              <div>
                {/* Timeframe tabs */}
                <div className="flex border-b border-white/10 bg-[#080808]">
                  {(['session', '24h', '7d'] as const).map(tf => (
                    <button key={tf} onClick={(e) => { e.stopPropagation(); setLbTimeframe(tf); }}
                      className={`flex-1 py-1 text-[10px] font-semibold tracking-wide bg-transparent border-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/30 ${lbTimeframe === tf ? 'text-[#a29bfe] border-b-2 border-b-[#6C5CE7]' : 'text-white/30 border-b-2 border-b-transparent'}`}>
                      {lbTfLabel(tf)}
                    </button>
                  ))}
                </div>
                <div className="max-h-[180px] overflow-y-auto">
                  {(() => {
                    const ranked = leaderboard.map(a => {
                      const real = realTaskCounts[a.id] || { h24: 0, d7: 0 };
                      const count = lbTimeframe === 'session' ? a.tasksCompleted
                        : lbTimeframe === '24h' ? real.h24
                        : real.d7;
                      return { ...a, displayCount: count };
                    }).sort((a, b) => b.displayCount - a.displayCount);
                    if (ranked.every(a => a.displayCount === 0)) return (
                      <div className="px-3 py-3 text-white/30 text-[11px] text-center">
                        {lbTimeframe === 'session' ? 'Collecting data…' : 'No activity in this window'}
                      </div>
                    );
                    return ranked.map((a: any, rank: number) => (
                      <div key={a.id} className="px-3 py-1 border-b border-white/10 flex items-center gap-1.5">
                        <span className={`text-[10px] w-3.5 text-center font-bold ${rank === 0 ? 'text-[#FFD700]' : rank === 1 ? 'text-[#C0C0C0]' : rank === 2 ? 'text-[#CD7F32]' : 'text-white/30'}`}>
                          {rank === 0 ? "①" : rank === 1 ? "②" : rank === 2 ? "③" : String(rank + 1)}
                        </span>
                        <span className="text-[11px]">{a.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold" style={{ color: a.color }}>{a.name}</div>
                          <div className="text-[10px] text-[#00ff88]">{a.displayCount} {lbCountLabel(lbTimeframe)}</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* TOD (agent-roster-truth): the "DEPENDENCY CHAINS" panel used to
              render a hardcoded reporting hierarchy (main → scout/kemuni-sme/
              vespera-sme, …) for whatever ids happened to still be in the
              roster — a static org chart presented as observed structure.
              There is no real dependency/reporting graph in /api/agents (or
              anywhere else) yet, so the panel is gone rather than kept
              showing an assumed hierarchy dressed as data. */}
        </div>{/* end expandable panels */}

        {/* Stats bar */}
        <div className={`flex-shrink-0 border-t border-white/10 py-1.5 ${sidebarCollapsed ? 'hidden' : 'flex'}`}>
          {[{ l: "DONE", v: stats.completed, c: "#6C5CE7" }, { l: "ACTIVE", v: stats.working, c: "#00ff88" }, { l: "IDLE", v: stats.idle, c: "#3a3a5e" }].map((s, i, arr) => (
            <div key={s.l} className={`flex-1 text-center ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>
              <div className="text-base font-bold leading-none" style={{ color: s.c }}>{s.v}</div>
              <div className="text-[10px] text-white/30 tracking-wide mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>

        {/* Event timeline strip */}
        {timeline.length > 0 && (
          <div className="flex-shrink-0 border-t border-white/10 px-3 py-1">
            <div className="h-[5px] bg-[#080808] rounded overflow-hidden relative" title="Session events: green=task started/completed">
              {timeline.map((ev: any, i: number) => (
                <div key={i} title={`${ev.ts} — ${ev.label}`} className="absolute top-0 w-[3px] h-full rounded-sm opacity-70 -translate-x-1/2"
                  style={{
                    left: `${(i / Math.max(1, timeline.length - 1)) * 100}%`,
                    background: ev.color,
                  }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
