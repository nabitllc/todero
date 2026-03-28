'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Isolated to its own component so useSearchParams doesn't cause full-page Suspense bailout
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 12,
            background: '#111',
            border: '1px solid #333',
            color: '#fff',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>Incorrect password</p>}
      </div>
      <button
        type="submit"
        disabled={!password || loading}
        style={{
          width: '100%',
          padding: '12px 0',
          borderRadius: 12,
          background: password && !loading ? '#3f3f46' : '#27272a',
          border: 'none',
          color: '#fff',
          fontSize: 14,
          fontWeight: 500,
          cursor: password && !loading ? 'pointer' : 'not-allowed',
          opacity: password && !loading ? 1 : 0.5,
        }}
      >
        {loading ? 'Authenticating...' : 'Enter'}
      </button>
    </form>
  )
}

function LoginFormFallback() {
  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <input
          type="password"
          placeholder="Enter password"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 12,
            background: '#111',
            border: '1px solid #333',
            color: '#fff',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <button
        disabled
        style={{
          width: '100%',
          padding: '12px 0',
          borderRadius: 12,
          background: '#27272a',
          border: 'none',
          color: '#fff',
          fontSize: 14,
          fontWeight: 500,
          opacity: 0.5,
        }}
      >
        Enter
      </button>
    </form>
  )
}

export default function Login() {
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#080808',
    }}>
      <div style={{ width: '100%', maxWidth: 360, padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: '#27272a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, margin: '0 auto 16px',
          }}>🧠</div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: 0 }}>KAOS</h1>
          <p style={{ color: '#71717a', fontSize: 14, margin: '4px 0 0' }}>Mission Control</p>
        </div>
        <Suspense fallback={<LoginFormFallback />}>
          <LoginFormInner />
        </Suspense>
      </div>
    </div>
  )
}
