# Owner feedback — verbatim, with where each item landed

Kept in the repo, not in a scratchpad. Feedback given in conversation and held
only in conversation is the thing that gets lost in long projects.

---

## 2026-08-25 · UI/UX, from the Now screen

Michael, on the running app:

1. **"In Claude, site should be responsive, I see it in tablet mode because it
   is not going to the full width."**
   → Real bug. Content is capped and does not fill the pane.
   Status: OPEN → `wave6/responsive-and-cards`

2. **"Left pane is meant to be for each project. Right now only 'Limiglow'. It
   should have either a logo or the first character of the project name, in this
   case the L."**
   → The 14px rail is currently `BusinessRail` (shows the BUSINESS, "T"). It
   should be projects: `L` for Limiglow, logo when one exists. Businesses move
   to a switcher in Settings.
   Status: OPEN → `wave6/responsive-and-cards`

3. **"Tell me exactly where I should expect the name of the project being built,
   and where I should expect to see the 'Todero' logo/text."**
   → Decided:
   | Slot | Content |
   |---|---|
   | Top bar, far left | **Todero** wordmark — the tool's brand, never changes |
   | Left nav, above PRIMARY | **Limiglow** + project switcher — this is scope |
   | Left rail | `L` avatar per project |
   | Breadcrumb bar | DELETE — duplicates both, and "Business"/"Project" are developer words |
   Deleting the breadcrumb also removes the stale "Some panels still read across
   projects" line, which was orchestration scaffolding that leaked into the product.
   Status: OPEN → `wave6/responsive-and-cards`

4. **"Make sections use Cards... Determine what cards should be in each section
   and what each of the cards should have."**
   → Card contract: one question, one number that matters, its source, one
   action, collapsible, reflows to a single column on mobile. Empty state names
   the project.
   | Destination | Cards |
   |---|---|
   | Now | Needs you (inbox + blockers + risk merged), Running now, Bolt status, Recent activity |
   | Work | Bolt board, Backlog, Epics, Due |
   | Fleet | Roster, Live, Office |
   | Runs | Run list, Cost |
   | Memory | Documents, Skills, Search |
   | Settings | Connections, Providers, Automations, Archive, Projects, Businesses |
   Moves OUT of Now: Subscriptions → Settings, Project Progress → Work.
   Now should fit one screen.
   Status: OPEN → `wave6/responsive-and-cards`

5. **"Are you working on the UI of each page/section or just the main dashboard?"**
   → Honest answer: only the shell and Now are designed. Work, Fleet, Memory and
   Settings are old tabs re-parented into new destinations; Runs is the one new
   surface. Five of six sections still need the card treatment.
   Status: ACKNOWLEDGED — drives the wave plan

6. **"Instead of Sprints, since its 24h, we will call them bolts, the 24h
   equivalent of a sprint."**
   → The rename is trivial; the time math is not. Every countdown, burndown,
   velocity figure and "shipped yesterday" window was built for a two-week
   sprint. A 24h bolt shows "0 days left" with nine hours to run — the exact
   failure class deleted in TOD-2401. Rename and re-base the units together.
   Status: OPEN → `wave6/bolts`

---

## Earlier, still open

- Push/PR visibility: 10 commits sit on `rebuild/2026-08-24` with no upstream,
  so none of this is visible outside this machine. `CLAUDE.md` says never push.
  Awaiting a decision — see the note in `BRIEF.md`.
- The 71 MB Supabase export exists on one machine only. It should have a second
  copy before anything upstream is deleted.
- `lib/agent-capabilities.ts` defines `kemuni-sme` / `vespera-sme` agents and
  `lib/agent-queue.ts` has rules that POST issues under `project:Kemuni` — the
  invented-project defect one layer down, in dispatch. Guarded off, not fixed.
