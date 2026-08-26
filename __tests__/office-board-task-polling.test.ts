// Regression guard for TOD (agent-visualization-fidelity): GET /api/tasks
// never existed (no `tasks` table either), and it was polled on TWO
// independent intervals — components/office/OfficeCanvas.tsx (60s) and
// hooks/useAgentStatus.ts (30s) — both writing into the same shared
// `boardTasksRef`. Every poll on both intervals 404'd, forever.
//
// The fix: "what is this agent working on" is an `issues` row with
// status=in_progress and an assignee, which already exists and is already
// served (scoped, honestly) by /api/issues. OfficeCanvas.tsx is now the ONE
// caller that hits the network for it; useAgentStatus.ts only mirrors the
// ref OfficeCanvas already populates into React state, with no fetch of its
// own — fixing the 404s without doubling live query volume.
//
// This is a source-scan, not a render test: OfficeCanvas.tsx renders a real
// <canvas> and drives requestAnimationFrame loops that are not worth a jsdom
// harness for a regression this mechanical to catch by inspection.

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
    expect(officeCanvasSrc).toContain("/api/issues?status=in_progress")
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
  })
})
