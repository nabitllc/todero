"use client";
import { useEffect, useRef, useState } from "react";

import {
  MAP_COLS, MAP_ROWS, THEMES,
} from './officeConstants';
import type { AgentRunInfo } from './officeConstants';

import {
  drawFloor, drawFurniture, drawParticles, drawAgents, drawMinimap,
  tileCenterPx, nowts,
  initAgents, saveMemory, createAudio, getDayNight, clampCam, applyCamera, captureFrame,
} from './officeDrawing';
// Every decision these polls make lives in officePolling.ts as a pure exported
// function, so it is pinned by a test that RUNS it rather than by a source
// grep. See that file's header for why.
import {
  BOARD_TASKS_QUERY, WAITING_QUERY, BOARD_TASK_POLL_MS, WAITING_POLL_MS,
  boardTaskPollOutcome, waitingPollOutcome, partitionWaiting, unroutedWaitingMessage,
} from './officePolling';

import { fetchAgentRuns } from '../../hooks/useAgentStatus';
import ApiErrorBanner from '../ApiErrorBanner';
import { fetchJson, type ApiError } from '@/lib/fetch-json';

// ─── Props ───────────────────────────────────────────────────────────────────
interface OfficeCanvasProps {
  // Shared state from parent
  selectedId: string | null;
  theme: "A" | "B";
  paused: boolean;
  soundOn: boolean;
  volume: number;
  showMinimap: boolean;
  showDepGraph: boolean;
  showGrid: boolean;
  showLegend: boolean;
  simSpeed: number;
  replayMode: boolean;
  isMobile: boolean;
  canvasScale: number;
  // State setters
  setPaused: (fn: (p: boolean) => boolean) => void;
  setSelectedId: (id: string | null | ((prev: string | null) => string | null)) => void;
  setDetail: (d: any | ((prev: any) => any)) => void;
  setRoster: (r: any[]) => void;
  setStats: (s: any) => void;
  setWaterfall: (w: any[]) => void;
  setTimeline: (t: any[]) => void;
  setLeaderboard: (l: any[]) => void;
  setReplayLen: (n: number) => void;
  setRealTaskCounts: (c: Record<string, { h24: number; d7: number }>) => void;
  setShowMinimap: (fn: (s: boolean) => boolean) => void;
  setShowDepGraph: (fn: (s: boolean) => boolean) => void;
  setReplayMode: (fn: (r: boolean) => boolean) => void;
  setTab: (fn: (t: string) => string) => void;
  // Callbacks
  addFeed: (text: string, color?: string) => void;
  addToast: (text: string, color?: string) => void;
  // Shared refs (owned by parent or useAgentStatus)
  simRef: React.MutableRefObject<any>;
  liveRunsRef: React.MutableRefObject<Record<string, AgentRunInfo>>;
  boardTasksRef: React.MutableRefObject<Record<string, string>>;
  subagentCountRef: React.MutableRefObject<number>;
  subagentSessionsRef: React.MutableRefObject<any[]>;
  // Canvas context menu callback
  setCtxMenu: (v: any) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function OfficeCanvas(props: OfficeCanvasProps) {
  const {
    selectedId, theme, paused, soundOn, volume, showMinimap, showDepGraph,
    showGrid, showLegend, simSpeed, replayMode, isMobile, canvasScale,
    setPaused, setSelectedId, setDetail, setRoster, setStats,
    setWaterfall, setTimeline, setLeaderboard,
    setReplayLen, setRealTaskCounts, setShowMinimap, setShowDepGraph,
    setReplayMode, setTab,
    addFeed, addToast,
    simRef, liveRunsRef, boardTasksRef, subagentCountRef, subagentSessionsRef,
    setCtxMenu,
  } = props;

  // A failed poll must never be indistinguishable from "office full of idle
  // agents" — each source that drives visible agent state sets its own key
  // here on failure and clears it on the next success. Rendered as a banner
  // over the canvas below.
  const [pollErrors, setPollErrors] = useState<Record<string, ApiError>>({});
  // TOD (agent-roster-truth): 'loading' until /api/agents answers once,
  // 'empty' when it succeeded with zero rows (a real, honest state — not
  // silently filled with invented agents), 'ready' otherwise.
  const [rosterState, setRosterState] = useState<'loading' | 'ready' | 'empty'>('loading');
  const setPollError = (key: string, err: ApiError | null) => {
    setPollErrors(pe => {
      if (err) return { ...pe, [key]: err };
      if (!(key in pe)) return pe;
      const { [key]: _drop, ...rest } = pe;
      return rest;
    });
  };

  // ── Canvas-owned refs ──────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const animRef        = useRef<any>(null);
  const camRef         = useRef({x:0,y:0,z:1,drag:false,ds:null as any,cs:null as any,minZ:1});
  const tileRef        = useRef(0);
  const feedIdRef      = useRef(1);
  const totalDone      = useRef(0);
  // TOD (agent-roster-truth): the real roster, fetched from /api/agents —
  // null until the first successful answer, never a hardcoded stand-in. See
  // the "Roster polling" effect below.
  const rosterRef      = useRef<any[] | null>(null);
  const replayFrames   = useRef<any[]>([]);
  const replayCurRef   = useRef(0);
  const waterfallRef   = useRef<any[]>([]);
  const timelineRef    = useRef<any[]>([]);
  const hoverAgentRef  = useRef<any>(null);
  // agentId -> how many inbox requests that agent has PENDING on a human right
  // now. Populated only by the "Waiting on you" poll below; an agent with no
  // key here is not waiting, and is drawn with no bubble at all.
  const waitingRef     = useRef<Record<string, number>>({});
  // The last unrouted-waiting sentence pushed to the feed, so a 60s poll that
  // keeps finding the same off-roster agent says it once, not once a minute.
  const lastUnroutedMsgRef = useRef<string|null>(null);
  const zoomTargetRef  = useRef<{x:number,y:number,z:number}|null>(null);
  const soundRef       = useRef(true);
  const audioRef       = useRef<any>(null);
  const pausedRef      = useRef(false);
  const minimapRef     = useRef(true);
  const depGraphRef    = useRef(false);
  const showLegendRef  = useRef(true);
  const replayModeRef  = useRef(false);
  const simSpeedRef    = useRef(1);
  const showGridRef    = useRef(true);
  const themeRef       = useRef<"A"|"B">("A");

  // ── Sync refs from props ───────────────────────────────────────────────────
  useEffect(()=>{minimapRef.current=showMinimap;},[showMinimap]);
  useEffect(()=>{themeRef.current=theme;},[theme]);
  useEffect(()=>{showGridRef.current=showGrid;},[showGrid]);
  useEffect(()=>{depGraphRef.current=showDepGraph;},[showDepGraph]);
  useEffect(()=>{showLegendRef.current=showLegend;},[showLegend]);
  useEffect(()=>{replayModeRef.current=replayMode;},[replayMode]);
  useEffect(()=>{simSpeedRef.current=simSpeed;},[simSpeed]);
  useEffect(()=>{pausedRef.current=paused;},[paused]);
  useEffect(()=>{soundRef.current=soundOn;},[soundOn]);

  // ── Initial audio setup ────────────────────────────────────────────────────
  useEffect(()=>{const i=()=>{if(!audioRef.current){audioRef.current=createAudio();if(audioRef.current?.master)audioRef.current.master.gain.value=volume/100*0.15;}};window.addEventListener("click",i,{once:true});return()=>window.removeEventListener("click",i);},[volume]);

  // ── Save on unmount ────────────────────────────────────────────────────────
  useEffect(()=>()=>{if(simRef.current?.agents)saveMemory(simRef.current.agents);},[]);

  // ── Roster polling ──────────────────────────────────────────────────────
  // The office's ONLY source of who exists. A failed fetch renders the same
  // ApiErrorBanner every other tab uses (naming /api/agents and the status);
  // a successful-but-empty roster is drawn as an empty office, never as the
  // office's own fabricated stand-in cast.
  useEffect(()=>{
    let cancelled=false;
    const fetchRoster=async()=>{
      const r=await fetchJson<any>('/api/agents');
      if(cancelled) return;
      if(!r.ok){ setPollError('roster', r.error); return; }
      setPollError('roster', null);
      const data:any=r.data;
      const rows:any[] = Array.isArray(data) ? data : (data && Array.isArray(data.agents) ? data.agents : []);
      rosterRef.current=rows;
      setRosterState(rows.length>0?'ready':'empty');
    };
    fetchRoster();
    const t=setInterval(fetchRoster,60000);
    return()=>{cancelled=true;clearInterval(t);};
  },[]);

  // ── Board task polling ─────────────────────────────────────────────────────
  // TOD (agent-visualization-fidelity): this used to call '/api/tasks', and
  // every poll 404'd — on TWO independent intervals (this one and the
  // identical query in useAgentStatus.ts), forever.
  //
  // WHY, precisely — this matters, because the obvious repair is the wrong
  // one. /api/tasks is not a route someone invented and never built. It
  // EXISTED, and commit fd7e5b5 ("refactor: tasks → issues") renamed it:
  //   app/api/{tasks => issues}/route.ts   |  8 ++++----
  //   lib/{tasks.ts => issues.ts}          |  2 +-
  // The table, the lib and the route all moved to `issues` in that commit.
  // These two callers were the stragglers it missed, and they have been
  // pointed at the old name ever since. So the fix is not to build a new
  // /api/tasks — that would resurrect the exact name the rename retired, as a
  // second spelling of a concept that already has one. The fix is to finish
  // fd7e5b5: follow the rename to where it went.
  //
  // "What is this agent working on" IS an issue with status=in_progress and an
  // assignee, on the `issues` table that /api/issues already serves.
  //
  // `limit=0` is /api/issues' documented "unbounded" sentinel (route.ts:965,
  // "Pass ?limit=0 for unbounded"), NOT "zero rows" — verified against the
  // running server with a real in_progress fixture, which came back in the
  // body. Getting that backwards would make this poll succeed while always
  // returning nothing, which is worse than the 404 it replaced.
  //
  // The Office is a fleet-wide (cross-project) surface, and it asks for that
  // DELIBERATELY with `all_projects=1` rather than relying on middleware to
  // stamp `x-mc-all-projects`. The earlier revision of this comment claimed
  // the stamp was enough; it is not, and the gap was a live 400. middleware's
  // `projectFromPathname` returns null unless the path contains `/p/<slug>`
  // (middleware.ts:66-73), so from the bare `/fleet/office` URL — which
  // app/page.tsx's parseURL serves — there is no scope AND no cross-project
  // stamp, and app/api/issues/route.ts:1084 answers 400 `unscoped_issues_read`.
  // Measured both ways on 2026-08-26; see BOARD_TASKS_QUERY's docstring.
  useEffect(()=>{
    const fetchTasks=async()=>{
      try{
        const r=await fetchJson<{ data: any[] }>(BOARD_TASKS_QUERY);
        const out=boardTaskPollOutcome(r);
        setPollError('tasks', out.error);
        // `tasks === null` means "unreadable answer" — keep the last known
        // board rather than emptying every desk. The banner already says so.
        if(out.tasks) boardTasksRef.current=out.tasks;
      }catch(e){}
    };
    fetchTasks();
    const t=setInterval(fetchTasks,BOARD_TASK_POLL_MS); // raised 30s→60s (Supabase egress)
    return()=>clearInterval(t);
  },[]);

  // ── "Waiting on you" polling ───────────────────────────────────────────────
  // The one state in this app that genuinely means "this agent has stopped and
  // a HUMAN has to answer before it moves again": an `inbox` row with
  // status='pending'. lib/approvals.ts states it in those words —
  // `${agent} filed "${shown}" and it is waiting on you.` — and a refusal
  // "leaves it stopped". So a pending row is not a notification; it is a
  // blocked agent, which is exactly what a speech bubble should mean.
  //
  // Nothing here is inferred. The bubble is drawn from the COUNT of that
  // agent's own pending rows and nothing else: no "probably waiting", no
  // guess from idleness, no bubble for an agent with zero pending rows. If
  // the poll fails, the ApiErrorBanner names /api/inbox and NO bubbles are
  // drawn — an unanswered question must never render as "nobody is waiting".
  //
  // Fleet-wide on purpose, and the unscoped shape is deliberate: /api/inbox
  // returns a BARE ARRAY when `project=` is omitted and `{data,...}` when it
  // is given (see that route's "TWO RESPONSE SHAPES" comment). The Office is
  // a fleet/* surface, so it wants the fleet-wide array — the same leg
  // OverviewTab's "Needs you" already reads.
  useEffect(()=>{
    let cancelled=false;
    const fetchWaiting=async()=>{
      const r=await fetchJson<any>(WAITING_QUERY);
      if(cancelled) return;
      // ONE function decides both halves — the counts and the banner — so a
      // test can assert they move together. On a failed poll it returns {}
      // AND a non-null error: no bubbles, but never a silent "nobody is
      // waiting". `countWaitingByAgent` inside it resolves the target the
      // same way lib/approvals.ts:approvalTarget() does (`row.agent`, then
      // `context.agent_id`), so a bubble lands on the agent a decision would
      // actually unblock.
      const out=waitingPollOutcome(r);
      setPollError('waiting', out.error);
      // A pending row naming an agent that is not on this floor cannot be
      // drawn over a head. It used to be silently dropped by the
      // `waiting[ag.id]||0` lookup; now the canvas says so out loud instead
      // of swallowing a real human decision. (Measured live 2026-08-26:
      // /api/inbox named `lane7-critic-agent`, which is not one of the 28 ids
      // /api/agents returns.)
      const roster=(simRef.current?.agents??[]).map((a:any)=>a.id);
      const split=partitionWaiting(out.waiting, roster);
      waitingRef.current=split.drawable;
      const msg=unroutedWaitingMessage(split.unroutedIds, split.unroutedRows);
      if(msg && msg!==lastUnroutedMsgRef.current){ addFeed(msg,'#E879F9'); }
      lastUnroutedMsgRef.current=msg;
    };
    fetchWaiting();
    const t=setInterval(fetchWaiting,WAITING_POLL_MS);
    return()=>{cancelled=true;clearInterval(t);};
  },[addFeed]);

  // ── Supabase agent_runs polling — real-time status for ALL 8 agents ────
  useEffect(()=>{
    let cancelled=false;
    const pollRuns=async()=>{
      try{
        const runs=await fetchAgentRuns();
        if(cancelled) return;
        setPollError('runs', null);
        liveRunsRef.current=runs;
        if(!simRef.current?.agents) return;
        const agents=simRef.current.agents;
        agents.forEach((ag:any)=>{
          const run=runs[ag.id];
          if(!run) return;
          if(run.status==='live'){
            if(ag.state!=='working'){
              ag.state='working';
              ag.task=run.taskTitle||'Working';
              ag.progress=5;
              ag.glowTick=60;
              ag.lastStateChange=Date.now();
              addFeed(`${ag.emoji} ${ag.name}: ${run.taskTitle||'Working'}`,ag.color);
            } else if(ag.state==='working'&&run.taskTitle&&ag.task!==run.taskTitle){
              ag.task=run.taskTitle;
              ag.progress=5;
            }
          } else if(run.status==='ended'){
            if(ag.state==='working'){
              ag.tasksCompleted++;
              totalDone.current++;
              ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);
              addFeed(`${ag.emoji} ${ag.name}: done`,'#00ff88');
              ag.state='idle';ag.task=null;ag.progress=0;
              ag.lastStateChange=Date.now();
            }
          } else if(run.status==='stale'){
            // Orphaned 'running' row — the process died without reporting a
            // terminal status. Stop showing it as working; do not claim done.
            if(ag.state==='working'){
              ag.state='idle';ag.task=null;ag.progress=0;
              ag.lastStateChange=Date.now();
            }
          }
          // 'never' agents stay idle with no task
        });
      }catch(e:any){
        if(cancelled) return;
        setPollError('runs', e?.apiError ?? { status:0, endpoint:'agent_runs', message: e instanceof Error ? e.message : 'could not reach the server' });
      }
    };
    pollRuns();
    const t=setInterval(pollRuns,30000); // raised 10s→30s (Supabase egress)
    return()=>{cancelled=true;clearInterval(t);};
  },[addFeed]);

