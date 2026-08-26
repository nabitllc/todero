// ─── lib/__tests__/memory-budget.test.ts ─────────────────────────────────────
//
// memory-cards piece. `lib/memory-budget.ts` is a deliberate MIRROR of two
// server-only pieces of logic a client component cannot import:
//
//   * `lib/memory-retrieval.ts`      — CONTEXT_BUDGET_TOKENS_DEFAULT, estimateTokens
//   * `app/api/run-agent/route.ts`   — IDENTITY_CONTEXT_BUDGET_MULTIPLIER,
//                                      loadIdentityContext()'s section assembly
//                                      and whole-section budget selection
//
// A mirror is only honest while it still matches. These tests are the thing
// that breaks when it stops:
//
//   1. the constants are compared against the REAL ones (imported where the
//      module is importable, read out of the source text where it is not), so
//      a change on either side fails here rather than shipping a bar drawn
//      against a ceiling the server stopped using;
//   2. the section headers this module emits are asserted to still be present,
//      verbatim, in app/api/run-agent/route.ts;
//   3. the budget rules (raise on the first section, drop-and-continue on the
//      rest) are tested for behaviour, not for shape.

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  IDENTITY_CONTEXT_BUDGET_MULTIPLIER,
  RETRIEVAL_BUDGET_TOKENS_DEFAULT,
  composeIdentitySections,
  estimateTokens,
  headroomTokens,
  identityBudgetTokens,
  relativeTime,
  selectWithinBudget,
  summarizeSelection,
  type ContextDoc,
  type ContextMemoryFile,
} from '../memory-budget'
import { CONTEXT_BUDGET_TOKENS_DEFAULT, estimateTokens as serverEstimateTokens } from '../memory-retrieval'

const REPO_ROOT = join(__dirname, '..', '..')
const RUN_AGENT_SRC = readFileSync(join(REPO_ROOT, 'app', 'api', 'run-agent', 'route.ts'), 'utf8')

describe('the mirror still matches its originals', () => {
  it('the retrieval budget equals lib/memory-retrieval.ts CONTEXT_BUDGET_TOKENS_DEFAULT', () => {
    // Fails if either constant is edited without the other. Proven to fail by
    // temporarily setting RETRIEVAL_BUDGET_TOKENS_DEFAULT to 1_400.
    expect(RETRIEVAL_BUDGET_TOKENS_DEFAULT).toBe(CONTEXT_BUDGET_TOKENS_DEFAULT)
  })

  it('the identity multiplier equals the literal in app/api/run-agent/route.ts', () => {
    const match = RUN_AGENT_SRC.match(/const IDENTITY_CONTEXT_BUDGET_MULTIPLIER\s*=\s*(\d+)/)
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBe(IDENTITY_CONTEXT_BUDGET_MULTIPLIER)
  })

  it('the identity ceiling is derived, not typed — 6 x 1,300 = 7,800', () => {
    expect(identityBudgetTokens()).toBe(7_800)
    expect(identityBudgetTokens()).toBe(RETRIEVAL_BUDGET_TOKENS_DEFAULT * IDENTITY_CONTEXT_BUDGET_MULTIPLIER)
    expect(identityBudgetTokens(2_000)).toBe(12_000)
  })

  it('the token estimate agrees with the server implementation, multi-byte text included', () => {
    for (const sample of ['', 'a', 'hello world', 'é'.repeat(37), '日本語のテキスト', 'x'.repeat(1_000)]) {
      expect(estimateTokens(sample)).toBe(serverEstimateTokens(sample))
    }
  })

  it('every section header this module emits still exists verbatim in loadIdentityContext', () => {
    // The headers are part of the measurement: a section's token cost includes
    // its header, so a header renamed on the server silently shifts the number
    // this card renders.
    expect(RUN_AGENT_SRC).toContain('`# SOUL\\n\\n${globalSoul.content}`')
    expect(RUN_AGENT_SRC).toContain('`# ${agentId.toUpperCase()} SOUL\\n\\n${agentSoul.content}`')
    expect(RUN_AGENT_SRC).toContain('`# AGENTS HANDBOOK\\n\\n${handbook.content}`')
    expect(RUN_AGENT_SRC).toContain('`# SKILL: ${skill.slug}\\n\\n${skill.content}`')
    expect(RUN_AGENT_SRC).toContain('`# DAILY MEMORY (${m.date_key})\\n\\n${m.content}`')
  })
})

