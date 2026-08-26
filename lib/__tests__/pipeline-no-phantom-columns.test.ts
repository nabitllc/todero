// lib/__tests__/pipeline-no-phantom-columns.test.ts
//
// The test that would have caught `issue.test_status` on lib/pipeline.ts:27 and
// :40 — a read of a column the `issues` table does not have, which survived five
// sweeps.
//
// Why nothing caught it:
//
//  * `scripts/no-phantom-columns.mjs` does not look at plain member access. That
//    is a documented blind spot in its own header, not an oversight — the script
//    scans query/payload shapes, and `issue.test_status` is neither.
//  * The expression sat in a function with no production importer, so it was
//    unreachable, so no runtime test could reach it either.
//  * `getPipelineStage(issue: any)` — `any` means the compiler had nothing to
//    object to. A type that lies about the row shape is how a phantom survives
//    a sweep (see the tombstone in `lib/issues.ts:62`).
//
// So this test does the only thing that works on that combination: it reads the
// SOURCE of the files this lane owns, strips the comments (which discuss
// `test_status` at length, deliberately, as a tombstone), and fails on any
// remaining mention of a column name the schema does not carry.
//
// The column list is not hardcoded prose — it is derived from the two dialects'
// own baseline migrations, so adding a column to the schema automatically stops
// this test complaining about it, and removing one automatically starts.

import fs from 'node:fs'
import path from 'node:path'
import { getPipelineStage } from '@/lib/pipeline'

const ROOT = path.resolve(__dirname, '..', '..')

/** Files this lane owns and is therefore allowed to fail on. */
const OWNED = [
  'lib/pipeline.ts',
  'lib/pipeline-stages.ts',
  'lib/issue-moves.ts',
  'components/tabs/PipelineTab.tsx',
]

/**
 * Strip `//` and block comments so the tombstones — which name `test_status`
 * on purpose, so the next reader knows why it is not there — do not trip the
 * scan. Deliberately naive: it also blanks anything that looks like a comment
 * inside a string literal, which for these four files makes the scan stricter,
 * never looser.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Column names on `issues`, read out of the SQLite baseline migration. */
function issuesColumns(): Set<string> {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', 'sqlite', '000_baseline.sql'), 'utf8')
  const create = /CREATE TABLE(?: IF NOT EXISTS)?\s+issues\s*\(([\s\S]*?)\n\);/i.exec(sql)
  expect(create).not.toBeNull()
  const cols = new Set<string>()
  for (const line of create![1].split('\n')) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|BOOLEAN|REAL|NUMERIC|BLOB|UUID|TIMESTAMPTZ)\b/i.exec(line)
    if (m) cols.add(m[1])
  }
  // Later migrations add columns; pick those up too so this never goes stale.
  for (const f of fs.readdirSync(path.join(ROOT, 'migrations', 'sqlite'))) {
    const s = fs.readFileSync(path.join(ROOT, 'migrations', 'sqlite', f), 'utf8')
    for (const m of s.matchAll(/ALTER TABLE\s+issues\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) {
      cols.add(m[1])
    }
  }
  return cols
}

