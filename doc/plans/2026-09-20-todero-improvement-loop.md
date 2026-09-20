# The Todero improvement loop

**Status: proposal.** Written 2026-09-20 from Michael's direction: *focus on Todero improvement, not
on what Todero is building.* A gauntlet where the product under test is Todero itself.

## The shape

One **Testing Organization**, fixed forever so every wave compares to the last. Each wave runs it on
the local model and measures two things: how far it got, and how much a human had to do. A failure
is researched, not patched — Michael gets what failed, why, how it would be fixed and a
recommendation; he decides; the fix is built with a second agent judging it and a repro left behind;
the next wave runs.

This follows the vault's gauntlet exactly (`docs/ai_context/gauntlet/`, runner `wave.py`). The
runner writes the report, diffs the previous wave, and captures cost. A hand run is not a wave.

## The Testing Organization

| | |
|---|---|
| Name | `Zz Gauntlet Org` (the `Zz ` prefix marks it throwaway; it is recreated each wave) |
| Mission | *Publish a one-page guide to each of four houseplants that survive a dark flat.* Small, document-only, four dependent tasks — the same mission every wave, because the point is Todero's behaviour, not the guides |
| Model | `qwen2.5-coder:14b` on Ollama, window 16,384 |
| Governance | `autoAcceptWhenJudgePasses: true` — **off by default today**, and the reason every finished task stopped for a person in the 2026-09-20 run. The loop's whole question is "does it finish on its own", so this is on |
| Second Brain | **Not available to a prompt-only model today.** A chat-completions model gets one string and returns one; only command-line adapters can open the vault. See "What is missing" |

## What is measured — checks with a right answer

Every one of these is a script. None is a judge question.

| Check | Right answer | 2026-09-20 baseline |
|---|---|---|
| `human_answers` | ≤ 1 to reach an approvable plan | **1** ✓ |
| `project_completes` | root and every child `done` inside the budget | **✗** — 2 of 5 blocked |
| `dependency_handoff` | every task with a predecessor receives that predecessor's deliverable in its context | **✗** — ZZF-4 asked five times for drafts ZZF-3 had written |
| `noise_handbacks` | 0 hand-backs that neither ask, propose nor hand in | **4** |
| `verdict_lists_checks` | every reviewer verdict names the criteria it checked | **1 of 6** |
| `pause_holds` | no run *starts* during a hold (one already under way may finish) | ✓ |
| `task_has_criteria` | every child task carries ≥ 1 written acceptance criterion | not yet measured |
| `pipeline_stages` | every task shows written → built → judged → closed | no writer stage exists |
| `first_pass_rate` | share of hand-ins passing review first time — a trend, not a gate | 4 of 6 |

**Judge residue** — the only thing that goes to a model verdict: are the four guides any good.

## The loop, one wave

1. Runner creates the organization, drives it with a lazy human (answers once, accepts nothing by
   hand, ignores hand-backs that ask nothing), and stops at the budget.
2. Report: the nine numbers above against the previous wave, plus measured cost.
3. **Regression first.** Anything that passed last wave and fails now is worked before anything
   new.
4. The top failure is researched — the mechanism, in code, with evidence — and Michael gets four
   things: what failed, why, how it would be fixed, and a recommendation. **Nothing is built until
   he answers.**
5. His decision is built as an ultracode workflow: builder, adversarial judge, one repair, live
   verification. A repro lands under `repros/` and into `checks.json`.
6. Next wave.

**Stop conditions live outside the loop**, per the vault: a wall-clock per wave, a token budget
per wave, and a maximum number of waves before the loop pauses for Michael regardless of state.

## The per-task pipeline Michael described

**Today:** the manager assigns → the worker builds → the reviewer judges (pass, send back, or hand
to the person) → the person accepts. Auto-close on a pass exists as a switch and is off.

**Proposed:** four stages, each with an owner and a record.

| Stage | Who | Leaves behind |
|---|---|---|
| **Write** | the manager (it already rewrites briefs on send-back — no new agent) | description, acceptance criteria, what the builder needs |
| **Build** | a worker | the hand-in |
| **Judge** | the reviewer, against the written criteria — back to Build or forward | a verdict that names what it checked |
| **Close** | Todero, on a pass, automatically | done |

The Write stage is what makes "smallest version possible" enforceable: a task with no criteria is
not ready to build, and a task whose criteria will not fit on one screen is too big and gets split.

## Work item hierarchy — what exists

Michael's list: Goal, Initiative, Epic, Feature, Task, Bug.

| Level | Exists? | What it actually is |
|---|---|---|
| Goal | **yes** — separate object, not an issue | `goals` with a level: company · team · feature · agent · task |
| Initiative | no | — |
| Epic | no | `Project` is the nearest container (the Onboarding project) |
| Feature | **yes** — an issue type, and also a goal level | |
| Story | **yes** — an issue type Michael did not list | |
| Task | **yes** | |
| Bug | **yes** | |
| Brief | **yes** — not listed | the onboarding conversation itself; a person cannot pick it |

So the real ladder is **Goal (company) → Project → Feature → Task / Story / Bug**, with Brief as
the conversation that starts it.

**Recommendation: do not add Initiative or Epic yet.** Nothing in the loop needs them, and every
level added is a level the manager has to decompose through and the person has to understand. Add
one when a real organization outgrows Project, not before. Whether the *pipeline* above is the
same for every type is the better question: a Bug needs a repro before Build, a Story needs a
person's acceptance, a Task on a local model needs a script check. Same four stages, different
criteria per type — which is a wave, once the base pipeline holds.

## Decisions — Michael, 2026-09-20

1. **Second Brain: run without it first.** Wave 1 measures what Todero honestly does today.
   Retrieval — Todero reading the vault and putting the relevant passages in the prompt — is wave
   6, once the loop is proven.
2. **Stop conditions: 45 minutes and 1.5M tokens per wave; the loop pauses for Michael every
   third wave** regardless of state. These live in the runner's invocation, not in a prompt.
3. **Auto-accept on** for the test organization. One governance setting; the loop's question is
   "does it finish on its own".
4. **Merge authority: a Bash permission rule for `gh pr merge`** in the project settings, so a
   wave merges when CI is green and the live check passes — the standing rule from the earlier
   gauntlet.
5. **The dependency hand-off is specced first**, Michael approves the spec, then it is built with
   a judge. It is the change whose shape cannot be seen from outside, and the third time in one day
   that building on a guess would have been wrong.

## The first five waves, proposed

| Wave | Does | Proves |
|---|---|---|
| 1 | Baseline. Measure, fix nothing | the nine numbers, on the runner, with cost |
| 2 | Dependency hand-off | `project_completes` |
| 3 | A hand-back that asks nothing is not a stop | `noise_handbacks = 0` |
| 4 | Criteria on every verdict, not only title-matched ones | `verdict_lists_checks = 100%` |
| 5 | The Write stage and auto-close | `task_has_criteria`, `pipeline_stages` |
| 6 | Retrieval: the Second Brain reaches a prompt-only model | the org uses Mich-Brain2 |

Wave 1 is not optional and costs one run: without it, wave 2 has nothing to be diffed against.
