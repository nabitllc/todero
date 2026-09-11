# Local model: from mission to working tasks

**Status:** proposed, 2026-09-10. **Owner:** Michael. **Scope:** a chat-only local model
(Ollama through the http adapter) hired in the first-run wizard.

## Why

PR #77 made a local model converse on the first task and hand back a status. Everything
before and after that reply still assumes a tool-capable agent: the instructions file the
model never reads, a first-task script that asks for a plan document and a checkbox card
the model cannot produce, a Second Brain it cannot open, and no way for a "yes" from the
person to turn into tasks the agent then works through. This plan closes that gap for one
agent on one machine, which is the standing wave-one goal.

## The four weaknesses and the fix for each

### W1. AGENTS.md never reaches a local model

The hire writes an `AGENTS.md` bundle from the mission; the http adapter skips it, so the
model only sees the task description.

**Fix.** Build the system message for a conversational http agent from the agent record,
not from a file: name, role title, company name, the company mission (from the company
goal), and the behaviour rules PR #77 added. Keep it under ~250 words: a 7B model loses
the thread otherwise. `AGENTS.md` keeps being written for tool adapters; for http agents it
is simply not the source of truth. Code: `server/src/adapters/http/chat-completions.ts`
`buildChatCompletionsSystemPrompt` takes an `identity` object; the heartbeat fills it from
`agent` + `company` + `goal` in the same place it loads `toderoThread`.

### W2. The first-task script asks for tools the model does not have

`ui/src/lib/onboarding-first-task.ts` tells the agent to write the `plan` document and
present a `request_checkbox_confirmation` card. A chat-only model answers in prose and the
promised sidebar never appears.

**Fix.** A second first-task script for conversational agents, chosen by the wizard when
`connectKind === "local_llm"`:

1. Ask at most three questions that change the plan (scope, must-haves, what "done" is).
   Stop and wait (`STATUS: waiting`).
2. Once answered, reply with a short plan in the fenced block below, followed by
   `STATUS: waiting`. No hiring talk, no tool talk.

The block is the contract Todero parses (see "The loop"). The description stays short so
the mission is not buried.

### W3. The Second Brain step is decorative for a local model

The vault reaches agents through an environment variable only command-line adapters read.

**Fix, now.** Skip the step for a local-LLM hire and record `None`. One condition in the
wizard's step order, plus copy on the Review step: "Your local model works from the
conversation only." **Later.** When retrieval exists, feed the top few vault notes into the
system message per task; not before one project works end to end.

### W4. The mission is repeated three times before the model speaks

Greeting quotes it, the description quotes it, the title is its first sentence.

**Fix.** The greeting stops quoting the mission and becomes one line: "Welcome! I'm Ash.
Give me a moment to read the mission and I'll come back with a couple of questions." The
title keeps the first sentence (it is what lists show). The work-item view hides the seeded
description on the onboarding first task and shows the mission line instead, the way the
old chat view already did (`originKind` marks the task; `work-item-adapter.ts` reads it).

## The loop: mission → questions → plan → approval → tasks → work → done

One agent, one machine, sequential. The model only ever produces text; Todero does every
structural action. That is the whole design principle: **the model proposes in a fixed
shape, Todero acts on the shape.**

### 1. Clarify

First-task script step 1 above. Each exchange is one heartbeat run; PR #77 already wakes
the agent on the person's comment and hands the turn back with `STATUS: waiting`.

### 2. Propose: the plan block

When ready, the model ends its reply with:

````
```todero-plan
goal: One sentence of what we are building and for whom.
features:
  - name: Short feature name
    why: One line
    done_when: One line
tasks:
  - title: Imperative task title
    feature: Short feature name
    output: What the agent will hand in (a document, a list, a draft, a decision)
```
STATUS: waiting
````

Rules: YAML-ish, flat, no nesting deeper than shown, 3–7 features, 4–12 tasks, every task
names a feature. A 7B model can hold this shape; a 14B model does it reliably. The test
connection already tells the person the model's speed; the wizard can recommend the 14B when
it is present.

**Server.** `parseToderoPlanBlock(text)` in `server/src/todero/plan-block.ts`: returns
`{ plan, body }` or `null`. Tolerant: accepts `-` lists, trims labels, ignores unknown keys,
never throws. On a successful run with a parsed plan, the heartbeat:

