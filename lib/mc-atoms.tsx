'use client'
import React from 'react'

export function Dot({status,sm}:{status:string;sm?:boolean}) {
  const sz = sm ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const cls = status==='active'||status==='ok' ? 'bg-green-400 anim-pg'
    : status==='scheduled' ? 'bg-amber-400 anim-py'
    : status==='planned' ? 'bg-white/20'
    : status==='error' ? 'bg-red-400'
    : 'bg-white/20'
  return <span className={'inline-block rounded-full shrink-0 '+sz+' '+cls} />
}

export function Chip({label,color}:{label:string;color?:string}) {
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border"
      style={color
        ?{color,borderColor:color+'40',background:color+'15'}
        :{color:'rgba(255,255,255,0.5)',borderColor:'rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)'}}>
      {label}
    </span>
  )
}

export function Bar({v,color='#fff',bg='rgba(255,255,255,0.05)'}:{v:number;color?:string;bg?:string}) {
  return (
    <div className="w-full rounded-full h-1" style={{background:bg}}>
      <div className="h-1 rounded-full transition-all" style={{width:v+'%',background:color}} />
    </div>
  )
}

export function SH({icon,children,sub}:{icon:string;children:React.ReactNode;sub?:string}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span>{icon}</span>
      <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">{children}</span>
      {sub && <span className="text-[10px] text-white/20 italic">{sub}</span>}
    </div>
  )
}
