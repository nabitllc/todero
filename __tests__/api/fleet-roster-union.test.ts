/**
 * app/api/agents/fleet-roster.ts — the union rule, in isolation.
 *
 * `unionFleetIds()` is the single definition of "who is in the fleet", shared
 * by GET /api/agents and (via the seam diff in
 * docs/rebuild/pieces/pieces8/fleet-liveness.md) GET /api/agent-responsibilities.
 * It is pure, so it is tested here without a filesystem, a database, or a
 * route — which means these assertions hold identically on CI and on a host
 * that has a Brain2 vault.
 *
 * The properties below are the ones the Fleet-vs-Roles count disagreement
 * turned on: render once, count contributions rather than mentions, and never
 * invent an id no source named.
 */
import { unionFleetIds, fleetSearchLine, SOURCE_PRECEDENCE, type FleetRosterLoad } from '@/app/api/agents/fleet-roster'

const EMPTY = { rosterIds: [], registrationIds: [], vaultIds: [] }

describe('unionFleetIds — precedence', () => {
  it('claims an id for the highest-precedence source that names it', () => {
    const u = unionFleetIds({
      rosterIds: ['builder'],
      registrationIds: ['builder', 'probe'],
      vaultIds: ['builder', 'probe', 'vault_only'],
    })
    expect(u.sourceById).toEqual({
      builder: 'agents-md',
      probe: 'registered',
      vault_only: 'vault',
    })
  })

  it('declares its precedence order publicly, highest first', () => {
    expect([...SOURCE_PRECEDENCE]).toEqual(['agents-md', 'registered', 'vault'])
  })

  it('emits each id exactly once even when all three sources name it', () => {
    const u = unionFleetIds({ rosterIds: ['a'], registrationIds: ['a'], vaultIds: ['a'] })
    expect(u.ids).toEqual(['a'])
    expect(u.bySource).toEqual({ 'agents-md': ['a'], registered: [], vault: [] })
  })

  it('collapses a duplicate WITHIN one source — a roster typo is not two agents', () => {
    const u = unionFleetIds({ ...EMPTY, rosterIds: ['a', 'a', 'b'] })
    expect(u.ids).toEqual(['a', 'b'])
  })

  it('emits ids in precedence order, so a consumer can zip without sorting', () => {
    const u = unionFleetIds({
      rosterIds: ['md1', 'md2'],
      registrationIds: ['reg1'],
      vaultIds: ['v1', 'v2'],
    })
    expect(u.ids).toEqual(['md1', 'md2', 'reg1', 'v1', 'v2'])
  })

  it('keeps the three bySource lists disjoint and covering', () => {
    const u = unionFleetIds({
      rosterIds: ['a', 'b'],
      registrationIds: ['b', 'c'],
      vaultIds: ['c', 'd'],
    })
    const all = [...u.bySource['agents-md'], ...u.bySource.registered, ...u.bySource.vault]
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(all)).toEqual(new Set(u.ids))
  })

  it('never invents an id no source named', () => {
    const named = new Set(['a', 'b', 'c'])
    const u = unionFleetIds({ rosterIds: ['a'], registrationIds: ['b'], vaultIds: ['c'] })
    for (const id of u.ids) expect(named.has(id)).toBe(true)
  })

  it('ignores empty-string ids rather than emitting a nameless row', () => {
    const u = unionFleetIds({ ...EMPTY, rosterIds: ['', 'a'] })
    expect(u.ids).toEqual(['a'])
  })
})

describe('unionFleetIds — rosterSource counts CONTRIBUTIONS, not mentions', () => {
  it('is "none" when nothing was found anywhere', () => {
    expect(unionFleetIds(EMPTY).rosterSource).toBe('none')
    expect(unionFleetIds(EMPTY).ids).toEqual([])
  })

  it.each(SOURCE_PRECEDENCE)('is "%s" when only that source contributed', source => {
    const key = { 'agents-md': 'rosterIds', registered: 'registrationIds', vault: 'vaultIds' }[source]
    const u = unionFleetIds({ ...EMPTY, [key]: ['only'] })
    expect(u.rosterSource).toBe(source)
  })

  it('is "both" when two sources each contributed a row', () => {
    expect(unionFleetIds({ ...EMPTY, rosterIds: ['a'], vaultIds: ['b'] }).rosterSource).toBe('both')
  })

  /**
   * The regression this whole module exists to prevent. The old inline
   * expression in app/api/agents/route.ts asked `registrations.size > 0` — a
   * source that was MENTIONED — while asking `vaultOnly.length > 0` for the
   * vault — a source that CONTRIBUTED. So a host where every registered agent
   * was also named in AGENTS.md reported 'both' with no registration-sourced
   * row anywhere on screen to justify the word.
   */
  it('is "agents-md", NOT "both", when every other source only re-named an AGENTS.md id', () => {
    const u = unionFleetIds({
      rosterIds: ['builder', 'tester'],
      registrationIds: ['builder'],
      vaultIds: ['tester'],
    })
    expect(u.bySource.registered).toEqual([])
    expect(u.bySource.vault).toEqual([])
    expect(u.rosterSource).toBe('agents-md')
  })
})

/**
 * ROUND 2. `fleetSearchLine()` is the "show your work" sentence — one line
 * naming every place the fleet was looked for, written once so Roster and
 * Roles cannot describe the same search differently.
 *
 * It shipped with `parts.join(' u ')` — a literal ASCII letter u, verified by
 * `od -c`, not U+222A — in a sentence whose entire job is showing its work. It
 * had no test and no production caller, so nothing caught it. It still has no
 * production caller (it exists for the unapplied seam diff in §4 of the piece
 * doc, and that is stated in its docstring); it now has a test.
 */
describe('fleetSearchLine — the sentence that shows its work', () => {
  const load = (over: Partial<FleetRosterLoad> = {}): FleetRosterLoad => ({
    ...unionFleetIds(EMPTY),
    rosterPath: 'C:\repo\AGENTS.md',
    rosterWarning: null,
    vaultPath: 'C:\vault\Global_Agents',
    vaultWarning: null,
    registrationWarning: null,
    ...over,
  })

  it('joins the three sources with U+222A, not the letter "u"', () => {
    const line = fleetSearchLine(load())
    expect(line).toContain(' ∪ ')
    // The regression, spelled out: a lowercase u between two spaces.
    expect(/ u /.test(line)).toBe(false)
  })

  it('names all three places, in one sentence', () => {
    const line = fleetSearchLine(load())
    expect(line).toContain('C:\repo\AGENTS.md')
    expect(line).toContain('C:\vault\Global_Agents')
    expect(line).toContain('agent_registrations')
    expect(line.split('∪')).toHaveLength(3)
  })

  it('says a source was NOT FOUND rather than silently listing two places', () => {
    const line = fleetSearchLine(load({ rosterPath: null, vaultPath: null }))
    expect(line).toContain('no AGENTS.md was found on this host')
    expect(line).toContain('no Brain2 vault registry was found on this host')
    // Still three parts: a leg that contributed nothing is still a leg that
    // was searched, and the operator is owed that.
    expect(line.split('∪')).toHaveLength(3)
  })

  it('carries the registration warning inline rather than dropping the leg', () => {
    const line = fleetSearchLine(load({ registrationWarning: 'database not configured' }))
    expect(line).toContain('agent_registrations (database not configured)')
  })
})
