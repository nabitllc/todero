/**
 * Agent responsibilities — who owns which area of the business, and who answers
 * when that area stalls.
 *
 *   GET    /api/agent-responsibilities?business_id=<id>
 *   POST   /api/agent-responsibilities   { business_id, area, agent_id, level, note? }
 *   DELETE /api/agent-responsibilities   { business_id, area, agent_id }
 *
 * VALIDATE ON WRITE, FAIL CLOSED — the stance app/api/hub-settings/route.ts
 * takes for its setting keys, for the same reason: this table is read back and
 * trusted, so a value that cannot be rendered must be refused when it is
 * written, not defended against by every reader.
 *
 * Four things are refused rather than stored:
 *   * an area the declared vocabulary does not contain (400, with the list)
 *   * a level outside accountable|responsible (422, with the list)
 *   * an agent id NO SOURCE DECLARES (422, with the fleet's ids and where it looked)
 *   * anything at all, when the roster itself cannot be read (503)
 *
 * The third is the one that matters most here. `todero-sme` and `infra-sme`
 * hold live queue lanes in lib/agent-queue.ts (:360, :399) and full entries in
 * app/api/agent-config/route.ts, and no AGENTS.md in this repo declares either
 * — verified 2026-08-26 by reading every AGENTS.md on this host. A queue lane
 * is not a declaration. Neither is a config default.
 *
 * What DOES count as a declaration is the same union GET /api/agents uses:
 * `loadFleetRoster()` — AGENTS.md ∪ the Brain2 vault registry ∪
 * `agent_registrations`. This route asked `loadAgentRoster()` (AGENTS.md
 * alone) until 2026-08-26, which made Roles and the Roster disagree about who
 * exists — 14 against 28 on this host — and quietly made every vault agent and
 * every self-registered one unassignable. Neither number was wrong; they were
 * answers to different questions sharing the word `fleet`. The union is the
 * one that matches what the fleet screens show.
 *
 * NOTHING CONSULTS THESE ROWS. No dispatch path reads agent_responsibilities;
 * the response says so in `consulted_by` (empty) and `not_consulted_notice`, and
 * the card renders both. This route creates a RECORD, not a CONTROL, and it
 * does not touch lib/dispatch-guard.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbErrorResponse } from '@/lib/db-http'
import { withPermission, resolveRole } from '@/lib/with-permission'
import { loadFleetRoster, fleetSearchLine } from '@/app/api/agents/fleet-roster'
import {
  AREAS,
  RESPONSIBILITY_CONSUMERS,
  NOT_CONSULTED_NOTICE,
  capabilityBacking,
  coverage,
  coveredAreaCount,
  validateAssignment,
  validateRemoval,
  type ResponsibilityRow,
  type RosterFacts,
} from '@/lib/agent-responsibilities'

// TOD-2445: scripts/generate-required-tables.mjs matches a LITERAL
// `.from('<table>')` — a constant is invisible to it. This table was therefore
// absent from required-tables.generated.ts, so /api/health reported schema-green
// on an install where migration 065 never ran and this route 500s. The same trap
// is documented twice elsewhere in this repo and was hit anyway, which is what
// makes it worth a comment rather than a rename.
//
// Kept as a constant for the call sites, and spelled literally once below so the
// generator sees it. The literal and the constant are asserted equal.
const TABLE = 'agent_responsibilities'
const _TABLE_FOR_GENERATOR = () => db().from('agent_responsibilities')
void _TABLE_FOR_GENERATOR
const COLUMNS = 'business_id,area,agent_id,level,note,assigned_by,created_at,updated_at'

/** The query, in words, for the card's `source` line. Real text, not decoration. */
function sourceLine(businessId: string): string {
  return `SELECT ${COLUMNS} FROM ${TABLE} WHERE business_id = '${businessId}' — ${AREAS.length} areas declared in lib/agent-responsibilities.ts`
}

