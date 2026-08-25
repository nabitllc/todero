// INF-206 / TOD: kill-fake-infra-greens — split out of lib/quick-actions.ts.
//
// Client-safe types and the default action list only. lib/quick-actions.ts's
// listQuickActions/upsertQuickAction need lib/db.ts (server-only — its
// postgres adapter pulls in the `pg` package, which needs Node's `fs` and
// cannot be bundled for the browser). A client component that only wants
// DEFAULT_QUICK_ACTIONS/QuickActionType must import THIS file, not
// lib/quick-actions.ts, or Next's client bundle fails to resolve 'fs' — this
// broke every route on the host when QuickActionFab.tsx pulled it in.
// lib/quick-actions.ts re-exports everything below for its server-side callers.

export type QuickActionType = 'create_issue' | 'start_chat' | 'run_agent' | 'navigate' | 'custom'

export interface QuickAction {
  id: string
  label: string
  icon: string
  action_type: QuickActionType
  payload: Record<string, unknown>
  sort_order: number
  enabled: boolean
  created_at: string
}

export const DEFAULT_QUICK_ACTIONS: Omit<QuickAction, 'id' | 'created_at'>[] = [
  { label: 'New Issue',     icon: '📝', action_type: 'create_issue', payload: {},                       sort_order: 0, enabled: true },
  { label: 'New Chat',      icon: '💬', action_type: 'start_chat',   payload: {},                       sort_order: 1, enabled: true },
  { label: 'Run Builder',   icon: '🔨', action_type: 'run_agent',    payload: { agent: 'builder' },     sort_order: 2, enabled: true },
  { label: 'Go to Board',   icon: '📋', action_type: 'navigate',     payload: { tab: 'board' },         sort_order: 3, enabled: true },
  { label: 'Go to Infra',   icon: '⚙️', action_type: 'navigate',     payload: { tab: 'infra' },         sort_order: 4, enabled: true },
]
