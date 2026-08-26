'use client'

// connections-discord — Settings: add Discord to a hub from scratch.
//
// FEEDBACK.md item 9: "Same way settings show connected tools, Discord should
// be there so something can be added per project ... good to set up something
// the user can add Discord from scratch to a hub."
//
// Card contract (components/nav/Card.tsx): one question, one number with the
// query that produced it, one action, an empty state that names its subject,
// and an error that REPLACES the body rather than sitting beside an empty list.
//
// The form is built from the `providers` catalog the API returns, not from a
// list kept here. If this file declared its own channel names they could drift
// from the validator in lib/connections.ts and the form would offer a field the
// API refuses.
//
// Nothing on this screen is ever the credential. The only credential-shaped
// thing rendered is `credential_hint` from the API — `••••` plus six
// characters — and the token input is write-only: it is cleared on submit and
// never populated from a response.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'

interface Props {
  /** Hub name; the id is resolved here, the way BoltScheduleCard does it. */
  hubName: string | null
}

interface ConfigKey { key: string; label: string; hint: string }
interface ProviderInfo { label: string; defaultEnvVar: string; credentialShape: string; configKeys: ConfigKey[] }
interface Connection {
  id: string
  provider: string
  display_name: string
  config: Record<string, string>
  custody: string
  credential_env_var: string | null
  credential_hint: string | null
  configured: boolean
  unconfigured_reason: string | null
  updated_at: string | null
}
interface Payload {
  connections: Connection[]
  providers: Record<string, ProviderInfo>
  encryption: { available: boolean; env_var: string }
  source: string
}
type TestResult = { tested: boolean; reachable?: boolean; ok?: boolean; status?: number; bot?: { username: string | null } | null; reason?: string; source?: string }

const ENDPOINT = '/api/connections/hub'

