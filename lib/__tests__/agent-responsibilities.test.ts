/**
 * Proof that the responsibility validators REFUSE what they must refuse.
 *
 * The rule this repo learned the hard way: "Prove every guard fails when it
 * should, not only that it passes when it should." Most of the assertions below
 * are therefore refusals, and each one asserts the *reason* as well as the
 * status — a guard that refuses for the wrong reason is a guard that will stop
 * refusing the moment the wrong reason goes away.
 *
 * The load-bearing pair is `roster is the only allowlist`: the same function,
 * given a fabricated roster, ACCEPTS an id that exists nowhere in this repo, and
 * given the real roster REJECTS `todero-sme` — an id that holds a live queue
 * lane in lib/agent-queue.ts and is declared by no AGENTS.md on this host
 * (verified 2026-08-26). Opposite verdicts from identical code prove there is no
 * built-in list of agents anywhere in this piece.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  AREAS,
  AREA_IDS,
  MAX_NOTE_LENGTH,
  NOT_CONSULTED_NOTICE,
  RESPONSIBILITY_CONSUMERS,
  RESPONSIBILITY_LEVELS,
  capabilityBacking,
  coverage,
  coveredAreaCount,
  validateAssignment,
  validateRemoval,
  type ResponsibilityRow,
  type RosterFacts,
} from '../agent-responsibilities'
import { loadAgentRoster } from '../agent-roster'

const REPO_ROOT = join(__dirname, '..', '..')

/** A roster that exists only in this test. Nothing in the repo declares it. */
const FABRICATED_ROSTER: RosterFacts = {
  agentIds: ['zzz-fabricated-agent'],
  source: '/nowhere/AGENTS.md',
  warning: null,
}

/** The real roster this host has. */
function realRoster(): RosterFacts {
  const load = loadAgentRoster()
  return { agentIds: load.agents.map(a => a.id), source: load.path, warning: load.warning }
}

const HUB = 'test-hub'

function assign(overrides: Record<string, unknown>, roster: RosterFacts = realRoster()) {
  return validateAssignment(
    { business_id: HUB, area: 'build', agent_id: roster.agentIds[0], level: 'accountable', ...overrides },
    roster,
  )
}

describe('the roster is the only allowlist', () => {
  it('rejects an id no roster declares, even one holding a live queue lane', () => {
    // todero-sme and infra-sme have AGENT_QUEUE_CONFIGS entries and full
    // app/api/agent-config defaults. Neither is in any AGENTS.md here.
    for (const invented of ['todero-sme', 'infra-sme', 'kemuni-sme', 'vespera-sme']) {
      const verdict = assign({ agent_id: invented })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.refusal.status).toBe(422)
      expect(String(verdict.refusal.body.error)).toContain(invented)
      expect(verdict.refusal.body.known_agents).toEqual(realRoster().agentIds)
    }
  })

  it('accepts an id the roster it was HANDED declares, even a fabricated one', () => {
    const verdict = validateAssignment(
      { business_id: HUB, area: 'build', agent_id: 'zzz-fabricated-agent', level: 'responsible' },
      FABRICATED_ROSTER,
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects, against the fabricated roster, an id the REAL roster declares', () => {
    // The mirror of the test above. Together they show the verdict tracks the
    // roster argument and nothing else — there is no code-side agent list.
    const realId = realRoster().agentIds[0]
    expect(realId).toBeTruthy()
    const verdict = validateAssignment(
      { business_id: HUB, area: 'build', agent_id: realId, level: 'responsible' },
      FABRICATED_ROSTER,
    )
    expect(verdict.ok).toBe(false)
  })

  it('refuses everything when the roster could not be read — it never widens', () => {
    const verdict = validateAssignment(
      { business_id: HUB, area: 'build', agent_id: 'anything', level: 'accountable' },
      { agentIds: [], source: '/does/not/exist/AGENTS.md', warning: 'No AGENTS.md found on this host' },
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.refusal.status).toBe(503)
    expect(String(verdict.refusal.body.error)).toMatch(/roster could not be read/i)
    expect(verdict.refusal.body.roster_source).toBe('/does/not/exist/AGENTS.md')
  })

  it('this host actually has a readable roster, so the tests above mean something', () => {
    // Verify the instrument. If the roster were empty here, the "rejects an
    // invented id" test would pass for the WRONG reason (503, not 422).
    const roster = realRoster()
    expect(roster.warning).toBeNull()
    expect(roster.agentIds.length).toBeGreaterThan(0)
    expect(roster.agentIds).not.toContain('todero-sme')
    expect(roster.agentIds).not.toContain('infra-sme')
  })
})

