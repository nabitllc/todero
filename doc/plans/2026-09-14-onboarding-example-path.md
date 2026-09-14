# "Show me an example" — a worked company before you type anything

**Status: proposal.** Written 2026-09-14. Recommendation 3 of
`2026-09-14-product-recommendations.md`, specified.

## The problem

Todero's front door (`ui/src/components/FrontDoor.tsx`) offers two doors, and both of them are
work: build a new organization, or add agents to an existing one. Either way the next screen asks
for a name, then a mission, then a model.

A person who has never seen this product does not yet know what an organization *is* here, what an
agent will actually produce, or what "done" looks like. They are being asked to commit before they
have any picture of what they are committing to. For a product in a category most people have not
used, that is the wrong order.

**What is missing is the thing that explains Todero fastest: one company that already did some
work, that you can read.**

## The decision that shapes everything else

**The example is a finished company, not a live sandbox.**

A sandbox that runs would need a configured model, which is exactly the commitment the example
exists to defer. So nothing in the example runs. It is a real company with a real, completed
history in it — mission, a hired agent, a proposed plan, approved features, finished tasks, the
reviewer's verdicts, a wrap-up — frozen at the end of its run.

The reader is not being asked to believe a mock-up. They are reading a transcript of something
that actually happened.

## How it is built: a real run, exported

The example must never drift into fiction, so it is not authored by hand.

1. A script runs the real loop end to end against a local model, the way
   `docs/ai_context/gauntlet/checks/live-loop.py` already does.
2. When the run finishes, the script exports the company through the existing portability path
   (`POST /api/companies/:companyId/export`, `server/src/services/company-portability.ts`).
3. The bundle is committed to the repository as data.
4. Choosing the example imports that bundle through the existing
   `POST /api/companies/import` route.

Nothing new is invented: import, export and id remapping already exist and are tested. The example
is a fixture, not a feature with its own seeding code.

**A CI check imports the committed bundle and asserts it lands.** That is what stops the fixture
rotting as the import schema moves — the failure shows up in CI rather than in front of a new
user.

## What the example contains

One small company that finishes something legible in a few tasks. The mission used for the live
checks on 2026-09-14 works well: *"Publish a one-page guide for people starting a home herb
garden."* It is neutral, obviously not real, and produces readable documents rather than code.

It must contain, because each one teaches a different part of the product:

- a mission goal, and features under it
- one agent, and its reviewer
- the planning conversation, including the agent's questions and the person's answers
- an approved plan, so the approval gate is visible in the history
- at least one finished task with its output document
- at least one reviewer verdict **with the checks block** from PR #105, because that is the part
  that shows the work was checked and how
- at least one send-back, so the loop is not shown as a straight line — the honest version
  includes something coming back
- a wrap-up and a completed project

## Where it lives in the flow

**A third, quieter entry on the front door.** Not a third equal card: the two existing choices stay
the primary ones, and below them sits a single line.

> Not sure yet? **Look at a finished example** — a small company that already did its work.
> Nothing runs, and you can delete it in one click.

Two sentences do the work: it sets the expectation that nothing is live, and it says the exit is
easy. Both are the objections a cautious person has at that moment.

**Where it lands.** On the finished task, not the dashboard. A single task page shows the whole
product in one screen: the turn sentence, the conversation, the output document, and the reviewer's
checks. A dashboard shows counts, which mean nothing to someone who has not seen the thing yet.

## Living in the example

A banner sits at the top of every page of the example company, and does not dismiss:

> **This is a finished example.** Nothing here is running, and no model is connected.
> [ Start my own organization ]  [ Delete this example ]

Three requirements behind it:

- **It is unmistakably a sample.** The organization's name carries the word, the banner is always
  there, and its badge in the organizations list says Example rather than Active.
- **It never looks like work.** It must not appear in counts of real work, in the Inbox, or in
  costs. A person should never have to wonder whether one of their agents did this.
- **One click removes it,** and that click now works: deleting an organization was broken by a
  foreign-key ordering bug until PR #106.

## Where it does not appear

Import is refused on cloud-managed instances and when the operator hides the company-import page
(`importFloor`, `server/src/routes/companies.ts`). The entry is therefore hidden wherever import is
unavailable, rather than rendering a control that fails — the same rule the front door already
applies to cloud organization creation.

A follow-up could have Cloud provision the example at signup instead. Out of scope here.

## What it is not

- **Not a tutorial.** No tour, no tooltips, no checklist. The example is a company to read, and
  the product either explains itself at that point or it does not — which is itself worth learning.
- **Not interactive.** Buttons in the example do not start runs. A person who wants to press
  things starts their own organization; that is the call to action.
- **Not a template.** Copying the example into a working company is a different feature with
  different questions. Not in this slice.

## The work

| Piece | Where |
|---|---|
| Generator script: run the loop, export the bundle | `scripts/` |
| The committed bundle | a fixture path under `docs/` or `server/src/fixtures/` |
| CI check: the bundle imports and lands | `docs/ai_context/gauntlet/checks/` or the test suite |
| Third entry on the front door | `ui/src/components/FrontDoor.tsx` |
| Import-and-open handler, with the cloud/hidden guard | `ui/src/components/OnboardingWizard.tsx` |
| The example banner and the Example badge | work-item and organizations list |
| Copy | above |

Roughly a day, most of it in the fixture and its check rather than in the UI.

## Open questions for Michael

- **Does the example ship in the repository, or download on demand?** Committed is simpler and
  works offline, which suits a local-first product; it also puts a binary-ish fixture in the tree
  and grows the clone.
- **One example, or one per kind of work?** A documents company today; a code company once wave L
  lands. More examples mean more fixtures to keep importing.
- **Should the example be removable but also re-creatable?** If someone deletes it and later wants
  it back, is that a menu item, or is it gone for good?
- **Is the herb-garden mission the right one**, or should the example be closer to the work you
  expect real users to bring?
