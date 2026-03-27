"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Layout ───────────────────────────────────────────────────────────────────
const MAP_COLS    = 16;
const MAP_ROWS    = 16;
const OFFICE_ROWS = 12;
const STANCHION_R = 12;
const ORCHESTRATOR_ID = "main";

const ALL_AGENTS = [
  { id:"main",        name:"KAOS",       color:"#6C5CE7", emoji:"🧠", role:"Orchestrator",     personality:{ workBurst:0.95, focusDuration:4 } },
  { id:"scout",       name:"Scout",      color:"#00B894", emoji:"🔍", role:"Research",          personality:{ workBurst:0.92, focusDuration:1 } },
  { id:"ops",         name:"Ops",        color:"#F0932B", emoji:"⚙️", role:"Infrastructure",   personality:{ workBurst:0.80, focusDuration:5 } },
  { id:"kemuni-sme",  name:"Kemuni SME", color:"#E17055", emoji:"🚀", role:"Kemuni Product",   personality:{ workBurst:0.88, focusDuration:3 } },
  { id:"vespera-sme", name:"Vespera SME",color:"#74B9FF", emoji:"🖤", role:"Vespera Product",  personality:{ workBurst:0.85, focusDuration:3 } },
  // Bench
  { id:"builder",     name:"Builder",    color:"#0984E3", emoji:"🔨", role:"Code Generation",  personality:{ workBurst:0.88, focusDuration:5 } },
  { id:"tester",      name:"Tester",     color:"#E84393", emoji:"🧪", role:"QA & Testing",     personality:{ workBurst:0.85, focusDuration:2 } },
  { id:"quill",       name:"Quill",      color:"#FDCB6E", emoji:"✍️", role:"Documentation",   personality:{ workBurst:0.88, focusDuration:3 } },
  { id:"echo",        name:"Echo",       color:"#00CEC9", emoji:"📣", role:"Communications",  personality:{ workBurst:0.85, focusDuration:2 } },
];

const ACTIVE_IDS = ["main","scout","ops","kemuni-sme","vespera-sme"];
const BENCH_IDS  = ["builder","tester","quill","echo"];

const DEPENDENCIES: Record<string,string[]> = {
  "main":        ["scout","kemuni-sme","vespera-sme"],
  "scout":       ["main"],
  "kemuni-sme":  ["main"],
  "vespera-sme": ["main"],
  "ops":         ["main"],
};

const AGENT_TASKS: Record<string,string[]> = {
  "main":        ["Orchestrating sprint","Reviewing agent outputs","Delegating subtasks","Aligning team goals","Synthesizing results","Planning next sprint"],
  "scout":       ["Scanning competitor landscape","Researching goth events","Analyzing market trends","Fetching PropTech data","Summarizing research docs","Web scraping venues"],
  "ops":         ["Checking gateway health","Monitoring heartbeat","Rotating API keys","Reviewing system logs","Cost optimization","Updating infrastructure"],
  "kemuni-sme":  ["Designing property features","Planning tenant portal","Reviewing user flows","Drafting product specs","Analyzing competitor features","Prioritizing backlog"],
  "vespera-sme": ["Planning event features","Designing social feeds","Reviewing goth UX patterns","Drafting community features","Analyzing user feedback","Planning onboarding flow"],
  "builder":     ["Writing API endpoints","Refactoring components","Fixing bug reports","Building UI pages","Optimizing database queries","Implementing auth flow"],
  "tester":      ["Running integration tests","Writing unit tests","Checking edge cases","Reviewing PR code","Regression testing","Load testing API"],
  "quill":       ["Writing landing copy","Drafting blog posts","Creating event descriptions","Editing documentation","Release notes","SEO optimization"],
  "echo":        ["Posting community updates","Engaging Discord threads","Writing social posts","Moderating channels","Community Q&A","Drafting announcements"],
};

const MEETINGS = [
  {topic:"Sprint Planning",  agents:["main","kemuni-sme","vespera-sme"]},
  {topic:"Research Review",  agents:["main","scout"]},
  {topic:"Infra Check",      agents:["main","ops"]},
  {topic:"Vespera Design",   agents:["vespera-sme","scout"]},
  {topic:"Kemuni Strategy",  agents:["main","kemuni-sme"]},
  {topic:"Full Team Sync",   agents:["main","scout","ops","kemuni-sme","vespera-sme"]},
  {topic:"Product Review",   agents:["kemuni-sme","vespera-sme","main"]},
];

const INCIDENTS = [
  {title:"🔥 Gateway Down!",     victims:["ops","main"]},
  {title:"💥 Build Failed",      victims:["vespera-sme","main"]},
  {title:"🚨 Rate Limit Hit",    victims:["scout","ops","main"]},
  {title:"⚡ Supabase Overload", victims:["vespera-sme","kemuni-sme"]},
];

const CHAT_LINES = [
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
const ORCH_TX = 0.3,  ORCH_TY = 1.6;
const CONF_TX = 5.0,  CONF_TY = 1.6;  // pushed right to clear orchestrator
const CONF_TW = 8.0;
const CONF_TH = 2.2;

const ROW_Y = [1.6, 4.5, 7.0, 9.5];
const COL_X = [1.0, 4.5, 8.0, 11.5]; // 4 desks centered with margin from walls

const DESK_POS: Record<string,{tx:number,ty:number}> = {
  main:          { tx:ORCH_TX,    ty:ORCH_TY    },
  // Row 1
  scout:         { tx:COL_X[0],  ty:ROW_Y[1]   },
  "kemuni-sme":  { tx:COL_X[1],  ty:ROW_Y[1]   },
  // Row 2
  ops:           { tx:COL_X[0],  ty:ROW_Y[2]   },
  "vespera-sme": { tx:COL_X[1],  ty:ROW_Y[2]   },
};

// Empty desk slots — positions where future agents will sit
const EMPTY_DESK_POS = [
  // Row 1 remaining
  { tx:COL_X[2], ty:ROW_Y[1] },
  { tx:COL_X[3], ty:ROW_Y[1] },
  // Row 2 remaining
  { tx:COL_X[2], ty:ROW_Y[2] },
  { tx:COL_X[3], ty:ROW_Y[2] },
  // Row 3 all empty
  { tx:COL_X[0], ty:ROW_Y[3] },
  { tx:COL_X[1], ty:ROW_Y[3] },
  { tx:COL_X[2], ty:ROW_Y[3] },
  { tx:COL_X[3], ty:ROW_Y[3] },
];

const BENCH_POS: Record<string,{tx:number,ty:number}> = {
  builder:{ tx:1.5,  ty:STANCHION_R+1.0 },
  tester: { tx:5.0,  ty:STANCHION_R+1.0 },
  quill:  { tx:9.5,  ty:STANCHION_R+1.0 },
  echo:   { tx:13.0, ty:STANCHION_R+1.0 },
};

// ─── Static Templates ─────────────────────────────────────────────────────────
const MONOLOGUES: Record<string,string[]> = {
  "main":        ["delegating now","synthesizing outputs","checking priorities","aligning team","tracking dependencies","orchestrating flow"],
  "scout":       ["scanning sources","parsing results","cross-referencing","indexing findings","compiling report","validating sources"],
  "ops":         ["checking health","rotating credentials","monitoring logs","optimizing costs","updating config","validating endpoints"],
  "kemuni-sme":  ["mapping user flows","reviewing specs","aligning features","prioritizing items","drafting requirements","analyzing gaps"],
  "vespera-sme": ["designing interactions","mapping goth UX","reviewing flows","drafting features","analyzing feedback","planning onboarding"],
  "builder":     ["writing handlers","refactoring modules","fixing edge cases","building components","optimizing queries","wiring auth"],
  "tester":      ["running assertions","writing test cases","checking coverage","auditing edge cases","running regression","load testing"],
  "quill":       ["drafting copy","editing content","optimizing SEO","writing descriptions","polishing docs","revising notes"],
  "echo":        ["composing post","engaging thread","drafting update","moderating queue","writing announcement","scheduling content"],
};

const MEETING_SUMMARIES: Record<string,string> = {
  "Sprint Planning":  "• Assigned top-priority features across KAOS, Kemuni SME, and Vespera SME\n• Set delivery targets for this sprint cycle\n• Identified 3 blockers for early resolution",
  "Research Review":  "• Scout shared competitive landscape and PropTech market findings\n• Identified 2 key gaps and opportunities to exploit\n• KAOS updated strategy roadmap based on findings",
  "Infra Check":      "• Ops confirmed all services nominal — gateway, heartbeat, APIs\n• Reviewed cost optimization opportunities\n• Scheduled key rotation for next maintenance window",
  "Vespera Design":   "• Scout delivered goth community research for UX reference\n• Vespera SME finalized event feed and social interaction flows\n• 3 design decisions logged and handed off",
  "Kemuni Strategy":  "• Reviewed Kemuni feature backlog priorities with KAOS\n• Kemuni SME refined tenant portal user flows\n• Launch milestones confirmed for target date",
  "Full Team Sync":   "• All agents aligned on current sprint status\n• Cross-team dependencies mapped and delegated\n• Risk items flagged and assigned owners",
  "Product Review":   "• Kemuni SME and Vespera SME presented feature progress\n• KAOS provided strategic direction on prioritization\n• 5 product decisions recorded and actioned",
};

const DIALOGUE_POOL = [
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tileCenterPx(tx:number,ty:number,T:number){ return { x:(tx+0.5)*T, y:(ty+0.5)*T }; }
function fmt(n:number){ return n<10?"0"+n:""+n; }
function nowts(){ const d=new Date(); return `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`; }
function lpath(fx:number,fy:number,tx:number,ty:number){ return [{x:tx,y:fy},{x:tx,y:ty}]; }
function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)); }

function confRingPos(n:number,T:number){
  const cx=(CONF_TX+CONF_TW/2)*T, cy=(CONF_TY+CONF_TH/2)*T;
  const rx=T*(CONF_TW/2+0.5), ry=T*(CONF_TH/2+0.5);
  return Array.from({length:n},(_,i)=>{
    const a=(i/n)*Math.PI*2-Math.PI/2;
    return { x:cx+Math.cos(a)*rx, y:cy+Math.sin(a)*ry };
  });
}
function mkBurst(x:number,y:number,color:string){
  return Array.from({length:12},(_,i)=>{
    const a=(i/12)*Math.PI*2, spd=2.5+Math.random()*3;
    return {x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-1.5,color,age:0,maxAge:50+Math.random()*20,size:4+Math.random()*3};
  });
}

