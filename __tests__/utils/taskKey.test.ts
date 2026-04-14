import { PROJECT_PREFIX, getProjectPrefix, normalizeProjectName } from '@/lib/constants'

describe('PROJECT_PREFIX map', () => {
  it('maps "Mission Control" to "MC"', () => {
    expect(PROJECT_PREFIX['Mission Control']).toBe('MC')
  })

  it('maps "Vespera" to "VES"', () => {
    expect(PROJECT_PREFIX['Vespera']).toBe('VES')
  })

  it('maps "Infrastructure" to "TOD"', () => {
    expect(PROJECT_PREFIX['Infrastructure']).toBe('TOD')
  })

  it('maps "Kemuni" to "KEM"', () => {
    expect(PROJECT_PREFIX['Kemuni']).toBe('KEM')
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

  it('returns VES for Vespera', () => {
    expect(getProjectPrefix('Vespera')).toBe('VES')
  })

  it('returns TOD for Infrastructure', () => {
    expect(getProjectPrefix('Infrastructure')).toBe('TOD')
  })

  it('returns KEM for Kemuni', () => {
    expect(getProjectPrefix('Kemuni')).toBe('KEM')
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
