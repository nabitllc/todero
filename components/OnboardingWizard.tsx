'use client'
import { useState } from 'react'
import { X, ArrowRight, ArrowLeft, Sparkles, Check } from 'lucide-react'

const BUSINESS_TYPES = [
  { id: 'saas', label: 'SaaS', emoji: '☁️' },
  { id: 'ecommerce', label: 'eCommerce', emoji: '🛒' },
  { id: 'logistics', label: 'Logistics', emoji: '🚚' },
  { id: 'brand', label: 'Brand', emoji: '✨' },
  { id: 'internal', label: 'Internal', emoji: '🏢' },
  { id: 'other', label: 'Other', emoji: '🔧' },
]

const AGENT_OPTIONS = [
  { id: 'builder', name: 'Builder', emoji: '🔨', role: 'Coding Agent', desc: 'Ships features and fixes bugs. Your primary dev agent — always on.', always: true },
  { id: 'scout', name: 'Scout', emoji: '🔍', role: 'Research Agent', desc: 'Scans market trends, competitors, and opportunities each morning.' },
  { id: 'ops', name: 'Ops', emoji: '⚙️', role: 'Operations Agent', desc: 'Monitors infra health, deployments, and system reliability.' },
  { id: 'tester', name: 'Tester', emoji: '🧪', role: 'QA Agent', desc: 'Reviews all code changes and catches bugs before they ship.' },
  { id: 'po', name: 'PO', emoji: '📋', role: 'Product Owner', desc: 'Structures features, writes specs, and keeps the backlog tidy.' },
]

interface Props { onClose: () => void; onComplete: (businessName: string) => void }

export default function OnboardingWizard({ onClose, onComplete }: Props) {
  const [step, setStep] = useState(1)
  // Step 1
  const [name, setName] = useState('')
  const [type, setType] = useState('saas')
  const [tagline, setTagline] = useState('')
  // Step 2
  const [goal, setGoal] = useState('')
  const [targetDate, setTargetDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [successMetric, setSuccessMetric] = useState('')
  // Step 3
  const [agents, setAgents] = useState(['builder', 'tester'])
  // Step 4
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

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
        body: JSON.stringify({ name, type, goal, agents, targetDate, successMetric, tagline })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDone(true)
      setTimeout(() => onComplete(name), 1200)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  const canNext1 = name.trim().length > 0
  const canNext2 = goal.trim().length > 0

  const TOTAL_STEPS = 4

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-lg p-6 relative shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors">
          <X size={18}/>
        </button>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6">
          {Array.from({length: TOTAL_STEPS}, (_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i + 1 <= step ? 'bg-white' : 'bg-white/10'}`} />
          ))}
        </div>

        {/* Step label */}
        <p className="text-white/30 text-xs font-semibold uppercase tracking-widest mb-2">Step {step} of {TOTAL_STEPS}</p>

        {/* ── STEP 1: What are you building? ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">What are you building?</h2>
              <p className="text-white/40 text-sm mt-1">Give your business a name and type.</p>
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Business name (e.g. ZNZ Express)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 text-sm"
            />
            <div className="grid grid-cols-3 gap-2">
              {BUSINESS_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className={`py-2.5 px-3 rounded-xl text-sm border transition-all flex flex-col items-center gap-1
                    ${type === t.id ? 'border-white bg-white/10 text-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white/70'}`}>
                  <span className="text-xl">{t.emoji}</span>
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
            </div>
            <input
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              placeholder="One-line description (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 text-sm"
            />
          </div>
        )}

        {/* ── STEP 2: Mission this month ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">{"What's your mission this month?"}</h2>
              <p className="text-white/40 text-sm mt-1">Set a clear goal and target date.</p>
            </div>
            <div>
              <label className="text-white/50 text-xs uppercase tracking-wider mb-1.5 block">Primary goal *</label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="e.g. Launch beta to 10 users, get first paying customer"
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white/50 text-xs uppercase tracking-wider mb-1.5 block">Target date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 text-sm"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs uppercase tracking-wider mb-1.5 block">Success metric</label>
                <input
                  value={successMetric}
                  onChange={e => setSuccessMetric(e.target.value)}
                  placeholder="e.g. 10 signups"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Build your team ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">Build your team</h2>
              <p className="text-white/40 text-sm mt-1">Choose which agents will work on {name || 'your project'}.</p>
            </div>
            <div className="space-y-2">
              {AGENT_OPTIONS.map(a => {
                const active = agents.includes(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAgent(a.id)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all
                      ${active ? 'border-white/30 bg-white/5' : 'border-white/10 hover:border-white/20'}
                      ${a.always ? 'cursor-default' : 'cursor-pointer'}`}>
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors
                      ${active ? 'bg-white border-white' : 'border-white/30'}`}>
                      {active && <Check size={11} className="text-black" />}
                    </div>
                    <span className="text-2xl shrink-0">{a.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{a.name}</span>
                        <span className="text-[10px] text-white/30">{a.role}</span>
                        {a.always && <span className="text-[10px] text-white/30 italic">(always on)</span>}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5 leading-snug">{a.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── STEP 4: Launch ── */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">{"You're ready. Launch."}</h2>
              <p className="text-white/40 text-sm mt-1">Here's what we'll set up for you.</p>
            </div>

            {/* Summary card */}
            <div className="rounded-xl border border-white/10 p-4 space-y-3" style={{background:'#141414'}}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{BUSINESS_TYPES.find(t => t.id === type)?.emoji || '🚀'}</span>
                <div>
                  <p className="text-white font-semibold text-base">{name}</p>
                  {tagline && <p className="text-white/50 text-xs mt-0.5">{tagline}</p>}
                  <p className="text-white/30 text-xs mt-0.5 capitalize">{type}</p>
                </div>
              </div>
              {goal && (
                <div className="border-t border-white/5 pt-3">
                  <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Mission</p>
                  <p className="text-white/80 text-sm">{goal}</p>
                  {successMetric && <p className="text-white/40 text-xs mt-1">✓ {successMetric}</p>}
                </div>
              )}
              <div className="border-t border-white/5 pt-3">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Team</p>
                <div className="flex flex-wrap gap-2">
                  {agents.map(id => {
                    const a = AGENT_OPTIONS.find(x => x.id === id)
                    return a ? (
                      <span key={id} className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">
                        {a.emoji} {a.name}
                      </span>
                    ) : null
                  })}
                </div>
              </div>
              <div className="border-t border-white/5 pt-3">
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">What happens next</p>
                <div className="space-y-1">
                  {['Sprint 1 created', '3 starter issues added to Board', '"Welcome to ' + name + '!" issue created', 'Team assigned to project'].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                      <span className="text-green-400">✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {done && (
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <Check size={16}/> Launched! Switching to your board...
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6 gap-3">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={loading || done}
              className="flex items-center gap-2 text-white/50 hover:text-white text-sm transition-colors disabled:opacity-30">
              <ArrowLeft size={14}/> Back
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
              className="flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30 hover:bg-zinc-100 transition-all ml-auto">
              Next <ArrowRight size={14}/>
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={loading || done}
              className="flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-zinc-100 transition-all ml-auto">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block"/>
                  Creating...
                </span>
              ) : done ? (
                <span className="flex items-center gap-2"><Check size={14}/> Done!</span>
              ) : (
                <span className="flex items-center gap-2"><Sparkles size={14}/> Launch {name} →</span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
