# Feature: `/progress` — an internal, password-gated log of merged PRs

**Status**: Done (shipped 2026-09-02; see § 16)
**Priority**: P1
**Author**: Claude (CTO) for Michael (Strategist)
**Created**: 2026-09-02 · **Updated**: 2026-09-02

---

## 1. Overview

### Problem Statement
Work on Todero lands from many sessions, agents, and machines. Today `/progress` is a hand-edited
board that already says something false (the old landing "passed look"). Michael needs one place, on
his phone, that answers "what shipped, what did it cost, what's in flight" without anyone updating it
by hand — and nobody else should see it yet.

### Target Users
Michael only. Later, a public release-notes page will be derived from the same data — out of scope here.

### Success Metrics
- Every merged PR to `main` appears within five minutes with no human action.
- Each entry answers what / why / how big / what it cost / proof in four lines.
- Nobody without the password sees anything but the login form. Search engines see nothing.
- Zero hand-edited content on the page.

## 2. User Stories
- **As** Michael, **I want** merged PRs listed newest-first with a one-line summary **so that** I can
  read a day's progress in a minute.
- **As** Michael, **I want** token and dollar cost per PR **so that** I see what agent work costs, and
  a blank when the cost is unknown rather than a guess.
- **As** Michael, **I want** the page behind a password **so that** it stays internal until a public
  release-notes page exists.
- **As** an agent opening a PR, **I want** one template to fill **so that** my work shows up correctly
  without knowing the page exists.

## 3. Scope

### In Scope
- `/progress` gated by one shared password, set by Michael as a Vercel environment variable. Login
  form, signed HttpOnly cookie, 30-day session, sign-out.
- Merged PRs from `nabitllc/todero` (both areas: the public site and `local/`), fetched server-side
  with a GitHub token, cached five minutes.
- One entry per PR: title · summary · delta · cost · proof · area. Grouped by day, newest first.
- A "now" strip: open PRs, one line each.
- A PR template so every session writes the same four fields.
- `noindex`, no sitemap, no links from the public pages.

### Out of Scope
- Public release notes (later, from the same data).
- Accounts, roles, more than one password.
- Screenshots hosted by us. Proof is what the PR carries (images in the PR body, CI run link).
- Anything in `local/` besides the PR template. No product change.

### Dependencies
- A GitHub token with read access to the private repo (`GITHUB_TOKEN`, Vercel env).
- `PROGRESS_PASSWORD` and `PROGRESS_SECRET` (cookie signing) in Vercel env. Michael sets all three;
  the CTO never sees or handles them.

## 4. Technical Specification

### 4.1 File Structure
```
middleware.ts                       gates /progress/* on the signed cookie; redirects to /progress/login
app/progress/page.tsx               the log (server component, dynamic)
app/progress/login/page.tsx         form + honest error states
app/progress/login/actions.ts       server action: verify password, set cookie; sign-out
app/progress/progress.module.css    tokens shared with the landing (import the same values)
lib/progress/github.ts              merged + open PRs via GitHub REST, typed, cached (revalidate 300)
lib/progress/parse.ts               reads Summary / Cost / Proof from a PR body; area from files
lib/progress/session.ts             HMAC-SHA256 cookie sign/verify (Web Crypto; edge-safe)
.github/pull_request_template.md    Summary · Cost · Proof · Area
```

