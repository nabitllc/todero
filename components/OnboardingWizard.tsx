'use client'
import { useState } from 'react'
import { X, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'

const BUSINESS_TYPES = ['saas', 'ecommerce', 'logistics', 'brand', 'internal', 'other']
const AGENT_OPTIONS = [
  { id: 'builder', name: 'Builder 🔨', desc: 'Codes features and fixes bugs', always: true },
  { id: 'scout', name: 'Scout 🔍', desc: 'Researches market and competitors' },
  { id: 'ops', name: 'Ops ⚙️', desc: 'Monitors infrastructure and health' },
  { id: 'tester', name: 'Tester 🧪', desc: "Reviews and QA's all changes" },
]

interface Props { onClose: () => void; onComplete: (businessName: string) => void }

export default function OnboardingWizard({ onClose, onComplete }: Props) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [type, setType] = useState('saas')
  const [goal, setGoal] = useState('')
  const [agents, setAgents] = useState(['builder', 'tester'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleAgent = (id: string) => {
    if (id === 'builder') return
    setAgents(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id])
  }

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, goal, agents })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete(name)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-md p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white"><X size={18}/></button>

        {/* Progress */}
        <div className="flex gap-2 mb-6">
          {[1,2,3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-white' : 'bg-white/10'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">What are you building?</h2>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Business name (e.g. ZNZ Express)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30" />
            <div className="grid grid-cols-3 gap-2">
              {BUSINESS_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)}
                  className={`py-2 px-3 rounded-lg text-sm capitalize border transition-all
                    ${type === t ? 'border-white bg-white/10 text-white' : 'border-white/10 text-white/50 hover:border-white/30'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">{"What's your goal this month?"}</h2>
            <textarea value={goal} onChange={e => setGoal(e.target.value)}
              placeholder="e.g. Launch beta to 10 users, Get first paying customer"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none" />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Who should help you?</h2>
            <div className="space-y-2">
              {AGENT_OPTIONS.map(a => (
                <button key={a.id} onClick={() => toggleAgent(a.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all
                    ${agents.includes(a.id) ? 'border-white/30 bg-white/5' : 'border-white/10 opacity-50'}
                    ${a.always ? 'cursor-default' : 'hover:border-white/20'}`}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                    ${agents.includes(a.id) ? 'bg-white border-white' : 'border-white/30'}`}>
                    {agents.includes(a.id) && <span className="text-black text-xs">✓</span>}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{a.name} {a.always && <span className="text-white/30 text-xs">(required)</span>}</div>
                    <div className="text-xs text-white/40">{a.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          {step > 1
            ? <button onClick={() => setStep(s => s-1)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm"><ArrowLeft size={14}/>Back</button>
            : <div/>}
          {step < 3
            ? <button onClick={() => setStep(s => s+1)} disabled={step===1 && !name.trim()}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30">
                Next <ArrowRight size={14}/>
              </button>
            : <button onClick={submit} disabled={loading}
                className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {loading ? 'Creating...' : <><Sparkles size={14}/> Launch</>}
              </button>}
        </div>
      </div>
    </div>
  )
}
