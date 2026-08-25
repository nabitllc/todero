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
