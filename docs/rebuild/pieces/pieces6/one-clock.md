# one-clock — every duration in this app is spelled one way

**Piece:** pieces6 / one-clock
**Branch:** rebuild/2026-08-26
**Home of the clock:** `lib/time.ts`

---

## The defect

Nine independent duration formatters produced up to six different spellings of
one duration.

| input | renderings found across the app before this piece |
|---|---|
| 90s | `1m` · `2m` · `1m 30s` · `1m ago` · `2m ago` |
| 59m 30s | `59m` · `1h 0m` · `59m 30s` · `59m ago` · `1h ago` |
| 26h | `1d 2h` · `26h 0m` · `1560m 0s` · `26h ago` · `1d ago` · `1560m ago` |

The nine (plus two more the sweep found in files this piece owns):

| # | file | symbol |
|---|---|---|
| 1 | `lib/bolt-time.ts:176` | `windowLabelFor` |
| 2 | `lib/bolt-time.ts:219` | `formatRemaining` |
| 3 | `lib/fleet-liveness.ts:115` | `formatAge` |
| 4 | `lib/memory-budget.ts:257` | `relativeTime` |
| 5 | `components/nav/RunsView.tsx:49` | `fmtDuration` |
| 6 | `components/office/officeDrawing.ts:47` | `formatElapsed` |
| 7 | `components/tabs/OverviewTab.tsx:222` | `formatElapsed` |
| 8 | `components/InboxDrawer.tsx:39` | `timeAgo` |
| 9 | `components/tabs/InboxTab.tsx:77` | `timeAgo` |
| 10 | `components/NotificationBell.tsx:22` | `timeAgo` |
| 11 | `components/tabs/SettingsTab.tsx:50` | `timeAgo` |
| +1 | `components/InboxDrawer.tsx:31` | `timeRemaining` (a twelfth, unlisted — a countdown) |
| +1 | `components/office/officeDrawing.ts:~546` | inline idle-timer arithmetic (a thirteenth, unlisted) |

And `lib/time.ts` — whose own header says *"all scheduling math and display
lives in THIS file. Everything else imports from here"* — had **zero
importers**. The declared single source of truth was dead code while thirteen
ad-hoc copies existed.

---

## Where the clock lives, and why

**`lib/time.ts`.** Not `lib/fleet-liveness.ts`.

The smoothing pass was right that `formatAge` is the authoritative *algorithm*
— it is pure, carries no "ago" suffix, is unit-correct past 24h, and is already
unit-tested. But `lib/fleet-liveness.ts` is, by its own header, "the Fleet
surface's liveness vocabulary": a module scoped to one artboard's question.
Making the whole app import its duration spelling from the Fleet roster would
put a general-purpose primitive behind a domain door, and the header would then
be false in the other direction.

`lib/time.ts` already claims the charter. It had no importers, which is a bug in
the codebase, not evidence the charter was wrong. So: **`formatAge`'s algorithm
moves into `lib/time.ts` as `formatDuration`, and `lib/fleet-liveness.ts`
re-exports `formatAge` from it.** Both defects — nine copies, and a dead source
of truth — close with the same move, and
`lib/__tests__/fleet-liveness.test.ts` keeps passing without a single edit.

It moves with **exactly one behavioural change**: seconds are truncated, not
rounded (see *Truncate, never round* below), so that the whole module obeys one
rule. `formatAge(3999)` was `4s` — a claim that four seconds had elapsed when
they had not — and is now `3s`. Every value `formatAge`'s own tests assert is a
whole number of seconds, so the difference is invisible to them; it shows only
on sub-second fractions, where truncating is the honest direction.

---

## Two modes, and why there are two and not one

A duration in the **past** and a duration **remaining** are different
quantities, and one of the differences between them is load-bearing.

- **`formatDuration(ms)` — elapsed / age.** Days appear from 24h up.
  `26h` → `1d 2h`.
- **`formatCountdown(ms)` — remaining.** Days appear only from **48h** up.
  `26h` → `26h`.

That second rule is not a stylistic choice. `lib/bolt-time.ts` documents it:
a 24h bolt with nine hours left must never render "0 days left" — that
fabrication is what TOD-2401 deleted. Under 48h a countdown therefore counts in
hours and refuses day units entirely. An **age** has no such hazard: "1d 2h ago"
is true and readable, and it is what the Fleet artboard specifies.

