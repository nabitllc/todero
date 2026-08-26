# PIECE: Customer conversations — draft, approve, send, in that order

id: customer-conversations
lane: Customer Conversations (channel 0/9)
benchmark: Slack (a reply threads instead of drowning the channel) / Grok Bot
(drafts while you are away, surfaces only what needs approval)
owner's words, verbatim from `scripts/board/channels.json`:

> "Slack — a reply threads instead of drowning the channel. Grok Bot — drafts
> while you are away, surfaces only what needs approval. **You approve; Todero
> sends.**"

and the same file's `evidence` for why the channel scores 0:

> "Todero must not only build a project but operate it — the first real test is
> answering customers on WhatsApp and on the site. Nothing exists: no
> conversation store, no draft-approve-send path, no channel integration beyond
> outbound Discord/Telegram alerts."

OWNS EXCLUSIVELY: `migrations/063_conversations.sql`,
`migrations/sqlite/063_conversations.sql`, `app/api/conversations/**`,
`lib/conversations.ts`, `lib/__tests__/conversations.test.ts`,
`components/tabs/ConversationsTab.tsx`, this file.

DO NOT TOUCH: `app/page.tsx`, `components/nav/**`, `app/api/issues/**`,
`app/api/inbox/**`, `app/api/connections/**`, `app/api/run-steps/**`,
`app/api/agents/**`, any other `components/tabs/*`, `lib/time.ts`,
`lib/bolt-time.ts`, `lib/approvals.ts`, `lib/connections.ts`, `lib/run-trace.ts`,
`lib/fleet-liveness.ts`, `lib/agent-*.ts`, `scripts/**`, `migrations/0[0-5]*`,
`migrations/06[0-2]*`, `migrations/064*`, `migrations/065*`.

## What this piece deliberately does NOT do

**It integrates no customer channel.** No WhatsApp Business API, no web widget,
no outbound HTTP to any address a customer could be reached at. The transport is
a decision the owner has not made, and inventing one would be a bigger lie than
the empty screen it replaced: a "Send" button that does nothing, or one that
posts to a provider nobody chose.

What that leaves is the part the owner's sentence actually names — the **store**,
the **lifecycle**, and the **surface**. `sent` is a state a transport reports
back into; nothing inside this piece can put a message there on its own, and no
file it owns contains an outbound `fetch`. Item 14 below is the mechanical proof.

## ACCEPTANCE

Every item is observable — a file, a SQL constraint, an HTTP status, a test that
fails against the previous behaviour, or an exact string on screen. No item is
an adjective.

1. **`migrations/063_conversations.sql` and `migrations/sqlite/063_conversations.sql`
   both exist and both create the same two tables** — `conversations` and
   `conversation_messages` — following the two-dialect pattern of
   `migrations/058_hub_settings.sql` / `migrations/062_agent_memory_kv.sql` and
   their sqlite twins (Postgres `uuid` / `timestamptz` / `CHECK`; sqlite `TEXT`
   uuid idiom, ISO-8601 `TEXT` timestamps, the same `CHECK`s). Prefix `063`
   collides with nothing: `node scripts/acceptance/run.mjs` still reports
   `no-colliding-migrations` PASS and **45/45**.

2. **A conversation carries exactly what the owner's sentence needs and nothing
   the UI does not read:** `id`, `project` (the scope), `channel`, `contact`
   (the external identifier — a phone number, a site session), `contact_name`,
   `status`, `last_message_at`, `created_at`. `UNIQUE (project, channel, contact)`
   — that constraint IS "a reply threads instead of drowning the channel": a
   second message from the same contact joins the existing thread, it does not
   open a second one.

3. **`last_message_at` is NULLABLE and is never defaulted to `created_at`.** A
   thread that has received nothing renders "no messages yet", not a timestamp
   claiming a customer wrote at the moment the row was created. Same rule as
   `run_steps.tokens` in migration 060.

