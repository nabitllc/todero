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
//   backlog        403  from ANY other status, for an actor who is none of
//                       `main`/`po`/`ops` and not the signed-in owner —
//                       `Only main/po/ops or the workspace owner can reset an
//                       issue to backlog.` Measured 2026-08-26 against the
//                       running server: `defined -> backlog` as the signed-in
//                       owner (no `transitioned_by` sent) is 200, not 403 —
//                       `route.ts`'s backlog guard already carries an
//                       `isOwnerActor()` bypass (commit 62d9d82, TOD-2452).
//                       A row that also carries a `sprint` hits a SECOND
//                       refusal on that same 200 path: the `backlog_no_sprint`
//                       CHECK. See `BACKLOG_RESET_ROLES` and `moveBody` below.
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
import { isOwnerActor } from '@/lib/operator-identity'

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
 * (`app/api/issues/route.ts:1718`, `KAOS_ROLES`). Mirrored, not imported: that
 * route is a server module and this predicate runs in the browser bundle, and
 * `KAOS_ROLES` is a local, unexported const there — there is no import to
 * reach for. That gap is written up in
 * `docs/rebuild/pieces/pieces6/moves-that-complete.md` §4 as a request to
 * export it (or move it beside `OWNER_IDENTITY` in `lib/operator-identity.ts`,
 * which already is shared and already is imported by both sides — see below).
 * Until then, `BACKLOG_RESET_ROLES` is exported so
 * `lib/__tests__/issue-moves.test.ts` can catch drift the moment `route.ts`'s
 * copy changes and this one does not, rather than trusting the mirror by eye.
 *
 * The owner is NOT part of this list — `isOwnerActor()`, imported directly
 * from `lib/operator-identity.ts` below, decides that half. That module (not
 * `lib/session-actor.ts`, which is server-only) is written to be safe in the
 * browser bundle and is the one piece of this predicate that cannot drift from
 * the server, because both sides call the same function.
 *
 * Measured 2026-08-26 against the running server, fresh `ops` fixture,
 * `mc-role=owner` cookie, no `transitioned_by` in the body (so the server
 * resolves the actor itself via `resolveSessionActor` -> `michael`):
 * `defined -> backlog` is **200**, not 403. `route.ts`'s backlog guard already
 * has an `isOwnerActor()` bypass (`route.ts:1730`, landed in the same commit
 * that created this file, 62d9d82 / TOD-2452) — the comment that used to live
 * here ("Measured: defined -> backlog as the owner is 403") described a state
 * that commit had already fixed on the server side one file over, and nobody
 * came back to update the client mirror or this file's own tests. That
 * contradiction is the defect this revision corrects; nothing below asserts
 * anything this session did not itself measure.
 */
