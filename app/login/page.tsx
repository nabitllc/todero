'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginFormInner() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(false)
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push(from)
      router.refresh()
    } else {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30"
        />
        {error && <p className="text-red-500 text-xs mt-1.5">Incorrect password</p>}
      </div>
      <button
        type="submit"
        disabled={!password || loading}
        className="w-full bg-white text-black py-3 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-100 transition-all"
      >
        {loading ? 'Authenticating...' : 'Enter'}
      </button>
    </form>
  )
}

function LoginFormFallback() {
  return (
    <form className="flex flex-col gap-3">
      <div>
        <input
          type="password"
          placeholder="Enter password"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/30"
        />
      </div>
      <button
        disabled
        className="w-full bg-white text-black py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
      >
        Enter
      </button>
    </form>
  )
}

export default function Login() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#080808]">
      <div className="w-full max-w-[360px] px-6">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[28px] mx-auto mb-4">
            🧠
          </div>
          <h1 className="text-white text-xl font-bold">KAOS</h1>
          <p className="text-white/40 text-sm mt-1">Mission Control</p>
        </div>
        <Suspense fallback={<LoginFormFallback />}>
          <LoginFormInner />
        </Suspense>
      </div>
    </div>
  )
}
