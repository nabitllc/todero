'use client'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
// TOD-2481: the SAME function the no-JS path already uses. Deliberately not a
// second implementation — an open redirect survived its first fix in this repo
// precisely because two code paths disagreed about what "safe" meant.
import { safeReturnPath } from '@/app/api/auth-form/return-path'

interface Props {
  from: string
  error?: boolean
}

export default function LoginForm({ from, error: initialError }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(false)
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      // MC-522: use hard navigation instead of router.push + router.refresh.
      // On mobile, the push→refresh sequence leaves Next.js router in a
      // pending state before hydration completes, making the app non-interactive.
      // A hard redirect guarantees a clean, fully-hydrated page load.
      // TOD-2481: `from` arrives from searchParams and is attacker-controlled.
      // MEASURED before the fix: GET /login?from=https%3A%2F%2Fevil.example.com
      // %2Fphish delivers evil.example.com/phish into this page, and this line
      // then navigated to it on the SUCCESS branch of a real login — handing the
      // operator to another site at the exact moment they are most likely to
      // trust the page, having just typed a password into it.
      window.location.href = safeReturnPath(from, window.location.origin)
    } else {
      setError(true)
      setLoading(false)
    }
  }

  return (
    // action + method provide a working no-JS / pre-hydration fallback
    <form
      onSubmit={handleSubmit}
      action="/api/auth-form"
      method="POST"
      className="flex flex-col gap-3"
    >
      {/* hidden so the server-side redirect can send the user to the right place */}
      <input type="hidden" name="from" value={from} />
      <div>
        <Input
          type="password"
          name="password"
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
        disabled={loading}
        loading={loading}
        className="w-full justify-center rounded-xl py-3"
      >
        {loading ? 'Authenticating...' : 'Enter'}
      </Button>
    </form>
  )
}
