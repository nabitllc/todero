import { PROJECT_PREFIX, getProjectPrefix, normalizeProjectName } from '@/lib/constants'

describe('PROJECT_PREFIX map', () => {
  it('maps "Mission Control" to "MC"', () => {
    expect(PROJECT_PREFIX['Mission Control']).toBe('MC')
  })

  it('maps "Infrastructure" to "TOD"', () => {
    expect(PROJECT_PREFIX['Infrastructure']).toBe('TOD')
  })

  it('maps "Limiglow" to "TOD"', () => {
    expect(PROJECT_PREFIX['Limiglow']).toBe('TOD')
  })

  // no-invented-projects-sweep: these two assertions previously read
  //   expect(PROJECT_PREFIX['Vespera']).toBe('VES')
  //   expect(PROJECT_PREFIX['Kemuni']).toBe('KEM')
  // They asserted the defect. Neither project exists, and the map is the WRITE
  // path that mints keys for NEW issues, so those entries were a standing
  // invitation to create rows under a fabricated project. Inverted rather than
  // deleted: an absence nobody tests for is an absence that comes back.
  it('no longer maps the invented projects', () => {
    expect(PROJECT_PREFIX['Vespera']).toBeUndefined()
    expect(PROJECT_PREFIX['Kemuni']).toBeUndefined()
  })

  it('maps "Todero" to "TOD"', () => {
    expect(PROJECT_PREFIX['Todero']).toBe('TOD')
  })

  it('returns undefined for unknown projects (fallback happens in helper)', () => {
    expect(PROJECT_PREFIX['Unknown']).toBeUndefined()
  })
})

describe('project normalization', () => {
  it('canonicalizes Todero aliases and whitespace', () => {
    expect(normalizeProjectName(' Todero ')).toBe('Todero')
    expect(normalizeProjectName('todero')).toBe('Todero')
    expect(normalizeProjectName('TOD')).toBe('Todero')
  })

  it('canonicalizes Mission Control aliases', () => {
    expect(normalizeProjectName('mc')).toBe('Mission Control')
    expect(normalizeProjectName(' missioncontrol ')).toBe('Mission Control')
  })
})

describe('prefix generation logic', () => {
  it('returns MC for Mission Control', () => {
    expect(getProjectPrefix('Mission Control')).toBe('MC')
  })

  it('returns TOD for Infrastructure', () => {
    expect(getProjectPrefix('Infrastructure')).toBe('TOD')
  })

  it('returns TOD for Limiglow', () => {
    expect(getProjectPrefix('Limiglow')).toBe('TOD')
  })

  // no-invented-projects-sweep: previously
  //   expect(getProjectPrefix('Vespera')).toBe('VES')
  //   expect(getProjectPrefix('Kemuni')).toBe('KEM')
  // Both now take the same 'TOD' fallback as any unknown name. Historical
  // VES-*/KEM-* rows are unaffected: task_key and project are stored columns and
  // nothing reverse-maps a prefix back to a project. See the tombstone above
  // PROJECT_PREFIX in lib/constants.ts.
  it('falls back to TOD for the invented projects, like any unknown name', () => {
    expect(getProjectPrefix('Vespera')).toBe('TOD')
    expect(getProjectPrefix('Kemuni')).toBe('TOD')
  })

  it('returns TOD for Todero aliases', () => {
    expect(getProjectPrefix('Todero')).toBe('TOD')
    expect(getProjectPrefix('todero')).toBe('TOD')
    expect(getProjectPrefix(' TOD ')).toBe('TOD')
  })

  it('returns TOD for unknown projects', () => {
    expect(getProjectPrefix('SomeRandomProject')).toBe('TOD')
  })
})