const TODAY = '2026-08-26'
const YESTERDAY = '2026-08-25'

function doc(agent_id: string, doc_type: string, slug: string, content: string): ContextDoc {
  return { agent_id, doc_type, slug, content }
}
function daily(agent_id: string, date_key: string, content: string): ContextMemoryFile {
  return { agent_id, memory_type: 'daily', date_key, content }
}

describe('composeIdentitySections mirrors loadIdentityContext row selection', () => {
  it('assembles the five kinds in the server order', () => {
    const docs = [
      doc('global', 'soul', 'soul', 'G'),
      doc('builder', 'soul', 'soul', 'B'),
      doc('global', 'agents', 'agents', 'H'),
      doc('skill', 'skill', 'shared-skill', 'S1'),
      doc('builder', 'skill', 'own-skill', 'S2'),
    ]
    const files = [daily('global', TODAY, 'D1'), daily('builder', YESTERDAY, 'D2')]
    const sections = composeIdentitySections('builder', docs, files, TODAY, YESTERDAY)
    expect(sections.map(s => s.label)).toEqual([
      '# SOUL',
      '# BUILDER SOUL',
      '# AGENTS HANDBOOK',
      '# SKILL: shared-skill',
      '# SKILL: own-skill',
      `# DAILY MEMORY (${TODAY})`,
      `# DAILY MEMORY (${YESTERDAY})`,
    ])
    expect(sections.map(s => s.kind)).toEqual(['soul', 'agent-soul', 'handbook', 'skill', 'skill', 'daily', 'daily'])
  })

  it('measures a section as header + blank line + content, in UTF-8 bytes', () => {
    // "# SOUL\n\n" is 8 bytes; 92 bytes of content -> 100 bytes -> 25 tokens.
    const sections = composeIdentitySections('builder', [doc('global', 'soul', 'soul', 'x'.repeat(92))], [], TODAY, YESTERDAY)
    expect(sections[0].tokens).toBe(25)
    expect(sections[0].tokens).toBe(serverEstimateTokens(`# SOUL\n\n${'x'.repeat(92)}`))
  })

  it('excludes another agent\'s soul, another agent\'s skill, and a global skill doc', () => {
    // The `global` skill exclusion is the server's own asymmetry (skills match
    // agent_id in (agentId, 'skill') only) — mirrored, not corrected.
    const docs = [
      doc('tester', 'soul', 'soul', 'not builders'),
      doc('tester', 'skill', 'tester-only', 'nope'),
      doc('global', 'skill', 'global-skill', 'also nope'),
    ]
    expect(composeIdentitySections('builder', docs, [], TODAY, YESTERDAY)).toEqual([])
  })

  it('takes only today/yesterday daily notes, newest first, for global or this agent', () => {
    const files = [
      daily('global', '2026-08-01', 'old'),
      daily('tester', TODAY, 'other agent'),
      daily('builder', YESTERDAY, 'Y'),
      daily('global', TODAY, 'T'),
    ]
    const sections = composeIdentitySections('builder', [], files, TODAY, YESTERDAY)
    expect(sections.map(s => s.label)).toEqual([`# DAILY MEMORY (${TODAY})`, `# DAILY MEMORY (${YESTERDAY})`])
  })

  it('produces nothing at all when there are no rows — not a placeholder section', () => {
    expect(composeIdentitySections('builder', [], [], TODAY, YESTERDAY)).toEqual([])
    expect(summarizeSelection(selectWithinBudget([], identityBudgetTokens()))).toEqual([])
  })
})

