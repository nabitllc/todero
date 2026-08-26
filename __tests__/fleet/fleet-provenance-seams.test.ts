/**
 * __tests__/fleet/fleet-provenance-seams.test.ts — fleet-provenance piece.
 *
 * ── THIS SUITE IS RED ON PURPOSE AND STAYS RED UNTIL FILES THIS LANE DOES NOT
 *    OWN ARE CHANGED. READ THIS BEFORE TREATING A FAILURE AS A DEFECT. ────────
 *
 * It is not a broken test. It is the piece's incompleteness, moved out of prose
 * and into the gate — the pattern the runs-need-urls lane established in wave 8
 * (`__tests__/nav/runs-permalink-seam.test.ts`), whose seam has since landed.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Two rounds of this piece shipped a correct server and left the screen wrong,
 * and both times every gate was green while the doc admitted the work was
 * unfinished. Round 2 wrote its five remaining diffs into §8.1 of
 * docs/rebuild/pieces/pieces8/fleet-liveness.md as prose, and prose does not
 * fail a build. A fresh-context critic scored the area 7/10 and put it exactly
 * right: `currentTaskLabel` — round 2's entire deliverable — is on the wire on
 * all 28 rows and has ZERO consumers.
 *
 * Verified 2026-08-26 by the author of round 3:
 *
 *   grep -rn currentTaskLabel --include=*.ts --include=*.tsx .
 *     -> app/api/agents/route.ts (3 hits, where it is BUILT)
 *        lib/fleet-liveness.ts   (1 hit, a comment)
 *        the lane's own tests
 *     -> and NOTHING else. Not one renderer.
 *
 *   GET /api/agents (live, internal secret, this host, 2026-08-26)
 *     -> 28 agents, currentTaskLabel null on all 28, currentTaskSource
 *        'none' on all 28.
 *
 * So the honest string exists, is tested, is correct, and is invisible.
 *
 * ── WHAT EACH SEAM IS ────────────────────────────────────────────────────────
 *
 * SEAM A — the five surfaces that render "what is it doing" still print the raw
 * ambiguous `currentTask`, which cannot say whether it holds the AGENT's claim
 * or the BOARD's. Each needs a one-token swap. None of the five files belongs
 * to this lane.
 *
 * SEAM B — Fleet ▸ Roles calls `loadAgentRoster()` (AGENTS.md alone) while
 * GET /api/agents unions three sources, so the two screens contradict each
 * other about who exists. Measured live on this host today: Roles reports
 * `fleet.agents` 14, /api/agents reports 28. Unchanged after two rounds and
 * invisible to every gate. `app/api/agent-responsibilities/route.ts` is not
 * this lane's file either.
 *
 * ── HOW TO MAKE IT GREEN ─────────────────────────────────────────────────────
 *
 * Apply the diffs the failure messages print. They are also in §6 of
 * docs/rebuild/pieces/pieces9/fleet-provenance.md. Nothing else in this piece
 * needs to change: the functions the seams call are landed and mutation-tested
 * in lib/__tests__/fleet-activity.test.ts and
 * __tests__/api/agents-task-provenance.test.ts.
 *
 * ── WHY THESE ARE SOURCE ASSERTIONS ──────────────────────────────────────────
 *
 * A source-text check is normally a weak guard, and this lane says so in
 * scripts/no-unscoped-issues.mjs's own history. It is the right instrument HERE
 * for one narrow reason: the claim is not "the behaviour is correct" but "this
 * lane's field reached its consumer at all". Zero occurrences versus some is
 * not a judgement call and cannot be satisfied by a comment, because the
 * assertions below require the identifier in an EXPRESSION position next to the
 * field it replaces. Once a seam lands, the behaviour behind it is covered by
 * the unit suites named above.
 */

import fs from 'node:fs'
import path from 'node:path'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), ...rel.split('/')), 'utf8')

