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

import {
  moveVerdict,
  requiredFieldsForMove,
  unmetFields,
  moveBody,
  humaniseMoveFailure,
  todaysSprint,
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
  it('blocks backlog from any other status for the signed-in owner', () => {
    // Measured: defined -> backlog as `michael` is 403
    // "Only main/po/ops can reset an issue to backlog."
    const v = moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', OWNER)
    expect(v.kind).toBe('blocked')
    if (v.kind === 'blocked') expect(v.reason).toMatch(/main, po, ops/)
  })

  it('allows backlog for an actor the API accepts', () => {
    // Measured: the same PATCH carrying transitioned_by: 'po' is 200.
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', 'po').kind).toBe('ready')
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', 'ops').kind).toBe('ready')
  })

  it('blocks backlog when nobody is signed in, the way the server does', () => {
    expect(moveVerdict(freshBacklogRow({ status: 'defined' }), 'backlog', undefined).kind).toBe('blocked')
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

  it('never attaches a sprint to a move to backlog', () => {
    // Measured: `{status:'backlog', sprint:'2026-08-26'}` is 500
    // "CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))".
    const body = moveBody(freshBacklogRow({ status: 'defined' }), 'backlog', { sprint: '2026-08-26' })
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
