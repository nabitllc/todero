'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'

interface Props {
  from: string
  error?: boolean
}

export default function LoginForm({ from, error: initialError }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError ?? false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

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
      router.push(from)
      router.refresh()
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
