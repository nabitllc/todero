# Handoff — continue the Todero rebuild

Written 2026-08-25, at the end of the session that ran waves 0–6 round 4.
This file is the entry point for the next session. Everything it references is
in this repo, on `main`, at or after `062a37c`.

---

## The goal

Finish Todero so it runs **on any machine, against any LLM API**. Local models
are the test case (Ollama, `qwen2.5-coder:14b`).

Todero the TOOL is built by Claude against a Flight Board. **Todero does not
build Todero.** Todero the PRODUCT builds and operates other projects — the
first is Limiglow (live today as amazoniico.com, rebranding).

Deployment is **OS-installed, not cloud** — the owner wants it private. It must
still reach any provider by API key, and be able to hand work to other machines
when local compute is not enough.

## How the loop works

One piece at a time, each with a written specification and exclusive file
ownership. Per round:

1. **Builder** gets the piece and its files. No other agent may touch them.
2. **Cheap deterministic checks first** — `npx tsc --noEmit`, the acceptance
   harness, the smoke test, the scope guard. No model spends tokens judging
   something already broken.
3. **A critic with fresh context** scores it against the piece's ACCEPTANCE
   list and the design artboards, compares feature-to-specific-feature against
   real tools (Linear, Vercel, Langfuse, Slack), and names **the single biggest
   gap** — one, not a list.
4. That gap becomes the next piece.

No fixed number of rounds. Commit every round, pass or fail — the owner asked
for many small save points and they have proven their worth.

**The critic must never see the builder's summary.** Judge the running app and
the source, never a claim about them.

## Where everything is

| What | Where |
|---|---|
| The brief | `docs/rebuild/BRIEF.md` |
| Owner feedback, verbatim, with status | `docs/rebuild/FEEDBACK.md` |
| Every piece specification, waves 1–6 | `docs/rebuild/pieces/` |
| Wave reports | `docs/rebuild/wave*-report.md` |
| The loop-halt bug and its fix | `docs/rebuild/LOOP-FIX.md` |
| Design spec — the target IA | `design/Nav.dc.html` + 6 sibling artboards |
| Flight Board generator | `scripts/board/build-board.mjs` |
| Flight Board (owner watches this) | https://claude.ai/code/artifact/7ee764c3-3fac-4771-b471-9dc39c77f5d2 |

The design artboards are **files, not descriptions**. That is deliberate: a
critic can check the running app against a file. It cannot check it against a
builder's prose.

## State

Waves 0–5 complete. **Wave 6 (operator surface) is mid-flight**, four rounds in.
Critic scores: **4 → 5 → 6**, each increase earned by the critic breaking
something real.

Round 4 (cards, hub rail, bolts) landed and has **not been critic-scored yet.**
That is the immediate next step.

Done in wave 6 so far: six destinations replacing twenty tabs, Chat as a ⌘J
overlay, project scope enforced at the server seam, eight hardcoded project
lists removed, nine cross-project leaks closed, cards on Now, bolt hour units.

**Only Now and the shell are designed.** Work, Fleet, Memory and Settings are
old tabs re-parented into new destinations. Runs is the one new surface. Five of
six sections still need the card treatment — roughly a round each.

## Owner decisions already made — do not re-litigate

- **Local SQLite until Neon.** Supabase is out. 141,534 rows across 27 tables
  were exported to `./exports` (gitignored) before the switch. That export
  exists on ONE machine and needs a second copy before anything upstream is
  deleted.
- **Hub = Slack Workspace.** "Business" is renamed **Hub**. The 14px left rail
  is the hub switcher and stays permanently. One hub today: **Limiglow**.
  Multi-hub with per-hub RBAC is post-MVP.
- **Identity placement.** Todero wordmark top-left (the tool's brand, never
  changes). Hub/project name in the left nav above PRIMARY (this is scope). The
  breadcrumb bar is deleted — it duplicated both.
- **Bolts and sprints BOTH exist.** A bolt is a fixed 24-hour window summarising
  what AGENTS did; it opens automatically at a set time, and a human starts one
  manually only when the cadence is paused. A sprint is the human planning
  horizon. The old "Run Sprint" button is NEITHER — it starts a goal- or
  feature-scoped run of arbitrary length. It is now "Start builder run".
- **Card contract:** one question, one number that matters, its source, one
  action or none, collapsible, single column on mobile, empty state names the
  project.
- **Never OpenRouter.** All local for now.

## Environment — these have each cost a full round