export const BACKLOG_RESET_ROLES: readonly string[] = ['main', 'po', 'ops']

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

  if (toStatus === 'backlog') {
    // route.ts:1718-1735, plus `backlog_no_sprint`
    // (`CHECK (NOT (status='backlog' AND sprint IS NOT NULL))`).
    //
    // Nothing here for the operator to type: the actor check is `moveVerdict`'s
    // job (`BACKLOG_RESET_ROLES` / `isOwnerActor`, above), and the sprint the
    // CHECK objects to is a value the row ALREADY carries, not one the sheet
    // is collecting. There's no form field for "please don't have a sprint" —
    // `moveBody` clears it in the same PATCH instead, unconditionally, whether
    // this list is empty or not. Kept as its own branch (rather than falling
    // through to the bottom `return out`) so the backlog case is visible here,
    // next to the CHECK it exists to satisfy, instead of reading as "nothing
    // is required to reach backlog" by omission.
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

  // route.ts:1718-1735
  if (toStatus === 'backlog') {
    if (!actor || (!BACKLOG_RESET_ROLES.includes(actor) && !isOwnerActor(actor))) {
      return {
        kind: 'blocked',
        reason: `Sending an issue back to Backlog is reserved for ${BACKLOG_RESET_ROLES.join(', ')}` +
          ` or the workspace owner, and you are signed in as ${actor ?? 'no one the workflow knows'}. ` +
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
 * Only fields the move actually needs are included: sending a FORM-collected
 * `sprint` on a move to `backlog` would violate `CHECK (NOT (status='backlog'
 * AND sprint IS NOT NULL))` and produce a 500 — measured, verbatim:
 * `CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT
 * NULL)))`. So the body is built from the requirement list, never from the
 * whole form.
 *
 * A move TO `backlog` is a second, separate case: the row can already carry a
 * `sprint` from before (any card that was ever `open`/`in_progress`/etc.
 * does), and the same CHECK fires on that pre-existing value even when the
 * form supplies nothing at all — measured 2026-08-26, an `in_progress` row
 * with `sprint: '2026-08-26'`, bare `{id, status: 'backlog'}` as the owner:
 * 500, the identical CHECK string. The backlog-reset handler
 * (`route.ts:1718-1753`) resets `worked_by`, `started_at` and `submitted_at`
 * unconditionally but does not touch `sprint` unless the PATCH body says to —
 * so this function says to. Measured: the same request with `sprint: null`
 * added to the body is 200, and reads back `sprint: null`. That is not a value
 * the operator types; there is no field for it in `requiredFieldsForMove`
 * (see its own `backlog` branch). It is sent whenever the row currently has
 * one, so the move that was offered as `ready` actually completes.
 */
export function moveBody(
  issue: MoveIssue,
  toStatus: string,
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { id: issue.id, status: toStatus }
  if (toStatus === 'backlog' && str(issue.sprint)) {
    body.sprint = null
  }
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
 * The rule is an ALLOWLIST: a message reaches the screen only if this repo can
 * point at the line that wrote it. Everything else is replaced — whether or not
 * this file recognises it, and whether or not it looks like SQL. The block
 * below explains why it is written that way, because it used to be written the
 * other way round and the other way round did not hold.
 */

/* ── why this is an allowlist: the measurement that forced the inversion ──────
 *
 * Until 2026-08-26 this was a DENYLIST — eighteen regexes that recognised
 * database output, with anything unrecognised passed to the screen unchanged.
 * The comment above it claimed the opposite: "a message that LOOKS like
 * database output never reaches the screen, whether or not this file has a
 * translation for it." That claim was false, and a shipped comment asserting
 * something untrue of the code under it is a defect in its own right.
 *
 * Measured 2026-08-26 by calling the then-shipped `humaniseMoveFailure` on 23
 * ordinary better-sqlite3/Postgres messages. SIXTEEN came back VERBATIM:
 *
 *   value too long for type character varying(50)
 *   date/time field value out of range: "2026-13-45"
 *   deadlock detected
 *   could not serialize access due to concurrent update
 *   permission denied for table issues
 *   operator does not exist: text = integer
 *   canceling statement due to statement timeout
 *   attempt to write a readonly database
 *   too many SQL variables
 *   connection to server at "localhost" (::1), port 5432 failed: Connection refused
 *   out of memory
 *   disk I/O error
 *   server closed the connection unexpectedly
 *   invalid byte sequence for encoding "UTF8": 0x00
 *   cannot execute UPDATE in a read-only transaction
 *   index "issues_pkey" contains unexpected zero page at block 0
 *
 * The tenth puts the database host and port on an operator's screen. None of
 * these is exotic, and Postgres is the dialect this repo is migrating to.
 *
 * A denylist of message shapes cannot be finished: what a driver can say is the
 * driver's to decide and changes with its version. What the MC API says is
 * OURS, lives in this repo, and is enumerable. So the rule is inverted:
 *
 *   PASS    — a message this repo wrote: an MC API refusal
 *             (`app/api/issues/route.ts`, `app/api/db/[...path]/route.ts`,
 *             `middleware.ts`), a transport message `lib/fetch-json.ts` writes
 *             itself, or an HTTP status text.
 *   REPLACE — everything else. A known constraint gets its own sentence; the
 *             rest get a generic one that still says what happened.
 *
 * An allowlist has the opposite failure mode, and it is worth naming: a NEW MC
 * API refusal that nobody adds here would be replaced by the generic sentence,
 * and the operator would lose a good message. That is caught mechanically —
 * `lib/__tests__/issue-moves.test.ts` parses every `error:` / `message:` string
 * literal out of those route files and asserts each one survives this function
 * unchanged. Adding a refusal to the API without adding it here turns the build
 * red rather than turning the screen vague.
 *
 * Why message text is the only thing to decide on:
 * `app/api/issues/route.ts:2297` answers a failed write with
 * `NextResponse.json({ error: error.message }, …)` — the driver's own string,
 * no SQLSTATE alongside it — and `app/api/db/[...path]/route.ts:286` does the
 * same with `result.error.message`. There is no `code` to branch on.
 */

/**
 * Sentences the MC API itself writes. Anchored at the start, because the start
 * is the half a template literal cannot change.
 *
 * Every entry corresponds to a literal in one of the route files named above;
 * the test derives those literals from the source, so this list cannot quietly
 * fall behind the API.
 */
const MC_API_MESSAGES: readonly RegExp[] = [
  // ── app/api/issues/route.ts ──
  /^done is retired\b/i,
  /^Backlog-first policy\b/i,
  /^Issue is closed and read-only\b/i,
  // Every role refusal the route writes begins this way: "Only auditor…",
  // "Only main/po/ops or the workspace owner…", "Only the assignee (…)…",
  // "Only tester or designer…", "Only the queue-refill cron…". No driver
  // message in either dialect opens with a bare "Only ".
  /^Only\s+\S/,
  /^(?:acceptance_criteria|closing_notes|commit_sha|description|implementation_notes|owner|regression_test|resolution_type|test_tier)\b[^.]{0,40}\bis required\b/i,
  /^Cannot (?:create issue|move to)\b/i,
  /^(?:Child task cap reached|Duplicate review issue blocked|Near-duplicate child task blocked)\b/i,
  // Each of these is anchored on the punctuation the route writes, not just on
  // the word. `/^Invalid (?:…|page|…)\b/` was tried first and had to be
  // narrowed: it allowlisted Postgres's `invalid page in block 3 of relation
  // base/16384/16401`, which the adversarial battery in the test file caught on
  // the first run. A one-word prefix is not a signature.
  /^Invalid (?:limit|page|has_due|type) "/i,
  /^Invalid value for '/i,
  /^Invalid transition for\b/i,
  /^No issue found for\b/i,
  /^One-at-a-time lane enforcement\b/i,
  // Contains the words "does not exist", which is also how Postgres reports a
  // phantom column. It is allowlisted BEFORE that check precisely so the API's
  // own sentence is not mistaken for schema text.
  /^parent_id \S+ does not exist$/i,
  /^type=\S+ (?:requires|should not have)\b/i,
  /^id(?: or task_key)? required$/i,
  /^This screen is scoped to\b/i,
  // The 422 that refuses a phantom field by name — `app/api/issues/route.ts`
  // answers `PATCH {test_status: …}` with it. Matched on the SHAPE rather than
  // on the identifier, for two reasons: the next phantom the API refuses this
  // way is covered without another edit, and spelling the identifier here would
  // trip `lib/__tests__/pipeline-no-phantom-columns.test.ts`, which forbids that
  // word in this file outside a comment.
  /^`\w+` is not a field on an issue\b/i,
  // ── app/api/db/[...path]/route.ts ──
  /^Unauthorized: sign in to Mission Control first$/i,
  /^Method not allowed\b/i,
  /^Not proxied\b/i,
  /^Read-only through this endpoint\b/i,
  /^This issues query has no project scope\b/i,
  // ── middleware.ts ──
  /^Unauthenticated: sign in\b/i,
  /^Read-only access\b/i,
  /^Forbidden:\s/i,
  // ── app/api/agents/route.ts, app/api/pipeline-metrics/route.ts ──
  /^agent_id required$/i,
  /^window must be 7d or 30d$/i,
]

/**
 * Messages `lib/fetch-json.ts` writes ITSELF, without a server. A failed
 * `fetch()` never reaches a route, so no route literal covers these, and they
 * are the most common thing an operator actually sees.
 */
const CLIENT_TRANSPORT_MESSAGES: readonly RegExp[] = [
  /^could not reach the server$/i,
  /^request failed$/i,
  /^invalid JSON in response\b/i,
  /^no such endpoint; the server returned an HTML page\b/i,
  /^the server returned an HTML error page instead of JSON\b/i,
  // Whatever the platform's own `fetch()` rejection says. Four spellings across
  // undici/Chrome/Firefox/Safari; all four are English and none is ours to
  // reword.
  /^(?:failed to fetch|fetch failed|load failed|terminated)$/i,
  /^networkerror\b/i,
]

/**
 * `readApiError` falls back to `res.statusText` when a body carries no `error`
 * and no `message`. That is HTTP's own English and there is nothing to improve
 * about it — but it has to be named, or the allowlist would replace "Not Found"
 * with a sentence about the database.
 */
const HTTP_STATUS_TEXT =
  /^(?:continue|ok|created|accepted|no content|moved permanently|found|not modified|bad request|unauthorized|payment required|forbidden|not found|method not allowed|not acceptable|request timeout|conflict|gone|length required|precondition failed|payload too large|content too large|uri too long|unsupported media type|range not satisfiable|expectation failed|unprocessable entity|unprocessable content|locked|failed dependency|too early|upgrade required|precondition required|too many requests|request header fields too large|unavailable for legal reasons|internal server error|not implemented|bad gateway|service unavailable|gateway timeout|http version not supported|insufficient storage|loop detected|network authentication required)$/i

/**
 * Machine tokens the MC API sends in `error`, with the sentence in `message`.
 * `readApiError` prefers `error` — `lib/fetch-json.ts` reads
 * `body?.error ?? body?.message ?? …` — so the TOKEN is what reaches
 * `ApiError.message`, and therefore the banner. A token is not English, so it
 * is neither passed through nor handed the database sentence: it gets wording
 * taken from the route's own `message` field, minus the interpolated values the
 * client never receives.
 */
const API_TOKEN_SENTENCES: Readonly<Record<string, string>> = {
  unscoped_issues_read:
    'That request asked for issues without naming a project. Open the board from a project screen and try again.',
  project_outside_scope:
    'This screen is scoped to one project and cannot show issues from another one.',
}

/** True when the message is one this repo can point at the source of. */
function isKnownHumanMessage(message: string): boolean {
  return (
    MC_API_MESSAGES.some(re => re.test(message)) ||
    CLIENT_TRANSPORT_MESSAGES.some(re => re.test(message)) ||
    HTTP_STATUS_TEXT.test(message)
  )
}

const SPRINT_IN_BACKLOG = 'An issue in Backlog cannot carry a sprint. Clear the sprint first.'
const SPRINT_REQUIRED = 'An issue being worked has to belong to a sprint. Set a sprint and try the move again.'

/** How both dialects spell "the code named a column/table that is not there". */
const PHANTOM_COLUMN_SHAPE =
  /\bno such (?:column|table)\b|\bdoes not exist\b|\bschema cache\b|\bPGRST\d+\b|\bundefined column\b/i

/**
 * Known constraints and known driver failures, each with the sentence a person
 * would have written.
 *
 * Reached only by messages the allowlist did NOT recognise, so everything here
 * REFINES the generic sentence rather than being the thing that stands between
 * the schema and the screen. The allowlist is that thing. Deleting any single
 * entry below makes one message vaguer; it never makes one leak.
 *
 * TWO spellings per constraint rule, because two dialects report the same rule
 * differently: SQLite prints the CHECK EXPRESSION, because
 * `migrations/sqlite/000_baseline.sql` writes the checks inline and unnamed;
 * Postgres prints the CONSTRAINT NAME, because
 * `migrations/001_add_review_fields.sql` and friends name them. Both forms were
 * captured on 2026-08-26.
 *
 * PROVENANCE is stated per group: the constraint entries were forced out of the
 * running server and out of PGlite. The operational entries were reproduced
 * from the drivers' own documented messages and were NOT forced through this
 * API — they are marked as such.
 */
const KNOWN_CONSTRAINTS: readonly { readonly match: RegExp; readonly sentence: string }[] = [
  // ── forced through the API, both dialects, 2026-08-26 ──
  // Order matters: both sprint constraints contain the substring
  // `sprint IS NOT NULL`, so each is matched on the half that distinguishes it
  // — the status list for one, `status = 'backlog'` for the other — and the
  // narrower of the two is tested first.
  { match: /status = 'backlog'\)? AND \(?sprint IS NOT NULL/i, sentence: SPRINT_IN_BACKLOG },
  { match: /constraint "backlog_no_sprint"/i, sentence: SPRINT_IN_BACKLOG },
  { match: /status NOT IN \(\s*'open'/i, sentence: SPRINT_REQUIRED },
  { match: /constraint "sprint_required_if_open"/i, sentence: SPRINT_REQUIRED },
  {
    match: /test_tier IN|constraint "[^"]*test_tier[^"]*"/i,
    sentence: 'The test tier has to be one of smoke, integration or e2e.',
  },
  {
    match: /resolution_type IS NULL\) OR \(resolution_type IN|constraint "[^"]*resolution_type[^"]*"/i,
    sentence: 'That resolution type is not one the workflow recognises. Pick one from the list.',
  },
  {
    match: /deployer_status IN|constraint "[^"]*deployer_status[^"]*"/i,
    sentence: 'The deployer status has to be either ready or failed.',
  },
  {
    match: /UNIQUE constraint failed: issues\.task_key|unique constraint "[^"]*task_key[^"]*"/i,
    sentence: 'Another issue already has this key. Reload the board and try again.',
  },
  {
    // A column the code named and the database does not have — SQLite's
    // `no such column: …`, Postgres's `column "…" does not exist`, or a whole
    // missing table. This is a Todero bug, not an operator mistake, and saying
    // so is the one useful thing the board can say. The identifier is
    // deliberately NOT echoed: an operator cannot add a column, and the raw
    // message is already written to the console by the caller.
    match: PHANTOM_COLUMN_SHAPE,
    sentence: 'The board asked the database for a field it does not have. That is a bug in Todero, ' +
      'not something you did — nothing was changed. Please report it; the details are in the browser console.',
  },
  {
    // Postgres type coercion — `invalid input syntax for type integer: "lots"`.
    // SQLite is typeless enough that the same payload is stored rather than
    // refused, so this shape only ever appears on the Postgres side.
    match: /\binvalid input syntax for type\b|\bdatatype mismatch\b|\bdate\/time field value out of range\b|\binvalid byte sequence\b/i,
    sentence: 'One of the values sent with this move was the wrong kind for the field it belongs to. ' +
      'Nothing was changed. Reload the board and try again.',
  },
  {
    match: /\bnull value in column\b|NOT NULL constraint failed/i,
    sentence: 'This move would have emptied a field the issue is required to have. Nothing was changed.',
  },
  // ── the drivers' own documented messages, reproduced from the driver and NOT
  //    forced through this API. Each only sharpens the generic sentence. ──
  {
    match: /\bvalue too long for type\b|\bstring or blob too big\b/i,
    sentence: 'One of the values sent with this move is longer than the field allows. Nothing was changed.',
  },
  {
    match: /\bdeadlock detected\b|\bcould not serialize access\b|\bcould not obtain lock\b/i,
    sentence: 'Another change landed on this issue at the same moment. Nothing was changed — ' +
      'reload the board and try the move again.',
  },
  {
    match: /\bdatabase (?:table )?is locked\b|\bSQLITE_BUSY\b|\bcanceling statement due to\b|\bstatement timeout\b/i,
    sentence: 'The database was busy and the move did not go through. Nothing was changed — try again.',
  },
  {
    match: /\bpermission denied\b|\bmust be owner of\b|\bread-only transaction\b|\breadonly database\b|\bSQLITE_READONLY\b/i,
    sentence: 'Todero’s database connection is not allowed to make this change. Nothing was changed — ' +
      'that is a configuration problem to report, not something you did.',
  },
  {
    match: /\bconnection to server\b|\bserver closed the connection\b|\bcould not connect to server\b|\bECONNREFUSED\b|\bconnection refused\b/i,
    sentence: 'Todero could not reach its database. Nothing was changed — try again in a moment, ' +
      'and report it if it keeps happening.',
  },
]

/**
 * The two sprint CHECKs, disambiguated by DESTINATION when the message does not
 * name them.
 *
 * A Postgres install created straight from `migrations/000_baseline_schema.sql`
 * without `001_add_review_fields.sql` gets ANONYMOUS check constraints, and
 * Postgres then reports them as `"issues_check"`, `"issues_check1"`, … —
 * measured on PGlite, 2026-08-26. Those names carry no information, so the
 * message alone cannot tell the two sprint rules apart.
 *
 * The destination can, and cannot be wrong about it: `backlog_no_sprint` is the
 * only sprint rule that a move TO backlog can violate, and
 * `sprint_required_if_open` is the only one a move to open/in_progress can. Any
 * other destination gets nothing from this and falls through to the generic
 * sentence rather than to a guess.
 */
function anonymousCheckSentence(raw: string, toStatus: string): string | null {
  if (!/constraint "issues_check\d*"/i.test(raw)) return null
  if (toStatus === 'backlog') return SPRINT_IN_BACKLOG
  if (toStatus === 'open' || toStatus === 'in_progress') return SPRINT_REQUIRED
  return null
}

/** The token map, applied identically on both paths. */
function tokenSentence(raw: string): string | null {
  return Object.prototype.hasOwnProperty.call(API_TOKEN_SENTENCES, raw)
    ? API_TOKEN_SENTENCES[raw]
    : null
}

/**
 * The sentence to show when a move is refused.
 *
 * A message this repo wrote is passed through unchanged — the MC API's own
 * refusals ("Only main/po/ops or the workspace owner can reset an issue to
 * backlog.", the one-at-a-time lane 409, the ten-open cap 409) say more than any
 * rewrite could. EVERYTHING ELSE is replaced, including messages this file has
 * never seen and has no translation for.
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

  const token = tokenSentence(raw)
  if (token) return token

  if (isKnownHumanMessage(raw)) return raw

  for (const { match, sentence } of KNOWN_CONSTRAINTS) {
    if (match.test(raw)) return sentence
  }

  const byDestination = anonymousCheckSentence(raw, toStatus)
  if (byDestination) return byDestination

  return `The move to "${toStatus}" was refused by a rule this board does not have wording for yet. ` +
    'Nothing was changed. Please report it — the raw message is in the browser console.'
}

/**
 * The same last gate, for a READ that failed rather than a move.
 *
 * `components/ApiErrorBanner.tsx` renders `formatApiError(error)` — literally
 * `data unavailable — <status> from <endpoint>: <server message>` — and that
 * server message is unfiltered. Measured 2026-08-26 against the running server,
 * scoped exactly the way the Pipeline scopes its own reads:
 *
 *   GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&select=nope_not_a_column&limit=1
 *   → 400 {"error":"no such column: \"nope_not_a_column\" - should this be a
 *          string literal in single-quotes?","code":"42703","details":null}
 *
 * `app/api/db/[...path]/route.ts:286` hands `result.error.message` back
 * verbatim, so any read that reaches the driver and fails puts driver text into
 * that red bar with nothing in between. The Pipeline's own four reads use fixed,
 * valid queries, so this is not something an operator can trigger from the board
 * TODAY — it is an unguarded channel, not a live leak, and it is written up as
 * such. This function is the guard: same allowlist as `humaniseMoveFailure`,
 * worded for a load instead of a move.
 *
 * The status and the endpoint are NOT touched — an operator still gets to tell a
 * refused request from an empty dataset, which is the whole point of that
 * banner. Only the message half is replaced.
 */
export function humaniseLoadFailure(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return 'the server did not say why'

  const token = tokenSentence(raw)
  if (token) return token

  if (isKnownHumanMessage(raw)) return raw

  if (PHANTOM_COLUMN_SHAPE.test(raw)) {
    return 'the board asked for a field the database does not have — a bug in Todero, not a ' +
      'permission problem. The details are in the browser console.'
  }
  return 'the database refused the query in terms this board has no wording for yet. ' +
    'The raw message is in the browser console.'
}

/**
 * The banner half of "no raw database text, ever".
 *
 * `ApiErrorBanner` renders `formatApiError(error)` verbatim, by design — an
 * operator has to be able to tell a refused request from an empty dataset. That
 * design is right about the STATUS and the ENDPOINT and silent about the
 * MESSAGE, which is whatever the server put in `{error: …}`. For the db proxy
 * that is `result.error.message` — the driver's own string
 * (`app/api/db/[...path]/route.ts:286`).
 *
 * It lives HERE, not in `components/tabs/PipelineTab.tsx` where it started, for
 * one measured reason: inside the component the only test that could reach it
 * was one that greps the source for identifier names, and on 2026-08-26 that
 * test was proven blind — gutting the function to `return error` as its first
 * statement left the whole suite green (84 passed / 84 total) while every
 * Pipeline banner went back to rendering driver text. As a pure exported
 * function it is called directly by a test that asserts the REPLACEMENT, and
 * the same mutation now fails.
 *
 * Generic over the error shape rather than typed to `ApiError`, so this module
 * takes no import from the fetch layer.
 */
export function safeApiError<E extends { readonly message: string }>(error: E): E {
  const human = humaniseLoadFailure(error.message)
  return human === error.message ? error : { ...error, message: human }
}