/**
 * The fleet, reduced to the facts the validators need. Never a fallback list.
 *
 * THE UNION, not AGENTS.md alone. This asked `loadAgentRoster()` while
 * GET /api/agents unions three sources, so the two screens answered the same
 * question — who exists — with different numbers (measured on this host:
 * Roles 14, roster 28) while both used the word `fleet`. The consequence was
 * invisible: ResponsibilitiesCard builds its accountability dropdown from
 * `fleet.agents`, so every Brain2 vault agent and every self-registered one
 * COULD NOT BE MADE ACCOUNTABLE for an area, and the card gave no reason.
 *
 * `source` is `fleetSearchLine(load)`, NOT `load.rosterPath`. That is a
 * deliberate departure from the seam diff, which said `source: load.rosterPath`
 * and flagged the consequence for whoever landed it. The card renders this
 * string as "The fleet declares N agents, read from <source>" — so naming only
 * the AGENTS.md path under a three-source count would assert that AGENTS.md
 * declared all N. That is this channel's whole defect class (a value dressed as
 * a fact it is not), one rung down. `fleetSearchLine` names all three legs.
 */
async function rosterFacts(): Promise<RosterFacts> {
  const load = await loadFleetRoster()
  return {
    agentIds: load.ids,
    source: fleetSearchLine(load),
    // Each leg warns separately and any of them can fail on its own; surface
    // whichever ones did rather than letting a short fleet pass silently.
    warning:
      [load.rosterWarning, load.vaultWarning, load.registrationWarning]
        .filter((w): w is string => !!w)
        .join(' · ') || null,
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json()
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * TOD-2445: does this hub exist?
 *
 * A hub id that does not exist answered 200 with a full 14-area payload —
 * `businesses` holds exactly one row, so every other id was being told it has a
 * fleet and no owners. That is a plausible answer to a question about nothing,
 * which is the fabrication class this rebuild keeps paying for. Fail closed.
 */
async function hubExists(businessId: string): Promise<boolean> {
  const { data } = await db().from('businesses').select('id').eq('id', businessId).limit(1).maybeSingle()
  return !!data
}

async function rowsFor(businessId: string) {
  return db()
    .from(TABLE)
    .select(COLUMNS)
    .eq('business_id', businessId)
    .order('area', { ascending: true })
    .order('level', { ascending: true })
}

export const GET = withPermission(
  'agents:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const businessId = req.nextUrl.searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 })
    }
    if (!(await hubExists(businessId))) {
      return NextResponse.json({ error: 'unknown_hub', message: `no hub with id "${businessId}"` }, { status: 404 })
    }

    const fleet = await rosterFacts()

    let rows: ResponsibilityRow[]
    try {
      const { data, error } = await rowsFor(businessId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      rows = (data ?? []) as ResponsibilityRow[]
    } catch (e) {
      const configured = dbErrorResponse(e)
      if (configured) return configured
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }

    return NextResponse.json({
      business_id: businessId,
      // Real rows only. No sample, no demo. An empty array means nobody has
      // been given a responsibility yet, and the card says exactly that.
      assignments: rows.map(r => ({
        ...r,
        capability_backed: capabilityBacking(r.area, r.agent_id),
      })),
      areas: coverage(rows),
      covered_areas: coveredAreaCount(rows),
      total_areas: AREAS.length,
      fleet: { agents: fleet.agentIds, source: fleet.source, warning: fleet.warning },
      // Empty, and deliberately so — see the module comment.
      consulted_by: RESPONSIBILITY_CONSUMERS,
      not_consulted_notice: NOT_CONSULTED_NOTICE,
      source: sourceLine(businessId),
    })
  },
)

export const POST = withPermission(
  'agents:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const body = await readBody(req)
    if (!body) return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })

    const verdict = validateAssignment(body, await rosterFacts())
    if (!verdict.ok) {
      return NextResponse.json(verdict.refusal.body, { status: verdict.refusal.status })
    }
    const assignment = verdict.value

    // `assigned_by` is taken from the resolved caller, never from the body — a
    // request cannot claim someone else made the assignment.
    const assignedBy = resolveRole(req) ?? 'unknown'

    try {
      // At most one accountable agent per (business_id, area). The partial
      // unique index in migration 065 is the enforcement; this pre-check exists
      // to answer with the INCUMBENT'S NAME instead of a constraint string, and
      // the catch below still covers the race.
      if (assignment.level === 'accountable') {
        const { data: held, error: heldErr } = await db()
          .from(TABLE)
          .select('agent_id')
          .eq('business_id', assignment.business_id)
          .eq('area', assignment.area)
          .eq('level', 'accountable')
        if (heldErr) return NextResponse.json({ error: heldErr.message }, { status: 500 })
        const incumbent = (held ?? []).find((r: { agent_id: string }) => r.agent_id !== assignment.agent_id)
        if (incumbent) {
          return NextResponse.json(
            {
              error: `"${assignment.area}" already has an accountable agent`,
              accountable: incumbent.agent_id,
              hint: `Remove ${incumbent.agent_id} from "${assignment.area}" first. An area with two accountable agents has none.`,
            },
            { status: 409 },
          )
        }
      }

      const now = new Date().toISOString()
      const { error } = await db()
        .from(TABLE)
        .upsert(
          { ...assignment, assigned_by: assignedBy, created_at: now, updated_at: now },
          { onConflict: 'business_id,area,agent_id' },
        )

      if (error) {
        // The index fired despite the pre-check (concurrent writer).
        if (/unique|duplicate/i.test(error.message)) {
          return NextResponse.json(
            { error: `"${assignment.area}" already has an accountable agent`, detail: error.message },
            { status: 409 },
          )
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    } catch (e) {
      const configured = dbErrorResponse(e)
      if (configured) return configured
      const message = e instanceof Error ? e.message : String(e)
      if (/unique|constraint/i.test(message)) {
        return NextResponse.json(
          { error: `"${assignment.area}" already has an accountable agent`, detail: message },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({
      assigned: {
        ...assignment,
        assigned_by: assignedBy,
        capability_backed: capabilityBacking(assignment.area, assignment.agent_id),
      },
      consulted_by: RESPONSIBILITY_CONSUMERS,
      not_consulted_notice: NOT_CONSULTED_NOTICE,
    })
  },
)

export const DELETE = withPermission(
  'agents:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    // Accept either a JSON body or query parameters — `fetch(..., {method:'DELETE'})`
    // with a body is awkward in some clients, and curl users reach for -d.
    const body = (await readBody(req)) ?? {}
    const params = req.nextUrl.searchParams
    const verdict = validateRemoval({
      business_id: body.business_id ?? params.get('business_id') ?? undefined,
      area: body.area ?? params.get('area') ?? undefined,
      agent_id: body.agent_id ?? params.get('agent_id') ?? undefined,
    })
    if (!verdict.ok) {
      return NextResponse.json(verdict.refusal.body, { status: verdict.refusal.status })
    }
    const target = verdict.value

    try {
      // Read before delete so "there was nothing to remove" is a 404 rather
      // than a 200 that looks like success. A delete that silently matches zero
      // rows is how a caller comes to believe it removed something.
      const { data: existing, error: readErr } = await db()
        .from(TABLE)
        .select('agent_id')
        .eq('business_id', target.business_id)
        .eq('area', target.area)
        .eq('agent_id', target.agent_id)
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
      if ((existing ?? []).length === 0) {
        return NextResponse.json(
          { error: `no responsibility for agent "${target.agent_id}" in area "${target.area}"`, removed: 0 },
          { status: 404 },
        )
      }

      const { error } = await db()
        .from(TABLE)
        .delete()
        .eq('business_id', target.business_id)
        .eq('area', target.area)
        .eq('agent_id', target.agent_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } catch (e) {
      const configured = dbErrorResponse(e)
      if (configured) return configured
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
    }

    return NextResponse.json({ removed: 1, ...target })
  },
)
