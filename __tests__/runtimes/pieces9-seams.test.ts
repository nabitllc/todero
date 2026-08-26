/**
 * __tests__/runtimes/pieces9-seams.test.ts — pieces9/memory-attempted.
 *
 * ── THIS SUITE IS RED ON PURPOSE ────────────────────────────────────────────
 *
 * READ THIS BEFORE TREATING A FAILURE HERE AS A DEFECT. These are not broken
 * tests. They are this piece's incompleteness, moved out of prose and into the
 * gate — the house pattern __tests__/nav/runs-permalink-seam.test.ts
 * established last wave.
 *
 * pieces8 declared three of these same gaps in §8a / §8c / §10.4 / §10.9 of
 * docs/rebuild/pieces/pieces8/memory-attempted.md, as PARAGRAPHS. Every gate
 * stayed green for two rounds while the product kept rendering a failed run as
 * though it had not failed, and while the acceptance check that certifies this
 * channel could not fail. A disclosure the gate cannot see is a disclosure
 * nobody acts on.
 *
 * Each file named below is outside this lane's ownership
 * (lib/memory-*.ts, lib/runtimes/**, __tests__/runtimes/**). Nothing here was
 * edited by this piece, and nothing here CAN be worked around from the files it
 * does own — that is checked per seam in the comments below, by reading those
 * files, not by assuming.
 */

import fs from 'node:fs'
import path from 'node:path'

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8')

// ───────────────────────────────────────────────────────────────────────────
// SEAM 1 — app/api/costs/breakdown/route.ts
// ───────────────────────────────────────────────────────────────────────────
//
// THIS ONE IS A REGRESSION THIS PIECE CAUSES, and it is the reason this file
// exists at all. Until pieces9, lib/runtimes/claude-code.ts closed EVERY
// token_ledger row with a hardcoded `status: 'completed'` — including the rows
// it recorded, four lines later, as failed. `/api/costs/breakdown` filters
// `.eq('status', 'completed')`, so that filter was a no-op: every row matched.
//
// pieces9 makes that status honest (`evidence.ledgerStatus`), which turns the
// filter into a REAL filter — and a failed run still burned its tokens and its
// money. Left as-is, the breakdown silently under-reports spend for exactly the
// runs an operator most wants to see. migrations/038_agent_budgets_and_ceilings.sql
// documents that class of under-count as budget-corrupting.
//
// Verified this cannot be fixed from this lane's files: the filter is written
// in the route itself, and lib/agent-budget.ts (which is the other
// token_ledger cost reader) already sums `cost_usd` with NO status filter, so
// it is unaffected and needs no change. The breakdown route is the only reader
// that discriminates on status.

const BREAKDOWN = ['app', 'api', 'costs', 'breakdown', 'route.ts']
const breakdownSrc = read(...BREAKDOWN)

const BREAKDOWN_DIFF = [
  '',
  'app/api/costs/breakdown/route.ts under-reports spend now that token_ledger.status is honest.',
  '',
  'BEFORE (a no-op filter, because every row said "completed"):',
  "      .select('agent_id, task_key, total_tokens, cost_usd, spawned_at')",
  "      .eq('status', 'completed')",
  '',
  'AFTER (every run that actually finished, whatever its outcome — a failed run',
  'still spent its tokens):',
  "      .select('agent_id, task_key, total_tokens, cost_usd, spawned_at')",
  "      .not('completed_at', 'is', null)",
  '',
  'Why completed_at and not a status list: `spawned` is the only status that',
  'means "this row has not closed yet", and it is exactly the rows with a null',
  'completed_at. Filtering on completion, rather than on outcome, is what the',
  'filter was always trying to express — see lib/runtimes/token-ledger.ts,',
  'where finalizeRun() sets completed_at and status in the same payload.',
  '',
  'Until this lands, /api/costs/breakdown hides the cost of every failed,',
  'killed, max_iterations, running and unknown run.',
].join('\n')

