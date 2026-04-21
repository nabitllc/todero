# Todero / KAOS — Delivery Pipeline Briefing for CTO Review

**Author:** Michael · **Date:** 2026-04-21
**Repos:** `github.com/nabitllc/todero` (app + `config/` submodule)
**Production:** `https://kaos.nabit.work` (Cloudflare tunnel → `localhost:3000` on Mac Mini)

---

## 1. What This System Is

Todero is an **agent-orchestrated software-engineering platform**. Instead of
a human developer, the "workforce" is a set of Claude-powered agents (builder,
tester, designer, ops, deployer, scout, PO, KAOS orchestrator) that pick up
issues from a queue, write code in isolated git worktrees, commit locally,
and then hand off to a human-scheduled release window.

The whole thing is run by a Next.js app (`todero`) that exposes a canonical
**MC API** (`/api/issues`) which is the single source of truth for issue
state. Every agent reads and writes through that API. The database is
Supabase (Postgres). The app also hosts the Kanban board, agent dashboard,
and visualization.

**The goal of the pipeline:** an issue goes `backlog → refined → open →
in_progress → code_review → approved → released → closed` with different
agents responsible for each step, and merges to `main` only happen in two
scheduled windows per day (7am / 7pm ET).

---

## 2. High-Level Flow

```
  ┌─────────┐   PO      ┌─────────┐  queue-   ┌──────┐  builder  ┌─────────────┐
  │ backlog │ ────────> │ refined │  refill   │ open │ ────────> │ in_progress │
  └─────────┘  grooms   └─────────┘  cron     └──────┘  picks    └─────────────┘
                                                          │
  ┌──────────┐  auto-    ┌──────────┐  tester/designer    ▼
  │ released │ <──────── │ approved │ <─────────────── ┌──────────────┐
  └──────────┘ pr-window └──────────┘   dual review    │ code_review  │
        │        7am/7pm                                └──────────────┘
        ▼
  ┌────────┐
  │ closed │  (done)
  └────────┘
```

The transitions are enforced in Supabase via a `workflow_transitions` table
(from_status, to_status, issue_type, pre_conditions, post_functions). Each
transition is validated and can fire **post-functions** like
`set_assignee`, `set_active_sprint`, `notify_discord`, `increment_rejection`.

---

## 3. The Delivery Pipeline in Detail

### 3a. CI (GitHub Actions)

