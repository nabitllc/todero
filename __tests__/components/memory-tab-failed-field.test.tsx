/**
 * @jest-environment jsdom
 *
 * MemoryTab's FAILED field, rendered.
 *
 * WHY THIS FILE EXISTS (TOD-2486). Three assertions in this repo were found in
 * one day that could not tell a fix from its defect, and every one was a source
 * grep:
 *
 *   1. a leak test named "never returns the agent transcript or the server log
 *      path" passed while the endpoint returned both, because it asserted on a
 *      stub whose row never contained those keys;
 *   2. a seam suite reported 4 passed / 4 total with its defect COMPLETELY
 *      restored, because `src.includes(<one exact string>)` goes green the
 *      moment the string appears anywhere;
 *   3. THIS one — the MemoryTab seam stayed RED after being correctly applied,
 *      because its regex matched the corrected component too, so the only way to
 *      satisfy it was to make the component worse.
 *
 * The reason all three were greps was that nothing in this repo could render a
 * component: `jest-environment-jsdom` was not installed and there was no
 * `@testing-library`. That was recorded as "the single highest-leverage gap"
 * and deliberately not fixed while other agents were writing to package.json.
 * They are installed now, and this is the proof it works.
 *
 * The default environment stays `node`. Component tests opt in with the
 * docblock above, so nothing that already runs changes.
 *
 * THE PROPERTY, stated once: a run that FAILED must read as failed. The boolean
 * column is the fact. `rejection_reason` is separate human text that is absent
 * on most rows, and rendering the failure FROM it means a row with
 * `{failed: true, exit_status: 9, rejection_reason: null}` printed
 * "FAILED — rejection_reason is null", which a reader scans as NOT failed.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MemoryTab from '@/components/tabs/MemoryTab'

// The tab pulls three endpoints through useApiData. None of them is the subject
// here, so they are stubbed at the hook — the RECORDS query is the one that
// carries the rows under test.
jest.mock('@/hooks/useApiData', () => ({
  useApiData: (key: string) => {
    if (typeof key === 'string' && key.includes('agent-run-records')) {
      return {
        data: {
          records: [
            {
              id: 'r-failed-no-reason',
              task_key: 'TOD-9001',
              attempted: 'runtime=claude-code exit=9',
              rejection_reason: null,
              reviewer_notes: null,
              rejection_count: 0,
              succeeded: false,
              failed: true,
              exit_status: 9,
              status: 'open',
              created_at: '2026-08-26T12:00:00Z',
            },
            {
              id: 'r-clean',
              task_key: 'TOD-9002',
              attempted: 'runtime=claude-code exit=0',
              rejection_reason: null,
              reviewer_notes: null,
              rejection_count: 0,
              succeeded: true,
              failed: false,
              exit_status: 0,
              status: 'completed',
              created_at: '2026-08-26T12:05:00Z',
            },
          ],
        },
        error: null,
        loading: false,
        refetch: () => {},
      }
    }
    return { data: null, error: null, loading: false, refetch: () => {} }
  },
  readApiError: () => null,
}))

jest.mock('@/lib/db/browser', () => ({ dbUrl: (s: string) => `/api/db/${s}` }))

function renderTab() {
  return render(
    <MemoryTab memFiles={[]} error={null} onRetry={() => {}} openMem={null} setOpenMem={() => {}} />,
  )
}

describe('MemoryTab — a failed run reads as failed (rendered, not grepped)', () => {
  it('shows FAILED for a run with failed=true even when rejection_reason is null', () => {
    renderTab()
    // The row exists at all.
    expect(screen.getAllByText(/TOD-9001/).length).toBeGreaterThan(0)
    // And it is labelled as a failure. This is the assertion a regex over the
    // source could not make: the label has to be ON SCREEN for this row.
    expect(screen.getAllByText(/FAILED/).length).toBeGreaterThan(0)
  })

  it('names the OS fact when there is no human reason — not "rejection_reason is null"', () => {
    renderTab()
    const body = document.body.textContent ?? ''
    // exit_status 9 is the one hard fact this channel captures. Before the fix
    // it never reached a human.
    expect(body).toMatch(/exit_status/)
    expect(body).toMatch(/9/)
    // The old wording scanned as "not failed" and must not come back.
    expect(body).not.toMatch(/FAILED\s*rejection_reason is null/)
  })

  it('does NOT label the clean run as failed — the control against labelling everything', () => {
    renderTab()
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/TOD-9002/)
    // Exactly one row failed. If a change starts rendering FAILED for every row,
    // the first two tests would still pass and this one would not.
    const failedCount = (body.match(/FAILED/g) ?? []).length
    expect(failedCount).toBe(1)
  })
})
