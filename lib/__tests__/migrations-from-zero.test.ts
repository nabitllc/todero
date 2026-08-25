/**
 * Mechanical proof for the claim `npm run db:migrate` makes to every
 * operator: "one command turns migrations/ into a schema."
 *
 * A round that only fixed /api/health to REPORT the gap, without ever
 * running the migrations against an empty database, shipped that claim
 * false — 12 of 26 required tables (issues, agents, agent_runs, sprints,
 * projects, chat_conversations, chat_messages, businesses, milestones,
 * workflow_transitions, role_permissions, quick_actions) had no CREATE
 * TABLE anywhere in migrations/, so a fresh clone aborted on the very first
 * file (001_add_review_fields.sql: `relation "issues" does not exist`).
 *
 * This test boots a genuinely empty PGlite Postgres, applies every
 * migrations/*.sql file in filename order — same order scripts/db-migrate.mjs
 * uses — and asserts every table GENERATED_REQUIRED_TABLES lists now exists.
 * It runs on every `npm test`, so the claim can never go quietly false again.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { PGlite } from '@electric-sql/pglite'
import { GENERATED_REQUIRED_TABLES } from '../required-tables.generated'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

describe('npm run db:migrate, run against a genuinely empty database', () => {
  it('creates every table the app requires, with zero manual setup', async () => {
    const pg = await PGlite.create()

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()
    expect(files.length).toBeGreaterThan(0)

    const applied: string[] = []
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      try {
        await pg.exec(sql)
        applied.push(file)
      } catch (err) {
        throw new Error(
          `migrations/${file} failed to apply against a fresh database ` +
            `(${applied.length} of ${files.length} applied before this: ` +
            `${applied.slice(-3).join(', ') || 'none'}).\n` +
            `This is the exact failure a stranger cloning the repo and running ` +
            `\`npm run db:migrate\` would hit.\n` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    const { rows } = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )
    const created = new Set(rows.map(r => r.tablename))

    const missing = GENERATED_REQUIRED_TABLES.filter(t => !created.has(t))
    expect(missing).toEqual([])

    await pg.close()
  }, 60_000)
})