describe('SEAM: /api/costs/breakdown must not hide the cost of runs that failed (RED until applied)', () => {
  it('does not filter the ledger down to status=completed', () => {
    expect(!/\.eq\(\s*['"]status['"]\s*,\s*['"]completed['"]\s*\)/.test(breakdownSrc) || BREAKDOWN_DIFF).toBe(true)
  })

  it('selects the runs that actually closed, by completed_at', () => {
    expect(breakdownSrc.includes("completed_at") || BREAKDOWN_DIFF).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// SEAM 2 — components/tabs/MemoryTab.tsx
// ───────────────────────────────────────────────────────────────────────────
//
// pieces8 §10.4 said, in prose: "This piece remains incomplete until 8c lands."
// It did not land, and nothing failed. The row this channel now writes in
// production — { failed: true, exit_status: 9, rejection_reason: null } — renders
// as the literal string "FAILED  rejection_reason is null", which a reader
// scans as NOT failed. `r.failed` appears in the whole file exactly once, as
// the colour of a 1.5px dot; `exit_status` is not on the file's RunRecord type
// at all, so the one hard OS fact this piece went and captured never reaches a
// human.
//
// The footnote is a second, separate defect of the same class the piece keeps
// naming: a comment asserting something untrue of the shipped code. It says
// "No column records what WORKED". `attempted` is now exactly that column.
//
// Verified this cannot be worked around from this lane's files: MemoryTab reads
// rows straight from GET /api/db/agent_run_records (RECORDS_QUERY at the top of
// the file) and renders them itself. There is no lib/ formatting seam between
// the row and the screen for this lane to change.

const MEMORY_TAB = ['components', 'tabs', 'MemoryTab.tsx']
const memoryTabSrc = read(...MEMORY_TAB)

const MEMORY_TAB_DIFF = [
  '',
  'components/tabs/MemoryTab.tsx still renders a failed run as though it had not failed.',
  '',
  '1. RunRecord (~line 47) — add the column this channel now populates:',
  '     exit_status: number | null',
  '',
  '2. RECORDS_QUERY select list — add exit_status alongside attempted/failed.',
  '',
  '3. the FAILED field (~line 143):',
  '   BEFORE',
  '     <Field label="FAILED" tone="text-red-400" value={r.rejection_reason} missing="rejection_reason is null" />',
  '   AFTER — the boolean column is the fact; the reason is a separate, often-absent one',
  '     {truthy(r.failed) && (',
  '       <Field',
  '         label="FAILED"',
  '         tone="text-red-400"',
  '         value={r.rejection_reason}',
  '         missing={`failed=true, exit_status=${r.exit_status ?? "not observed"} — no rejection_reason was written`}',
  '       />',
  '     )}',
  '     {!truthy(r.failed) && r.rejection_reason && (',
  '       <Field label="REJECTED" tone="text-red-400" value={r.rejection_reason} missing="" />',
  '     )}',
  '',
  '4. the chip row (~line 146) — surface the OS fact:',
  '     {r.exit_status !== null && r.exit_status !== undefined && <Chip>exit_status: {r.exit_status}</Chip>}',
  '',
  '5. the footnote (~lines 157-162) is now false and must be replaced:',
  '   BEFORE',
  '     No column records what WORKED — agent_run_records stores attempted,',
  '     rejection_reason, reviewer_notes and a boolean succeeded, so the working',
  '     path is shown as that flag, not as prose nobody wrote.',
  '   AFTER',
  '     attempted is written by summarizeExit() at process exit and is machine',
  '     text, not a human summary: it carries the runtime, the child OS exit',
  '     code, the run’s own terminal status, its turn count and the tools it',
  '     invoked, each stamped with where it came from. succeeded/failed/',
  '     exit_status are the observed outcome; rejection_reason and',
  '     reviewer_notes remain human text and are absent on most rows.',
  '',
  'Until this lands, the one hard fact this channel captures (exit_status) never',
  'reaches a human, and a failed run reads as a not-failed one.',
].join('\n')

describe('SEAM: MemoryTab must show a failed run as failed (RED until applied)', () => {
  it('carries exit_status on its row type', () => {
    expect(memoryTabSrc.includes('exit_status') || MEMORY_TAB_DIFF).toBe(true)
  })

  // TOD-2484: THIS ASSERTION USED TO MATCH THE FIX AS WELL AS THE BUG.
  //
  // It was `/label="FAILED"[^/]*value=\{r\.rejection_reason\}/`. The corrected
  // component STILL contains that sequence — `value={r.rejection_reason}` is
  // the right thing to render, and the fix was to GUARD it behind
  // `truthy(r.failed)` and give it a `missing` string that names exit_status.
  // So the seam stayed red after being correctly applied, and the only way to
  // satisfy it would have been to make the component worse.
  //
  // That is the third assertion found today that cannot tell its fix from its
  // defect, and it is the reason a source check needs to name the PROPERTY
  // rather than a fragment of the rendering. The property here is the guard.
  //
  // NOT BEHAVIOURAL, and that is a limitation rather than a choice:
  // jest-environment-jsdom is not installed and there is no @testing-library,
  // so nothing in this repo can render a component. Adding that dependency
  // touches a shared package.json while other agents are writing, so it is
  // written up rather than taken unilaterally.
  it('guards the FAILED field behind the failed column, not rejection_reason alone', () => {
    const failedField = memoryTabSrc.match(/\{truthy\(r\.failed\)[\s\S]{0,400}?label="FAILED"/)
    const namesExitStatusWhenReasonAbsent =
      /missing=\{`failed=true, exit_status=\$\{r\.exit_status/.test(memoryTabSrc)
    // A separate, UNGUARDED FAILED field would defeat the guard above, so the
    // absence of one is part of the property.
    const unguarded = /(?<!truthy\(r\.failed\)[\s\S]{0,400})<Field\s+label="FAILED"/.test(memoryTabSrc)
    expect(
      (!!failedField && namesExitStatusWhenReasonAbsent && !unguarded) || MEMORY_TAB_DIFF,
    ).toBe(true)
  })

  it('does not still claim that no column records what the run did', () => {
    expect(!memoryTabSrc.includes('No column records what WORKED') || MEMORY_TAB_DIFF).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// SEAM 3 — scripts/acceptance/checks-anywhere.mjs
// ───────────────────────────────────────────────────────────────────────────
//
// The `retrieval-is-budgeted` check is marked `critical: true` and reads
// "budget enforced by raising, not truncating". It is a regex counter over
// lib/ and scripts/ source TEXT for `MEMORY_BUDGET|contextBudget|CONTEXT_BUDGET`
// and `budget[^\n]*(throw|Error)`. Comments satisfy both, and this lane has
// written many.
//
// MEASURED: replacing the `throw new RetrievalBudgetExceededError(...)` in
// lib/memory-retrieval.ts with `block = block.slice(0, budgetTokens * 4)` — a
// silent truncation, the precise behaviour the check claims to forbid — leaves
// `node scripts/acceptance/run.mjs` reporting `PASS retrieval-is-budgeted`,
// 45/45, harness score 10/10. The jest suite DOES catch it (2 failures, by
// name), so the behaviour is genuinely covered; the harness point that
// certifies it is the part that cannot fail. pieces8 §10.9 named this and
// nobody changed it.
//
// A grader that cannot fail inflates the score of every piece it grades. This
// lane cannot fix it: scripts/acceptance/ is outside its ownership.

const CHECKS = ['scripts', 'acceptance', 'checks-anywhere.mjs']
const checksSrc = read(...CHECKS)
const retrievalCheck = (() => {
  const i = checksSrc.indexOf("id: 'retrieval-is-budgeted'")
  return i === -1 ? '' : checksSrc.slice(i, i + 1400)
})()

const CHECKS_DIFF = [
  '',
  'scripts/acceptance/checks-anywhere.mjs — `retrieval-is-budgeted` is a grep over',
  'source text and is satisfied by comments alone. Make it exercise the behaviour:',
  '',
  'BEFORE (both probes are countMatches over lib/ and scripts/):',
  "      const budget = await countMatches(['lib','scripts'], 'MEMORY_BUDGET|contextBudget|CONTEXT_BUDGET', ['.ts','.mjs'])",
  '      ...',
  "      const errs = await countMatches(['lib','scripts'], 'budget[^\\\\n]*(throw|Error)', ['.ts','.mjs'])",
  '',
  'AFTER (run the real function against a record that cannot fit, and require it',
  'to RAISE rather than return truncated text):',
  '      const { execFileSync } = await import(\'node:child_process\')',
  '      const probe = [',
  "        \"const r = require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } })\",",
  '        // build a scratch sqlite from migrations/sqlite/*.sql, insert ONE record',
  '        // whose reviewer_notes alone exceed the budget, then:',
  "        \"buildRetrievedContext('a','K','t',{budgetTokens:50}).then(\",",
  '        "  res => { console.log(\'TRUNCATED:\' + res.text.length) },',
  '        "  err => { console.log(\'RAISED:\' + err.name) })",',
  '      ].join(\';\')',
  '      // PASS only on RAISED:RetrievalBudgetExceededError. TRUNCATED: is the bug.',
  '',
  'A cheaper variant that still cannot be satisfied by a comment: require the',
  'literal `throw new RetrievalBudgetExceededError(` to appear in',
  'lib/memory-retrieval.ts OUTSIDE a comment, and require',
  'lib/__tests__/memory-retrieval-attempted-budget.test.ts to contain a',
  '`rejects.toThrow(RetrievalBudgetExceededError)` assertion.',
  '',
  'Until this lands, part of the harness’s 10/10 rests on a check that cannot fail.',
].join('\n')

describe('SEAM: the acceptance check that certifies this channel must be able to fail (RED until applied)', () => {
  it('does not decide "budget enforced by raising" from a source-text grep alone', () => {
    const greps = (retrievalCheck.match(/countMatches\(/g) ?? []).length
    // Two countMatches calls and nothing else IS the whole check today.
    expect(greps < 2 || CHECKS_DIFF).toBe(true)
  })
})
