"use client";
import { useEffect, useRef } from "react";

import {
  ORCHESTRATOR_ID, MAP_COLS, MAP_ROWS, DESK_POS, BENCH_POS, COL_X, ROW_Y, ACTIVE_IDS, ALL_AGENTS,
  DEPENDENCIES, AGENT_TASKS, CHAT_LINES, MONOLOGUES, DIALOGUE_POOL, MEETING_SUMMARIES, THEMES,
} from './officeConstants';
import type { AgentRunInfo } from './officeConstants';

import {
  drawFloor, drawFurniture, drawChatBubbles, drawParticles, drawAgent, drawMinimap,
  tileCenterPx, nowts, lpath, clamp, confRingPos, mkBurst,
  initAgents, saveMemory, createAudio, getDayNight, clampCam, applyCamera, captureFrame,
} from './officeDrawing';

import { fetchAgentRuns } from '../../hooks/useAgentStatus';

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
  setMeetingLogs: (fn: (prev: any[]) => any[]) => void;
  setWaterfall: (w: any[]) => void;
  setTimeline: (t: any[]) => void;
  setLeaderboard: (l: any[]) => void;
  setDialogue: (d: any[]) => void;
  setIncidentLog: (fn: (prev: any[]) => any[]) => void;
  setIncident: (i: any) => void;
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
    setPaused, setSelectedId, setDetail, setRoster, setStats, setMeetingLogs,
    setWaterfall, setTimeline, setLeaderboard, setDialogue, setIncidentLog,
    setIncident, setReplayLen, setRealTaskCounts, setShowMinimap, setShowDepGraph,
    setReplayMode, setTab,
    addFeed, addToast,
    simRef, liveRunsRef, boardTasksRef, subagentCountRef, subagentSessionsRef,
    setCtxMenu,
  } = props;

  // ── Canvas-owned refs ──────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const animRef        = useRef<any>(null);
  const camRef         = useRef({x:0,y:0,z:1,drag:false,ds:null as any,cs:null as any,minZ:1});
  const tileRef        = useRef(0);
  const feedIdRef      = useRef(1);
  const totalDone      = useRef(0);
  const meetingLogsRef = useRef<any[]>([]);
  const meetingRef     = useRef<any>(null);
  const activeIdsRef   = useRef([...ACTIVE_IDS]);
  const chatBubbles    = useRef<any[]>([]);
  const replayFrames   = useRef<any[]>([]);
  const replayCurRef   = useRef(0);
  const dialogueRef    = useRef<any[]>([]);
  const waterfallRef   = useRef<any[]>([]);
  const timelineRef    = useRef<any[]>([]);
  const hoverAgentRef  = useRef<any>(null);
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

  // ── Board task polling ─────────────────────────────────────────────────────
  useEffect(()=>{
    const fetchTasks=async()=>{
      try{
        const res=await fetch('/api/tasks');
        const data=await res.json();
        if(!Array.isArray(data)) return;
        const map:Record<string,string>={};
        data.filter((t:any)=>t.status==='in_progress'&&t.assignee&&t.title)
            .forEach((t:any)=>{ map[t.assignee]=t.title; });
        boardTasksRef.current=map;
      }catch(e){}
    };
    fetchTasks();
    const t=setInterval(fetchTasks,60000); // raised 30s→60s (Supabase egress)
    return()=>clearInterval(t);
  },[]);

  // ── Supabase agent_runs polling — real-time status for ALL 8 agents ────
  useEffect(()=>{
    let cancelled=false;
    const pollRuns=async()=>{
      try{
        const runs=await fetchAgentRuns();
        if(cancelled) return;
        liveRunsRef.current=runs;
        if(!simRef.current?.agents) return;
        const agents=simRef.current.agents;
        agents.forEach((ag:any)=>{
          const run=runs[ag.id];
          if(!run) return;
          if(run.status==='working'){
            if(ag.state!=='working'&&ag.state!=='meeting'&&ag.state!=='moving_to_meeting'){
              ag.state='working';
              ag.task=run.taskTitle||'Working';
              ag.progress=5;
              ag.monologue=null;
              ag.glowTick=60;
              ag.lastStateChange=Date.now();
              addFeed(`${ag.emoji} ${ag.name}: ${run.taskTitle||'Working'}`,ag.color);
            } else if(ag.state==='working'&&run.taskTitle&&ag.task!==run.taskTitle){
              ag.task=run.taskTitle;
              ag.progress=5;
            }
          } else if(run.status==='idle'){
            if(ag.state==='working'){
              ag.tasksCompleted++;
              totalDone.current++;
              ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);
              addFeed(`${ag.emoji} ${ag.name}: done`,'#00ff88');
              ag.state='idle';ag.task=null;ag.progress=0;ag.monologue=null;
              ag.lastStateChange=Date.now();
            }
          }
          // 'never' agents stay idle with no task
        });
      }catch(e){}
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
        const res=await fetch('/api/status');
        const data=await res.json();
        if(!simRef.current?.agents) return;
        const agents=simRef.current.agents;
        const taskMap:Record<string,string>=data.agentCurrentTask||{};
        // Count active sub-agents from recentActivity
        const activity: any[] = data.recentActivity || []
        const activeSubagents = activity.filter((a: any) =>
          a.agentId === 'main' &&
          (a.action === 'delegate' || a.channel?.includes('Sub-agent')) &&
          a.ago != null && a.ago < 10
        ).length
        subagentCountRef.current = activeSubagents

        // MC-45: Build subagent sessions from active agent_runs (non-main agents working recently)
        const liveRuns = liveRunsRef.current
        const subSessions: typeof subagentSessionsRef.current = []
        const SUB_AGENT_MAP: Record<string,{name:string;emoji:string;color:string}> = {
          builder:{name:'Builder',emoji:'🔨',color:'#0984E3'}, tester:{name:'Tester',emoji:'🧪',color:'#E84393'},
          deployer:{name:'Deployer',emoji:'🚀',color:'#00CEC9'}, scout:{name:'Scout',emoji:'🔍',color:'#00B894'},
        }
        for (const [aid, info] of Object.entries(liveRuns)) {
          if (aid === 'main' || !info || info.status !== 'working') continue
          const meta = SUB_AGENT_MAP[aid]
          if (meta) {
            subSessions.push({ id: aid, ...meta, task: info.taskTitle, startedAt: info.startedAt ? new Date(info.startedAt).getTime() : Date.now() })
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
              ag.monologue=null;
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
              ag.state="idle";ag.task=null;ag.progress=0;ag.monologue=null;
            }
          }
          prevStates[ag.id]=isActive?"working":"idle";
        });

        // Detect multi-agent collaboration → conference table meeting
        const workingAgents=agents.filter((a:any)=>a.active&&a.state==="working");
        const kaosWorking=workingAgents.find((a:any)=>a.id===ORCHESTRATOR_ID);
        const othersWorking=workingAgents.filter((a:any)=>a.id!==ORCHESTRATOR_ID);
        const kaosAge=kaosWorking?Date.now()-(kaosWorking.lastStateChange||0):0;
        const collaborating=kaosWorking&&othersWorking.length>=1&&kaosAge>5000;
        if(collaborating&&!meetingRef.current){
          const topic=othersWorking.length>1?"Full Team Sync":`${kaosWorking.name} + ${othersWorking[0].name}`;
          const meetingParticipants=[kaosWorking.id,...othersWorking.map((a:any)=>a.id)];
          meetingRef.current={topic,agents:meetingParticipants,startTs:nowts()};
          // Move all meeting participants toward conference table
          const T2=tileRef.current;
          if(T2>0){
            const ringPositions=confRingPos(meetingParticipants.length,T2);
            meetingParticipants.forEach((id:string,idx:number)=>{
              const ag=agents.find((a:any)=>a.id===id);
              if(!ag) return;
              const target=ringPositions[idx]||ringPositions[0];
              ag.state="moving_to_meeting";
              ag.waypoints=lpath(ag.px,ag.py,target.x,target.y);
            });
          }
          addFeed(`📅 "${topic}" — ${[kaosWorking,...othersWorking].map(a=>a.name).join(", ")}`,"#FDCB6E");
          addToast(`📅 "${topic}"`,"#FDCB6E");
          timelineRef.current=[...timelineRef.current,{type:"meeting",color:"#FDCB6E",ts:nowts(),label:`Meeting: ${topic}`,tick:0}].slice(-120);
          setTimeline([...timelineRef.current]);
          if(soundRef.current&&audioRef.current)audioRef.current.playMeeting();
        } else if(meetingRef.current&&othersWorking.length===0){
          addFeed(`✓ "${meetingRef.current.topic}" concluded`,"#FDCB6E");
          const attendees=agents.filter((a:any)=>meetingRef.current.agents.includes(a.id));
          const summary=MEETING_SUMMARIES[meetingRef.current.topic]||"• Coordinated agent tasks\n• Reviewed progress\n• Set next actions";
          const logEntry={id:feedIdRef.current++,topic:meetingRef.current.topic,ts:meetingRef.current.startTs,attendees:attendees.map((a:any)=>a.name),summary};
          meetingLogsRef.current=[logEntry,...meetingLogsRef.current].slice(0,20);
          setMeetingLogs(()=>[...meetingLogsRef.current]);
          meetingRef.current=null;
        }

      }catch(e){}
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
          if(ag.state!=="working"){ag.state="working";ag.task=taskDesc;ag.progress=5;ag.monologue=null;ag.glowTick=60;ag.lastStateChange=Date.now();addFeed(`${ag.emoji} ${ag.name}: ${taskDesc}`,ag.color);if(soundRef.current&&audioRef.current)audioRef.current.playClick();timelineRef.current=[...timelineRef.current,{type:"task",color:ag.color,ts:nowts(),label:`${ag.name}: ${taskDesc}`,tick:0}].slice(-120);setTimeline([...timelineRef.current]);}
          else if(ag.task!==taskDesc){ag.task=taskDesc;ag.progress=5;}
        } else {
          if(prev==="working"&&ag.state==="working"){ag.tasksCompleted++;totalDone.current++;ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);addFeed(`${ag.emoji} ${ag.name}: ✓ "${ag.task}"`,"#00ff88");addToast(`✓ ${ag.name} — "${ag.task}"`,ag.color);const wfEntry={id:feedIdRef.current++,agentId:ag.id,task:ag.task,state:"done",ts:nowts()};waterfallRef.current=[wfEntry,...waterfallRef.current].slice(-20);setWaterfall([...waterfallRef.current]);if(soundRef.current&&audioRef.current)audioRef.current.playComplete();}
          if(ag.state==="working"){ag.state="idle";ag.task=null;ag.progress=0;ag.monologue=null;}
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
      try{
        const res=await fetch('/api/status');
        const data=await res.json();
        // Use recentActivity to count tasks per agent in timeframe windows
        const activity:any[]=data.recentActivity||[];
        const now=Date.now();
        const counts:Record<string,{h24:number,d7:number}>={};
        const agentIds=['main','scout','ops','kemuni-sme','vespera-sme'];
        agentIds.forEach(id=>{ counts[id]={h24:0,d7:0}; });
        activity.forEach((entry:any)=>{
          const id=entry.agentId;
          if(!counts[id]) return;
          const agoMs=(entry.ago||0)*60*1000;
          if(agoMs < 86400000) counts[id].h24++;
          if(agoMs < 604800000) counts[id].d7++;
        });
        setRealTaskCounts(counts);
      }catch(e){}
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

        case"t":case"T":setTab(t=>t==="roster"?"meetings":t==="meetings"?"board":"roster");break;
        case"Escape":setSelectedId(null);setDetail(null);break;
      }
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[]);

  // ── Simulation ────────────────────────────────────────────────────────────
  useEffect(()=>{
    let agents:any[]=null as any,particles:any[]=[],meeting:any=null,meetingTick=0,simTick=0,lastTime=0;
    let incidentData:any=null,incidentTick=0,critPairs:any[]=[];

    function ensureAgents(){
      if(!agents&&tileRef.current>0){
        agents=initAgents(tileRef.current,activeIdsRef.current);
        simRef.current={agents,particles,critPairs:()=>critPairs};
        simRef.current.boardTasks=()=>boardTasksRef.current;
        setRoster(agents.map((a:any)=>({...a})));
      }
    }

    function stepAgent(ag:any,dt:number){
      if(!ag.waypoints?.length) return true;
      const tgt=ag.waypoints[0];
      const spd=2.8*tileRef.current*dt;
      const dx=tgt.x-ag.px,dy=tgt.y-ag.py,d=Math.sqrt(dx*dx+dy*dy);
      if(d<spd+0.5){ag.px=tgt.x;ag.py=tgt.y;ag.waypoints.shift();return!ag.waypoints.length;}
      ag.px+=dx/d*spd;ag.py+=dy/d*spd;
      ag.facing=Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up");
      return false;
    }

    function startWork(ag:any,task:string){
      ag.state="working";ag.task=task;ag.progress=0;
      addFeed(`${ag.emoji} ${ag.name}: "${task}"`,ag.color);
      const monos=MONOLOGUES[ag.id]||["processing..."];
      ag.monologue=monos[Math.floor(Math.random()*monos.length)];
      if(soundRef.current&&audioRef.current)audioRef.current.playClick();
    }

    function finishWork(ag:any){
      ag.tasksCompleted++;totalDone.current++;
      ag.taskHistory=[...(ag.taskHistory||[]),ag.task].slice(-20);
      addFeed(`${ag.emoji} ${ag.name}: ✓ "${ag.task}"`,"#00ff88");
      const tlEntry={type:"task",color:ag.color,ts:nowts(),label:`${ag.name}: ${ag.task}`,tick:simTick};
      timelineRef.current=[...timelineRef.current,tlEntry].slice(-120);
      setTimeline([...timelineRef.current]);
      const wfEntry={id:feedIdRef.current++,agentId:ag.id,task:ag.task,state:"done",ts:nowts()};
      waterfallRef.current=[wfEntry,...waterfallRef.current].slice(-20);
      setWaterfall([...waterfallRef.current]);
      addToast(`✓ ${ag.name} — "${ag.task}"`,ag.color);
      particles.push(...mkBurst(ag.px,ag.py,ag.color));
      if(soundRef.current&&audioRef.current)audioRef.current.playComplete();
      ag.mood=Math.min(100,(ag.mood||88)+3);
      ag.monologue=null;
      (DEPENDENCIES[ag.id]||[]).forEach(depId=>{
        const dep=agents.find((a:any)=>a.id===depId&&a.active);
        if(dep&&dep.state==="idle"&&dep.idleCooldown<=0){
          const tasks=AGENT_TASKS[depId]||[];
          if(tasks.length)setTimeout(()=>{if(dep.state==="idle")startWork(dep,tasks[Math.floor(Math.random()*tasks.length)]);},400);
          if(!critPairs.find(([s,d]:any)=>s===ag.id&&d===depId))critPairs.push([ag.id,depId]);
          setTimeout(()=>{critPairs=critPairs.filter(([s,d]:any)=>!(s===ag.id&&d===depId));},8000);
        }
      });
      if(ag.id!==ORCHESTRATOR_ID&&Math.random()<0.3){
        const orchName=ALL_AGENTS.find(a=>a.id===ORCHESTRATOR_ID)?.name||"KAOS";
        const txt=DIALOGUE_POOL[Math.floor(Math.random()*DIALOGUE_POOL.length)];
        const entry={id:feedIdRef.current++,ts:nowts(),sender:ag.name,senderColor:ag.color,receiver:orchName,text:txt};
        dialogueRef.current=[entry,...dialogueRef.current].slice(0,40);
        setDialogue([...dialogueRef.current]);
      }
      ag.state="idle";ag.task=null;ag.progress=0;ag.idleCooldown=Math.round(ag.personality.focusDuration*8+Math.random()*20);
    }

    function maybeChat(){
      const active=agents?.filter((a:any)=>a.active&&a.state==="working");
      if(!active||active.length<2) return;
      const sender=active[Math.floor(Math.random()*active.length)];
      const receiver=active.filter((a:any)=>a.id!==sender.id)[Math.floor(Math.random()*(active.length-1))];
      if(!receiver) return;
      const line=CHAT_LINES[Math.floor(Math.random()*CHAT_LINES.length)](sender.name,receiver.name);
      chatBubbles.current.push({x:sender.px,y:sender.py-tileRef.current*0.32,text:line,color:sender.color,age:0,maxAge:160,life:0});
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
          if(ag.idleCooldown>0)ag.idleCooldown--;
          if(ag.state==="working")ag.timeWorking++;
          else if(ag.state==="meeting")ag.timeMeeting++;
          if(ag.spawning){ag.spawnAge++;if(ag.spawnAge>45)ag.spawning=false;}
        });

        agents.forEach((ag:any)=>{
          if(ag.state==="moving_to_meeting"){if(stepAgent(ag,dt)){ag.state="meeting";ag.facing="down";}}
          else if(ag.state==="returning"){if(stepAgent(ag,dt)){ag.state="idle";ag.facing="down";}}
        });

        particles.forEach((p:any)=>{p.age++;p.x+=p.vx*0.93;p.y+=p.vy*0.93;p.vy+=0.07;});
        for(let i=particles.length-1;i>=0;i--)if(particles[i].age>=particles[i].maxAge)particles.splice(i,1);
        chatBubbles.current.forEach((b:any)=>{b.age++;b.life=Math.min(1,b.age/15);});
        for(let i=chatBubbles.current.length-1;i>=0;i--)if(chatBubbles.current[i].age>=chatBubbles.current[i].maxAge)chatBubbles.current.splice(i,1);

        // ── Real-data only: no random simulation ──
        // Progress ticks for agents that are working (driven by real data via polling)
        if(simTick%90===0){
          agents.filter((a:any)=>a.active&&a.state==="working").forEach((ag:any)=>{
            // Slowly increment progress for visual feedback while agent works
            // Real task completion comes from polling — this just animates the bar
            if(ag.progress<95) ag.progress=Math.min(95,ag.progress+0.5);
          });
        }

        // Incident state is managed by polling — just handle the auto-return animation
        if(incidentData){
          incidentTick++;
          if(incidentTick>400){
            addFeed(`${incidentData.title} — resolved ✓`,"#00ff88");
            agents.forEach((ag:any)=>{if(incidentData.victims.includes(ag.id)&&(ag.state==="meeting"||ag.state==="moving_to_meeting")){ag.state="returning";ag.waypoints=lpath(ag.px,ag.py,ag.deskX,ag.deskY);}});
            setIncidentLog(prev=>[{id:Date.now(),title:incidentData.title,ts:nowts(),resolved:true},...prev].slice(0,20));
            incidentData=null;setIncident(null);
          }
        }

        // Meeting state is managed by polling — just handle the return animation
        if(meeting){
          meetingTick++;
          // Meetings auto-end after 500 ticks if polling hasn't cleared them
          if(meetingTick>500){
            const concluded=meeting;
            addFeed(`✓ "${meeting.topic}" concluded`,"#FDCB6E");
            agents.forEach((ag:any)=>{if(concluded.agents.includes(ag.id)&&(ag.state==="meeting"||ag.state==="moving_to_meeting")){ag.state="returning";ag.waypoints=lpath(ag.px,ag.py,ag.deskX,ag.deskY);}});
            meeting=null;
            const attendees=agents.filter((a:any)=>concluded.agents.includes(a.id));
            const summary=MEETING_SUMMARIES[concluded.topic]||"• Discussed key topics\n• Assigned action items\n• Set follow-up timeline";
            const e={id:feedIdRef.current++,topic:concluded.topic,ts:concluded.startTs,attendees:attendees.map((a:any)=>a.name),summary};
            meetingLogsRef.current=[e,...meetingLogsRef.current].slice(0,20);
            setMeetingLogs(()=>[...meetingLogsRef.current]);
          }
        }

        if(simTick%300===0){
          const board=agents.filter((a:any)=>a.active).map((a:any)=>{
            const total=a.timeWorking+a.timeMeeting||1;
            const eff=Math.round((a.timeWorking/total)*100);
            return{id:a.id,name:a.name,emoji:a.emoji,color:a.color,tasksCompleted:a.tasksCompleted,efficiency:eff,mood:Math.round(a.mood||88)};
          }).sort((a:any,b:any)=>b.tasksCompleted-a.tasksCompleted||b.efficiency-a.efficiency);
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
      drawFloor(ctx,T2,cam,darkAlpha,!!incidentData,thm,showGridRef.current);
      // Use meetingRef (real data) OR meeting (simulation), real data takes priority
      const activeMeetingTopic=meetingRef.current?.topic||meeting?.topic||null;
      drawFurniture(ctx,T2,cam,drawAgentsArr,now,!!(meetingRef.current||meeting),activeMeetingTopic,darkAlpha,!!incidentData,critPairs,depGraphRef.current,thm,liveRunsRef.current);
      // Connection lines: working agents → orchestrator
      const orchAgent2=drawAgentsArr.find((a:any)=>a.id===ORCHESTRATOR_ID);
      if(orchAgent2){
        ctx.save();applyCamera(ctx,cam);
        drawAgentsArr.forEach((ag:any)=>{
          if(ag.id===ORCHESTRATOR_ID||ag.state!=="working"||!ag.active) return;
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
      drawChatBubbles(ctx,chatBubbles.current,T2,cam);
      drawAgentsArr.forEach((ag:any)=>drawAgent(ctx,ag,T2,now,cam,ag.id===selectedId,darkAlpha,!!incidentData,boardTasksRef.current,ag.id==='main'?subagentCountRef.current:0,liveRunsRef.current[ag.id]?.estimatedCost||0));

      // MC-45: Draw temporary subagent sprites near KAOS
      const orchAg = drawAgentsArr.find((a:any) => a.id === ORCHESTRATOR_ID)
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
          meeting:snap.filter((a:any)=>a.active&&(a.state==="meeting"||a.state==="moving_to_meeting")).length,
          idle:snap.filter((a:any)=>a.active&&(a.state==="idle"||a.state==="returning")).length,
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
          const isActive=activeIdsRef.current.includes(ag.id);
          const posMap=isActive?DESK_POS:BENCH_POS;
          const tp=posMap[ag.id];if(!tp) return;
          const orch=ag.id===ORCHESTRATOR_ID;
          const{x,y}=tileCenterPx(tp.tx+(orch?1.1:0.75),tp.ty+(orch?1.0:0.85),T);
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
  return (
    <div style={{flex:isMobile?undefined:1,minHeight:isMobile?300:0,overflow:"hidden",background:theme==="B"?"#091410":"#060610",display:"flex",alignItems:"stretch",
      ...(canvasScale<1?{transform:`scale(${canvasScale})`,transformOrigin:"top left",width:`${100/canvasScale}%`}:{})}}>
      <canvas ref={canvasRef} style={{imageRendering:"pixelated" as any,display:"block",width:"100%",height:"100%"}}/>
    </div>
  );
}