// ─── localStorage ─────────────────────────────────────────────────────────────
const LS_KEY="agentoffice_v2";
function loadMemory(){ try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return {};} }
function saveMemory(agents:any[]){
  try{
    const m:any={};
    agents.forEach(ag=>{m[ag.id]={tasksCompleted:ag.tasksCompleted,meetingsAttended:ag.meetingsAttended,timeWorking:ag.timeWorking,timeMeeting:ag.timeMeeting,taskHistory:ag.taskHistory};});
    localStorage.setItem(LS_KEY,JSON.stringify(m));
  }catch(e){}
}

function initAgents(T:number, activeIds:string[]){
  const mem=loadMemory();
  return ALL_AGENTS.map(a=>{
    const isActive=activeIds.includes(a.id);
    const posMap:any=isActive?DESK_POS:BENCH_POS;
    const tp=posMap[a.id]||{tx:2,ty:STANCHION_R+0.8};
    const orch=(a.id===ORCHESTRATOR_ID);
    const {x,y}=tileCenterPx(tp.tx+(orch?1.1:0.75), tp.ty+(orch?1.0:0.85), T);
    const saved:any=mem[a.id]||{};
    return {...a,
      active:isActive, spawning:false, spawnAge:0,
      state:"idle",task:null,progress:0,
      px:x,py:y,waypoints:[],deskX:x,deskY:y,
      facing:"down",animTick:0,idleCooldown:0,
      taskHistory:saved.taskHistory||[],
      monologue:null,
      timeWorking:saved.timeWorking||0,
      timeIdle:0,
      timeMeeting:saved.timeMeeting||0,
      tasksCompleted:saved.tasksCompleted||0,
      meetingsAttended:saved.meetingsAttended||0,
      mood:88,
    };
  });
}

// ─── Audio ────────────────────────────────────────────────────────────────────
function createAudio(){
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
      playClick(){[0,100,200].forEach(d=>setTimeout(()=>note(700+Math.random()*400,0.04),d));},
      playComplete(){[523,659,784].forEach((f,i)=>setTimeout(()=>note(f,0.2,"sine",0.11),i*90));},
      playMeeting(){note(330,0.4,"sine",0.09);},
      playIncident(){[200,150,100].forEach((f,i)=>setTimeout(()=>note(f,0.3,"sawtooth",0.14),i*80));},
      playSpawn(){[440,554,659].forEach((f,i)=>setTimeout(()=>note(f,0.15,"sine",0.10),i*70));},
    };
  }catch(e){return null;}
}

// ─── Day/night ────────────────────────────────────────────────────────────────
function getDayNight(tick:number){ return 0.18+0.12*Math.sin((tick/7200)*Math.PI*2-Math.PI/2); }

// ─── Camera ───────────────────────────────────────────────────────────────────
function clampCam(cam:any,W:number,H:number){
  if(cam.z<=cam.minZ){cam.x=0;cam.y=0;return;}
  cam.x=clamp(cam.x,W*(1-cam.z),0);
  cam.y=clamp(cam.y,H*(1-cam.z),0);
}
function applyCamera(ctx:CanvasRenderingContext2D,cam:any){ctx.translate(cam.x,cam.y);ctx.scale(cam.z,cam.z);}

// ─── Draw floor ───────────────────────────────────────────────────────────────
function drawFloor(ctx:CanvasRenderingContext2D,T:number,cam:any,darkAlpha:number,incidentActive:boolean){
  ctx.save();applyCamera(ctx,cam);
  for(let r=0;r<MAP_ROWS;r++) for(let c=0;c<MAP_COLS;c++){
    const hold=r>STANCHION_R;
    ctx.fillStyle=hold?((c+r)%2===0?"#0d0d1a":"#0f0f22"):((c+r)%2===0?"#11111e":"#13132a");
    ctx.fillRect(c*T,r*T,T,T);
  }
  ctx.strokeStyle="#1c1c38";ctx.lineWidth=0.5;
  for(let c=0;c<=MAP_COLS;c++){ctx.beginPath();ctx.moveTo(c*T,0);ctx.lineTo(c*T,MAP_ROWS*T);ctx.stroke();}
  for(let r=0;r<=MAP_ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*T);ctx.lineTo(MAP_COLS*T,r*T);ctx.stroke();}
  ctx.fillStyle="#080814";
  ctx.fillRect(0,0,MAP_COLS*T,5);ctx.fillRect(0,0,5,STANCHION_R*T);ctx.fillRect(MAP_COLS*T-5,0,5,STANCHION_R*T);
  [ROW_Y[1],ROW_Y[2],ROW_Y[3]].forEach(ry=>{
    ctx.fillStyle="#0e0e1e";ctx.fillRect(0,(ry-0.15)*T,MAP_COLS*T,T*0.25);
  });
  if(darkAlpha>0.03){ctx.fillStyle=`rgba(5,5,28,${darkAlpha})`;ctx.fillRect(0,0,MAP_COLS*T,STANCHION_R*T);}
  if(incidentActive){ctx.fillStyle=`rgba(255,40,40,${0.05+0.03*Math.sin(Date.now()*0.008)})`;ctx.fillRect(0,0,MAP_COLS*T,STANCHION_R*T);}
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
  ctx.fillStyle="#242450";ctx.textAlign="center";
  ctx.fillText("— HOLDING AREA —",MAP_COLS*T/2,STANCHION_R*T+T*0.88);
  ctx.restore();
}