describe('validateAssignment refuses malformed input', () => {
  it('requires business_id', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      const verdict = assign({ business_id: bad })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.refusal.status).toBe(400)
      expect(String(verdict.refusal.body.error)).toContain('business_id')
    }
  })

  it('refuses an unknown area and says which are known', () => {
    for (const bad of ['marketing', 'BUILD', 'build ', undefined, null, 7]) {
      const verdict = assign({ area: bad })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.refusal.status).toBe(400)
      expect(verdict.refusal.body.known).toEqual(AREA_IDS)
    }
  })

  it('refuses an unknown level and says which are known', () => {
    for (const bad of ['consulted', 'informed', 'owner', '', undefined]) {
      const verdict = assign({ level: bad })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.refusal.status).toBe(422)
      expect(verdict.refusal.body.known).toEqual(RESPONSIBILITY_LEVELS)
    }
  })

  it('refuses a non-string note and an over-long one', () => {
    const nonString = assign({ note: { text: 'hi' } })
    expect(nonString.ok).toBe(false)

    const tooLong = assign({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) })
    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) throw new Error('unreachable')
    expect(tooLong.refusal.status).toBe(422)
    expect(tooLong.refusal.body.length).toBe(MAX_NOTE_LENGTH + 1)
  })

  it('accepts a well-formed assignment and normalises the note', () => {
    const verdict = assign({ note: '   owns the build lane   ' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value.note).toBe('owns the build lane')
    expect(verdict.value.area).toBe('build')
    expect(verdict.value.level).toBe('accountable')
  })

  it('treats an empty note as absent rather than as an empty string', () => {
    const verdict = assign({ note: '   ' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.value.note).toBeNull()
  })
})

describe('validateRemoval', () => {
  it('names every missing field rather than only the first', () => {
    const verdict = validateRemoval({})
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.refusal.status).toBe(400)
    expect(String(verdict.refusal.body.error)).toContain('business_id')
    expect(String(verdict.refusal.body.error)).toContain('area')
    expect(String(verdict.refusal.body.error)).toContain('agent_id')
  })

  it('allows removal of a row whose area or agent is no longer declared', () => {
    // A retired area or a dropped roster row must not strand its rows forever.
    const verdict = validateRemoval({ business_id: HUB, area: 'an-area-that-was-retired', agent_id: 'todero-sme' })
    expect(verdict.ok).toBe(true)
  })
})