Two workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` | push (non-main) + PRs | `npm ci`, `npm test` (Jest), `npm run build` |
| `deploy-production.yml` | push to `main` | Triggers Vercel deploy hook |

**Gap:** there is no staging environment, no integration tests against a
real DB, and no visual / E2E tests. Builds pass or fail purely on
TypeScript and unit-level Jest. See §5.

### 3b. Auto-Deploy (archived, TOD-2295)

Previously `auto-deploy.py` polled `main` every 5 minutes and rebuilt. It
was causing a deploy on every merged PR, creating noise and overlap with
`monitor-pr-merge.py` (which already rebuilds + restarts on merge).

**Current state:** plist removed, script moved to `config/scripts/archive/`.
Deploys now happen only via:
- `monitor-pr-merge.py` (on PR merge into `main`) — rebuilds + kickstarts
  `work.nabit.todero`.
- Manual `launchctl kickstart -k work.nabit.todero` when needed.

### 3c. The PR Window (`pr-window.py`, twice daily)

Runs at 7am and 7pm ET via launchd (`work.nabit.pr-window`).

1. Fetch `status=approved AND deployer_status=ready AND feature_branch IS NOT NULL AND pr_url IS NULL`.
2. Group issues by repo.
3. Create a `release/<YYYY-MM-DD>-<window>` branch off `main`, merge each
   approved `feat/tod-XXXX` branch into it.
4. Push the release branch and **open a single PR** containing all ready issues.
5. Auto-squash-merge that PR via the GitHub API.
6. On merge, `monitor-pr-merge` (every 5m) transitions each contained issue
   to `released` and eventually `closed`, and rebuilds/kickstarts the
   production process.

**Why this exists:** agents commit *constantly*. Pushing every Builder
commit to `main` would create a firehose of micro-deploys and make revert
windows unusable. Batching into two 12-hour windows gives a stable "release
train".

### 3d. The Deployer Agent

Lives alongside the other agents (tester, designer, builder). Its job:

- When an issue is approved by both tester and designer (`tester_status=passed`
  and `designer_status=approved`), the deployer is asked to validate the branch:
  - Pull the branch fresh, run tests, run build, run the smoke test.
  - Check for merge conflicts with `main`.
  - Set `deployer_status=ready` if green, `failed` otherwise.
- Only issues with `deployer_status=ready` are picked up by `pr-window.py`.

**Why this exists:** "approved by reviewers" isn't the same as "still builds
on a fresh checkout." The deployer is the final merge-readiness gate.

### 3e. Queue Refill

`work.nabit.agent-kicker` runs `/api/cron/queue-refill` every 30 minutes.

- Reads all `status=refined` issues.
- Filters out ones assigned to humans or already in-flight.
- For each, PATCHes via MC API to transition `refined → open`.
- The transition's post_functions fire `set_active_sprint` (puts it into today's
  sprint) and `set_assignee` (sets the agent based on the lane's `owner` field).

This is the mechanism that converts a static backlog into an active pipeline.

---

## 4. Enforcement Layers Already in Place

| Mechanism | What it blocks |
|---|---|
| `core.hooksPath=.githooks` + `.githooks/pre-commit` | Prevents any `feat/tod-*` branch from committing infrastructure files (`lib/agent-queue.ts`, `app/api/issues/route.ts`, etc.) on the main checkout |
| Worktree guard in same pre-commit hook | Rejects Builder/Ops commits made from the shared main checkout — must be from `~/agent-worktrees/<key>/` |
| `lib/runtimes/claude-code.ts` CODE_AGENTS check | Hard-fails if `prepareWorktree()` can't isolate — no silent fallback to shared dir |
| `workflow_transitions.pre_conditions` (DB) | Rejects MC API PATCHes that skip required fields (e.g. `regression_test` for `→ in_review`) |
| `post_functions: set_active_sprint` | Auto-assigns the current sprint on `refined → open` and `defined → underway` |
| `post_functions: set_assignee` | Auto-routes the issue to the next step's agent |

---

## 5. Current Challenges (Where I Want Help)

### 5a. CI coverage is thin

- No integration tests against the DB — the MC API is the whole business
  logic and is only covered by unit tests with heavy mocking.
- No browser / E2E tests. The Kanban board breaks regularly and I only find
  out when a human opens it.
- No contract tests between agents and the MC API — an agent can send a
  malformed PATCH and I only see it in Discord logs.

**Ask:** What's the minimum-effort test pyramid that would actually catch
the regressions I see (layout breaks, DB constraint violations, agent flow
breaks)? Is there a pattern for testing long-running agent pipelines?

### 5b. The PR Window is a single point of failure

If `pr-window.py` fails silently (bad token, merge conflict, disk full), no
work ships that window. Detection is manual. I've had 2-day stretches
where everyone thought the pipeline was fine and nothing had actually
merged.

**Ask:** Is there a standard pattern for *scheduled-job observability*
that doesn't require a full APM stack? A dead-man's-switch plus structured
logs to a dashboard seems right, but I don't know the current best-in-class.

### 5c. Auto-deploy consolidation (resolved 2026-04-21)

Previously `auto-deploy.py` (every 5m) and `monitor-pr-merge.py` (every 5m)
both tried to rebuild on main commits, with fragile `merged_commit` state
coordinating them. Collapsed to a single path: `monitor-pr-merge.py` is
the only deployer; `auto-deploy.py` is archived (TOD-2295). Manual
`launchctl kickstart` covers the direct-push case.

### 5d. The agent-worktree isolation is still being worked out

Agents are supposed to work in `~/agent-worktrees/<task-key>/`, not on the
main checkout. Two Claude Code sessions editing the same file at the same
time caused silent reverts of my own work on 2026-04-20. I've now enforced
this in the pre-commit hook and in the runtime, but the underlying issue is
that **parallel agents on a single machine is not a solved problem**. The
constraint is: multiple Claude sessions, one Mac Mini, one repo, one DB.

**Ask:** What's the right architecture here? Worktrees per task is the
current answer. Should I be moving to ephemeral containers (Docker) or
something like GitHub Codespaces-as-a-worker? What does "agent CI" look
like when the agents themselves are the builders?

### 5e. Agent misassignment & self-healing

Historically, ~357 backlog issues wound up with `assignee=builder` when
they should have had `assignee=po`. The symptom was repaired by bulk-PATCH
on 2026-04-21; the actual code path that caused it is still under
investigation (TOD-2293). As a defense-in-depth measure I've now added a
`set_assignee:{to:null}` post_function on `backlog → refined` so the
refined queue stays empty-assignee, and the queue-refill transition sets
the correct lane agent (self-healing).

The broader issue: data-correctness bugs of this kind are hard to detect
until they cause a visible problem, and root-cause analysis is mostly
git-log archaeology.

**Ask:** Is there a lightweight invariant-checking pattern I could wire
into the MC API — something that says "after this PATCH, these invariants
must hold (backlog items have assignee=po, refined items have
assignee=null, in_progress items have a non-null owner, etc.)" and alerts
on violation? I don't want a full event-sourcing rewrite, just a
pragmatic check-on-write.

### 5f. Secrets & tokens in scripts

Several scripts (pr-window.py, monitor-pr-merge.py, monitor-prs.py) have
tokens hardcoded at the top of the file. I know this is bad. These scripts run on a
machine only I have access to, so it's not a real-world risk today, but
it is a scaling/handoff risk.

**Ask:** 1Password CLI? A local keychain wrapper? Docker secrets? What's
the path of least resistance for "scripts on my laptop/Mac Mini need
tokens" without overengineering it?

### 5g. Observability of agent behavior

Agents post to Discord a lot, but I don't have a timeline view of "what
did builder do at 2pm today — which files did it touch, what did the
tester reject, how long did each step take?". Right now the only trace is
`agent_runs` table + Discord scrollback.

**Ask:** Is there a standard trace format (OTel? Honeycomb?) that would
give me a flame-graph of each issue's journey without me building the
tooling from scratch?

---

## 6. Specific Things I'd Like Help With

In priority order:

1. **Test pyramid proposal** — a concrete "here's what you need to add" for
   Todero given its current coverage. (§5a)
2. **PR-window observability** — dead-man's-switch + structured logs
   pattern I can copy. (§5b)
3. **Secrets pattern** — one approach I can commit to, instead of
   researching three. (§5f)
4. **Agent isolation architecture review** — is the worktree-per-task
   approach the right long-term answer, or am I about to hit a wall at
   N=10 parallel agents? (§5d)
5. **Invariant-checking pattern** — lightweight data-correctness guards
   for the MC API. (§5e)

The first three are small, scoped asks. The last two are architecture
conversations.

---

## 7. Appendix — Key Files & Where to Read More

| Concern | File |
|---|---|
| MC API / workflow engine | `app/api/issues/route.ts` |
| Transition rules (DB) | `workflow_transitions` table (Supabase) |
| PR window | `config/scripts/pr-window.py` |
| PR-merge deploy | `config/scripts/monitor-pr-merge.py` |
| Worktree runtime | `lib/runtimes/worktree.ts`, `lib/runtimes/claude-code.ts` |
| Pre-commit hook | `.githooks/pre-commit` |
| CI workflows | `.github/workflows/test.yml`, `deploy-production.yml` |
| Agent roster & protocols | `config/AGENTS.md` |
| Layout smoke test | `scripts/smoke-test-layout.sh` |

For context on *why* each rule exists, each file has a commit-linked issue
(TOD-XXXX) referenced in the code.
