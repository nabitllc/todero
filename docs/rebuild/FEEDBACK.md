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

## 2026-08-25 (later) · Hub, rail and bolts, from the running app

Transcribed 2026-08-26. These words were given in conversation on the running
app and, until now, survived only inside code comments in `BusinessRail.tsx`,
`PrimaryNav.tsx` and `app/page.tsx`. A critic scoring round 4 could find no repo
record for them and correctly flagged them as unsourced authority. Michael
confirmed they are his. They are recorded here because this file's own first
line says feedback held outside the record is the thing that gets lost — and
that is exactly what happened.

7. **"Survive similar to Slack. Left pane has 'Workspace'... Todero 'Hub' should
   be similar to Slack 'Workspace'. User can be part of multiple hubs, with a
   specific account/RBAC on each workspace. For now, we only have one Hub
   (Limiglow) until we know Todero works properly... later user should be able
   to create/join different hubs (similar to Paperclip)."**
   -> The 14px rail is the HUB switcher, and it stays permanently. It does not
   move into Settings. Multi-hub membership and per-hub RBAC are post-MVP.
   Status: LANDED (round 4) — and it **supersedes** item 2 above and the
   `cards-and-identity` piece spec, both of which say the rail shows PROJECTS
   and that businesses move into Settings. Where they disagree, this wins;
   it is also the version recorded in `HANDOFF.md:83-85`.

8. **"Bolts tell the summary of what agents have done in 24h"** and **"the
   'Start' is not meant for bolts."**
   -> A bolt is a fixed 24h window summarising AGENT work; it opens
   automatically at a set time. The old "Run Sprint" button is neither a bolt
   nor a sprint — it starts a goal-scoped run of arbitrary length, and is now
   "Start builder run".
   Status: PARTIAL. The rename landed. The automatic open at a set time does
   NOT work and cannot: `sprints.start_date`/`end_date` are `DATE` columns
   (`migrations/000_baseline_schema.sql:76-77`, never altered), so a bolt cannot
   carry an hour. Hour-accurate bolts need a `TIMESTAMPTZ` migration — an open
   decision, deliberately not taken inside `bolt-time`.

## 2026-08-26 · Discord belongs to a hub, not to the source tree

Asked how to handle a Discord bot token found hardcoded in 29 files on `main`
and used as a live fallback in `app/api/issues/route.ts`, Michael:

9. **"Same way settings show connected tools, Discord should be there so
   something can be added per project. What currently exists might be broken
   anyway so good to set up something the user can add Discord from scratch to
   a hub."**
   -> Discord becomes a **per-hub connection configured in Settings**, added by
   the user from scratch, alongside the other connected tools. The credential
   lives in the connection record, not in source. This replaces the existing
   hardcoded channel IDs and token rather than patching them, on the assumption
   that what is there now is broken anyway.
   Status: OPEN -> a Settings/Connections piece. Note this removes the token
   from SOURCE but not from the 16 commits already carrying it; rotating it in
   the Discord Developer Portal is a separate action, and Michael's to take.

---

## Earlier, still open

- ~~Push/PR visibility~~ **RESOLVED 2026-08-25.** The rebuild merged to `main`
  as PRs #32 and #33; `origin/main` and the local tree are identical. The
  `rebuild/2026-08-24` branch is gone from both sides, and origin was pruned
  from 94 branches to one.
- The 71 MB Supabase export exists on one machine only. It should have a second
  copy before anything upstream is deleted.
- Invented projects, **re-measured 2026-08-26 and 12x larger than recorded.**
  This was written as two files. It is **24 source files**, and it reaches the
  MC API itself: `app/api/issues/route.ts` auto-assigns issues to `kemuni-sme`
  at `:1141` and `:1644`, allowlists both agents at `:338` and `:544`, and
  carries a four-project emoji table at `:139` — which is the very table
  `HANDOFF.md` records as having already survived two rounds of a sweep whose
  job was removing it. `lib/constants.ts:8-9,19-22` still maps `VES`/`KEM`.
  Dispatch is guarded off, so nothing has run. Tombstone comments naming the
  deleted constants (`lib/mc-constants.ts:4,44,76`, `app/page.tsx:54`) are
  correct and should stay; `scripts/acceptance/checks.mjs:141` uses
  `/Users/kemuniagent` as a mac-path DETECTOR pattern and is also fine.