- writes the plan as the issue's `plan` document (the data model already has it),
- stores the parsed shape as issue metadata (`onboardingPlan`, version 1),
- posts the reply body (block stripped) as the comment,
- sets the task to Blocked, Waiting on you (existing PR #77 path).

### 3. Approve: the plan card

In the work-item view, a task with an `onboardingPlan` and status Waiting shows a card
above the composer: the goal line, features as headings, tasks as checkboxes (all checked),
and two buttons, **Approve** and **Ask for changes**. "Ask for changes" focuses the composer;
the typed comment wakes the agent, which revises and re-emits the block (same path, new
version). **Approve** posts `POST /api/issues/:id/plan/approve` with the kept task ids.

The right sidebar gets a **Plan** section that renders the `plan` document, so the card can
stay short. This is the missing "plan on the right sidebar".

### 4. Create the work: Todero, not the model

On approve, the server, as the board actor:

- creates one child issue per kept task under the first task, in the Onboarding project,
  assigned to the same agent, status To do, with a description of
  `goal + feature + done_when + output` so each task stands alone,
- links them in order with `blockedByIssueIds` so task N+1 is blocked by task N (the
  existing dependency machinery then wakes the next one when the previous closes),
- sets the first task to In progress with its own `STATUS` left to the agent, and posts a
  system line "Approved. 6 tasks created." (system tone, not under the person's name).

Hiring is **out of scope** for this loop: the checked options are tasks only. Multiple
agents come back when one agent finishes one project (owner directive).

### 5. Work: one task at a time

Each child task wakes the agent (assignment wake). The prompt is the task description plus
the thread on that task; the system message says: do the work in this reply, hand in the
output, end with `STATUS: done` when the output is complete or `STATUS: waiting` with one
question when you cannot proceed.

- `STATUS: done`: the reply is stored as the task's `output` document and as the comment;
  the task closes; the dependency wake starts the next task. Same run path as PR #77 plus
  one document write.
- `STATUS: waiting`: Blocked, Waiting on you; the person's comment resumes it. Nothing else
  moves.
- Failure or timeout: the existing retry path; after the cap, Blocked with a system line
  the person can read, never "missing disposition".

Rate: one run at a time per agent (already `maxConcurrentRuns`, set it to 1 for http agents
in `buildNewAgentRuntimeConfig`), ten-second cooldown, no timer. So the loop is quiet unless
there is work, and never floods a laptop GPU.

### 6. Report: the parent task closes itself

When the last child closes, a heartbeat-side hook (the same place that runs the dependency
wake) posts a summary on the first task: one line per task with a link to its output, then
sets the first task to Done. The dashboard's "Tasks in progress" and Inbox's "Waiting on
you" already read these states.

## What the person sees, end to end

1. Finish the wizard, land on the first task: one greeting line.
2. Within about ten seconds: two or three questions. Answer in the composer.
3. Next reply: the plan card. Untick what you do not want. Approve.
4. The task list under the first task fills in; the first one starts on its own.
5. Each task ends with a document you can open, or a question in your Inbox.
6. When the last one closes, the first task shows the summary and turns green.

## Delivery order

| PR | Contents | Size |
| --- | --- | --- |
| A | W1 system identity, W2 chat first-task script, W3 skip step, W4 greeting + hidden description, `maxConcurrentRuns: 1` for http agents | small, one day |
| B | Plan block parser + plan document + issue metadata + Plan sidebar section + plan card with Approve / Ask for changes + approve endpoint creating chained child tasks | medium, two to three days |
| C | Per-task `output` document on done, dependency wake to the next task, parent summary and auto-close, failure lines readable | medium, two days |
| D | Model recommendation in the wizard (14B when present), retrieval from the vault into the system message | later |

Each PR is testable on its own on the reference machine with qwen2.5-coder:14b and the
current PoGo Collection+ organization. A leaves the loop as it is today but makes the first
exchange sensible; B is the moment the product becomes "propose, don't decide"; C is the
first time a local model finishes a project by itself.

## Out of scope, on purpose

- Hiring more agents from the plan.
- Code-producing tasks; a local chat model hands in documents. Code needs a tool adapter
  and a workspace, which the existing Claude Code / Codex paths already cover.
- Cloud models. Local only, per the standing directive.

## Risks

- Small models sometimes break the block shape. The parser is tolerant, and a parse miss
  simply posts the reply as prose with a system line "I could not read a plan in that
  reply" and a one-click "Ask Ash to send the plan again".
- Long threads exceed a 7B context. Cap the thread at 20 turns and 4k characters per turn
  (already in `conversation-thread.ts`); tasks get their own thread, so the first task's
  history never bleeds into work tasks.
- Dependency chains of 12 tasks are fine; the existing dependency wake is idempotent.

## Part 2 (added 2026-09-10 evening, after Michael's review of waves A and B)

Waves A, B and C shipped as PRs #79, #80 and the wave C PR. What follows is the next
set, in the order they pay off. Michael's direction: one-human or zero-human operation,
Todero deciding when an extra agent is needed, and agents kept busy while unblocked work
exists. "Bolts" in his vocabulary are AWS AI-DLC bolts: hours-long cycles from intent to
ship with human gates after plan validation and after evaluation.

### Wave D: goals and a real hierarchy

- **Goals in the Work menu.** The page exists behind `enableGoalsSidebarLink`; make it a
  default entry and list every goal with status and the tasks under it.
- **Plan features become goals.** On approve, each plan feature is saved as a goal under the
  company goal (level `feature`), with its `done when` as the goal's description. Child tasks
  link to their feature goal. Every task prompt then carries mission → feature → task.
- **Types.** Today: `Feature`, `Story`, `Task`, `Bug`, chosen by depth (top level Task, one
  level down Story, two down Task). Recommended: the conversation task is the **Project brief**,
  each feature is a **Feature** (a goal plus a parent task), each plan task a **Task** under
  its feature, and **Bug** stays for send-backs that turn into fixes. Depth no longer decides
  the type; the plan does.
- **Feature done.** A feature closes when its tasks are accepted and its `done when` is
  confirmed by the judge (wave E). The project closes when every feature closes.

### Wave E: the judge, so the person is not the only gate

- **A judge run before Accept reaches the person.** When a task hands in, a second run (same
  model, judge prompt: the feature's `done when`, the task's output line, the deliverable)
  answers `VERDICT: pass` or `VERDICT: fail` with one paragraph. Pass: the task goes to the
  person's Inbox as today, or, in zero-human mode, is accepted automatically. Fail: the task
  is sent back with the judge's paragraph as the note, up to two rounds, then the person.
- **Judge as an agent, not a hidden call.** It is hired by Todero when the first plan is
  approved, named after the lead ("Nova's reviewer"), listed on the Agents page, and its runs
  and cost show like any other agent's. Todero decides it is needed the moment there is a
  plan to verify; that is the first instance of "Todero knows when a new agent is needed".
- **Zero-human switch per organization.** Off: person accepts. On: judge accepts, person
  only sees send-backs that failed twice and the wrap-up.

### Wave F: parallel work and staying busy

- **More than one task at a time.** The plan block gains an optional `after:` per task; tasks
  with no `after` and no shared feature run in parallel. `maxConcurrentRuns` for a local
  agent becomes the number of models the machine can serve (Ollama reports it), default 1.
- **Keep working while unblocked work exists.** A short timer heartbeat (every 2 minutes)
  that picks any To do task without blockers. Skips when nothing is actionable, so the GPU
  stays quiet.
- **Todero decides on a second worker.** When more than N tasks are ready and the machine has
  headroom, Todero hires a second worker agent from the same model and splits the queue by
  feature. Same mechanism as the judge: a rule, an agent record, visible on the Agents page.

### Wave G: projects and bolts

- **Onboarding project completion.** The Onboarding project closes when the conversation
  task closes with its wrap-up. Its wrap-up proposes the next project in one line.
- **When a new project is needed.** A new project is created when the person approves a plan
  whose goal is not covered by an open project's goal, or when the wrap-up's "next" line is
  accepted. Todero asks in the Inbox: "Start a project for this?" with one button.
- **Bolts.** A bolt is one approved plan run to its wrap-up: intent (the conversation), plan
  validation gate (Approve), construction (the tasks), evaluation gate (judge, then person),
  ship (wrap-up). The `Bolt` slot on the task shows bolt number, started, elapsed, gates
  passed. A project is a sequence of bolts; the Timeline shows them.

### Wave H: teaching Todero to fan out

- **Model routing by task kind.** A small table: planning and judging on the strongest local
  model present; drafting and formatting on the fastest; the wizard's pick is the default for
  both. Users with cloud keys get the same table with their models. Every run records which
  model and why.
- **Orchestration rules as data.** The "when to add an agent" rules from waves E and F live
  in one file Todero reads, so any deployment can tune them: judge after first plan, second
  worker above N ready tasks and available headroom, never more agents than models served.

### Order and size

| Wave | Contents | Size |
| --- | --- | --- |
| D | Goals menu, features as goals, types by plan, feature done | 2 days |
| E | Judge agent, verdicts, zero-human switch | 2–3 days |
| F | Parallel tasks, busy timer, second worker rule | 2 days |
| G | Project close/open, bolts on the task and Timeline | 2 days |
| H | Model routing table, orchestration rules as data | 1–2 days |

### Wave I: Play / Pause

**What exists.** A company already has a `paused` status with `pauseReason` and `pausedAt`, and
the heartbeat only serves companies whose status is `active` (timers, wakes, and run starts all
check it). Agents have their own `paused` status with `/agents/:id/pause` and `/resume`. Archiving
a company cascades: pauses its agents, cancels queued and running runs, and restores on
reactivation. Nothing exposes a company pause today, and nothing explains to the person what was
stopped.

**The switch, per organization.**

- `POST /api/companies/:id/pause` `{ reason?: "manual" }` sets status `paused`, `pauseReason`,
  `pausedAt`. Running runs finish; nothing new starts; queued wakes stay queued. No cascade onto
  agents (archive keeps its cascade; pause is lighter and reversible).
- `POST /api/companies/:id/resume` sets status `active`, clears the two columns. The next timer tick
  and the queued wakes pick up where they stopped. Nothing is re-created.
- Both are board-only and registered in OpenAPI; both write an activity line ("Paused by you at
  10:42" / "Resumed by you").

**The master switch, instance-wide.**

- `POST /api/instance/pause-all` pauses every active company with `pauseReason: "master"`;
  `POST /api/instance/resume-all` resumes only the companies whose reason is `master`, so an
  organization you paused by hand stays paused. Shown as one control in the sidebar footer.

**The button.** In the sidebar, right under the organization name: a single control that reads
"Pause" while active and "Play" while paused, with a short caption ("Agents are working" /
"Paused since 10:42"). The Dashboard header repeats the state. Pressing Pause asks nothing; it
pauses immediately and opens the Inbox.

**The Inbox while paused.** The Your-turn panel gains a header card, "Paused", with four lists,
each with its buttons:

1. **Was in flight.** Runs that were running when you pressed Pause and what they were on; they
   finish on their own and show "finished" when they do.
2. **Queued.** Tasks that would start on Play, in order, with their blockers. Button: "Skip"
   (cancels that task) and "Move up" (reorders by clearing its blocker).
3. **Waiting on you.** The existing Your-turn rows (plan to approve, output to accept, question to
   answer), unchanged.
4. **Recommendations.** Computed, not generated, so no run is needed while paused: tasks that
   failed the judge twice, tasks that have been queued longer than the busy timer, the last
   wrap-up's "Next:" line, and agents over budget. Each row links to its task or agent.

Play closes the card and the panel goes back to the plain Your-turn list.

**Mobile.** The button and the Paused card are the first thing on the phone; the four lists
collapse to counts with a tap to expand.

**Tests.**

- Server: pause and resume flip the columns and refuse a second pause; master pause leaves a
  manual pause alone on resume-all; the heartbeat timer tick skips a paused company (existing
  `active` check, covered by a test that asserts no run is created); a queued wake survives a
  pause and runs after resume.
- UI: the button text and caption follow the status; the Paused card lists the four sections and
  the Play button; Skip cancels through the API.

**Copy.** "Pause", "Play", "Paused since", "Was in flight", "Queued", "Waiting on you",
"Recommendations", "Pause everything", "Resume everything". No "heartbeat", "wake", or "run" in
user-visible text.

**Size.** About a day: two routes plus two instance routes, the sidebar control, the Paused card,
tests. No schema change: the columns exist.

**Out of scope.** Pausing a single agent from this card (the Agents page already does it); a
scheduled pause ("pause at 6 pm"); a pause that asks the lead to write a status note (would need a
run while paused; revisit after the judge wave).

## Wave: the task view, how people and agents meet

_Shipped in this PR:_ step 1 and step 2 in full, and step 0 on both sides. On the card: the facts
column is gone, the chip and the turn bar share one status vocabulary, and a plan-made brief reads
as a **Brief** block with the standing instruction left out. In the Properties panel: the groups are
now Pinned / Relationships / Cost and time / Review / About; Token usage, Token cost, Created,
Started, Closed and Updated moved into Cost and time, so nothing the card stopped showing went
missing; and the panel's Status control speaks the card's six words plus Queued through the new
`panel-status.ts` (`displayStatus` / `apiStatusFor`), refusing Blocked with no blocker and In
progress with no assignee exactly as the card does. `IssueProperties.tsx` keeps its new logic in
`panel-status.ts`, `panel-cost.ts` and `WorkItemStatusRow.tsx` rather than growing.

_Still open from step 0:_ in-place editing of every panel value (step 21), Feature and Due date in
the Pinned group (the goals wave and step 22), and the narrow-screen drawer behind an "i" button.

_Two known gaps, deliberately not closed here:_

- **Editing a brief shows the standing instruction.** The Brief block hides the "Do this task now…
  STATUS: done" line because it is machinery, but clicking Edit opens the body exactly as it was
  written, instruction and all. That is the explicit exception to the What-Nova-sees separation: the
  card reshapes how a brief reads and never what it says, so an edit can never silently drop a line
  the agent depends on. Closing the gap properly means an editor that round-trips the instruction,
  which belongs with step 11 (description as a real editor).
- **Start now wakes the agent once; it does not switch the timer on.** The turn bar reads the
  assignee's busy timer from the agents list (`readAgentTimer`) and, when it is off on a To do task,
  offers Start now, which sends one wake for this task. Turning the timer on for good is the
  Hardening wave's backfill, so the agent then picks up the next task without a button.

_Steps 3–10 shipped on 2026-09-11; see **What shipped (steps 3-10)** below the step list._

_Queued for future: steps 11–30._

Ordered as it should be built. Each step is shippable alone.

**Step 0: one sidebar, not two (half a day; goes first, 2026-09-11).** Today the task card carries its own facts column (Assignee, Priority, Created, Closed, Token usage, Token cost, Bolt) and the page also opens the Properties panel (Triage, Relationships, Execution, About), so the same task shows two sidebars with overlapping and sometimes disagreeing values (the chip says To do while the panel says Backlog).

Jira and Azure DevOps both do this one way: the main column is the content and the conversation; a single details panel on the right holds every field, in collapsible groups, each field editable in place, with the few fields that matter most pinned at the top. Todero does the same:

- Remove the facts column from the task card. The card keeps: type stamp, identifier trail, title, the turn sentence with its buttons (step 1), the body or brief, the Tasks list, the plan or review cards, then the activity and the composer.
- The Properties panel becomes the only details panel, regrouped:
  - **Pinned:** Assignee, Priority, Feature (its goal), Project, Due date (step 22).
  - **Relationships:** Parent, Blocked by, Blocking, Related (step 14).
  - **Cost and time:** Token usage, Token cost, Time in state (step 18), Created, Closed, Updated.
  - **Review:** Reviewer, last verdict, rounds; Approvers and Monitor only when set.
  - **About:** Originating, type, the "What Nova sees" toggle (step 9).
  Every value edits in place (step 21). Empty fields show a muted "None" with a click target, never a dash.
- One status vocabulary. The panel's Status editor and the card's chip use the same six words (New, To do, In progress, Blocked, Done, Cancelled) plus Queued as a computed label; the raw "backlog" never appears. The panel's editor and the chip share `displayStatus` and `apiStatusFor`.
- A child task's brief renders as a **Brief** block, not raw text: Goal, Feature, Done when, Hand in, and What the person said as labelled lines; the standing instruction ("Do this task now… STATUS: done") is part of "What Nova sees", not the body. Same treatment the first task already gets for its mission.
- Narrow screens: the panel becomes a drawer opened from an "i" button in the title bar, as both Jira and ADO do on mobile.

**Step 1: the turn sentence and its actions (one day, with step 2, 5, 8).**

- A bar under the title, always visible, one sentence: "Nova is writing" (a run is live), "Your turn: accept or send back" (review pending), "Your turn: approve the plan" (plan pending), "Your turn: answer Nova" (question), "Queued behind ZZW-3" (blocked by a task), "Waiting on ZZW-3 and 2 more" (parent), "Done", "Paused" (wave I).
- The bar carries the buttons for that state: Approve N of M, Accept, Send back, Answer, Play. The same buttons remain above the composer for people who scroll.
- Agents pick up open work by themselves (the two-minute busy timer from wave F), and the sentence says so instead of leaving a To do task looking abandoned: "Nova picks this up within 2 minutes" for an unblocked To do task, "Queued behind ZZW-3, then Nova picks it up" for a blocked one, and "Nova's timer is off; start now?" with a button when the agent's timer is disabled (agents hired before wave F; the Hardening wave backfills them, this is the safety net).
- Source of truth is the existing state: status, the three markers, blockers, live runs. A pure function `turnSentence(view)` with tests for every state.

**Step 2: actions where the eye is.** Covered by the bar. Keyboard: A accepts, S opens send back, Enter sends. Shown as hints on hover, never required.

**Step 3: work apart from talk (two days, with 4, 6, 7).**

- Two tabs on the main column: **Conversation** (default while the task is open) and **Deliverable** (default once handed in). Deliverable renders the `output` document with a version picker ("Version 2 · handed in 10:42 · accepted"), a copy button, and a download.
- The conversation shows a one-line card where the reply used to be: "Handed in version 2 · Open". Replies that are questions or plans stay in the conversation in full.
- The plan on the conversation task renders the same way under a **Plan** tab: goal, features with done-when, tasks with their status, and the approval card until approved.

**Step 4: formatted replies.** Agent and person text renders as formatted text (headings, lists, bold, code) using the same renderer the body uses. Long replies fold after twelve lines with "Show all".

**Step 5: mute the machinery.** Status lines ("Moved to To do"), assignment lines and system notices collapse into one grey line per cluster: "3 changes · show". A cluster is consecutive system lines with nothing human or agent between them. Recovery notices keep their warning tone but sit inside the cluster.

**Step 6: the chain of why.** Above the title: Mission › Feature › Task, each a link (Goals page, the feature goal, this task). Comes from the goals wave.

**Step 7: the reviewer's voice.** A verdict card: "Reviewed by Nova's reviewer · Pass" or "· Sent back", the paragraph, and the round ("2 of 2"). Distinct colour from Nova's replies and from yours. A failed verdict also shows the send-back note the worker received.

**Step 8: the composer as quick replies.** Chips above the text box that change with the state: Approve, Send back with note, Ask a question, Give more context, Skip this task. Picking a chip fills a starting sentence; free text always works. @mention lists agents. Enter sends, Shift+Enter is a new line. Attachments stay.

**Step 9: "What Nova sees" (half a day).** A toggle in the sidebar that opens a read-only panel with the brief, the standing instructions, and the conversation exactly as the model received them on the last run. Read from the run's stored context, never from a fresh call.

**Step 10: phone (half a day).** One column. The turn bar and its buttons stick to the top. Tabs from step 3 become a segmented control. Composer chips scroll sideways.

#### What shipped (steps 3-10)

Shipped 2026-09-11, UI only — no server route, no schema, no migration. The data was already there;
this wave reads it.

**Step 3 — work apart from talk.** The main column carries up to three tabs: **Conversation**,
**Deliverable** (the `output` document) and **Plan**. One tab shows no strip at all. Which tab opens
is a rule, not a memory: the Deliverable the moment work is handed in *and* every time a finished
task is opened again, the Plan while it is still asking for a yes, the Conversation the rest of the
time — including work sent back to be redone, where the note saying what to change is
(`work-item-tabs.ts`; `tabsFor`, `defaultTabFor`, `resolveTab`). The strip is a real tab strip:
each tab names the panel it opens, the arrow keys move between them, and only the current tab is a
tab stop. The Deliverable tab renders the document with a version picker, a
copy and a download; the line over it reads "Version 2 · handed in 10:42 · accepted", built by
`work-item-deliverable.ts` (`deliverableVersions`, `handedInAt`, `versionLabel`) — "accepted" only
on the newest version, only once the task is done, and never while the person still has to decide.
The Plan tab took over the approval card whole, checkboxes included, so there is one plan card and
not two, and once the plan is approved each line says where the task it became stands — To do, In
progress, Done, Blocked or Queued (`work-item-plan.ts`, joined by id and then by title). The conversation keeps a one-line card where the hand-in reply was: "Handed in version 2 ·
Open", and Open switches the tab.

**Step 4 — formatted replies.** Every reply, the agent's and the person's, renders through the same
markdown renderer the body uses. A reply longer than twelve lines folds behind "Show all"
(`replyLineCount` / `replyFolds`, clamped in CSS so a fold never cuts a list or a fence in half).
@mentions still stand out inside formatted text: a small rehype plugin (`work-item-mentions.ts`)
swaps each `@name` run for the span the stylesheet already knew, skipping code and links.

**Step 5 — mute the machinery.** Consecutive status and assignment lines collapse to one grey
"3 changes · show" that opens in place (`work-item-cluster.ts`, `WorkItemClusterLine`). A single
machinery line is left as itself. A notice the product posted — a recovery notice — is machinery
too, never the person's own words, and it folds into the cluster with the rest; but it keeps the
warning tone it arrived with, so opening the cluster still tells the two kinds of line apart.

**Step 6 — the chain of why.** Mission › Feature › Task above the title, from the goal the task was
created under: Mission opens the Goals page, the middle link opens that feature's goal, the task
itself is not a link. Hidden entirely when the task hangs off no feature (`chainOfWhy`). No call of
its own — `issue.goal` already comes down with the task.

**Step 7 — the reviewer's voice.** A reviewer's reply is no longer a reply. `parseVerdictFromComment`
reads the four sentences `buildJudgeComment` writes on the server and turns that comment into a
verdict card with its own colour and its own left edge: "Reviewed by Nova's reviewer · Pass" or
"· Sent back", the paragraph, and the round ("2 of 2", from the `todero-judge-rounds` marker). A
sent-back verdict also shows the manager's "What to change" (the `guidance` document), and says so
when it was the last round.

**Step 8 — the composer as quick replies.** Chips above the box, computed from the same turn the bar
above is computed from (`composerChipsFor(turn.actions, …)`), so the two can never disagree: no
Accept in the bar, no Approve chip. A chip that has a button presses it; a chip that does not writes
an opening sentence and leaves the person to finish it. Nothing is ever sent by a chip alone. There
are five labels in all — Approve, Send back with note, Ask a question, Give more context, Skip this
task — and a plan uses the same two words for the same two moves as a hand-in does. Enter sends,
Shift+Enter is a new line, @ still lists the agents, attachments unchanged.

**Step 9 — "What Nova sees".** A **Behind the scenes** toggle in the Properties panel. Opening it
fetches the task's most recent turn and reads that turn's stored `contextSnapshot`
(`readAgentContext`): who the model was told it is, the brief, the standing instructions, what it
was asked this turn, and the conversation it was given. Nothing is fetched until it is opened, and
nothing is rebuilt — a fresh call would show today's brief against yesterday's reply.

**Step 10 — phone.** Under 720px the turn bar sticks to the top of the scroll, the tab strip becomes
a segmented control, and the chips scroll sideways.

**Where the code went.** `WorkItemView.tsx` came *down* from 830 lines to 547 while gaining all of
the above: the header, the body, the thread, the review card and the composer are now their own
components (`WorkItemHeader`, `WorkItemBody`, `WorkItemThread`, `WorkItemReviewCard`,
`WorkItemComposer`), and every rule that can be a pure function is one, with a test per branch —
`work-item-tabs.ts`, `work-item-thread.ts`, `work-item-chips.ts`, `work-item-deliverable.ts`,
`work-item-chain.ts`, `work-item-verdict.ts`, `work-item-mentions.ts`, `work-item-cluster.ts`,
`work-item-plan.ts`, `agent-context.ts`. `IssueDetail.tsx` gained three lazy document queries
(`output`, its revisions, `guidance`) and four props; `IssueProperties.tsx` gained one line. "What
Nova sees" asks for the turn under the same query keys the task page already uses
(`queryKeys.issues.runs`, `queryKeys.runDetail`), so opening it reads what is already there rather
than fetching a private second copy.

#### Open

- **The hand-in card is the last agent reply, not a matched one.** The comment an agent leaves on a
  hand-in is the same summary that becomes the Output document, but the server clips it, so matching
  the two strings would miss on any long hand-in. The card therefore replaces the last agent reply
  while a hand-in is waiting. If a task ever gets an agent reply *after* a hand-in that is neither a
  verdict nor a new hand-in, that reply would wear the card. Nothing does that today.
- **The version picker counts revisions, not acceptances.** "accepted" is inferred from the task
  being done, because no column records which revision was accepted. A task accepted at version 1
  and handed in again would label version 2 accepted. Closing this needs a stored acceptance, which
  is a schema change and out of this wave.
- **The chain needs the goals wave to have run.** A task created before the plan-to-goals work, or
  one whose goal is the company goal, shows no chain. That is the intended fallback, not a bug, but
  it means most older tasks show nothing.
- **`WorkItemView.tsx` is still over the 400-line component cap** at 547. It is a mount point and a
  props type now; splitting the props type off buys nothing. Recorded as standing debt, smaller than
  it was.
- **"What Nova sees" reads the newest turn on the task, whoever took it.** On a task the reviewer
  also touched, the newest turn may be the reviewer's. Naming the turn (agent and time) at the top
  of the panel is the fix and is not done.
- **A recovery notice reads in the new task view; it cannot be answered there.** The notice and its
  warning tone are shown, but the card that offers to resolve or re-hand-out a stuck task
  (`IssueRecoveryActionCard`) is still only on the classic thread. Mounting it as it stands would
  drag its own vocabulary onto a screen that may not use those words, so it wants a rewrite of its
  own rather than a wiring change. Out of this wave.
- **Step 9's toggle is not in the About group.** Step 0 planned it there; it went in as its own
  **Behind the scenes** section so the 2,700-line `IssueProperties.tsx` did not have to be reshaped
  to take it. Moving it is cosmetic.
- **The full `@todero/ui` suite is flaky under parallelism.** Two runs on this branch failed a
  different unrelated file each time (`AgentToolsTab`, `CompanySettings`), both passing alone; the
  third run was green end to end. Pre-existing, not from this wave, but worth a look.

#### Live verification on this machine

Tampa Supper Club is **paused**, so it is safe to read. **Do not accept anything and do not send
anything back** — every step below is a read.

1. Open **TAM-3** (the hand-in waiting for Accept) from the Board's Your turn column or from Work.
2. The **Deliverable tab is already open** and shows the handed-in output as formatted text, not raw
   markdown. Above it: "Version N · handed in HH:MM". With more than one version it is a picker;
   with one it is a plain line. Neither says "accepted" — nothing has been accepted.
3. **Copy** and **Download** sit to the right of that line. Copy is safe to press (it writes the
   clipboard and says "Copied"). Download saves a `.md`; skip it if you would rather not.
4. Click **Conversation**. Where the agent's hand-in reply used to be there is one line: "Handed in
   version N · Open". Press **Open** — it takes you back to Deliverable. Come back to Conversation.
5. If the organization has a reviewer that has spoken, its paragraph is a **verdict card**, not a
   reply: a tinted card with a coloured left edge reading "Reviewed by <reviewer> · Pass" or
   "· Sent back", with "1 of 2" or "2 of 2" beside it when the task has been round the loop. A sent
   back one also carries a **What to change** block. It must not look like Nova's replies.
6. The **review card under the conversation agrees with it**: if the reviewer passed it, the card
   says "<reviewer> read it and says it does what the task asked"; otherwise "The output is ready".
   Both end "Read it under Deliverable, then accept it or send it back." Read only — do not press
   Accept or Send back.
7. Any run of "Moved to…" / "Assigned to…" lines is **one grey line**: "3 changes · show". Click it:
   the lines appear indented under it; click again to fold them.
8. Above the title, if TAM-3 belongs to a feature: **Mission › Feature › Task**. Mission opens the
   Goals page, the feature name opens that goal, the task name is plain text. If the task has no
   feature goal, the chain is absent — that is correct, not a failure.
9. Above the composer: **chips**. On a hand-in they read Approve · Send back with note · Ask a
   question. **Press "Ask a question"** (safe — it only types): the box fills with "A question: " and
   nothing is sent. Clear the box. Do **not** press Approve or Send back: they are the same call the
   buttons are.
10. In the right-hand Properties panel, find **Behind the scenes** and open **"What Nova sees"**. It
    loads the last turn and shows who the model was told it is, the brief, the standing instructions,
    what it was asked this turn, and the conversation it was given. On a task that has never had a
    turn it says "Nothing yet — this task has not had a turn." It is read-only throughout.
11. Narrow the window under **720px**. The turn bar **sticks to the top** as the page scrolls; the
    tabs become a **segmented control** (one rounded strip, the current tab filled, no underline);
    the chips **scroll sideways** instead of wrapping. One column throughout.
12. Nowhere on any of those screens should the words *issue, disposition, handoff, run, wake,
    heartbeat, prompt, system message* or *token* appear, and no reply should be labelled "AI".
13. Open a task whose plan was approved (the conversation task, **TAM-1**) and click **Plan**. Each
    task line now ends with where it stands — To do, In progress, Done, Blocked or Queued — matching
    the Tasks list on the left. A plan still waiting for a yes shows tick boxes and no status words.
14. Open a task that is already **done** and has an output. It opens on **Deliverable**, not on
    Conversation, every time.

**Steps 11–30: what Jira and Azure DevOps do that the task view should too.** Approved for the queue on 2026-09-11. Build in three groups after step 10; the six starred items go first.

*Reading the task*
11. Description as a real editor: headings, checklists, pasted images.
12. ★ Acceptance criteria as their own field, checkable one by one; the reviewer reads exactly this list (it becomes the feature's done-when for that task).
13. Attachments panel with previews.
14. Related tasks panel: blocks, is blocked by, relates to, duplicates.
15. Parent and children as a tree with "2 of 5 done" on the parent.

*Following what happened*
16. History tab separate from comments: every field change with who and when, filterable.
17. Watchers: follow a task you don't own and get its Inbox items.
18. ★ Time in state: "In progress for 3 days" on the card and in the sidebar.
19. ★ Resolution reason on close: done, won't do, duplicate, cannot reproduce.
20. Reopen with a reason, which reopens the parent too.

*Acting on it*
21. ★ Inline edit of every sidebar field: assignee, priority, goal, project, due date.
22. ★ Due date and a "due soon" flag the busy timer and the Inbox respect.
23. Estimate field (T-shirt size) so the plan card shows total size.
24. Clone, and create a sub-task from here, prefilled from the parent.
25. Move to another project or organization from the sidebar.
26. Bulk actions from the list: accept five outputs at once, cancel a feature's remaining tasks.

*Talking about it*
27. ★ @mention that notifies, people and agents, with the Inbox row it created.
28. Quote-reply and threads on a comment, so a send-back note sits under the reply it answers.
29. Reactions instead of "thanks" comments (keeps the model's context clean).
30. Share link that opens the exact tab, comment, or version.

*From the same review, outside the task view (own waves):* the Board as its own Work-menu entry; a ranked backlog the agents respect; automation rules shown and editable in Settings; saved views ("My turn", "Stuck more than a day", "Failed review twice"); tasks linked to their branch and PR once code tasks exist.

**Rules for tone.** The person's words are never rewritten. Agent replies are never labelled "AI". System lines are grey and short. Nothing user-visible says issue, disposition, handoff, run, or wake.

**Tests.** `turnSentence` for every state; cluster collapsing; verdict card rendering; chips change with state; the deliverable tab defaults once handed in; phone layout snapshot.

**Dependencies.** Steps 1, 2, 4, 5, 8, 9, 10 need nothing new. Step 3 needs the output document (wave C, shipped). Step 6 needs the goals wave (D). Step 7 needs the judge wave (E).

### Wave J: Hardening

Shipped on branch `hardening-wave` (2026-09-11), built by four sessions and landed together. No
schema change, no migration; every backfill and marker uses a column that already existed.

**A. Timer backfill — shipped.** `server/src/todero/startup-backfills.ts` gives every chat-only
conversational agent whose timer is off the wave-F defaults (on, 120 s, one at a time, skip when
there is nothing to do), keeps `cooldownSec`, and stamps `runtimeConfig.heartbeat.toderoBackfilledAt`
so it never re-applies once a person turns the timer off. Archived and paused organizations are
skipped. One log line per organization that changed, plus a total. Embedded-Postgres tests cover the
backfill, the already-on agent, idempotency, `cooldownSec`, the archived organization, the paused
organization, a stamped agent whose timer is off, and an agent hired today whose timer a person
turned off afterwards.

The stamp only separates "never configured" from "turned off on purpose" if every agent hired after
wave F carries it from the start — the hire flow already sends `heartbeat.enabled: true`, so without
that an agent hired today would look legacy the moment a person switched its timer off, and the next
start would switch it back on. `server/src/todero/timer-backfill-stamp.ts` holds the stamp, and
`normalizeRuntimeConfigForNewAgent` in `services/agents.ts` applies it at creation to exactly the
population the backfill looks at (chat-only http agents) and to nothing else.

**B. Backlog-to-To do backfill — shipped.** Same module. Every Backlog child whose parent carries a
plan and which has an agent moves to To do; blockers are untouched, so the chain still holds order.
The parent conversation task is stamped with `<!-- todero-backlog-backfill: done -->` in its own
description (the marker device this codebase already uses; no new column), so a second start changes
nothing and a person can park a child in Backlog on purpose afterwards. Tests cover the move, a
chain of two children (both move, and the same readiness check the wake path uses says only the
unblocked one can start), an unrelated Backlog task, a second start, an archived organization, a
paused organization, and parking after the first pass.

**C. Double wake — shipped.** `decideSuccessfulRunHandoff` skips a conversational turn whose outcome
was already applied. The builder left only the reader; the writer is
`server/src/todero/conversation-disposition-applied.ts`, called from the conversation-outcome block
in `heartbeat.ts` the moment the reply's own disposition is applied. It stamps the stored run and
the in-memory row the handoff decision reads, so a later recovery sweep reaches the same answer.

**D. Drift-safe startup — shipped.** `server/src/todero/schema-drift-check.ts` compares every Drizzle
table with `information_schema.columns` after migrations and warns per table: extra columns (NOT NULL
without a default flagged as "inserts will fail"), and columns the code expects that are missing. One
clean line when there is nothing to say. Never alters anything; wrapped so it cannot block startup.
Fixed from the builder's version: it compared Drizzle's TypeScript property names (camelCase) with
database column names (snake_case), so every real database would have reported total drift. The test
now asserts that a freshly migrated database is clean, which is what caught it. A second fix: an
extra *nullable* column left `issuesFound` false, and the startup logger prints nothing at all in
that case — a database whose only drift was one unexpected nullable column reported clean and the
column was never shown. Any extra column now counts, with a test for the nullable-only case.

**E. Flaky tests on Windows — shipped, no skips.**
- E1 `vault-settings.test.ts`: fixed at the cause. `vault-settings.ts` opened the settings SQLite
  file on every read and write and never closed it — a leaked handle per call in production, and on
  Windows a lock on the settings folder, which is what made the teardown's `rmSync` fail with EPERM.
  Both paths close their handle now and the teardown is a plain removal again, so a future leak
  shows up instead of being swallowed. 9/9 here.
- E2 the symlink failures were in `packages/shared/src/worktree-seed-source.test.ts` (the server
  spawn test already passed). They now try a real symlink and fall back to a junction, decided at
  runtime by catching EPERM, not by checking the platform. 8/8, nothing skipped.
  `scripts/provision-worktree.sh` got the same fallback.
- E3 `CompanySettings.test.tsx`: the missing `deleteBlastRadius` / `secretRefs` mocks were the render
  churn behind the timeout. 4/4.
- E4 `heartbeat-paused-company-guard.test.ts`: the quiesce loop now waits for wakes that are
  *claimed* (in flight, no run row yet). The builder waited for *queued* wakes, which never drain in
  that file because the loop pauses every organization first — it hung the whole 30 s budget and
  failed the next test. 3/3 in 13 s, no CONNECTION_ENDED output.

**F. Automated hires respect board approval — shipped (not delivered by its builder).**
`server/src/todero/plan-hire-approval.ts` plus the check inside `hireForPlan`: when the organization
sets `requireBoardApprovalForNewAgents`, the reviewer and the second worker are created
`pending_approval` and paired with a `hire_agent` approval, exactly as a person's own hire is. A
teammate waiting on approval is given no work — the first agent keeps all of it — and the task gets
one short line: "<name> waits for your approval in the Inbox before starting." Unchanged when the
setting is off. Tests for on, off, and the wording.

**G. Available models list — shipped (re-implemented).** `server/src/todero/available-models.ts`
stores the model ids in the organization's `interactionResolverGovernance` and reads them back for
the run context, so `model-routing.ts` finally has something to rank. Written when a connection test
passes and the caller names the organization (the wizard now does), and looked up once from the
runtime for an organization hired before this existed. The builder's version called a `db.query(...)`
API that does not exist in this codebase and would have thrown on every conversational run, and
nothing ever wrote the list.

**H. Approve handler split — shipped.** `server/src/todero/plan-approval.ts` holds
`selectApprovedPlanTasks`, `buildPlanFeatureGoalDrafts`, `createPlanChildren`, `hireForPlan` and
`wakeReadyChildren`; `todero-plan-routes.ts` is a 130-line handler. Fixed from the builder's version:
it imported `goalService` from `services/goal-completion.js`, which does not export it — every
approve returned 500 and seven route tests failed.

**I. Plan document noise — shipped.** The task page asks for the plan only for a task that can carry
one (no parent, the plan-pending marker, or a plan already cached), so a child task no longer 404s
every ten seconds. `IssueDetail.test.tsx` covers all four cases: a child asks for nothing, the
conversation task asks, a child still waiting for a plan asks, and a child whose plan is already in
hand keeps asking.

**J. `resolveCanonicalWorktreeSeedSource` failed open on Windows — fixed.** With `.todero` as a
regular file, Windows reports ENOENT for the path underneath it where POSIX reports ENOTDIR, so the
resolver read the workspace as a plain checkout and seeded this worktree from whatever other
instance the caller happened to name. It now decides on the `.todero` entry itself — a `.todero`
that is not a directory (or a symlink to something that is not one) cannot hold a config, which is
drift, not absence — so it fails closed on both platforms and the regression test runs everywhere.

**Open.**
- Live verification (restart against the real database, a throwaway organization through
  plan → approve → chained tasks → judge → accept on Ollama) has not been run.

### Wave K: Polish

No new behavior — this wave only changes what the screens say and how they read. Two builders
(`polish-ui`, `polish-server-copy`) were landed on one branch, plus the integration fixes below.

**The task page (`IssueDetail`).** On a phone the task's details were reachable only from the "…"
menu. There is now an "i" button in the title bar that opens the same details drawer in one tap.

**The task page — the work item card.** The card had been built against its own private dark palette
and pulled a font off the internet, so it stayed dark while the rest of the app was light and it
looked like a different product. It now uses the app's own colors and fonts and follows the theme.
The stamp and the approve button had ended up with near-black text on a saturated blue; text on a
solid status color is now a near-white partner token, so those read in both themes.

**The task page — the "this task needs a decision" notice.** The notice used to say "Todero needs a
disposition before this issue can continue." It now says "Todero needs you to choose what happens
next before this task can continue," titled "Needs next step". The escalation notice says Todero
could not decide on its own, that nothing has changed, and that it needs your decision.

The details inside that notice were the densest jargon in the product, and they were what the person
read when deciding. Every label is now plain: "Required action" → "What to do", "Run evidence" →
"What happened", "Source issue" → "Task", "Assignee" → "Assigned to", "Missing disposition" →
"What's missing" (and the value is words, "a clear next step", not the stored key `clear_next_step`),
"Valid dispositions" → "Your options", spelled out as the choices a person actually has. On the
escalation notice: "Recovery" → "What Todero tried", "Recovery owner" → "Picked up by", "Source run"
→ "The turn", "Corrective handoff run" → "Todero's retry", "Latest issue status" → "Task is now".

**The task thread — recovery comments.** When Todero gives up retrying, its comment used to say it
"cannot safely continue automatic recovery because the original assignee is not invokable." The two
reasons Todero gives up are different things to do something about, so they read differently: it
either "couldn't reach the agent assigned to this task" or the task "hit its spending limit before
finishing". Both then say nothing was reassigned, and name the choices.

**Attention queue.** A decision whose task link is missing said "Missing issue reference for this
decision"; it now says "This decision is missing a link to its task."

**Cancel confirmation (decision card).** The confirmation said it would cancel an "issue tree" and
counted "issues". It now says task, sub-task and task tree, matching the rest of the product.

**Paused organization card.** The button next to a queued task said "Skip". It permanently cancels
the task, so it now says "Cancel" and names what it does.

**Recent activity.** Marking a task read or unread produced a row with no label, so the feed fell
back to the raw event name. Those two rows now read "marked as read" / "marked as unread".

**Properties panel.** Both close buttons were icon-only with no accessible name; a screen reader
announced "button". Both now say "Close properties panel".

**Integration fixes — what the builders left broken.**
- The rewritten notice text is matched as literal text in three places neither builder updated. The
  "post this notice once" guard in `heartbeat.ts` matches saved comment bodies in SQL, and the UI
  mirrors both strings in `ui/src/lib/successful-run-handoff.ts` to avoid printing the notice twice
  in a thread. Changing the wording without those would have put a second, duplicate notice on every
  task that already carried one. Both now match the new wording and keep matching the old, which is
  what existing organizations have saved.
- `successful-run-handoff.test.ts` asserted the old notice title and would have failed on `main`;
  the UI builder never ran the server suite.
- The two builders rewrote the same two strings differently. The plainer pair was kept.
- `"Recovery action"` looks like a label but is a lookup key — `noticeMetadataReferencesRecoveryAction`
  matches on it against metadata already saved. It was deliberately left alone and is commented so.

### Wave K, review pass

A review of the branch found the wave had stopped halfway on several screens: a rewritten dialog
whose confirm button still carried the old word, two different failures collapsed into one identical
sentence, a raw `successful_run_missing_state` printed to the owner, and a set of chosen findings
that were never implemented at all. This pass closes them.

**Cancel confirmation (decision card) — finished.** Only the dialog copy had been changed; the
button the owner actually clicks still said "Cancel 3 issues", and the preview line above it and the
history line afterwards both still counted "issues". The whole cancel-tree path — preview, confirm
button, result — now says task. So does the rest of the card: "Create task", "a referenced task no
longer exists", "A target task was cancelled", "Dismissed — nothing was changed", "view turn".

**The task thread — why Todero stopped.** The rewrite had given the unreachable-agent case and the
over-budget case the same sentence, so the thread no longer said which had happened. They are two
sentences again (above).

**The notice details — "Cause".** The row still printed the stored key,
`Cause: successful_run_missing_state`. It now reads "the turn finished, but never said what happens
next", the same way "What's missing" already renders words instead of `clear_next_step`. The stored
key is unchanged everywhere it is actually used as a key.

**The recovery card (task page).** The badge beside "RECOVERY NEEDED" literally said "Missing
Disposition"; the others were "Workspace Validation", "Active Watchdog". They now say "Needs next
step", "Files not ready", "Watching for a stall", "Waiting on nothing", "Stuck with its owner",
"Setup incomplete". The rows below say "The turn" and "Todero's retry" rather than "Source run" and
"Corrective run", "Picked up by" rather than "Recovery owner", and a turn chip reads `turn 7accd7a4`.

**Dashboard — the agent cards.** The section was headed "AGENTS" and showed four cards that are
often one agent taking four turns at the same task, which contradicted "Agents Enabled: 1" two rows
above. It is now headed "Latest agent turns", and when the same task appears on more than one card
each says "Turn 2 of 4 on this task".

**Dashboard — charts and activity.** "Run Activity" is now "Agent Activity". Each chart carries a
spoken summary for a screen reader ("Tasks by status, last 14 days: 6 In Progress, 2 Done"), and the
"Last 14 days" subtitle was too faint to read — it now uses the normal muted colour. Recent Activity
dropped the tier-3 bookkeeping rows (read/unread, archive, cost) that the activity feed already
hides, so ten rows are ten things worth seeing.

**Sidebar — "Pause everything".** The two buttons sat side by side and did not fit: "Resume
everything" clipped to "Resu" at the sidebar's real width. They are stacked.

**Goals.** The tier beside a goal printed the raw value "company"; it says "Organization", matching
Settings. On a phone the title no longer truncates behind it — the tier sits on its own line above.

**Inbox and the blocked notice.** "Failed run" is "A turn failed" (and the group and filter say
"Failed turns"); "A correction run is in progress" is "Todero is fixing this now"; a linked turn
reads `turn 87654321`.

**Accessibility.** Every property picker on the task page names itself from its field label, so a
screen reader hears "Status, Todo" instead of "Todo", and the phone's inline picker reports whether
it is open. In Settings, the organization name, description and logo fields are properly tied to
their labels, text inputs show a focus ring when tabbed to, each "?" button says what it explains,
and every toggle announces the setting it switches. The reply box and the "what should change?" box
on a task have names.

**Open.**
- `stranded-notice.ts` builds a parallel notice with the same jargon ("Recovery owner", "Board
  decision required"). Out of scope here; it still reads like internals.
- `ui/src/fixtures/systemNoticeFixtures.ts` and `SystemNoticeUxLab.tsx` still carry the old wording.
  They only feed the internal notice-preview page, so nothing a customer sees.
- The `nextAction` text the server stores on a recovery action ("Choose and record a valid issue
  disposition.") is still shown verbatim on the recovery card. It is stored data, not a label, so
  changing it is a data-migration question rather than a copy change.
- No test asserts that a comment carrying the *old* notice wording is still deduped. The guarantee
  rests on `LEGACY_SUCCESSFUL_RUN_HANDOFF_REQUIRED_NOTICE_BODY` being in both the SQL guard and the
  UI matcher. Worth a regression test before merge.
- Not run on this machine: e2e, storybook visual, and the full server suite (`session_gates.md`
  documents why). The required and touched suites were run.

### Wave: the first agent becomes the manager

**Today.** The first agent plans and does every task. Waves D-F add a reviewer and, when many tasks
are ready, a second worker, both hired by Todero's rules. Assignment is by rule too. There is no
agent that manages.

**Goal.** Once an organization has more than one worker, the first agent stops doing tasks and
manages: plans, assigns, reads verdicts, handles send-backs, writes the wrap-up, proposes what is
next. Workers do tasks. The reviewer judges. Todero's rules still decide *when* to hire; the manager
decides *who does what*.

**Roles, using what exists.** Agents already carry `role` (the first is `ceo`) and a reporting line.
Workers are hired with role `worker` reporting to the manager; the reviewer with role `reviewer`
reporting to the manager. The Org page shows the tree with no changes.

**What changes when the manager mode switches on.** The switch is automatic: the moment the
organization has two or more workers (or one worker plus the manager, when wave F hires the second
agent). Before that, the lead is a do-all as today.

1. **Assignment.** On plan approval the manager assigns each feature's tasks to a worker. Rule of
   thumb it is told: keep one feature with one worker; balance by count; if only one worker exists,
   that worker takes all. Implemented as the manager's own reply in a fixed shape (`assignments:`
   lines) parsed like the plan block, falling back to Todero's rule when the shape is missing. No
   tools needed.
2. **Send-backs.** A task the reviewer failed twice, or the person sent back, goes to the manager
   first: it rewrites the brief in one paragraph ("What to change") and re-assigns. Implemented as a
   turn of the manager on that task with a turn instruction; its reply's paragraph is stored as the
   task's `guidance` document and the worker is brought back.
3. **Verdict reading.** After every reviewer pass, the manager gets a one-line summary appended to
   the conversation task, no turn. After every reviewer fail, the send-back flow above.
4. **Wrap-up and next.** Unchanged from wave C and G: the manager writes them; workers never do.
5. **Person's questions.** Anything the person types on the conversation task goes to the manager;
   anything typed on a worker's task goes to that worker; the manager is copied with a one-line note.

**What the manager never does in this wave.** Hire (Todero's rules do), change budgets, or edit the
plan without the person approving the new block.

**UI.** The Agents page groups by role: Manager, Workers, Reviewer. Each task shows "Assigned by
Nova" under the assignee when the manager assigned it. The conversation task's sidebar lists the
team with a count of open tasks per worker.

**Tests.** The assignments-shape parser; the fallback to the rule; the send-back path stores guidance
and wakes the right worker; the manager never receives a plan child task while workers exist.

**Size.** Two days. Depends on waves E and F being merged (they are).

**Out of scope.** Multiple managers; a manager that hires; performance reviews of workers (a later
"team health" wave could use the reviewer's pass/fail history).

#### What shipped

Merged from three branches (`manager-core` at `adb8c26a`, `manager-sendbacks`, `manager-roles-ui`)
onto one, then finished where the branches stopped short.

**Roles.** `worker` and `reviewer` joined `AGENT_ROLES` with labels. The reviewer is hired with role
`reviewer` reporting to the manager (`judge-agent.ts`); the second agent wave F adds is hired with
role `worker` reporting to the manager (`plan-approval.ts`). No schema change: `role` and
`reports_to` already existed. `listWorkers` leaves out a teammate still waiting for a person's yes,
so the manager never hands work to an agent that cannot do it.

**The fixed shapes.** `packages/shared/src/todero-assignments.ts` parses an `assignments:` block the
way the plan block is parsed - fenced or bare, task short-name or title, any capitals, unknown lines
ignored. `server/src/todero/manager-wave.ts` holds the rest of the pure half: the rule Todero falls
back to (`assignTasksByRule` - one feature with one worker, next feature to the lighter one, one
worker takes all), the per-task resolution of the manager's reply (`resolveManagerAssignments`), and
every line the wave writes.

**Assignment, end to end.** On plan approval the route reads the team, and `createPlanChildren`
shares the plan out across workers by the rule - the manager is never given a task of its own. The
tasks are *not* started yet; instead the manager gets one turn on the conversation task listing the
tasks (with their feature) and the team (with how much each is carrying), and asking for the
`assignments:` shape. Its reply is applied in `applyManagerAssignmentReply`: anything it named moves
and is stamped `<!-- todero-assigned-by: ... -->`, anything it forgot or mis-named keeps the rule's
worker, one comment on the conversation task says who has what, and only then are the tasks nothing
is holding up started, on their final worker. If the manager's turn cannot even be queued, the tasks
start on the rule's sharing-out instead of sitting still.

**Send-backs, end to end.** The reviewer's second fail routes to the manager (`judge-apply.ts`), and
a person's send-back does too (`manager-person-comment.ts`, from the comments route). In both cases
the task is handed to the manager and marked
`<!-- todero-waiting-for-manager-sendback: WORKER-ID -->` - the marker remembers whose task it was.
The manager's reply is consumed by `applyManagerGuidanceReply`: the paragraph becomes the task's
`guidance` document *and* is said on the task (the worker is chat-only, so the thread is its only
memory), the task goes back to To do with the remembered worker - or to whoever the manager named in
an `assignments:` block - and that worker is brought back. A reply with no usable paragraph still
hands the task back; the wave never leaves a task parked on the manager.

**Verdict reading.** After every reviewer verdict on a plan task, one line is posted on the
conversation task by the reviewer: "ZZW-1 - Draft the guide: the reviewer passed it." or "... sent it
back." A second send-back says "... sent it back again; Nova is rewriting the brief." Nobody is
brought back for it.

**Person's questions.** A person writing on a worker's task leaves that task with the worker and
copies the conversation task with "The person wrote on ZZW-2 - List the prices." A person writing on
a task that was waiting for them to accept is a send-back and goes to the manager first. Writing on
the conversation task is unchanged - the manager already owns it.

**UI.** The Agents page list groups by Manager / Workers / Reviewer / Team with per-group counts. A
task shows "Assigned by Nova" under the assignee when the marker is there. The conversation task's
sidebar grows a Team section - manager, each worker with its open count, reviewer - and it appears
only once the organization actually has a worker. The three new description markers are stripped
from the task body, so none of them is ever read by a person.

#### Fixed during integration

- **The send-back turn would have been cancelled before it ran.** The branch brought the manager back
  on a task still assigned to the worker, and Todero cancels a queued turn whose agent does not own
  the task (`issue_assignee_changed`). The manager now holds the task while it rewrites the brief,
  and the marker carries the worker's id so the task goes straight back.
- **The server did not typecheck** on `manager-sendbacks` (five errors across `judge-apply.ts`,
  `heartbeat.ts` and `judge-apply.test.ts`).
- **Nothing consumed the manager's replies.** Both the assignment turn and the guidance turn would
  have fallen through to the ordinary reply handling and put the conversation in front of the person
  for a turn nobody asked for.
- **`isManagerMode` counted wrongly** (it read a row's id as a count) and counted teammates still
  waiting for approval.
- **The new markers leaked into the task body** in the UI.
- **The Team sidebar showed on every parent task**, listing a team of one, before manager mode was on.

#### Fixed after the live check (2026-09-11)

- **The manager was never recognised.** The wizard files the first agent as `general`, not `ceo`,
  so `getManager` found nobody and manager mode never switched on in a real organization. The
  manager is now the `ceo` if there is one, otherwise the oldest agent that reports to nobody and is
  not a worker or a reviewer (`pickManagerFromRoster`); the role backfill uses the same rule.
- **A worker's hand-in reached no reviewer.** The reviewer is hired for the lead, so a hand-in by a
  worker found no reviewer and was never judged. `findJudgeAgentForHandIn` looks it up through the
  manager when nothing was hired for the worker itself.
- **A status line in backticks read as a question.** The instruction shows `` `STATUS: done` `` in
  backticks and qwen2.5-coder copies them; the parser only tolerated asterisks, so such a hand-in
  waited on the person instead of the reviewer. Backticks are now decoration like asterisks.

Live on Ollama qwen2.5-coder:14b (throwaway organization, one worker hired by API): every plan
child went to the worker, none to the manager; each hand-in got the reviewer's verdict and one line
on the conversation task ("… the reviewer passed it."); a person's send-back produced the manager's
`guidance` document and the task went back to the worker; the person's note on a worker task was
echoed to the conversation task in one line.

#### Open

- **A person's send-back is two API calls** (status to To do, then the note). The first starts the
  worker before the note arrives; the second hands the task to the manager, which cancels that queued
  turn. If the worker's turn has already started, its hand-in can land on top of the manager's. Worth
  collapsing into one call.
- `applyManagerAssignments` / `applyRuleBasedAssignments` in `manager-assignment.ts` are the strict,
  all-or-nothing variants from the core branch. Production uses the per-task tolerant
  `resolveManagerAssignments` instead; the strict pair is still covered by its own tests but is not
  called. Delete or fold together in the next pass.
- The manager is not told what the *reviewer* said on a second fail beyond the reviewer's own note
  riding along in the turn's context. It does not read the task's Output document.
- No end-to-end test drives the whole loop against a live model; the live-verification steps below
  are the check.
- Not run on this machine: e2e, storybook visual, and the full server suite. The required and touched
  suites were run.

#### Live verification on this machine

Ollama with `qwen2.5-coder:14b`, one model at a time. Parallelism is 1, so Todero's own rules will
**not** hire a second worker - `decideExtraWorker` sees no spare capacity. The check therefore hires
the second worker by API before the plan is approved, which is what switches manager mode on.

Set up once:

```sh
export TODERO=http://127.0.0.1:4000
export KEY=<board API key>     # header: Authorization: Bearer $KEY
```

1. **Hire the first agent through the wizard** (Ollama, `qwen2.5-coder:14b`) and let the connection
   test pass. Start a mission and answer its questions until it proposes a plan with **two features
   and at least three tasks** - two features is what makes the assignment interesting.

2. **Read the first agent and the organization.**
   - `GET /api/companies` -> `companyId`
   - `GET /api/companies/{companyId}/agents` -> the first agent (the wizard files it as `general`; a `ceo` wins if one exists); keep its `id`,
     `adapterType` (`http`), `adapterConfig` and `runtimeConfig`.
   - `GET /api/companies/{companyId}/issues` -> the conversation task's `id`.

3. **Hire the second worker by API, before approving.** Copy the first agent's connection verbatim:

   ```sh
   curl -X POST $TODERO/api/companies/$COMPANY/agents \
     -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"name":"Ash 2","role":"worker","reportsTo":"FIRST-AGENT-ID",
          "adapterType":"http","adapterConfig":{ copied verbatim },
          "runtimeConfig":{ copied verbatim }}'
   ```

   Check `GET /api/companies/{companyId}/agents` shows it with `status: "idle"` (not
   `pending_approval`) and `role: "worker"`. **Manager mode is now on.**

4. **Approve the plan.**
   `POST /api/issues/{conversationIssueId}/plan/approve` with `{"keep":[]}`.
   The response carries the children. Immediately after:
   - `GET /api/companies/{companyId}/issues?parentId={conversationIssueId}` - **every child is
     assigned to "Ash 2", none to the manager.** That is the rule's sharing-out.
   - No child is In progress yet: the manager's assignment turn runs first.

5. **Watch the manager's assignment reply.**
   - `GET /api/issues/{conversationIssueId}/comments` - the manager's turn ends with a comment
     listing "ZZW-1 - TITLE -> Ash 2" for each task.
   - `GET /api/companies/{companyId}/agents/{managerId}/runs` (or the Agent page) - the reply text
     should contain an `assignments:` block. If it does not, the comment says "shared out by the
     usual rule" and the tasks still start - that is the fallback working, not a failure.
   - The children now show one of them In progress with its worker.
   - In the UI, open a child: "Assigned by MANAGER-NAME" sits under the assignee when the manager
     named it. Open the conversation task: the sidebar's **Team** section lists the manager, "Ash 2"
     with its open count, and the reviewer.

6. **Watch a reviewer verdict reach the conversation task.** Let one child finish.
   `GET /api/issues/{conversationIssueId}/comments` gains one line:
   "ZZW-1 - TITLE: the reviewer passed it." (or "... sent it back."). No turn was spent on it.

7. **Drive the send-back path (the person sends one task back).** Take a child that is waiting on you
   to accept (its work-item view offers Accept / Send back):

   ```sh
   curl -X PATCH $TODERO/api/issues/$CHILD -H "Authorization: Bearer $KEY" \
     -H 'Content-Type: application/json' -d '{"status":"todo"}'
   curl -X POST $TODERO/api/issues/$CHILD/comments -H "Authorization: Bearer $KEY" \
     -H 'Content-Type: application/json' \
     -d '{"body":"The prices are out of date - lead with the price table."}'
   ```

   Then check, in order:
   - `GET /api/issues/{conversationIssueId}/comments` - one line "The person wrote on ZZW-2 - TITLE."
   - `GET /api/issues/{child}` - `assigneeAgentId` is the **manager** and the description carries
     `todero-waiting-for-manager-sendback`.
   - After the manager's turn: `GET /api/issues/{child}/documents` contains a **`guidance`** document
     titled "What to change" holding one paragraph.
   - `GET /api/issues/{child}/comments` - the manager said the same paragraph on the task.
   - `GET /api/issues/{child}` - back to `todo`, `assigneeAgentId` is **"Ash 2"** again (or whoever
     the manager named in an `assignments:` block).
   - `GET /api/companies/{companyId}/agents/{workerId}/runs` - the worker took a turn on it.

8. **Reviewer's second fail** (optional, harder to force): let the same task fail the reviewer twice.
   The conversation task gains "... sent it back again; MANAGER is rewriting the brief.", and the
   same guidance-then-worker sequence as step 7 follows.

API calls used, in order: `GET /api/companies`, `GET /api/companies/{id}/agents`,
`GET /api/companies/{id}/issues`, `POST /api/companies/{id}/agents`,
`POST /api/issues/{id}/plan/approve`, `GET /api/companies/{id}/issues?parentId=...`,
`GET /api/issues/{id}/comments`, `GET /api/issues/{id}`, `GET /api/issues/{id}/documents`,
`PATCH /api/issues/{id}`, `POST /api/issues/{id}/comments`,
`GET /api/companies/{id}/agents/{agentId}/runs`. No route was added by this wave, so
`server/src/routes/openapi.ts` is unchanged.

### Wave: the skill pack

**Goal.** The ten skills in `skills/todero-*/SKILL.md` reach the local model only for the kind of
turn each applies to, the person can read and edit each one per organization and turn it on or off
per agent, and the agent keeps its brief, its skills and its hand-ins in a folder beside its
instructions.

**Where the files live.**

- **In the repo,** beside the five that already exist: `skills/todero-plan-a-project/SKILL.md` and
  its nine siblings. Same format as the open spec: a folder whose name equals the frontmatter name,
  with `SKILL.md` inside. No `scripts/`, `references/` or `assets/` - the local model cannot open a
  second file, so everything a skill says is in the body.
- **Per organization,** copied into the managed skills root Todero already uses on the first pass
  that touches the Skills page: `{instance}/skills/{companyId}/{name}/SKILL.md`, registered with
  `upsertImportedSkills`, so each one gets a row, a version history, and a card. The copy is what the
  person edits; the repo file is the reset target.
- **Next to the agent,** in a folder beside the instructions bundle `resolveManagedInstructionsRoot`
  already builds: `{instance}/companies/{companyId}/agents/{agentId}/` gains `brief.md` (the agent's
  one-paragraph brief and the files it reads), `skills/` (a copy of each skill turned on for this
  agent), and `documents/` (what it has produced). The model has no tools and cannot write a file, so
  Todero writes it: the hand-in branch in `server/src/services/heartbeat.ts` that already saves a
  deliverable as the task's Output document also drops a dated copy into `documents/`.
- **On the Skills page** the ten appear in their own group, "What your agent knows", separate from
  the command-line skills.

**How the text reaches the model.** Four places, no new plumbing:

1. `resolveToderoTaskKind` (`server/src/todero/model-routing.ts`) already labels every turn
   planning, drafting or wrap-up, and this wave does not touch it. The judging kind is out of band
   and handled by step 4.
2. The conversational block in `server/src/services/heartbeat.ts` also sets `context.toderoSkillText`
   from `loadAgentSkillText({ agent, kind, companySkills })`, which keeps only the skills turned on
   for this agent whose `todero-task-kinds` names this kind.
3. `buildChatCompletionsMessages` (`server/src/adapters/http/chat-completions.ts`) puts that text in
   as a second system message, straight after the identity prompt and before the task. Order is
   deliberate: who you are, what you know, what you are doing, the conversation, then
   `toderoTurnInstruction` last as today.
4. The reviewer does not go through that path: its skill is appended inside `buildJudgeSystemPrompt`
   in `server/src/todero/judge.ts`, which stays the reviewer's only brief.

**Which skill loads when.** Planning turns get 1 (`todero-plan-a-project`), 2 (`todero-when-to-hire`),
3 (`todero-hand-off-a-task`), 5 (`todero-ask-or-decide`), 9 (`todero-cost-and-time`); drafting gets
3, 5, 6 (`todero-files-with-the-work`); judging gets 4 (`todero-review-against-done-when`); wrap-up
gets 6, 7 (`todero-propose-a-skill`), 8 (`todero-retrospective`). Number 10
(`todero-talk-like-a-colleague`) loads on every turn the agent itself takes - the reviewer is out of
band and reads only the skill that names judging, so it is handed one rubric and not two. There is a
ceiling: when the pack is over it, the lowest-priority skills for that kind are dropped and a line is
written to the run log, because a 7B model that reads four rubrics follows none of them. The
frontmatter carries `todero-task-kinds` and `todero-priority` (1 highest).

#### What shipped (code half)

- **One loader, `server/src/todero/skill-pack.ts`.** Reads the pack facts off the stored skill
  metadata - no new column, no migration. `parseSkillPackKinds` accepts every shape the repo's
  frontmatter parser produces: a real array, the flow-list string `"[a, b]"`, `"a, b"`, a single
  kind, or `"all"`. `loadAgentSkillText` reads the **organization's own rows**, so an edit a person
  makes takes effect on the next turn with no restart.
- **The ceiling is 20,000 characters**, which carries the whole pack for the busiest kind (a planning
  turn reads six of the ten) and still bites once an organization adds long skills of its own. Over
  it, the reading stops where the budget runs out: the skill that did not fit and everything below it
  in priority order sit the turn out together, and the run log names them. The stop is deliberate -
  trying the next one instead would let a one-line low-priority skill in ahead of the long
  high-priority skill it displaced, which is the opposite of what the priority field is for.
- **Per-organization copies**, `ensureSkillPackCopies` in `server/src/services/company-skills.ts`,
  run on the same pass that mounts the bundled skills. Each copy is a normal editable managed-local
  skill with a version history. The ten are no longer mounted read-only from the checkout, so a
  person's edit survives the next pull.
- **Their own group.** `toderoBundledFolderCategory` keys off the skill's own frontmatter rather than
  its key, so the copy lands in the same group as the file it came from; the group reads
  "What your agent knows".
- **Reset to the original**: `POST /api/companies/{companyId}/skills/{skillId}/reset-to-original`
  writes the shipped text back, stores `last_changed_because: Reset to the original` in the skill's
  frontmatter, and adds a version row labelled the same way. Registered in `openapi.ts`.
- **Injection**, `buildChatCompletionsMessages`: a second system message between the identity and the
  task, present only when something is turned on. The same change fixed a latent bug - the
  same-side-collapse guard was the literal `messages.length > 2`, which assumed exactly two leading
  messages and would have folded the conversation's first turn into the task once a third one
  existed. It now counts the opening block.
- **The reviewer**: `buildJudgeSystemPrompt` takes the judging skill and nothing else. The reviewer is
  hired with a copy of the lead's settings, so everything the lead has turned on is turned on for it
  too; `skillPackAppliesToKind` treats judging as out of band, so a skill written for every turn stops
  at the agent's own turns and never becomes a second rubric for a model that was asked for a verdict.
- **The agent's folder**, `server/src/todero/agent-folder.ts`: `brief.md` and `skills/` written at
  hire and refreshed on each conversational turn (idempotent - a second run with the same inputs
  writes nothing); `documents/` gets a dated copy of every hand-in, beside the Output document.
  `GET /api/companies/{companyId}/agents/{agentId}/folder` reads it back; the agent page gained a
  **Files** tab.
- **Hiring turns the pack on.** A chat-only local agent is hired with every pack skill in its desired
  set. Agents on adapters that bring their own tooling are untouched.
- **Two lines moved out of code into skills.** The "at most three questions" line left
  `ui/src/lib/onboarding-first-task.ts` for skill 5; the tone clause left
  `buildChatCompletionsSystemPrompt` for skill 10. The system prompt keeps the identity and the
  STATUS contract.

#### Open

- **The proposal card and the proposal block parser** - the next half.
- **The retrospective turn** - the next half.
- **Approving an edit with a because-line** - the next half. Today the because-line is written by a
  reset; a person's own edit does not yet prompt for one.
- **Version and "Last changed because" on the skill row.** The pack group and the ten editable rows
  are there, but the card does not yet show the version number or the because-line, and the
  "Reset to the original" button is not wired to the route. `CompanySkillListItem` carries no
  `metadata`, so surfacing the because-line needs a field added to the list response.
- **An organization created before this wave** keeps whatever read-only `nabitllc/todero/todero-*`
  rows it already had; nothing deletes them. A fresh organization is clean.
- **The folder is a read-only view.** The Files tab lists names and shows the brief; it does not open
  a hand-in or let anyone edit one there.

#### Fixed after the live check (2026-09-11)

- **The hire was refused on an ordinary installation.** Turning the pack on pinned each skill's
  version, and a pinned version is a beta-only feature ("Beta skill version pins require the Beta
  skills experimental setting"). The pack is now turned on unpinned; the agent follows the
  organization's current copy, which is what a person edits.
- **The whole pack did not fit the model's window.** Ollama serves qwen2.5-coder:14b with a
  4,096-token window unless the person raised it (`OLLAMA_CONTEXT_LENGTH` or a Modelfile), and the
  OpenAI-compatible endpoint cannot ask for more per request. Six planning skills were about 17,000
  characters, so the model lost the plan shape and answered in prose for four rounds. Now the
  connection test records the served window (`/api/ps`, stored as `toderoLocalLlmContextLength`),
  the ceiling is 35% of that window in characters (5,734 for 4,096 tokens, never above 20,000), and
  the "What Todero changed" sections, written for the person, are not sent to the model. On this
  machine a planning turn carries `todero-plan-a-project` and drops the rest, and the run log names
  what sat out. Raising the window to 16,384 lets the whole pack in; that is a setting on the
  person's runtime, so the wizard should say so (queued for the next half).

#### Live verification on this machine (Ollama, `qwen2.5-coder:14b`)

Run the server the usual way. `B=http://localhost:4000/api`, with the auth header the other waves
use; `$C` is the organization id and `$A` the hired agent's id.

1. **A fresh organization through the wizard.** Take the first-run wizard end to end with a new
   organization and a one-line mission. The connection test must pass before the hire, as the local
   LLM onboarding wave requires.

2. **Ten rows, turned on.** Open the organization's Skills page: a group named **"What your agent
   knows"** sits beside the command-line group and holds ten rows, each editable. Then the agent's
   Skills tab: all ten are turned on for it.

   ```
   curl -s "$B/companies/$C/skills" | jq -r '.[] | select(.key|startswith("company/")) | [.slug, .folderPath, .editable] | @tsv'
   curl -s "$B/agents/$A" | jq -r '.adapterConfig.toderoSkillSync.desiredSkills[]' | grep -c "^company/"
   ```

   Expect ten rows under "What your agent knows" with `editable: true`, and a count of `10`.

3. **The agent's folder.** `brief.md` plus ten files under `skills/`:

   ```
   ls ~/.todero/instances/default/companies/$C/agents/$A
   ls ~/.todero/instances/default/companies/$C/agents/$A/skills | wc -l
   curl -s "$B/companies/$C/agents/$A/folder" | jq '{brief:(.brief|length), skills:(.skills|length), documents:(.documents|length)}'
   ```

   Expect `brief.md skills documents`, `10`, and `skills: 10`. The agent page's **Files** tab shows
   the same three sections.

4. **What the first planning turn actually read.** Take the conversation task's first run and read
   the context Todero stored for it:

   ```
   RUN=$(curl -s "$B/companies/$C/agents/$A/runs" | jq -r '.[-1].id')
   curl -s "$B/runs/$RUN" | jq -r '.contextSnapshot.toderoTaskKind'
   curl -s "$B/runs/$RUN" | jq -r '.contextSnapshot.toderoSkillText' | grep "^## "
   ```

   Expect `planning`, and exactly six headings - `todero-plan-a-project`,
   `todero-talk-like-a-colleague`, `todero-ask-or-decide`, `todero-hand-off-a-task`,
   `todero-when-to-hire`, `todero-cost-and-time`. The text begins `What you know`, and the adapter
   sends it as the message right after the identity one and before the task. (When the run does not
   keep the snapshot, read the same thing off the request the adapter built for that turn: the
   second `system` message in `messages`.)

5. **A hand-in writes a dated copy.** Approve the plan, let a child task run to a hand-in, then:

   ```
   ls ~/.todero/instances/default/companies/$C/agents/*/documents
   curl -s "$B/issues/$CHILD/documents" | jq -r '.[].key'
   ```

   Expect one `YYYY-MM-DD-<task>.md` beside the task's `output` document, holding the same
   deliverable.

6. **The reviewer carries skill 4.** When the reviewer takes that hand-in, its brief carries
   `todero-review-against-done-when` and nothing else from the pack - the reviewer's turn shows the
   judging skill appended to its system prompt, and the task's comments carry the verdict as usual.

7. **Reset to the original.** Edit one pack skill on the Skills page, then:

   ```
   SKILL=$(curl -s "$B/companies/$C/skills" | jq -r '.[] | select(.slug=="todero-plan-a-project") | .id')
   curl -s -X POST "$B/companies/$C/skills/$SKILL/reset-to-original" | jq -r .markdown | grep last_changed_because
   curl -s "$B/companies/$C/skills/$SKILL/versions" | jq -r '.[0].label'
   ```

   Expect `last_changed_because: Reset to the original` and a newest version labelled the same.

API calls used, in order: `GET /api/companies/{id}/skills`, `GET /api/agents/{id}`,
`GET /api/companies/{id}/agents/{agentId}/folder`, `GET /api/companies/{id}/agents/{agentId}/runs`,
`GET /api/runs/{id}`, `GET /api/issues/{id}/documents`,
`POST /api/companies/{id}/skills/{skillId}/reset-to-original`,
`GET /api/companies/{id}/skills/{skillId}/versions`. Two routes were added by this wave and both are
registered in `server/src/routes/openapi.ts`.

### Wave: the Board

**What exists.** The Tasks page has a board mode (`ui/src/components/KanbanBoard.tsx`, owned by
`IssuesList`): one column per raw status, drag and drop with `@dnd-kit`, compact cards, cold lanes
(backlog, done, cancelled) collapsing into rails, density preferences saved per organization. The
May 2026 scaled-board design covers volume. What is missing is the product shape: a board that
reads as the team's production line, reachable from the menu.

**Decisions (Michael, 2026-09-11).** Turn-based columns; one row per feature, because agents own
steps, not rows; work-in-progress limit per agent from what the machine can serve; a drag does
exactly what the buttons do.

**Entry.** `Board` is its own item under Work in the sidebar, between Tasks and Goals, at `/board`
(company-prefixed like the rest). The board mode inside Tasks stays as a view.

**Columns: the steps.** Left to right, computed from the task's state, blockers and markers - the
same inputs `turnSentence` reads, so the card and the task never disagree:

| Column | Holds | Owner of the step |
| --- | --- | --- |
| Queued | To do with an open blocker, paused, hard-blocked, or nobody assigned | nobody; the chain releases it |
| Agent working | in progress, a live turn, or To do with an assignee (about to start) | the assignee |
| Review | handed in, the reviewer has it and nothing has passed yet | the reviewer agent |
| Your turn | plan to approve, output to accept, question to answer | the person |
| Done | done, cancelled | - |

**Rows: the features.** One swimlane per feature goal in plan order, with the feature's done-when as
the row's subtitle and a progress fraction ("2 of 4 done"). A row for the Brief sits on top, a row
named "Mission" at the bottom for tasks that belong to no feature. Rows collapse; a collapsed row
shows only counts per column. Completed features collapse by default.

**Work-in-progress limit.** Per agent, from `runtimeConfig.heartbeat.maxConcurrentRuns` - what the
agent was hired with, which is the machine's parallelism the detect step reported. The "Agent
working" header shows "1 of 1" per agent and turns amber at the limit. The board only reports it;
the busy timer is what actually refuses to start another task.

**Drag.** A drop calls the same API the buttons call, with the same confirmations:
Your turn -> Done accepts; Queued -> Agent working clears the blockers and starts the agent
("Start now, ahead of TAM-3?"); Agent working -> Queued parks it as waiting on you with a note;
anything -> Your turn is refused; within a column does nothing (the order is the task's priority,
which this wave does not write - reordering is deferred). A task waiting on its own plan refuses to
start, and so does a task whose agent, or whose whole organization, is paused: a pause swallows the
start silently, so the board says so rather than reporting a start that never happens.

**Cards.** Identifier, title, assignee, time on the step ("3 h"), and one glyph: writing, with the
reviewer, waiting on you, or paused. Compact mode drops the title to one line. Clicking opens the
task; the card never edits in place.

**Toolbar.** Rows by feature or by agent; show completed features; compact cards; a filter for one
agent. Saved per organization.

**Phone.** Columns become a horizontal swipe with "Your turn" first; drag is off on touch, and each
card carries the button its drag would have been, through the same rules.

#### What shipped

- `ui/src/lib/board-model.ts` - the one `columnFor`, taking a `BoardTaskView` that is
  `TurnSentenceView` plus a `reviewRunning` flag, with `turnSentence`'s precedence verbatim. Also
  `rowsFor` / `rowIdFor` (Brief, features, Mission), `agentRowsFor` / `agentRowIdFor`, `wipLimitFor`
  / `wipFor` / `wipBadgeText`, `rowProgressText`, `timeInColumnText`, and the column vocabulary and
  labels including the phone order.
- `ui/src/lib/board-view.ts` - `boardViewFor`, the pure assembly of rows, cards, glyphs, per-column
  totals and the work-in-progress badges from the issues, goals and agents the pages already load,
  plus `boardTaskViewFor`, `openChildCounts` and `ownersForColumn`.
- `ui/src/lib/board-drop.ts` - `dropFor`, every allowed drop and every refusal with a one-line
  reason in plain words.
- `ui/src/lib/board-prefs.ts` - the four toolbar choices, remembered per organization in
  `localStorage`.
- `ui/src/hooks/useIsPhoneWidth.ts` - the phone-width switch.
- `ui/src/pages/Board.tsx` and `ui/src/components/board/` - the page, the column headers with the
  WIP badge, the lane, the card, the toolbar and the confirmation dialog.
- `ui/src/App.tsx` route at `/board`; `ui/src/components/Sidebar.tsx` entry under Work.
- Tests: `board-model.test.ts` (48), `board-drop.test.ts` (15), `board-view.test.ts` (14),
  `Board.test.tsx` (10), `BoardDragHandlers.test.tsx` (11), plus one Sidebar case - 99 in all.

No server change. No route added, so `server/src/routes/openapi.ts` is unchanged. No migration.

#### Open

- **Reorder is a no-op.** A drop inside a column returns `{action: "reorder"}` and stops there; the
  priority write from the drop position is not wired, so the busy timer's order is unchanged.
- **Phone buttons are missing.** Drag is correctly off on touch, but the spec's "buttons on the card
  replace it" is not built - a phone can read the board and open a task, not act from the card.
- **The Review column needs the raw `in_review` status.** `displayStatus` folds `in_review` into
  `in_progress` on purpose, so `boardTaskViewFor` reads `issue.status` directly. If the reviewer ever
  stops parking work in `in_review`, the Review column goes empty and nothing else breaks - the work
  simply shows as Agent working.
- **Amber is a Tailwind palette class**, matching `KanbanBoard`'s existing lanes rather than a
  status token. It is the same standing debt DESIGN.md principle 2 schedules for the palette run.
- **Cold-lane rails and the page-size controls** from the May scaled-board design are not carried
  over; the Done column is a normal column that a row collapse hides.
- **"Agent working" does not split per worker** when rows are by agent; the manager wave's split is
  still the row choice, not a column choice.

#### Live verification

1. Open `/<prefix>/board` on an organization that has a plan. Tampa Supper Club is paused, so it is
   safe to read - **do not drag anything there.**
2. Expect **five columns**, left to right: Queued, Agent working, Review, Your turn, Done.
3. Expect **one row per feature** of the plan, each showing the feature title, its progress
   ("2 of 4 done") and its done-when line. The **Brief row is on top**; a **Mission** row is at the
   bottom if any task belongs to no feature.
4. Expect the **work-in-progress badge** in the Agent working header: "<agent>: 1 of 1" when that
   agent has one task standing there, amber at the limit. On a paused organization it reads
   "<agent>: 0 of 1", because pausing puts the work back in Queued - that is itself the check that
   paused lands in Queued.
5. Expect the **Your turn column to hold TAM-3** (the task with a plan to approve, output to accept,
   or a question waiting). Click it: the task page's turn bar must say the same thing the column
   does.
6. Collapse a row by its header: the row keeps only its counts per column. A completed feature
   arrives collapsed, and "Completed features" in the toolbar hides it entirely.
7. Narrow the window to a **phone width** (under 768px): the columns become a horizontal swipe with
   **Your turn first**, and cards no longer drag - instead each card carries the button its drag
   would have been (Accept on a Your turn card, Start now on a Queued one, Park on one the agent is
   carrying), asking the same question and making the same call.
8. On a desk width, on an organization that is **not** paused, drag a Your turn card onto Done: a
   confirmation names the task, and accepting it is the same call the task page's Accept makes.
   Drag a Queued card onto Agent working: the confirmation says "Start now, ahead of <blocker>?".
   Drag anything onto Your turn: it is refused with "Only the agent can hand work in." Drag a
   paused agent's Queued card onto Agent working: it is refused by name ("Nova is paused. Press
   Play on Nova first."), because a pause swallows the start silently.
9. Dropping a card back in the column it came from does **nothing** - the order inside a column is
   the task's priority, which this wave does not write. Reordering is deferred, not shipped.

#### Fixed after the live check (2026-09-11)

- **A pause hid the person's turn.** On the paused Tampa Supper Club, the hand-in waiting for the
  person's Accept sat in Queued, and the task page said "Paused". A pause stops the agents, not
  the person: a hand-in to accept, a plan to approve or a question to answer now stays in Your
  turn and the turn sentence says so, while the organization is paused. `turnSentence` and
  `columnFor` share the rule, so the card and the page still agree.