### 4.2 Data Model
No database. Per PR (from GitHub): number, title, mergedAt, author, additions, deletions,
changedFiles, top three files by churn, labels, body. Parsed from the body:
- `Summary:` one sentence (fallback: first paragraph, truncated to 160 chars).
- `Cost:` `tokens=<n> usd=<x>` (fallback: blank; never estimated).
- `Proof:` a URL or an image line (fallback: the merge commit's CI run if any).
- Area: `site` if every changed path is outside `local/`, `app` if every path is inside, `both` otherwise.

### 4.3 Authorization
Single shared secret. `POST` password → constant-time compare against `PROGRESS_PASSWORD` →
set `progress_session` cookie: `<expiry>.<hmac(expiry, PROGRESS_SECRET)>`, HttpOnly, Secure,
SameSite=Lax, 30 days. Middleware verifies the HMAC and expiry on every `/progress/*` request except
`/progress/login`. Five failed attempts from one IP → 429 for ten minutes (in-memory; acceptable for
one user). Missing env vars → the page says so plainly and refuses; it never opens by accident.

### 4.4 Server Actions / API
- `login(formData)`: verify, set cookie, redirect to `/progress`.
- `logout()`: clear cookie.
- No public API. GitHub calls run only on the server with `GITHUB_TOKEN`.

### 4.5 External APIs & Async Handling
GitHub REST, server-side, `fetch` with `next: { revalidate: 300 }`. Two calls per render (merged,
open) plus one per PR for files, memoized by PR number and cached with the same TTL. A GitHub outage
renders the last cached list with a one-line "GitHub unreachable, showing cached" note; if nothing is
cached, an honest empty state. Never a spinner-of-death: the page is server-rendered.

## 5. UI/UX Specification

### 5.1 User Flow
`/progress` → login form (one field, one button) → the log. Newest day at the top; "Now" strip above
it with open PRs. Tap a PR → GitHub. Sign out in the footer.

### 5.2 Visual Design (Mode 0)
Same tokens and type as the landing: ink ground, bone text, kelp accent, drift for meta, Plex Sans
body, Plex Mono for numbers. The one repeated row is the design; boldness is spent on the delta
figure in mono. No cards, no columns, no badges, no charts, no hairline between rows — rows separate
by space; one hairline under each day heading.

### 5.3 Layout
Single column, max 44rem, centered. Day heading (mono date) → entries. Entry:
```
#142  Load pages on demand so the first screen ships without the rest.        app
      Entry chunk 8.6 MB → 1.3 MB; 78 routes lazy.                      +412 −88 · 9 files
      12.4k tokens · $0.31 · proof ↗                                     Claude · 22:08
```
Mobile: the same three lines, meta wraps under the title.

### 5.4 Components
`LoginForm`, `NowStrip`, `DayGroup`, `Entry`. No library; the site has none.

### 5.5 States
- Loading: none visible (server-rendered).
- Empty: "No merged PRs yet." / "Nothing open."
- Error: wrong password ("That's not it."), rate-limited ("Too many tries. Ten minutes."),
  GitHub unreachable (cached or empty, said plainly), env missing ("Progress isn't configured.").
- Success: the log.

### 5.6 Accessibility
Label on the password field, visible focus, 44px targets, `aria-live` on the login error, semantic
`<main>/<section>/<article>`, contrast ≥ 4.5:1 on ink.

## 6. Edge Cases & Error Handling
- PR body without the template: summary falls back to the first paragraph; cost and proof blank.
- PR merged then reverted: the revert is its own entry; nothing is hidden.
- Squash vs merge commits: irrelevant — the unit is the PR.
- Token lacks repo scope: the page says "GitHub token can't read the repo" (internal page, honest).
- Cookie secret rotated: everyone is logged out; that is the intended way to revoke.

## 7. Testing Requirements
- Unit: `parse.ts` on template, no-template, and malformed bodies; `session.ts` sign/verify/expiry.
- Integration: middleware redirects without a cookie, passes with a valid one, rejects a tampered one.
- E2E (Playwright, against a preview with test env vars): login wrong → error; login right → log;
  `/progress` without cookie → login; `robots` meta present.
- Manual: phone at 375, one PR with an image in the body.

## 8. Implementation Plan
1. **Gate (0.5 d):** middleware, session, login page, env checks, rate limit. Exit: locked without
   the password, opens with it, on a Vercel preview.
2. **Data (0.5 d):** GitHub client, parser, area detection, cache, template. Exit: JSON of the last
   30 merged PRs with parsed fields.
3. **Page (1 d):** log, now strip, day groups, empty/error states, mobile. Designer pass on one
   rendered entry, then one fix batch. Exit: live behind the gate.
4. **Convention (0.25 d):** PR template merged; one line in `local/AGENTS.md` and the root CLAUDE.md
   telling sessions to fill Summary / Cost / Proof. Exit: the next PR renders fully.

## 9. Rollout
No flag. Michael adds `PROGRESS_PASSWORD`, `PROGRESS_SECRET`, `GITHUB_TOKEN` in Vercel before the
merge; until then the page shows "Progress isn't configured." Docs: this PRD and the template.

## 10. Subscription Tiers & Limits
None.

## 11. Roles & Permissions
One role: holder of the password.

## 12. Notifications
None.

## 13. Third-Party Integrations
GitHub REST API, read-only, server-side.

## 14. URL & Route Structure
- `/progress` — the log (gated).
- `/progress/login` — the form.
- `/progress/logout` — server action target.

## 15. Open Questions
None. Michael took the recommendations on 2026-09-02: 30-day session, GitHub login as author
(`Session:` in the template overrides it), 90 days of history.

## 16. What shipped (2026-09-02)

- **Gate** — `middleware.ts` + `lib/progress/session.ts`: HMAC-signed HttpOnly cookie, 30 days,
  constant-time password compare, five wrong tries → ten minutes, closed when env is missing.
- **Data** — `lib/progress/github.ts`: merged PRs **and direct commits to `main`** (most of the
  early work never went through a PR; the page would have been a lie without them). Checkpoint and
  merge commits are skipped. `lib/progress/parse.ts` reads Summary / Cost / Proof / Session, strips
  markdown and git trailers, truncates on a word. Five unit tests (`npm test`).
- **Page** — one repeated row: label · title / summary / `+adds −dels · files · cost` / area · who ·
  time. Bot PRs collapse to one line in Now. Tokens moved to `app/globals.css` `.todero`, shared with
  the landing. Designer pass done; the rejected meta row was rebuilt as two ranks.
- **Convention** — Paperclip's PR template kept, with Summary / Cost / Proof / Session prepended;
  root `CLAUDE.md` and `local/AGENTS.md` tell sessions to fill them.
- **Smoke** — `scripts/progress-smoke.mjs` walks redirect, wrong password, right password, both widths.

Not done: the CI run of the smoke (needs the three secrets in GitHub Actions); automatic cost from
Claude Code session logs or Todero run usage (follow-ups named in the PRD's cost section).