  // ── Real data polling — SOLE source of agent state ─────────────────────
  useEffect(()=>{
    let prevStates:Record<string,string>={};
    const poll=async()=>{
      try{
        const r=await fetchJson<any>('/api/status');
        if(!r.ok){ setPollError('status', r.error); return; }
        setPollError('status', null);
        const data=r.data;
        if(!simRef.current?.agents) return;
        const agents=simRef.current.agents;
        const taskMap:Record<string,string>=data.agentCurrentTask||{};
        // TOD (agent-roster-truth): "sub-agent of the orchestrator" used to
        // mean "agentId === 'main'" and a hardcoded 4-id SUB_AGENT_MAP —
        // wrong the moment the real roster's orchestrator isn't literally
        // named 'main', or has a fifth agent. Both now resolve against the
        // roster that was actually loaded (agents, from initAgents()).
        const orchId = agents.find((a:any)=>a.isOrchestrator)?.id
        // Count active sub-agents from recentActivity
        const activity: any[] = data.recentActivity || []
        const activeSubagents = activity.filter((a: any) =>
          a.agentId === orchId &&
          (a.action === 'delegate' || a.channel?.includes('Sub-agent')) &&
          a.ago != null && a.ago < 10
        ).length
        subagentCountRef.current = activeSubagents

        // MC-45: Build subagent sessions from active agent_runs (any real,
        // non-orchestrator roster agent working recently — not a fixed list).
        const liveRuns = liveRunsRef.current
        const subSessions: typeof subagentSessionsRef.current = []
        for (const [aid, info] of Object.entries(liveRuns)) {
          if (aid === orchId || !info || info.status !== 'live') continue
          const meta = agents.find((a:any)=>a.id===aid&&!a.isOrchestrator)
          if (meta) {
            subSessions.push({ id: aid, name: meta.name, emoji: meta.emoji, color: meta.color, task: info.taskTitle, startedAt: info.startedAt ? new Date(info.startedAt).getTime() : Date.now() })
          }
        }
        subagentSessionsRef.current = subSessions

        agents.forEach((ag:any)=>{
          if(!ag.active) return;
          const prev=prevStates[ag.id]||"idle";
          const rawTask=taskMap[ag.id]||"";
          const lower=rawTask.toLowerCase();
          const isActive=lower.startsWith("active")||lower.startsWith("working")||lower.startsWith("running")||lower.startsWith("processing");
          // Clean the description: "Active on Telegram · 53.5k tokens" → "Processing session"
          // "Processing: Why don't I see Kaos..." → show that label
          let taskDesc:string|null=null;
          if(isActive){
            if(rawTask.startsWith("Active: ")||rawTask.startsWith("Processing: ")){
              // Real task label from last user message
              const colonIdx=rawTask.indexOf(": ");
              taskDesc=rawTask.slice(colonIdx+2).trim().slice(0,40);
            } else {
              // Extract channel from "Active on Telegram · 12.3k tokens" or "Active on Sub-agent · ..."
              const channelMatch=rawTask.match(/on\s+([A-Za-z\-]+)/);
              const ch=channelMatch?.[1]||"";
              const chClean=ch==="Sub-agent"?"🤖 sub-agent":ch==="Telegram"?"📱 session":ch==="Discord"?"💬 session":ch==="Cron"?"⏱ cron":ch==="Session"?"session":"";
              // Extract token count
              const tokMatch=rawTask.match(/([\d.]+)k tokens/);
              const tokStr=tokMatch?` · ${tokMatch[1]}k`:"";
              taskDesc=chClean?`${chClean}${tokStr}`:"Working";
            }
          }

          if(isActive&&taskDesc){
            if(ag.state!=="working"){
              // Transition: idle → working
              ag.state="working";
              ag.task=taskDesc;
              ag.progress=5;
              ag.glowTick=60; // 60-frame glow on transition
              ag.lastStateChange=Date.now();
              addFeed(`${ag.emoji} ${ag.name}: ${taskDesc}`,ag.color);
              if(soundRef.current&&audioRef.current)audioRef.current.playClick();
              timelineRef.current=[...timelineRef.current,{type:"task",color:ag.color,ts:nowts(),label:`${ag.name}: ${taskDesc}`,tick:0}].slice(-120);
              setTimeline([...timelineRef.current]);
            } else if(ag.task!==taskDesc){
              ag.task=taskDesc;
              ag.progress=5;
            }
          } else {
            if(prev==="working"&&ag.state==="working"){
              // Transition: working → idle (task completed)
              ag.tasksCompleted++;
              totalDone.current++;
              ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);
              addFeed(`${ag.emoji} ${ag.name}: ✓ "${ag.task}"`,"#00ff88");
              addToast(`✓ ${ag.name} — "${ag.task}"`,ag.color);
              const wfEntry={id:feedIdRef.current++,agentId:ag.id,task:ag.task,state:"done",ts:nowts()};
              waterfallRef.current=[wfEntry,...waterfallRef.current].slice(-20);
              setWaterfall([...waterfallRef.current]);
              if(soundRef.current&&audioRef.current)audioRef.current.playComplete();
            }
            if(ag.state==="working"){
              ag.state="idle";ag.task=null;ag.progress=0;
            }
          }
          prevStates[ag.id]=isActive?"working":"idle";
        });

      }catch(e:any){
        setPollError('status', e?.apiError ?? { status:0, endpoint:'/api/status', message: e instanceof Error ? e.message : 'could not reach the server' });
      }
    };
    // Try SSE first, fall back to polling
    let es:EventSource|null=null;
    let pollInterval:any=null;
    const processTaskMap=(taskMap:Record<string,string>)=>{
      if(!simRef.current?.agents) return;
      // Reuse same logic as poll() but with provided taskMap
      const agents=simRef.current.agents;
      agents.forEach((ag:any)=>{
        if(!ag.active) return;
        const prev=prevStates[ag.id]||"idle";
        const rawTask=taskMap[ag.id]||"";
        const lower=rawTask.toLowerCase();
        const isActive=lower.startsWith("active")||lower.startsWith("working")||lower.startsWith("running")||lower.startsWith("processing");
        let taskDesc:string|null=null;
        if(isActive){
          if(rawTask.startsWith("Active: ")||rawTask.startsWith("Processing: ")){const ci=rawTask.indexOf(": ");taskDesc=rawTask.slice(ci+2).trim().slice(0,40);}
          else{
            // Extract channel from "Active on Telegram · 12.3k tokens" or "Active on Sub-agent · ..."
            const channelMatch=rawTask.match(/on\s+([A-Za-z\-]+)/);
            const ch=channelMatch?.[1]||"";
            const chClean=ch==="Sub-agent"?"🤖 sub-agent":ch==="Telegram"?"📱 session":ch==="Discord"?"💬 session":ch==="Cron"?"⏱ cron":ch==="Session"?"session":"";
            // Extract token count
            const tokMatch=rawTask.match(/([\d.]+)k tokens/);
            const tokStr=tokMatch?` · ${tokMatch[1]}k`:"";
            taskDesc=chClean?`${chClean}${tokStr}`:"Working";
          }
        }
        if(isActive&&taskDesc){
          if(ag.state!=="working"){ag.state="working";ag.task=taskDesc;ag.progress=5;ag.glowTick=60;ag.lastStateChange=Date.now();addFeed(`${ag.emoji} ${ag.name}: ${taskDesc}`,ag.color);if(soundRef.current&&audioRef.current)audioRef.current.playClick();timelineRef.current=[...timelineRef.current,{type:"task",color:ag.color,ts:nowts(),label:`${ag.name}: ${taskDesc}`,tick:0}].slice(-120);setTimeline([...timelineRef.current]);}
          else if(ag.task!==taskDesc){ag.task=taskDesc;ag.progress=5;}
        } else {
          if(prev==="working"&&ag.state==="working"){ag.tasksCompleted++;totalDone.current++;ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);addFeed(`${ag.emoji} ${ag.name}: ✓ "${ag.task}"`,"#00ff88");addToast(`✓ ${ag.name} — "${ag.task}"`,ag.color);const wfEntry={id:feedIdRef.current++,agentId:ag.id,task:ag.task,state:"done",ts:nowts()};waterfallRef.current=[wfEntry,...waterfallRef.current].slice(-20);setWaterfall([...waterfallRef.current]);if(soundRef.current&&audioRef.current)audioRef.current.playComplete();}
          if(ag.state==="working"){ag.state="idle";ag.task=null;ag.progress=0;}
        }
        prevStates[ag.id]=isActive?"working":"idle";
      });
    };
    try{
      es=new EventSource('/api/office-stream');
      es.onmessage=(event)=>{
        try{
          const data=JSON.parse(event.data);
          // Always call processTaskMap on every state event — server deduplicates, client must not
          if(data.type==='state'&&data.agentCurrentTask){
            processTaskMap(data.agentCurrentTask);
          }
        }catch(e2){}
      };
      es.onerror=()=>{
        // SSE failed — fall back to polling
        es?.close();es=null;
        if(!pollInterval){
          poll();
          pollInterval=setInterval(poll,30000); // raised 5s→30s (Supabase egress)
        }
      };
    }catch(e3){
      // SSE not available — poll
      poll();
      pollInterval=setInterval(poll,5000);
    }

