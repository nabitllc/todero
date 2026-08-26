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
    // No destination to reason from → NOT a guess about which sprint rule it
    // was. It used to fall all the way to "a rule this board does not have
    // wording for yet"; it now stops one step earlier, on the sentence that is
    // true of every CHECK in either dialect. Both halves are asserted, because
    // the load-bearing half is the negative one: whatever it says, it must not
    // pick one of the two sprint sentences at random.
    const noDestination = humaniseMoveFailure(anon('issues_check1'), 'approved', 500)
    expect(noDestination).toMatch(/the workflow does not allow/)
    expect(noDestination).not.toMatch(/sprint/i)
    expect(noDestination).not.toMatch(/issues_check|violates check constraint/)
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
   *
   * `key` is a parameter, and that is the repair this revision exists for. The
   * scanner used to hard-code `error:` followed IMMEDIATELY by a quote, which
   * meant it could only see refusals written as `{ error: 'literal' }`. Three
   * of the five route files above do not write them that way:
   *
   *   `{ error: e.message }`      — db proxy, 503 and 400 (route.ts:276, 279)
   *   `{ error: NO_KEY_ERROR() }` — agents, 503 (route.ts:928, 954)
   *
   * Those are not driver text — every one of them is a sentence written in this
   * repo, in `lib/db/*` — but the scanner could not see them, so the allowlist
   * did not cover them, so they were replaced, and this suite reported 179/179
   * while it happened. Measured 2026-08-26: FOURTEEN repo-written sentences
   * eaten on BOTH humanisers with every assertion here green. `key` being a
   * parameter is what lets the passes below reach them at their SOURCE — the
   * `throw` site — rather than at the `error:` key where the text is gone.
   */
  function messageLiterals(src: string, key: RegExp): string[] {
    const out: string[] = []
    let m: RegExpExecArray | null
    key.lastIndex = 0
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

  const read = (rel: string): string => {
    const abs = path.join(__dirname, '..', '..', rel)
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
  }

  /* ── PASS 1: quoted `error:` literals in the five route files ─────────────── */
  const routeLiterals = ROUTE_FILES
    .flatMap(rel => messageLiterals(read(rel), /\berror\s*:\s*(['"`])/g))
    .filter(s => !NOT_A_MESSAGE.has(s))

  /* ── PASS 2: the DB seam's own refusals, read at the `throw` ────────────────
   *
   * These reach the operator through `{ error: e.message }`, which carries no
   * literal for pass 1 to find. Scanned at the constructor call instead, which
   * is where the text actually is.
   *
   * The scanner reads only the FIRST literal of each `throw` — these are
   * multi-line concatenations, and the second half is usually all interpolation
   * (`${missing.join(', ')}`). That is enough and it is the right half: the
   * allowlist anchors on the START of a sentence, because the start is the part
   * a template literal cannot change.
   */
  const SEAM_FILES = [
    'lib/db/query-params.ts',
    'lib/db/errors.ts',
    'lib/db/sqlite-adapter.ts',
    'lib/db/pg-adapter.ts',
    'lib/db/supabase-env.ts',
    'lib/db.ts',
    'app/api/db/[...path]/route.ts',
  ]
  const seamLiterals = SEAM_FILES
    .flatMap(rel => messageLiterals(read(rel), /\bnew Db(?:QueryParse|Configuration)Error\s*\(\s*(['"`])/g))
    .filter(s => !NOT_A_MESSAGE.has(s))

  /* ── PASS 3: `dbStatusMessage()`, wrapped the way `app/api/agents` wraps it ──
   *
   * `NO_KEY_ERROR = () => `${dbStatusMessage()} — agent run state unavailable``
   * puts the interpolation FIRST, so the scanner's stand-in lands at position
   * zero and the scraped text is useless to a start-anchored allowlist. The
   * suffix is still read from source — never typed here — and the prefix comes
   * from calling the real function in both of its two states.
   */
  const noKeySuffix = messageLiterals(
    read('app/api/agents/route.ts'),
    /\bNO_KEY_ERROR\s*=\s*\(\s*\)\s*=>\s*(`)/g,
  )[0]

  const seamRuntime: string[] = [
    // Both spellings `dbStatusMessage()` can return, each wrapped in the
    // agents-route suffix exactly as that route wraps it.
    'database ready (provider "sqlite")',
    'database not configured (provider "sqlite"): missing TODERO_SQLITE_PATH',
  ].flatMap(s => [s, noKeySuffix ? noKeySuffix.replace(/^X/, s) : s])

  it('found the routes and read real literals out of them', () => {
    // Without this, a scanner that silently matched nothing would make every
    // assertion below pass vacuously — which is how the defect this whole file
    // exists for survived five sweeps.
    expect(routeLiterals.length).toBeGreaterThan(25)
    expect(routeLiterals).toContain('Issue is closed and read-only.')
    expect(routeLiterals).toContain('Only main/po/ops or the workspace owner can reset an issue to backlog.')
    expect(routeLiterals).toContain('window must be 7d or 30d')
  })

  it('found the DB seam refusals the `error:` scanner is structurally blind to', () => {
    // Same non-vacuity guard, for the pass that did not exist. The three named
    // sentences are the ones measured EATEN on 2026-08-26; if the scanner ever
    // stops finding them, this fails rather than going quiet.
    expect(seamLiterals.length).toBeGreaterThan(12)
    expect(seamLiterals).toContain('"or" needs at least one term.')
    expect(seamLiterals).toContain('Invalid numeric value "X".')
    expect(seamLiterals.some(s => s.startsWith('The local database file does not exist yet'))).toBe(true)
    expect(seamLiterals.some(s => s.startsWith('Database is not configured'))).toBe(true)
    // And the agents-route wrapper, read from source rather than typed.
    expect(noKeySuffix).toBe('X — agent run state unavailable')
  })

  it('passes every one of them through both humanisers unchanged', () => {
    const eaten: string[] = []
    for (const s of [...routeLiterals, ...seamLiterals, ...seamRuntime]) {
      if (TOKENS.has(s)) continue
      if (humaniseMoveFailure(s, 'open', 422) !== s) eaten.push(`move: ${s}`)
      if (humaniseLoadFailure(s) !== s) eaten.push(`load: ${s}`)
    }
    // A failure here means the API or the DB seam grew a refusal that
    // `MC_API_MESSAGES` / `DB_SEAM_MESSAGES` does not cover. The fix is to add
    // the pattern there, NOT to relax this test: the operator would otherwise
    // see "a rule this board does not have wording for yet" in place of a
    // sentence the repo already wrote for them.
    expect(eaten).toEqual([])
  })

  it('every "Only …" refusal in the routes really does contain the verb the allowlist requires', () => {
    // `MC_API_MESSAGES` matches `/^Only [^.]{0,200}\bcan\b/` rather than the
    // `/^Only\s+\S/` it used to, so that a driver message opening with "Only "
    // is not waved through on the strength of one word. That narrowing is only
    // safe if every real refusal satisfies it — asserted here against the
    // literals themselves, not against memory.
    const onlys = routeLiterals.filter(s => s.startsWith('Only '))
    expect(onlys.length).toBeGreaterThanOrEqual(10)
    for (const s of onlys) expect(humaniseMoveFailure(s, 'open', 403)).toBe(s)

    // The other half of the same narrowing: the shape that used to walk through.
    const notOurs = 'Only one row may be updated at a time (pg internal)'
    expect(humaniseMoveFailure(notOurs, 'open', 500)).not.toBe(notOurs)
    expect(humaniseLoadFailure(notOurs)).not.toBe(notOurs)
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

/* ══ THE TWO SURFACES, RENDERED ══════════════════════════════════════════════
 *
 * Everything above this line tests FUNCTIONS. On 2026-08-26 a fresh critic
 * showed that was not enough: two one-line edits inside
 * `components/tabs/PipelineTab.tsx` put raw driver text back on both operator
 * surfaces and left this lane's suites at 198 passed / 198 total.
 *
 *   line 654  `const human = humaniseMoveFailure(r.error.message, status, …)`
 *               → `const human = r.error.message`
 *             The move sheet — this channel's headline surface — renders
 *             `CHECK constraint failed: ((status NOT IN ('open',…)) OR (sprint
 *             IS NOT NULL))` again. Nothing anywhere caught it.
 *   line 799  `const safe = safeApiError(r.error)` → `const safe = r.error`
 *             The Pipeline-health banner prints driver text again. The guard
 *             that should have caught it was
 *             `expect(src).toMatch(/setErr\(safe\)/)` — a whitelist of source
 *             spellings, satisfied by rebinding the variable.
 *
 * The note in that file said a rendering test was impossible here: "this repo
 * has no @testing-library/react and `jest.config.js` sets
 * `testEnvironment: 'node'`". Only the first half is true. `react-dom/server`
 * is a dependency and `renderToStaticMarkup` runs in plain node — no DOM, no
 * jsdom, no new dependency. So the surfaces are RENDERED below and the MARKUP
 * is asserted.
 *
 * Both mutations are now impossible to express rather than merely caught: the
 * component holds no humanised string to rebind. `MoveFailureNotice` accepts
 * `{message, toStatus, status}` and humanises inside itself; `SafeErrorBanner`
 * accepts a raw `ApiError` and calls `safeApiError` inside itself.
 *
 * NOT VERIFIED HERE: whether an operator's browser actually reaches these
 * components — that is a DOM fact, and this lane has no browser. What is
 * verified is that IF either renders, no driver text is in its output.
 */
describe('the two operator surfaces, rendered', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const React = require('react')
  const { MoveFailureNotice, ApiErrorBanner } = require('@/components/tabs/PipelineTab')

  /** The exact string the critic's mutation put back on the move sheet. */
  const RAW_CHECK =
    "CHECK constraint failed: ((status NOT IN ('open', 'in_progress', 'in_review')) OR (sprint IS NOT NULL))"

  it('the move sheet renders the sentence, never the constraint', () => {
    const html = renderToStaticMarkup(
      React.createElement(MoveFailureNotice, {
        failure: { message: RAW_CHECK, toStatus: 'open', status: 500 },
      }),
    )
    expect(html).toContain('An issue being worked has to belong to a sprint')
    expect(html).not.toMatch(/CHECK constraint|NOT IN|sprint IS NOT NULL/)
  })

  it('the move sheet renders nothing at all when there is no failure', () => {
    expect(renderToStaticMarkup(React.createElement(MoveFailureNotice, { failure: null }))).toBe('')
  })

  it('the move sheet keeps a sentence the MC API wrote', () => {
    const human = 'Issue is closed and read-only.'
    const html = renderToStaticMarkup(
      React.createElement(MoveFailureNotice, { failure: { message: human, toStatus: 'open', status: 403 } }),
    )
    expect(html).toContain(human)
  })

  it('every banner on the tab renders the sentence, never the driver text', () => {
    for (const message of [
      'no such column: "nope_not_a_column" - should this be a string literal in single-quotes?',
      'connection to server at "localhost" (::1), port 5432 failed: Connection refused',
      'permission denied for table issues',
      RAW_CHECK,
    ]) {
      const html = renderToStaticMarkup(
        React.createElement(ApiErrorBanner, {
          error: { status: 500, endpoint: '/api/db/issues', message },
        }),
      )
      // The half the banner is RIGHT about survives — an operator still has to
      // be able to tell a refused request from an empty dataset.
      expect(html).toContain('/api/db/issues')
      expect(html).toContain('500')
      // The half it was wrong about does not.
      expect(html).not.toMatch(/no such column|localhost|5432|permission denied|CHECK constraint/)
    }
  })

  it('the banner still shows a sentence the DB seam wrote, in full', () => {
    // The regression this whole revision is about, at the surface: the operator
    // must still be told which command to run.
    const message =
      'The local database file does not exist yet: /data/todero.db. Run `npm run db:migrate` ' +
      '(or `npm run setup`) to create it. Point TODERO_SQLITE_PATH or TODERO_DATA_DIR somewhere ' +
      'else to use a different file.'
    const html = renderToStaticMarkup(
      React.createElement(ApiErrorBanner, { error: { status: 503, endpoint: '/api/db/issues', message } }),
    )
    expect(html).toContain('npm run db:migrate')
    expect(html).not.toMatch(/no wording for yet|bug in Todero/)
  })
})

/* ── the closed source guards ────────────────────────────────────────────────
 *
 * These are greps, and greps are what failed last time — so they are written
 * the other way round from the ones that failed. The old guard asked "is the
 * approved spelling present?", which a rename satisfies. These ask "is there
 * exactly ONE use, and is it the one inside the safe component?", which a new
 * raw use fails whether or not anyone predicted how it would be spelled.
 * Default-deny, the same rule the humaniser itself follows.
 */
describe('PipelineTab has exactly one place a message can reach a screen', () => {
  const src: string = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'tabs', 'PipelineTab.tsx'),
    'utf8',
  )
  /** Comments talk ABOUT these identifiers; only code counts. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('names the RAW banner exactly twice — the import, and one use inside the wrapper', () => {
    // `components/ApiErrorBanner.tsx` prints `formatApiError(error)` verbatim.
    // PipelineTab imports it as `RawApiErrorBanner` and defines its OWN
    // `ApiErrorBanner` that humanises first, so within that module the
    // unqualified name IS the safe one and every call site — including a future
    // one written by someone who never read the header — goes through the
    // wrapper. Reaching the raw component takes deliberately spelling
    // `RawApiErrorBanner`, which is what this counts.
    const mentions = code.match(/RawApiErrorBanner/g) ?? []
    expect(mentions).toHaveLength(2)
    expect(code).toMatch(/import RawApiErrorBanner from '@\/components\/ApiErrorBanner'/)
    expect(code).toMatch(/export function ApiErrorBanner[\s\S]{0,900}?<RawApiErrorBanner/)
    // …and no second import can quietly reintroduce the unsafe name.
    expect(code).not.toMatch(/import\s+ApiErrorBanner\s+from/)
  })

  it('calls humaniseMoveFailure exactly once, and that once is inside MoveFailureNotice', () => {
    const calls = code.match(/humaniseMoveFailure\s*\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(code).toMatch(/function MoveFailureNotice[\s\S]{0,600}?humaniseMoveFailure\s*\(/)
  })

  it('holds no humanised move message in state — the state is the RAW failure', () => {
    // The mutation `const human = r.error.message` needed a `human` binding to
    // exist. There is none, and the state type says so.
    expect(code).toMatch(/useState<MoveFailure \| null>\(null\)/)
    expect(code).toMatch(/setMoveError\(\{\s*message: r\.error\.message/)
    expect(code).not.toMatch(/setMoveError\(\s*human\s*\)/)
  })
})

/* ══ THE CORPUS NOBODY WROTE BY HAND ═════════════════════════════════════════
 *
 * Every other test in this file checks a message somebody thought of. That is
 * exactly the property this channel keeps failing on, in both directions: a
 * denylist of shapes somebody thought of let sixteen real driver strings
 * through, and an allowlist of shapes somebody thought of ate fourteen real
 * repo sentences. A list curated by imagination reports full coverage either
 * way.
 *
 * So this block does not curate. It builds BOTH dialects from the shipped
 * migrations, walks every table and every column in each, and forces the
 * drivers to speak for themselves — NOT NULL, CHECK, UNIQUE, FOREIGN KEY, type
 * coercion, generated columns, missing columns, missing tables — then feeds
 * every distinct string the drivers produced through both humanisers and the
 * banner wrapper.
 *
 * Measured 2026-08-26 on this machine: 326 distinct messages across the two
 * dialects. ZERO survived either humaniser or the banner wrapper. 26 of the 326
 * reached the generic sentence; seven new entries in `KNOWN_CONSTRAINTS` were
 * written FROM this sweep rather than from memory, and cut that 26 to ONE.
 *
 * The assertion is the leak count, not the corpus contents: a migration that
 * adds a constraint nobody here anticipated is swept automatically the next
 * time this runs. That is the only kind of test that can find the case nobody
 * thought of.
 */
describe('no driver in either dialect can put raw text on a screen', () => {
  const Database = require('better-sqlite3')
  const { PGlite } = require('@electric-sql/pglite')
  const ROOT = path.join(__dirname, '..', '..')

  /** Every distinct error string better-sqlite3 produces against the real schema. */
  function sweepSqlite(): string[] {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const dir = path.join(ROOT, 'migrations', 'sqlite')
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    const msgs = new Set<string>()
    const run = (sql: string, args: unknown[] = []) => {
      try { db.prepare(sql).run(...(args as never[])) } catch (e) { msgs.add(String((e as Error).message)) }
    }
    const tables: string[] = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all().map((r: { name: string }) => r.name)
    for (const t of tables) {
      run(`INSERT INTO "${t}" DEFAULT VALUES`)
      for (const c of db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]) {
        run(`INSERT INTO "${t}" ("${c.name}") VALUES (?)`, ['__zz__'])
        run(`INSERT INTO "${t}" ("${c.name}") VALUES (NULL)`)
        run(`UPDATE "${t}" SET "${c.name}" = NULL`)
        // The UPDATE arm is not redundant with the INSERT arm: a table whose
        // columns all have defaults takes `INSERT … DEFAULT VALUES`, and its
        // CHECKs are then only reachable by updating the row that insert left
        // behind. Dropping this line cost the sweep every Postgres CHECK
        // violation while the message count stayed above 100 — which is why the
        // non-vacuity test below names the shapes and not just a total.
        run(`UPDATE "${t}" SET "${c.name}" = ?`, ['__zz__'])
      }
    }
    // A UNIQUE violation needs a row to collide with, and the issues CHECKs need
    // a row to update — neither is reachable from the empty-table sweep.
    const seed = `INSERT INTO issues (id, task_key, title, project, type, priority, status)
                  VALUES ('zz-a','ZZ-1','probe','Limiglow','ops','low','backlog')`
    db.prepare(seed).run()
    run(seed)
    for (const sql of [
      `UPDATE issues SET status='open' WHERE id='zz-a'`,
      `UPDATE issues SET sprint='2026-01-01' WHERE id='zz-a'`,
      `UPDATE issues SET test_tier='zz' WHERE id='zz-a'`,
      `UPDATE issues SET deployer_status='zz' WHERE id='zz-a'`,
      `UPDATE issues SET resolution_type='zz' WHERE id='zz-a'`,
      `UPDATE issues SET parent_id='nope' WHERE id='zz-a'`,
      `SELECT zz_no_such_col FROM issues`,
      `SELECT * FROM zz_no_such_table`,
    ]) run(sql)
    db.close()
    return [...msgs]
  }

  /** The same sweep against a real Postgres, built from `migrations/*.sql`. */
  async function sweepPostgres(): Promise<string[]> {
    const pg = await PGlite.create()
    const dir = path.join(ROOT, 'migrations')
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
      await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    const msgs = new Set<string>()
    const q = async (sql: string, args?: unknown[]) => {
      try { await pg.query(sql, args) } catch (e) { msgs.add(String((e as Error).message)) }
    }
    // `require`d rather than imported (this file is CommonJS under ts-jest), so
    // PGlite arrives untyped and the row shapes are asserted at the boundary.
    const { rows } = (await pg.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
    )) as { rows: { tablename: string }[] }
    for (const { tablename: t } of rows) {
      await q(`INSERT INTO "${t}" DEFAULT VALUES`)
      const cols = (await pg.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [t],
      )) as { rows: { column_name: string }[] }
      for (const { column_name: c } of cols.rows) {
        await q(`INSERT INTO "${t}" ("${c}") VALUES ($1)`, ['__zz__'])
        await q(`INSERT INTO "${t}" ("${c}") VALUES (NULL)`)
        await q(`UPDATE "${t}" SET "${c}" = NULL`)
        await q(`UPDATE "${t}" SET "${c}" = $1`, ['__zz__'])
      }
    }
    const seed = `INSERT INTO issues (id, task_key, title, project, type, priority, status)
                  VALUES ('zz-a','ZZ-1','probe','Limiglow','ops','low','backlog')`
    await q(seed)
    await q(seed)
    for (const sql of [
      `UPDATE issues SET status='open' WHERE id='zz-a'`,
      `UPDATE issues SET sprint='2026-01-01' WHERE id='zz-a'`,
      `UPDATE issues SET test_tier='zz' WHERE id='zz-a'`,
      `UPDATE issues SET deployer_status='zz' WHERE id='zz-a'`,
      `UPDATE issues SET resolution_type='zz' WHERE id='zz-a'`,
      `UPDATE issues SET parent_id='nope' WHERE id='zz-a'`,
      `SELECT zz_no_such_col FROM issues`,
      `SELECT * FROM zz_no_such_table`,
      `SELECT 1/0`,
    ]) await q(sql)
    await pg.close()
    return [...msgs]
  }

  let sqlite: string[] = []
  let postgres: string[] = []
  beforeAll(async () => {
    sqlite = sweepSqlite()
    postgres = await sweepPostgres()
  }, 120_000)

  it('actually forced the drivers to speak — in both dialects', () => {
    // Non-vacuity. A sweep that silently produced nothing would make the leak
    // assertion below pass on an empty list, which is the exact way the guards
    // this file replaced managed to report full coverage while leaking.
    expect(sqlite.length).toBeGreaterThan(100)
    expect(postgres.length).toBeGreaterThan(100)
    expect(sqlite.some(m => /^CHECK constraint failed/.test(m))).toBe(true)
    expect(sqlite.some(m => /^NOT NULL constraint failed/.test(m))).toBe(true)
    expect(sqlite.some(m => /^UNIQUE constraint failed/.test(m))).toBe(true)
    expect(sqlite.some(m => /^FOREIGN KEY constraint failed/.test(m))).toBe(true)
    expect(postgres.some(m => /violates check constraint/.test(m))).toBe(true)
    expect(postgres.some(m => /null value in column/.test(m))).toBe(true)
    expect(postgres.some(m => /invalid input syntax for type/.test(m))).toBe(true)
  })

  it('replaces every single one of them, on both humanisers and the banner', () => {
    const leaked: string[] = []
    for (const [dialect, corpus] of [['sqlite', sqlite], ['postgres', postgres]] as const) {
      for (const m of corpus) {
        if (humaniseMoveFailure(m, 'open', 500) === m) leaked.push(`${dialect} move: ${m}`)
        if (humaniseLoadFailure(m) === m) leaked.push(`${dialect} load: ${m}`)
        if (safeApiError({ status: 500, endpoint: '/api/db/issues', message: m }).message === m) {
          leaked.push(`${dialect} banner: ${m}`)
        }
      }
    }
    expect(leaked).toEqual([])
  })

  it('says something SPECIFIC about all but a handful of them', () => {
    // Not a leak test — a quality one. The generic sentence is honest but tells
    // an operator nothing they can act on, so the number of corpus messages that
    // reach it is worth watching. It was 26 before the seven entries this sweep
    // produced; measured today it is exactly ONE — Postgres's `division by
    // zero`, deliberately left there. The bound is loose rather than pinned to
    // 1 on purpose: a new migration may legitimately add a constraint with no
    // sentence yet, and that should be VISIBLE in this number without being a
    // build break on the day it lands. If it ever climbs toward 20, the
    // refinement table has stopped keeping up with the schema.
    const all = [...new Set([...sqlite, ...postgres])]
    const vague = all.filter(m => /does not have wording for yet/.test(humaniseMoveFailure(m, 'open', 500)))
    expect(all.length).toBeGreaterThan(300)
    expect(vague.length).toBeLessThan(20)
  })
})

/* ── the operational sentences, pinned ───────────────────────────────────────
 *
 * A critic mutated `value too long for type` to a string that never matches and
 * every suite stayed green: the refined sentence degraded silently to the
 * generic one. The CHECK entries were pinned; none of the five operational ones
 * was. They are now, one assertion each, keyed on the driver's own documented
 * wording. Breaking any entry fails by name.
 */
describe('the operational refinements each still produce their own sentence', () => {
  const CASES: readonly (readonly [string, RegExp])[] = [
    ['value too long for type character varying(50)', /longer than the field allows/],
    ['string or blob too big', /longer than the field allows/],
    ['deadlock detected', /at the same moment/],
    ['could not serialize access due to concurrent update', /at the same moment/],
    ['database is locked', /database was busy/],
    ['canceling statement due to statement timeout', /database was busy/],
    ['permission denied for table issues', /not allowed to make this change/],
    ['cannot execute UPDATE in a read-only transaction', /not allowed to make this change/],
    ['connection to server at "localhost" (::1), port 5432 failed: Connection refused', /could not reach its database/],
    ['server closed the connection unexpectedly', /could not reach its database/],
    // The seven written from the dialect sweep above.
    ['FOREIGN KEY constraint failed', /no longer exists/],
    ['insert or update on table "issues" violates foreign key constraint "issues_parent_id_fkey"', /no longer exists/],
    ['update or delete on table "issues" violates foreign key constraint "c" on table "releases": Key (id)=(1) is still referenced from table "releases"', /still points at this issue/],
    ['UNIQUE constraint failed: workspaces.slug', /has to be unique/],
    ['duplicate key value violates unique constraint "workspaces_slug_key"', /has to be unique/],
    ['invalid input value for enum workspace_role: "__zz__"', /not one the workflow recognises/],
    ['Invalid input for boolean type', /wrong kind for the field/],
    ['malformed array literal: "__zz__"', /wrong kind for the field/],
    ['column "total_tokens" can only be updated to DEFAULT', /the database maintains itself/],
    ['table agent_run_records_fts_data may not be modified', /the database maintains itself/],
    ["CHECK constraint failed: period IN ('run', 'daily', 'monthly')", /the workflow does not allow/],
  ]

  it.each(CASES)('%s', (raw, expected) => {
    const out = humaniseMoveFailure(raw, 'open', 500)
    expect(out).toMatch(expected)
    expect(out).not.toMatch(/does not have wording for yet/)
    expect(out).not.toBe(raw)
  })

  it('the issues.task_key unique rule keeps its OWN sentence, not the general one', () => {
    // Ordering matters: the general UNIQUE entry was added after it and would
    // swallow it if the two were ever reordered.
    expect(humaniseMoveFailure('UNIQUE constraint failed: issues.task_key', 'open', 500))
      .toMatch(/Another issue already has this key/)
    expect(humaniseMoveFailure('duplicate key value violates unique constraint "issues_task_key_key"', 'open', 500))
      .toMatch(/Another issue already has this key/)
  })

  it('the named issues CHECKs keep their OWN sentences, not the catch-all', () => {
    // Same ordering hazard for the CHECK catch-all, which is deliberately last.
    expect(humaniseMoveFailure("CHECK constraint failed: (test_tier IN ('smoke','integration','e2e'))", 'open', 500))
      .toMatch(/test tier has to be one of/)
    expect(humaniseMoveFailure("CHECK constraint failed: ((status NOT IN ('open','in_progress')) OR (sprint IS NOT NULL))", 'open', 500))
      .toMatch(/has to belong to a sprint/)
  })
})

/* ── lib/pipeline.ts names no column the database does not have ──────────────
 *
 * `lib/__tests__/pipeline-no-phantom-columns.test.ts` guards this file too, but
 * a critic showed on 2026-08-26 that its check is SHAPE-gated: it inspects
 * snake_case member names only, so `i.testStatus` and `i.verdict` — two reads of
 * columns that do not exist — were invisible, while the snake_case spelling of
 * the same mutation was caught. That test is not this lane's file to change, so
 * the gap is closed here instead, from the other direction: rather than asking
 * "does this look like a column name", enumerate the columns the schema really
 * has and refuse anything else, whatever its casing.
 */
describe('lib/pipeline.ts reads only columns the issues table actually has', () => {
  const Database = require('better-sqlite3')

  /** Column names straight out of the shipped migrations, not a copied list. */
  const columns: Set<string> = (() => {
    const db = new Database(':memory:')
    const dir = path.join(__dirname, '..', '..', 'migrations', 'sqlite')
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
    }
    const names = (db.prepare('PRAGMA table_info(issues)').all() as { name: string }[]).map(r => r.name)
    db.close()
    return new Set(names)
  })()

  /**
   * Members that are legitimately NOT columns: array/string methods and the
   * fields of `computeDualReviewState`'s return value. Named individually — a
   * category-shaped exemption would let a phantom hide behind it.
   */
  const NOT_A_COLUMN = new Set([
    'length', 'some', 'every', 'map', 'filter', 'find', 'includes', 'join',
    'bothPassed', 'getTime', 'toString', 'slice', 'trim', 'has',
  ])

  it('found a real column list', () => {
    expect(columns.size).toBeGreaterThan(40)
    expect(columns.has('tester_status')).toBe(true)
    expect(columns.has('test_status')).toBe(false)
  })

  it('every member read off an issue-shaped value is a real column', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pipeline.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // The identifiers this module binds an issue or a child row to.
    const reads = [...code.matchAll(/\b(?:issue|child|row|rec|i|c)\.([A-Za-z_$][\w$]*)/g)].map(m => m[1])
    expect(reads.length).toBeGreaterThan(5)
    const phantom = [...new Set(reads)].filter(name => !columns.has(name) && !NOT_A_COLUMN.has(name))
    expect(phantom).toEqual([])
  })
})

/* ── the four bodies this dev server really returned, 2026-08-26 ─────────────
 *
 * Copied verbatim from `curl` against http://localhost:3000, signed in as the
 * owner, `Referer: /p/limiglow`, scoped exactly the way the Pipeline scopes its
 * own reads. Two of the four are sentences this repo wrote and two are driver
 * text, and they arrive on the SAME endpoint with the SAME status — 400 — which
 * is why the humaniser has to decide on the message and cannot decide on the
 * status.
 *
 * Before this revision, all four were replaced. The first two are the ones the
 * operator lost.
 */
describe('the live 400s from /api/db/issues, sorted correctly', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const React = require('react')
  const { ApiErrorBanner } = require('@/components/tabs/PipelineTab')

  const render = (message: string) =>
    renderToStaticMarkup(
      React.createElement(ApiErrorBanner, {
        error: { status: 400, endpoint: '/api/db/issues?project=eq.Limiglow', message },
      }),
    )

  /** `?limit=abc` and `?or=()` — `DbQueryParseError`, written in this repo. */
  it.each([
    'Invalid numeric value "abc".',
    '"or" needs at least one term.',
    'Unsupported filter operator "zz" on column "status".',
  ])('keeps the seam sentence: %s', message => {
    expect(humaniseLoadFailure(message)).toBe(message)
    expect(render(message)).toContain(message.replace(/"/g, '&quot;'))
  })

  /** `?select=nope_not_a_column` and `?nope_col=eq.1` — the driver's own text. */
  it.each([
    'no such column: "nope_not_a_column" - should this be a string literal in single-quotes?',
    'no such column: "nope_col" - should this be a string literal in single-quotes?',
  ])('replaces the driver text: %s', message => {
    expect(humaniseLoadFailure(message)).not.toBe(message)
    const html = render(message)
    expect(html).not.toMatch(/no such column|nope_not_a_column|nope_col|single-quotes/)
    expect(html).toMatch(/bug in Todero/)
  })

  it('an unconfigured database is not described as a refused query', () => {
    // The factually wrong replacement this revision removes. There is no
    // database to refuse anything; the server was naming the command to run.
    const message =
      'Database is not configured (provider "sqlite"). Missing environment variable: ' +
      'TODERO_SQLITE_PATH. Set it in .env.local — see .env.local.template.'
    expect(humaniseLoadFailure(message)).toBe(message)
    expect(humaniseLoadFailure(message)).not.toMatch(/refused the query/)
  })
})

/* ── humanising twice is the same as humanising once ─────────────────────────
 *
 * `components/tabs/PipelineTab.tsx` deliberately humanises a load error in a
 * `useMemo` AND again inside its `ApiErrorBanner` wrapper, so that reverting
 * either half leaves the other between the driver and the screen. That only
 * works if the second pass recognises the first pass's output — otherwise a
 * specific sentence degrades into the generic one, which is exactly the
 * over-eating failure this revision exists to end, arriving by a different
 * door.
 */
describe('the humanisers are idempotent', () => {
  const RAW = [
    'no such column: "nope" - should this be a string literal in single-quotes?',
    "CHECK constraint failed: (test_tier IN ('smoke','integration','e2e'))",
    'connection to server at "localhost" (::1), port 5432 failed: Connection refused',
    'FOREIGN KEY constraint failed',
    'deadlock detected',
    'something no rule in this file has ever seen',
    '',
  ]

  it('humaniseLoadFailure(humaniseLoadFailure(x)) === humaniseLoadFailure(x)', () => {
    for (const raw of RAW) {
      const once = humaniseLoadFailure(raw)
      expect(humaniseLoadFailure(once)).toBe(once)
    }
  })

  it('humaniseMoveFailure applied twice does not degrade the sentence', () => {
    for (const raw of RAW) {
      const once = humaniseMoveFailure(raw, 'open', 500)
      expect(humaniseMoveFailure(once, 'open', 500)).toBe(once)
    }
  })

  it('safeApiError twice returns the SAME object the second time', () => {
    for (const message of RAW) {
      const once = safeApiError({ status: 500, endpoint: '/api/db/issues', message })
      // Identity, not equality: the value feeds a component through a `useMemo`,
      // and a fresh object on the second pass would be a re-render for nothing.
      expect(safeApiError(once)).toBe(once)
    }
  })

  it('a second pass never turns a SPECIFIC sentence into the generic one', () => {
    // The failure mode stated plainly, in case the assertions above are ever
    // relaxed: the phantom-column sentence must survive being re-humanised.
    const once = humaniseLoadFailure('column "zz" does not exist')
    expect(once).toMatch(/bug in Todero/)
    expect(humaniseLoadFailure(once)).toMatch(/bug in Todero/)
    expect(humaniseLoadFailure(once)).not.toMatch(/no wording for yet/)
  })
})
