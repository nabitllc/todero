// lib/issue-moves.ts — can this board finish the move it is about to offer?
//
// ─── why this file exists ────────────────────────────────────────────────────
//
// The Pipeline's move sheet listed all sixteen statuses from
// `PIPELINE_COLUMNS`, sent `PATCH /api/issues` with `{ id, status }` and
// nothing else, and let the API say no afterwards. Measured on 2026-08-26
// against the running server, one fresh `ops` row per destination, as the
// signed-in owner: ELEVEN of the sixteen succeed and FIVE refuse —
//
//   refined        400  test_tier is required for task/bug/ops
//   open           500  CHECK constraint failed: ((status NOT IN ('open',
//                       'in_progress','in_review')) OR (sprint IS NOT NULL))
//   in_progress    500  the same CHECK constraint, verbatim
//   code_review    422  resolution_type, then implementation_notes, then
//                       commit_sha, then regression_test — four gates, one
//                       message at a time
//   product_review 422  resolution_type, then implementation_notes
//   closed         422  resolution_type
//
// plus two refusals that depend on the row rather than the destination and so
// never show up in a "fresh backlog row" sweep at all:
//
//   backlog        403  from ANY other status — `Only main/po/ops can reset an
//                       issue to backlog.` The board's operator is `michael`.
//   anything       403  from a `closed` card — `Issue is closed and read-only.`
//
// Two of those refusals put a raw SQLite `CHECK constraint failed: …` string on
// the operator's screen. That is the failure this rebuild has spent the night
// removing in other forms.
//
// ─── the shape, and why this shape ───────────────────────────────────────────
//
// The requirement set is a function of `(row, destination)`, NOT of destination
// alone. Three measurements force that:
//
//  * `defined` requires `owner`, but `POST /api/issues` sets `owner` from the
//    issue type unconditionally and ignores any caller value, so no row created
//    through the MC API can ever trip that check. A destination-only table
//    would prompt every operator for a field that is never missing.
//  * `refined` requires `test_tier` for task/bug/ops and NOT for epic/feature.
//    Measured both ways: an epic goes backlog -> refined with no `test_tier`.
//  * `code_review` requires `commit_sha` and `regression_test` for task/bug/ops
//    and not for epic/feature. Measured both ways.
//
// So the export takes the row. It returns a VERDICT, not a boolean, because
// "no" has two honest meanings and they need different interfaces:
//
//   needs   — the API accepts these fields on PATCH; collect them inline and
//             send them in the same request. The operator reaches the
//             destination.
//   blocked — the board cannot supply what this needs, at all. Say so, in a
//             sentence, on a visible-but-disabled row. Never hide it: an
//             operator who cannot see `code_review` learns nothing; an operator
//             told what `code_review` needs learns everything.
//
// ─── what this file is NOT ───────────────────────────────────────────────────
//
// It is not validation. The server is the authority and stays the authority:
// every rule below mirrors one the MC API enforces independently, and a PATCH
// sent past this module — curl, an agent, another UI — is refused by exactly
// the same rules. This module exists so the board does not OFFER a move it has
// already been told will fail.
//
// The two refusals that depend on OTHER rows are deliberately not predicted:
// the ten-open cap (409) and the one-at-a-time lane (409). Both can change
// between the render and the tap, so a client answer would be a stale guess,
// and a predicate that says a move is possible when it is not is worse than no
// predicate at all. They stay server-side and surface through
// `humaniseMoveFailure()`, which leaves them alone — both are already sentences
// a person wrote.

import { VALID_RESOLUTION_TYPES } from '@/lib/constants'
import { mappedStatuses } from '@/lib/pipeline-stages'

/** The row shape this module reads. Every field is optional; a row may be legacy. */
export type MoveIssue = Record<string, unknown>

/** How the sheet should render an input for a field it must collect. */
export type MoveFieldKind = 'text' | 'longtext' | 'select' | 'date'

/**
 * One field the API requires before it will accept this move, and which it will
 * accept on the same PATCH. Everything here is written for a person to read —
 * `label` and `why` are shown; `field` is the column name and is only sent.
 */
export interface MoveField {
  /** The `issues` column, sent verbatim in the PATCH body. */
  readonly field: string
  /** What the operator sees above the input. */
  readonly label: string
  /** One sentence: why the server wants this before this particular move. */
  readonly why: string
  readonly kind: MoveFieldKind
  /** For `kind: 'select'`. */
  readonly options?: readonly string[]
  readonly placeholder?: string
  /** Prefilled value, e.g. today's date for `sprint`. */
  readonly defaultValue?: string
  /** Minimum trimmed length the SERVER enforces. Mirrored so the sheet can too. */
  readonly minLength?: number
}