// ─── Draw furniture ───────────────────────────────────────────────────────────
function drawFurniture(ctx:CanvasRenderingContext2D,T:number,cam:any,agents:any[],now:number,activeMeeting:boolean,topic:string|null,darkAlpha:number,incidentActive:boolean,critPairs:any[],showDepGraph:boolean){
  ctx.save();applyCamera(ctx,cam);

  // ── Dependency graph overlay ──
  if(showDepGraph){
    Object.entries(DEPENDENCIES).forEach(([srcId,dstIds])=>{
      const src=agents.find(a=>a.id===srcId); if(!src||!src.active) return;
      dstIds.forEach(dstId=>{
        const dst=agents.find(a=>a.id===dstId); if(!dst||!dst.active) return;
        const fired=critPairs.find(([s,d]:any)=>s===srcId&&d===dstId);
        ctx.strokeStyle=fired?"#FDCB6Ecc":src.color+"44";
        ctx.lineWidth=fired?T*0.04:T*0.02;
        ctx.setLineDash(fired?[]:[T*0.08,T*0.06]);
        ctx.beginPath();ctx.moveTo(src.px,src.py);ctx.lineTo(dst.px,dst.py);ctx.stroke();
        ctx.setLineDash([]);
        const angle=Math.atan2(dst.py-src.py,dst.px-src.px);
        const ax=dst.px-Math.cos(angle)*T*0.35,ay=dst.py-Math.sin(angle)*T*0.35;
        ctx.fillStyle=fired?"#FDCB6E":src.color+"88";
        ctx.beginPath();ctx.moveTo(ax,ay);
        ctx.lineTo(ax-Math.cos(angle-0.4)*T*0.18,ay-Math.sin(angle-0.4)*T*0.18);
        ctx.lineTo(ax-Math.cos(angle+0.4)*T*0.18,ay-Math.sin(angle+0.4)*T*0.18);
        ctx.closePath();ctx.fill();
      });
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
  const orchAg=agents.find(a=>a.id===ORCHESTRATOR_ID);
  {
    const x=ORCH_TX*T, y=ORCH_TY*T, dw=T*2.2, dh=T*2.0;
    const working=orchAg?.state==="working";
    const mood=(orchAg?.mood||88)/100;
    ctx.beginPath();ctx.roundRect(x-T*0.06,y-T*0.06,dw+T*0.12,dh+T*0.12,T*0.12);
    ctx.strokeStyle=(orchAg?.color||"#6C5CE7")+"55";ctx.lineWidth=T*0.05;ctx.stroke();
    ctx.fillStyle="#201a40";
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
      ctx.fillStyle="#ffffff08";ctx.fillRect(mx2+dw*0.04,my2+dh*0.12,mw*0.6,dh*0.05);
      if(Math.floor(now*0.002)%2===0){
        ctx.fillStyle=(orchAg?.color||"#6C5CE7")+"33";ctx.fillRect(mx2+dw*0.04,my2+dh*0.26,dh*0.06,dh*0.06);
      }
      ctx.font=`bold ${Math.round(T*0.13)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
      ctx.fillStyle="#1e1e40";ctx.fillText("STANDBY",x+dw/2,my2+mh*0.72);
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
  ACTIVE_IDS.filter(id=>id!==ORCHESTRATOR_ID).forEach(id=>{
    const dp=DESK_POS[id]; if(!dp) return;
    const ag=agents.find(a=>a.id===id); if(!ag) return;
    const x=dp.tx*T, y=dp.ty*T, dw=T*1.5, dh=T*1.7;
    const working=ag.state==="working";
    const mood=(ag.mood||88)/100;
    ctx.fillStyle="#17172e";
    ctx.strokeStyle=working?ag.color+Math.round(80+mood*120).toString(16).padStart(2,"0"):(incidentActive?"#ff333344":"#222244");
    ctx.lineWidth=working?T*0.022:T*0.01;
    ctx.beginPath();ctx.roundRect(x+T*0.05,y+T*0.05,dw-T*0.1,dh-T*0.1,T*0.08);ctx.fill();ctx.stroke();
    const mx2=x+dw*0.12,my2=y+dh*0.1,mw=dw*0.76,mh=dh*0.58;
    ctx.fillStyle="#090918";ctx.fillRect(mx2,my2,mw,mh);
    ctx.strokeStyle=working?ag.color+"cc":incidentActive?"#ff222233":"#252550";ctx.lineWidth=T*0.014;ctx.strokeRect(mx2,my2,mw,mh);
    if(working){
      const t2=now*0.001;
      for(let l=0;l<3;l++){
        const al=0.18+0.28*Math.sin(t2*2+l*1.2);
        ctx.fillStyle=ag.color+Math.round(al*255).toString(16).padStart(2,"0");
        ctx.fillRect(mx2+dw*0.04,my2+dh*0.08+l*(mh/3.5),mw*(0.3+0.45*((l+Math.floor(t2))%2))*mood,dh*0.09);
      }
      if(darkAlpha>0.05){ctx.shadowColor=ag.color;ctx.shadowBlur=T*0.25*darkAlpha;ctx.strokeStyle=ag.color+"22";ctx.strokeRect(mx2,my2,mw,mh);ctx.shadowBlur=0;}
    } else {
      // Idle monitor — show status indicator
      ctx.fillStyle="#ffffff08";ctx.fillRect(mx2+dw*0.04,my2+dh*0.12,mw*0.5,dh*0.06);
      // Blinking cursor
      if(Math.floor(now*0.002)%2===0){
        ctx.fillStyle=ag.color+"33";ctx.fillRect(mx2+dw*0.04,my2+dh*0.28,dh*0.06,dh*0.06);
      }
      // "IDLE" text on screen
      ctx.font=`bold ${Math.round(T*0.11)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
      ctx.fillStyle="#1e1e40";ctx.fillText("IDLE",x+dw/2,my2+mh*0.75);
    }
    ctx.fillStyle="#111122";
    ctx.fillRect(x+dw/2-T*0.04,y+dh*0.75,T*0.08,dh*0.13);
    ctx.fillRect(x+dw/2-T*0.12,y+dh*0.87,T*0.24,T*0.055);
  });

  // ── Empty row 3 desks (dimmed, no agents) ──
  EMPTY_DESK_POS.forEach(({tx,ty})=>{
    const x=tx*T, y=ty*T, dw=T*1.5, dh=T*1.7;
    ctx.fillStyle="#0f0f1c";
    ctx.strokeStyle="#181830";
    ctx.lineWidth=T*0.008;
    ctx.beginPath();ctx.roundRect(x+T*0.05,y+T*0.05,dw-T*0.1,dh-T*0.1,T*0.08);ctx.fill();ctx.stroke();
    const mx2=x+dw*0.12,my2=y+dh*0.1,mw=dw*0.76,mh=dh*0.58;
    ctx.fillStyle="#060610";ctx.fillRect(mx2,my2,mw,mh);
    ctx.strokeStyle="#131328";ctx.lineWidth=T*0.012;ctx.strokeRect(mx2,my2,mw,mh);
    ctx.font=`${Math.round(T*0.14)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
    ctx.fillStyle="#1a1a35";ctx.fillText("—",x+dw/2,y+dh*0.55);
  });

  // ── Conference table ──
  const tcx=CONF_TX*T, tcy=CONF_TY*T, tw=CONF_TW*T, th=CONF_TH*T;
  ctx.fillStyle="#1b1830";
  ctx.strokeStyle=activeMeeting?"#FDCB6Ecc":incidentActive?"#ff3333aa":"#282848";
  ctx.lineWidth=activeMeeting?T*0.028:T*0.014;
  ctx.beginPath();ctx.roundRect(tcx,tcy,tw,th,T*0.2);ctx.fill();ctx.stroke();
  ctx.strokeStyle=activeMeeting?"#FDCB6E22":"#ffffff05";ctx.lineWidth=T*0.01;
  ctx.beginPath();ctx.roundRect(tcx+T*0.1,tcy+T*0.1,tw-T*0.2,th-T*0.2,T*0.15);ctx.stroke();
  const chairW=T*0.2,chairH=T*0.13;
  [[0.1,-.15],[0.28,-.15],[0.46,-.15],[0.64,-.15],[0.82,-.15],
   [0.1,1.04],[0.28,1.04],[0.46,1.04],[0.64,1.04],[0.82,1.04],
   [-.14,0.25],[-.14,0.62],[1.04,0.25],[1.04,0.62]
  ].forEach(([fx,fy])=>{
    ctx.fillStyle="#1c1c3a";ctx.strokeStyle="#252545";ctx.lineWidth=T*0.01;
    ctx.beginPath();ctx.roundRect(tcx+tw*fx-chairW/2,tcy+th*fy-chairH/2,chairW,chairH,T*0.04);ctx.fill();ctx.stroke();
    ctx.fillStyle="#222240";ctx.fillRect(tcx+tw*fx-chairW/2+T*0.02,tcy+th*fy-chairH/2+T*0.025,chairW-T*0.04,chairH*0.38);
  });
  if(activeMeeting&&darkAlpha>0.04){ctx.shadowColor="#FDCB6E";ctx.shadowBlur=T*0.3*darkAlpha;ctx.strokeStyle="#FDCB6E33";ctx.lineWidth=T*0.025;ctx.beginPath();ctx.roundRect(tcx,tcy,tw,th,T*0.2);ctx.stroke();ctx.shadowBlur=0;}
  ctx.font=`bold ${Math.round(T*0.15)}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
  if(activeMeeting&&topic){ctx.fillStyle="#FDCB6E";ctx.fillText("⬡ "+topic,tcx+tw/2,tcy+th+T*0.3);}
  else if(incidentActive){ctx.fillStyle="#ff4444";ctx.fillText("🚨 INCIDENT",tcx+tw/2,tcy+th+T*0.3);}
  else{ctx.fillStyle="#252550";ctx.fillText("Conference Table",tcx+tw/2,tcy+th+T*0.3);}

  ctx.restore();
}

function drawChatBubbles(ctx:CanvasRenderingContext2D,bubbles:any[],T:number,cam:any){
  ctx.save();applyCamera(ctx,cam);
  bubbles.forEach(b=>{
    const alpha=Math.min(1,b.age/15)*Math.max(0,1-(b.age-b.maxAge*0.55)/(b.maxAge*0.45));
    if(alpha<=0) return;
    ctx.globalAlpha=Math.max(0,alpha);
    const fPx=Math.round(T*0.115);
    ctx.font=`${fPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
    const tw2=ctx.measureText(b.text).width+T*0.18,th2=fPx*1.55;
    ctx.fillStyle="#1a1a3aee";ctx.strokeStyle=b.color+"77";ctx.lineWidth=T*0.01;
    ctx.beginPath();ctx.roundRect(b.x-tw2/2,b.y-th2,tw2,th2,T*0.04);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(b.x-T*0.055,b.y);ctx.lineTo(b.x+T*0.055,b.y);ctx.lineTo(b.x,b.y+T*0.075);
    ctx.fillStyle="#1a1a3aee";ctx.fill();
    ctx.fillStyle=b.color;ctx.fillText(b.text,b.x,b.y-th2*0.28);
  });
  ctx.globalAlpha=1;ctx.restore();
}

function drawParticles(ctx:CanvasRenderingContext2D,particles:any[],cam:any){
  ctx.save();applyCamera(ctx,cam);
  particles.forEach(p=>{
    const alpha=Math.max(0,1-p.age/p.maxAge);
    ctx.globalAlpha=alpha;ctx.fillStyle=p.color;
    ctx.beginPath();ctx.arc(p.x,p.y,p.size*alpha,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;ctx.restore();
}

function drawAgent(ctx:CanvasRenderingContext2D,ag:any,T:number,now:number,cam:any,isSelected:boolean,darkAlpha:number,incidentActive:boolean){
  const visible=ag.active||BENCH_POS[ag.id];
  if(!visible) return;
  ctx.save();applyCamera(ctx,cam);
  const {px,py,color,name,state,task,progress,facing,mood,active}=ag;
  const isOrch=ag.id===ORCHESTRATOR_ID;
  const sz=isOrch?T*0.78:T*0.58, hs=sz/2;
  const moodN=(mood||88)/100;
  const moving=state==="moving_to_meeting"||state==="returning";
  const isInc=incidentActive&&(state==="moving_to_meeting"||state==="meeting");

  if(ag.spawning){
    const sf=Math.min(1,ag.spawnAge/30);
    ctx.globalAlpha=sf;
    ctx.beginPath();ctx.arc(px,py,sz*(1.5-sf*0.5),0,Math.PI*2);
    ctx.fillStyle=color+"44";ctx.fill();
  }

  const bob=state==="idle"?Math.sin(now*0.003+ag.animTick*0.12)*T*0.018*moodN:0;
  const runBob=moving?Math.abs(Math.sin(now*0.013))*T*0.03-T*0.01:0;
  const dy2=bob+runBob;
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
  const bodyCol=isInc?"#ff2222":(active?color+bA:"#3a3a5e"+bA);
  if(darkAlpha>0.05){ctx.shadowColor=isInc?"#ff2222":color;ctx.shadowBlur=sz*0.22*darkAlpha;}
  ctx.fillStyle=bodyCol;ctx.fillRect(px-hs+ox,py-hs+dy2+oy,sz,sz);ctx.shadowBlur=0;
  const fw=sz*0.44,fh=sz*0.31;
  ctx.fillStyle="#ffffffdd";ctx.fillRect(px-fw/2+ox,py-sz*0.17+dy2+oy,fw,fh);
  ctx.fillStyle="#111";
  if(facing!=="up"){
    ctx.fillRect(px-fw*0.34+ox,py-sz*0.09+dy2+oy,fw*0.14,fh*0.3);
    ctx.fillRect(px+fw*0.2+ox, py-sz*0.09+dy2+oy,fw*0.14,fh*0.3);
    ctx.beginPath();ctx.arc(px+ox,py+sz*0.08+dy2+oy,fw*0.17,0.1*Math.PI,0.9*Math.PI);
    ctx.strokeStyle="#111";ctx.lineWidth=sz*0.04;ctx.stroke();
  }
  ctx.fillStyle=isInc?"#ff2222":color;ctx.fillRect(px-hs+ox,py-hs+dy2+oy,sz,sz*0.18);
  if(moving){
    const sw=Math.sin(now*0.016)*sz*0.17;
    ctx.fillStyle=(isInc?"#ff2222":color)+"88";
    ctx.fillRect(px-sz*0.21+ox+sw,py+sz*0.37+oy,sz*0.19,sz*0.27);
    ctx.fillRect(px+sz*0.02+ox-sw, py+sz*0.37+oy,sz*0.19,sz*0.27);
  }
  const dotC=isInc?"#ff3333":state==="working"?"#00ff88":(state==="meeting"||state==="moving_to_meeting")?"#FDCB6E":active?"#4a5568":"#2a2a4a";
  ctx.beginPath();ctx.arc(px+hs-sz*0.1+ox,py-hs+sz*0.1+dy2+oy,sz*0.1,0,Math.PI*2);
  ctx.fillStyle=dotC;ctx.fill();ctx.strokeStyle="#0b0b14";ctx.lineWidth=sz*0.035;ctx.stroke();

  const nPx=Math.max(10,Math.round(T*0.13));
  ctx.font=`bold ${nPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
  const nlW=ctx.measureText(name).width+T*0.14,nlH=nPx*1.6,nlY=py+hs+T*0.05+dy2+oy;
  ctx.fillStyle="#0a0a14dd";ctx.strokeStyle=(active?color:"#6a6a8e")+"99";ctx.lineWidth=sz*0.04;
  ctx.beginPath();ctx.roundRect(px-nlW/2,nlY,nlW,nlH,T*0.03);ctx.fill();ctx.stroke();
  ctx.fillStyle=active?color:"#6a6a8e";ctx.fillText(name,px,nlY+nlH*0.72);

  if(state==="working"&&task){
    const tPx=Math.max(11,Math.round(T*0.19));
    ctx.font=`bold ${tPx}px 'IBM Plex Mono',monospace`;
    const short=task.length>26?task.slice(0,25)+"…":task;
    const tlW=ctx.measureText(short).width+T*0.20,tlH=tPx*1.8;
    const tlY=py-hs-tlH-T*0.10+dy2+oy;
    ctx.fillStyle="#0b0b1ff0";ctx.strokeStyle=color+"88";ctx.lineWidth=T*0.016;
    ctx.beginPath();ctx.roundRect(px-tlW/2,tlY,tlW,tlH,T*0.04);ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.fillText(short,px,tlY+tlH*0.73);
    const bW=Math.max(tlW,nlW),bH=T*0.055,bY=nlY+nlH+T*0.025;
    ctx.fillStyle="#151528";ctx.fillRect(px-bW/2,bY,bW,bH);
    ctx.fillStyle=color;ctx.fillRect(px-bW/2,bY,bW*(progress/100),bH);
  }
  if(ag.monologue&&state==="working"){
    const mPx=Math.max(9,Math.round(T*0.10));
    ctx.font=`${mPx}px 'IBM Plex Mono',monospace`;ctx.textAlign="center";
    const mW=ctx.measureText(ag.monologue).width+T*0.12,mH=mPx*1.6;
    const taskH=task?Math.max(11,Math.round(T*0.19))*1.8+T*0.10:0;
    const mY=py-hs-taskH-mH-T*0.2+dy2+oy;
    ctx.fillStyle="#0f0f22ee";ctx.strokeStyle="#3a3a6a";ctx.lineWidth=T*0.01;
    ctx.beginPath();ctx.roundRect(px-mW/2,mY,mW,mH,T*0.03);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(px-T*0.04,mY+mH);ctx.lineTo(px+T*0.04,mY+mH);ctx.lineTo(px,mY+mH+T*0.06);
    ctx.fillStyle="#0f0f22ee";ctx.fill();ctx.fillStyle="#8892b0";ctx.fillText(ag.monologue,px,mY+mH*0.76);
  }
  if(state==="meeting"){
    for(let b=0;b<3;b++){
      const phase=((now*0.0014+b*0.42)%1),alpha=Math.sin(phase*Math.PI)*0.9;
      ctx.beginPath();ctx.arc(px+sz*0.5+b*sz*0.22+ox,py-hs-T*0.05-phase*T*0.26+dy2+oy,(sz*0.1-b*sz*0.02),0,Math.PI*2);
      ctx.fillStyle=isInc?`rgba(255,80,80,${alpha})`:`rgba(253,203,110,${alpha})`;ctx.fill();
    }
  }
  ctx.globalAlpha=1;ctx.restore();
}

function drawMinimap(ctx:CanvasRenderingContext2D,T:number,agents:any[],cam:any,canvasW:number,canvasH:number,showLegend:boolean){
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
  Object.entries(DESK_POS).forEach(([id,{tx,ty}])=>{
    const ag=ALL_AGENTS.find(a=>a.id===id);if(!ag) return;
    ctx.fillStyle=ag.color+"33";
    ctx.fillRect(mmX+tx*T*sx,mmY+ty*T*sy,T*sx*1.5,T*sy*1.7);
  });
  agents.forEach(a=>{
    const ax=mmX+a.px*sx,ay=mmY+a.py*sy,r=Math.max(2,3);
    ctx.beginPath();ctx.arc(ax,ay,r,0,Math.PI*2);
    ctx.fillStyle=a.state==="working"?"#00ff88":a.state==="meeting"||a.state==="moving_to_meeting"?"#FDCB6E":a.active?a.color:"#4a4a6a";
    ctx.fill();ctx.strokeStyle="#000";ctx.lineWidth=0.5;ctx.stroke();
  });
  const vx=mmX+(-cam.x/cam.z)*sx,vy=mmY+(-cam.y/cam.z)*sy;
  const vw=(canvasW/cam.z)*sx,vh=(canvasH/cam.z)*sy;
  ctx.strokeStyle="#ffffff44";ctx.lineWidth=1;ctx.setLineDash([]);
  ctx.strokeRect(Math.max(mmX,vx),Math.max(mmY,vy),Math.min(mw,vw),Math.min(mh,vh));
  ctx.font="9px 'IBM Plex Mono',monospace";ctx.fillStyle="#3a3a5e";ctx.textAlign="center";
  ctx.fillText("MAP",mmX+mw/2,mmY-4);

  if(showLegend){
    const items=[["#00ff88","Working"],["#FDCB6E","Meeting"],["#4a5568","Idle"]];
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

function captureFrame(agents:any[],simTick:number){
  return {tick:simTick,agents:agents.map(a=>({id:a.id,px:a.px,py:a.py,state:a.state,task:a.task,progress:Math.round(a.progress)}))};
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AgentOffice(){
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const simRef         = useRef<any>(null);
  const animRef        = useRef<any>(null);
  const feedRef        = useRef<HTMLDivElement>(null);
  const pausedRef      = useRef(false);
  const soundRef       = useRef(true);
  const audioRef       = useRef<any>(null);
  const camRef         = useRef({x:0,y:0,z:1,drag:false,ds:null as any,cs:null as any,minZ:1});
  const tileRef        = useRef(0);
  const feedIdRef      = useRef(1);
  const totalDone      = useRef(0);
  const meetingLogsRef = useRef<any[]>([]);
  const meetingRef     = useRef<any>(null); // current meeting state for cross-useEffect access
  const activeIdsRef   = useRef([...ACTIVE_IDS]);
  const chatBubbles    = useRef<any[]>([]);
  const minimapRef     = useRef(true);
  const depGraphRef    = useRef(false);
  const showLegendRef  = useRef(true);
  const replayFrames   = useRef<any[]>([]);
  const replayModeRef  = useRef(false);
  const replayCurRef   = useRef(0);
  const dialogueRef    = useRef<any[]>([]);

  const [feed,setFeed]               = useState<any[]>([{id:0,ts:nowts(),text:"KAOS agents online. 24/7/365.",color:"#00ff88"}]);
  const [roster,setRoster]           = useState<any[]>([]);
  const [paused,setPaused]           = useState(false);
  const [stats,setStats]             = useState({working:0,meeting:0,idle:0,completed:0});
  const [selectedId,setSelectedId]   = useState<string|null>(null);
  const [detail,setDetail]           = useState<any>(null);
  const [toasts,setToasts]           = useState<any[]>([]);
  const [tab,setTab]                 = useState("roster");
  const [meetingLogs,setMeetingLogs] = useState<any[]>([]);
  const [soundOn,setSoundOn]         = useState(true);
  const [incident,setIncident]       = useState<any>(null);
  const [showConfig,setShowConfig]   = useState(false);
  const [configAgent,setConfigAgent] = useState<any>(null);
  const [configEdits,setConfigEdits] = useState<any>({});
  const [leaderboard,setLeaderboard] = useState<any[]>([]);
  const [showMinimap,setShowMinimap] = useState(true);
  const [showDepGraph,setShowDepGraph] = useState(false);
  const [replayMode,setReplayMode]   = useState(false);
  const [replayPos,setReplayPos]     = useState(0);
  const [replayLen,setReplayLen]     = useState(0);
  const [dialogue,setDialogue]       = useState<any[]>([]);
  const [timeline,setTimeline]       = useState<any[]>([]);
  const timelineRef                  = useRef<any[]>([]);
  const [showOrchPanel,setShowOrchPanel] = useState(false);
  const [nlInput,setNlInput]         = useState("");
  const [nlLoading,setNlLoading]     = useState(false);
  const [showLegend,setShowLegend]   = useState(true);
  const [waterfall,setWaterfall]     = useState<any[]>([]);
  const waterfallRef                 = useRef<any[]>([]);
  const [ctxMenu,setCtxMenu]         = useState<any>(null);
  const [showSettings,setShowSettings] = useState(false);
  const [sessionLog,setSessionLog] = useState<any[]>([]);
  const [loadingLog,setLoadingLog] = useState(false);

  const addToast=useCallback((text:string,color="#00ff88")=>{
    const id=feedIdRef.current++;
    setToasts(t=>{const next=[...t,{id,text,color}];return next.length>5?next.slice(next.length-5):next;});
    setTimeout(()=>setToasts(t=>t.filter((x:any)=>x.id!==id)),3000);
  },[]);
  const addFeed=useCallback((text:string,color="#8892b0")=>{
    setFeed(p=>[...p,{id:feedIdRef.current++,ts:nowts(),text,color}].slice(-80));
  },[]);

  useEffect(()=>{ if(feedRef.current) feedRef.current.scrollTop=feedRef.current.scrollHeight; },[feed]);
  useEffect(()=>{const i=()=>{if(!audioRef.current)audioRef.current=createAudio();};window.addEventListener("click",i,{once:true});return()=>window.removeEventListener("click",i);},[]);
  useEffect(()=>()=>{if(simRef.current?.agents)saveMemory(simRef.current.agents);},[]);

  useEffect(()=>{minimapRef.current=showMinimap;},[showMinimap]);
  useEffect(()=>{depGraphRef.current=showDepGraph;},[showDepGraph]);
  useEffect(()=>{showLegendRef.current=showLegend;},[showLegend]);
  useEffect(()=>{replayModeRef.current=replayMode;},[replayMode]);

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

        agents.forEach((ag:any)=>{
          if(!ag.active) return;
          const prev=prevStates[ag.id]||"idle";
          const rawTask=taskMap[ag.id]||"";
          // Parse OpenClaw status strings
          const lower=rawTask.toLowerCase();
          const isActive=lower.startsWith("active")||lower.startsWith("working")||lower.startsWith("running");
          // Clean the description: "Active on Telegram · 53.5k tokens" → "Processing session"
          // "Active on webchat · 12k tokens" → "Processing session"
          let taskDesc:string|null=null;
          if(isActive){
            const channel=rawTask.match(/on (\w+)/)?.[1]||"";
            if(channel) taskDesc=`Working via ${channel}`;
            else taskDesc="Processing";
          }

          if(isActive&&taskDesc){
            if(ag.state!=="working"){
              // Transition: idle → working
              ag.state="working";
              ag.task=taskDesc;
              ag.progress=5;
              ag.monologue=null;
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
        if(kaosWorking&&othersWorking.length>=1&&!meetingRef.current){
          const topic=othersWorking.length>1?"Full Team Sync":`${kaosWorking.name} + ${othersWorking[0].name}`;
          meetingRef.current={topic,agents:[kaosWorking.id,...othersWorking.map((a:any)=>a.id)],startTs:nowts()};
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
          setMeetingLogs([...meetingLogsRef.current]);
          meetingRef.current=null;
        }

      }catch(e){}
    };
    poll(); // Initial poll immediately
    const interval=setInterval(poll,5000);
    return()=>clearInterval(interval);
  },[addFeed,addToast]);

  // ── OPENCLAW_STATE postMessage listener ──────────────────────────────────
  useEffect(()=>{
    const handler=(event:MessageEvent)=>{
      if(event.data?.type==='OPENCLAW_STATE'&&simRef.current?.agents){
        const{agents:stateAgents}=event.data;
        if(!stateAgents) return;
        stateAgents.forEach((real:any)=>{
          const ag=simRef.current.agents.find((a:any)=>a.id===real.id);
          if(!ag) return;
          if(real.currentTask){ag.state='working';ag.task=real.currentTask;}
          if(real.state==='idle'&&ag.state!=='working'&&ag.state!=='meeting'&&ag.state!=='moving_to_meeting'){ag.state='idle';}
        });
      }
    };
    window.addEventListener('message',handler);
    return()=>window.removeEventListener('message',handler);
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
        case"o":case"O":setShowOrchPanel(p=>!p);break;
        case"t":case"T":setTab(t=>t==="roster"?"meetings":t==="meetings"?"board":"roster");break;
        case"Escape":setSelectedId(null);setDetail(null);setShowOrchPanel(false);setShowConfig(false);setShowSettings(false);break;
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
        setRoster(agents.map(a=>({...a})));
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
        const dep=agents.find(a=>a.id===depId&&a.active);
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
      const active=agents?.filter(a=>a.active&&a.state==="working");
      if(!active||active.length<2) return;
      const sender=active[Math.floor(Math.random()*active.length)];
      const receiver=active.filter(a=>a.id!==sender.id)[Math.floor(Math.random()*(active.length-1))];
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

        // Mood based on real performance: working = energized, idle long = neutral
        if(simTick%360===0) agents.forEach(ag=>{
          if(ag.state==="working") ag.mood=Math.min(100,(ag.mood||88)+2); // Working boosts mood
          else if(ag.tasksCompleted>0) ag.mood=Math.max(80,Math.min(95,(ag.mood||88)-0.3)); // Idle but productive = stable
          else ag.mood=Math.max(70,(ag.mood||88)-0.5); // Never worked = slowly drops to neutral
        });

        agents.forEach(ag=>{
          ag.animTick++;
          if(ag.idleCooldown>0)ag.idleCooldown--;
          if(ag.state==="working")ag.timeWorking++;
          else if(ag.state==="meeting")ag.timeMeeting++;
          if(ag.spawning){ag.spawnAge++;if(ag.spawnAge>45)ag.spawning=false;}
        });

        agents.forEach(ag=>{
          if(ag.state==="moving_to_meeting"){if(stepAgent(ag,dt)){ag.state="meeting";ag.facing="down";}}
          else if(ag.state==="returning"){if(stepAgent(ag,dt)){ag.state="idle";ag.facing="down";}}
        });

        particles.forEach(p=>{p.age++;p.x+=p.vx*0.93;p.y+=p.vy*0.93;p.vy+=0.07;});
        for(let i=particles.length-1;i>=0;i--)if(particles[i].age>=particles[i].maxAge)particles.splice(i,1);
        chatBubbles.current.forEach((b:any)=>{b.age++;b.life=Math.min(1,b.age/15);});
        for(let i=chatBubbles.current.length-1;i>=0;i--)if(chatBubbles.current[i].age>=chatBubbles.current[i].maxAge)chatBubbles.current.splice(i,1);

        // ── Real-data only: no random simulation ──
        // Progress ticks for agents that are working (driven by real data via polling)
        if(simTick%90===0){
          agents.filter(a=>a.active&&a.state==="working").forEach(ag=>{
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
            agents.forEach(ag=>{if(incidentData.victims.includes(ag.id)&&(ag.state==="meeting"||ag.state==="moving_to_meeting")){ag.state="returning";ag.waypoints=lpath(ag.px,ag.py,ag.deskX,ag.deskY);}});
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
            agents.forEach(ag=>{if(concluded.agents.includes(ag.id)&&(ag.state==="meeting"||ag.state==="moving_to_meeting")){ag.state="returning";ag.waypoints=lpath(ag.px,ag.py,ag.deskX,ag.deskY);}});
            meeting=null;
            const attendees=agents.filter(a=>concluded.agents.includes(a.id));
            const summary=MEETING_SUMMARIES[concluded.topic]||"• Discussed key topics\n• Assigned action items\n• Set follow-up timeline";
            const e={id:feedIdRef.current++,topic:concluded.topic,ts:concluded.startTs,attendees:attendees.map(a=>a.name),summary};
            meetingLogsRef.current=[e,...meetingLogsRef.current].slice(0,20);
            setMeetingLogs([...meetingLogsRef.current]);
          }
        }

        if(simTick%300===0){
          const board=agents.filter(a=>a.active).map(a=>{
            const total=a.timeWorking+a.timeMeeting||1;
            const eff=Math.round((a.timeWorking/total)*100);
            return{id:a.id,name:a.name,emoji:a.emoji,color:a.color,tasksCompleted:a.tasksCompleted,efficiency:eff,mood:Math.round(a.mood||88)};
          }).sort((a,b)=>b.tasksCompleted-a.tasksCompleted||b.efficiency-a.efficiency);
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

      let drawAgentsArr=agents;
      if(replayModeRef.current&&replayFrames.current.length){
        const idx=Math.min(replayCurRef.current,replayFrames.current.length-1);
        const frame=replayFrames.current[idx];
        if(frame){
          drawAgentsArr=agents.map(ag=>{
            const fa=frame.agents.find((a:any)=>a.id===ag.id);
            return fa?{...ag,px:fa.px,py:fa.py,state:fa.state,task:fa.task,progress:fa.progress}:ag;
          });
        }
      }

      ctx.clearRect(0,0,W,H);
      const darkAlpha=getDayNight(simTick);
      drawFloor(ctx,T2,cam,darkAlpha,!!incidentData);
      drawFurniture(ctx,T2,cam,drawAgentsArr,now,!!meeting,meeting?.topic,darkAlpha,!!incidentData,critPairs,depGraphRef.current);
      drawParticles(ctx,particles,cam);
      drawChatBubbles(ctx,chatBubbles.current,T2,cam);
      drawAgentsArr.forEach((ag:any)=>drawAgent(ctx,ag,T2,now,cam,ag.id===selectedId,darkAlpha,!!incidentData));
      if(minimapRef.current)drawMinimap(ctx,T2,drawAgentsArr,cam,W,H,showLegendRef.current);

      if(simTick%10===0){
        const snap=agents.map(ag=>({...ag,progress:Math.round(ag.progress),taskHistory:[...(ag.taskHistory||[])]}));
        setRoster(snap);
        setStats({working:snap.filter(a=>a.active&&a.state==="working").length,
          meeting:snap.filter(a=>a.active&&(a.state==="meeting"||a.state==="moving_to_meeting")).length,
          idle:snap.filter(a=>a.active&&(a.state==="idle"||a.state==="returning")).length,
          completed:totalDone.current});
        setDetail((prev:any)=>prev?snap.find(a=>a.id===prev.id)||prev:null);
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
    function onMove(e:MouseEvent){const cam=camRef.current;if(!cam.drag)return;const p=c2w(e);cam.x=cam.cs.x+(p.x-cam.ds.x);cam.y=cam.cs.y+(p.y-cam.ds.y);clampCam(cam,canvas!.width,canvas!.height);}
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
            setTab("roster");
            if(best.id===ORCHESTRATOR_ID)setShowOrchPanel((p:any)=>!p);
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
    canvas.addEventListener("wheel",onWheel,{passive:false});
    canvas.addEventListener("mousedown",onDown);
    canvas.addEventListener("contextmenu",onContextMenu);
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    canvas.style.cursor="grab";
    return()=>{canvas.removeEventListener("wheel",onWheel);canvas.removeEventListener("mousedown",onDown);canvas.removeEventListener("contextmenu",onContextMenu);window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[]);

  const promoteAgent=useCallback((agId:string)=>{
    if(activeIdsRef.current.includes(agId)) return;
    activeIdsRef.current=[...activeIdsRef.current,agId];
    if(simRef.current?.agents){
      const ag=simRef.current.agents.find((a:any)=>a.id===agId);if(!ag) return;
      ag.active=true;ag.spawning=true;ag.spawnAge=0;
      const T=tileRef.current;
      const freeTx=COL_X[0],freeTy=ROW_Y[3];
      const{x,y}=tileCenterPx(freeTx+0.5,freeTy+0.5,T);
      ag.deskX=x;ag.deskY=y;
      ag.waypoints=lpath(ag.px,ag.py,x,y);ag.state="moving_to_meeting";
      addFeed(`${ag.emoji} ${ag.name} deployed to office!`,ag.color);
      addToast(`${ag.emoji} ${ag.name} joined!`,ag.color);
      if(soundRef.current&&audioRef.current)audioRef.current.playSpawn();
      setTimeout(()=>{ag.state="idle";ag.px=x;ag.py=y;ag.waypoints=[];},3000);
    }
  },[addFeed,addToast]);

  const ctxAction=(action:string)=>{
    const ag=simRef.current?.agents?.find((a:any)=>a.id===ctxMenu?.agentId);
    if(!ag){setCtxMenu(null);return;}
    if(action==="task"&&ag.state==="idle"){
      const tasks=AGENT_TASKS[ag.id]||[];
      if(tasks.length){ag.state="working";ag.task=tasks[Math.floor(Math.random()*tasks.length)];ag.progress=0;addFeed(`⚡ ${ag.name} force-assigned task`,ag.color);}
    } else if(action==="complete"&&ag.state==="working"){
      ag.progress=99.9;
    } else if(action==="config"){
      openConfig(ag);
    }
    setCtxMenu(null);
  };

  const togglePause=()=>{pausedRef.current=!pausedRef.current;setPaused(p=>!p);};
  const toggleSound=()=>{soundRef.current=!soundRef.current;setSoundOn(s=>!s);};
  const toggleMinimap=()=>{minimapRef.current=!minimapRef.current;setShowMinimap(s=>!s);};
  const toggleDepGraph=()=>{depGraphRef.current=!depGraphRef.current;setShowDepGraph(s=>!s);};
  const openConfig=(ag:any)=>{setConfigAgent(ag);setConfigEdits({name:ag.name,color:ag.color,workBurst:ag.personality.workBurst,focusDuration:ag.personality.focusDuration});setShowConfig(true);};
  const saveConfig=()=>{
    if(!configAgent||!simRef.current?.agents) return;
    const ag=simRef.current.agents.find((a:any)=>a.id===configAgent.id);if(!ag) return;
    if(configEdits.name)ag.name=configEdits.name;
    if(configEdits.color)ag.color=configEdits.color;
    ag.personality={...ag.personality,workBurst:+configEdits.workBurst,focusDuration:+configEdits.focusDuration};
    setShowConfig(false);addFeed(`⚙ ${ag.name} config updated`,ag.color);
  };

  const dotColor=(a:any)=>a.state==="working"?"#00ff88":(a.state==="meeting"||a.state==="moving_to_meeting")?"#FDCB6E":"#3a3a5e";
  const stateLabel=(a:any)=>{if(a.state==="working")return(a.task||"Working").slice(0,26);if(a.state==="meeting")return"In meeting";if(a.state==="moving_to_meeting")return"→ Conference";if(a.state==="returning")return"← Returning";return a.active?a.role:"Bench";};
  const pct=(n:number,t:number)=>Math.round(n/Math.max(1,t)*100);
  const totalF=(a:any)=>(a.timeWorking||0)+(a.timeMeeting||0)+1;

  const benchAgents=roster.filter(a=>!a.active);
  const activeAgents=roster.filter(a=>a.active);
  const orchAgent=roster.find(a=>a.id===ORCHESTRATOR_ID);

  return (
    <div style={{height:"100%",minHeight:"600px",display:"flex",flexDirection:"column",background:"#060610",
      fontFamily:"'IBM Plex Mono','JetBrains Mono','Fira Code',monospace",overflow:"hidden",color:"#8892b0"}}>

      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}`}</style>

      {/* Toasts */}
      <div style={{position:"absolute",top:52,right:330,zIndex:300,display:"flex",flexDirection:"column",gap:5,pointerEvents:"none"}}>
        {toasts.map((t:any)=><div key={t.id} style={{background:"#0f0f22ee",border:`1px solid ${t.color}55`,borderLeft:`3px solid ${t.color}`,padding:"5px 12px",borderRadius:4,fontSize:10,color:t.color,animation:"slideIn 0.15s ease",whiteSpace:"nowrap",maxWidth:280}}>{t.text}</div>)}
      </div>

      {/* Config modal */}
      {showConfig&&configAgent&&(
        <div style={{position:"fixed",inset:0,background:"#000000bb",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={(e:any)=>e.target===e.currentTarget&&setShowConfig(false)}>
          <div style={{background:"#0f0f20",border:"1px solid #2a2a4a",borderRadius:8,padding:22,width:300,color:"#8892b0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <span style={{fontSize:11,color:"#e0e0ff",letterSpacing:"0.1em"}}>CONFIGURE</span>
              <button onClick={()=>setShowConfig(false)} style={{background:"transparent",border:"none",color:"#7a7a98",cursor:"pointer",fontSize:14}}>✕</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <span style={{fontSize:22}}>{configAgent.emoji}</span>
              <div style={{color:configEdits.color||configAgent.color,fontSize:12,fontWeight:700}}>{configEdits.name||configAgent.name}</div>
            </div>
            {[{l:"Name",k:"name",t:"text"},{l:"Color",k:"color",t:"color"}].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"#6a6a8e",marginBottom:3,letterSpacing:"0.1em"}}>{f.l.toUpperCase()}</div>
                <input type={f.t} value={configEdits[f.k]||""} onChange={(e:any)=>setConfigEdits((p:any)=>({...p,[f.k]:e.target.value}))}
                  style={{width:"100%",background:"#1a1a2e",border:"1px solid #2a2a4a",borderRadius:4,padding:"4px 7px",color:"#e0e0ff",fontFamily:"inherit",fontSize:10,boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{marginBottom:14,padding:"8px",background:"#0a0a18",borderRadius:4}}>
              <div style={{fontSize:10,color:"#6a6a8e",lineHeight:1.6}}>Agent behavior is driven by real OpenClaw sessions. Visual config (name/color) is cosmetic only.</div>
            </div>
            <div style={{display:"flex",gap:7}}>
              <button onClick={saveConfig} style={{flex:1,background:"#6C5CE7",border:"none",borderRadius:4,color:"#fff",padding:"7px",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>Save</button>
              <button onClick={()=>setShowConfig(false)} style={{flex:1,background:"transparent",border:"1px solid #2a2a4a",borderRadius:4,color:"#8892b0",padding:"7px",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Orchestrator panel */}
      {showOrchPanel&&orchAgent&&(
        <div style={{position:"fixed",inset:0,background:"#000000aa",zIndex:350,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={(e:any)=>e.target===e.currentTarget&&setShowOrchPanel(false)}>
          <div style={{background:"#0d0d20",border:`2px solid ${orchAgent.color}44`,borderRadius:10,padding:22,width:460,maxHeight:"75vh",overflowY:"auto",color:"#8892b0"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:9}}>
                <span style={{fontSize:22}}>👑</span>
                <div>
                  <div style={{color:orchAgent.color,fontSize:13,fontWeight:700}}>{orchAgent.name} — Orchestrator</div>
                  <div style={{fontSize:9,color:"#7a7a98"}}>{orchAgent.role}</div>
                </div>
              </div>
              <button onClick={()=>setShowOrchPanel(false)} style={{background:"transparent",border:"none",color:"#7a7a98",cursor:"pointer",fontSize:14}}>✕</button>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,color:"#6a6a8e",letterSpacing:"0.12em",marginBottom:6}}>ACTIVE DEPENDENCY CHAINS</div>
              {Object.entries(DEPENDENCIES).map(([src,dsts])=>{
                const srcAg=roster.find(a=>a.id===src);if(!srcAg?.active) return null;
                return (
                  <div key={src} style={{marginBottom:4,padding:"4px 8px",background:"#12122a",borderRadius:3,border:`1px solid ${srcAg.color}22`,fontSize:10}}>
                    <span style={{color:srcAg.color,fontWeight:700}}>{srcAg.emoji} {srcAg.name}</span>
                    <span style={{color:"#6a6a8e"}}> → </span>
                    {dsts.map(d=>{const dag=roster.find(a=>a.id===d);return dag?<span key={d} style={{color:dag.color,marginRight:6}}>{dag.emoji}{dag.name}</span>:null;})}
                  </div>
                );
              }).filter(Boolean)}
            </div>
            <div style={{marginBottom:14,padding:"10px 12px",background:"#0a0a1a",borderRadius:5,border:"1px solid #2a2a4a"}}>
              <div style={{fontSize:10,color:"#6a6a8e",letterSpacing:"0.12em",marginBottom:8}}>COMMAND TERMINAL</div>
              <div style={{fontSize:10,color:"#7a7a98",marginBottom:6}}>Send a message to KAOS — real orchestration, not simulation</div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{color:"#6C5CE7",fontSize:11,fontWeight:700}}>❯</span>
                <input value={nlInput} onChange={(e:any)=>setNlInput(e.target.value)}
                  onKeyDown={(e:any)=>{if(e.key==="Enter"&&nlInput.trim()&&!nlLoading){
                    setNlLoading(true);
                    const userMsg=nlInput.trim();
                    addFeed(`❯ ${userMsg}`,"#6C5CE7");
                    fetch("http://127.0.0.1:18789/v1/chat/completions",{
                      method:"POST",
                      headers:{"Content-Type":"application/json","Authorization":"Bearer eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0"},
                      body:JSON.stringify({model:"main",messages:[{role:"user",content:userMsg}]})
                    }).then(r=>r.json()).then(data=>{
                      const reply=data.choices?.[0]?.message?.content||"No response";
                      const short=reply.length>200?reply.slice(0,200)+"…":reply;
                      addFeed(`🧠 ${short}`,"#a29bfe");
                      addToast("KAOS responded","#6C5CE7");
                      const entry={id:feedIdRef.current++,ts:nowts(),sender:"You",senderColor:"#6C5CE7",receiver:"KAOS",text:userMsg};
                      const replyEntry={id:feedIdRef.current++,ts:nowts(),sender:"KAOS",senderColor:"#6C5CE7",receiver:"You",text:short};
                      dialogueRef.current=[replyEntry,entry,...dialogueRef.current].slice(0,40);
                      setDialogue([...dialogueRef.current]);
                      setNlInput("");setNlLoading(false);
                    }).catch(()=>{addToast("Gateway error — is KAOS running?","#ff4444");setNlLoading(false);});
                  }}}
                  placeholder="e.g. Research competitor pricing for Kemuni..."
                  disabled={nlLoading}
                  style={{flex:1,background:"#12122a",border:"1px solid #2a2a4a",borderRadius:3,padding:"6px 8px",color:"#e0e0ff",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,boxSizing:"border-box",outline:"none"}}/>
              </div>
              {nlLoading&&<div style={{fontSize:10,color:"#6C5CE7",marginTop:4}}>⟳ KAOS processing…</div>}
            </div>
            <div>
              <div style={{fontSize:9,color:"#6a6a8e",letterSpacing:"0.12em",marginBottom:6}}>AGENT STATUS UPDATES</div>
              {dialogue.length===0&&<div style={{fontSize:9,color:"#4a4a6a",padding:"8px 0"}}>Updates appear after agents complete tasks.</div>}
              {dialogue.slice(0,12).map((d:any)=>(
                <div key={d.id} style={{marginBottom:6,padding:"5px 8px",background:"#0f0f22",borderRadius:3,borderLeft:`2px solid ${d.senderColor}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{color:d.senderColor,fontSize:9,fontWeight:700}}>{d.sender}</span>
                    <span style={{color:"#4a4a6a",fontSize:9}}>{d.ts}</span>
                  </div>
                  <div style={{color:"#8892b0",fontSize:9,lineHeight:1.5}}>{d.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings&&(
        <div style={{position:"fixed",inset:0,background:"#000000aa",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={(e:any)=>e.target===e.currentTarget&&setShowSettings(false)}>
          <div style={{background:"#0f0f20",border:"1px solid #2a2a4a",borderRadius:8,padding:22,width:280,color:"#8892b0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <span style={{fontSize:11,color:"#e0e0ff",letterSpacing:"0.1em"}}>KEYBOARD SHORTCUTS</span>
              <button onClick={()=>setShowSettings(false)} style={{background:"transparent",border:"none",color:"#7a7a98",cursor:"pointer",fontSize:14}}>✕</button>
            </div>
            <div style={{padding:"6px 8px",background:"#0a0a18",borderRadius:3,fontSize:10,color:"#7a7a98",lineHeight:1.6}}>
              {[["Space","Pause/Resume"],["M","Toggle minimap"],["D","Dep flow graph"],["O","Orchestrator panel"],["T","Switch tab"],["R","Replay mode"],["Esc","Close panels"]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <kbd style={{background:"#1a1a2e",border:"1px solid #2a2a4a",borderRadius:2,padding:"0 4px",fontSize:9,color:"#6C5CE7"}}>{k}</kbd>
                  <span style={{color:"#7a7a98",fontSize:10}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu&&(
        <div style={{position:"fixed",inset:0,zIndex:500}} onClick={()=>setCtxMenu(null)}>
          <div style={{position:"absolute",left:ctxMenu.screenX,top:ctxMenu.screenY,
            background:"#0f0f22",border:"1px solid #2a2a4a",borderRadius:5,
            overflow:"hidden",minWidth:160,boxShadow:"0 4px 20px #000a"}}
            onClick={(e:any)=>e.stopPropagation()}>
            {(()=>{
              const ag=roster.find(a=>a.id===ctxMenu.agentId);
              if(!ag) return null;
              return <>
                <div style={{padding:"6px 12px",borderBottom:"1px solid #1a1a2e",display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:14}}>{ag.emoji}</span>
                  <span style={{color:ag.color,fontSize:10,fontWeight:700}}>{ag.name}</span>
                </div>
                {[
                  {action:"task",label:"⚡ Assign random task",disabled:ag.state!=="idle"},
                  {action:"complete",label:"✓ Force complete task",disabled:ag.state!=="working"},
                  {action:"config",label:"⚙ Configure agent",disabled:false},
                ].map(item=>(
                  <button key={item.action} onClick={()=>ctxAction(item.action)} disabled={item.disabled}
                    style={{display:"block",width:"100%",background:"transparent",border:"none",
                      borderBottom:"1px solid #1e1e35",color:item.disabled?"#2a2a4a":"#8892b0",
                      padding:"7px 12px",textAlign:"left",cursor:item.disabled?"default":"pointer",
                      fontSize:9,fontFamily:"inherit"}}>
                    {item.label}
                  </button>
                ))}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",height:44,background:"#0b0b18",borderBottom:"1px solid #1a1a2e"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:paused?"#3a3a5e":incident?"#ff4444":"#00ff88",boxShadow:paused?"none":incident?"0 0 8px #ff444466":"0 0 8px #00ff8866"}}/>
          <span style={{color:"#e0e0ff",fontSize:12,letterSpacing:"0.14em",fontWeight:600}}>NABIT LLC</span>
          <span style={{color:"#4a4a6a"}}>·</span>
          <span style={{color:incident?"#ff4444":"#7a7a98",fontSize:10,letterSpacing:"0.09em"}}>{incident?incident.title:"AGENT OFFICE"}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{display:"flex",alignItems:"center",gap:4,padding:"2px 8px",background:"#0f0f20",border:"1px solid #1a1a2e",borderRadius:3}}>
            <span style={{fontSize:9,color:"#00ff88"}}>{stats.working}</span>
            <span style={{fontSize:9,color:"#6a6a8e"}}>working</span>
            <span style={{fontSize:9,color:"#4a4a6a"}}>·</span>
            <span style={{fontSize:9,color:"#6C5CE7"}}>{stats.completed}</span>
            <span style={{fontSize:9,color:"#6a6a8e"}}>done</span>
          </div>
          <button onClick={toggleDepGraph} style={{background:showDepGraph?"#1a1a3a":"transparent",border:`1px solid ${showDepGraph?"#6C5CE7":"#2a2a4a"}`,color:showDepGraph?"#a29bfe":"#4a5568",padding:"3px 7px",borderRadius:3,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>⟡ FLOW</button>
          <button onClick={()=>{showLegendRef.current=!showLegendRef.current;setShowLegend(s=>!s);}} style={{background:"transparent",border:"1px solid #2a2a4a",color:showLegend?"#8892b0":"#3a3a5e",padding:"3px 7px",borderRadius:3,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>◉</button>
          <button onClick={toggleMinimap} style={{background:"transparent",border:"1px solid #2a2a4a",color:showMinimap?"#8892b0":"#3a3a5e",padding:"3px 7px",borderRadius:3,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>🗺</button>
          <button onClick={()=>setShowSettings(s=>!s)} style={{background:showSettings?"#1a1a3a":"transparent",border:"1px solid #2a2a4a",color:"#7a7a98",padding:"3px 7px",borderRadius:3,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>⌨</button>
          <button onClick={toggleSound} style={{background:"transparent",border:"1px solid #2a2a4a",color:soundOn?"#8892b0":"#3a3a5e",padding:"3px 7px",borderRadius:3,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>{soundOn?"🔊":"🔇"}</button>
          <button onClick={togglePause} style={{background:"transparent",border:"1px solid #2a2a4a",color:paused?"#00ff88":"#8892b0",padding:"3px 10px",borderRadius:3,fontSize:9,letterSpacing:"0.08em",cursor:"pointer",fontFamily:"inherit"}}>{paused?"▶":"⏸"}</button>
        </div>
      </div>

      {/* Body */}
      <div style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>
        <div style={{flex:1,minWidth:0,overflow:"hidden",background:"#060610",display:"flex",alignItems:"stretch"}}>
          <canvas ref={canvasRef} style={{imageRendering:"pixelated" as any,display:"block",width:"100%",height:"100%"}}/>
        </div>

        {/* Sidebar */}
        <div style={{width:320,flexShrink:0,display:"flex",flexDirection:"column",background:"#0b0b14",borderLeft:"1px solid #1a1a2e",overflow:"hidden"}}>

          {/* Detail panel — shows when an agent is selected on canvas */}
          {detail&&(
            <div style={{flexShrink:0,borderBottom:"1px solid #1a1a2e",overflowY:"auto",maxHeight:"45%"}}>
              <div style={{position:"sticky",top:0,background:"#0b0b14",zIndex:1,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 11px 4px",fontSize:11,letterSpacing:"0.13em",color:"#6a6a8e",borderBottom:"1px solid #1e1e35"}}>
                <span>AGENT DETAIL{detail.id===ORCHESTRATOR_ID?" 👑":""}</span>
                <div style={{display:"flex",gap:5}}>
                  {detail.id===ORCHESTRATOR_ID&&<button onClick={()=>setShowOrchPanel(true)} style={{background:"#6C5CE722",border:"1px solid #6C5CE744",color:"#a29bfe",cursor:"pointer",fontSize:10,fontFamily:"inherit",padding:"2px 6px",borderRadius:2}}>Panel</button>}
                  <button onClick={()=>{setSelectedId(null);setDetail(null);}} style={{background:"transparent",border:"none",color:"#6a6a8e",cursor:"pointer",fontSize:12,fontFamily:"inherit",padding:0}}>✕</button>
                </div>
              </div>
              <div style={{padding:"9px 11px"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                  <span style={{fontSize:20}}>{detail.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{color:detail.color,fontWeight:700,fontSize:14}}>{detail.name}</div>
                    <div style={{color:"#7a7a98",fontSize:11}}>{detail.role}</div>
                  </div>
                  <div style={{fontSize:9,padding:"2px 5px",borderRadius:2,background:detail.state==="working"?"#00ff8815":"#1a1a28",color:detail.state==="working"?"#00ff88":"#7a7a98"}}>
                    {detail.state?.replace(/_/g," ")}
                  </div>
                </div>
                <div style={{display:"flex",gap:12,marginBottom:8}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:14,color:detail.color,fontWeight:700}}>{detail.tasksCompleted}</div><div style={{fontSize:10,color:"#6a6a8e"}}>TASKS</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:14,color:"#FDCB6E",fontWeight:700}}>{detail.meetingsAttended}</div><div style={{fontSize:10,color:"#6a6a8e"}}>MEETINGS</div></div>
                </div>
                {detail.taskHistory?.length>0&&(
                  <div>
                    <div style={{fontSize:10,color:"#6a6a8e",marginBottom:3,letterSpacing:"0.1em"}}>RECENT TASKS</div>
                    {[...detail.taskHistory].reverse().slice(0,3).map((t:string,i:number)=>(
                      <div key={i} style={{fontSize:11,color:"#7a7a98",padding:"2px 0",borderBottom:"1px solid #1e1e35"}}>
                        <span style={{color:"#4a4a6a",marginRight:3}}>↳</span>{t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expandable panels — all in one scrollable container */}
          <div style={{flex:1,minHeight:0,overflowY:"auto"}}>

            {/* ▼ ACTIVITY FEED — always expanded */}
            <div>
              <div onClick={()=>setTab(tab==="feed"?"":"feed")} style={{padding:"6px 11px",fontSize:11,letterSpacing:"0.1em",color:"#6a6a8e",borderBottom:"1px solid #1e1e35",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d0d18",userSelect:"none"}}>
                <span>{tab==="feed"?"▼":"▶"} ACTIVITY FEED</span>
                <span style={{fontSize:9,color:"#4a4a6a"}}>{feed.length}</span>
              </div>
              {tab!=="feed-collapsed"&&(
                <div ref={feedRef} style={{maxHeight:200,overflowY:"auto",padding:"3px 0"}}>
                  {feed.slice(-20).map((e:any)=><div key={e.id} style={{padding:"2px 11px",display:"flex",gap:5,alignItems:"flex-start"}}>
                    <span style={{color:"#4a4a6a",fontSize:9,flexShrink:0,marginTop:2}}>{e.ts}</span>
                    <span style={{color:e.color,fontSize:11,lineHeight:1.5}}>{e.text}</span>
                  </div>)}
                </div>
              )}
            </div>

            {/* ▶ COMPLETED TASKS */}
            <div>
              <div onClick={()=>setTab(tab==="flow"?"":"flow")} style={{padding:"6px 11px",fontSize:11,letterSpacing:"0.1em",color:"#6a6a8e",borderBottom:"1px solid #1e1e35",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d0d18",userSelect:"none"}}>
                <span>{tab==="flow"?"▼":"▶"} COMPLETED TASKS</span>
                <span style={{fontSize:9,color:waterfall.length>0?"#00ff88":"#4a4a6a"}}>{waterfall.length}</span>
              </div>
              {tab==="flow"&&(
                <div style={{maxHeight:200,overflowY:"auto"}}>
                  {waterfall.length===0&&<div style={{padding:"12px 11px",color:"#4a4a6a",fontSize:11,textAlign:"center",lineHeight:1.8}}>Completions appear when agents finish work.</div>}
                  {waterfall.map((wf:any)=>{
                    const ag=ALL_AGENTS.find(a=>a.id===wf.agentId);
                    if(!ag) return null;
                    const deps=DEPENDENCIES[wf.agentId];
                    return (
                      <div key={wf.id} style={{padding:"5px 11px",borderBottom:"1px solid #1e1e35"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                          <span style={{fontSize:11}}>{ag.emoji}</span>
                          <span style={{color:ag.color,fontSize:11,fontWeight:700}}>{ag.name}</span>
                          <span style={{color:"#7a7a98",fontSize:10}}>✓ {wf.task}</span>
                          <span style={{color:"#4a4a6a",fontSize:9,marginLeft:"auto"}}>{wf.ts}</span>
                        </div>
                        {deps&&deps.length>0&&(
                          <div style={{paddingLeft:18,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                            <span style={{color:"#6a6a8e",fontSize:9}}>triggers →</span>
                            {deps.map(depId=>{const dep=ALL_AGENTS.find(a=>a.id===depId);return dep?<span key={depId} style={{fontSize:9,color:dep.color,background:dep.color+"15",padding:"1px 4px",borderRadius:2}}>{dep.emoji} {dep.name}</span>:null;})}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ▶ MEETINGS */}
            <div>
              <div onClick={()=>setTab(tab==="meetings"?"":"meetings")} style={{padding:"6px 11px",fontSize:11,letterSpacing:"0.1em",color:"#6a6a8e",borderBottom:"1px solid #1e1e35",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d0d18",userSelect:"none"}}>
                <span>{tab==="meetings"?"▼":"▶"} MEETINGS</span>
                <span style={{fontSize:9,color:meetingLogs.length>0?"#FDCB6E":"#4a4a6a"}}>{meetingLogs.length}</span>
              </div>
              {tab==="meetings"&&(
                <div style={{maxHeight:200,overflowY:"auto"}}>
                  {meetingLogs.length===0&&<div style={{padding:"12px 11px",color:"#4a4a6a",fontSize:11,textAlign:"center"}}>Transcripts appear after meetings end.</div>}
                  {meetingLogs.map((m:any)=>(
                    <div key={m.id} style={{padding:"7px 11px",borderBottom:"1px solid #1e1e35"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        <span style={{color:"#FDCB6E",fontSize:11,fontWeight:600}}>{m.topic}</span>
                        <span style={{color:"#4a4a6a",fontSize:9}}>{m.ts}</span>
                      </div>
                      <div style={{color:"#6a6a8e",fontSize:10,marginBottom:3}}>{m.attendees.join(", ")}</div>
                      <div style={{color:"#8892b0",fontSize:11,lineHeight:1.7,whiteSpace:"pre-line"}}>{m.summary}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ▶ LEADERBOARD */}
            <div>
              <div onClick={()=>setTab(tab==="board"?"":"board")} style={{padding:"6px 11px",fontSize:11,letterSpacing:"0.1em",color:"#6a6a8e",borderBottom:"1px solid #1e1e35",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d0d18",userSelect:"none"}}>
                <span>{tab==="board"?"▼":"▶"} LEADERBOARD</span>
              </div>
              {tab==="board"&&(
                <div style={{maxHeight:200,overflowY:"auto"}}>
                  {leaderboard.length===0&&<div style={{padding:"12px 11px",color:"#4a4a6a",fontSize:11,textAlign:"center"}}>Collecting data…</div>}
                  {leaderboard.map((a:any,rank:number)=>(
                    <div key={a.id} style={{padding:"5px 11px",borderBottom:"1px solid #1e1e35",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:10,color:rank===0?"#FFD700":rank===1?"#C0C0C0":rank===2?"#CD7F32":"#4a4a6a",width:14,textAlign:"center",fontWeight:700}}>{rank===0?"①":rank===1?"②":rank===2?"③":String(rank+1)}</span>
                      <span style={{fontSize:11}}>{a.emoji}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:a.color,fontSize:11,fontWeight:600}}>{a.name}</div>
                        <div style={{fontSize:10,color:"#00ff88"}}>{a.tasksCompleted} tasks completed</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Stats bar */}
          <div style={{flexShrink:0,borderTop:"1px solid #1a1a2e",display:"flex",padding:"6px 0"}}>
            {[{l:"DONE",v:stats.completed,c:"#6C5CE7"},{l:"ACTIVE",v:stats.working,c:"#00ff88"},{l:"MTG",v:stats.meeting,c:"#FDCB6E"},{l:"IDLE",v:stats.idle,c:"#3a3a5e"}].map((s,i,arr)=>(
              <div key={s.l} style={{flex:1,textAlign:"center",borderRight:i<arr.length-1?"1px solid #1a1a2e":"none"}}>
                <div style={{fontSize:16,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:10,color:"#4a4a6a",letterSpacing:"0.06em",marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Replay scrubber */}
          <div style={{flexShrink:0,borderTop:"1px solid #1a1a2e",padding:"5px 11px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:10,color:"#6a6a8e",letterSpacing:"0.1em"}}>REPLAY</span>
              <button onClick={()=>{setReplayMode(r=>{replayModeRef.current=!r;return!r;});}} style={{background:replayMode?"#1a1a3a":"transparent",border:`1px solid ${replayMode?"#6C5CE7":"#2a2a4a"}`,color:replayMode?"#a29bfe":"#4a5568",padding:"1px 6px",borderRadius:2,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{replayMode?"● REC OFF":"○ REC ON"}</button>
              <span style={{fontSize:9,color:"#4a4a6a",marginLeft:"auto"}}>{replayLen} frames</span>
            </div>
            {replayMode&&replayLen>0&&(
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <input type="range" min="0" max={Math.max(0,replayLen-1)} value={replayPos}
                  onChange={(e:any)=>{const v=+e.target.value;setReplayPos(v);replayCurRef.current=v;}}
                  style={{flex:1,accentColor:"#6C5CE7"}}/>
                <span style={{fontSize:10,color:"#7a7a98",width:26,textAlign:"right"}}>{replayPos+1}/{replayLen}</span>
              </div>
            )}
            {timeline.length>0&&(
              <div style={{height:8,background:"#0a0a18",borderRadius:2,overflow:"hidden",position:"relative",marginTop:3}}>
                {timeline.map((ev:any,i:number)=>(
                  <div key={i} title={`${ev.ts} — ${ev.label}`} style={{
                    position:"absolute",left:`${(i/Math.max(1,timeline.length-1))*100}%`,
                    top:0,width:3,height:"100%",
                    background:ev.color,opacity:0.7,borderRadius:1,
                    transform:"translateX(-50%)",cursor:"pointer"
                  }}/>
                ))}
              </div>
            )}
            <div style={{fontSize:9,color:"#1a1a3a",marginTop:2}}>
              space=pause · m=map · d=flow · o=orch · esc=close
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