`26h` is therefore the **only** input in this spec with two renderings, and the
two are never ambiguous because the label beside them differs (`left` vs `ago`).

Every other arithmetic difference among the thirteen formatters was an accident
and is deleted.

### The two other deliberate countdown-only rules, preserved verbatim

1. `formatCountdown(ms)` with `ms <= 0` returns **`'ended'`**, never `'0s'`.
2. `formatCountdown(ms)` with `0 < ms < 60s` returns **`'<1m'`**, never `'0m'`
   and never `'0s'`. A countdown does not claim second-precision on a value the
   UI polls at minute cadence, and — the actual reason — the alternative is the
   "0 units left" shape one unit further down. `formatDuration` has no such
   guard because `45s` elapsed is exactly true.

### Truncate, never round

Every unit is **truncated**, never rounded up. A duration must never claim more
of a unit than has actually elapsed, or more time than actually remains.

This is a behaviour change for `formatRemaining` and `windowLabelFor`, which
rounded to whole minutes first. Rounding is what made `90s` render as `2m` on
the bolt card and `1m` on the Fleet roster — one of the three headline
disagreements. Truncation also fixes, more simply, the bug the rounding was
introduced to prevent: `1h 59m 58s` truncates to `1h 59m` and can never carry
into a literal `60m`.

---

## The one clock's API

All in `lib/time.ts`.

```ts
/** Elapsed time / age. The canonical spelling. Negatives clamp to '0s'. */
export function formatDuration(ms: number): string

/** Time REMAINING. 'ended' at <=0, '<1m' under a minute, no day units under 48h. */
export function formatCountdown(ms: number): string

/** Age of a timestamp, suffixed. '' — never a plausible age — when absent or unparseable. */
export function formatAgo(at: TimeInput, now?: number): string

/** Elapsed since a timestamp. null when absent or unparseable. */
export function formatSince(at: TimeInput, now?: number): string | null

/** Elapsed between two timestamps; `end` null means "still running, measure to now". */
export function formatElapsedBetween(start: TimeInput, end: TimeInput, now?: number): string | null

/** Milliseconds from a string | number | Date, or null. The one parse. */
export function toEpochMs(at: TimeInput): number | null

export type TimeInput = string | number | Date | null | undefined
```

`formatAgo`, `formatSince` and `formatElapsedBetween` do no arithmetic of their
own beyond a subtraction; every unit decision happens in `formatDuration`.
`formatCountdown` shares the same decomposition and differs only by the three
documented rules above.

---

## ACCEPTANCE

1. **`lib/time.ts` has importers.** At minimum `components/nav/RunsView.tsx`,
   `components/office/officeDrawing.ts`, `components/InboxDrawer.tsx`,
   `components/NotificationBell.tsx`, `components/tabs/SettingsTab.tsx`. Its
   header no longer claims a charter nothing honours.

2. **`formatDuration` is `formatAge`'s algorithm, with truncation as its only
   behavioural change.** `lib/__tests__/fleet-liveness.test.ts` passes with no
   edit to it, and `lib/__tests__/time.test.ts` asserts the one difference
   directly: `formatDuration(3_999)` is `3s`, not `4s`.

3. **`lib/__tests__/time.test.ts` exists and asserts an exact string for every
   row of the tables in §ACCEPTANCE-4, -5, -6 and -7.** A formatter with no test
   asserting an exact string is how thirteen spellings happened; a table in a
   doc with no test behind it is how they would come back.

4. **`formatDuration` — elapsed / age. One rendering per input.**

   | ms in | rendering |
   |---|---|
   | `-5000` | `0s` |
   | `0` | `0s` |
   | `3_999` | `3s` |
   | `4_000` | `4s` |
   | `11_000` | `11s` |
   | `45_000` | `45s` |
   | `59_400` | `59s` |
   | `90_000` | `1m` |
   | `15 * 60_000` | `15m` |
   | `59 * 60_000 + 30_000` | `59m` |
   | `60 * 60_000` | `1h` |
   | `4h + 12m` | `4h 12m` |
   | `23h + 59m` | `23h 59m` |
   | `24h` | `1d` |
   | `26h` | `1d 2h` |
   | `47h` | `1d 23h` |
   | `13d` | `13d` |
   | `13d + 4h` | `13d 4h` |