describe('the Pipeline never names a column the issues table does not have', () => {
  const columns = issuesColumns()

  it('reads a real schema, not a hardcoded list', () => {
    // Sanity: if the parse silently found nothing, every assertion below would
    // pass vacuously — which is exactly how the original defect survived.
    for (const real of ['status', 'tester_status', 'designer_status', 'deployer_status', 'test_tier']) {
      expect(columns.has(real)).toBe(true)
    }
    expect(columns.size).toBeGreaterThan(40)
    // The phantom itself. If this ever flips, the schema gained the column and
    // this whole test file is obsolete rather than wrong.
    expect(columns.has('test_status')).toBe(false)
  })

  /**
   * Snake_case properties in the owned files that belong to something OTHER
   * than an issues row. Every entry is named individually and justified, and
   * the list is asserted to be exactly consumed below — an entry that stops
   * being needed has to be deleted rather than left as cover for a future
   * phantom.
   *
   * This is an allowlist ON PURPOSE. It replaced a name-SHAPE filter
   * (`/_status$|^test_|_tier$|_criteria$|_notes$|_sha$|_key$|_at$/`) which was
   * measured on 2026-08-26 and found to be a `test_status` detector rather than
   * a phantom-column detector: appending
   * `export function q(i:any){return i.review_verdict==='p' || i.sprint_name==='x' || i.qa_state==='y'}`
   * to `lib/pipeline.ts` — three phantom columns, the exact defect class this
   * file exists for — left the suite at 13 passed / 13 total. None of the three
   * names matches that filter. A guard that only catches the bug you already
   * fixed is not a guard.
   */
  const NOT_ISSUE_FIELDS: Readonly<Record<string, string>> = {
    // `boardBuckets` / `laneBuckets` are Records keyed by STATUS, so `in_progress`
    // here is a status value used as an object key, not a column.
    in_progress: 'a status-keyed bucket map in PipelineTab, not a column',
    // The six keys of GET /api/pipeline-metrics. Measured 2026-08-26:
    // {"prs_merged":0,"merge_conflicts":0,"build_failures":0,
    //  "review_rejections":0,"avg_cycle_time_hours":null,"cycle_sample_size":0,
    //  "generated_at":"…"} — a computed response body, not an issues row.
    prs_merged: 'GET /api/pipeline-metrics response field',
    merge_conflicts: 'GET /api/pipeline-metrics response field',
    build_failures: 'GET /api/pipeline-metrics response field',
    review_rejections: 'GET /api/pipeline-metrics response field',
    avg_cycle_time_hours: 'GET /api/pipeline-metrics response field',
    cycle_sample_size: 'GET /api/pipeline-metrics response field',
  }

  /** Every snake_case member access in a file, minus real columns. */
  function nonColumnAccesses(rel: string): string[] {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    const found = new Set<string>()
    for (const m of src.matchAll(/\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) {
      if (!columns.has(m[1])) found.add(m[1])
    }
    return [...found]
  }

  it.each(OWNED)('%s reads no phantom column', rel => {
    // The rule, inverted from what it used to be: EVERY snake_case member
    // access must be either a real column or a named non-column. There is no
    // "does not look like a column name" escape any more — that clause was the
    // hole.
    const offenders = nonColumnAccesses(rel).filter(n => !(n in NOT_ISSUE_FIELDS))
    expect(offenders).toEqual([])
  })

  it('keeps the non-column allowlist honest — every entry is still used', () => {
    // Otherwise the list only ever grows, and a stale entry becomes permanent
    // cover for a phantom that happens to reuse the name.
    const used = new Set(OWNED.flatMap(nonColumnAccesses))
    const stale = Object.keys(NOT_ISSUE_FIELDS).filter(n => !used.has(n))
    expect(stale).toEqual([])
  })

  it('catches a phantom whose name looks nothing like the last one', () => {
    // The measured blind spot, pinned so it cannot come back. These three names
    // are what the previous filter let through. This asserts the RULE rather
    // than the source, so it holds even while the owned files contain none.
    const columnsOnly = (names: string[]) => names.filter(n => !(n in NOT_ISSUE_FIELDS) && !columns.has(n))
    expect(columnsOnly(['review_verdict', 'sprint_name', 'qa_state']))
      .toEqual(['review_verdict', 'sprint_name', 'qa_state'])
    // and it must still not fire on the seven legitimate ones
    expect(columnsOnly(Object.keys(NOT_ISSUE_FIELDS))).toEqual([])
    // nor on real columns
    expect(columnsOnly(['tester_status', 'designer_status', 'test_tier', 'updated_at'])).toEqual([])
  })

  it('specifically has no `test_status` left anywhere in the owned code', () => {
    for (const rel of OWNED) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
      expect(src).not.toMatch(/\btest_status\b/)
    }
  })
})

