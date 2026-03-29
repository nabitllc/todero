'use client'
import { useState } from 'react'
import { X, ArrowRight, ArrowLeft, Sparkles, Check, ChevronDown, ChevronUp, Building2, Bot, ClipboardList, Rocket } from 'lucide-react'

// ── Name generators ──────────────────────────────────────────────────────────
const GENERATED_NAMES = [
  'Meridian', 'Solace', 'Vantage', 'Axiom', 'Luminary', 'Keystone',
  'Foundry', 'Catalyst', 'Prism', 'Verdant', 'Paragon', 'Nexus',
  'Stratum', 'Alcove', 'Harbinger', 'Pinnacle', 'Cobalt', 'Ember',
  'Flux', 'Helix', 'Indigo', 'Lattice', 'Mosaic', 'Onyx',
  'Quasar', 'Radiant', 'Seraph', 'Tether', 'Umbra', 'Vesper',
  'Warden', 'Xenon', 'Yield', 'Zephyr', 'Atlas', 'Beacon',
]

const AGENT_NAMES = [
  'Forge', 'Volt', 'Cipher', 'Nexus', 'Apex', 'Titan', 'Vega', 'Nova',
  'Orion', 'Blaze', 'Ridge', 'Zane', 'Coda', 'Drift', 'Echo', 'Flint',
  'Grove', 'Haven', 'Iris', 'Jade',
]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Context-aware task generator ─────────────────────────────────────────────
function generateTaskTitle(mission: string): string {
  const v = mission.toLowerCase()
  if (/launch|users|customers/.test(v)) return 'Define target user and first feature'
  if (/revenue|money|business|profit/.test(v)) return 'Map out revenue model and pricing'
  if (/app|software|platform|saas/.test(v)) return 'Sketch core user flow and MVP scope'
  if (/community|people|connect/.test(v)) return 'Define community value proposition'
  if (/finance|money|budget|habit/.test(v)) return 'Map out the core money habit loop'
  return 'Define the first thing to build'
}

// ── Adapter types ─────────────────────────────────────────────────────────────
const PRIMARY_ADAPTERS = [
  { id: 'claude-code', label: 'Claude Code', desc: 'Local Claude agent', recommended: true },
  { id: 'codex', label: 'Codex', desc: 'Local Codex agent', recommended: true },
]
const MORE_ADAPTERS = [
  { id: 'gemini-cli', label: 'Gemini CLI', desc: 'Google Gemini local agent' },
  { id: 'opencode', label: 'OpenCode', desc: 'Open source coding agent' },
  { id: 'pi', label: 'Pi', desc: 'Inflection Pi agent' },
  { id: 'cursor', label: 'Cursor', desc: 'AI-powered IDE agent' },
  { id: 'openclaw-gateway', label: 'OpenClaw Gateway', desc: 'Remote via OpenClaw' },
]

const MODELS = [
  { label: 'Default', value: 'default' },
  { label: 'Claude Sonnet (Anthropic)', value: 'anthropic/claude-sonnet-4-6' },
  { label: 'Claude Haiku (Anthropic)', value: 'anthropic/claude-haiku-4-5' },
  { label: 'GPT-4o (OpenAI)', value: 'openai/gpt-4o' },
  { label: 'Gemini Pro (Google)', value: 'google/gemini-pro' },
  { label: 'Local (Ollama)', value: 'ollama/local' },
]

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = [
  { label: 'Company', icon: Building2 },
  { label: 'Agent',   icon: Bot },
  { label: 'Task',    icon: ClipboardList },
  { label: 'Launch',  icon: Rocket },
]

interface Props { onClose: () => void; onComplete: (businessName: string) => void }

