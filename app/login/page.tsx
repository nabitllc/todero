'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'

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
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
          error={error}
          className="rounded-xl"
        />
        {error && <p className="text-red-400 text-xs mt-1.5">Incorrect password</p>}
      </div>
      <Button
        type="submit"
        variant="primary"
        disabled={!password || loading}
        loading={loading}
        className="w-full justify-center rounded-xl py-3"
      >
        {loading ? 'Authenticating...' : 'Enter'}
      </Button>
    </form>
  )
}

function LoginFormFallback() {
  return (
    <form className="flex flex-col gap-3">
      <div>
        <Input
          type="password"
          placeholder="Enter password"
          autoFocus
          className="rounded-xl"
        />
      </div>
      <Button
        variant="primary"
        disabled
        className="w-full justify-center rounded-xl py-3"
      >
        Enter
      </Button>
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
          <h1 className="text-white text-xl font-semibold">KAOS</h1>
          <p className="text-white/40 text-sm mt-1">Mission Control</p>
        </div>
        <Suspense fallback={<LoginFormFallback />}>
          <LoginFormInner />
        </Suspense>
      </div>
    </div>
  )
}