5. **`formatCountdown` — remaining. One rendering per input.**

   | ms in | rendering |
   |---|---|
   | `-5 * 3600_000` | `ended` |
   | `0` | `ended` |
   | `1` | `<1m` |
   | `20_000` | `<1m` |
   | `59_000` | `<1m` |
   | `90_000` | `1m` |
   | `45 * 60_000` | `45m` |
   | `59 * 60_000 + 30_000` | `59m` |
   | `1h + 59.97m` | `1h 59m` |
   | `9h` | `9h` |
   | `9h + 58m` | `9h 58m` |
   | `24h` | `24h` |
   | `26h` | `26h` |
   | `47h` | `47h` |
   | `48h` | `2d` |
   | `13d` | `13d` |
   | `13d + 4h` | `13d 4h` |

   Explicit negative assertions, one per deleted defect:
   `formatCountdown(9h)` is not `0d`; `formatCountdown(20_000)` is not `0m` and
   not `0s`; `formatCountdown(1h + 59.97m)` is not `60m` and not `2h`;
   `formatCountdown(26h)` is not `1d 2h`.

6. **`formatAgo` — never fabricates.**

   | input | rendering |
   |---|---|
   | `null` | `''` |
   | `undefined` | `''` |
   | `''` | `''` |
   | `'not a date'` | `''` |
   | `NaN` | `''` |
   | 5s in the past | `5s ago` |
   | 90s in the past | `1m ago` |
   | 59m 30s in the past | `59m ago` |
   | 3h in the past | `3h ago` |
   | 26h in the past | `1d 2h ago` |
   | 2d in the past | `2d ago` |
   | 4m in the future | `in 4m` |

   `formatAgo(null)` returning `''` is the Fleet honesty rule applied to the
   clock: a missing timestamp has no age, and must not render a plausible one.

7. **`formatSince` / `formatElapsedBetween` return `null`, not a string,** when
   the start is absent or unparseable — so a caller must decide what to print
   rather than being handed a fabricated `0s`.

8. **The three headline disagreements are gone.** A test asserts directly that
   for `90s` and for `59m 30s`, `formatDuration`, `formatCountdown` and the age
   rendered by `formatAgo` (minus its suffix) are the **same string**; and that
   for `26h` exactly one pair differs, in exactly the documented direction
   (`1d 2h` for an age, `26h` for a countdown).

9. **Every duration on screen is labelled.** A bare duration beside a run title
   is the actual defect in Runs: `30s` (start→completed) and `14h 37m`
   (start→now) are both correct and nothing said which was which.
   - `components/nav/RunsView.tsx` renders `ran 30s` for a finished run and
     `running 14h 37m` for a live one, and the column header says `Duration`.
     A run with no `started_at` renders `—`.
   - `components/office/officeDrawing.ts` labels the canvas figure's timer
     `running <duration>`, not a bare `⏱ 12m`.

10. **Every file this piece owns computes no duration arithmetic of its own.**
    `grep -n '60000\|3600000\|86400000'` over `lib/time.ts`'s five consumers
    returns nothing but one threshold constant.

    This is deliberately scoped rather than claimed absolutely. `lib/bolt-time.ts`
    learned that lesson the hard way — its header records an earlier version
    claiming "every bolt-time decision lives here and nowhere else", falsified
    by a critic in one grep. **The app-wide claim would be false today**: the
    sweep that named nine formatters undercounted. §REMAINING lists the ones
    still outstanding, and none of them is in this piece's scope.

11. **Gates.** `npx tsc --noEmit` clean; `npm test` at the known five
    pre-existing failures (`agents-route`, `agents-unconfigured`, `spawn-live`)
    and no others; `node scripts/acceptance/run.mjs` 45/45;
    `bash scripts/smoke-test-layout.sh` passing.

---

## HANDOFF — the five files this piece does not own

Each needs its local formatter deleted and replaced by a delegation. None
changes a call site.

| file | line | replacement |
|---|---|---|
| `lib/fleet-liveness.ts` | 110–126 | delete `formatAge`'s body; `import { formatDuration } from './time'` and `export const formatAge = formatDuration` (or a re-export). Its tests then pass unchanged. |
| `lib/bolt-time.ts` | 176–182 | delete `windowLabelFor`; call `formatCountdown(windowMs)` from `classifyWindow`. |
| `lib/bolt-time.ts` | 219–235 | delete `formatRemaining`'s body; `export { formatCountdown as formatRemaining } from './time'`. |
| `lib/memory-budget.ts` | 257–269 | delete `relativeTime`'s body; delegate to `formatAgo`. Its tests pass unchanged. |
| `components/tabs/OverviewTab.tsx` | 222–230 | delete the local `formatElapsed`; import `formatDuration` from `@/lib/time`. |
| `components/tabs/InboxTab.tsx` | 77–84 | delete the local `timeAgo`; import `formatAgo` from `@/lib/time`. |

