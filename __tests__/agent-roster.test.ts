import fs from 'fs'
import os from 'os'
import path from 'path'
import { AGENT_META, loadAgentRoster, parseAgentsFromMd, resolveAgentIdentity } from '@/lib/agent-roster'

let tmpDir: string
const prevEnv = process.env.TODERO_AGENTS_MD
const prevAgentsMdPath = process.env.AGENTS_MD_PATH

function writeRoster(contents: string): string {
  const file = path.join(tmpDir, `AGENTS-${Math.random().toString(36).slice(2)}.md`)
  fs.writeFileSync(file, contents, 'utf-8')
  process.env.TODERO_AGENTS_MD = file
  return file
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todero-roster-'))
})

afterAll(() => {
  if (prevEnv === undefined) delete process.env.TODERO_AGENTS_MD
  else process.env.TODERO_AGENTS_MD = prevEnv
  if (prevAgentsMdPath === undefined) delete process.env.AGENTS_MD_PATH
  else process.env.AGENTS_MD_PATH = prevAgentsMdPath
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.AGENTS_MD_PATH
  delete process.env.TODERO_AGENTS_MD
})

describe('resolveAgentIdentity', () => {
  it('resolves "main (KAOS)" and "KAOS (main)" to the same canonical id', () => {
    expect(resolveAgentIdentity('main (KAOS)')).toEqual({ id: 'main', name: 'KAOS' })
    expect(resolveAgentIdentity('KAOS (main)')).toEqual({ id: 'main', name: 'KAOS' })
  })

  it('resolves a display name back to its id', () => {
    expect(resolveAgentIdentity('Ingo')).toEqual({ id: 'ops', name: 'Ingo' })
  })

  it('slugifies multi-word ids', () => {
    expect(resolveAgentIdentity('Kemuni SME').id).toBe('kemuni-sme')
  })

  it('passes unknown agents through instead of dropping them', () => {
    expect(resolveAgentIdentity('archivist')).toEqual({ id: 'archivist', name: 'Archivist' })
  })
})

describe('parseAgentsFromMd', () => {
  it('parses the four-column Todero layout', () => {
    writeRoster([
      '# Roster',
      '',
      '| Agent | Role | Model | Status |',
      '|-------|------|-------|--------|',
      '| KAOS (main) | Chief of Staff | Claude Sonnet 4.6 | Active |',
      '| Builder | Coding Agent | Claude Sonnet 4.6 | Active |',
      '',
      'trailing prose',
    ].join('\n'))

    const agents = parseAgentsFromMd()
    expect(agents).toHaveLength(2)
    expect(agents[0]).toEqual({ id: 'main', name: 'KAOS', role: 'Chief of Staff', model: 'Claude Sonnet 4.6' })
    expect(agents[1].id).toBe('builder')
  })

  it('parses the legacy three-column layout, where Notes carries the role', () => {
    writeRoster([
      '| Agent | Model | Notes |',
      '|---|---|---|',
      '| main (KAOS) | claude-sonnet-4-6 | Chief Orchestrator |',
      '| tester | claude-haiku-4-5 | QA Agent |',
    ].join('\n'))

    const agents = parseAgentsFromMd()
    expect(agents).toHaveLength(2)
    expect(agents[0]).toEqual({ id: 'main', name: 'KAOS', role: 'Chief Orchestrator', model: 'claude-sonnet-4-6' })
    expect(agents[1].role).toBe('QA Agent')
  })

  it('throws (rather than returning junk) when the file has no roster table', () => {
    writeRoster('# Just prose\n\nNo table here.\n')
    expect(() => parseAgentsFromMd()).toThrow(/Agent Roster table not found/)
  })

  it('throws when this host has no AGENTS.md anywhere', () => {
    process.env.TODERO_AGENTS_MD = path.join(tmpDir, 'definitely-absent.md')
    expect(() => parseAgentsFromMd()).toThrow(/No AGENTS\.md found on this host/)
  })

  it('reads the id column when the roster provides one', () => {
    writeRoster([
      '| Id | Agent | Role | Model | Status |',
      '|----|-------|------|-------|--------|',
      '| ops | Ingo | Infrastructure Watchdog | Claude Haiku 4.5 | Scheduled |',
      '| deployer | Deployer | Deploy Agent | Claude Haiku 4.5 | Active |',
    ].join('\n'))

    const agents = parseAgentsFromMd()
    expect(agents.map(a => a.id)).toEqual(['ops', 'deployer'])
    expect(agents[0].name).toBe('Ingo')
  })
})

describe('loadAgentRoster', () => {
  it("does NOT fall back to another file when AGENTS_MD_PATH points at nothing", () => {
    const bogus = path.join(tmpDir, 'definitely-absent.md')
    process.env.AGENTS_MD_PATH = bogus

    const roster = loadAgentRoster()
    // The repo's own AGENTS.md exists and would parse — the point is that an
    // explicit override that missed must not silently resolve to it.
    expect(roster.agents).toEqual([])
    expect(roster.path).toBeNull()
    expect(roster.warning).toContain(bogus)
  })

  it('reports an unparseable roster instead of throwing', () => {
    const file = writeRoster('# Just prose\n\nNo table here.\n')
    process.env.AGENTS_MD_PATH = file

    const roster = loadAgentRoster()
    expect(roster.agents).toEqual([])
    expect(roster.path).toBe(file)
    expect(roster.warning).toMatch(/Agent Roster table not found/)
  })

  it("reads the repo's own AGENTS.md, which declares ops and deployer", () => {
    const roster = loadAgentRoster()
    expect(roster.warning).toBeNull()
    const ids = roster.agents.map(a => a.id)
    expect(ids.length).toBeGreaterThan(4)
    expect(ids).toContain('ops')
    expect(ids).toContain('deployer')
  })
})

describe('AGENT_META', () => {
  it('is a non-empty registry usable as a standalone roster fallback', () => {
    const ids = Object.keys(AGENT_META)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(AGENT_META[id].name).toBeTruthy()
      expect(AGENT_META[id].model).toBeTruthy()
    }
  })
})