- **A dev server runs on http://localhost:3000. Do not restart or kill it, and
  never run `npm run build`** — a build clobbers `.next` and takes the running
  server down. This happened five times. `npx tsc --noEmit` is safe.
- **`node scripts/acceptance/run.mjs` takes ~4 seconds and reports 45/45.** If
  it takes minutes or reports mass failures, the SERVER is unhealthy, not the
  product. A critic once reported 31/45 with 7 critical failures against a tree
  that scores 45/45 because the dev server had reached 1.4 GB and stopped
  answering mid-run.
- Auth header: `cookie: mc-auth=kaos2026; mc-role=owner`
- One project, **Limiglow, with zero issues — that is CORRECT**, not broken.
  Empty states are load-bearing UI here.
- **TOD-1** is the test fixture: project "Todero", archived. Un-archive it to
  test scoping, then restore exactly:
  `archived_at = "2026-08-25 19:36:02"`,
  `archived_reason = "Pre-Limiglow history. Todero the tool is built against the Flight Board, not its own backlog."`

## The rules that were learned the hard way

**Never fabricate.** Every number, badge, label and sentence on screen must
trace to a real query. This codebase has repeatedly shipped hardcoded arrays
rendered as live data. Rounds 1, 2 and 3 EACH shipped exactly one claim the
code did not back — a sentence asserting scoping that was not enforced, a guard
comment describing enforcement it did not perform, an API parameter accepted and
ignored. Each cost a round.

**A guard whose comment describes enforcement it does not perform is worse than
no guard, because it is trusted.** Prove every guard fails when it should, not
only that it passes when it should. `scripts/no-unscoped-issues.mjs` is the
model: it sends ten live requests rather than reading source, because both
earlier versions were defeated by dead code that kept the right identifiers.

**Verify the instrument before believing the verdict.** The measuring apparatus
was the broken thing three times: a literal backspace byte where a `\b` belonged,
a preflight that ran once and went stale mid-run, and a JS `'\.'` that silently
collapsed to "any character". When a result is surprising, suspect the
instrument first.

**Correctness that depends on empty data is not correctness.** Un-archive one
row and prove the exclusion still holds. Then prove the counterfactual: the same
query without the clause must still return it.

**Fail closed.** An unresolvable boundary refuses and says how to ask
deliberately. It never widens.

**Ownership boundaries create seams.** Disjoint file ownership stops agents
clobbering each other AND lets a defect sit untouched between two pieces — a
hardcoded emoji table survived two rounds of a sweep whose job was removing
exactly that. After a fan-out, run one pass that owns nothing and greps
everything.

**Never convert an inference about what the owner wants into a stated decision
in an agent's prompt.** Quote what was said, or say the question is open. Doing
otherwise once got six agents blocked by a safety classifier, correctly.

## Open, in rough priority

1. **Critic-score wave 6 round 4** (cards, hub rail, bolts). Not yet judged.
2. **Design the other five destinations** — Work, Fleet, Runs, Memory, Settings.
   Card contract above. Roughly a round each.
3. `lib/agent-capabilities.ts` defines `kemuni-sme` and `vespera-sme` agents for
   projects that do not exist, and `lib/agent-queue.ts` has rules that POST
   issues under `project:Kemuni`. The invented-project defect one layer down, in
   dispatch. Dispatch is guarded off, so nothing has run.
4. **Todero still cannot dispatch a task to local qwen.** `run-agent-locally`
   scored 2/10 in wave 5. The dispatch guard (`lib/dispatch-guard.ts`,
   `TODERO_DISPATCH_ENABLED`) is a deliberate kill switch — lift it for one
   watched task, do not delete it.
5. **Second copy of the 71 MB export** before deleting anything upstream.
6. 5 pre-existing test failures in `agents-route`, `agents-unconfigured`,
   `spawn-live` — verified pre-existing against a clean worktree; not caused by
   this rebuild, not yet fixed.
7. Wave 7 (first managed project — Limiglow), wave 8 (judgment: blind re-score
   of every channel), wave 9 (multi-tenant, post-MVP).
8. Neon migration. The `postgres` adapter is ready and now genuinely tested —
   `lib/__tests__/db-seam.test.ts` runs one query set through all three adapters
   and is 60/60 after two wrong migration filenames were fixed.

## Vault

`C:\Development\Mich-Brain2` is **READ-ONLY**. Propose changes as diffs; only
`_pending/` is AI-writable. A proposal from this session is already there:
`_pending/2026-08-25-todero-rebuild-loop-learnings.md`. Keep adding to it as the
loop teaches things — that habit lapsed once in this session and the owner
caught it.
