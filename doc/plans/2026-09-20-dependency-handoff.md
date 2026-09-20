# A task receives the work it builds on

**Status: proposal, for Michael's approval before it is built.** Written 2026-09-20. Wave 2 of the
improvement loop (`2026-09-20-todero-improvement-loop.md`).

## The failure, observed

Organization `Zz Full 0920-1219`, 2026-09-20. Task ZZF-3 *Write initial drafts* handed in four
guides. Task ZZF-4 *Review drafts* depends on it. ZZF-4 then said, five times:

> *"I cannot review the guides without the actual content. Please provide the drafts so I can
> review them."*

It was told "use your best judgment" and asked again. The project ended with two of five tasks
blocked. ZZF-4 was not being difficult — it was never given the drafts, and asked for exactly the
right thing.

## Why, in code

- The plan's `after:` line becomes a real dependency at approval: `plan-approval.ts` builds
  `blockedByIssueIds` for each child, and the task cannot start until those are done. **Todero
  knows what each task waits for.**
- A task's hand-in is stored as its `output` document (`CONVERSATION_OUTPUT_DOCUMENT_KEY`).
  **Todero holds every predecessor's deliverable.**
- A child's description is built **once, at approval** (`buildToderoPlanTaskDescription`), before
  any predecessor has produced anything. It carries the goal, the feature, the done-when line and
  the child's own hand-in instruction — and nothing from the tasks it waits for, because there is
  nothing yet.
- At run time the prompt loads the task's *own* documents (`heartbeat.ts`, the `issueDocuments`
  read near line 13701). Not its predecessors'.

So the dependency is enforced for *ordering* and ignored for *content*. The gate opens when the
predecessor finishes; the work it finished never arrives.

## The change

**When a task wakes, it receives the `output` of every task it waited on.**

1. **What.** For each direct predecessor (the `blockedBy` relations, not transitive), its current
   `output` document. Direct only: a chain of five tasks would otherwise carry five outputs into
   the last one and blow the window.
2. **Where it is visible.** Written as a document on the child with key `inputs`, refreshed on
   each wake from the predecessors' *current* output — so a predecessor sent back and redone
   updates what its dependents see. A document rather than a description edit, because the
   description is the person's and the plan's, and because a document is something the API, the
   UI and the improvement-loop check can all read. **This is what makes the hand-off
   observable**: the check `dependency_handoff` looks for the predecessor's output in the child's
   documents.
3. **How it reaches the model.** The `inputs` document is placed in the prompt inside the pinned
   block, under a heading in plain words — *Work you build on* — with each predecessor's
   identifier and title above its output. Pinned, so the prompt budget trims history before it
   trims this; a task without its inputs cannot do its job, so they outrank old chat.
4. **Bounded.** Each predecessor's output is capped (a per-input character budget derived from the
   window, with a visible *"cut here; the full text is on ZZF-3"* marker), and the whole block is
   capped as a share of the prompt budget, the way the turn instruction already is.
5. **Never for the conversation task.** The root has no predecessors. Its wrap-up already reads
   the children's outputs its own way; this change does not touch that path.

## What it is not

- **Not transitive.** ZZF-5 waits on ZZF-4, which waited on ZZF-3; ZZF-5 gets ZZF-4's output, and
  ZZF-4's output is expected to carry forward what mattered. If that proves wrong, transitive
  hand-off is a later wave with its own budget question.
- **Not a description edit.** The description stays as approval wrote it.
- **Not a new agent or a new marker.** One document key, one pinned prompt section, one loader.

## Proof it works

- `dependency_handoff` in the improvement loop: every child with a predecessor has that
  predecessor's output visible in its documents. Today `0/n`; after, `n/n`.
- `project_completes` flips: ZZF-4 reviews the drafts instead of asking for them.
- A unit test on the pure part — given predecessors' outputs and a budget, the block that is
  built, its caps and its marker.
- A repro under `repros/`: a task with one predecessor whose output is present, asserting the
  child's prompt carries it. Runs in every later wave.

## Decisions — Michael, 2026-09-20

- **Cap: a quarter of the prompt budget for the whole block, split evenly across predecessors.**
  At a 16,384 window that is about four pages; the four guides fit. Anything longer is cut with a
  visible marker pointing at the full text on the predecessor task. Code diffs would not fit —
  that is a wave-L question, not this one.
- **Refresh on every wake.** A task always builds on the predecessor's *current* output, so a
  predecessor sent back and redone is what its dependents see next turn. Truer than a snapshot;
  a task mid-way may see its inputs change between turns, and that is the correct behaviour.

**Approved to build** as wave 2 of the improvement loop, after wave 1's report is read.