export type MoveVerdict =
  /** The issue is already in this status. */
  | { readonly kind: 'current' }
  /** `{ id, status }` alone completes this move. */
  | { readonly kind: 'ready' }
  /** These fields must be collected and sent with the move. */
  | { readonly kind: 'needs'; readonly fields: readonly MoveField[] }
  /** The board cannot complete this move. `reason` is shown, disabled. */
  | { readonly kind: 'blocked'; readonly reason: string }

/**
 * Roles the MC API accepts as able to reset an issue to `backlog`
 * (`app/api/issues/route.ts:1632`, `KAOS_ROLES`). Mirrored, not imported: that
 * route is a server module and this predicate runs in the browser bundle.
 *
 * The list contains no owner bypass — unlike `route.ts:570` and `route.ts:587`,
 * which both call `isOwnerActor()`. A signed-in owner resolves to the actor
 * `michael` (`lib/session-actor.ts:36`), so a board move to `backlog` from any
 * other status returns 403 for the one human who uses this board. Measured:
 * `defined -> backlog` as the owner is 403; the same PATCH carrying
 * `transitioned_by: 'po'` is 200.
 *
 * The board does NOT send `'po'`. Writing an actor the operator is not into the
 * transition record would be a fabrication in the audit trail, and the point of
 * this piece is to stop the board lying about what it can do. The destination is
 * shown disabled with the real reason, and the one-line API fix is written up in
 * `docs/rebuild/pieces/pieces6/moves-that-complete.md` §4.
 */
const BACKLOG_RESET_ROLES: readonly string[] = ['main', 'po', 'ops']

/** Types the MC API applies the test/commit gates to (`route.ts:1763`, `:1934`). */
const GATED_TYPES: readonly string[] = ['task', 'bug', 'ops']

/** `test_tier` CHECK on `issues`. */
const TEST_TIERS: readonly string[] = ['smoke', 'integration', 'e2e']

/**
 * Every status a Pipeline column displays, from the column model — not a second
 * copy of the list. `lib/pipeline-stages.ts` already guarantees this covers
 * `VALID_STATUSES` exactly once, and re-listing them here is how the two would
 * drift apart.
 */
const BOARD_STATUSES: ReadonlySet<string> = new Set(mappedStatuses())

