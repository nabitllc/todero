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

const HEX_TO_BADGE: Record<string, string> = {
  '#3b82f6': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  '#a855f7': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  '#6b7280': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  '#10b981': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  '#ef4444': 'bg-red-500/20 text-red-400 border-red-500/30',
  '#f97316': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  '#3f3f46': 'bg-zinc-700/20 text-zinc-400 border-zinc-700/30',
  '#27272a': 'bg-zinc-800/20 text-zinc-500 border-zinc-800/30',
  '#f59e0b': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  '#71717a': 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  '#64748b': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

const DEFAULT_BADGE = 'bg-white/5 text-white/50 border-white/10'

export function Chip({label,color,colorClass}:{label:string;color?:string;colorClass?:string}) {
  const cls = colorClass ?? (color ? HEX_TO_BADGE[color] : undefined) ?? DEFAULT_BADGE
  return (
    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
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
