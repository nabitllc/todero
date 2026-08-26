// lib/__tests__/issue-moves.test.ts
//
// The predicate in `lib/issue-moves.ts` decides which moves the Pipeline offers.
// A predicate that says a move is possible when it is not is worse than no
// predicate: it turns a refusal the operator could have been warned about into a
// refusal they discover by tapping. So these tests are written the other way up
// from the usual "does it allow the good case" — the load-bearing assertions are
// the ones that fail when the predicate becomes too PERMISSIVE.
//
// Every expectation below corresponds to a refusal reproduced against the
// running MC API on 2026-08-26, one fresh `ops` fixture per case, as the
// signed-in owner. The measurements and the exact server strings are recorded in
// `docs/rebuild/pieces/pieces6/moves-that-complete.md` §2.

import fs from 'node:fs'
import path from 'node:path'
import {
  moveVerdict,
  requiredFieldsForMove,
  unmetFields,
  moveBody,
  humaniseMoveFailure,
  humaniseLoadFailure,
  safeApiError,
  todaysSprint,
  BACKLOG_RESET_ROLES,
  type MoveIssue,
} from '@/lib/issue-moves'
import { VALID_STATUSES } from '@/lib/constants'
import { mappedStatuses } from '@/lib/pipeline-stages'

const OWNER = 'michael'

/** A row as `POST /api/issues` actually creates one — measured, not imagined. */
function freshBacklogRow(over: MoveIssue = {}): MoveIssue {
  return {
    id: 'row-1',
    task_key: 'TOD-99',
    title: 'probe',
    status: 'backlog',
    type: 'ops',
    priority: 'low',
    assignee: 'ops',
    owner: 'ops',
    project: 'Limiglow',
    description: 'probe row',
    acceptance_criteria: 'deleted after',
    sprint: null,
    test_tier: null,
    resolution_type: null,
    implementation_notes: null,
    commit_sha: null,
    regression_test: null,
    ...over,
  }
}

/**
 * The measured truth table for a FRESH backlog row and a bare `{id, status}`
 * PATCH: which of the sixteen the server completed, and which it refused.
 *
 * This is the table from the piece doc, transcribed once. Everything below
 * checks the predicate against it rather than against a second opinion.
 */
const MEASURED_BARE_MOVE_SUCCEEDS: Readonly<Record<string, boolean>> = {
  backlog: true,          // 200, but only because it was already backlog (no-op)
  draft: true,            // 200
  defined: true,          // 200 — POST always sets `owner`
  refined: false,         // 400 test_tier is required for task/bug/ops
  open: false,            // 500 CHECK … OR (sprint IS NOT NULL)
  in_progress: false,     // 500 the same CHECK
  underway: true,         // 200
  active: true,           // 200
  code_review: false,     // 422 resolution_type, then 3 more gates
  product_review: false,  // 422 resolution_type, then implementation_notes
  feature_review: true,   // 200
  approved: true,         // 200
  released: true,         // 200
  wrapped: true,          // 200
  completed: true,        // 200
  closed: false,          // 422 resolution_type
}