4. **A message carries a direction and a lifecycle:** `direction` is
   `inbound | outbound`; `state` is `received` for inbound and one of
   `draft | approved | sent` for outbound. The pairing is a **CHECK constraint**,
   not a convention — `direction='inbound' AND state='draft'` is rejected by the
   database in both dialects.

5. **The database itself refuses a send that was never approved.** Two CHECK
   constraints, present and identical in both dialects:
   `CHECK (state <> 'approved' OR approved_at IS NOT NULL)` and
   `CHECK (state <> 'sent' OR (approved_at IS NOT NULL AND sent_at IS NOT NULL AND sent_via IS NOT NULL))`.
   A row saying `state='sent', approved_at=NULL` cannot exist. This is the
   schema-level form of "You approve; Todero sends", and it holds even against a
   writer that bypasses the API entirely.

6. **`lib/__tests__/conversations.test.ts` proves item 5 in BOTH dialects by
   executing the migration**, not by reading it: it applies
   `migrations/sqlite/063_conversations.sql` to an in-memory better-sqlite3
   database and `migrations/063_conversations.sql` to an in-memory PGlite, and
   asserts each INSERT of an unapproved `sent` row **throws**. A test that only
   asserted the happy path would pass against a schema with no CHECKs at all.

7. **`npm run db:migrate` applies 063 to `./db.sqlite` and is idempotent** — a
   second run reports it already applied and creates nothing. Both tables appear
   in `sqlite_master` afterwards. `lib/__tests__/migrations-from-zero.test.ts`
   (PGlite, every `migrations/*.sql` in filename order) still passes, which is
   what proves the Postgres dialect applies from empty.