/** Strip line and block comments, so a mention in prose never satisfies a check. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ─── SEAM A — the five surfaces that render "what is it doing" ────────────────

const SEAM_A_HEADER = [
  '',
  '  ── SEAM A: currentTaskLabel HAS NO CONSUMERS ──────────────────────────',
  '',
  '  GET /api/agents ships `currentTaskLabel` on every row: the same task',
  '  string as `currentTask`, pre-worded with its provenance FIRST —',
  '',
  '      reported: TOD-42: fix the nav     (the AGENT said so)',
  '      assigned: TOD-42: fix the nav     (the BOARD says so)',
  '      unsourced: TOD-42: fix the nav    (nobody has said so yet)',
  '      null                              (there is no task)',
  '',
  '  Provenance leads because every one of these call sites renders inside a',
  '  `truncate`, and truncation eats the TAIL. A trailing qualifier would be',
  '  cut off precisely where it matters.',
  '',
  '  Until each swap below lands, that surface prints a bare string that may',
  '  be either fact, and several print it in green beside a live dot — the',
  '  flattering guess this whole piece exists to stop.',
  '',
].join('\n')

/**
 * One per surface. `needle` is the exact expression that must appear once the
 * seam lands; `diff` is what to change.
 */
const SEAM_A: { file: string; where: string; needle: RegExp; diff: string[] }[] = [
  {
    file: 'app/page.tsx',
    where: 'line 754 — the office/agent dot label',
    needle: /currentTaskLabel/,
    diff: [
      "  app/page.tsx:754",
      "    - return { dot: 'green', label: row.currentTask || 'Heartbeat just now' }",
      "    + return { dot: 'green', label: row.currentTaskLabel || 'Heartbeat just now' }",
      "",
      "    NO TYPE CHANGE NEEDED HERE. Checked 2026-08-26: `row` comes from",
      "    `(liveAgents ?? []).find((a: any) => …)` at app/page.tsx:746 and is",
      "    `any`, so the swap is the whole diff. (AgentDetailView and",
      "    OverviewTab DO spell out a local wire type and need the field added;",
      "    their entries below say so.)",
    ],
  },
  {
    file: 'components/tabs/AgentDetailView.tsx',
    where: 'lines 34, 249-250 and 666-669 — the header line and the detail row',
    needle: /currentTaskLabel/,
    diff: [
      "  components/tabs/AgentDetailView.tsx:34   (the local wire type)",
      "    -  currentTask?: string | null",
      "    +  currentTask?: string | null",
      "    +  currentTaskLabel?: string | null",
      "",
      "  components/tabs/AgentDetailView.tsx:249-250",
      "    - {agent.currentTask && (",
      "    -   <span className=\"ml-2 text-emerald-400/70 truncate max-w-[200px]\">↳ {agent.currentTask}</span>",
      "    + {agent.currentTaskLabel && (",
      "    +   <span className=\"ml-2 text-emerald-400/70 truncate max-w-[200px]\">↳ {agent.currentTaskLabel}</span>",
      "",
      "  components/tabs/AgentDetailView.tsx:666-669",
      "    - {agent.currentTask && (",
      "    -   <span className=\"text-white/60 truncate max-w-[60%]\">{agent.currentTask}</span>",
      "    + {agent.currentTaskLabel && (",
      "    +   <span className=\"text-white/60 truncate max-w-[60%]\">{agent.currentTaskLabel}</span>",
      "",
      "    NOTE the emerald at :250 is a colour that asserts health. Once the",
      "    string says `assigned:` the colour is at least no longer claiming the",
      "    agent is working; consider a neutral tone for the assigned case.",
    ],
  },
  {
    file: 'components/tabs/AgentsTab.tsx',
    where: 'line 325 — emerald, gated on a green dot',
    needle: /currentTaskLabel/,
    diff: [
      "  components/tabs/AgentsTab.tsx:325",
      "    - {ls.dot === 'green' && (a.currentTask || agentRunsData[a.id]?.taskTitle) && …",
      "    -   ↳ {(a.currentTask || agentRunsData[a.id]?.taskTitle || '').slice(0,40)}",
      "    + {ls.dot === 'green' && (a.currentTaskLabel || agentRunsData[a.id]?.taskTitle) && …",
      "    +   ↳ {(a.currentTaskLabel || agentRunsData[a.id]?.taskTitle || '').slice(0,40)}",
      "",
      "    This is the worst of the five: a raw task string, in emerald, shown",
      "    ONLY when the dot is green — i.e. the layout asserts 'this live agent",
      "    is doing this' about a string that is often just a board row.",
      "",
      "    Note `.slice(0,40)` will now cut into the task after the provenance",
      "    word, which is the intended trade: the word that says WHICH FACT it is",
      "    survives, the tail does not.",
      "",
      "    CAVEAT, stated because it affects whether this one is worth doing:",
      "    components/tabs/CrewTab.tsx's header says AgentsTab is no longer",
      "    rendered anywhere (CrewTab was its only caller; app/page.tsx still",
      "    imports its `RosterMeta` type). If that is still true this swap is",
      "    dead-code hygiene, not a user-visible fix — but leaving a file that",
      "    renders the ambiguous string in emerald sitting in the tree is how it",
      "    comes back. Deleting the file instead would satisfy this seam too.",
    ],
  },
  {
    file: 'components/tabs/OverviewTab.tsx',
    where: 'lines 218 and 262 — the fleet strip',
    needle: /currentTaskLabel/,
    diff: [
      "  components/tabs/OverviewTab.tsx:218   (the local wire type)",
      "    -  currentTask?: string | null",
      "    +  currentTask?: string | null",
      "    +  currentTaskLabel?: string | null",
      "",
      "  components/tabs/OverviewTab.tsx:262",
      "    - <span …>{a.currentTask || run?.taskTitle || 'heartbeat just now'}</span>",
      "    + <span …>{a.currentTaskLabel || run?.taskTitle || 'heartbeat just now'}</span>",
    ],
  },
  {
    file: 'components/tabs/ChatTab.tsx',
    where: 'line 791 — the roster prompt fed to an LLM',
    needle: /currentTaskLabel/,
    diff: [
      "  components/tabs/ChatTab.tsx:791",
      "    - ${a.currentTask ? `: ${a.currentTask}` : ''}",
      "    + ${a.currentTaskLabel ? `: ${a.currentTaskLabel}` : ''}",
      "",
      "    This one is not cosmetic. The string goes into a MODEL's context as",
      "    part of a roster description, so an ambiguous `TOD-42: fix the nav`",
      "    invites the model to state as fact that the agent is working on it,",
      "    and then a human reads that sentence as an answer. `assigned:` vs",
      "    `reported:` is the difference between the model relaying a board fact",
      "    and inventing a status report.",
    ],
  },
]

