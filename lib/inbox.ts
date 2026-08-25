// lib/inbox.ts — Agent approval request helper (TOD-764)
//
// Usage:
//   const result = await requestApproval('builder', 'deploy', { issueId: 'abc' })
//   if (result.status === 'approved') { ... }

import { assertDbConfigured, db, type DbAdapter } from '@/lib/db'

// Lazy-init: avoids crashing at build time when the database is unconfigured
// (CI). First call throws a DbConfigurationError naming the missing vars,
// whichever adapter is active. (TOD-2296)
let _db: DbAdapter | null = null
function getDb(): DbAdapter {
  if (!_db) {
    assertDbConfigured()
    _db = db()
  }
  return _db
}

export type ApprovalStatus = 'approved' | 'denied' | 'timeout' | 'explained'

export interface ApprovalResult {
  id: string
  status: ApprovalStatus
}

export interface ApprovalOptions {
  /** How long to wait for a human response, in ms. Default: 5 minutes. */
  timeoutMs?: number
  /** How often to poll for a status change, in ms. Default: 5 seconds. */
  pollIntervalMs?: number
}

export interface InboxEntry {
  id: string
  agent: string
  type: string
  context: unknown
  status: 'pending' | 'approved' | 'denied' | 'timeout' | 'explained'
  created_at: string
  expires_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  response_data: unknown | null
  issue_id: string | null
}

/**
 * Create an inbox approval request and wait for a human to act on it.
 *
 * @param agent - Identifier of the requesting agent (e.g. 'builder')
 * @param type  - Category of request (e.g. 'deploy', 'delete', 'send-message')
 * @param context - Arbitrary JSON context the reviewer needs to decide
 * @param options - Timeout + poll interval overrides
 * @returns ApprovalResult with the final status and inbox entry id
 */
export async function requestApproval(
  agent: string,
  type: string,
  context: unknown,
  options: ApprovalOptions = {}
): Promise<ApprovalResult> {
  const { timeoutMs = 5 * 60 * 1000, pollIntervalMs = 5000 } = options

  const expiresAt = new Date(Date.now() + timeoutMs).toISOString()

  const { data: entry, error: insertError } = await getDb()
    .from('inbox')
    .insert({ agent, type, context, expires_at: expiresAt })
    .select('id')
    .single()

  if (insertError || !entry) {
    throw new Error(`inbox insert failed: ${insertError?.message ?? 'no data'}`)
  }

  const id: string = entry.id

  return new Promise((resolve) => {
    const deadline = setTimeout(async () => {
      clearInterval(poller)
      await getDb()
        .from('inbox')
        .update({ status: 'timeout', resolved_at: new Date().toISOString() })
        .eq('id', id)
      resolve({ id, status: 'timeout' })
    }, timeoutMs)

    const poller = setInterval(async () => {
      const { data } = await getDb()
        .from('inbox')
        .select('status')
        .eq('id', id)
        .single<Pick<InboxEntry, 'status'>>()

      if (data && data.status !== 'pending') {
        clearInterval(poller)
        clearTimeout(deadline)
        resolve({ id, status: data.status as ApprovalStatus })
      }
    }, pollIntervalMs)
  })
}
