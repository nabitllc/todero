/**
 * app/api/run-steps — the per-step trace behind design/Run.dc.html.
 *
 * GET  /api/run-steps?run_id=<id>  -> { run_id, steps: [...] }   (ordered by step_no)
 * POST /api/run-steps              -> 201 { step }               (append one step)
 *
 * WHY A WRITE ENDPOINT AND NOT A DIRECT INSERT
 * -------------------------------------------
 * migrations/060_run_steps.sql stores `tokens`, `duration_ms` and `cost_usd`
 * as nullable columns, and the UI's behaviour depends on the difference
 * between null and 0 — a null token count renders `—`, and design/Run.dc.html's
 * rule "the dollar column appears only when a run touches a paid provider" is
 * implemented as "some step has a non-null cost_usd". A recorder that could
 * write `0` where it meant "not measured" would silently turn that rule into a
 * lie, so the normalisation lives here, in one place, with the validator
 * (lib/run-trace.ts) shared with the reader.
 *
 * VALIDATION STANCE — copied deliberately from app/api/hub-settings/route.ts:
 * an unknown key is REFUSED with a 400 that names the known keys. It is never
 * stored and never quietly dropped. A trace is evidence; evidence that
 * absorbed a field nobody understood is evidence nobody can audit.
 *
 * Additionally: a step cannot be appended to a run that does not exist. A
 * run_id with no agent_runs row is a 404, not an orphan row that would later
 * render as a trace for a run the Runs table cannot show.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db, DB_ERROR } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import { normalizeStepRow, validateStepWrite, STEP_WRITE_KEYS } from '@/lib/run-trace'

export const dynamic = 'force-dynamic'

const SELECT_COLUMNS = 'id,run_id,step_no,tool,what,detail,tokens,duration_ms,ok,cost_usd,provider,created_at'

/** True when the failure means migration 060 has never been applied here. */
function isMissingRunSteps(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === DB_ERROR.UNDEFINED_TABLE) return true
  return /run_steps/i.test(error.message ?? '') && /(does not exist|no such table|schema cache)/i.test(error.message ?? '')
}

export const GET = withPermission(
  'agents:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const runId = req.nextUrl.searchParams.get('run_id')
    if (!runId) {
      // Deliberately not "every step of every run". A trace is scoped to one
      // run; an unscoped list would be a different (and much larger) product,
      // and answering with one would hide the caller's mistake.
      return NextResponse.json({ error: 'run_id is required' }, { status: 400 })
    }

    const { data, error } = await db()
      .from('run_steps')
      .select(SELECT_COLUMNS)
      .eq('run_id', runId)
      .order('step_no', { ascending: true })

    if (error) {
      if (isMissingRunSteps(error)) {
        return NextResponse.json(
          { error: 'run_steps has not been created on this database — run `npm run db:migrate` to apply migrations/060_run_steps.sql' },
          { status: 424 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // An empty list here is a FACT about the run (nothing wrote a step for
    // it), not a failure — the caller renders lib/run-trace.ts's
    // NO_STEPS_MESSAGE for it. A failure above already returned instead.
    const steps = (Array.isArray(data) ? data : []).map(row => normalizeStepRow(row as Record<string, unknown>))

    return NextResponse.json({ run_id: runId, steps })
  },
)

export const POST = withPermission(
  'agents:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'body must be JSON', known: STEP_WRITE_KEYS }, { status: 400 })
    }

    const verdict = validateStepWrite(body)
    if (!verdict.ok) {
      return NextResponse.json(
        verdict.status === 400 ? { error: verdict.why, known: STEP_WRITE_KEYS } : { error: verdict.why },
        { status: verdict.status },
      )
    }

    // The run must exist. Without this a typo in run_id writes a step nobody
    // can ever reach, and the trace for the real run stays silently short.
    const { data: run, error: runError } = await db()
      .from('agent_runs')
      .select('id')
      .eq('id', verdict.value.run_id)
      .limit(1)

    if (runError) {
      return NextResponse.json({ error: `could not verify run: ${runError.message}` }, { status: 500 })
    }
    if (!Array.isArray(run) || run.length === 0) {
      return NextResponse.json(
        { error: `no agent_runs row with id "${verdict.value.run_id}" — a step cannot be appended to a run that does not exist` },
        { status: 404 },
      )
    }

    const { data, error } = await db()
      .from('run_steps')
      .insert({ ...verdict.value, created_at: new Date().toISOString() })
      .select(SELECT_COLUMNS)

    if (error) {
      if (isMissingRunSteps(error)) {
        return NextResponse.json(
          { error: 'run_steps has not been created on this database — run `npm run db:migrate` to apply migrations/060_run_steps.sql' },
          { status: 424 },
        )
      }
      // (run_id, step_no) is UNIQUE — appending step 3 twice is a caller bug
      // worth a 409, not a 500 and not a second step 3 in the trace.
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json(
          { error: `step ${verdict.value.step_no} is already recorded for run ${verdict.value.run_id}` },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const row = Array.isArray(data) ? data[0] : data
    return NextResponse.json(
      { step: row ? normalizeStepRow(row as Record<string, unknown>) : verdict.value },
      { status: 201 },
    )
  },
)