describe('SEAM A — the five surfaces must consume currentTaskLabel', () => {
  for (const seam of SEAM_A) {
    it(`${seam.file} renders currentTaskLabel, not the ambiguous currentTask (${seam.where})`, () => {
      const src = code(read(seam.file))
      if (seam.needle.test(src)) return // seam landed
      throw new Error(
        [
          SEAM_A_HEADER,
          `  MISSING IN: ${seam.file}`,
          `  ${seam.where}`,
          '',
          ...seam.diff,
          '',
          '  (from docs/rebuild/pieces/pieces9/fleet-provenance.md §6)',
          '',
        ].join('\n'),
      )
    })
  }
})

// ─── SEAM B — Roles and the roster must count the same fleet ──────────────────

describe('SEAM B — Fleet ▸ Roles must derive from the same union as the roster', () => {
  const FILE = 'app/api/agent-responsibilities/route.ts'

  it('agent-responsibilities uses loadFleetRoster, not loadAgentRoster', () => {
    const src = code(read(FILE))
    if (/loadFleetRoster/.test(src) && !/loadAgentRoster/.test(src)) return // seam landed

    throw new Error(
      [
        '',
        '  ── SEAM B: TWO SCREENS, TWO ANSWERS TO "WHO EXISTS" ───────────────────',
        '',
        '  Measured live on this host 2026-08-26:',
        '',
        '    GET /api/agents                       -> 28 agents',
        '      by rosterSource {agents-md: 14, registered: 1, vault: 13}',
        '    GET /api/agent-responsibilities?…     -> fleet.agents 14',
        '      source C:\\Development\\Todero\\AGENTS.md',
        '',
        '  Neither number is arithmetically wrong; they answer the same question',
        '  from different sources. The union is the truth about who exists, and',
        '  Roles answers the narrower question using the wider question\'s word,',
        '  `fleet`.',
        '',
        '  THE CONSEQUENCE, which nothing on screen states:',
        '  ResponsibilitiesCard.tsx builds the accountability dropdown from',
        '  `data.fleet.agents`, so the fourteen missing agents — every Brain2',
        '  vault agent and the self-registered one — CANNOT BE MADE ACCOUNTABLE',
        '  for an area, and the card gives no reason.',
        '',
        '  THE DIFF (both call sites; `rosterFacts()` becomes async):',
        '',
        "    - import { loadAgentRoster } from '@/lib/agent-roster'",
        "    + import { loadFleetRoster } from '@/app/api/agents/fleet-roster'",
        '',
        '    - function rosterFacts(): RosterFacts {',
        '    -   const load = loadAgentRoster()',
        '    -   return { agentIds: load.agents.map(a => a.id), source: load.path,',
        '    -            warning: load.warning }',
        '    - }',
        '    + async function rosterFacts(): Promise<RosterFacts> {',
        '    +   const load = await loadFleetRoster()',
        '    +   return {',
        '    +     agentIds: load.ids,',
        '    +     source: load.rosterPath,',
        '    +     // Each leg warns separately; surface whichever legs failed.',
        '    +     warning:',
        '    +       [load.rosterWarning, load.vaultWarning, load.registrationWarning]',
        '    +         .filter((w): w is string => !!w)',
        "    +         .join(' · ') || null,",
        '    +   }',
        '    + }',
        '',
        '    GET  (~line 121):  - const fleet = rosterFacts()',
        '                       + const fleet = await rosterFacts()',
        '',
        '    POST (~line 163):  - const verdict = validateAssignment(body, rosterFacts())',
        '                       + const verdict = validateAssignment(body, await rosterFacts())',
        '',
        '  ALSO: the file-header comment (~line 25) reads "loadAgentRoster() is',
        '  the only thing this route asks." That becomes false with this change.',
        '  This check strips comments before matching, so a stale comment will',
        '  NOT keep the test red — which is exactly why it is called out here',
        '  instead: nothing will catch it for you.',
        '',
        '  BOTH call sites are required. Patching only GET passes a Promise into',
        '  validateAssignment — the function deciding whether an agent id may be',
        '  made accountable. `tsc` catches that, so it fails loudly, but round 1',
        '  of this piece published the one-call-site version of this diff and it',
        '  was wrong. Re-run `grep -n "rosterFacts()" <file>` before applying: if',
        '  a fourth line has appeared, it needs `await` too.',
        '',
        '  TWO THINGS THE LANDER SHOULD CHECK — NOT VERIFIED BY THIS LANE:',
        '   - `RosterFacts.source` is rendered as `fleetWhere`; after this it',
        '     names only the AGENTS.md path. `fleetSearchLine(load)` in',
        '     app/api/agents/fleet-roster.ts produces the all-three-sources',
        '     sentence if Roles should show it.',
        '   - `capabilityBacking()` in lib/agent-responsibilities.ts may key off',
        '     AGENT_META, which has no entries for vault ids, so newly-assignable',
        '     agents may render as "not capability-backed".',
        '',
        '  (from docs/rebuild/pieces/pieces9/fleet-provenance.md §6)',
        '',
      ].join('\n'),
    )
  })
})
