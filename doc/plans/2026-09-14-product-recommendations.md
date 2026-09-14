# Product recommendations, outside-in

**Status: proposal.** Written 2026-09-14 at Michael's request: read Todero the way an investor
would, say whether the current plan makes sense, and recommend anything that makes the product
easier for users and better as a tool.

This is an outside-in view from one session of using the product, reading `doc/GOAL.md`,
`ROADMAP.md` and the gauntlet wave reports, and running a throwaway company end to end on a local
model. It is opinion, and it is aimed at sequencing rather than at direction.

## The asset

The org model is the moat, and it is undersold.

Most of the field is building agent *runners*: a loop, a tool list, a chat box. Todero has roles,
hiring, budgets, approvals, reviewers, org charts, activity attribution, and an audit trail. That
is the part nobody rebuilds in a weekend, and it is the part that decides whether a company with
forty agents is operable or a mess. Governance is the moat; the loop is table stakes.

Two shipped milestones are worth more than their roadmap line suggests: budgets with hard stops,
and activity attribution. They are the reason a person can leave the thing running, and leaving it
running is the entire product.

## Recommendation 1 — the quality gate goes first

**Evidence.** On a throwaway company run on 2026-09-14, the reviewer passed a handed-in document
six seconds after it was written, and did the same on all eight tasks, each time opening with the
same fixed sentence: "I reviewed this and it does what the task asked."

The reviewer is not a stub — it is given the goal, the feature's done-when line and the task's
hand-in line, and it did read the work. The problem is that its verdict is a word and a paragraph.
It never says which criteria it checked, nothing is checked mechanically, and the criteria
themselves are one line shared across a whole feature. From the outside a careful review and a lazy
one look identical.

The product can currently demonstrate **motion**, not output. For a control plane whose promise is
that you can leave it alone, that is the gap that matters most: a person can only leave something
alone if they trust what comes out of it.

This also happens to be the cheapest route to model independence. A weak model is perfectly safe
when the gate is real, and no amount of configuration makes it safe when the gate is a formality.
`2026-09-14-any-llm-independence.md` has been reordered so the gate is step 1.

## Recommendation 2 — pick a wedge and say it out loud

Twenty-plus roadmap milestones shipped is real execution. But "control plane for autonomous
companies" is a category, and categories are won from a beachhead. Neither `GOAL.md` nor
`ROADMAP.md` names one job Todero is famously best at, and without one the product is compared
against everything.

A candidate, chosen because it is true today rather than aspirational: **an AI team that plans and
writes your company's documents overnight, on hardware you control, where nothing leaves the
building.** It is demoable now, the local-first story is a genuine buying reason for anyone who
cannot send work to a vendor, and code tasks become the expansion rather than the entry.

The wedge is a positioning decision, not an engineering one, and it is Michael's to make. The
recommendation is only that one gets picked and written down, because the roadmap currently has no
spearhead.

## Recommendation 3 — put the product's own scoreboard in the product

The goal, as Michael reworded it on 2026-09-14: a company should need no human inside its daily
operations; humans decide what the company is for and how real money is spent.

That is measurable, and it is not measured. Three numbers on the dashboard:

- **Hours run unattended** — the longest stretch with no human action, and the current streak.
- **Decisions per day that reached a person** — trending down is the product working.
- **Cost per finished task** — where finished means it passed the gate from recommendation 1.

These would settle most roadmap arguments without a meeting, and they are the numbers an outside
reader would ask for first. They also keep recommendation 1 honest: cost per *finished* task is
meaningless while everything passes.

## Recommendation 4 — treat onboarding legibility as a release gate

On 2026-09-14 the author of the software could not find where to answer his own agent. The `Answer`
button focused a reply box far below the fold and changed nothing on screen, so it read as broken.
Fixed in PR #103.

The fix matters less than the class. If the person who built it is lost, a new user is gone in
ninety seconds. A control at the centre of the main loop that gives no feedback should block a
release the way a failing test does — and the loop's own screens deserve a walkthrough by someone
who has not seen them before, on a schedule.

## Withdrawn: "the default path is the slowest one"

An earlier version of this review claimed Todero's default onboarding pushes people onto a slow
local model, and recommended leading with a hosted API key instead.

**That was wrong.** Onboarding offers Claude and Codex before the local option, and the CLI's
provider prompt (`cli/src/prompts/llm.ts`) offers only Claude and OpenAI. The claim came from
generalising a developer test rig — a local model wired straight through the API for gauntlet runs —
to what a new user actually sees. Recorded here rather than deleted, because the reasoning error is
worth remembering: the way a maintainer runs the product is not the way it ships.

One small real observation survives: the CLI provider prompt has no local option at all, while the
UI wizard does. Probably worth aligning, minor either way.

## What this does not argue with

- The direction in `GOAL.md`, including Michael's 2026-09-14 addition that operations need no human
  and that strategy and real money stay human.
- Model independence as a requirement. The argument is only about what it is sequenced behind.
- The open-source and local-first posture, which is the reason the wedge in recommendation 2 is
  available at all.
