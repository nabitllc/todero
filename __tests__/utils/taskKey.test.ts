import { PROJECT_PREFIX } from '@/lib/constants'

describe('PROJECT_PREFIX map', () => {
  it('maps "Mission Control" to "MC"', () => {
    expect(PROJECT_PREFIX['Mission Control']).toBe('MC')
  })

  it('maps "Vespera" to "VES"', () => {
    expect(PROJECT_PREFIX['Vespera']).toBe('VES')
  })

  it('maps "Infrastructure" to "INF"', () => {
    expect(PROJECT_PREFIX['Infrastructure']).toBe('INF')
  })

  it('maps "Kemuni" to "KEM"', () => {
    expect(PROJECT_PREFIX['Kemuni']).toBe('KEM')
  })

  it('maps "Todero" to "TOD"', () => {
    expect(PROJECT_PREFIX['Todero']).toBe('TOD')
  })

  it('returns undefined for unknown projects (fallback to TOD in route)', () => {
    expect(PROJECT_PREFIX['Unknown']).toBeUndefined()
  })
})

describe('prefix generation logic', () => {
  function getPrefix(project: string): string {
    return PROJECT_PREFIX[project] ?? 'TOD'
  }

  it('returns MC for Mission Control', () => {
    expect(getPrefix('Mission Control')).toBe('MC')
  })

  it('returns VES for Vespera', () => {
    expect(getPrefix('Vespera')).toBe('VES')
  })

  it('returns INF for Infrastructure', () => {
    expect(getPrefix('Infrastructure')).toBe('INF')
  })

  it('returns KEM for Kemuni', () => {
    expect(getPrefix('Kemuni')).toBe('KEM')
  })

  it('returns TOD for unknown projects', () => {
    expect(getPrefix('SomeRandomProject')).toBe('TOD')
  })

  it('handles case-sensitive "todero" variant', () => {
    expect(getPrefix('todero')).toBe('TOD')
  })
})
