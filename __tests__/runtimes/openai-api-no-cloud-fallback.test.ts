// Regression guard for the silent-cloud-substitution class of defect.
//
// Two things used to happen without the operator being told: an unset
// LLM_BASE_URL became `https://api.openai.com/v1`, and the model tier `sonnet`
// became `gpt-4o` whether or not the configured endpoint served it. Both are
// now failures that name what is missing.

import { mapModel, resolveProvider, ProviderConfigError } from '@/lib/runtimes/openai-api'

const ORIGINAL = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('resolveProvider', () => {
  it('throws naming LLM_BASE_URL rather than defaulting to a cloud endpoint', () => {
    delete process.env.LLM_BASE_URL
    delete process.env.OPENAI_BASE_URL
    expect(() => resolveProvider()).toThrow(ProviderConfigError)
    expect(() => resolveProvider()).toThrow(/LLM_BASE_URL is not set/)
  })

  it('uses the configured endpoint verbatim, minus trailing slashes', () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1//'
    expect(resolveProvider().baseUrl).toBe('http://localhost:11434/v1')
    expect(resolveProvider().isLocal).toBe(true)
  })
})

describe('mapModel', () => {
  it('returns null — never a vendor id — when the roster cannot be read', async () => {
    // Port 1 has nothing on it, so the live /models GET fails. The old code
    // would still have produced 'gpt-4o' here.
    process.env.LLM_BASE_URL = 'http://127.0.0.1:1/v1'
    jest.resetModules()
    const fresh = await import('@/lib/runtimes/openai-api')
    await expect(fresh.mapModel('sonnet')).resolves.toBeNull()
    await expect(fresh.mapModel('opus')).resolves.toBeNull()
    await expect(fresh.mapModel('haiku')).resolves.toBeNull()
  })
})