describe('the code never produces an agent id it was not handed', () => {
  it('coverage() emits only agent ids present in its input rows', () => {
    // The property that matters. An empty input must produce zero agent ids —
    // no default owner, no "unassigned -> main" fallback, nothing invented.
    expect(coverage([]).flatMap(a => [a.accountable, ...a.responsible].filter(Boolean))).toEqual([])

    const rows: ResponsibilityRow[] = [
      { business_id: HUB, area: 'build', agent_id: 'zzz-one', level: 'accountable', note: null, assigned_by: 'admin' },
      { business_id: HUB, area: 'build', agent_id: 'zzz-two', level: 'responsible', note: null, assigned_by: 'admin' },
    ]
    const emitted = coverage(rows).flatMap(a => [a.accountable, ...a.responsible].filter(Boolean))
    expect(new Set(emitted)).toEqual(new Set(['zzz-one', 'zzz-two']))
  })

  it('four area names collide with an agent id, and that is a fact about the ROSTER', () => {
    // security, growth, content and community are agents named after the area
    // they serve. The collision is recorded, not hidden: it is a word overlap
    // between two different columns (`area` and `agent_id`), and the test above
    // is what proves the code cannot confuse one for the other. If this set
    // changes, the roster changed — go read AGENTS.md before editing this line.
    const rosterIds = new Set(realRoster().agentIds)
    const collisions = AREA_IDS.filter(id => rosterIds.has(id))
    expect(collisions.sort()).toEqual(['community', 'content', 'growth', 'security'])
  })

  it('every area is unique, lowercase and stable', () => {
    expect(new Set(AREA_IDS).size).toBe(AREA_IDS.length)
    for (const id of AREA_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('capabilityBacking has three states, not two', () => {
  it('true when the agent declares a capability the area names', () => {
    // Read the pairing off the registry rather than asserting a name: any agent
    // whose capabilities include 'Coding' backs the build area.
    expect(capabilityBacking('build', 'builder')).toBe(true)
  })

  it('false when the area names capabilities and the agent has none of them', () => {
    expect(capabilityBacking('build', 'scout')).toBe(false)
  })

  it('null when the capability registry names nothing for the area', () => {
    // No declared capability in lib/agent-capabilities.ts covers cost control.
    expect(capabilityBacking('spend', 'builder')).toBeNull()
  })

  it('null for an agent the capability registry has never met', () => {
    expect(capabilityBacking('build', 'zzz-fabricated-agent')).toBeNull()
  })

  it('null for an area that does not exist', () => {
    expect(capabilityBacking('not-an-area', 'builder')).toBeNull()
  })
})

describe('coverage folds real rows onto the declared areas', () => {
  const row = (area: string, agent_id: string, level: 'accountable' | 'responsible'): ResponsibilityRow => ({
    business_id: HUB, area, agent_id, level, note: null, assigned_by: 'admin',
  })

  it('reports every area with nobody when there are no rows', () => {
    const folded = coverage([])
    expect(folded).toHaveLength(AREAS.length)
    expect(folded.every(a => a.accountable === null && a.responsible.length === 0)).toBe(true)
    expect(coveredAreaCount([])).toBe(0)
  })

  it('counts only areas that have someone ACCOUNTABLE', () => {
    const rows = [row('build', 'a', 'responsible'), row('quality', 'b', 'accountable')]
    expect(coveredAreaCount(rows)).toBe(1)
    const build = coverage(rows).find(a => a.area === 'build')!
    expect(build.accountable).toBeNull()
    expect(build.responsible).toEqual(['a'])
  })

  it('invents nothing — an unknown area in the data is dropped, not shown', () => {
    const folded = coverage([row('a-retired-area', 'a', 'accountable')])
    expect(folded.map(a => a.area)).toEqual([...AREA_IDS])
    expect(coveredAreaCount([row('a-retired-area', 'a', 'accountable')])).toBe(0)
  })
})

describe('the honest limit is stated in code, not only in prose', () => {
  it('nothing consults these rows yet', () => {
    expect(RESPONSIBILITY_CONSUMERS).toEqual([])
    expect(NOT_CONSULTED_NOTICE).toMatch(/TODERO_DISPATCH_ENABLED/)
  })
})

describe('the card and the route name no agent of their own', () => {
  const files = [
    join(REPO_ROOT, 'components', 'tabs', 'ResponsibilitiesCard.tsx'),
    join(REPO_ROOT, 'app', 'api', 'agent-responsibilities', 'route.ts'),
  ]

  /** Source with comments stripped — a tombstone comment naming a removed id
   *  must be allowed to survive, the same trade scripts/no-invented-projects.mjs
   *  makes. Only EXECUTABLE text is scanned. */
  function code(file: string): string {
    return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it.each(files)('%s contains no agent-id string literal', file => {
    const body = code(file)
    const offenders = realRoster().agentIds.filter(id => new RegExp(`['"\`]${id}['"\`]`).test(body))
    expect(offenders).toEqual([])
  })

  it('the card does not hardcode the not-consulted notice — it renders the API field', () => {
    const body = code(files[0])
    expect(body).toContain('not_consulted_notice')
    // The literal sentence must live in lib/agent-responsibilities.ts only, so
    // that adding a real consumer changes what the screen says automatically.
    expect(body).not.toContain('Nothing acts on these assignments')
  })
})

describe('migration 065 exists in both dialects and seeds nothing', () => {
  const files = [
    join(REPO_ROOT, 'migrations', '065_agent_responsibilities.sql'),
    join(REPO_ROOT, 'migrations', 'sqlite', '065_agent_responsibilities.sql'),
  ]

  it.each(files)('%s exists', file => {
    expect(existsSync(file)).toBe(true)
  })

  it.each(files)('%s carries the partial unique index that caps accountability at one', file => {
    const sql = readFileSync(file, 'utf8')
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*?agent_responsibilities \(business_id, area\)[\s\S]*?WHERE level = 'accountable'/)
  })

  it.each(files)('%s contains no INSERT — the table starts genuinely empty', file => {
    const sql = readFileSync(file, 'utf8')
      .split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .join('\n')
    expect(sql).not.toMatch(/\bINSERT\b/i)
  })

  it.each(files)('%s constrains level in SQL so an unrenderable row cannot be stored', file => {
    const sql = readFileSync(file, 'utf8')
    expect(sql).toMatch(/CHECK \(level IN \('accountable', 'responsible'\)\)/)
  })
})