export default function ConnectionsCard({ hubName }: Props) {
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [custody, setCustody] = useState<'env' | 'stored'>('stored')
  const [token, setToken] = useState('')
  const [channels, setChannels] = useState<Record<string, string>>({})
  const [tests, setTests] = useState<Record<string, TestResult>>({})

  const source = `GET ${ENDPOINT}?business_id=${businessId ?? '<none>'}`

  const load = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`${ENDPOINT}?business_id=${encodeURIComponent(businessId)}`)
      if (!res.ok) { setError(await readApiError(res, ENDPOINT)); setLoaded(true); return }
      setData((await res.json()) as Payload)
      setError(null)
      setLoaded(true)
    } catch (e) {
      setError({ status: 0, endpoint: ENDPOINT, message: e instanceof Error ? e.message : 'could not reach the server' })
      setLoaded(true)
    }
  }, [businessId])

  useEffect(() => {
    if (!hubName) { setLoaded(true); return }
    let live = true
    ;(async () => {
      try {
        const res = await fetch('/api/businesses')
        if (!res.ok) { if (live) { setError(await readApiError(res, '/api/businesses')); setLoaded(true) } return }
        const rows = (await res.json()) as { id?: string; name?: string }[]
        if (live) setBusinessId(rows.find(b => b.name === hubName)?.id ?? null)
      } catch (e) {
        if (live) { setError({ status: 0, endpoint: '/api/businesses', message: e instanceof Error ? e.message : 'could not reach the server' }); setLoaded(true) }
      }
    })()
    return () => { live = false }
  }, [hubName])

  useEffect(() => { void load() }, [load])

  /** One writer for POST/PATCH/DELETE so no path can swallow a failure. */
  async function write(method: string, body: unknown, url = ENDPOINT): Promise<boolean> {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      if (!res.ok) {
        let why = text
        try { why = (JSON.parse(text) as { error?: string }).error ?? text } catch { /* raw text */ }
        setNotice(`${method} ${res.status}: ${why}`)
        return false
      }
      await load()
      return true
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the request did not complete')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addDiscord() {
    const spec = data?.providers.discord
    if (!businessId || !spec) return
    const ok = await write('POST', {
      business_id: businessId,
      provider: 'discord',
      display_name: spec.label,
      custody,
      credential: custody === 'stored' ? token : undefined,
      credential_env_var: custody === 'env' ? spec.defaultEnvVar : undefined,
      config: channels,
    })
    // Cleared whether or not the write succeeded — a token must not linger in
    // component state waiting to be re-sent by a stray click.
    setToken('')
    if (ok) { setOpen(false); setChannels({}) }
  }

  async function runTest(id: string) {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`${ENDPOINT}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      const body = (await res.json()) as TestResult & { error?: string }
      if (!res.ok && !body.reason) { setNotice(`test ${res.status}: ${body.error ?? 'failed'}`); return }
      setTests(t => ({ ...t, [id]: body }))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the test request did not complete')
    } finally { setBusy(false) }
  }

  // ── branches, in the order the contract requires ────────────────────────
  if (!hubName || (loaded && !businessId && !error)) {
    return <Card id="settings-connections" title="Connected tools" source={source}
      empty={{ active: true, message: `No hub is selected, so there are no connections to show. Pick a hub to add Discord to it.` }} />
  }
  // Error REPLACES the body. There is no branch below that can render an empty
  // list over a failed request.
  if (error) {
    return <Card id="settings-connections" title="Connected tools" source={source}><ApiErrorBanner error={error} onRetry={load} /></Card>
  }
  if (!loaded || !data) {
    return <Card id="settings-connections" title="Connected tools" source={source}><span className="text-white/40 text-sm">Loading…</span></Card>
  }

  const rows = data.connections
  const configured = rows.filter(c => c.configured).length
  const spec = data.providers.discord
  const hasDiscord = rows.some(c => c.provider === 'discord')

  return (
    <Card
      id="settings-connections"
      title="Connected tools"
      source={<>{source}<br />{data.source}</>}
      metric={{ value: `${configured}/${rows.length}`, label: 'usable now', tone: rows.length > 0 && configured === 0 ? 'amber' : 'default' }}
      action={hasDiscord || open ? undefined : { label: 'Add Discord', onClick: () => setOpen(true) }}
      empty={rows.length === 0 && !open ? { active: true, message: `${hubName} has no connected tools yet. Add Discord to send its issue notifications.` } : undefined}
    >
      <div className="space-y-3">
        {notice && <p className="text-amber-400 text-xs font-mono break-words">{notice}</p>}

        {rows.map(c => {
          const t = tests[c.id]
          return (
            <div key={c.id} className="rounded-lg border border-white/10 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white text-sm">{c.display_name}</span>
                <span className="font-mono text-[10px] text-white/40">{c.provider} · custody {c.custody}</span>
                {c.configured
                  ? <span className="text-emerald-400 text-[11px]">credential {c.credential_hint ?? '••••'}</span>
                  : <span className="text-amber-400 text-[11px]">not usable</span>}
              </div>
              {!c.configured && <p className="text-amber-400/80 text-[11px]">{c.unconfigured_reason}</p>}
              {c.custody === 'env' && c.credential_env_var && (
                <p className="text-white/30 text-[10px] font-mono">reads process.env.{c.credential_env_var} — nothing is stored</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {spec?.configKeys.map(k => (
                  <span key={k.key} className="text-[10px] font-mono text-white/35">
                    {k.key}: {c.config[k.key] ?? <span className="text-white/20">unset</span>}
                  </span>
                ))}
              </div>
              {t && (
                <p className="text-[11px] font-mono">
                  {!t.tested && <span className="text-white/45">not tested — {t.reason}</span>}
                  {t.tested && t.reachable === false && <span className="text-amber-400">could not reach Discord — {t.reason}. This says nothing about the credential.</span>}
                  {t.tested && t.reachable && t.ok && <span className="text-emerald-400">Discord answered: {t.bot?.username ?? 'bot'} (HTTP {t.status})</span>}
                  {t.tested && t.reachable && t.ok === false && <span className="text-red-400">Discord rejected the credential (HTTP {t.status})</span>}
                </p>
              )}
              <div className="flex gap-2 pt-0.5">
                <button disabled={busy} onClick={() => void runTest(c.id)} className="text-[11px] border border-white/15 rounded-md px-2 py-0.5 text-white/70 hover:text-white disabled:opacity-40">Test</button>
                <button disabled={busy} onClick={() => void write('DELETE', null, `${ENDPOINT}?id=${encodeURIComponent(c.id)}`)} className="text-[11px] border border-white/15 rounded-md px-2 py-0.5 text-white/50 hover:text-red-400 disabled:opacity-40">Remove</button>
              </div>
            </div>
          )
        })}

        {open && spec && (
          <div className="rounded-lg border border-white/15 p-3 space-y-2">
            <p className="text-white text-sm">Add {spec.label} to {hubName}</p>
            <div className="flex gap-2">
              {(['stored', 'env'] as const).map(mode => (
                <button key={mode} onClick={() => setCustody(mode)} aria-pressed={custody === mode}
                  className={`text-[11px] px-2 py-1 rounded-md border ${custody === mode ? 'bg-white text-[#0a0a0a] border-white' : 'text-white/50 border-white/10'}`}>
                  {mode === 'stored' ? 'Paste a token' : `Use ${spec.defaultEnvVar}`}
                </button>
              ))}
            </div>
            {custody === 'stored' ? (
              <>
                <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
                  placeholder="Bot token" aria-label="Discord bot token"
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1.5 text-white text-xs font-mono" />
                <p className="text-white/30 text-[10px]">{spec.credentialShape} Stored encrypted; never shown again.</p>
                {!data.encryption.available && (
                  <p className="text-amber-400 text-[11px]">{data.encryption.env_var} is not set on the server, so a pasted token cannot be stored encrypted. This will be refused rather than saved in plain text.</p>
                )}
              </>
            ) : (
              <p className="text-white/40 text-[11px] font-mono">The server reads process.env.{spec.defaultEnvVar} at send time. Nothing is stored.</p>
            )}
            {spec.configKeys.map(k => (
              <label key={k.key} className="block">
                <span className="text-white/50 text-[11px]">{k.label} <span className="text-white/25">— {k.hint}</span></span>
                <input value={channels[k.key] ?? ''} onChange={e => setChannels(c => ({ ...c, [k.key]: e.target.value }))}
                  placeholder="channel id" inputMode="numeric"
                  className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-1 text-white text-xs font-mono" />
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              <button disabled={busy} onClick={() => void addDiscord()} className="text-xs bg-white text-[#0a0a0a] rounded-md px-3 py-1 disabled:opacity-40">Save</button>
              <button disabled={busy} onClick={() => { setOpen(false); setToken('') }} className="text-xs border border-white/15 rounded-md px-3 py-1 text-white/60">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
