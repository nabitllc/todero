/**
 * The seam's job is to fail loudly and specifically when the environment is
 * incomplete. The old code called the vendor constructor with '' and got back
 * "supabaseUrl is required" from inside node_modules — a message that names
 * neither the variable nor the file that needed it.
 */

const ENV_URL = 'NEXT_PUBLIC_SUPABASE_URL'
const ENV_KEY = 'SUPABASE_SERVICE_ROLE_KEY'

/** Load a fresh copy of the seam against the current process.env. */
function loadSeam() {
  let seam: typeof import('../db')
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    seam = require('../db')
  })
  // seam is assigned synchronously inside isolateModules
  return seam!
}

describe('lib/db seam', () => {
  const original = { url: process.env[ENV_URL], key: process.env[ENV_KEY] }

  afterEach(() => {
    if (original.url === undefined) delete process.env[ENV_URL]
    else process.env[ENV_URL] = original.url
    if (original.key === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original.key
    delete process.env.TODERO_DB_PROVIDER
  })

  it('reports the database as configured when both variables are present', () => {
    process.env[ENV_URL] = 'https://example.test'
    process.env[ENV_KEY] = 'test-key'
    const seam = loadSeam()
    expect(seam.isDbConfigured()).toBe(true)
    expect(seam.dbMissingEnv()).toEqual([])
  })

  it('names the missing variable instead of failing opaquely', () => {
    delete process.env[ENV_URL]
    process.env[ENV_KEY] = 'test-key'
    const seam = loadSeam()

    expect(seam.isDbConfigured()).toBe(false)
    expect(seam.dbMissingEnv()).toEqual([ENV_URL])

    expect(() => seam.db().from('issues')).toThrow(seam.DbConfigurationError)
    expect(() => seam.db().from('issues')).toThrow(ENV_URL)
    // The failure must not be the vendor's own opaque message.
    expect(() => seam.db().from('issues')).not.toThrow(/supabaseUrl is required/)
  })

  it('names every missing variable at once', () => {
    delete process.env[ENV_URL]
    delete process.env[ENV_KEY]
    const seam = loadSeam()
    expect(seam.dbMissingEnv()).toEqual([ENV_URL, ENV_KEY])
    expect(seam.dbStatusMessage()).toContain(ENV_URL)
    expect(seam.dbStatusMessage()).toContain(ENV_KEY)
  })

  it('rejects an unknown provider by name', () => {
    process.env.TODERO_DB_PROVIDER = 'mysql'
    const seam = loadSeam()
    expect(seam.DB_PROVIDER).toBe('mysql')
    expect(() => seam.db().from('issues')).toThrow(/Unknown database provider "mysql"/)
  })

  it('defaults the provider when TODERO_DB_PROVIDER is unset', () => {
    delete process.env.TODERO_DB_PROVIDER
    const seam = loadSeam()
    expect(seam.DB_PROVIDER).toBeTruthy()
    expect(seam.db().provider).toBe(seam.DB_PROVIDER)
  })
})

/**
 * A route that lets a `DbConfigurationError` escape returns a bare 500 with an
 * EMPTY body — the operator is told nothing and the variable name only reaches
 * the server log. `lib/db-http.ts` is the shared translation into a 503 that
 * names the variable in the response body.
 */
describe('lib/db-http', () => {
  const original = { url: process.env[ENV_URL], key: process.env[ENV_KEY] }

  afterEach(() => {
    if (original.url === undefined) delete process.env[ENV_URL]
    else process.env[ENV_URL] = original.url
    if (original.key === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original.key
  })

  function loadHttp() {
    let mod: typeof import('../db-http')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../db-http')
    })
    return mod!
  }

  it('passes the request through when the database is configured', () => {
    process.env[ENV_URL] = 'https://example.test'
    process.env[ENV_KEY] = 'test-key'
    expect(loadHttp().dbUnavailableResponse()).toBeNull()
  })

  it('answers 503 naming the missing variable, never an empty 500', async () => {
    delete process.env[ENV_URL]
    process.env[ENV_KEY] = 'test-key'

    const res = loadHttp().dbUnavailableResponse()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(503)

    const body = await res!.json()
    expect(body.missingEnv).toEqual([ENV_URL])
    expect(body.error).toContain(ENV_URL)
    expect(body.error).not.toMatch(/supabaseUrl is required/)
  })

  it('maps a caught DbConfigurationError onto the same 503 body', async () => {
    delete process.env[ENV_URL]
    delete process.env[ENV_KEY]
    // Both modules must come from the SAME isolated registry, or the
    // `instanceof` check compares two different copies of the class.
    let http: typeof import('../db-http')
    let DbConfigurationError: typeof import('../db').DbConfigurationError
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      http = require('../db-http')
      DbConfigurationError = require('../db').DbConfigurationError
      /* eslint-enable @typescript-eslint/no-var-requires */
    })

    expect(http!.dbErrorResponse(new Error('some query blew up'))).toBeNull()

    const res = http!.dbErrorResponse(new DbConfigurationError!('Missing bits', [ENV_URL, ENV_KEY]))
    expect(res!.status).toBe(503)
    await expect(res!.json()).resolves.toEqual({
      error: 'Missing bits',
      missingEnv: [ENV_URL, ENV_KEY],
    })
  })
})

/**
 * The Board had no agent id to put in `transitioned_by`, so the workflow guard
 * rejected every drag the owner made. The actor is now derived from the session
 * — and only for the owner, so viewers and unauthenticated agent callers are
 * refused exactly as before.
 */
describe('session actor', () => {
  /** Minimal stand-in for the cookie surface the resolver reads. */
  function reqWith(cookies: Record<string, string>) {
    return {
      cookies: {
        get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined),
      },
    } as unknown as import('next/server').NextRequest
  }

  function loadActor() {
    let mod: typeof import('../session-actor')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../session-actor')
    })
    return mod!
  }

  it('names the owner so the workflow guard has an actor', () => {
    expect(loadActor().resolveSessionActor(reqWith({ 'mc-auth': 'kaos2026', 'mc-role': 'owner' })))
      .toBe('michael')
  })

  it('accepts the legacy admin role the no-JS login form writes', () => {
    expect(loadActor().resolveSessionActor(reqWith({ 'mc-auth': 'kaos2026', 'mc-role': 'admin' })))
      .toBe('michael')
  })

  it('leaves a viewer unnamed so the guard still refuses them', () => {
    expect(loadActor().resolveSessionActor(reqWith({ 'mc-auth': 'view2026', 'mc-role': 'viewer' })))
      .toBeUndefined()
  })

  it('leaves an agent caller unnamed — no session cookie, no free identity', () => {
    expect(loadActor().resolveSessionActor(reqWith({}))).toBeUndefined()
    // A forged role without a valid session password gains nothing.
    expect(loadActor().resolveSessionActor(reqWith({ 'mc-role': 'owner' }))).toBeUndefined()
    expect(loadActor().resolveSessionActor(reqWith({ 'mc-auth': 'wrong', 'mc-role': 'owner' })))
      .toBeUndefined()
  })
})
