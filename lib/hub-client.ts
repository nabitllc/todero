/**
 * hub-client.ts — Hub-scoped Supabase client wrapper (TOD-964)
 *
 * Provides getHubClient(businessId) which auto-injects .eq('business_id', id)
 * on all queries to hub-scoped tables, preventing cross-hub data leakage.
 *
 * Usage:
 *   const db = getHubClient(business_id)
 *   db.from('issues').select('*')          // ← business_id filter auto-applied
 *   db.from('agent_memory').select('*')    // ← passthrough, not hub-scoped
 *
 * For intentional aggregate (cross-hub) queries:
 *   const db = createAdminClient()         // ← no automatic filtering
 *   // AGGREGATE QUERY: intentionally cross-hub, not scoped to a single business
 *   db.from('issues').select('*')
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

/**
 * Tables that are partitioned by business_id.
 * All queries on these tables MUST be scoped to a business_id unless performing
 * an intentional aggregate (cross-hub) read using createAdminClient().
 */
export const HUB_SCOPED_TABLES = ['issues', 'sprints', 'agents', 'projects'] as const
export type HubScopedTable = (typeof HUB_SCOPED_TABLES)[number]

function isHubScoped(table: string): boolean {
  return (HUB_SCOPED_TABLES as readonly string[]).includes(table)
}

/**
 * Returns the base admin Supabase client with no automatic business_id filtering.
 * Use ONLY for intentional aggregate (cross-hub) queries or non-hub-scoped tables.
 *
 * When querying hub-scoped tables (issues, sprints, agents, projects) with this
 * client, add a comment: // AGGREGATE QUERY: intentionally cross-hub
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
}

/**
 * Returns a hub-scoped Supabase client that automatically injects
 * .eq('business_id', businessId) into all queries on HUB_SCOPED_TABLES.
 *
 * - select: appends .eq('business_id', id) after the select call
 * - insert: injects business_id into the row data
 * - update: appends .eq('business_id', id) to scope the update
 * - delete: appends .eq('business_id', id) to scope the delete
 * - upsert: injects business_id into the row data
 *
 * Non-hub-scoped tables are passed through to the raw client unchanged.
 */
export function getHubClient(businessId: string) {
  const base = createAdminClient()

  function from(table: string): ReturnType<typeof base.from> {
    const builder = base.from(table)

    if (!isHubScoped(table)) {
      return builder
    }

    // Hub-scoped wrapper: auto-injects business_id on all operations
    const wrapper = {
      select(...args: any[]) {
        return builder.select(...args).eq('business_id', businessId)
      },
      insert(data: any, options?: any) {
        if (Array.isArray(data)) {
          return builder.insert(
            data.map((r: any) => ({ ...r, business_id: businessId })),
            options
          )
        }
        return builder.insert({ ...data, business_id: businessId }, options)
      },
      update(values: any, options?: any) {
        return builder.update(values, options).eq('business_id', businessId)
      },
      delete(options?: any) {
        return builder.delete(options).eq('business_id', businessId)
      },
      upsert(data: any, options?: any) {
        if (Array.isArray(data)) {
          return builder.upsert(
            data.map((r: any) => ({ ...r, business_id: businessId })),
            options
          )
        }
        return builder.upsert({ ...data, business_id: businessId }, options)
      },
    }

    return wrapper as ReturnType<typeof base.from>
  }

  return {
    from,
    rpc: base.rpc.bind(base),
    get auth() { return base.auth },
    get storage() { return base.storage },
    get functions() { return base.functions },
  }
}

export type HubClient = ReturnType<typeof getHubClient>
export type AdminClient = ReturnType<typeof createAdminClient>
