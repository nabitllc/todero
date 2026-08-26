/**
 * __tests__/nav/runs-permalink-seam.test.ts — runs-need-urls piece.
 *
 * ── THIS SUITE IS RED ON PURPOSE, AND WILL STAY RED UNTIL app/page.tsx CHANGES ─
 *
 * READ THIS BEFORE TREATING THE FAILURE AS A DEFECT. It is not a broken test.
 * It is the piece's incompleteness, moved out of prose and into the gate.
 *
 * The channel this piece is graded on is "every trace has a URL" (LangSmith)
 * and "any view is a link" (Linear). A run permalink currently survives a
 * click and the back button but NOT a reload, because app/page.tsx's
 * mount-time `replaceState` canonicalises the address to
 * `buildPath(business, destination, view, project)` — which for
 * `/p/limiglow/runs/r/<id>` is `/p/limiglow/runs`. The run id is erased from
 * the address bar milliseconds after load. Measured 2026-08-26:
 * `grep -c 'run-permalink' app/page.tsx` -> 0.
 *
 * app/page.tsx is orchestrator-owned; this piece is not permitted to edit it,
 * and did not. The previous round disclosed that in a doc paragraph and in
 * source comments, which is honest but silent — every gate stayed green while
 * the one feature the channel is measured on did not work. This file is the
 * correction: the disclosure now has teeth.
 *
 * ── WHY NO WORKAROUND EXISTS IN THE FILES THIS PIECE OWNS ────────────────────
 *
 * Checked 2026-08-26 by reading app/page.tsx, not assumed. The tempting fix is
 * for RunsView to read the run segment on mount, before the parent erases it,
 * relying on child effects running before parent effects. It cannot work:
 * app/page.tsx:921 gates EVERY destination behind `!selectedProject`, so
 * RunsView is not mounted until /api/businesses and /api/projects resolve —
 * strictly after the mount-time replaceState at app/page.tsx:452 has run. The
 * seam is the fix; nothing in components/nav/ or lib/ substitutes for it.
 *
 * ── HOW TO MAKE IT GREEN ─────────────────────────────────────────────────────
 *
 * Apply the diff in docs/rebuild/pieces/pieces8/runs-need-urls.md §5 — three
 * edits to app/page.tsx, reproduced in the failure message below. Nothing else
 * in this piece needs to change; the decision functions the seam calls are
 * already landed and mutation-tested in lib/__tests__/run-permalink.test.ts.
 */

import fs from 'node:fs'
import path from 'node:path'

const PAGE = path.join(process.cwd(), 'app', 'page.tsx')
const src = fs.readFileSync(PAGE, 'utf8')

const DIFF = [
  '',
  'app/page.tsx is missing the runs-need-urls seam. Three edits, from',
  'docs/rebuild/pieces/pieces8/runs-need-urls.md §5:',
  '',
  "  1. beside the '@/lib/issue-permalink' import:",
  "       import { rawRunSegment, runMountPath, runUrlSyncPath } from '@/lib/run-permalink'",
  '',
  '  2. the mount-time replaceState (the `else` branch of `if (k)`):',
  '       window.history.replaceState(',
  '         { biz: business, destination: d, view: v, project },',
  "         '',",
  '         runMountPath(rawRunSegment(window.location.pathname), buildPath(business, d, v, project)),',
  '       )',
  '',
  '  3. the project-scope sync — wraps the existing call, never replaces it:',
  '       const sync = runUrlSyncPath(',
  '         rawRunSegment(window.location.pathname),',
  '         issueUrlSyncPath(issueKey !== null, current, path),',
  '       )',
  '',
  'Until this lands, a run permalink does not survive a reload.',
].join('\n')

describe('the runs-need-urls seam in app/page.tsx (RED until the orchestrator applies it)', () => {
  it('imports the run permalink decision functions', () => {
    expect(src.includes('@/lib/run-permalink') || DIFF).toBe(true)
  })

  it('re-attaches the run segment in the mount-time replaceState', () => {
    expect(src.includes('runMountPath(') || DIFF).toBe(true)
  })

  it('keeps the run segment through the project-scope sync', () => {
    expect(src.includes('runUrlSyncPath(') || DIFF).toBe(true)
  })

  // Composition, not replacement: the issue permalink rule still has to decide
  // WHETHER to write. If a future edit drops issueUrlSyncPath while wiring this
  // one in, the issue permalink breaks in the same way the run one is broken
  // now — so both are asserted together, here, rather than each trusting the
  // other's piece doc.
  it('does not drop the issue permalink rule while adding the run one', () => {
    expect(src).toContain('issueUrlSyncPath(')
    expect(src).toContain('rawIssueSegment')
  })
})
