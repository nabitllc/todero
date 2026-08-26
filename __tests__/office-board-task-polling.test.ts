// Regression guard for TOD (agent-visualization-fidelity): GET /api/tasks was
// polled on TWO independent intervals — components/office/OfficeCanvas.tsx (60s) and
// hooks/useAgentStatus.ts (30s) — both writing into the same shared
// `boardTasksRef`. Every poll on both intervals 404'd, forever.
//
// The route was not imaginary — this file used to say it "never existed",
// which was wrong and argued for the wrong repair. It was RENAMED: fd7e5b5
// ("refactor: tasks → issues") moved app/api/{tasks => issues}/route.ts and
// lib/{tasks => issues}.ts, and these two callers were the stragglers that
// commit missed. So the fix is to finish the rename, not to rebuild the name
// the rename retired.
//
// The fix: "what is this agent working on" is an `issues` row with
// status=in_progress and an assignee, which already exists and is already
// served (scoped, honestly) by /api/issues. OfficeCanvas.tsx is now the ONE
// caller that hits the network for it; useAgentStatus.ts only mirrors the
// ref OfficeCanvas already populates into React state, with no fetch of its
// own — fixing the 404s without doubling live query volume.
//
// This is a source-scan, and it is deliberately limited to the ONE thing a
// source-scan can honestly prove: that a particular dead string is absent.
// It proves nothing about behaviour, and a critic demonstrated exactly that by
// deleting the speech-bubble feature under a green suite of scans like these.
// The behaviour of this surface is asserted by execution in
// __tests__/office-bubble-render.test.ts, __tests__/office-polling.test.ts and
// __tests__/office-board-task-mirror.test.ts. Do not add behavioural claims
// here.

import { readFileSync } from 'fs'
import { join } from 'path'

const officeCanvasSrc = readFileSync(join(__dirname, '..', 'components', 'office', 'OfficeCanvas.tsx'), 'utf-8')
const useAgentStatusSrc = readFileSync(join(__dirname, '..', 'hooks', 'useAgentStatus.ts'), 'utf-8')

describe('board task polling no longer targets the nonexistent /api/tasks route', () => {
  it('OfficeCanvas.tsx contains no live reference to /api/tasks', () => {
    const liveLines = officeCanvasSrc
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
    expect(liveLines.some(l => l.includes("'/api/tasks'") || l.includes('"/api/tasks"'))).toBe(false)
  })

  it('useAgentStatus.ts contains no live reference to /api/tasks', () => {
    const liveLines = useAgentStatusSrc
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
    expect(liveLines.some(l => l.includes("'/api/tasks'") || l.includes('"/api/tasks"'))).toBe(false)
  })

  it('OfficeCanvas.tsx fetches the real in-progress-issues query instead', () => {
    // The URL now lives in components/office/officePolling.ts as
    // BOARD_TASKS_QUERY, where __tests__/office-polling.test.ts asserts its
    // contents (including the `all_projects=1` that keeps it from 400ing on
    // the bare /fleet/office URL). Import it rather than re-spelling it, so
    // this scan cannot pass against a constant that says something else.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BOARD_TASKS_QUERY } = require('@/components/office/officePolling')
    expect(BOARD_TASKS_QUERY).toContain('/api/issues?status=in_progress')
    expect(officeCanvasSrc).toContain('fetchJson<{ data: any[] }>(BOARD_TASKS_QUERY)')
  })

  it('useAgentStatus.ts no longer makes its own network call for board tasks — it mirrors boardTasksRef', () => {
    // Isolate the "Board task polling" effect body so a fetch added for some
    // unrelated reason elsewhere in the file cannot hide a regression here.
    const marker = '// ── Board task polling ──'
    const start = useAgentStatusSrc.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const nextEffectIdx = useAgentStatusSrc.indexOf('// ── Supabase agent_runs polling ──', start)
    expect(nextEffectIdx).toBeGreaterThan(start)
    const effectBody = useAgentStatusSrc.slice(start, nextEffectIdx)
    const liveEffectLines = effectBody.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l))
    expect(liveEffectLines.some(l => /fetch\s*\(/.test(l))).toBe(false)
    expect(effectBody).toContain('boardTasksRef.current')
    expect(effectBody).toContain('setBoardTasks')
    // The publish rule itself is executed in office-board-task-mirror.test.ts.
    expect(effectBody).toContain('createBoardTaskMirror')
  })
})
