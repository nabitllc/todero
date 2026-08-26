// ─── Schema preflight ─────────────────────────────────────────────────────
//
// Tables the app queries directly but that a fresh clone's database will not
// have until `npm run db:migrate` runs. Listed here once so /api/health and
// any route that depends on one of them can check the same list instead of
// each guessing independently.
//
// This does NOT run raw SQL — it goes through the same `lib/db.ts` seam every
// route uses, so it works unmodified against either adapter (`supabase` or
// `postgres`) and reports the schema as the app itself would see it.
//
// WHY THIS CHECKS SHAPE, NOT JUST EXISTENCE (agent-memory-shape piece)
//   This file used to probe every table with `.select('id').limit(1)` and
//   report only whether the table existed. That is how `agent_memory` sat at
//   the wrong shape for months while /api/health reported green: the table
//   existed, it had an `id`, and two shipped features were failing against it
//   the whole time —
//     GET /api/settings/cost-history  -> 502 `no such column: "value"`
//     PATCH /api/agent-pause          -> 500 `no column named key`
//   A guard that answers "the table is there" while the feature is broken is
//   reporting confidence it has not earned. Existence is not health.
//
//   The `id` assumption was independently wrong, too: `agent_budgets`,
//   `agent_heartbeats`, `agent_manifests` and `hub_settings` have no `id`
//   column at all. On SQLite that probe errored with "no such column" and was
//   silently discarded (it is not a missing-TABLE error); on PostgREST the
//   same failure carries the "schema cache" wording this repo detects on, so
//   four perfectly healthy tables would have been reported MISSING. Both
//   directions of that bug go away by probing a column each table actually has.

import { db, isDbConfigured } from '@/lib/db'
import { isMissingTableError } from '@/lib/db-http'
import { GENERATED_REQUIRED_TABLES } from '@/lib/required-tables.generated'

/**
 * Tables that must exist before the routes that depend on them can work.
 * Sourced from `lib/required-tables.generated.ts` (regenerate with
 * `npm run generate:required-tables`) — every table any route actually
 * queries, not a hand-picked subset that quietly drifts from the code.
 */
export const REQUIRED_TABLES = GENERATED_REQUIRED_TABLES

export type RequiredTable = (typeof REQUIRED_TABLES)[number]

/**
 * One column per table that the correct shape MUST have, used as the shape
 * probe. A table that exists but cannot answer for its probe column is
 * reported malformed rather than healthy.
 *
 * HOW TO CHOOSE AN ENTRY — the rule that keeps this guard honest:
 *   1. Pick a column that carries the table's PURPOSE, not its bookkeeping.
 *      `id`/`created_at` exist on almost every shape a table could drift
 *      into, so probing them proves nothing. `agent_memory.key` is the whole
 *      point of `agent_memory`; the daily-notes shape cannot fake it.
 *   2. READ the column off the running store before adding it here — the same
 *      rule this piece exists to enforce. A probe pointed at a column that
 *      does not exist reports a healthy table as broken, which is the mirror
 *      image of the defect above and just as dishonest.
 *   3. Every column below was read from `pragma_table_info` against the live
 *      database, not copied from a migration file.
 *
 * A table with no entry falls back to an existence-only probe. That is a
 * weaker check, and deliberately not silent: it is what `unprobed` reports.
 */
