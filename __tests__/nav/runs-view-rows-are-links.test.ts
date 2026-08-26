/**
 * __tests__/nav/runs-view-rows-are-links.test.ts — runs-need-urls piece.
 *
 * ── WHY THIS FILE EXISTS, AND WHY IT LOOKS LIKE THIS ─────────────────────────
 *
 * "Every row is a real <a href>" is the single property this channel is graded
 * on (Linear: any view is a link; LangSmith: every trace has a URL). Measured
 * 2026-08-26: it was completely unguarded. Replacing the row's
 * `<a href={hrefFor(...)}>` with a `<span>` — deleting the feature outright —
 * passed EVERYTHING:
 *
 *   npx tsc --noEmit                    clean
 *   the two piece suites                50 passed / 50
 *   node scripts/acceptance/run.mjs     45/45, harness 10/10
 *   bash scripts/smoke-test-layout.sh   all guards green
 *
 * and nothing under __tests__/ or scripts/ referenced
 * components/nav/RunsView.tsx at all.
 *
 * ── WHAT THIS TEST CAN AND CANNOT PROVE. READ BEFORE TRUSTING IT. ────────────
 *
 * It reads the SOURCE TEXT. It is not a render test and must not be described
 * as one. This repo cannot render a React component: jest runs
 * `testEnvironment: "node"` and `jest-environment-jsdom` is not installed
 * (verified 2026-08-26 — not present in node_modules).
 *
 * So this proves the anchor is IN THE FILE. It does not prove it paints, that
 * the href resolves, or that a middle-click opens a tab; those need a browser,
 * and the orchestrator's pass at the wave boundary is what would show them.
 * A source-text guard is a weak guard. It is strictly better than the nothing
 * that was here, because the mutation that deleted the feature is exactly the
 * mutation it catches.
 */

import fs from 'node:fs'
import path from 'node:path'

const FILE = path.join(process.cwd(), 'components', 'nav', 'RunsView.tsx')
const raw = fs.readFileSync(FILE, 'utf8')

// ── The source with COMMENTS REMOVED, which is what every assertion reads. ──
//
// Not tidiness. The first version of this file failed on its own subject
// matter: RunsView.tsx explains, in a JSX comment, that the row deliberately
// no longer carries a role attribute of "button" — and a naive text search
// found that sentence and called it a violation. This repo shipped that exact
// mistake at TOD-2410, where a secret scanner flagged its own specification.
// A guard that cannot tell code from prose ABOUT code is not a guard.
//
// Block comments (JSX comment braces included) and whole-line `//` comments
// go; nothing else is touched, so no code line can be silently rewritten out
// of the thing being asserted.
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /^\s*\/\//
const src = raw
  .replace(BLOCK_COMMENT, '')
  .split('\n')
  .filter(line => !LINE_COMMENT.test(line))
  .join('\n')

describe('components/nav/RunsView.tsx — a run row is a link, not a click handler', () => {
  // The mutation this file was written for: the anchor becomes a <span>.
  it('renders an <a> whose href comes from hrefFor', () => {
    expect(src).toMatch(/<a\s[^>]*href=\{hrefFor\(/s)
  })

  // hrefFor must build a real permalink, not '#' or a placeholder. Both
  // branches matter: an OPEN row links to the list, which is a navigation too.
  it('hrefFor returns the permalink path when closed and the list path when open', () => {
    expect(src).toMatch(/isOpen\s*\?\s*runBackdropPath\(here\)\s*:\s*runPermalinkPath\(here,\s*id\)/)
  })

  it('the close control on the fetched-by-id detail is also a real href', () => {
    expect(src).toMatch(/href=\{runBackdropPath\(/)
  })

  it('has no href of "#" anywhere — a link that goes nowhere is not a link', () => {
    expect(src).not.toMatch(/href=(["'])#\1/)
  })

  // The <tr> deliberately does NOT carry a button role plus tabIndex: two
  // focusable things for one action is worse than one, and the anchor is the
  // keyboard control. If a future edit re-adds a fake button, that is the shape
  // this piece replaced, and it should be argued rather than slipped in.
  it('does not reintroduce a fake button row alongside the anchor', () => {
    expect(src).not.toMatch(/role=(["'])button\1/)
  })

  // The URL is the only source of truth for which run is open. `openRunId` as
  // component state is the exact thing this piece removed; if it comes back,
  // the address bar and the screen can disagree again.
  it('keeps no open-run state of its own', () => {
    expect(src).not.toMatch(/setOpenRunId/)
    expect(src).toMatch(/rawRunSegment\(window\.location\.pathname\)/)
  })

  // Found by reading, 2026-08-26: comparing the RAW segment to the lower-cased
  // agent_runs.id meant an upper-cased id in the URL rendered the row OPEN
  // (openRunId normalises) while the click handler thought it was closed — so
  // the first click re-pushed the permalink instead of closing it, and the
  // control did the opposite of what its own title said.
  it('decides "is this run open" from the normalised id, not the raw segment', () => {
    expect(src).toMatch(/parseRunIdFromPath\(window\.location\.pathname\)\s*===\s*id/)
    expect(src).not.toMatch(/rawRunSegment\(window\.location\.pathname\)\s*===\s*id/)
  })
})