/** Trimmed string value of a row field, or `''`. Numbers and nulls read as `''`. */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Today in the sprint's own format and timezone (`route.ts:1313-1316`). */
export function todaysSprint(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

const SPRINT_FIELD = (): MoveField => ({
  field: 'sprint',
  label: 'Sprint',
  why: 'An issue being worked has to belong to a sprint — the database refuses to store one without it.',
  kind: 'date',
  defaultValue: todaysSprint(),
  placeholder: 'YYYY-MM-DD',
  minLength: 1,
})

const RESOLUTION_FIELD = (dest: string): MoveField => ({
  field: 'resolution_type',
  label: 'Resolution type',
  why: dest === 'closed'
    ? 'Closing an issue records what kind of change resolved it.'
    : 'Reviewers are told what kind of change was made before they open the diff.',
  kind: 'select',
  options: VALID_RESOLUTION_TYPES,
})

const IMPL_NOTES_FIELD = (dest: string): MoveField => ({
  field: 'implementation_notes',
  label: 'Implementation notes',
  why: `Describe what was built or changed — ${dest} needs at least 10 characters of it.`,
  kind: 'longtext',
  placeholder: 'What changed, and where.',
  minLength: 10,
})

/**
 * Every field the MC API will require before accepting `toStatus` for this row,
 * and will accept on the same PATCH.
 *
 * Order matters and is the order the API checks in, so an operator filling the
 * form top to bottom satisfies the gates in the same sequence the server does.
 * Fields the row already carries are omitted — the server merges
 * `{...before, ...fields}` before every check, so a value already stored counts.
 */
export function requiredFieldsForMove(issue: MoveIssue, toStatus: string): MoveField[] {
  const type = str(issue.type) || 'task'
  const gated = GATED_TYPES.includes(type)
  const out: MoveField[] = []

  if (toStatus === 'refined') {
    // route.ts:1748-1770
    if (!str(issue.description)) {
      out.push({
        field: 'description',
        label: 'Description',
        why: 'Refined means someone could pick this up cold — that needs a description.',
        kind: 'longtext',
        placeholder: 'What needs to be built or done.',
        minLength: 1,
      })
    }
    if (gated && !str(issue.test_tier)) {
      out.push({
        field: 'test_tier',
        label: 'Test tier',
        why: 'How this will be verified, chosen before the work starts.',
        kind: 'select',
        options: TEST_TIERS,
      })
    }
    return out
  }

  if (toStatus === 'open') {
    // route.ts:1773-1782, plus the sprint CHECK on `issues`.
    if (!str(issue.acceptance_criteria)) {
      out.push({
        field: 'acceptance_criteria',
        label: 'Acceptance criteria',
        why: 'Nothing is ready to pick up until "done" is written down.',
        kind: 'longtext',
        placeholder: 'What has to be true for this to be done.',
        minLength: 1,
      })
    }
    if (!str(issue.sprint)) out.push(SPRINT_FIELD())
    return out
  }

  if (toStatus === 'in_progress') {
    // The sprint CHECK on `issues`.
    if (!str(issue.sprint)) out.push(SPRINT_FIELD())
    return out
  }

  if (toStatus === 'code_review' || toStatus === 'product_review') {
    // route.ts:1811-1825 for both; route.ts:1934-1950 for code_review only.
    if (!str(issue.resolution_type)) out.push(RESOLUTION_FIELD(toStatus))
    if (str(issue.implementation_notes).length < 10) out.push(IMPL_NOTES_FIELD(toStatus))
    if (toStatus === 'code_review' && gated) {
      const sha = str(issue.commit_sha)
      if (!sha || sha === 'none') {
        out.push({
          field: 'commit_sha',
          label: 'Commit SHA',
          why: 'A review needs the commit it is reviewing. `git rev-parse HEAD`.',
          kind: 'text',
          placeholder: 'e.g. 4db1390…',
          minLength: 1,
        })
      }
      if (!str(issue.regression_test)) {
        out.push({
          field: 'regression_test',
          label: 'Regression test',
          why: 'One or two lines on how a reviewer verifies the fix holds.',
          kind: 'longtext',
          placeholder: 'How to check this stays fixed.',
          minLength: 1,
        })
      }
    }
    return out
  }

  if (toStatus === 'closed') {
    // route.ts:1831-1840
    if (!str(issue.resolution_type)) out.push(RESOLUTION_FIELD(toStatus))
    return out
  }

  return out
}

/**
 * What the sheet should do about offering `toStatus` for this row.
 *
 * `actor` is the workflow identity the PATCH will be attributed to — what
 * `lib/operator-identity.ts`'s `sessionOperator()` returns, which is the same
 * value `lib/session-actor.ts` derives server-side when the body omits one.
 * `undefined` is a real answer (a viewer, or signed out) and is treated as
 * "cannot reset to backlog", which is what the server does with it.
 *
 * The default for an unrecognised destination is BLOCKED, never READY. A
 * predicate whose unknown case is "sure, try it" is the failure this module
 * exists to prevent.
 */
export function moveVerdict(
  issue: MoveIssue,
  toStatus: string,
  actor: string | undefined,
): MoveVerdict {
  if (!BOARD_STATUSES.has(toStatus)) {
    return {
      kind: 'blocked',
      reason: `"${toStatus}" is not a status this board recognises, so it cannot move anything there.`,
    }
  }

  const from = str(issue.status)

  // route.ts:1623-1628 — checked before everything else, exactly as the API does.
  if (from === 'closed') {
    return {
      kind: 'blocked',
      reason: 'This issue is closed and read-only. Reopening it is not something the board can do.',
    }
  }

  if (from === toStatus) return { kind: 'current' }

  // route.ts:1631-1637
  if (toStatus === 'backlog') {
    if (!actor || !BACKLOG_RESET_ROLES.includes(actor)) {
      return {
        kind: 'blocked',
        reason: `Sending an issue back to Backlog is reserved for ${BACKLOG_RESET_ROLES.join(', ')}` +
          `, and you are signed in as ${actor ?? 'no one the workflow knows'}. ` +
          'Ask one of them, or reset it from the agent side.',
      }
    }
    return { kind: 'ready' }
  }

  // route.ts:1737-1745. `owner` is set by POST from the issue type and PATCH
  // strips it from every payload (route.ts:2178-2181), so a row that somehow
  // has none cannot be given one from here. Blocked, not prompted: offering an
  // input whose value the server silently discards would be a lie in a form.
  if (toStatus === 'defined' && !str(issue.owner)) {
    return {
      kind: 'blocked',
      reason: 'This issue has no owner, and Defined requires one. Owner is fixed when an issue ' +
        'is created and cannot be changed from the board.',
    }
  }

  const fields = requiredFieldsForMove(issue, toStatus)
  return fields.length > 0 ? { kind: 'needs', fields } : { kind: 'ready' }
}

/**
 * Which collected values are still missing or too short, by field name.
 *
 * The sheet uses this to keep its own submit button honest — it mirrors the
 * server's `minLength` checks so the operator is told in place rather than
 * after a round trip. The server still checks; this only decides whether the
 * request is worth sending.
 */
export function unmetFields(
  fields: readonly MoveField[],
  values: Readonly<Record<string, string>>,
): string[] {
  return fields
    .filter(f => (values[f.field] ?? '').trim().length < (f.minLength ?? 1))
    .map(f => f.field)
}

/**
 * The PATCH body for a move, given the collected values.
 *
 * Only fields the move actually needs are included: sending `sprint` on a move
 * to `backlog` would violate `CHECK (NOT (status='backlog' AND sprint IS NOT
 * NULL))` and produce a 500 — measured, verbatim:
 * `CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))`.
 * So the body is built from the requirement list, never from the whole form.
 */
export function moveBody(
  issue: MoveIssue,
  toStatus: string,
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { id: issue.id, status: toStatus }
  for (const f of requiredFieldsForMove(issue, toStatus)) {
    const v = (values[f.field] ?? '').trim()
    if (v) body[f.field] = v
  }
  return body
}

/* ── No raw database text, ever ──────────────────────────────────────────────
 *
 * Everything above is a PREDICTION. The server is still the authority, it can
 * still refuse, and it can refuse for a reason no client models — a row changed
 * under us, a 409 lane conflict, a constraint added since. This is the last
 * gate before a server string reaches a human.
 *
 * The rule is not "translate the messages we know about". It is: a message that
 * LOOKS like database output never reaches the screen, whether or not this file
 * has a translation for it. Known constraints get their own sentence; anything
 * else that smells of SQL gets a generic one that still tells the operator what
 * happened and what to do.
 */

/** Anything that reads as database or driver output rather than as English. */
const RAW_DB_SIGNATURES: readonly RegExp[] = [
  /CHECK constraint failed/i,
  /UNIQUE constraint failed/i,
  /NOT NULL constraint failed/i,
  /FOREIGN KEY constraint/i,
  /\bSQLITE_[A-Z]+\b/,
  /\bno such (column|table)\b/i,
  /\bviolates \w+ constraint\b/i,
  /\bsyntax error at or near\b/i,
  /\bPGRST\d+\b/,
  /\bschema cache\b/i,
]

function looksLikeRawDatabaseText(message: string): boolean {
  return RAW_DB_SIGNATURES.some(re => re.test(message))
}

/** Known constraints, each with the sentence a person would have written. */
const KNOWN_CONSTRAINTS: readonly { readonly match: RegExp; readonly sentence: string }[] = [
  // Order matters: both sprint constraints contain the substring
  // `sprint IS NOT NULL`, so each is matched on the half that distinguishes it
  // — the status list for one, `status = 'backlog'` for the other — and the
  // narrower of the two is tested first.
  {
    match: /status = 'backlog'\)? AND \(?sprint IS NOT NULL/i,
    sentence: 'An issue in Backlog cannot carry a sprint. Clear the sprint first.',
  },
  {
    match: /status NOT IN \(\s*'open'/i,
    sentence: 'An issue being worked has to belong to a sprint. Set a sprint and try the move again.',
  },
  {
    match: /test_tier IN/i,
    sentence: 'The test tier has to be one of smoke, integration or e2e.',
  },
  {
    match: /resolution_type IS NULL\) OR \(resolution_type IN/i,
    sentence: 'That resolution type is not one the workflow recognises. Pick one from the list.',
  },
  {
    match: /deployer_status IN/i,
    sentence: 'The deployer status has to be either ready or failed.',
  },
  {
    match: /UNIQUE constraint failed: issues\.task_key/i,
    sentence: 'Another issue already has this key. Reload the board and try again.',
  },
]

/**
 * The sentence to show when a move is refused.
 *
 * A server message written for a person is passed through unchanged — the MC
 * API's own refusals ("Only main/po/ops can reset an issue to backlog.", the
 * one-at-a-time lane 409, the ten-open cap 409) are already sentences, and
 * rewriting them would only lose information. Only text that reads as database
 * output is replaced.
 *
 * `status` is used solely to add the HTTP code when there is nothing else to
 * say; it never turns a human sentence into a code.
 */
export function humaniseMoveFailure(
  message: string | null | undefined,
  toStatus: string,
  status?: number,
): string {
  const raw = (message ?? '').trim()

  if (!raw) {
    const code = typeof status === 'number' && status > 0 ? ` (${status})` : ''
    return `The move to "${toStatus}" was refused${code}, and the server did not say why. Reload the board and try again.`
  }

  if (!looksLikeRawDatabaseText(raw)) return raw

  for (const { match, sentence } of KNOWN_CONSTRAINTS) {
    if (match.test(raw)) return sentence
  }

  return `The move to "${toStatus}" was refused by a rule this board does not have wording for yet. ` +
    'Nothing was changed. Please report it — the raw message is in the browser console.'
}