    return()=>{
      es?.close();
      if(pollInterval)clearInterval(pollInterval);
    };
  },[addFeed,addToast]);

  // ── Real session task counts for leaderboard ─────────────────────────────
  useEffect(()=>{
    const fetchRealCounts=async()=>{
      const r=await fetchJson<any>('/api/status');
      // A non-ok response must not fall through to a zero-filled counts
      // object — that reads as "no tasks in the last 24h/7d" for every
      // agent, indistinguishable from a genuinely idle office.
      if(!r.ok){ setPollError('leaderboard', r.error); return; }
      setPollError('leaderboard', null);
      const data=r.data;
      // Use recentActivity to count tasks per agent in timeframe windows
      const activity:any[]=data?.recentActivity||[];
      // TOD (agent-roster-truth): this used to pre-seed counts for a
      // hardcoded 5-agent list and silently drop activity for any other real
      // agent id. Every id actually seen in the activity feed gets counted now.
      const counts:Record<string,{h24:number,d7:number}>={};
      activity.forEach((entry:any)=>{
        const id=entry.agentId;
        if(!id) return;
        if(!counts[id]) counts[id]={h24:0,d7:0};
        const agoMs=(entry.ago||0)*60*1000;
        if(agoMs < 86400000) counts[id].h24++;
        if(agoMs < 604800000) counts[id].d7++;
      });
      setRealTaskCounts(counts);
    };
    fetchRealCounts();
    const t=setInterval(fetchRealCounts,30000);
    return()=>clearInterval(t);
  },[]);

  // ── Hotkeys ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement) return;
      switch(e.key){
        case" ":e.preventDefault();pausedRef.current=!pausedRef.current;setPaused(p=>!p);break;
        case"m":case"M":minimapRef.current=!minimapRef.current;setShowMinimap(s=>!s);break;
        case"d":case"D":depGraphRef.current=!depGraphRef.current;setShowDepGraph(s=>!s);break;
        case"r":case"R":setReplayMode(r=>{replayModeRef.current=!r;return!r;});break;

        case"t":case"T":setTab(t=>t==="roster"?"board":"roster");break;
        case"Escape":setSelectedId(null);setDetail(null);break;
      }
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);

  // ── Simulation ────────────────────────────────────────────────────────────
  useEffect(()=>{
    let agents:any[]=null as any,particles:any[]=[],simTick=0,lastTime=0;
    let critPairs:any[]=[];

    function ensureAgents(){
      // Waits on the real roster (rosterRef, set by the "Roster polling"
      // effect above) — never builds the sim off a hardcoded list. `[]` is a
      // legitimate, honest roster (genuinely zero agents); `null` means "not
      // loaded yet", which is the only case this holds off building.
      if(!agents&&tileRef.current>0&&rosterRef.current){
        agents=initAgents(tileRef.current,rosterRef.current);
        simRef.current={agents,particles,critPairs:()=>critPairs};
        simRef.current.boardTasks=()=>boardTasksRef.current;
        setRoster(agents.map((a:any)=>({...a})));
      }
    }

    const canvas=canvasRef.current!;
    const ctx=canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled=false;

    function tick(now:number){
      ensureAgents();
      if(!agents){animRef.current=requestAnimationFrame(tick);return;}
      const rawDt=Math.min((now-lastTime)/1000,0.05);lastTime=now;
      const dt=pausedRef.current?0:rawDt;
      const T=tileRef.current;

      if(!pausedRef.current&&!replayModeRef.current){
        simTick++;

        // MC-17: Mood from real performance metrics (agent_runs data)
        if(simTick%360===0) agents.forEach((ag:any)=>{
          const run=liveRunsRef.current[ag.id];
          if(!run){ag.mood=Math.max(70,(ag.mood||88)-0.3);return;}
          const {todayTasks,todayErrors}=run;
          const errorRate=todayTasks>0?todayErrors/(todayTasks+todayErrors):0;
          // Happy: >5 tasks done today, low error rate
          if(todayTasks>=5&&errorRate<0.1) ag.mood=Math.min(100,(ag.mood||88)+3);
          // Stressed: blocked/high error rate
          else if(errorRate>0.3||todayErrors>=3) ag.mood=Math.max(50,(ag.mood||88)-3);
          // Neutral: normal activity
          else if(todayTasks>0) ag.mood=Math.max(75,Math.min(95,(ag.mood||88)+0.5));
          // No activity
          else if(ag.state==="working") ag.mood=Math.min(95,(ag.mood||88)+1);
          else ag.mood=Math.max(70,(ag.mood||88)-0.3);
        });

        agents.forEach((ag:any)=>{
          ag.animTick++;
          if(ag.state==="working")ag.timeWorking++;
          if(ag.spawning){ag.spawnAge++;if(ag.spawnAge>45)ag.spawning=false;}
        });

        particles.forEach((p:any)=>{p.age++;p.x+=p.vx*0.93;p.y+=p.vy*0.93;p.vy+=0.07;});
        for(let i=particles.length-1;i>=0;i--)if(particles[i].age>=particles[i].maxAge)particles.splice(i,1);

        if(simTick%300===0){
          const board=agents.filter((a:any)=>a.active).map((a:any)=>({
            id:a.id,name:a.name,emoji:a.emoji,color:a.color,tasksCompleted:a.tasksCompleted,mood:Math.round(a.mood||88),
          })).sort((a:any,b:any)=>b.tasksCompleted-a.tasksCompleted);
          setLeaderboard(board);
        }

        if(simTick%180===0){
          const frame=captureFrame(agents,simTick);
          replayFrames.current=[...replayFrames.current,frame].slice(-200);
          setReplayLen(replayFrames.current.length);
        }

        if(simTick%600===0)saveMemory(agents);
      }

      const T2=tileRef.current;
      const cam=camRef.current;
      const W=canvas.width,H=canvas.height;

      // MC-21: Smooth zoom animation
      const zt=zoomTargetRef.current;
      if(zt){
        const lerp=0.08;
        cam.x+=(zt.x-cam.x)*lerp;cam.y+=(zt.y-cam.y)*lerp;cam.z+=(zt.z-cam.z)*lerp;
        if(Math.abs(cam.x-zt.x)<0.5&&Math.abs(cam.y-zt.y)<0.5&&Math.abs(cam.z-zt.z)<0.01) zoomTargetRef.current=null;
        clampCam(cam,W,H);
      }

      let drawAgentsArr=agents;
      if(replayModeRef.current&&replayFrames.current.length){
        const idx=Math.min(replayCurRef.current,replayFrames.current.length-1);
        const frame=replayFrames.current[idx];
        if(frame){
          drawAgentsArr=agents.map((ag:any)=>{
            const fa=frame.agents.find((a:any)=>a.id===ag.id);
            return fa?{...ag,px:fa.px,py:fa.py,state:fa.state,task:fa.task,progress:fa.progress}:ag;
          });
        }
      }

      ctx.clearRect(0,0,W,H);
      const darkAlpha=getDayNight(simTick);
      const thm=THEMES[themeRef.current]||THEMES.A;
      drawFloor(ctx,T2,cam,darkAlpha,thm,showGridRef.current);
      drawFurniture(ctx,T2,cam,drawAgentsArr,now,darkAlpha,critPairs,depGraphRef.current,thm,liveRunsRef.current);
      // Connection lines: working agents → orchestrator
      const orchAgent2=drawAgentsArr.find((a:any)=>a.isOrchestrator);
      if(orchAgent2){
        ctx.save();applyCamera(ctx,cam);
        drawAgentsArr.forEach((ag:any)=>{
          if(ag.isOrchestrator||ag.state!=="working"||!ag.active) return;
          const workingMs=Date.now()-(ag.lastStateChange||Date.now());
          const fadeIn=Math.min(1,workingMs/2000);
          if(fadeIn<=0) return;
          const phase=(now*0.001)%1;
          const lineAlpha=Math.round(fadeIn*0x22).toString(16).padStart(2,"0");
          const dotAlpha=Math.round(fadeIn*0x88).toString(16).padStart(2,"0");
          ctx.strokeStyle=ag.color+lineAlpha;ctx.lineWidth=T2*0.015;ctx.setLineDash([T2*0.1,T2*0.08]);
          ctx.beginPath();ctx.moveTo(ag.px,ag.py);ctx.lineTo(orchAgent2.px,orchAgent2.py);ctx.stroke();
          ctx.setLineDash([]);
          // Flowing dot along the line
          const dx=orchAgent2.px-ag.px,dy=orchAgent2.py-ag.py;
          const dotX=ag.px+dx*phase,dotY=ag.py+dy*phase;
          ctx.beginPath();ctx.arc(dotX,dotY,T2*0.04,0,Math.PI*2);
          ctx.fillStyle=ag.color+dotAlpha;ctx.fill();
        });
        ctx.restore();
      }
      drawParticles(ctx,particles,cam);
      // The per-agent fan-out — including `waiting[ag.id] -> bubble` — lives in
      // officeDrawing.drawAgents so a test can execute it against a recording
      // canvas. This line is the one remaining seam no test reaches; it is a
      // single named argument rather than a whole feature. See
      // __tests__/office-bubble-render.test.ts.
      drawAgents(ctx,drawAgentsArr,{
        T:T2,now,cam,selectedId,darkAlpha,
        boardTasks:boardTasksRef.current,
        subagentCount:subagentCountRef.current,
        runs:liveRunsRef.current,
        waiting:waitingRef.current,
      });

      // MC-45: Draw temporary subagent sprites near the orchestrator
      const orchAg = drawAgentsArr.find((a:any) => a.isOrchestrator)
      if (orchAg && subagentSessionsRef.current.length > 0) {
        ctx.save()
        applyCamera(ctx, cam)
        const baseX = orchAg.px + T2 * 2.5
        const baseY = orchAg.py - T2 * 0.5
        subagentSessionsRef.current.forEach((sub: any, i: number) => {
          const sx = baseX + (i % 2) * T2 * 1.8
          const sy = baseY + Math.floor(i / 2) * T2 * 1.5
          const bobY = Math.sin(now / 800 + i * 1.2) * 3
          const spriteSize = T2 * 0.3
          // Glow ring
          ctx.beginPath()
          ctx.arc(sx, sy + bobY, spriteSize * 1.3, 0, Math.PI * 2)
          ctx.fillStyle = sub.color + '18'
          ctx.fill()
          ctx.strokeStyle = sub.color + '44'
          ctx.lineWidth = 1
          ctx.stroke()
          // Emoji
          const emPx = Math.max(10, Math.round(T2 * 0.25))
          ctx.font = `${emPx}px sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(sub.emoji, sx, sy + bobY + emPx * 0.35)
          // Name + task label
          const lPx = Math.max(6, Math.round(T2 * 0.1))
          ctx.font = `bold ${lPx}px 'IBM Plex Mono', monospace`
          ctx.fillStyle = sub.color
          ctx.fillText(sub.name, sx, sy + bobY + spriteSize + lPx * 1.2)
          if (sub.task) {
            ctx.font = `${lPx}px 'IBM Plex Mono', monospace`
            ctx.fillStyle = '#888'
            ctx.fillText(sub.task.slice(0, 20), sx, sy + bobY + spriteSize + lPx * 2.5)
          }
        })
        ctx.restore()
      }

      if(minimapRef.current)drawMinimap(ctx,T2,drawAgentsArr,cam,W,H,showLegendRef.current);

      // Hover tooltip
      const hov=hoverAgentRef.current;
      if(hov&&!camRef.current.drag){
        const fPx=Math.round(T2*0.16);
        ctx.font=`bold ${fPx}px 'IBM Plex Mono',monospace`;
        const liveRun=liveRunsRef.current[hov.id];
        const liveLabel=liveRun?.status==='never'?'No runs yet':hov.state==="working"?(hov.task||"Working"):(hov.state||"idle");
        const idleTime=hov.state==="idle"&&liveRun?.status!=='never'?` · idle ${Math.round((Date.now()-(hov.lastStateChange||Date.now()))/60000)}m`:"";
        const line1=`${hov.emoji} ${hov.name}`;
        const line2=`${liveLabel}${idleTime}`;
        const line3=`${hov.tasksCompleted||0} tasks completed`;
        const tw2=Math.max(ctx.measureText(line1).width,ctx.measureText(line2).width,ctx.measureText(line3).width)+20;
        const th2=fPx*4.2;
        const tx=hov.screenX+12,ty=Math.max(10,hov.screenY-th2-8);
        ctx.fillStyle="#0d0d20ee";ctx.strokeStyle=hov.color+"66";ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(tx,ty,tw2,th2,6);ctx.fill();ctx.stroke();
        ctx.fillStyle=hov.color;ctx.textAlign="left";
        ctx.fillText(line1,tx+8,ty+fPx*1.1);
        ctx.font=`${fPx*0.85}px 'IBM Plex Mono',monospace`;
        ctx.fillStyle=hov.state==="working"?"#00ff88":"#7a7a98";
        ctx.fillText(line2,tx+8,ty+fPx*2.2);
        ctx.fillStyle="#6a6a8e";
        ctx.fillText(line3,tx+8,ty+fPx*3.3);
      }

      if(simTick%10===0){
        const snap=agents.map((ag:any)=>({...ag,progress:Math.round(ag.progress),taskHistory:[...(ag.taskHistory||[])]}));
        setRoster(snap);
        const wCount=snap.filter((a:any)=>a.active&&a.state==="working").length;
        setStats({working:wCount,
          idle:snap.filter((a:any)=>a.active&&a.state==="idle").length,
          completed:totalDone.current});
        // #10: Update page title to reflect activity
        const workingAgent=snap.find((a:any)=>a.active&&a.state==="working");
        if(wCount>0&&workingAgent){
          document.title=`${workingAgent.emoji} ${workingAgent.name} working · NABIT`;
        } else {
          document.title="🧠 Agent Office · NABIT";
        }
        setDetail((prev:any)=>prev?snap.find((a:any)=>a.id===prev.id)||prev:null);
      }
      animRef.current=requestAnimationFrame(tick);
    }
    animRef.current=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(animRef.current);if(simRef.current?.agents)saveMemory(simRef.current.agents);};
  },[addFeed,addToast]);

  // ── Resize ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    function resize(){
      const canvas=canvasRef.current;if(!canvas) return;
      const cw=canvas.parentElement!.clientWidth,ch=canvas.parentElement!.clientHeight;
      const aspect=MAP_COLS/MAP_ROWS;
      let dw=cw,dh=cw/aspect;if(dh>ch){dh=ch;dw=ch*aspect;}
      dw=Math.floor(dw);dh=Math.floor(dh);
      canvas.width=dw;canvas.height=dh;canvas.style.width=dw+"px";canvas.style.height=dh+"px";
      const T=dw/MAP_COLS;tileRef.current=T;
      if(simRef.current?.agents){
        simRef.current.agents.forEach((ag:any)=>{
          // Each agent already carries the desk/bench slot it was assigned
          // in initAgents() — no id-keyed lookup table to fall back to.
          const orch=!!ag.isOrchestrator;
          const{x,y}=tileCenterPx(ag.deskTx+(orch?1.1:0.75),ag.deskTy+(orch?1.0:0.85),T);
          ag.deskX=x;ag.deskY=y;
          if(ag.state==="idle"||ag.state==="working"){ag.px=x;ag.py=y;}
        });
      }
      const cam=camRef.current;cam.minZ=1;cam.z=1;cam.x=0;cam.y=0;
    }
    resize();window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);
  },[]);

  // ── Camera ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas) return;
    function c2w(e:MouseEvent){const r=canvas!.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    function onWheel(e:WheelEvent){
      e.preventDefault();const{x:mx,y:my}=c2w(e as any);const cam=camRef.current;
      const nz=Math.max(cam.minZ,Math.min(3.5,cam.z*(e.deltaY<0?1.12:0.9)));
      if(nz<=cam.minZ){cam.z=cam.minZ;cam.x=0;cam.y=0;return;}
      cam.x=mx-(mx-cam.x)*(nz/cam.z);cam.y=my-(my-cam.y)*(nz/cam.z);cam.z=nz;
      clampCam(cam,canvas!.width,canvas!.height);
    }
    function onDown(e:MouseEvent){const cam=camRef.current;cam.drag=true;cam.ds=c2w(e);cam.cs={x:cam.x,y:cam.y};canvas!.style.cursor="grabbing";}
    function onMove(e:MouseEvent){
      const cam=camRef.current;
      if(cam.drag){const p=c2w(e);cam.x=cam.cs.x+(p.x-cam.ds.x);cam.y=cam.cs.y+(p.y-cam.ds.y);clampCam(cam,canvas!.width,canvas!.height);return;}
      // Hover detection for tooltip
      const p=c2w(e);
      const wx=(p.x-cam.x)/cam.z,wy=(p.y-cam.y)/cam.z,T2=tileRef.current;
      let best:any=null,bestD=T2*0.7;
      simRef.current?.agents?.forEach((ag:any)=>{const d=Math.hypot(ag.px-wx,ag.py-wy);if(d<bestD){bestD=d;best=ag;}});
      hoverAgentRef.current=best?{...best,screenX:p.x,screenY:p.y}:null;
    }
    function onUp(e:MouseEvent){
      const cam=camRef.current;
      if(cam.drag&&cam.ds){
        const p=c2w(e),dd=Math.abs(p.x-cam.ds.x)+Math.abs(p.y-cam.ds.y);
        if(dd<6&&simRef.current?.agents){
          const wx=(p.x-cam.x)/cam.z,wy=(p.y-cam.y)/cam.z,T=tileRef.current;
          let best:any=null,bestD=T*0.7;
          simRef.current.agents.forEach((ag:any)=>{const d=Math.hypot(ag.px-wx,ag.py-wy);if(d<bestD){bestD=d;best=ag;}});
          if(best){
            setSelectedId((id:any)=>id===best.id?null:best.id);
            setDetail((d:any)=>d?.id===best.id?null:{...best});
            setTab(()=>"roster");
            // KAOS opens detail panel like everyone else
          } else{setSelectedId(null);setDetail(null);}
        }
      }
      cam.drag=false;canvas!.style.cursor="grab";
    }
    function onContextMenu(e:MouseEvent){
      e.preventDefault();
      const r=canvas!.getBoundingClientRect();
      const p={x:e.clientX-r.left,y:e.clientY-r.top};
      const cam2=camRef.current;
      const wx=(p.x-cam2.x)/cam2.z,wy=(p.y-cam2.y)/cam2.z,T2=tileRef.current;
      let best:any=null,bestD=T2*0.7;
      simRef.current?.agents?.forEach((ag:any)=>{const d=Math.hypot(ag.px-wx,ag.py-wy);if(d<bestD){bestD=d;best=ag;}});
      if(best) setCtxMenu({agentId:best.id,screenX:e.clientX,screenY:e.clientY});
    }
    // MC-21: Double-click to zoom to agent
    function onDblClick(e:MouseEvent){
      const p=c2w(e);const cam2=camRef.current;
      const wx=(p.x-cam2.x)/cam2.z,wy=(p.y-cam2.y)/cam2.z,T2=tileRef.current;
      let best:any=null,bestD=T2*1.2;
      simRef.current?.agents?.forEach((ag:any)=>{const d=Math.hypot(ag.px-wx,ag.py-wy);if(d<bestD){bestD=d;best=ag;}});
      if(best){
        // Zoom in to agent: center on them at 2.2x zoom
        const targetZ=2.2;
        const targetX=canvas!.width/2-best.px*targetZ;
        const targetY=canvas!.height/2-best.py*targetZ;
        zoomTargetRef.current={x:targetX,y:targetY,z:targetZ};
        setSelectedId(best.id);setDetail({...best});
      } else {
        // Double-click on empty space: zoom out to default
        zoomTargetRef.current={x:0,y:0,z:1};
        setSelectedId(null);setDetail(null);
      }
    }
    canvas.addEventListener("wheel",onWheel,{passive:false});
    canvas.addEventListener("mousedown",onDown);
    canvas.addEventListener("dblclick",onDblClick);
    canvas.addEventListener("contextmenu",onContextMenu);
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    canvas.style.cursor="grab";
    return()=>{canvas.removeEventListener("wheel",onWheel);canvas.removeEventListener("mousedown",onDown);canvas.removeEventListener("dblclick",onDblClick);canvas.removeEventListener("contextmenu",onContextMenu);window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const pollErrorList = Object.values(pollErrors);
  return (
    <div style={{position:"relative",flex:isMobile?undefined:1,minHeight:isMobile?300:0,overflow:"hidden",background:theme==="B"?"#091410":"#060610",display:"flex",alignItems:"stretch",
      ...(canvasScale<1?{transform:`scale(${canvasScale})`,transformOrigin:"top left",width:`${100/canvasScale}%`}:{})}}>
      <canvas ref={canvasRef} style={{imageRendering:"pixelated" as any,display:"block",width:"100%",height:"100%"}}/>
      {/* A failed poll must never render as an office full of idle agents — say so instead. */}
      {pollErrorList.length > 0 && (
        <div className="absolute top-3 left-3 z-20 w-[calc(100%-1.5rem)] max-w-md space-y-2">
          {pollErrorList.map((err, i) => <ApiErrorBanner key={i} error={err} />)}
        </div>
      )}
      {/* TOD (agent-roster-truth): a genuinely empty roster is drawn as an
          empty office, not silently filled with a fabricated cast. */}
      {rosterState === 'empty' && pollErrorList.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center text-white/40 text-sm">
            <div className="mb-1">No agents configured</div>
            <div className="text-white/25 text-xs">/api/agents returned zero agents</div>
          </div>
        </div>
      )}
    </div>
  );
}
