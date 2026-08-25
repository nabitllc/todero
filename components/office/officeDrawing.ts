// ─── Drawing Functions & Helpers ──────────────────────────────────────────────
// Extracted from AgentOffice.tsx (INF-125)
// Contains ALL drawing functions, helpers, localStorage, audio, camera, day/night.

import {
  MAP_COLS, MAP_ROWS, STANCHION_R,
  deskSlot, benchSlot,
  ORCH_TX, ORCH_TY, CONF_TX, CONF_TY, CONF_TW, CONF_TH,
  ROW_Y, COL_X,
  THEMES,
  LS_KEY,
} from './officeConstants';
import type { AgentRunInfo, ThemeKey } from './officeConstants';

// The one roster shape initAgents() ever accepts: whatever /api/agents
// actually returned (mapped in AgentOffice.tsx), never a hardcoded stand-in.
export interface RosterAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  role: string;
  active: boolean;
  [key: string]: any;
}

/** "Chief Orchestrator", "Orchestrator" — the one role AGENT_META/AGENTS.md use for the lead seat. Never assumes a specific id. */
export function isOrchestratorRole(role: string | undefined | null): boolean {
  return !!role && /orchestrat/i.test(role);
}

// Re-export types for consumers
export type { AgentRunInfo, ThemeKey };

// ─── Helper functions ────────────────────────────────────────────────────────
export function tileCenterPx(tx:number,ty:number,T:number){ return { x:(tx+0.5)*T, y:(ty+0.5)*T }; }
export function fmt(n:number){ return n<10?"0"+n:""+n; }
export function nowts(){ const d=new Date(); return `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`; }
export function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)); }

// The one quantity actually observed for a working agent: elapsed wall-clock
// time since agent_runs.started_at. Same formula OfficeTab.tsx renders in the
// roster (fmtRuntime) — kept here as the single source so the canvas and the
// tab can never disagree. There is no real completion fraction anywhere in
// agent_runs, so this is intentionally text, not a bar: a bar implies a
// measured percent-done that nothing computes.
export function formatElapsed(startedAt: string | null | undefined): string | null {
  if(!startedAt) return null;
  const mins=Math.max(0,Math.round((Date.now()-new Date(startedAt).getTime())/60000));
  return mins<1?"<1m":mins<60?`${mins}m`:`${Math.floor(mins/60)}h ${mins%60}m`;
}

export function mkBurst(x:number,y:number,color:string){
  return Array.from({length:12},(_,i)=>{
    const a=(i/12)*Math.PI*2, spd=2.5+Math.random()*3;
    return {x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-1.5,color,age:0,maxAge:50+Math.random()*20,size:4+Math.random()*3};
  });
}

// ─── localStorage ─────────────────────────────────────────────────────────────
export function loadMemory(){ try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return {};} }
export function saveMemory(agents:any[]){
  try{
    const m:any={};
    agents.forEach(ag=>{m[ag.id]={tasksCompleted:ag.tasksCompleted,timeWorking:ag.timeWorking,taskHistory:ag.taskHistory};});
    localStorage.setItem(LS_KEY,JSON.stringify(m));
  }catch(e){}
}

// Builds sim agents from the REAL roster only. Placement is computed, not
// looked up: the first agent whose role reads as orchestrator (or, failing
// that, the first agent at all) gets the orchestrator desk; every other
// `active` agent gets the next open desk slot in encounter order; every
// non-active agent gets the next bench slot. Nothing here can fabricate an
// agent that was not in `roster`, and nothing here decides who is active —
// that came from /api/agents.
export function initAgents(T:number, roster: RosterAgent[]){
  const mem=loadMemory();
  const orchestratorId = roster.find(a=>isOrchestratorRole(a.role))?.id ?? roster[0]?.id ?? null;
  let deskI=0, benchI=0;
  return roster.map(a=>{
    const isOrch = a.id===orchestratorId;
    const tp = isOrch ? {tx:ORCH_TX,ty:ORCH_TY} : (a.active ? deskSlot(deskI++) : benchSlot(benchI++));
    const {x,y}=tileCenterPx(tp.tx+(isOrch?1.1:0.75), tp.ty+(isOrch?1.0:0.85), T);
    const saved:any=mem[a.id]||{};
    return {...a,
      isOrchestrator:isOrch,
      active:a.active, spawning:false, spawnAge:0,
      state:"idle",task:null,progress:0,
      px:x,py:y,waypoints:[],deskX:x,deskY:y,deskTx:tp.tx,deskTy:tp.ty,
      facing:"down",animTick:0,
      personality: a.personality ?? { workBurst:0.85, focusDuration:3 },
      taskHistory:saved.taskHistory||[],
      timeWorking:saved.timeWorking||0,
      timeIdle:0,
      tasksCompleted:saved.tasksCompleted||0,
      mood:88,
      glowTick:0, // flashes on state transition
      lastStateChange:Date.now(),
    };
  });
}