8. **`GET /api/conversations` is scoped to one project or it refuses.** With a
   `Referer` of `/b/<hub>/p/<slug>/…` (middleware's `x-mc-project`) or an explicit
   `?project=<name>`, it answers 200 with that project's threads only. With
   neither it answers **400 `unscoped_conversations_read`** naming how to ask
   deliberately. **There is no `all_projects=1` escape and no cross-project
   view** — unlike issues, a customer conversation belongs to exactly one
   project, so widening is not a mode this endpoint has. Fail closed.

9. **A resolved scope narrows; it is never overridden.** `?project=X` sent from a
   screen the server resolved as `Y` is **409 `scope_conflict`**, not a silent
   answer for X. Answering it would make the address bar and the data disagree —
   the same rule `app/api/issues/route.ts` applies.

10. **Reading one thread is scoped too.** `GET /api/conversations/<id>` for a row
    whose `project` is not the resolved scope answers **404** with a message
    naming the scope it was asked from. The thread's own project is never used
    as the scope — that would let any id widen the boundary it is inside.

11. **An inbound message can be appended, and it opens or reuses exactly one
    thread.** `POST /api/conversations` with `{channel, contact, body}` creates
    the thread when none exists and appends to the existing one when it does
    (item 2's UNIQUE). The response says which of the two happened
    (`"created": true|false`), and `last_message_at` moves to the new message's
    timestamp.

12. **An outbound message can only be created as a DRAFT.** `POST
    /api/conversations/<id>/messages` with `direction:"outbound"` always writes
    `state='draft'`. The caller cannot choose the state: `state`, `approved_at`,
    `approved_by`, `sent_at` and `sent_via` are **not accepted keys** — sending
    any of them is a **400** that names the key and lists the ones that are
    accepted, exactly the fail-closed stance of
    `app/api/hub-settings/route.ts` ("an unknown key is a typo or an injection,
    never a feature"). It is not accepted-and-ignored, which is the defect a
    previous round shipped.

13. **Approval is a separate call, by a human, and only from `draft`.**
    `PATCH /api/conversations/<id>/messages/<message_id>` with
    `{"action":"approve","approved_by":"<who>"}` moves `draft → approved` and
    stamps `approved_at`. Every other transition is refused with the exact
    reason and a **409**: approving an already-approved message, approving a
    `sent` one, approving an inbound one.

14. **There is no code path that sends.** `{"action":"record_send"}` REQUIRES the
    message to already be `approved` — from `draft` it is **409** with the
    sentence *"a draft cannot be sent: it must be approved first — that is the
    whole rule this surface exists to enforce"*. And the endpoint records a send
    a transport performed; it does not perform one. Mechanically: **no file this
    piece owns contains an outbound `fetch(`/`http` request to any customer
    channel**, and `lib/conversations.ts` imports neither `lib/db` nor
    `next/server` (it is pure, which is what lets the test above run the refusals
    without a database).

15. **Approving requires more than writing, and the line is drawn where it is
    actually enforceable.** Drafting is `projects:write`; approving additionally
    requires `settings:write`. The role that a drafting AGENT presents
    (`X-Agent-Role: member`, with the internal secret) holds the first and not
    the second, so **the same message that a member-role caller can draft with
    201 is refused 403 `PERMISSION_DENIED` when that caller tries to approve
    it** — demonstrated with two curls differing only in the action.

    Stated honestly rather than dressed up: `lib/with-permission.ts`'s
    `COOKIE_ROLE_MAP` knows only `admin` and `viewer`, so *every* browser session
    on the owner password resolves to `admin` whatever `mc-role` says. There is
    no owner-vs-admin separation available to claim here. The enforced line is
    human session vs agent role (and `viewer`, which `middleware.ts` blocks from
    every write).

16. **`components/tabs/ConversationsTab.tsx` is built on
    `components/nav/Card.tsx`** and honours its contract: one question as the
    title — **"Who is waiting on a reply?"** — one number from a real query, the
    query printed verbatim as `source`, a collapse that persists, and a single
    column at every width.

17. **The number is a real count, not a page length.** The metric is the count of
    outbound messages in state `draft` for the scoped project, obtained with
    `count: 'exact'`, and the printed `source` is the exact endpoint that
    produced it. While it is in flight the card renders **no metric at all**
    rather than a placeholder `0`.

18. **The empty state names the project.** With no threads for Limiglow the card
    body reads: *"No customer conversations for Limiglow yet — nothing has
    arrived on WhatsApp or on the site, and Todero has no channel connected to
    either."* Not "No data".

19. **An error REPLACES the body.** A non-2xx from the endpoint renders
    `<ApiErrorBanner>` (`data unavailable — <status> from <endpoint>: <message>`)
    and the empty state is not rendered underneath it.
    `node scripts/no-silent-empty.mjs` stays PASS.

20. **The surface never claims a message was sent.** Each message renders its
    state from the `state` column verbatim. An `approved` message renders the
    sentence *"Approved — waiting for a transport. Todero has no WhatsApp or web
    sender; a send is recorded only when one reports it."* and the card states
    the number of messages that have actually reached `sent` for this project,
    from a real count — `0` today.

21. **Nothing this piece adds fabricates a project.**
    `node scripts/no-invented-projects.mjs` exits 0, and no file it owns contains
    a hardcoded project name in project position.

22. **The tree still passes what it passed before.** `npx tsc --noEmit` clean,
    `node scripts/acceptance/run.mjs` 45/45, `npm test` with no new failures
    beyond the 5 known pre-existing ones (`agents-route`, `agents-unconfigured`,
    `spawn-live`), and every fixture row inserted during verification is deleted
    afterwards with the count confirmed back at 0.

## What is still missing after this piece — stated, not hidden

- **No channel is connected.** Nothing writes an inbound message except a caller
  with a session cookie. WhatsApp and the site widget both need a webhook
  receiver with per-hub credentials, which belongs with the Settings/Connections
  work (`FEEDBACK.md` item 9), not here.
- **Nothing drafts.** "Grok Bot drafts while you are away" needs an agent that
  reads a thread and writes a draft. This piece gives that agent the endpoint to
  write into and the constraint that its draft cannot escape; it does not add the
  agent.
- **No SLA, no assignment, no unread state.** A thread has a status and a last
  message time. It has no owner and no timer, because no column backs one.
