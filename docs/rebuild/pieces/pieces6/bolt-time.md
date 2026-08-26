# PIECE: One bolt clock, and a window that tells the truth

id: bolt-time
lane: Operator
follows: cards-and-identity (round 4, scored 6/10 — item 6 FAILED)

OWNS EXCLUSIVELY: lib/bolt-time.ts (new), lib/__tests__/bolt-time.test.ts (new),
components/tabs/OverviewTab.tsx, app/api/sprint-start/route.ts

DO NOT TOUCH: components/nav/**, app/page.tsx — the Work destination piece owns
those next, and a bolt board will consume this module rather than re-implement it.

## Why this piece exists

Round 4 was told, in writing, that day-granularity math over an hours window is
the TOD-2401 fabrication and must not return "in new clothes". It returned. The
critic found it with a two-row fixture:

- A `sprints` row with `start_date = NULL` rendered a hardcoded `24h` badge
  directly above `10d left` — the badge contradicting the number beneath it,
  inside the same tile.
- With one bolt ended 6h ago and one with 9h to run, the card's headline read
  `ended left` while the live bolt below it showed `8h 58m left`.

`formatRemaining` was hardened in round 4 and is correct. The SELECTION feeding
it was not. Hardening the formatter and leaving the selector unguarded is the
whole defect, and it is why this piece is about one module rather than one fix.

## Two structural facts found while scoping this, which the piece must respect

1. **`start_date` and `end_date` are `DATE`** (`migrations/000_baseline_schema.sql:76-77`,
   never altered). A bolt therefore cannot carry an hour. Every bolt is
   midnight-to-midnight by construction, and HANDOFF.md's "opens automatically at
   a set time" is not achievable without a migration — which the previous piece
   explicitly forbade. **Do not migrate in this piece.** Render what the column
   can actually support and say so; propose the migration separately.

2. **Date-only strings parse as UTC.** `new Date("2026-08-27")` is
   `2026-08-27T00:00:00Z`. The owner is at UTC-4, so a bolt ending "the 27th"
   currently renders `ended` at 8pm local on the 26th — four hours early, on the
   landing screen. This is a live off-by-one-timezone, not a theoretical one.

## Build instruction

### 1. One module: `lib/bolt-time.ts`
Every bolt-time decision lives here and nowhere else. Export:

- `parseBoundary(value)` — parses a `DATE` string as **local** midnight, not UTC.
  A value that already carries a time is respected as-is.
- `classifyWindow(start, end)` -> `{ windowMs, kind, windowLabel }` where `kind`
  is `'bolt' | 'sprint' | 'unknown'`. `unknown` when either boundary is missing.
  `windowLabel` is derived from the REAL window (`24h`, `4h`, `13d`) and is
  `null` when `kind` is `'unknown'`. There is no literal `24h` anywhere.
- `formatRemaining(ms)` — moved verbatim from `OverviewTab.tsx:105-121`. It is
  correct; it is moved so there is one copy, not two.
- `pickHeadline(rows)` -> the soonest row whose end is in the FUTURE. Only when
  no row is live does it fall back to the most recently ended, and it returns a
  discriminated result so the caller cannot render `ended` under the word `left`.

### 2. `OverviewTab.tsx` consumes it
Delete the local `formatRemaining`, the inline `isBolt`, the `noun` ternary and
the `soonest` reduce. The `24h` badge becomes `windowLabel`, rendered only when
`kind !== 'unknown'`. The headline's label is derived, never the constant `'left'`.

### 3. `app/api/sprint-start/route.ts`
The comment at `:79` says "24h: today 7am to tomorrow 7am". The code writes
`.toISOString().split('T')[0]` — date-only, midnight to midnight. **Delete the
claim or make it true.** Since the column is `DATE`, make the comment true: say
it writes whole dates and that hour-accurate bolts need a `TIMESTAMPTZ`
migration. A comment describing behaviour the code does not perform is the
failure class this rebuild has paid for three times.

## ACCEPTANCE — verified against the RUNNING app

Dev server is already running at http://localhost:3000. Do NOT restart it and
NEVER run `npm run build`. `npx tsc --noEmit` is safe.
Auth: `cookie: mc-auth=kaos2026; mc-role=owner`.

Every item below must be proven with a FIXTURE ROW, then the fixture removed and
`sprints` returned to empty. Correctness that depends on empty data is not
correctness.

1. A row with `start_date = NULL` renders **no window badge at all** — not `24h`,
   not `Bolt`. Show the row and the rendered tile.
2. A row with a real 4-hour window renders `4h`, not `24h`.
3. A row with a real 24-hour window renders `24h`.
4. A two-week row renders `13d` or `14d` and the noun `Sprint`, never `Bolt`.
5. With one ended row and one live row present, the card headline shows the LIVE
   row's remaining time. The string `ended left` must not appear in the DOM at
   any point. Show both rows and the headline.
6. With ONLY ended rows present, the headline says so in words that are not
   `left`. Show it.
7. A row with `end_date` = tomorrow's date renders a countdown that expires at
   LOCAL midnight, not UTC midnight. State the tester's offset and both times.
8. `grep -rn "24h" components/ app/ lib/ --include=*.ts --include=*.tsx` returns
   no hardcoded window literal rendered as data.
9. `formatRemaining` exists in exactly ONE file.
10. `npx tsc --noEmit` clean, `bash scripts/smoke-test-layout.sh` passes,
    `node scripts/acceptance/run.mjs` reports 45/45 in about 4 seconds. If it is
    slow or mass-failing the SERVER is unhealthy, not the product — say so.
11. `lib/__tests__/bolt-time.test.ts` covers, at minimum: the null boundary, the
    negative-remaining selection, the local-vs-UTC boundary, and the 4h/24h/2w
    classification. Prove each guard FAILS when it should, not only that it
    passes when it should.