// ─── Audio ────────────────────────────────────────────────────────────────────
export function createAudio(){
  try{
    const ac=new((window as any).AudioContext||(window as any).webkitAudioContext)();
    const master=ac.createGain(); master.gain.value=0.09; master.connect(ac.destination);
    const note = (freq:number,dur:number,type:OscillatorType="square",vol=0.07) => {
      if(ac.state==="suspended")ac.resume();
      const o=ac.createOscillator(),g=ac.createGain();
      o.connect(g);g.connect(master);o.frequency.value=freq;o.type=type;
      g.gain.setValueAtTime(vol,ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+dur);
      o.start(ac.currentTime);o.stop(ac.currentTime+dur);
    }
    return{
      master,
      playClick(){[0,100,200].forEach(d=>setTimeout(()=>note(700+Math.random()*400,0.04),d));},
      playComplete(){[523,659,784].forEach((f,i)=>setTimeout(()=>note(f,0.2,"sine",0.11),i*90));},
      playSpawn(){[440,554,659].forEach((f,i)=>setTimeout(()=>note(f,0.15,"sine",0.10),i*70));},
    };
  }catch(e){return null;}
}

// ─── Day/night ────────────────────────────────────────────────────────────────
export function getDayNight(_tick:number){
  // Sync to real local time: darkest at 2am, brightest at 2pm
  const h=new Date().getHours()+new Date().getMinutes()/60;
  const norm=(h-14)/12; // 0 at 2pm, ±1 at 2am
  return 0.05+0.20*Math.max(0,Math.abs(norm)); // 0.05 at noon, 0.25 at midnight
}

// ─── Camera ───────────────────────────────────────────────────────────────────
export function clampCam(cam:any,W:number,H:number){
  if(cam.z<=cam.minZ){cam.x=0;cam.y=0;return;}
  cam.x=clamp(cam.x,W*(1-cam.z),0);
  cam.y=clamp(cam.y,H*(1-cam.z),0);
}
export function applyCamera(ctx:CanvasRenderingContext2D,cam:any){ctx.translate(cam.x,cam.y);ctx.scale(cam.z,cam.z);}

// ─── Draw floor ───────────────────────────────────────────────────────────────
export function drawFloor(ctx:CanvasRenderingContext2D,T:number,cam:any,darkAlpha:number,thm:typeof THEMES.A,showGrid:boolean){
  ctx.save();applyCamera(ctx,cam);
  for(let r=0;r<MAP_ROWS;r++) for(let c=0;c<MAP_COLS;c++){
    const hold=r>STANCHION_R;
    ctx.fillStyle=hold?((c+r)%2===0?thm.floorHold:thm.floorHoldB):((c+r)%2===0?thm.floorA:thm.floorB);
    ctx.fillRect(c*T,r*T,T,T);
  }
  if(showGrid){
    ctx.strokeStyle=thm.grid;ctx.lineWidth=0.5;
    for(let c=0;c<=MAP_COLS;c++){ctx.beginPath();ctx.moveTo(c*T,0);ctx.lineTo(c*T,MAP_ROWS*T);ctx.stroke();}
    for(let r=0;r<=MAP_ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*T);ctx.lineTo(MAP_COLS*T,r*T);ctx.stroke();}
  }
  ctx.fillStyle=thm.wall;
  ctx.fillRect(0,0,MAP_COLS*T,5);ctx.fillRect(0,0,5,STANCHION_R*T);ctx.fillRect(MAP_COLS*T-5,0,5,STANCHION_R*T);
  [ROW_Y[1],ROW_Y[2],ROW_Y[3]].forEach(ry=>{
    ctx.fillStyle=thm.rowDiv;ctx.fillRect(0,(ry-0.15)*T,MAP_COLS*T,T*0.25);
  });
  if(darkAlpha>0.03){ctx.fillStyle=`rgba(5,5,28,${darkAlpha})`;ctx.fillRect(0,0,MAP_COLS*T,STANCHION_R*T);}
  const sy=STANCHION_R*T+T*0.45;
  ctx.strokeStyle="#FDCB6Eaa";ctx.lineWidth=T*0.04;ctx.setLineDash([T*0.14,T*0.07]);
  ctx.beginPath();ctx.moveTo(T*0.3,sy);ctx.lineTo(MAP_COLS*T-T*0.3,sy);ctx.stroke();ctx.setLineDash([]);
  for(let c=0;c<MAP_COLS;c+=4){
    const px2=c*T+T*0.5;
    ctx.fillStyle="#FDCB6E";
    ctx.fillRect(px2-T*0.045,sy-T*0.32,T*0.09,T*0.64);
    ctx.beginPath();ctx.arc(px2,sy-T*0.32,T*0.07,0,Math.PI*2);ctx.fill();
  }
  ctx.font=`bold ${Math.round(T*0.18)}px 'IBM Plex Mono',monospace`;
  ctx.fillStyle=thm.textDim;ctx.textAlign="center";
  ctx.fillText("— HOLDING AREA —",MAP_COLS*T/2,STANCHION_R*T+T*0.88);
  ctx.restore();
}

