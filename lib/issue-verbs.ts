// lib/issue-verbs.ts — palette verbs for a resolved issue (issue-permalink piece).
//
// "the palette carries no verbs" — a palette that only navigates is a menu.
// But it must never offer a PATCH the server will refuse: lib/issue-moves.ts
// already answers exactly that question for the Pipeline's own move sheet
// (`moveVerdict`), one row at a time — `ready` (send `{id, status}`, or a
// couple of fields with a server-matching default, and it completes),
// `needs` (collect fields first — there is no keyboard-only UI here to
// collect them), `blocked` (cannot complete at all, ever, for this row).
// This module reuses that SAME predicate rather than re-deriving which moves
// are safe, so a verb offered here and a move offered on the board are
// judged by one rule, not two that could quietly drift apart.
//
// Scope: only READY moves are ever offered, and only for the one issue the
// palette's identifier leg resolved (`TOD-123` typed exactly) — not the
// bulk text-search rows, where computing and rendering N move verdicts per
// keystroke would be pure UI cost for a benefit no benchmark asked for.
//
// Measured 2026-08-26 against the running dev server, a fresh Limiglow `ops`
// fixture (TOD-155, status backlog, owner set by POST as it always is):
//   PATCH {id, status:'defined'} -> 200, status read back 'defined'.
//   PATCH {id, status:'backlog'} -> 200, status read back 'backlog',
//     sprint read back null (moveBody's own backlog-clears-sprint clause).
// Both are exactly what `moveVerdict` predicts `ready` for a row with an
// owner and no sprint — nothing here asserts a move this session did not
// itself run against the live API.

import { moveVerdict, moveBody, humaniseMoveFailure, type MoveIssue } from './issue-moves'
import { mappedStatuses } from './pipeline-stages'
import { sessionOperator } from './operator-identity'

export interface IssueVerb {
  readonly toStatus: string
  /** "Send to Backlog" / "Move to Defined" — what the palette row shows. */
  readonly label: string
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Every status this issue could move to with NOTHING collected first —
 * `moveVerdict`'s `ready` kind, for the signed-in session's own actor
 * (`lib/operator-identity.ts`'s `sessionOperator()` — the same client-safe
 * mirror `components/tabs/BoardTab.tsx` already uses for its own PATCHes).
 * Order follows the pipeline's own column order (`mappedStatuses()`), not
 * alphabetical, so a verb list reads left-to-right the way the board does.
 */
export function readyIssueVerbs(issue: MoveIssue): IssueVerb[] {
  const actor = sessionOperator()
  const out: IssueVerb[] = []
  for (const status of mappedStatuses()) {
    if (status === issue.status) continue
    const verdict = moveVerdict(issue, status, actor)
    if (verdict.kind === 'ready') {
      out.push({
        toStatus: status,
        label: status === 'backlog' ? 'Send to Backlog' : `Move to ${statusLabel(status)}`,
      })
    }
  }
  return out
}

export type RunVerbResult = { ok: true } | { ok: false; message: string }

/**
 * PATCH `{ id, status, transitioned_by? }` (plus whatever `moveBody` adds,
 * e.g. clearing `sprint` on a backlog reset) for a verb this module already
 * proved is `ready`. `transitioned_by` is sent only when a session actor
 * resolves — the same conditional `components/tabs/BoardTab.tsx`'s
 * `updateTask` already uses, so a viewer sends nothing and is refused by the
 * server exactly as a board edit would be.
 *
 * Returns a human sentence on refusal, never a raw database string — see
 * `humaniseMoveFailure`, which this defers to unchanged.
 */
export async function runIssueVerb(issue: MoveIssue, toStatus: string): Promise<RunVerbResult> {
  const actor = sessionOperator()
  const body = { ...moveBody(issue, toStatus, {}), ...(actor ? { transitioned_by: actor } : {}) }
  let res: Response
  try {
    res = await fetch('/api/issues', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'could not reach the server' }
  }
  if (res.ok) return { ok: true }
  let message: string | null = null
  try {
    const data = await res.json()
    message = typeof data?.error === 'string' ? data.error : null
  } catch { /* non-JSON error body */ }
  return { ok: false, message: humaniseMoveFailure(message, toStatus, res.status) }
}
