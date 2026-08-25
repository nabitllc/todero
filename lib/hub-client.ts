import { db, type DbAdapter } from '@/lib/db'

const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Tables that are partitioned by business_id — auto-inject filter/row data. */
export const HUB_SCOPED_TABLES = [
  'issues', 'sprints', 'agents', 'projects', 'workspace_members',
  'notifications', 'inbox', 'agent_runs', 'agent_cost_log',
] as const

type HubScopedTable = typeof HUB_SCOPED_TABLES[number]

function isHubScoped(table: string): boolean {
  return (HUB_SCOPED_TABLES as readonly string[]).includes(table)
}

/** Wraps a Supabase QueryBuilder and auto-injects business_id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class HubScopedBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private builder: any
  private businessId: string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(builder: any, businessId: string) {
    this.builder = builder
    this.businessId = businessId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select(...args: any[]) {
    return this.builder.select(...args).eq('business_id', this.businessId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert(values: Record<string, unknown> | Record<string, unknown>[], options?: any) {
    const withBiz = Array.isArray(values)
      ? values.map(v => ({ ...v, business_id: this.businessId }))
      : { ...values, business_id: this.businessId }
    return this.builder.insert(withBiz, options)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(values: Record<string, unknown>, options?: any) {
    return this.builder.update(values, options).eq('business_id', this.businessId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete(options?: any) {
    return this.builder.delete(options).eq('business_id', this.businessId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: any) {
    const withBiz = Array.isArray(values)
      ? values.map(v => ({ ...v, business_id: this.businessId }))
      : { ...values, business_id: this.businessId }
    return this.builder.upsert(withBiz, options)
  }
}

/**
 * Hub-scoped client. Exposes `from()` which auto-injects `business_id` for
 * hub-scoped tables (select filter, insert/upsert row data, update/delete filter).
 *
 * Also exposes `.client` (raw DbAdapter) and `.businessId` for callers that
 * need explicit control or use non-proxied operations.
 *
 * Example (new API — preferred):
 *   const db = getHubClient(businessId)
 *   const { data } = await db.from('issues').select('*')  // business_id auto-injected
 *
 * Example (legacy API — still works):
 *   const hub = getHubClient(businessId)
 *   const { data } = await hub.client.from('issues').select('*').eq('business_id', hub.businessId)
 */
export class HubClient {
  /** Raw Supabase admin client — use for non-hub-scoped tables or explicit control. */
  readonly client: DbAdapter
  /** Hub business ID — injected automatically by .from() for hub-scoped tables. */
  readonly businessId: string

  constructor(client: DbAdapter, businessId: string) {
    this.client = client
    this.businessId = businessId
  }

  /**
   * Returns a builder for the given table.
   * Hub-scoped tables: auto-injects business_id on all operations.
   * Non-hub-scoped tables: returns raw Supabase QueryBuilder (no auto-injection).
   */
  from(table: string) {
    const builder = this.client.from(table)
    if (!isHubScoped(table)) return builder
    return new HubScopedBuilder(builder, this.businessId)
  }
}

/** Shared admin client for aggregate (cross-hub) queries. */
export function createAdminClient(): DbAdapter {
  return db()
}

/** Returns a hub-scoped client for the given business ID. */
export function getHubClient(businessId: string): HubClient {
  return new HubClient(createAdminClient(), businessId)
}
