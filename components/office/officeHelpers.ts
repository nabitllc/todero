// ─── Office Utility Functions ─────────────────────────────────────────────────
// Extracted from AgentOffice.tsx (INF-125)

import {
  CONF_TX, CONF_TY, CONF_TW, CONF_TH,
  ORCHESTRATOR_ID, DESK_POS, BENCH_POS, STANCHION_R,
  ALL_AGENTS, LS_KEY
} from './officeConstants';

export function tileCenterPx(tx:number,ty:number,T:number){ return { x:(tx+0.5)*T, y:(ty+0.5)*T }; }
export function fmt(n:number){ return n<10?"0"+n:""+n; }
export function nowts(){ const d=new Date(); return `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`; }
export function lpath(fx:number,fy:number,tx:number,ty:number){ return [{x:tx,y:fy},{x:tx,y:ty}]; }
export function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)); }

export function confRingPos(n:number,T:number){
  const cx=(CONF_TX+CONF_TW/2)*T, cy=(CONF_TY+CONF_TH/2)*T;
  const rx=T*(CONF_TW/2+0.5), ry=T*(CONF_TH/2+0.5);
  return Array.from({length:n},(_,i)=>{
    const a=(i/n)*Math.PI*2-Math.PI/2;
    return { x:cx+Math.cos(a)*rx, y:cy+Math.sin(a)*ry };
  });
}

export function mkBurst(x:number,y:number,color:string){
  return Array.from({length:12},(_,i)=>{
    const a=(i/12)*Math.PI*2, spd=2.5+Math.random()*3;
    return {x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-1.5,color,age:0,maxAge:50+Math.random()*20,size:4+Math.random()*3};
  });
}

export function loadMemory(){ try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return {};} }

export function saveMemory(agents:any[]){
  try{
    const m:any={};
    agents.forEach(ag=>{m[ag.id]={tasksCompleted:ag.tasksCompleted,meetingsAttended:ag.meetingsAttended,timeWorking:ag.timeWorking,timeMeeting:ag.timeMeeting,taskHistory:ag.taskHistory};});
    localStorage.setItem(LS_KEY,JSON.stringify(m));
  }catch(e){}
}

export function initAgents(T:number, activeIds:string[]){
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
      glowTick:0,
      lastStateChange:Date.now(),
    };
  });
}

export function createAudio(){
  try{
    const ac=new((window as any).AudioContext||(window as any).webkitAudioContext)();
    const master=ac.createGain(); master.gain.value=0.09; master.connect(ac.destination);
    const note = (freq:number,dur:number,type:OscillatorType="square",vol=0.07) => {
      if(ac.state==="suspended")ac.resume();
      const o=ac.createOscillator(),g=ac.createGain();
      o.type=type; o.frequency.value=freq;
      g.gain.setValueAtTime(vol,ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ac.currentTime+dur);
    };
    return {
      master,
      playClick:  ()=>note(880,0.04,"square",0.05),
      playComplete:()=>{note(523,0.07,"sine",0.06);setTimeout(()=>note(784,0.09,"sine",0.05),80);},
      playMeeting: ()=>{note(440,0.12,"sine",0.04);setTimeout(()=>note(660,0.15,"sine",0.03),120);},
      playIncident:()=>{note(200,0.25,"sawtooth",0.08);setTimeout(()=>note(180,0.3,"sawtooth",0.08),200);},
      playSpawn:   ()=>{note(1046,0.06,"sine",0.05);setTimeout(()=>note(1318,0.08,"sine",0.04),70);},
    };
  }catch(e){return null;}
}

export function getDayNight(_tick:number){
  const h=new Date().getHours();
  const isNight=(h>=21||h<7);
  const isDusk=(h>=18&&h<21)||(h>=7&&h<9);
  return{ isNight, isDusk, darkAlpha: isNight?0.35:isDusk?0.12:0 };
}

export function clampCam(cam:any,W:number,H:number){
  const maxX=0,minX=-(MAP_COLS*cam.tileSize-W)*cam.z,maxY=0,minY=-(MAP_COLS*cam.tileSize-H)*cam.z;
  cam.x=clamp(cam.x,minX,maxX); cam.y=clamp(cam.y,minY,maxY);
}

export function applyCamera(ctx:CanvasRenderingContext2D,cam:any){ctx.translate(cam.x,cam.y);ctx.scale(cam.z,cam.z);}

export function captureFrame(agents:any[],simTick:number){
  return {
    tick:simTick,
    ts:Date.now(),
    agents:agents.map(a=>({id:a.id,state:a.state,task:a.task,px:a.px,py:a.py,tasksCompleted:a.tasksCompleted}))
  };
}

// MAP_COLS needed in clampCam
const MAP_COLS = 16;