describe('every red banner on the Pipeline is humanised before it is rendered', () => {
  // There is no DOM in this suite — `jest.config.js` sets
  // `testEnvironment: "node"` and the repo has no @testing-library/react — so
  // this cannot assert on rendered output. It asserts on the WIRING instead,
  // which is the part that regressed silently before: `ApiErrorBanner` prints
  // `formatApiError(error)` verbatim, and three call sites in PipelineTab were
  // handing it the server's own message.
  const src = fs.readFileSync(path.join(ROOT, 'components/tabs/PipelineTab.tsx'), 'utf8')

  /** Identifiers that have been through `safeApiError()` / `humaniseLoadFailure()`. */
  const HUMANISED = new Set(['shownError', 'shownRosterError', 'err'])

  it('passes only humanised errors to ApiErrorBanner', () => {
    const props = [...src.matchAll(/<ApiErrorBanner[^>]*?\berror=\{([^}]+)\}/g)].map(m => m[1].trim())
    expect(props.length).toBeGreaterThanOrEqual(3)
    expect(props.filter(p => !HUMANISED.has(p))).toEqual([])
  })

  it('never stores a raw ApiError in the metrics strip', () => {
    // `setErr(r.error)` was the third leak: the metrics endpoint's failure went
    // straight into the banner.
    expect(src).not.toMatch(/setErr\(\s*r\.error\s*\)/)
    expect(src).toMatch(/setErr\(safe\)/)
  })

  it('keeps the raw message reachable, in the console, on every replacement', () => {
    // Replacing text without preserving it would trade one blindness for
    // another. Both humanising sites log the original.
    expect(src).toMatch(/console\.warn\('\[pipeline\] load failed, raw server message:'/)
    expect(src).toMatch(/console\.warn\('\[pipeline-metrics\] load failed, raw server message:'/)
    expect(src).toMatch(/console\.warn\('\[pipeline\] move refused, raw server message:'/)
  })
})

describe('getPipelineStage now decides on columns that exist', () => {
  // The dead model is scheduled for deletion (see the header of lib/pipeline.ts
  // and the SEAM DIFF in the piece doc). Until then it must at least be true.
  it('sends a product_review row with both reviews passed to PR Queue', () => {
    // Before the fix this branch was gated on `issue.test_status === "passed"`,
    // i.e. `undefined === "passed"`, so it was unreachable and every
    // product_review row fell through to "Testing" regardless of its reviews.
    expect(getPipelineStage({
      status: 'product_review', tester_status: 'passed', designer_status: 'passed',
    })).toBe('PR Queue')
  })

  it('makes the UX Review stage reachable at all', () => {
    // UX Review had exactly one route in, and that route was the phantom read.
    // No row that has ever existed could reach it. This is the first assertion
    // in the repo that lands a card there.
    expect(getPipelineStage(
      { status: 'product_review', tester_status: 'passed', designer_status: 'passed' },
      [{ assignee: 'designer', status: 'open' }],
    )).toBe('UX Review')
  })

  /* ── the OTHER repaired phantom read, which had no coverage at all ─────────
   *
   * `getPipelineStage` has two branches that used to read the phantom column.
   * The `product_review` one is asserted above. The FEATURE branch —
   * `children.every(c => computeDualReviewState(c).bothPassed)` — was not, and
   * mutation on 2026-08-26 proved it: replacing that predicate with `() => true`
   * (every feature with children lands in PR Queue) left the suite at 17 passed
   * / 17 total, and `() => false` did the same. Both directions are pinned now.
   *
   * Reaching the branch takes a fixture that clears the three tests above it:
   * children not all merged, none `in_progress`, none in an active review
   * status. `defined` children satisfy all three.
   */
  const reviewed = (tester: string, designer: string) =>
    ({ status: 'defined', tester_status: tester, designer_status: designer })

  it('sends a feature whose children have all passed both reviews to PR Queue', () => {
    expect(getPipelineStage(
      { status: 'defined', type: 'feature' },
      [reviewed('passed', 'passed'), reviewed('approved', 'ux_approved')],
    )).toBe('PR Queue')
  })

  it('keeps a feature with one unreviewed child in Definition', () => {
    // Kills `() => true`: one pending child is enough to hold the feature back.
    expect(getPipelineStage(
      { status: 'defined', type: 'feature' },
      [reviewed('passed', 'passed'), reviewed('passed', 'pending')],
    )).toBe('Definition')
  })

  it('keeps a feature whose child failed a review in Definition', () => {
    expect(getPipelineStage(
      { status: 'defined', type: 'feature' },
      [reviewed('failed', 'passed')],
    )).toBe('Definition')
  })

  it('still prefers the earlier child rules over the review verdict', () => {
    // The branch is last for a reason; a child actively being worked or
    // reviewed decides the column before the review columns are consulted.
    expect(getPipelineStage(
      { status: 'defined', type: 'feature' },
      [reviewed('passed', 'passed'), { status: 'in_progress', tester_status: 'passed', designer_status: 'passed' }],
    )).toBe('Building')
    expect(getPipelineStage(
      { status: 'defined', type: 'feature' },
      [reviewed('passed', 'passed'), { status: 'code_review', tester_status: 'passed', designer_status: 'passed' }],
    )).toBe('Testing')
  })

  it('keeps a product_review row without both reviews in Testing', () => {
    expect(getPipelineStage({
      status: 'product_review', tester_status: 'passed', designer_status: 'pending',
    })).toBe('Testing')
  })

  it('leaves the four assertions the legacy suite pins untouched', () => {
    // __tests__/utils/pipeline.test.ts asserts these; repeated here so the
    // orchestrator can delete that file together with the dead model without
    // losing the coverage in the meantime.
    expect(getPipelineStage({ status: 'code_review', tester_status: 'passed', designer_status: 'pending' })).toBe('Testing')
    expect(getPipelineStage({ status: 'code_review', tester_status: 'passed', designer_status: 'passed' })).toBe('PR Queue')
    expect(getPipelineStage({ status: 'code_review', tester_status: 'failed', designer_status: 'passed' })).toBe('Building')
    expect(getPipelineStage({ status: 'approved' })).toBe('PR Queue')
  })
})