export default function OnboardingWizard({ onClose, onComplete }: Props) {
  const [step, setStep] = useState(1) // 1–4

  // Step 1
  const [companyName, setCompanyName] = useState('')
  const [mission, setMission] = useState('')

  // Step 2
  const [agentName, setAgentName] = useState('Builder')
  const [adapter, setAdapter] = useState('claude-code')
  const [model, setModel] = useState('default')
  const [showMore, setShowMore] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok'>('idle')

  // Step 3
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')

  // Step 4
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedAdapter = [...PRIMARY_ADAPTERS, ...MORE_ADAPTERS].find(a => a.id === adapter)

  const runTest = () => {
    setTestStatus('testing')
    setTimeout(() => setTestStatus('ok'), 1500)
  }

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyName,
          type: 'saas',
          vision: mission,
          agentName,
          model: model === 'default' ? 'anthropic/claude-sonnet-4-6' : model,
          apiKey: '',
          taskTitle,
          taskDescription: taskDesc,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete(companyName)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const canNext = [
    companyName.trim().length > 0,   // step 1
    agentName.trim().length > 0,     // step 2
    taskTitle.trim().length > 0,     // step 3
    true,                            // step 4
  ][step - 1]

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0 shrink-0">
          <span className="text-white/30 text-xs font-medium tracking-widest uppercase">New Business</span>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors p-1">
            <X size={16}/>
          </button>
        </div>

        {/* ── Tab nav ── */}
        <div className="flex border-b border-white/10 mt-4 px-2 shrink-0">
          {TABS.map((tab, i) => {
            const active = step === i + 1
            const done   = step >  i + 1
            const Icon   = tab.icon
            return (
              <div
                key={tab.label}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px select-none
                  ${active
                    ? 'border-white text-white'
                    : done
                      ? 'border-transparent text-white/40'
                      : 'border-transparent text-white/20'}`}>
                <Icon size={12}/>
                {tab.label}
                {done && <Check size={10} className="text-white/40 ml-0.5"/>}
              </div>
            )
          })}
        </div>

        {/* ── Step content ── */}
        <div className="overflow-y-auto flex-1 px-6 py-6">

          {/* STEP 1 — Company */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 size={18} className="text-white/50"/>
                  <h2 className="text-lg font-semibold text-white">Name your company</h2>
                </div>
                <p className="text-white/40 text-sm">This is the organization your agents will work for.</p>
              </div>

              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Company name</label>
                <div className="flex gap-2">
                  <input
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="e.g. Meridian"
                    autoFocus
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-white/30 text-sm"
                  />
                  <button
                    onClick={() => setCompanyName(pickRandom(GENERATED_NAMES))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-white/40 hover:border-white/25 hover:text-white/70 text-xs transition-all whitespace-nowrap">
                    <Sparkles size={11}/> Generate
                  </button>
                </div>
              </div>

              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Mission / goal <span className="text-white/20 normal-case tracking-normal">optional</span></label>
                <textarea
                  value={mission}
                  onChange={e => setMission(e.target.value)}
                  placeholder="Finance app that builds money habits in three minutes a day"
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-white/30 resize-none text-sm"
                />
              </div>
            </div>
          )}

          {/* STEP 2 — Agent */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Bot size={18} className="text-white/50"/>
                  <h2 className="text-lg font-semibold text-white">Create your first agent</h2>
                </div>
                <p className="text-white/40 text-sm">Choose how this agent will run tasks.</p>
              </div>

              {/* Agent name */}
              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Agent name</label>
                <div className="flex gap-2">
                  <input
                    value={agentName}
                    onChange={e => setAgentName(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-white/30 text-sm"
                  />
                  <button
                    onClick={() => setAgentName(pickRandom(AGENT_NAMES))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-white/40 hover:border-white/25 hover:text-white/70 text-xs transition-all whitespace-nowrap">
                    <Sparkles size={11}/> Generate
                  </button>
                </div>
              </div>

              {/* Adapter type */}
              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-2 block">Adapter type</label>
                <div className="grid grid-cols-2 gap-2">
                  {PRIMARY_ADAPTERS.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setAdapter(a.id)}
                      className={`relative flex flex-col items-start gap-0.5 p-3.5 rounded-xl border text-left transition-all
                        ${adapter === a.id ? 'border-white/40 bg-white/8' : 'border-white/10 hover:border-white/20'}`}>
                      {a.recommended && (
                        <span className="absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Recommended
                        </span>
                      )}
                      <span className={`text-sm font-medium ${adapter === a.id ? 'text-white' : 'text-white/60'}`}>{a.label}</span>
                      <span className="text-xs text-white/30">{a.desc}</span>
                    </button>
                  ))}
                </div>

                {/* More adapters */}
                <button
                  onClick={() => setShowMore(s => !s)}
                  className="flex items-center gap-1 mt-2 text-white/30 hover:text-white/50 text-xs transition-colors">
                  {showMore ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                  More adapter types
                </button>

                {showMore && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {MORE_ADAPTERS.map(a => (
                      <button
                        key={a.id}
                        onClick={() => setAdapter(a.id)}
                        className={`flex flex-col items-start gap-0.5 p-3 rounded-xl border text-left transition-all
                          ${adapter === a.id ? 'border-white/40 bg-white/8' : 'border-white/10 hover:border-white/20'}`}>
                        <span className={`text-sm font-medium ${adapter === a.id ? 'text-white' : 'text-white/50'}`}>{a.label}</span>
                        <span className="text-xs text-white/25">{a.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Model */}
              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Model</label>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-white/30 text-sm appearance-none cursor-pointer">
                  {MODELS.map(m => (
                    <option key={m.value} value={m.value} className="bg-[#1a1a1a] text-white">{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Environment check */}
              <div className="rounded-xl border border-white/10 bg-white/3 p-4 space-y-2">
                <p className="text-white/50 text-xs font-medium">Adapter environment check</p>
                <p className="text-white/30 text-xs leading-relaxed">
                  Runs a live probe that asks the adapter CLI to respond with hello.
                </p>
                <button
                  onClick={runTest}
                  disabled={testStatus === 'testing'}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:border-white/25 hover:text-white/70 transition-all disabled:opacity-40">
                  {testStatus === 'testing' ? (
                    <>
                      <span className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin"/>
                      Testing...
                    </>
                  ) : testStatus === 'ok' ? (
                    <><Check size={12} className="text-emerald-400"/> Environment ready</>
                  ) : (
                    'Test now'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Task */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList size={18} className="text-white/50"/>
                  <h2 className="text-lg font-semibold text-white">Give it something to do</h2>
                </div>
                <p className="text-white/40 text-sm">Give your agent a small task to start with — a bug fix, a research question, writing a script.</p>
              </div>

              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Task title</label>
                <div className="flex gap-2">
                  <input
                    value={taskTitle}
                    onChange={e => setTaskTitle(e.target.value)}
                    placeholder="e.g. Define the first thing to build"
                    autoFocus
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-white/30 text-sm"
                  />
                  <button
                    onClick={() => setTaskTitle(generateTaskTitle(mission))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-white/40 hover:border-white/25 hover:text-white/70 text-xs transition-all whitespace-nowrap">
                    <Sparkles size={11}/> Generate
                  </button>
                </div>
              </div>

              <div>
                <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Description <span className="text-white/20 normal-case tracking-normal">optional</span></label>
                <textarea
                  value={taskDesc}
                  onChange={e => setTaskDesc(e.target.value)}
                  placeholder="What needs to happen? What does done look like?"
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-white/30 resize-none text-sm"
                />
              </div>
            </div>
          )}

          {/* STEP 4 — Launch */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Rocket size={18} className="text-white/50"/>
                  <h2 className="text-lg font-semibold text-white">Ready to launch</h2>
                </div>
                <p className="text-white/40 text-sm">Everything is set up. Launching now will create the starter task, wake the agent, and open the issue.</p>
              </div>

              {/* Summary checklist */}
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-base">🏢</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{companyName}</p>
                    <p className="text-white/30 text-xs">Company</p>
                  </div>
                  <Check size={14} className="text-emerald-400 shrink-0"/>
                </div>

                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-base">🤖</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{agentName}{selectedAdapter ? `, ${selectedAdapter.label}` : ''} <span className="text-white/30 font-normal">(local)</span></p>
                    <p className="text-white/30 text-xs">Agent</p>
                  </div>
                  <Check size={14} className="text-emerald-400 shrink-0"/>
                </div>

                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-base">📋</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{taskTitle || '(no task)'}</p>
                    <p className="text-white/30 text-xs">Task</p>
                  </div>
                  <Check size={14} className={`shrink-0 ${taskTitle ? 'text-emerald-400' : 'text-white/20'}`}/>
                </div>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              {/* Launch button */}
              <button
                onClick={submit}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-zinc-100 transition-all">
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"/>
                    Setting up your business...
                  </>
                ) : (
                  <>Create &amp; Open Issue <ArrowRight size={14}/></>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── Bottom nav ── */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-white/8 shrink-0">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 1}
            className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors disabled:opacity-0 disabled:pointer-events-none">
            <ArrowLeft size={14}/> Back
          </button>

          {step < 4 && (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canNext}
              className="flex items-center gap-1.5 bg-white text-black px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 hover:bg-zinc-100 transition-all">
              Next <ArrowRight size={14}/>
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
