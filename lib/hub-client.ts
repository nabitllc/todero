import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

/** Shared admin client for aggregate (cross-hub) queries. */
export function createAdminClient(): SupabaseClient {
  return createClient(SUPA_URL, SUPA_KEY)
}

/**
 * Hub-scoped client context.
 * Callers MUST add `.eq('business_id', hub.businessId)` to every table query.
 *
 * Example:
 *   const hub = getHubClient(businessId)
 *   const { data } = await hub.client.from('issues').select('*').eq('business_id', hub.businessId)
 */
export function getHubClient(businessId: string): { client: SupabaseClient; businessId: string } {
  return { client: createAdminClient(), businessId }
}