**One existing test changes, and it must:**
`lib/__tests__/bolt-time.test.ts:122` asserts
`formatRemaining(HOUR + 59.97 * 60000)` is `'2h'`. Under truncation it is
`'1h 59m'`. That is the stronger assertion — the test's own stated purpose is
"do not print 60m", which truncation satisfies, while `'2h'` additionally
overstates the remaining time by 1.8 seconds. Replace the expectation with
`'1h 59m'` and keep a `.not.toBe('60m')` beside it.

---

## REMAINING — the sweep undercounted

The piece was scoped to nine formatters. A grep for duration arithmetic
(`/ 60000`, `/ 3600000`, `/ 86400000`) across `app/`, `components/`, `lib/` and
`hooks/` finds more. None is in this piece's ownership, and none is fixed here.
Listing them so the next round starts from a true number rather than from nine.

**Renders an "ago" string, so it is a fourteenth+ spelling of an age:**

| file | line | current behaviour |
|---|---|---|
| `components/ActiveAgentsCard.tsx` | 52 | `'just now'` under 1m |
| `components/ActivityFeed.tsx` | 22 | `'just now'` under 1m |
| `components/tabs/ActivityTab.tsx` | 182 | `'just now'` / `Xm ago` / `Xh ago` — caps at hours |
| `components/tabs/AIServicesTab.tsx` | 52–54 | `'just now'` under 1m, caps at hours |
| `components/crew/AgentDetailView.tsx` | 46 | rounds to minutes |
| `components/tabs/AgentDetailView.tsx` | 127 | rounds to minutes (a second copy of the line above) |
| `components/office/OfficeSidebar.tsx` | 261 | `Last active Xm ago` — minutes only, so 26h reads `1560m ago` |
| `components/office/OfficeCanvas.tsx` | 638 | `idle Xm` — minutes only |
| `components/tabs/AutomationsTab.tsx` | 129 | `Xm ago` — minutes only |
| `components/tabs/CalendarTab.tsx` | 297 | `Xm ago` — minutes only (same line as above) |
| `components/tabs/InfraTab.tsx` | 316 | rounds to minutes |
| `lib/member-utils.tsx` | 47 | rounds to minutes |
| `components/tabs/ApprovalCard.tsx` | 43 | a second countdown, independent of `formatCountdown` |
| `components/tabs/ProductBoardTab.tsx` | 178 | rounds to minutes |
| `lib/run-trace.ts` | 271, 278 | step durations, its own spelling |
| `app/page.tsx` | 590, 672, 700 | `Xm ago` / minutes-until |
| `app/api/activity-feed/route.ts` | 165 | server-side `agoMin` |
| `app/api/agents/route.ts` | 337, 473, 563 | server-side `agoMin`, three copies |
| `app/api/office-stream/route.ts` | 31 | server-side elapsed minutes |
| `app/api/status/route.ts` | 267 | server-side elapsed minutes |

**Not a duration formatter, and correctly left alone:** `lib/mc-constants.ts`
`daysUntil` / `daysSince` return numbers, not strings, and no caller renders
them as a duration.

## A SECOND UNLABELLED DURATION, still live

`components/tabs/OfficeTab.tsx:112` renders `formatElapsed(r.started_at)` — time
since the run STARTED — as a bare duration under a "RECENT" heading, beside a
run title. Observed on the running app with a fixture whose run took 26h and
started 100h ago:

- Fleet ▸ Office roster: `4d 4h` (start → now)
- Runs table: `ran 1d 2h` (start → completed)

Same run, two correct numbers, and only one of them says what it measures. This
is acceptance item 9 applied to a file this piece does not own. The fix is one
word, not a formatter: label it `started 4d 4h ago`. `OfficeTab.tsx:112` also
falls back to `|| '<1m'` when `formatElapsed` returns null, which renders "under
a minute" for a run whose `started_at` is null — a plausible number in place of
a missing one. It should render `—`.
