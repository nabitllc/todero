/**
 * The seam's job is to fail loudly and specifically when the environment is
 * incomplete. The old code called the vendor constructor with '' and got back
 * "supabaseUrl is required" from inside node_modules — a message that names
 * neither the variable nor the file that needed it.
 */

import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PGlite } from '@electric-sql/pglite'
import type { DbAdapterFactory } from '../db'

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
  const original = {
    url: process.env[ENV_URL],
    key: process.env[ENV_KEY],
    database: process.env.DATABASE_URL,
  }

  afterEach(() => {
    if (original.url === undefined) delete process.env[ENV_URL]
    else process.env[ENV_URL] = original.url
    if (original.key === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original.key
    if (original.database === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original.database
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
    // Pinned, because with NOTHING set the seam no longer resolves to this
    // provider at all — see the zero-configuration test below.
    process.env.TODERO_DB_PROVIDER = 'supabase'
    delete process.env[ENV_URL]
    delete process.env[ENV_KEY]
    const seam = loadSeam()
    expect(seam.dbMissingEnv()).toEqual([ENV_URL, ENV_KEY])
    expect(seam.dbStatusMessage()).toContain(ENV_URL)
    expect(seam.dbStatusMessage()).toContain(ENV_KEY)
  })

  // The clone-to-running promise, at the level of the seam: a checkout with no
  // credentials of any kind must still resolve to a usable database, or
  // `npm run setup` cannot finish and every data route answers 503.
  it('falls back to the file-backed provider when nothing at all is configured', () => {
    delete process.env[ENV_URL]
    delete process.env[ENV_KEY]
    delete process.env.DATABASE_URL
    const seam = loadSeam()
    expect(seam.DB_PROVIDER).toBe('sqlite')
    expect(seam.dbMissingEnv()).toEqual([])
    expect(seam.isDbConfigured()).toBe(true)
  })

  it('does not mistake a template placeholder for a configured host', () => {
    process.env[ENV_URL] = 'https://YOUR_PROJECT.supabase.co'
    delete process.env[ENV_KEY]
    delete process.env.DATABASE_URL
    expect(loadSeam().DB_PROVIDER).toBe('sqlite')
  })

  it('keeps a configured host on its own provider', () => {
    process.env[ENV_URL] = 'https://example.test'
    process.env[ENV_KEY] = 'test-key'
    expect(loadSeam().DB_PROVIDER).toBe('supabase')

    delete process.env[ENV_URL]
    delete process.env[ENV_KEY]
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/todero'
    expect(loadSeam().DB_PROVIDER).toBe('postgres')
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

// ─── One query set, two providers ────────────────────────────────────────────
//
// A seam is only worth having if a SECOND adapter can satisfy it without
// re-implementing the first one's wire format. This suite is the proof: one
// list of `DbQueryBuilder` calls, run through both registered providers.
//
//   postgres — `lib/db/pg-adapter.ts`. Compiles every call to a parameterised
//              SQL statement and runs it on a real Postgres (PGlite, in-process)
//              built from this repo's own `migrations/*.sql`.
//   supabase — the hosted adapter. Translates the same calls into its HTTP
//              query layer; `restBridge()` below replays those requests against
//              the SAME physical Postgres, parsing them with the app's own
//              `lib/db/query-params.ts`. So both legs read and write real rows
//              in a real database — neither leg is a fixture.
//
// A method only one of them can express fails this suite. That is the guard
// against `DbQueryBuilder` quietly re-growing one vendor's query dialect.

/** Migrations that stand on their own — enough schema for the whole query set. */
const MIGRATION_SEED: ReadonlyArray<{ file: string; upTo?: string }> = [
  { file: '016_agent_documents.sql' },
  { file: '035_connections_table.sql' },
  // Only the part before this marker. The rest of 021 alters `issues`, whose
  // base DDL predates this migrations directory (it was created in the hosted
  // vendor's dashboard) and so cannot be replayed from the repo.
  { file: '021_issue_sequences.sql', upTo: '-- 3. UNIQUE constraint' },
]

async function seededPostgres(): Promise<PGlite> {
  const pg = await PGlite.create()
  for (const { file, upTo } of MIGRATION_SEED) {
    const sql = readFileSync(join(__dirname, '..', '..', 'migrations', file), 'utf8')
    await pg.exec(upTo ? sql.slice(0, sql.indexOf(upTo)) : sql)
  }
  return pg
}

/** The `SqlExecutor` the postgres adapter needs, backed by in-process Postgres. */
function pgliteExecutor(pg: PGlite) {
  return {
    async query(text: string, values: readonly unknown[]) {
      const result = await pg.query(text, values as unknown[])
      const rows = result.rows as Array<Record<string, unknown>>
      return { rows, rowCount: result.affectedRows ?? rows.length }
    },
  }
}

type QueryParams = typeof import('../db/query-params')

/** Body + status for one bridged response. */
function respond(body: string | null, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/**
 * Answers the hosted adapter's HTTP requests out of the same Postgres the
 * postgres adapter is using. Deliberately built from shipped code —
 * `query-params.ts` parses the request, `pg-adapter.ts` executes it — so the
 * test harness cannot accidentally be more capable than the app.
 */
function restBridge(pgFactory: DbAdapterFactory, qp: QueryParams) {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    const method = (init.method ?? 'GET').toUpperCase()
    const prefer = headers.get('Prefer') ?? ''
    const accept = headers.get('Accept') ?? ''
    const params = url.searchParams
    const adapter = pgFactory.create()
    const path = url.pathname.replace(/^.*\/rest\/v1\//, '')

    if (path.startsWith('rpc/')) {
      const args = init.body ? JSON.parse(String(init.body)) : {}
      const rpcResult = await adapter.rpc(path.slice(4), args)
      if (rpcResult.error) return respond(JSON.stringify(rpcResult.error), 400)
      return respond(JSON.stringify(rpcResult.data), 200)
    }

    const shape = qp.readQueryShape(params)
    const wantsRows = method === 'GET' || prefer.includes('return=representation')
    const wantsCount = /count=(exact|planned|estimated)/.test(prefer)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    let builder = adapter.from(path)

    if (method === 'GET' || method === 'HEAD') {
      builder = builder.select(shape.select, {
        ...(wantsCount ? { count: 'exact' as const } : {}),
        head: method === 'HEAD',
      })
      builder = qp.applyFilters(builder, params)
      builder = qp.applyShaping(builder, params)
    } else if (method === 'POST') {
      builder = prefer.includes('resolution=merge-duplicates')
        ? builder.upsert(body, shape.onConflict ? { onConflict: shape.onConflict } : undefined)
        : builder.insert(body)
      if (wantsRows) builder = builder.select(shape.select)
    } else if (method === 'PATCH') {
      builder = qp.applyFilters(builder.update(body), params)
      if (wantsRows) builder = builder.select(shape.select)
    } else if (method === 'DELETE') {
      builder = qp.applyFilters(builder.delete(), params)
      if (wantsRows) builder = builder.select(shape.select)
    } else {
      return respond(JSON.stringify({ message: `unsupported method ${method}` }), 405)
    }

    const result = await builder
    if (result.error) return respond(JSON.stringify(result.error), 400)

    const range: Record<string, string> = wantsCount
      ? { 'Content-Range': `0-0/${result.count ?? 0}` }
      : {}
    if (method === 'HEAD') return respond(null, 200, range)

    const rows = Array.isArray(result.data)
      ? result.data
      : result.data == null
        ? []
        : [result.data]

    if (accept.includes('application/vnd.pgrst.object+json')) {
      if (rows.length !== 1) {
        return respond(
          JSON.stringify({
            code: 'PGRST116',
            details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
            hint: null,
            message: 'JSON object requested, multiple (or no) rows returned',
          }),
          406,
          range,
        )
      }
      return respond(JSON.stringify(rows[0]), 200, range)
    }

    if (!wantsRows) return respond('', method === 'POST' ? 201 : 204, range)
    return respond(JSON.stringify(rows), 200, range)
  }
}

/**
 * The `sqlite` leg's schema, from the file `npm run setup` applies on a clone
 * with no account anywhere: `migrations/sqlite/000_baseline.sql`. File-backed,
 * not `:memory:`, because that is the mode the app actually runs in.
 */
function seededSqlite(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const file = join(
    tmpdir(),
    `todero-seam-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  const seed = new DatabaseSync(file)
  seed.exec(readFileSync(join(__dirname, '..', '..', 'migrations', 'sqlite', '000_baseline.sql'), 'utf8'))
  seed.close()
  return file
}

describe.each(['postgres', 'supabase', 'sqlite'] as const)(
  'the same query set through the %s adapter',
  provider => {
    let seam: typeof import('../db')
    let adapter: import('../db').DbAdapter
    let pg: PGlite | null = null
    let sqliteFile: string | null = null
    let sqliteMod: typeof import('../db/sqlite-adapter') | null = null
    let realFetch: typeof globalThis.fetch

    const previous = {
      provider: process.env.TODERO_DB_PROVIDER,
      url: process.env[ENV_URL],
      key: process.env[ENV_KEY],
      database: process.env.DATABASE_URL,
      sqlite: process.env.TODERO_SQLITE_PATH,
    }

    beforeAll(async () => {
      if (provider === 'sqlite') {
        sqliteFile = seededSqlite()
        process.env.TODERO_DB_PROVIDER = 'sqlite'
        process.env.TODERO_SQLITE_PATH = sqliteFile
        jest.isolateModules(() => {
          /* eslint-disable @typescript-eslint/no-var-requires */
          sqliteMod = require('../db/sqlite-adapter')
          seam = require('../db')
          /* eslint-enable @typescript-eslint/no-var-requires */
        })
        adapter = seam.db()
        expect(adapter.provider).toBe('sqlite')
        // The whole point of this provider: nothing to configure.
        expect(adapter.missingEnv()).toEqual([])
        return
      }

      pg = await seededPostgres()

      process.env.TODERO_DB_PROVIDER = provider
      process.env.DATABASE_URL = 'postgresql://seam-test/in-process'
      process.env[ENV_URL] = 'https://seam.test'
      process.env[ENV_KEY] = 'seam-test-key'

      let pgAdapter: typeof import('../db/pg-adapter')
      let queryParams: QueryParams
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        pgAdapter = require('../db/pg-adapter')
        queryParams = require('../db/query-params')
        seam = require('../db')
        /* eslint-enable @typescript-eslint/no-var-requires */
      })

      pgAdapter!.setSqlExecutor(pgliteExecutor(pg))
      realFetch = globalThis.fetch
      globalThis.fetch = restBridge(
        pgAdapter!.pgAdapterFactory,
        queryParams!,
      ) as unknown as typeof globalThis.fetch

      adapter = seam.db()
      expect(adapter.provider).toBe(provider)
      expect(adapter.missingEnv()).toEqual([])
    })

    afterAll(async () => {
      if (realFetch) globalThis.fetch = realFetch
      if (pg) await pg.close()
      if (sqliteFile) {
        sqliteMod?.closeSqlite()
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            unlinkSync(sqliteFile + suffix)
          } catch {
            // already gone, or still held open on Windows — a temp file either way
          }
        }
      }
      if (previous.provider === undefined) delete process.env.TODERO_DB_PROVIDER
      else process.env.TODERO_DB_PROVIDER = previous.provider
      if (previous.database === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous.database
      if (previous.url === undefined) delete process.env[ENV_URL]
      else process.env[ENV_URL] = previous.url
      if (previous.key === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = previous.key
      if (previous.sqlite === undefined) delete process.env.TODERO_SQLITE_PATH
      else process.env.TODERO_SQLITE_PATH = previous.sqlite
    })

    it('inserts rows and returns them when asked', async () => {
      const { data, error } = await adapter
        .from('agent_documents')
        .insert([
          { agent_id: 'kaos', doc_type: 'soul', slug: 'soul', content: 'kaos soul' },
          { agent_id: 'kaos', doc_type: 'heartbeat', slug: 'hb', content: 'kaos heartbeat' },
          { agent_id: 'global', doc_type: 'agents', slug: 'agents', content: 'shared handbook' },
          { agent_id: 'builder', doc_type: 'soul', slug: 'soul', content: 'builder soul' },
        ])
        .select()

      expect(error).toBeNull()
      expect(data).toHaveLength(4)
      expect(data.map((row: Record<string, unknown>) => row.agent_id).sort()).toEqual([
        'builder',
        'global',
        'kaos',
        'kaos',
      ])
    })

    it('insert without select() reports no rows, exactly like the other provider', async () => {
      const { data, error } = await adapter
        .from('connections')
        .insert({ workspace_id: 'w1', type: 'github', encrypted_value: 'x' })
      expect(error).toBeNull()
      expect(data).toBeNull()
    })

    // This is the live query from app/api/agents/[id]/files/route.ts, verbatim.
    it('runs a disjunction expressed as predicates, not as grammar', async () => {
      const { data, error } = await adapter
        .from('agent_documents')
        .select('agent_id, doc_type, content')
        .or([
          { column: 'agent_id', op: 'eq', value: 'kaos' },
          { column: 'agent_id', op: 'eq', value: 'global' },
        ])
        .in('doc_type', ['soul', 'heartbeat', 'agents'])
        .order('doc_type', { ascending: true })

      expect(error).toBeNull()
      expect(data.map((row: Record<string, unknown>) => `${row.agent_id}/${row.doc_type}`)).toEqual([
        'global/agents',
        'kaos/heartbeat',
        'kaos/soul',
      ])
      // The disjunction really excluded the third agent.
      expect(data).toHaveLength(3)
    })

    it('filters with eq, neq, like, ilike and is', async () => {
      const eq = await adapter.from('agent_documents').select('slug').eq('agent_id', 'builder')
      expect(eq.error).toBeNull()
      expect(eq.data).toHaveLength(1)

      const neq = await adapter.from('agent_documents').select('agent_id').neq('agent_id', 'kaos')
      expect(neq.data.map((r: Record<string, unknown>) => r.agent_id).sort()).toEqual([
        'builder',
        'global',
      ])

      const like = await adapter.from('agent_documents').select('content').like('content', 'kaos%')
      expect(like.data).toHaveLength(2)

      const ilike = await adapter.from('agent_documents').select('content').ilike('content', 'KAOS%')
      expect(ilike.data).toHaveLength(2)

      const isNull = await adapter.from('agent_documents').select('slug').is('updated_by', null)
      expect(isNull.data).toHaveLength(4)
    })

    it('negates a comparison, including a negated list', async () => {
      const notIn = await adapter
        .from('agent_documents')
        .select('doc_type')
        .not('doc_type', 'in', ['soul', 'heartbeat'])
      expect(notIn.error).toBeNull()
      expect(notIn.data.map((r: Record<string, unknown>) => r.doc_type)).toEqual(['agents'])

      const notNull = await adapter
        .from('agent_documents')
        .select('slug')
        .not('updated_at', 'is', null)
      expect(notNull.data).toHaveLength(4)
    })

    it('orders, limits and windows the result', async () => {
      const ordered = await adapter
        .from('agent_documents')
        .select('agent_id, slug')
        .order('agent_id', { ascending: true })
        .order('slug', { ascending: true })
      expect(ordered.data.map((r: Record<string, unknown>) => r.agent_id)).toEqual([
        'builder',
        'global',
        'kaos',
        'kaos',
      ])

      const limited = await adapter
        .from('agent_documents')
        .select('agent_id')
        .order('agent_id', { ascending: true })
        .limit(2)
      expect(limited.data).toHaveLength(2)

      const windowed = await adapter
        .from('agent_documents')
        .select('agent_id')
        .order('agent_id', { ascending: true })
        .range(1, 2)
      expect(windowed.data.map((r: Record<string, unknown>) => r.agent_id)).toEqual([
        'global',
        'kaos',
      ])
    })

    it('counts rows, with and without fetching them', async () => {
      const counted = await adapter
        .from('agent_documents')
        .select('*', { count: 'exact' })
        .eq('agent_id', 'kaos')
      expect(counted.count).toBe(2)
      expect(counted.data).toHaveLength(2)

      const headOnly = await adapter
        .from('agent_documents')
        .select('*', { count: 'exact', head: true })
      expect(headOnly.count).toBe(4)
    })

    it('matches on several columns at once', async () => {
      const { data, error } = await adapter
        .from('agent_documents')
        .select('content')
        .match({ agent_id: 'kaos', doc_type: 'soul' })
      expect(error).toBeNull()
      expect(data).toEqual([{ content: 'kaos soul' }])
    })

    it('resolves exactly one row, or says why it could not', async () => {
      const one = await adapter
        .from('agent_documents')
        .select('content')
        .eq('agent_id', 'builder')
        .single()
      expect(one.error).toBeNull()
      expect(one.data).toEqual({ content: 'builder soul' })

      const none = await adapter
        .from('agent_documents')
        .select('content')
        .eq('agent_id', 'nobody')
        .single()
      expect(none.data).toBeNull()
      expect(none.error?.code).toBe('PGRST116')

      const maybe = await adapter
        .from('agent_documents')
        .select('content')
        .eq('agent_id', 'nobody')
        .maybeSingle()
      expect(maybe.error).toBeNull()
      expect(maybe.data).toBeNull()
    })

    it('updates rows and returns what changed', async () => {
      const { data, error } = await adapter
        .from('agent_documents')
        .update({ content: 'kaos soul v2', updated_by: 'michael' })
        .eq('agent_id', 'kaos')
        .eq('doc_type', 'soul')
        .select('content, updated_by')
      expect(error).toBeNull()
      expect(data).toEqual([{ content: 'kaos soul v2', updated_by: 'michael' }])
    })

    it('upserts on a named conflict target', async () => {
      const merged = await adapter
        .from('agent_documents')
        .upsert(
          { agent_id: 'kaos', doc_type: 'soul', slug: 'soul', content: 'kaos soul v3' },
          { onConflict: 'agent_id,doc_type,slug' },
        )
        .select('content')
      expect(merged.error).toBeNull()
      expect(merged.data).toEqual([{ content: 'kaos soul v3' }])

      const total = await adapter.from('agent_documents').select('*', { count: 'exact', head: true })
      expect(total.count).toBe(4)
    })

    it('attaches a related table without an embedded-select dialect', async () => {
      // The UPDATE above fired the migration's history trigger, so there is a
      // real child row pointing at a real parent.
      const { data, error } = await adapter
        .from('agent_document_history')
        .select('content, document_id')
        .join({
          table: 'agent_documents',
          columns: ['agent_id', 'doc_type'],
          localColumn: 'document_id',
        })
      expect(error).toBeNull()
      expect(data.length).toBeGreaterThan(0)
      expect(data[0].agent_documents).toEqual({ agent_id: 'kaos', doc_type: 'soul' })
    })

    it('calls a stored procedure defined by a migration', async () => {
      const first = await adapter.rpc('next_issue_number', { p_prefix: 'TOD' })
      expect(first.error).toBeNull()
      expect(Number(first.data)).toBe(1)

      const second = await adapter.rpc('next_issue_number', { p_prefix: 'TOD' })
      expect(Number(second.data)).toBe(2)
    })

    it('deletes rows and returns them', async () => {
      const deleted = await adapter
        .from('agent_documents')
        .delete()
        .eq('agent_id', 'builder')
        .select('agent_id')
      expect(deleted.error).toBeNull()
      expect(deleted.data).toEqual([{ agent_id: 'builder' }])

      const left = await adapter.from('agent_documents').select('*', { count: 'exact', head: true })
      expect(left.count).toBe(3)
    })

    it('reports a database error instead of throwing it', async () => {
      const { data, error } = await adapter.from('table_that_does_not_exist').select('*')
      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(String(error?.message)).toMatch(/table_that_does_not_exist/)
    })
  },
)