export const TABLE_PROBE_COLUMNS: Partial<Record<RequiredTable, string>> = {
  activity_events: 'event_type',
  agent_budgets: 'agent_id',
  agent_cost_log: 'cost_usd',
  agent_document_history: 'document_id',
  agent_documents: 'doc_type',
  agent_heartbeats: 'last_seen',
  agent_manifests: 'agent_id',
  // The column this whole piece is about. `agent_memory` is the key/value
  // store — see migrations/062_agent_memory_kv.sql. The daily-notes shape it
  // used to carry has no `key`, so this probe is what catches a regression.
  agent_memory: 'key',
  // Its opposite number: `agent_memory_files` IS the daily-notes table, and
  // must keep `memory_type`. Probing both pins the split in place.
  agent_memory_files: 'memory_type',
  agent_registrations: 'capabilities',
  agent_run_records: 'task_key',
  agent_runs: 'status',
  agents: 'adapter',
  approval_decisions: 'decision',
  businesses: 'name',
  chat_conversations: 'model',
  chat_messages: 'conversation_id',
  // TOD-2441: the seven tables wave 3 added. A required table with no probe
  // falls back to existence-only, which is the weaker check this file exists to
  // replace — and the agent-kv suite fails when any required table lacks one,
  // which is how these were caught the moment required-tables was regenerated.
  //
  // Each probes the column that carries the table's REASON to exist, so a
  // regression to a plausible-but-wrong shape is caught rather than tolerated.
  commerce_actions: 'from_value',
  connections: 'encrypted_value',
  // The approve-before-send rule lives in a CHECK over these two columns
  // (migrations/063). Probing them pins the rule's storage in place.
  conversation_messages: 'approved_at',
  conversations: 'channel',
  inventory_levels: 'on_hand',
  order_line_items: 'unit_price_minor',
  // Money is an integer count of minor units, never a float — the one thing
  // about these two tables that must not silently change.
  orders: 'total_minor',
  products: 'price_minor',
  deploy_history: 'commit_sha',
  hub_settings: 'key',
  inbox: 'context',
  issues: 'task_key',
  milestones: 'project',
  notifications: 'issue_key',
  projects: 'repo_url',
  quick_actions: 'action_type',
  releases: 'commit_sha',
  role_permissions: 'permission',
  run_steps: 'step_no',
  sprints: 'sprint_number',
  token_ledger: 'total_tokens',
  workflow_transitions: 'from_status',
  workspace_members: 'identity',
  workspaces: 'slug',
}

/** A table that exists but does not have the shape the app requires. */
export interface ShapeMismatch {
  table: RequiredTable
  /** The column that should have been there and was not. */
  column: string
  /** What the store said when asked for it. */
  error: string
}

export interface SchemaCheck {
  /** Tables that do not exist at all. */
  missing: RequiredTable[]
  /** Tables that exist but answered the wrong shape. */
  malformed: ShapeMismatch[]
  /** Tables checked for existence only, because no probe column is declared. */
  unprobed: RequiredTable[]
}

/**
 * Probe each required table and report which ones are missing and which ones
 * exist at the wrong shape. Any other kind of error (bad credentials, network)
 * is not treated as either — that is a different failure the caller should
 * surface on its own terms, not conflate with an unmigrated schema.
 *
 * Two probes per table, deliberately, rather than one clever one. Asking for
 * the shape column alone cannot distinguish "no such table" from "no such
 * column" portably: PostgREST reports BOTH with the same "schema cache"
 * wording this repo's `isMissingTableError` keys on. Establishing existence
 * first means the second probe's failure has only one possible meaning.
 */
export async function checkRequiredTables(): Promise<SchemaCheck> {
  if (!isDbConfigured()) {
    // Can't tell what's missing if we can't even connect — but we also can't
    // claim the schema is fine. Report everything as unknown-missing so
    // health still fails loudly rather than defaulting to green.
    return { missing: [...REQUIRED_TABLES], malformed: [], unprobed: [] }
  }

  const missing: RequiredTable[] = []
  const malformed: ShapeMismatch[] = []
  const unprobed: RequiredTable[] = []

  await Promise.all(
    REQUIRED_TABLES.map(async table => {
      try {
        // Existence probe. Deliberately NOT `head: true` — a HEAD response has
        // no body, so PostgREST's error JSON (the "schema cache" wording we
        // detect on) never arrives and a missing table would silently look
        // fine. Deliberately NOT `select('id')` either: four required tables
        // have no `id` column (see the header note).
        const { error } = await db().from(table).select('*').limit(1)
        if (error) {
          if (isMissingTableError(error)) missing.push(table)
          return
        }

        // Shape probe. The table is known to exist, so a failure here can only
        // mean the column is absent — the table has drifted from the shape the
        // app's queries assume.
        const column = TABLE_PROBE_COLUMNS[table]
        if (!column) {
          unprobed.push(table)
          return
        }
        const probe = await db().from(table).select(column).limit(1)
        if (probe.error) {
          malformed.push({ table, column, error: probe.error.message })
        }
      } catch {
        // A DbConfigurationError or thrown transport error here means we
        // couldn't confirm the table exists — treat that as missing too
        // rather than silently skipping it.
        missing.push(table)
      }
    }),
  )

  return {
    missing: missing.sort(),
    malformed: malformed.sort((a, b) => a.table.localeCompare(b.table)),
    unprobed: unprobed.sort(),
  }
}