describe('selectWithinBudget mirrors the server budget discipline', () => {
  const s = (label: string, tokens: number) => ({ label, kind: 'skill' as const, tokens, source: 'test' })

  it('keeps whole sections while they fit', () => {
    const r = selectWithinBudget([s('a', 10), s('b', 20)], 100)
    expect(r.selected.map(x => x.label)).toEqual(['a', 'b'])
    expect(r.usedTokens).toBe(30)
    expect(r.dropped).toEqual([])
    expect(r.overflow).toBeNull()
    expect(headroomTokens(r)).toBe(70)
  })

  it('DROPS an oversized later section by name and CONTINUES to a smaller one behind it', () => {
    // This is the discriminating case. A `break` here — the old
    // `while (...) sections.pop()` behaviour — would silently lose 'c' too.
    const r = selectWithinBudget([s('a', 40), s('b', 90), s('c', 20)], 100)
    expect(r.selected.map(x => x.label)).toEqual(['a', 'c'])
    expect(r.dropped.map(x => x.label)).toEqual(['b'])
    expect(r.dropped[0].tokens).toBe(90) // dropped sections keep their cost, for the UI to print
    expect(r.usedTokens).toBe(60)
    expect(r.overflow).toBeNull()
  })

  it('reports overflow — never a truncated section — when the FIRST section alone exceeds the budget', () => {
    const r = selectWithinBudget([s('huge', 500), s('small', 1)], 100)
    expect(r.overflow).toEqual({ label: 'huge', tokens: 500 })
    expect(r.selected).toEqual([])
    expect(r.usedTokens).toBe(0)
    // Nothing is selected: the server would have thrown RetrievalBudgetExceededError,
    // so a card must render that, not a bar with 'small' in it.
    expect(r.dropped).toEqual([])
  })

  it('never overspends, so headroom is never negative', () => {
    const r = selectWithinBudget([s('a', 99), s('b', 99)], 100)
    expect(r.usedTokens).toBeLessThanOrEqual(100)
    expect(headroomTokens(r)).toBe(1)
  })
})

describe('summarizeSelection', () => {
  it('groups by kind in bar order and omits kinds with no rows', () => {
    const sections = composeIdentitySections(
      'builder',
      [doc('global', 'soul', 'soul', 'x'.repeat(92)), doc('skill', 'skill', 'a', 'y'.repeat(88)), doc('skill', 'skill', 'b', 'z'.repeat(88))],
      [],
      TODAY,
      YESTERDAY,
    )
    const segments = summarizeSelection(selectWithinBudget(sections, 7_800))
    expect(segments.map(x => x.kind)).toEqual(['soul', 'skill'])
    expect(segments.find(x => x.kind === 'skill')!.sections).toBe(2)
    // No agent-soul / handbook / daily segment: those rows do not exist, and a
    // zero-width legend entry would read as "exists but tiny".
    expect(segments.some(x => x.kind === 'daily')).toBe(false)
  })

  it('draws each segment against the ceiling, not against the used portion', () => {
    const seg = summarizeSelection(selectWithinBudget([{ label: '# SOUL', kind: 'soul', tokens: 780, source: 't' }], 7_800))
    expect(seg[0].percentOfBudget).toBeCloseTo(10)
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z')
  it('renders a real age', () => {
    expect(relativeTime('2026-08-26T11:59:55.000Z', now)).toBe('5s ago')
    expect(relativeTime('2026-08-26T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTime('2026-08-24T12:00:00.000Z', now)).toBe('2d ago')
  })
  it('returns "" — never a plausible age — for a missing or unparseable timestamp', () => {
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime(undefined, now)).toBe('')
    expect(relativeTime('not a date', now)).toBe('')
  })
})