// ─── Draw furniture ───────────────────────────────────────────────────────────
export function drawFurniture(ctx:CanvasRenderingContext2D,T:number,cam:any,agents:any[],now:number,darkAlpha:number,critPairs:any[],showDepGraph:boolean,thm:typeof THEMES.A,liveRuns:Record<string,AgentRunInfo>={}){
  ctx.save();applyCamera(ctx,cam);

  // ── Dependency graph overlay ──
  // TOD (agent-roster-truth): this used to draw dashed "possible" edges from
  // a hardcoded topology (main → scout/kemuni-sme/vespera-sme, …) — the same
  // fabricated-roster problem in graph form: it drew reporting lines to
  // specific ids whether or not those agents existed on this host. There is
  // no source of a real dependency/reporting graph yet, so this only draws
  // edges that were actually observed firing (critPairs) — nothing invented.
  if(showDepGraph){
    critPairs.forEach(([srcId,dstId]:any)=>{
      const src=agents.find(a=>a.id===srcId); if(!src||!src.active) return;
      const dst=agents.find(a=>a.id===dstId); if(!dst||!dst.active) return;
      {
        ctx.strokeStyle="#FDCB6Ecc";
        ctx.lineWidth=T*0.04;
        ctx.beginPath();ctx.moveTo(src.px,src.py);ctx.lineTo(dst.px,dst.py);ctx.stroke();
        ctx.setLineDash([]);
        const angle=Math.atan2(dst.py-src.py,dst.px-src.px);
        const ax=dst.px-Math.cos(angle)*T*0.35,ay=dst.py-Math.sin(angle)*T*0.35;
        ctx.fillStyle="#FDCB6E";
        ctx.beginPath();ctx.moveTo(ax,ay);
        ctx.lineTo(ax-Math.cos(angle-0.4)*T*0.18,ay-Math.sin(angle-0.4)*T*0.18);
        ctx.lineTo(ax-Math.cos(angle+0.4)*T*0.18,ay-Math.sin(angle+0.4)*T*0.18);
        ctx.closePath();ctx.fill();
      }
    });
  }

  // ── Active critical path arcs ──
  critPairs.forEach(([srcId,dstId]:any)=>{
    const src=agents.find(a=>a.id===srcId),dst=agents.find(a=>a.id===dstId);
    if(!src||!dst) return;
    const phase=(now*0.002)%1;
    for(let i=0;i<18;i++){
      const t=((i/18)+phase)%1;
      const mx=(src.px+dst.px)/2,my=Math.min(src.py,dst.py)-T*1.2;
      const bx=(1-t)*(1-t)*src.px+2*(1-t)*t*mx+t*t*dst.px;
      const by=(1-t)*(1-t)*src.py+2*(1-t)*t*my+t*t*dst.py;
      ctx.beginPath();ctx.arc(bx,by,T*0.055,0,Math.PI*2);
      ctx.fillStyle=`rgba(253,203,110,${Math.sin(t*Math.PI)*0.75})`;ctx.fill();
    }
  });

  // ── Orchestrator desk ──
  const orchAg=agents.find(a=>a.isOrchestrator);
  // Pulse ring: expand outward when the orchestrator is coordinating (working + other agents also working)
  const othersWorking2=agents.filter(a=>!a.isOrchestrator&&a.active&&a.state==="working");
  if(orchAg&&orchAg.state==="working"&&othersWorking2.length>=1){
    const cx=ORCH_TX*T+T*1.1, cy=ORCH_TY*T+T*1.0;
    const pulse=(now*0.0008)%1;
    for(let r=0;r<2;r++){
      const rp=(pulse+r*0.5)%1;
      const radius=T*(1.2+rp*1.8);
      const alpha=(1-rp)*0.3;
      ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);
      ctx.strokeStyle=(orchAg.color)+Math.round(alpha*255).toString(16).padStart(2,"0");
      ctx.lineWidth=T*0.03;ctx.stroke();
    }
  }
  {
    const x=ORCH_TX*T, y=ORCH_TY*T, dw=T*2.2, dh=T*2.0;
    const working=orchAg?.state==="working";
    const mood=(orchAg?.mood||88)/100;
    ctx.beginPath();ctx.roundRect(x-T*0.06,y-T*0.06,dw+T*0.12,dh+T*0.12,T*0.12);
    ctx.strokeStyle=(orchAg?.color||"#6C5CE7")+"55";ctx.lineWidth=T*0.05;ctx.stroke();
    ctx.fillStyle=thm.orchDesk;
    ctx.strokeStyle=working?(orchAg.color+"cc"):(orchAg?.color||"#6C5CE7")+"44";
    ctx.lineWidth=T*0.022;
    ctx.beginPath();ctx.roundRect(x+T*0.05,y+T*0.05,dw-T*0.1,dh-T*0.1,T*0.1);ctx.fill();ctx.stroke();
    const mx2=x+dw*0.1,my2=y+dh*0.1,mw=dw*0.8,mh=dh*0.62;
    ctx.fillStyle="#08081a";ctx.fillRect(mx2,my2,mw,mh);
    ctx.strokeStyle=working?(orchAg.color+"cc"):(orchAg?.color||"#6C5CE7")+"55";ctx.lineWidth=T*0.018;ctx.strokeRect(mx2,my2,mw,mh);
    if(working){
      const t2=now*0.001;
      for(let l=0;l<5;l++){
        const al=0.15+0.35*Math.sin(t2*2+l*1.1);
        ctx.fillStyle=(orchAg.color)+Math.round(al*255).toString(16).padStart(2,"0");
        ctx.fillRect(mx2+dw*0.04,my2+dh*0.08+l*(mh/5.5),mw*(0.25+0.5*((l+Math.floor(t2))%2))*mood,dh*0.07);
      }
    } else {
      // MC-15: Orchestrator health indicators when idle
      const orchRun=orchAg?liveRuns[orchAg.id]:undefined;
      if(orchRun&&orchRun.status!=='never'){
        const hColor=orchRun.todayErrors>2?'#ff4444':orchRun.todayErrors>0?'#f59e0b':'#00ff88';
        const hPx=Math.max(9,Math.round(T*0.10));
        ctx.font=`${hPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="left";
        ctx.beginPath();ctx.arc(mx2+dw*0.06,my2+dh*0.12,T*0.04,0,Math.PI*2);ctx.fillStyle=hColor;ctx.fill();
        const ago=orchRun.startedAt?Math.round((Date.now()-new Date(orchRun.startedAt).getTime())/60000):0;
        const agoStr=ago<60?`${ago}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
        ctx.fillStyle="#6a6a8e";ctx.fillText(`Last: ${agoStr}`,mx2+dw*0.12,my2+dh*0.16);
        ctx.fillStyle="#00ff88";ctx.fillText(`${orchRun.todayTasks} tasks`,mx2+dw*0.04,my2+dh*0.30);
        if(orchRun.todayErrors>0){ctx.fillStyle="#ff4444";ctx.fillText(`${orchRun.todayErrors} err`,mx2+dw*0.04,my2+dh*0.44);}
        ctx.font=`bold ${Math.round(T*0.11)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
        ctx.fillStyle="#1e1e40";ctx.fillText("STANDBY",x+dw/2,my2+mh*0.72);
      } else {
        ctx.fillStyle="#ffffff08";ctx.fillRect(mx2+dw*0.04,my2+dh*0.12,mw*0.6,dh*0.05);
        if(Math.floor(now*0.002)%2===0){
          ctx.fillStyle=(orchAg?.color||"#6C5CE7")+"33";ctx.fillRect(mx2+dw*0.04,my2+dh*0.26,dh*0.06,dh*0.06);
        }
        ctx.font=`bold ${Math.round(T*0.13)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
        ctx.fillStyle="#1e1e40";ctx.fillText("STANDBY",x+dw/2,my2+mh*0.72);
      }
    }
    ctx.fillStyle="#141424";
    ctx.fillRect(x+dw/2-T*0.05,y+dh*0.76,T*0.1,dh*0.13);
    ctx.fillRect(x+dw/2-T*0.16,y+dh*0.88,T*0.32,T*0.06);
    const crownX=x+dw/2, crownY=y-T*0.04;
    const cs=T*0.16;
    ctx.fillStyle="#FDCB6E";
    ctx.beginPath();
    ctx.moveTo(crownX-cs,crownY+cs*0.5);ctx.lineTo(crownX-cs,crownY-cs*0.1);
    ctx.lineTo(crownX-cs*0.5,crownY+cs*0.3);ctx.lineTo(crownX,crownY-cs*0.55);
    ctx.lineTo(crownX+cs*0.5,crownY+cs*0.3);ctx.lineTo(crownX+cs,crownY-cs*0.1);
    ctx.lineTo(crownX+cs,crownY+cs*0.5);ctx.closePath();ctx.fill();
    [crownX-cs*0.5,crownX,crownX+cs*0.5].forEach(dx=>{
      ctx.beginPath();ctx.arc(dx,crownY+cs*0.6,cs*0.11,0,Math.PI*2);ctx.fillStyle="#FFE08A";ctx.fill();
    });
    if(darkAlpha>0.05&&orchAg){
      ctx.shadowColor=orchAg.color;ctx.shadowBlur=T*0.4*darkAlpha;
      ctx.strokeStyle=orchAg.color+"22";ctx.lineWidth=T*0.03;
      ctx.strokeRect(mx2,my2,mw,mh);ctx.shadowBlur=0;
    }
    ctx.font=`bold ${Math.round(T*0.14)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
    ctx.fillStyle=(orchAg?.color||"#6C5CE7")+"99";
    ctx.fillText("ORCHESTRATOR",x+dw/2,y+dh+T*0.22);
  }

  // ── Regular desks (active non-orchestrator agents) ──
  agents.filter(ag=>ag.active&&!ag.isOrchestrator).forEach(ag=>{
    const id=ag.id;
    const x=ag.deskTx*T, y=ag.deskTy*T, dw=T*1.5, dh=T*1.7;
    const working=ag.state==="working";
    const mood=(ag.mood||88)/100;
    ctx.fillStyle=thm.deskBody;
    ctx.strokeStyle=working?ag.color+Math.round(80+mood*120).toString(16).padStart(2,"0"):(ag.color+"18");
    ctx.lineWidth=working?T*0.022:T*0.01;
    ctx.beginPath();ctx.roundRect(x+T*0.05,y+T*0.05,dw-T*0.1,dh-T*0.1,T*0.08);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    const mx2=x+dw*0.12,my2=y+dh*0.1,mw=dw*0.76,mh=dh*0.58;
    ctx.fillStyle="#090918";ctx.fillRect(mx2,my2,mw,mh);
    ctx.strokeStyle=working?ag.color+"cc":"#252550";ctx.lineWidth=T*0.014;ctx.strokeRect(mx2,my2,mw,mh);
    if(working){
      const t2=now*0.001;
      for(let l=0;l<3;l++){
        const al=0.18+0.28*Math.sin(t2*2+l*1.2);
        ctx.fillStyle=ag.color+Math.round(al*255).toString(16).padStart(2,"0");
        ctx.fillRect(mx2+dw*0.04,my2+dh*0.08+l*(mh/3.5),mw*(0.3+0.45*((l+Math.floor(t2))%2))*mood,dh*0.09);
      }
      if(darkAlpha>0.05){ctx.shadowColor=ag.color;ctx.shadowBlur=T*0.25*darkAlpha;ctx.strokeStyle=ag.color+"22";ctx.strokeRect(mx2,my2,mw,mh);ctx.shadowBlur=0;}
    } else {
      // MC-15: Health indicators on idle monitors
      const run=liveRuns[id];
      if(run&&run.status!=='never'){
        const hColor=run.todayErrors>2?'#ff4444':run.todayErrors>0?'#f59e0b':'#00ff88';
        const hPx=Math.max(8,Math.round(T*0.09));
        ctx.font=`${hPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="left";
        // Status dot
        ctx.beginPath();ctx.arc(mx2+dw*0.06,my2+dh*0.15,T*0.04,0,Math.PI*2);ctx.fillStyle=hColor;ctx.fill();
        // Last run time
        const ago=run.startedAt?Math.round((Date.now()-new Date(run.startedAt).getTime())/60000):0;
        const agoStr=ago<60?`${ago}m`:ago<1440?`${Math.floor(ago/60)}h`:`${Math.floor(ago/1440)}d`;
        ctx.fillStyle="#6a6a8e";ctx.fillText(`Last: ${agoStr}`,mx2+dw*0.12,my2+dh*0.19);
        // Tasks today
        ctx.fillStyle="#00ff88";ctx.fillText(`${run.todayTasks} tasks`,mx2+dw*0.04,my2+dh*0.38);
        // Errors
        if(run.todayErrors>0){
          ctx.fillStyle="#ff4444";ctx.fillText(`${run.todayErrors} err`,mx2+dw*0.04,my2+dh*0.55);
        }
      } else {
        ctx.fillStyle="#ffffff08";ctx.fillRect(mx2+dw*0.04,my2+dh*0.12,mw*0.5,dh*0.06);
        if(Math.floor(now*0.002)%2===0){
          ctx.fillStyle=ag.color+"33";ctx.fillRect(mx2+dw*0.04,my2+dh*0.28,dh*0.06,dh*0.06);
        }
        ctx.font=`bold ${Math.round(T*0.11)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
        ctx.fillStyle="#1e1e40";ctx.fillText("IDLE",x+dw/2,my2+mh*0.75);
      }
    }
    ctx.fillStyle="#111122";
    ctx.fillRect(x+dw/2-T*0.04,y+dh*0.75,T*0.08,dh*0.13);
    ctx.fillRect(x+dw/2-T*0.12,y+dh*0.87,T*0.24,T*0.055);
  });

  // ── Empty desks (dimmed, unassigned) ──
  // TOD (agent-roster-truth): these used to be labeled with two invented
  // future hires ("Quill", "Echo") that do not exist in any roster this
  // product has ever read. An unfilled desk is now drawn empty — furniture,
  // not a name — because nothing here knows who (if anyone) will sit there.
  {
    const usedDesks=agents.filter(a=>a.active&&!a.isOrchestrator).length;
    for(let i=0;i<4;i++){
      const {tx,ty}=deskSlot(usedDesks+i);
      const x=tx*T, y=ty*T, dw=T*1.5, dh=T*1.7;
      ctx.fillStyle="#0f0f1c";
      ctx.strokeStyle="#181830";
      ctx.lineWidth=T*0.008;
      ctx.beginPath();ctx.roundRect(x+T*0.05,y+T*0.05,dw-T*0.1,dh-T*0.1,T*0.08);ctx.fill();ctx.stroke();ctx.setLineDash([]);
      const mx2=x+dw*0.12,my2=y+dh*0.1,mw=dw*0.76,mh=dh*0.58;
      ctx.fillStyle="#060610";ctx.fillRect(mx2,my2,mw,mh);
      ctx.strokeStyle="#131328";ctx.lineWidth=T*0.012;ctx.strokeRect(mx2,my2,mw,mh);
    }
  }

  // ── Conference table ── (static furniture — no live meeting state to render; see kill-office-fiction)
  const tcx=CONF_TX*T, tcy=CONF_TY*T, tw=CONF_TW*T, th=CONF_TH*T;
  ctx.fillStyle=thm.confTable;
  ctx.strokeStyle="#282848";
  ctx.lineWidth=T*0.014;
  ctx.beginPath();ctx.roundRect(tcx,tcy,tw,th,T*0.2);ctx.fill();ctx.stroke();
  ctx.strokeStyle="#ffffff05";ctx.lineWidth=T*0.01;
  ctx.beginPath();ctx.roundRect(tcx+T*0.1,tcy+T*0.1,tw-T*0.2,th-T*0.2,T*0.15);ctx.stroke();
  // Chairs: 4 top, 4 bottom (evenly spaced with margin), 2 left, 2 right
  const cW=T*0.22,cH=T*0.14;
  const topBottom=[0.15,0.35,0.65,0.85];
  const leftRight=[0.25,0.75];
  const chairs=[
    ...topBottom.map(fx=>({fx,fy:-0.14,rot:0})),
    ...topBottom.map(fx=>({fx,fy:1.10,rot:0})),
    ...leftRight.map(fy=>({fx:-0.12,fy,rot:0})),
    ...leftRight.map(fy=>({fx:1.08,fy,rot:0})),
  ];
  chairs.forEach(({fx,fy})=>{
    const cx=tcx+tw*fx-cW/2, cy=tcy+th*fy-cH/2;
    ctx.fillStyle="#1e1e3c";ctx.strokeStyle="#282848";ctx.lineWidth=T*0.009;
    ctx.beginPath();ctx.roundRect(cx,cy,cW,cH,T*0.04);ctx.fill();ctx.stroke();
    // Cushion
    ctx.fillStyle="#24243e";ctx.beginPath();ctx.roundRect(cx+T*0.02,cy+T*0.02,cW-T*0.04,cH*0.5,T*0.02);ctx.fill();
  });
  ctx.font=`bold ${Math.round(T*0.15)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
  ctx.fillStyle="#252550";ctx.fillText("Conference Table",tcx+tw/2,tcy+th+T*0.3);

  ctx.restore();
}

export function drawParticles(ctx:CanvasRenderingContext2D,particles:any[],cam:any){
  ctx.save();applyCamera(ctx,cam);
  particles.forEach(p=>{
    const alpha=Math.max(0,1-p.age/p.maxAge);
    ctx.globalAlpha=alpha;ctx.fillStyle=p.color;
    ctx.beginPath();ctx.arc(p.x,p.y,p.size*alpha,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;ctx.restore();
}

export function drawAgent(ctx:CanvasRenderingContext2D,ag:any,T:number,now:number,cam:any,isSelected:boolean,darkAlpha:number,boardTasksMap:Record<string,string>={},subagentCount:number=0,agentCost:number=0,startedAt:string|null=null){
  // Every roster agent gets a real position at init (desk or bench — see
  // initAgents), so there is no more "agent with nowhere to stand" case to
  // filter for here.
  ctx.save();applyCamera(ctx,cam);
  const {px,py,color,name,state,task,facing,mood,active}=ag;
  const isOrch=!!ag.isOrchestrator;
  const sz=isOrch?T*0.78:T*0.58, hs=sz/2;
  const moodN=(mood||88)/100;

  if(ag.spawning){
    const sf=Math.min(1,ag.spawnAge/30);
    ctx.globalAlpha=sf;
    ctx.beginPath();ctx.arc(px,py,sz*(1.5-sf*0.5),0,Math.PI*2);
    ctx.fillStyle=color+"44";ctx.fill();
  }

  const bob=state==="idle"?Math.sin(now*0.003+ag.animTick*0.12)*T*0.018*moodN:0;
  const dy2=bob;
  const [ox,oy]=({down:[0,T*0.022],up:[0,-T*0.022],left:[-T*0.022,0],right:[T*0.022,0]} as any)[facing]||[0,0];

  if(isSelected){
    ctx.beginPath();ctx.arc(px+ox,py+dy2+oy,hs+T*0.1,0,Math.PI*2);
    ctx.strokeStyle=color+"55";ctx.lineWidth=T*0.025;ctx.stroke();
  }
  if(isOrch&&!isSelected){
    ctx.beginPath();ctx.arc(px+ox,py+dy2+oy,hs+T*0.06,0,Math.PI*2);
    ctx.strokeStyle=color+"30";ctx.lineWidth=T*0.015;ctx.stroke();
  }
  ctx.fillStyle="#00000044";
  ctx.beginPath();ctx.ellipse(px+ox,py+hs+T*0.022+oy+dy2,hs*0.65,T*0.022,0,0,Math.PI*2);ctx.fill();
  const bA=Math.round((0.7+moodN*0.3)*255).toString(16).padStart(2,"0");
  const bodyCol=active?color+bA:"#3a3a5e"+bA;
  // MC-19: Enhanced state transition animation — glow + scale pulse + fade
  let transScale=1;
  if(ag.glowTick>0){
    ag.glowTick--;
    const glowAlpha=ag.glowTick/60;
    // Scale pulse: brief enlarge then settle (easeOutElastic-ish)
    const t2=1-glowAlpha;
    transScale=1+0.12*Math.sin(t2*Math.PI)*Math.max(0,1-t2*1.5);
    ctx.shadowColor=color;ctx.shadowBlur=sz*1.0*glowAlpha;
    // Outer ring pulse
    ctx.beginPath();ctx.arc(px+ox,py+dy2+oy,hs+T*0.15+T*0.1*glowAlpha,0,Math.PI*2);
    ctx.fillStyle=color+Math.round(glowAlpha*50).toString(16).padStart(2,"0");ctx.fill();
    // Inner glow
    ctx.beginPath();ctx.arc(px+ox,py+dy2+oy,hs+T*0.05,0,Math.PI*2);
    ctx.fillStyle=color+Math.round(glowAlpha*25).toString(16).padStart(2,"0");ctx.fill();
    ctx.shadowBlur=0;
  }
  if(darkAlpha>0.05){ctx.shadowColor=color;ctx.shadowBlur=sz*0.22*darkAlpha;}
  // Apply scale for transition animation
  const asz=sz*transScale,ahs=asz/2;
  ctx.fillStyle=bodyCol;ctx.fillRect(px-ahs+ox,py-ahs+dy2+oy,asz,asz);ctx.shadowBlur=0;
  const fw=sz*0.44,fh=sz*0.31;
  ctx.fillStyle="#ffffffdd";ctx.fillRect(px-fw/2+ox,py-sz*0.17+dy2+oy,fw,fh);
  ctx.fillStyle="#111";
  if(facing!=="up"){
    ctx.fillRect(px-fw*0.34+ox,py-sz*0.09+dy2+oy,fw*0.14,fh*0.3);
    ctx.fillRect(px+fw*0.2+ox, py-sz*0.09+dy2+oy,fw*0.14,fh*0.3);
    // MC-17: Expression based on mood — happy/neutral/stressed
    const moodVal=mood||88;
    ctx.beginPath();
    if(moodVal>=90){
      // Happy: upward smile
      ctx.arc(px+ox,py+sz*0.06+dy2+oy,fw*0.19,0.1*Math.PI,0.9*Math.PI);
    } else if(moodVal<=60){
      // Stressed: frown
      ctx.arc(px+ox,py+sz*0.14+dy2+oy,fw*0.17,1.1*Math.PI,1.9*Math.PI);
    } else {
      // Neutral: flat line
      ctx.moveTo(px-fw*0.15+ox,py+sz*0.09+dy2+oy);ctx.lineTo(px+fw*0.15+ox,py+sz*0.09+dy2+oy);
    }
    ctx.strokeStyle="#111";ctx.lineWidth=sz*0.04;ctx.stroke();
  }
  ctx.fillStyle=color;ctx.fillRect(px-hs+ox,py-hs+dy2+oy,sz,sz*0.18);
  const dotC=state==="working"?"#00ff88":active?"#4a5568":"#2a2a4a";
  ctx.beginPath();ctx.arc(px+hs-sz*0.1+ox,py-hs+sz*0.1+dy2+oy,sz*0.1,0,Math.PI*2);
  ctx.fillStyle=dotC;ctx.fill();ctx.strokeStyle="#0b0b14";ctx.lineWidth=sz*0.035;ctx.stroke();

  const nPx=Math.max(10,Math.round(T*0.13));
  ctx.font=`bold ${nPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
  const nlW=ctx.measureText(name).width+T*0.14,nlH=nPx*1.6,nlY=py+hs+T*0.05+dy2+oy;
  ctx.fillStyle="#0a0a14dd";ctx.strokeStyle=(active?color:"#6a6a8e")+"99";ctx.lineWidth=sz*0.04;
  ctx.beginPath();ctx.roundRect(px-nlW/2,nlY,nlW,nlH,T*0.03);ctx.fill();ctx.stroke();
  ctx.fillStyle=active?color:"#6a6a8e";ctx.fillText(name,px,nlY+nlH*0.72);

  // Board task overlay — shown above chat task label
  const boardTask=boardTasksMap[ag.id];
  if(boardTask&&(state==="working"||state==="idle")){
    const bPx=Math.max(10,Math.round(T*0.13));
    ctx.font=`bold ${bPx}px 'IBM Plex Mono',monospace`;
    const bShort=boardTask.length>28?boardTask.slice(0,27)+"…":boardTask;
    const blW=ctx.measureText("📋 "+bShort).width+T*0.18,blH=bPx*1.7;
    const chatTaskH=(state==="working"&&task)?(Math.max(11,Math.round(T*0.19))*1.8+T*0.10):0;
    const blY=py-hs-chatTaskH-blH-T*0.28+dy2+oy;
    ctx.fillStyle="#1a1500f0";ctx.strokeStyle="#FDCB6Ecc";ctx.lineWidth=T*0.018;
    ctx.beginPath();ctx.roundRect(px-blW/2,blY,blW,blH,T*0.04);ctx.fill();ctx.stroke();
    ctx.fillStyle="#FDCB6E";ctx.textAlign="center";
    ctx.fillText("📋 "+bShort,px,blY+blH*0.73);
  }
  if(state==="working"&&task){
    const tPx=Math.max(11,Math.round(T*0.19));
    ctx.font=`bold ${tPx}px 'IBM Plex Mono',monospace`;
    const short=task.length>26?task.slice(0,25)+"…":task;
    const tlW=ctx.measureText(short).width+T*0.20,tlH=tPx*1.8;
    const tlY=py-hs-tlH-T*0.10+dy2+oy;
    ctx.fillStyle="#0b0b1ff0";ctx.strokeStyle=color+"88";ctx.lineWidth=T*0.016;
    ctx.beginPath();ctx.roundRect(px-tlW/2,tlY,tlW,tlH,T*0.04);ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.fillText(short,px,tlY+tlH*0.73);
    // Elapsed time since the run actually started (agent_runs.started_at) —
    // the one quantity observed. No fabricated completion percentage: there
    // is no field anywhere that measures how much of the task is done.
    const elapsed=formatElapsed(startedAt);
    if(elapsed){
      const ePx=Math.max(9,Math.round(T*0.115));
      ctx.font=`${ePx}px 'IBM Plex Mono',monospace`;
      const eW=Math.max(tlW,nlW),eH=ePx*1.5,eY=nlY+nlH+T*0.025;
      ctx.fillStyle="#151528";ctx.fillRect(px-eW/2,eY,eW,eH);
      ctx.fillStyle=color+"dd";ctx.textAlign="center";
      ctx.fillText(`⏱ ${elapsed}`,px,eY+eH*0.75);
    }
  }
  // Idle timer display
  if(state==="idle"&&active&&ag.lastStateChange){
    const idleMins=Math.round((Date.now()-(ag.lastStateChange||Date.now()))/60000);
    if(idleMins>=1){
      const idleText=idleMins>=60?`${Math.floor(idleMins/60)}h ${idleMins%60}m`:`${idleMins}m`;
      const iPx=Math.max(9,Math.round(T*0.10));
      ctx.font=`${iPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
      ctx.fillStyle="#4a4a6a";
      ctx.fillText(`idle ${idleText}`,px,py+hs+T*0.35+dy2+oy);
    }
  }
  // Cost ticker — small label below idle timer
  if(agentCost>0&&active){
    const cPx=Math.max(8,Math.round(T*0.09));
    ctx.font=`${cPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
    const costText=agentCost>=1?`$${agentCost.toFixed(2)}`:`${(agentCost*100).toFixed(1)}¢`;
    ctx.fillStyle="#4a6a5a";
    ctx.fillText(`💰 ${costText}`,px,py+hs+T*0.48+dy2+oy);
  }
  // Sub-agent activity badge — only for orchestrator when sub-agents are active
  if(ag.isOrchestrator&&subagentCount>0){
    const badgeX=px+hs-T*0.05;
    const badgeY=py-hs-T*0.35;
    const bPx=Math.max(8,Math.round(T*0.11));
    const label=`🤖×${subagentCount}`;
    ctx.font=`bold ${bPx}px 'IBM Plex Mono',monospace`;
    const bw=ctx.measureText(label).width+T*0.14;
    const bh=bPx*1.6;
    ctx.fillStyle='#0d1a0d';
    ctx.strokeStyle='#00ff8899';
    ctx.lineWidth=T*0.015;
    ctx.beginPath();
    ctx.roundRect(badgeX-bw/2,badgeY-bh/2,bw,bh,T*0.03);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle='#00ff88';
    ctx.textAlign='center';
    ctx.fillText(label,badgeX,badgeY+bh*0.28);
  }
  ctx.globalAlpha=1;ctx.restore();
}

export function drawMinimap(ctx:CanvasRenderingContext2D,T:number,agents:any[],cam:any,canvasW:number,canvasH:number,showLegend:boolean){
  const mw=Math.round(canvasW*0.13),mh=Math.round(mw*(MAP_ROWS/MAP_COLS));
  const pad=10;
  const sx=mw/(MAP_COLS*T),sy=mh/(MAP_ROWS*T);
  const mmX=canvasW-mw-pad,mmY=canvasH-mh-pad;
  ctx.fillStyle="#080814cc";ctx.beginPath();ctx.roundRect(mmX-2,mmY-2,mw+4,mh+4,5);ctx.fill();
  ctx.strokeStyle="#2a2a4a";ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(mmX-2,mmY-2,mw+4,mh+4,5);ctx.stroke();
  ctx.fillStyle="#11111e";ctx.fillRect(mmX,mmY,mw,mh);
  const mmSY=mmY+STANCHION_R*T*sy;
  ctx.strokeStyle="#FDCB6E55";ctx.lineWidth=1;ctx.setLineDash([3,2]);
  ctx.beginPath();ctx.moveTo(mmX,mmSY);ctx.lineTo(mmX+mw,mmSY);ctx.stroke();ctx.setLineDash([]);
  agents.filter(a=>a.active).forEach(ag=>{
    ctx.fillStyle=ag.color+"33";
    ctx.fillRect(mmX+ag.deskTx*T*sx,mmY+ag.deskTy*T*sy,T*sx*1.5,T*sy*1.7);
  });
  agents.forEach(a=>{
    const ax=mmX+a.px*sx,ay=mmY+a.py*sy,r=Math.max(2,3);
    ctx.beginPath();ctx.arc(ax,ay,r,0,Math.PI*2);
    ctx.fillStyle=a.state==="working"?"#00ff88":a.active?a.color:"#4a4a6a";
    ctx.fill();ctx.strokeStyle="#000";ctx.lineWidth=0.5;ctx.stroke();
  });
  const vx=mmX+(-cam.x/cam.z)*sx,vy=mmY+(-cam.y/cam.z)*sy;
  const vw=(canvasW/cam.z)*sx,vh=(canvasH/cam.z)*sy;
  ctx.strokeStyle="#ffffff44";ctx.lineWidth=1;ctx.setLineDash([]);
  ctx.strokeRect(Math.max(mmX,vx),Math.max(mmY,vy),Math.min(mw,vw),Math.min(mh,vh));
  ctx.font="9px 'IBM Plex Mono',monospace";ctx.fillStyle="#3a3a5e";ctx.textAlign="center";
  ctx.fillText("MAP",mmX+mw/2,mmY-4);

  if(showLegend){
    const items=[["#00ff88","Working"],["#4a5568","Idle"]];
    const legH=items.length*16+10;
    const legW=86;
    const legX=mmX+mw-legW;
    const legY=mmY-4-legH;
    ctx.fillStyle="#0b0b18cc";
    ctx.beginPath();ctx.roundRect(legX-4,legY-4,legW+8,legH+8,4);ctx.fill();
    ctx.strokeStyle="#1a1a2e";ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(legX-4,legY-4,legW+8,legH+8,4);ctx.stroke();
    items.forEach(([c,l],i)=>{
      const iy=legY+5+i*16;
      ctx.beginPath();ctx.arc(legX+6,iy+5,4,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();
      ctx.font="9px 'IBM Plex Mono',monospace";ctx.fillStyle="#8892b0";ctx.textAlign="left";
      ctx.fillText(l,legX+14,iy+9);
    });
  }
}

export function captureFrame(agents:any[],simTick:number){
  return {tick:simTick,agents:agents.map(a=>({id:a.id,px:a.px,py:a.py,state:a.state,task:a.task,progress:Math.round(a.progress)}))};
}