describe('the sixteen destinations, against what the server actually did', () => {
  it('covers every status the board displays, and nothing else', () => {
    expect(Object.keys(MEASURED_BARE_MOVE_SUCCEEDS).sort()).toEqual([...mappedStatuses()].sort())
    expect(Object.keys(MEASURED_BARE_MOVE_SUCCEEDS).sort()).toEqual([...VALID_STATUSES].sort())
    expect(Object.keys(MEASURED_BARE_MOVE_SUCCEEDS)).toHaveLength(16)
  })

  it('predicts a bare move as ready exactly where the server completed one', () => {
    const row = freshBacklogRow()
    const wrong: string[] = []
    for (const [status, serverSucceeded] of Object.entries(MEASURED_BARE_MOVE_SUCCEEDS)) {
      const v = moveVerdict(row, status, OWNER)
      // `backlog` is the row's current status, so the predicate says `current`
      // and the server's 200 was a no-op. Both agree there is nothing to do.
      const predictsBareMoveWorks = v.kind === 'ready' || v.kind === 'current'
      if (predictsBareMoveWorks !== serverSucceeded) {
        wrong.push(`${status}: predicate says ${v.kind}, server ${serverSucceeded ? 'accepted' : 'refused'} it`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('never says a refused move is ready — the failure that matters', () => {
    const row = freshBacklogRow()
    for (const [status, serverSucceeded] of Object.entries(MEASURED_BARE_MOVE_SUCCEEDS)) {
      if (serverSucceeded) continue
      expect(moveVerdict(row, status, OWNER).kind).not.toBe('ready')
    }
  })

  it('gives every refused destination a reachable path or a stated reason', () => {
    const row = freshBacklogRow()
    for (const [status, serverSucceeded] of Object.entries(MEASURED_BARE_MOVE_SUCCEEDS)) {
      if (serverSucceeded) continue
      const v = moveVerdict(row, status, OWNER)
      expect(['needs', 'blocked']).toContain(v.kind)
      if (v.kind === 'needs') expect(v.fields.length).toBeGreaterThan(0)
      if (v.kind === 'blocked') expect(v.reason.length).toBeGreaterThan(20)
    }
  })
})

describe('the exact fields each refusal asked for', () => {
  it('refined wants test_tier when the description is already there', () => {
    // Measured: 400 "test_tier is required for task/bug/ops before moving to refined."
    expect(requiredFieldsForMove(freshBacklogRow(), 'refined').map(f => f.field))
      .toEqual(['test_tier'])
  })

  it('refined wants description too once it is gone', () => {
    // Measured: PATCH description:null, then 400 "description is required…".
    expect(requiredFieldsForMove(freshBacklogRow({ description: null }), 'refined').map(f => f.field))
      .toEqual(['description', 'test_tier'])
  })

  it('refined skips test_tier for an epic — measured, an epic went straight through', () => {
    expect(requiredFieldsForMove(freshBacklogRow({ type: 'epic' }), 'refined')).toEqual([])
    expect(moveVerdict(freshBacklogRow({ type: 'epic' }), 'refined', OWNER).kind).toBe('ready')
  })

  it('open wants sprint, and acceptance_criteria only when missing', () => {
    expect(requiredFieldsForMove(freshBacklogRow(), 'open').map(f => f.field)).toEqual(['sprint'])
    expect(requiredFieldsForMove(freshBacklogRow({ acceptance_criteria: null }), 'open').map(f => f.field))
      .toEqual(['acceptance_criteria', 'sprint'])
  })

  it('in_progress wants sprint and nothing else', () => {
    expect(requiredFieldsForMove(freshBacklogRow(), 'in_progress').map(f => f.field)).toEqual(['sprint'])
    expect(requiredFieldsForMove(freshBacklogRow({ sprint: '2026-08-26' }), 'in_progress')).toEqual([])
  })

  it('code_review wants all four gates for task/bug/ops, in the order the API checks them', () => {
    // Measured one at a time: resolution_type -> implementation_notes ->
    // commit_sha -> regression_test. Four round trips if prompted singly.
    expect(requiredFieldsForMove(freshBacklogRow(), 'code_review').map(f => f.field))
      .toEqual(['resolution_type', 'implementation_notes', 'commit_sha', 'regression_test'])
  })

  it('code_review skips the commit gates for an epic — measured, an epic went through with two', () => {
    expect(requiredFieldsForMove(freshBacklogRow({ type: 'epic' }), 'code_review').map(f => f.field))
      .toEqual(['resolution_type', 'implementation_notes'])
  })

  it('treats commit_sha "none" as absent, because the API does', () => {
    // route.ts:1940 — `if (!commitSha || commitSha === 'none')`.
    const row = freshBacklogRow({
      resolution_type: 'code_change',
      implementation_notes: 'did the thing properly',
      commit_sha: 'none',
      regression_test: 'npm test',
    })
    expect(requiredFieldsForMove(row, 'code_review').map(f => f.field)).toEqual(['commit_sha'])
  })

  it('counts implementation_notes shorter than 10 characters as missing', () => {
    // route.ts:1821 — `String(effectiveImplNotes).trim().length < 10`.
    const short = freshBacklogRow({ resolution_type: 'code_change', implementation_notes: 'too short' })
    expect(requiredFieldsForMove(short, 'product_review').map(f => f.field)).toEqual(['implementation_notes'])
    const ok = freshBacklogRow({ resolution_type: 'code_change', implementation_notes: 'long enough now' })
    expect(requiredFieldsForMove(ok, 'product_review')).toEqual([])
  })

  it('closed wants resolution_type, from any source status', () => {
    // Measured from backlog (422) and from released (422).
    expect(requiredFieldsForMove(freshBacklogRow(), 'closed').map(f => f.field)).toEqual(['resolution_type'])
    expect(requiredFieldsForMove(freshBacklogRow({ status: 'released' }), 'closed').map(f => f.field))
      .toEqual(['resolution_type'])
  })

  it('offers only resolution types the database CHECK accepts', () => {
    const field = requiredFieldsForMove(freshBacklogRow(), 'closed')[0]
    expect(field.kind).toBe('select')
    // The `resolution_type` CHECK on `issues` lists exactly VALID_RESOLUTION_TYPES.
    expect(field.options).toEqual(expect.arrayContaining(['code_change', 'wont_fix']))
  })

  it('every prompted field is one the API accepts on PATCH', () => {
    // `owner` is stripped from every PATCH payload (route.ts:2178-2181), so it
    // must never appear as something the sheet asks for.
    const row = freshBacklogRow({ owner: null, description: null, acceptance_criteria: null })
    for (const status of mappedStatuses()) {
      for (const f of requiredFieldsForMove(row, status)) {
        expect(f.field).not.toBe('owner')
      }
    }
  })
})

describe('moves the board cannot complete are blocked, not hidden and not offered', () => {
  it('allows backlog from any other status for the signed-in owner', () => {
    // Measured 2026-08-26 against the running server: `defined -> backlog` as
    // the owner (mc-role=owner, no transitioned_by sent) is 200, not 403.
    // route.ts's backlog guard (route.ts:1730) already carries an
    // isOwnerActor() bypass, landed in 62d9d82 (TOD-2452) — the same commit
    // that created this predicate. The comment this replaces ("Measured:
    // defined -> backlog as `michael` is 403") described a state the server
    // side of that very commit had already fixed; only the client mirror and
    // this test were left claiming otherwise.
    const v = moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', OWNER)
    expect(v.kind).toBe('ready')
  })

  it('allows backlog for an actor the API accepts', () => {
    // Measured: the same PATCH carrying transitioned_by: 'po' is 200.
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', 'po').kind).toBe('ready')
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', 'ops').kind).toBe('ready')
  })

  it('blocks backlog for a signed-in actor who is neither owner nor main/po/ops', () => {
    // Measured: the same PATCH carrying transitioned_by: 'viewer' is 403
    // "Only main/po/ops or the workspace owner can reset an issue to backlog."
    const v = moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', 'viewer')
    expect(v.kind).toBe('blocked')
    if (v.kind === 'blocked') expect(v.reason).toMatch(/main, po, ops/)
  })

  it('blocks backlog when nobody is signed in, the way the server does', () => {
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', undefined).kind).toBe('blocked')
  })

  it('mirrors the server\'s KAOS_ROLES verbatim — fails loudly the moment the two drift', () => {
    // This is the guard the fix asked for: `KAOS_ROLES` in route.ts is a local,
    // unexported const (the request to export it, or move it beside
    // OWNER_IDENTITY in lib/operator-identity.ts, is written up in
    // moves-that-complete.md §4), so this predicate cannot IMPORT it and can
    // only mirror it by hand. A silent mirror is exactly how the false
    // "defined -> backlog is 403" comment survived a commit that fixed the
    // server. This test reads route.ts's own source and fails if its list
    // ever changes without this one changing too.
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/issues/route.ts'),
      'utf8',
    )
    const match = routeSrc.match(/const KAOS_ROLES = (\[[^\]]*\])/)
    expect(match).not.toBeNull()
    const serverRoles: string[] = JSON.parse(match![1].replace(/'/g, '"'))
    expect([...BACKLOG_RESET_ROLES]).toEqual(serverRoles)
  })

  it('allows backlog for a card carrying a sprint, for the owner', () => {
    // The actor gate and the sprint CHECK are two separate refusals on the
    // same destination — this only proves the actor half. The sprint half is
    // proved by `moveBody` clearing it (see 'the body the sheet sends' below).
    const v = moveVerdict(freshBacklogRow({ status: 'in_progress', sprint: '2026-08-26' }), 'backlog', OWNER)
    expect(v.kind).toBe('ready')
  })

  it('blocks every destination on a closed card', () => {
    // Measured: closed -> open / draft / completed are all 403
    // "Issue is closed and read-only."
    const closed = freshBacklogRow({ status: 'closed', resolution_type: 'code_change' })
    for (const status of mappedStatuses()) {
      const v = moveVerdict(closed, status, OWNER)
      expect(v.kind).toBe('blocked')
      if (v.kind === 'blocked') expect(v.reason).toMatch(/closed and read-only/)
    }
  })

  it('blocks defined on an owner-less row instead of prompting for an owner', () => {
    const v = moveVerdict(freshBacklogRow({ owner: null }), 'defined', OWNER)
    expect(v.kind).toBe('blocked')
    if (v.kind === 'blocked') expect(v.reason).toMatch(/cannot be changed from the board/)
  })

  it('blocks — never readies — a status the board does not recognise', () => {
    // The default for the unknown case has to be refusal. `in_review`, `done`
    // and `blocked` are RETIRED_STATUSES the API rejects outright.
    for (const status of ['in_review', 'done', 'blocked', 'cancelled', '', 'OPEN']) {
      expect(moveVerdict(freshBacklogRow(), status, OWNER).kind).toBe('blocked')
    }
  })
})

describe('the body the sheet sends', () => {
  it('sends only id, status and the fields this move needs', () => {
    const row = freshBacklogRow()
    expect(moveBody(row, 'in_progress', { sprint: '2026-08-26', commit_sha: 'abc' }))
      .toEqual({ id: 'row-1', status: 'in_progress', sprint: '2026-08-26' })
  })

  it('never attaches a FORM-typed sprint value to a move to backlog', () => {
    // Measured: `{status:'backlog', sprint:'2026-08-26'}` is 500
    // "CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))".
    // The row here has no sprint of its own (freshBacklogRow's default), so
    // there is nothing to clear either — this only proves a value sitting in
    // `values` (there is no backlog form field that would put one there) can't
    // leak into the body.
    const body = moveBody(freshBacklogRow({ status: 'defined' }), 'backlog', { sprint: '2026-08-26' })
    expect(body).toEqual({ id: 'row-1', status: 'backlog' })
    expect(body).not.toHaveProperty('sprint')
  })

  it('clears a sprint the row already carries when moving to backlog', () => {
    // Measured 2026-08-26: an `in_progress` row with `sprint: '2026-08-26'`,
    // bare `{id, status: 'backlog'}` as the owner, is 500 — the identical CHECK
    // string above. The same request with `sprint: null` added is 200 and
    // reads back `sprint: null`. `route.ts`'s backlog-reset handler resets
    // `worked_by`/`started_at`/`submitted_at` unconditionally but not `sprint`
    // unless told to, so the client has to say so.
    const row = freshBacklogRow({ status: 'in_progress', sprint: '2026-08-26' })
    expect(moveBody(row, 'backlog', {})).toEqual({ id: 'row-1', status: 'backlog', sprint: null })
  })

  it('does not add a sprint key when the row has none to clear', () => {
    const row = freshBacklogRow({ status: 'defined', sprint: null })
    const body = moveBody(row, 'backlog', {})
    expect(body).toEqual({ id: 'row-1', status: 'backlog' })
    expect(body).not.toHaveProperty('sprint')
  })

  it('sends a bare body when the move needs nothing', () => {
    expect(moveBody(freshBacklogRow(), 'draft', {})).toEqual({ id: 'row-1', status: 'draft' })
  })

  it('reports which collected values are still short of what the server wants', () => {
    const fields = requiredFieldsForMove(freshBacklogRow(), 'code_review')
    expect(unmetFields(fields, {})).toEqual(
      ['resolution_type', 'implementation_notes', 'commit_sha', 'regression_test'])
    expect(unmetFields(fields, {
      resolution_type: 'code_change',
      implementation_notes: 'too short',
      commit_sha: 'deadbeef',
      regression_test: 'npm test',
    })).toEqual(['implementation_notes'])
    expect(unmetFields(fields, {
      resolution_type: 'code_change',
      implementation_notes: 'did the thing properly',
      commit_sha: 'deadbeef',
      regression_test: 'npm test',
    })).toEqual([])
  })

  it('offers today in the sprint format the API writes', () => {
    expect(todaysSprint(new Date('2026-08-26T15:00:00Z'))).toBe('2026-08-26')
    const field = requiredFieldsForMove(freshBacklogRow(), 'in_progress')[0]
    expect(field.defaultValue).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('no raw database text reaches the operator', () => {
  // These two strings are verbatim server responses, copied from the measurement
  // run. If either ever renders as-is, the piece has failed.
  const SPRINT_CHECK =
    "CHECK constraint failed: ((status NOT IN ('open', 'in_progress', 'in_review')) OR (sprint IS NOT NULL))"
  const BACKLOG_CHECK =
    "CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))"

  it('replaces the sprint CHECK with a sentence a person wrote', () => {
    const out = humaniseMoveFailure(SPRINT_CHECK, 'open', 500)
    expect(out).not.toMatch(/CHECK constraint/)
    expect(out).not.toMatch(/IS NOT NULL/)
    expect(out).toBe('An issue being worked has to belong to a sprint. Set a sprint and try the move again.')
  })

  it('tells the two sprint constraints apart', () => {
    expect(humaniseMoveFailure(BACKLOG_CHECK, 'backlog', 500))
      .toBe('An issue in Backlog cannot carry a sprint. Clear the sprint first.')
  })

  it('replaces database text it has no translation for, rather than passing it through', () => {
    const invented = 'CHECK constraint failed: ((frobnicator IS NULL) OR (widget_count > 3))'
    const out = humaniseMoveFailure(invented, 'approved', 500)
    expect(out).not.toMatch(/CHECK constraint/)
    expect(out).not.toMatch(/frobnicator/)
    expect(out).toMatch(/Nothing was changed/)
  })

  it('catches every shape of database output, not only SQLite CHECKs', () => {
    const shapes = [
      'UNIQUE constraint failed: issues.task_key',
      'NOT NULL constraint failed: issues.title',
      'FOREIGN KEY constraint failed',
      'SQLITE_BUSY: database is locked',
      'no such column: test_status',
      'new row for relation "issues" violates check constraint "issues_status_check"',
      'PGRST204: column not found in schema cache',
    ]
    for (const s of shapes) {
      const out = humaniseMoveFailure(s, 'open', 500)
      expect(out).not.toBe(s)
      expect(out.toLowerCase()).not.toMatch(/sqlite|pgrst|no such column/)
    }
  })

  it('leaves the API\'s own sentences alone — they say more than any rewrite', () => {
    const humanRefusals = [
      'Only main/po/ops can reset an issue to backlog.',
      'Issue is closed and read-only.',
      'resolution_type is required to close an issue. Allowed: code_change, config_change',
      'One-at-a-time lane enforcement: ops is already working on TOD-84 ("probe"). Complete or reset that issue before claiming a new one.',
      'Backlog-first policy: cannot move issue to open when 10 or more issues are already open. Finish or backlog existing open issues first.',
    ]
    for (const s of humanRefusals) expect(humaniseMoveFailure(s, 'open', 409)).toBe(s)
  })

  it('still says something when the server says nothing at all', () => {
    const out = humaniseMoveFailure('', 'approved', 502)
    expect(out).toMatch(/refused/)
    expect(out).toMatch(/502/)
    expect(humaniseMoveFailure(null, 'approved')).toMatch(/did not say why/)
  })
})

/* ── the dialect half of the same rule ───────────────────────────────────────
 *
 * Every string in this block is VERBATIM driver output captured on 2026-08-26,
 * not wording invented for a test:
 *
 *  * the SQLite lines were forced out of the RUNNING server with
 *    `PATCH /api/issues` against throwaway `Limiglow` fixtures (deleted in the
 *    same run) and are the `error` field of the 500 body.
 *  * the Postgres lines were forced out of a real Postgres — PGlite, in
 *    process — over a table whose CHECK/UNIQUE/FK definitions were copied
 *    verbatim from `migrations/001_add_review_fields.sql`,
 *    `migrations/014_resolution_type_constraint.sql`,
 *    `migrations/018_issues_test_tier.sql` and
 *    `migrations/025_deployer_status.sql`.
 *
 * The point of the block is the SECOND list. Before this revision the signature
 * list was written entirely in SQLite's spelling, so the same constraint that
 * produced a sentence on the dev box produced raw schema text on Postgres — and
 * `migrations/*.sql` is the Postgres dialect this repo also ships, runs its
 * tests on, and is migrating to. Six shapes leaked. Each is pinned below by the
 * exact string that leaked.
 */
describe('no raw database text reaches the operator — in EITHER dialect', () => {
  /** Driver output that must never survive `humaniseMoveFailure` unchanged. */
  const RAW = {
    sqlite: [
      "CHECK constraint failed: ((status NOT IN ('open', 'in_progress', 'in_review')) OR (sprint IS NOT NULL))",
      "CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))",
      "CHECK constraint failed: (test_tier IN ('smoke', 'integration', 'e2e'))",
      "CHECK constraint failed: (deployer_status IN ('ready', 'failed'))",
      'NOT NULL constraint failed: issues.title',
      'FOREIGN KEY constraint failed',
      'UNIQUE constraint failed: issues.task_key',
      'no such column: test_status',
      'SQLITE_BUSY: database is locked',
      'datatype mismatch',
    ],
    postgres: [
      'new row for relation "issues" violates check constraint "backlog_no_sprint"',
      'new row for relation "issues" violates check constraint "sprint_required_if_open"',
      'new row for relation "issues" violates check constraint "issues_test_tier_check"',
      'new row for relation "issues" violates check constraint "issues_deployer_status_check"',
      'new row for relation "issues" violates check constraint "tasks_resolution_type_check"',
      'duplicate key value violates unique constraint "issues_task_key_key"',
      'insert or update on table "issues" violates foreign key constraint "issues_parent_id_fkey"',
      // ── the six shapes that LEAKED VERBATIM before this revision ──
      'null value in column "title" of relation "issues" violates not-null constraint',
      'invalid input syntax for type integer: "lots"',
      'invalid input syntax for type boolean: "yes-please"',
      'invalid input syntax for type uuid: "not-a-uuid"',
      'invalid input syntax for type timestamp with time zone: "whenever"',
      'column "test_status" does not exist',
      'column "test_status" of relation "issues" does not exist',
      'relation "nope_not_a_table" does not exist',
    ],
  }

  /** Fragments that are schema, SQL or driver vocabulary — never operator words. */
  const SCHEMA_VOCABULARY =
    /constraint|sqlite|pgrst|relation "|invalid input syntax|does not exist|IS NOT NULL|NOT IN \(|duplicate key|schema cache|test_status|issues\.|datatype mismatch/i

  it.each([...RAW.sqlite, ...RAW.postgres])('never shows %s', raw => {
    const out = humaniseMoveFailure(raw, 'open', 500)
    expect(out).not.toBe(raw)
    expect(out).not.toMatch(SCHEMA_VOCABULARY)
  })

  it('gives the SAME sentence for the same rule in both dialects', () => {
    const pairs: [string, string][] = [
      [RAW.sqlite[0], RAW.postgres[1]], // sprint required while worked
      [RAW.sqlite[1], RAW.postgres[0]], // backlog must not carry a sprint
      [RAW.sqlite[2], RAW.postgres[2]], // test_tier
      [RAW.sqlite[3], RAW.postgres[3]], // deployer_status
      [RAW.sqlite[6], RAW.postgres[5]], // duplicate task_key
    ]
    for (const [sqliteText, pgText] of pairs) {
      expect(humaniseMoveFailure(sqliteText, 'backlog', 500))
        .toBe(humaniseMoveFailure(pgText, 'backlog', 500))
    }
  })

  it('names the phantom-column class as a Todero bug rather than a refusal', () => {
    for (const raw of ['no such column: test_status', 'column "test_status" does not exist']) {
      expect(humaniseMoveFailure(raw, 'code_review', 500)).toMatch(/bug in Todero/)
    }
  })

  it('tells the two anonymous sprint CHECKs apart by destination', () => {
    // A Postgres install built from 000_baseline_schema.sql alone reports both
    // sprint rules as "issues_check"/"issues_check1" — measured on PGlite. The
    // message cannot disambiguate; the destination can.
    const anon = (n: string) => `new row for relation "issues" violates check constraint "${n}"`
    expect(humaniseMoveFailure(anon('issues_check'), 'backlog', 500))
      .toBe('An issue in Backlog cannot carry a sprint. Clear the sprint first.')
    expect(humaniseMoveFailure(anon('issues_check1'), 'in_progress', 500))
      .toBe('An issue being worked has to belong to a sprint. Set a sprint and try the move again.')
    // No destination to reason from → the generic sentence, never a guess.
    expect(humaniseMoveFailure(anon('issues_check1'), 'approved', 500))
      .toMatch(/does not have wording for yet/)
  })

  it('still leaves every human sentence the MC API writes alone', () => {
    // Broadening the signature list must not start swallowing the API's own
    // English. Each of these is a verbatim refusal body measured against the
    // running server on 2026-08-26.
    const humanRefusals = [
      'test_tier is required for task/bug/ops before moving to refined. Set it to smoke, integration, or e2e.',
      'resolution_type is required before moving to code_review. Set it to what was done (e.g. code_change, config_change, research_completed). Allowed: code_change, config_change, database_change',
      'resolution_type is required to close an issue. Allowed: code_change, config_change, database_change',
      `Invalid value for 'resolution_type': "because_i_said_so". Allowed values: code_change, config_change`,
      `Invalid value for 'priority': "urgent!!". Allowed values: critical, high, medium, low`,
      'One-at-a-time lane enforcement: ops is already working on TOD-224 ("pipeline-fidelity hunt fixture"). Complete or reset that issue before claiming a new one.',
      'Only main/po/ops or the workspace owner can reset an issue to backlog.',
      'Issue is closed and read-only.',
      'This issues query has no project scope. Navigate from a /p/<project> screen, or pass all_projects=1 to read across every project deliberately.',
      'window must be 7d or 30d',
    ]
    for (const s of humanRefusals) {
      expect(humaniseMoveFailure(s, 'open', 422)).toBe(s)
      expect(humaniseLoadFailure(s)).toBe(s)
    }
  })
})

describe('the READ path has the same guard as the move path', () => {
  it('replaces driver text the db proxy hands back verbatim', () => {
    // Measured 2026-08-26, running server, scoped exactly as PipelineTab scopes
    // its own reads:
    //   GET /api/db/issues?project=eq.Limiglow&archived_at=is.null
    //       &select=nope_not_a_column&limit=1
    //   -> 400 {"error":"no such column: \"nope_not_a_column\" - should this be
    //           a string literal in single-quotes?","code":"42703",...}
    const raw = 'no such column: "nope_not_a_column" - should this be a string literal in single-quotes?'
    const out = humaniseLoadFailure(raw)
    expect(out).not.toBe(raw)
    expect(out).not.toMatch(/no such column|single-quotes|nope_not_a_column/i)
    expect(out).toMatch(/bug in Todero/)
  })

  it('covers the Postgres spelling of the same failure', () => {
    expect(humaniseLoadFailure('column "nope_not_a_column" does not exist')).toMatch(/bug in Todero/)
    expect(humaniseLoadFailure('relation "issues" does not exist')).toMatch(/bug in Todero/)
    expect(humaniseLoadFailure('PGRST204: column not found in schema cache')).toMatch(/bug in Todero/)
  })

  it('replaces constraint text it has no wording for, rather than passing it through', () => {
    const out = humaniseLoadFailure('CHECK constraint failed: ((frobnicator IS NULL))')
    expect(out).not.toMatch(/frobnicator|CHECK constraint/)
    expect(out).toMatch(/browser console/)
  })

  it('says something when the server says nothing', () => {
    expect(humaniseLoadFailure('')).toMatch(/did not say why/)
    expect(humaniseLoadFailure(null)).toMatch(/did not say why/)
    expect(humaniseLoadFailure(undefined)).toMatch(/did not say why/)
  })
})

/* ── the inversion: an allowlist, and the two tests that make it hold ────────
 *
 * Written 2026-08-26 after the denylist that used to live in
 * `lib/issue-moves.ts` was measured and found not to do what its own header
 * said. Twenty-three ordinary driver messages were fed to the SHIPPED
 * `humaniseMoveFailure`; sixteen came back verbatim, including
 * `connection to server at "localhost" (::1), port 5432 failed: Connection
 * refused`, which puts the database host and port on an operator's screen.
 *
 * A denylist of message shapes cannot be completed — the set of things a driver
 * can say belongs to the driver. So the rule was inverted, and an allowlist has
 * exactly two ways to be wrong. Both are pinned here:
 *
 *   TOO LOOSE — something that is not ours reaches the screen. Pinned by the
 *               adversarial battery below: every string in it must change.
 *   TOO TIGHT — one of OUR OWN sentences gets replaced by the generic one, and
 *               the operator loses a good message. Pinned by the extractor
 *               below, which reads the API's error literals out of the route
 *               SOURCE rather than out of a list somebody remembered to update.
 */
describe('the humaniser is an allowlist, and it is too loose nowhere', () => {
  /**
   * Verbatim better-sqlite3 / Postgres output. The first sixteen are the exact
   * strings that leaked through the previous denylist on 2026-08-26; the rest
   * are ordinary messages from the same two drivers. None was invented to be
   * easy: every one is a message a driver prints in normal operation.
   */
  const DRIVER_OUTPUT = [
    // ── the sixteen that leaked ──
    'value too long for type character varying(50)',
    'date/time field value out of range: "2026-13-45"',
    'deadlock detected',
    'could not serialize access due to concurrent update',
    'permission denied for table issues',
    'operator does not exist: text = integer',
    'canceling statement due to statement timeout',
    'attempt to write a readonly database',
    'too many SQL variables',
    'connection to server at "localhost" (::1), port 5432 failed: Connection refused',
    'out of memory',
    'disk I/O error',
    'server closed the connection unexpectedly',
    'invalid byte sequence for encoding "UTF8": 0x00',
    'cannot execute UPDATE in a read-only transaction',
    'index "issues_pkey" contains unexpected zero page at block 0',
    // ── shapes the old list did catch; they must still not leak ──
    'CHECK constraint failed: (NOT ((status = \'backlog\') AND (sprint IS NOT NULL)))',
    'UNIQUE constraint failed: issues.task_key',
    'NOT NULL constraint failed: issues.title',
    'FOREIGN KEY constraint failed',
    'SQLITE_CONSTRAINT_CHECK: CHECK constraint failed',
    'no such column: test_status',
    'no such table: issues_v2',
    'null value in column "title" of relation "issues" violates not-null constraint',
    'duplicate key value violates unique constraint "issues_task_key_key"',
    'new row for relation "issues" violates check constraint "backlog_no_sprint"',
    'invalid input syntax for type integer: "lots"',
    'column "test_status" of relation "issues" does not exist',
    'relation "nope_not_a_table" does not exist',
    'syntax error at or near "SELCT"',
    'PGRST204: Could not find the \'test_status\' column of \'issues\' in the schema cache',
    // ── more of the same drivers, none of which the old list named ──
    'database or disk is full',
    'no more rows available',
    'unrecognized configuration parameter "statement_tomeout"',
    'terminating connection due to administrator command',
    'sorry, too many clients already',
    'remaining connection slots are reserved for non-replication superuser connections',
    'SSL SYSCALL error: EOF detected',
    'prepared statement "s1" already exists',
    'current transaction is aborted, commands ignored until end of transaction block',
    'malformed database schema (issues) - near "AUTOINCREMENT": syntax error',
    'file is not a database',
    'unable to open database file',
    'cannot start a transaction within a transaction',
    'table issues has no column named test_status',
    'integer out of range',
    'division by zero',
    'stack depth limit exceeded',
    'invalid page in block 3 of relation base/16384/16401',
  ]

  /**
   * Vocabulary that only ever appears in database output. If any of it survives
   * to the returned sentence, something leaked — regardless of what else the
   * sentence says.
   *
   * `does not exist` is deliberately absent: `parent_id 42 does not exist` is
   * the MC API's own English and is allowlisted. The schema-shaped spellings of
   * the same idea are covered by the identifier and quoting checks instead.
   */
  const SCHEMA_VOCABULARY = [
    /\bSQLITE_/i, /\bPGRST\d/i, /\bconstraint\b/i, /\bno such (?:column|table)\b/i,
    /\brelation\b/i, /\bnull value in column\b/i, /\binvalid input syntax\b/i,
    /\bsyntax error\b/i, /\bschema cache\b/i, /\bcharacter varying\b/i,
    /\bport \d{2,5}\b/i, /\blocalhost\b/i, /::1/, /\bpg_/i, /\bsuperuser\b/i,
    /\btransaction block\b/i, /\bSELECT\b/, /\bUPDATE\b/, /\bINSERT\b/,
  ]

  it.each(DRIVER_OUTPUT)('replaces %s on the move path', raw => {
    const out = humaniseMoveFailure(raw, 'code_review', 500)
    expect(out).not.toBe(raw)
    for (const v of SCHEMA_VOCABULARY) expect(out).not.toMatch(v)
  })

  it.each(DRIVER_OUTPUT)('replaces %s on the read path', raw => {
    const out = humaniseLoadFailure(raw)
    expect(out).not.toBe(raw)
    for (const v of SCHEMA_VOCABULARY) expect(out).not.toMatch(v)
  })

  it('never echoes a column, table or host identifier back to the operator', () => {
    // The specific harm: the previous list let the DB host and port through.
    const out = humaniseMoveFailure(
      'connection to server at "localhost" (::1), port 5432 failed: Connection refused',
      'open', 500,
    )
    expect(out).not.toMatch(/localhost|5432|::1/)
    expect(out).toMatch(/could not reach its database/i)
  })

  it('replaces a message no driver has printed yet — the whole point of an allowlist', () => {
    // Not a real message. A denylist can only be right about messages somebody
    // has already seen; this is the case that separates the two designs.
    const invented = 'ERROR:  frobnicator index wedged on shard 7 (SQLSTATE XX000)'
    expect(humaniseMoveFailure(invented, 'open', 500)).not.toBe(invented)
    expect(humaniseLoadFailure(invented)).not.toBe(invented)
  })

  it('replaces the machine tokens the API sends in `error`, rather than printing them', () => {
    // `lib/fetch-json.ts` reads `body?.error ?? body?.message`, so for these two
    // routes the TOKEN is what reaches ApiError.message and therefore the
    // banner — the human sentence in the body's `message` field never gets
    // there. Measured by reading that precedence, not assumed.
    for (const token of ['unscoped_issues_read', 'project_outside_scope']) {
      const moved = humaniseMoveFailure(token, 'open', 400)
      const loaded = humaniseLoadFailure(token)
      expect(moved).not.toBe(token)
      expect(loaded).not.toBe(token)
      expect(moved).toMatch(/project/i)
      expect(loaded).toMatch(/project/i)
      // and not the generic database sentence — a scope refusal is not a
      // database failure and must not read like one
      expect(moved).not.toMatch(/database/i)
    }
  })
})

/* ── too tight: the allowlist is derived from the API, not from memory ───────
 *
 * The cost of inverting the rule is that a NEW refusal added to a route and not
 * added to `MC_API_MESSAGES` would be replaced by the generic sentence, and the
 * operator would lose a good message. This test is the mechanism that makes
 * that a red build instead of a quiet regression: it reads the route SOURCE and
 * asserts every message literal in it survives the humaniser unchanged.
 */
describe('every sentence the MC API writes survives the humaniser unchanged', () => {
  /** The routes whose refusals can reach a Pipeline banner or the move sheet. */
  const ROUTE_FILES = [
    'app/api/issues/route.ts',
    'app/api/db/[...path]/route.ts',
    'middleware.ts',
    'app/api/agents/route.ts',
    'app/api/pipeline-metrics/route.ts',
  ]

  /**
   * Pull out every `error:` string literal, template literals included, with
   * `${…}` substituted by a stand-in value.
   *
   * `error:` and NOT `message:`, for a measured reason: `lib/fetch-json.ts`
   * reads `body?.error ?? body?.message ?? …`, so when a body carries both, the
   * `error` value is what lands in `ApiError.message` and therefore in the
   * banner — the `message` companion never reaches a screen. Scanning both was
   * tried first and pulled in a Discord notification body
   * (`app/api/issues/route.ts:785`), which is not operator-facing text at all.
   *
   * A hand-written scanner rather than a regex because the template literals
   * interpolate expressions that themselves contain quotes and backticks —
   * `${missing.join(', ')}`, `${VALID_RESOLUTION_TYPES.join(', ')}` — which a
   * regex cannot bracket correctly.
   */
  function messageLiterals(src: string): string[] {
    const out: string[] = []
    const key = /\berror\s*:\s*(['"`])/g
    let m: RegExpExecArray | null
    while ((m = key.exec(src)) !== null) {
      const quote = m[1]
      let i = m.index + m[0].length
      let text = ''
      let ok = false
      while (i < src.length) {
        const ch = src[i]
        if (ch === '\\') { text += src[i + 1] ?? ''; i += 2; continue }
        if (ch === quote) { ok = true; i++; break }
        if (quote === '`' && ch === '$' && src[i + 1] === '{') {
          // Skip the interpolation, balancing braces, and stand in for it.
          let depth = 1
          i += 2
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            i++
          }
          text += 'X'
          continue
        }
        if (quote !== '`' && ch === '\n') break // not a literal; bail
        text += ch
        i++
      }
      if (ok) out.push(text.replace(/\s+/g, ' ').trim())
      key.lastIndex = i
    }
    return out
  }

  /**
   * Literals that are NOT operator-facing text. Each is named individually —
   * a category-shaped exclusion would let a real sentence hide behind it.
   */
  const NOT_A_MESSAGE = new Set([
    '', 'X', 'error', 'message',
  ])

  /**
   * The two machine tokens. They are not English, so they are the one thing the
   * humaniser is REQUIRED to replace rather than pass through — see the
   * matching assertion in the block above.
   */
  const TOKENS = new Set(['unscoped_issues_read', 'project_outside_scope'])

  const literals = ROUTE_FILES.flatMap(rel => {
    const abs = path.join(__dirname, '..', '..', rel)
    if (!fs.existsSync(abs)) return []
    return messageLiterals(fs.readFileSync(abs, 'utf8'))
  }).filter(s => !NOT_A_MESSAGE.has(s))

  it('found the routes and read real literals out of them', () => {
    // Without this, a scanner that silently matched nothing would make every
    // assertion below pass vacuously — which is how the defect this whole file
    // exists for survived five sweeps.
    expect(literals.length).toBeGreaterThan(25)
    expect(literals).toContain('Issue is closed and read-only.')
    expect(literals).toContain('Only main/po/ops or the workspace owner can reset an issue to backlog.')
    expect(literals).toContain('window must be 7d or 30d')
  })

  it('passes every one of them through both humanisers unchanged', () => {
    const eaten: string[] = []
    for (const s of literals) {
      if (TOKENS.has(s)) continue
      if (humaniseMoveFailure(s, 'open', 422) !== s) eaten.push(`move: ${s}`)
      if (humaniseLoadFailure(s) !== s) eaten.push(`load: ${s}`)
    }
    // A failure here means the API grew a refusal that `MC_API_MESSAGES` does
    // not cover. The fix is to add the pattern there, NOT to relax this test:
    // the operator would otherwise see "a rule this board does not have wording
    // for yet" in place of a sentence the API already wrote for them.
    expect(eaten).toEqual([])
  })
})

/* ── safeApiError: the mutation that used to survive ─────────────────────────
 *
 * Measured 2026-08-26 on the shipped code: `safeApiError` was defined inside
 * `components/tabs/PipelineTab.tsx`, and gutting it to `return error` as its
 * first statement left the suite at 84 passed / 84 total. Every Pipeline banner
 * rendered raw driver text again and nothing failed, because the only guard was
 * a source grep for the identifier names reaching `<ApiErrorBanner>`.
 *
 * It is now an exported pure function, so it can be called. These assertions
 * fail on that mutation.
 */
describe('safeApiError replaces the message and nothing else', () => {
  const raw = {
    status: 400,
    endpoint: '/api/db/issues?project=eq.Limiglow&select=nope_not_a_column',
    message: 'no such column: "nope_not_a_column" - should this be a string literal in single-quotes?',
    code: '42703',
  }

  it('humanises a driver message', () => {
    const safe = safeApiError(raw)
    expect(safe.message).not.toBe(raw.message)
    expect(safe.message).not.toMatch(/no such column|nope_not_a_column|single-quotes/i)
    expect(safe.message).toMatch(/bug in Todero/)
  })

  it('keeps the status, the endpoint and the code — the half the banner is right about', () => {
    const safe = safeApiError(raw)
    expect(safe.status).toBe(400)
    expect(safe.endpoint).toBe(raw.endpoint)
    expect(safe.code).toBe('42703')
  })

  it('returns the SAME object when there was nothing to replace', () => {
    // Identity, not equality: the value goes into a `useMemo` result that feeds
    // a component, so a fresh object on every call would be a re-render for no
    // reason.
    const human = { status: 403, endpoint: '/api/issues', message: 'Issue is closed and read-only.' }
    expect(safeApiError(human)).toBe(human)
  })

  it('does not mutate the error it was given', () => {
    const before = { ...raw }
    safeApiError(raw)
    expect(raw).toEqual(before)
  })

  it('humanises every driver string on the banner path too', () => {
    // The banner is the surface this function exists for; assert the whole
    // battery through it, not just one example.
    for (const message of [
      'connection to server at "localhost" (::1), port 5432 failed: Connection refused',
      'permission denied for table issues',
      'deadlock detected',
      'CHECK constraint failed: (test_tier IN (\'smoke\',\'integration\',\'e2e\'))',
    ]) {
      const safe = safeApiError({ status: 500, endpoint: '/api/db/issues', message })
      expect(safe.message).not.toBe(message)
      expect(safe.message).not.toMatch(/localhost|5432|constraint|permission denied/i)
    }
  })
})
