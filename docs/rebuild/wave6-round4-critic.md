# Wave 6, round 4 — critic verdict (cards-and-identity)

Scored 2026-08-26 by a critic with fresh context, barred from every wave report
and from HANDOFF.md, judging the running app at localhost:3000 and the source.

## SCORE: 6/10 — FLAT

Wave 6 scores: round 1 = 4, round 2 = 5, round 3 = 6, **round 4 = 6**.

Under the composite-progress rule in `LOOP-FIX.md`, the harness is green
(45/45), so the signal in play is the critic score. 6 is not greater than the
prior best of 6, so this round did **not** improve: `flatRounds = 1`.
**One more flat round halts the wave.** That is the halt working as designed —
the case it was actually built for — not the Wave 3 bug.

## What passed, measured

| Acceptance item | Verdict |
|---|---|
| 1. Fills the pane at 1280/1024/820/375 | PASS — 0px gutter at all four, no h-scroll |
| 2. Wordmark / project name / breadcrumb gone | PARTIAL — switcher is a no-op |
| 3. Rail shows `L`, no business | PASS |
| 4. Now fits one screen at 1280x800 | PASS — 752px in 800 (was ~1250) |
| 5. Every card states its source | PARTIAL — one page-size rendered as a count |
| 6. No day-granularity math over an hours window | **FAIL** |
| 7. tsc / smoke / harness | PASS — 45/45 in 4274ms |

## The failure that matters — item 6

The piece doc predicted the TOD-2401 fabrication class would return "in new
clothes" in the bolt half. It did, twice, and it took a two-row fixture to see:

1. **`OverviewTab.tsx:378,400` — the `24h` pill is hardcoded.** A `sprints` row
   with `start_date = NULL` gives `windowMs === null`, which falls through to
   `'Bolt'`, which stamps a literal `24h` badge. A fixture row with `end_date`
   11 days out rendered `24h` directly above `10d left` — the badge contradicting
   the number beneath it, inside the same tile. `isBolt` also accepts anything
   `<= 30h`, so a 4-hour window also renders `24h`.

2. **`OverviewTab.tsx:382` — an ended bolt hijacks the live countdown.**
   `soonest` reduces on `remainingMs`, which goes negative when expired, so an
   expired row always wins. With one bolt ended 6h ago and one with 9h to run,
   the card's headline read `ended left` while the active bolt below it showed
   `8h 58m left`. Functionally identical to TOD-2401's "0 days left · 100%
   elapsed": a dead row hijacking a live countdown.

`formatRemaining` itself was hardened and is correct. The *selection* feeding it
was left unguarded. Hardening the formatter and not the selector is the whole
defect.

## Other confirmed defects

- **`PrimaryNav.tsx:74`** — `canSwitch = hubs.length > 1` is false with one hub,
  so the switcher is a no-op, while `aria-haspopup="listbox"` is emitted
  unconditionally at `:98`. The button advertises a popup to assistive tech that
  it can never open.
- **`OverviewTab.tsx:434,440,456`** — Recent activity renders `res.data.length`
  from a query with `limit: 5`, labelled `events`. With 400 events it would read
  `5 events`. A page size presented as a count.
- **Needs you** — its empty state claims Limiglow scope while its own source line
  marks the inbox leg `(fleet-wide)`. The two `/api/db/issues` legs are genuinely
  scoped (the seam refuses an unscoped read); the inbox leg is not.
- **Subscriptions & Balances / Per-Project Progress** — `OverviewTab.tsx:12-19`
  says they "moved" to Settings and Work. They appear nowhere in `app/` or
  `components/` except that comment. The spec said move; they were deleted.

## One critic finding that was a false positive — and why

The critic flagged the `OWNER CORRECTION` comment blocks in `BusinessRail.tsx`,
`PrimaryNav.tsx` and `app/page.tsx` as quoting owner speech with no repo record,
and therefore as fabricated authority for overriding the piece spec.

**The authority does exist** — `HANDOFF.md:83-85` records "Hub = Slack
Workspace... the 14px left rail is the hub switcher and stays permanently. One
hub today: Limiglow." The critic was barred from HANDOFF.md, so it could not see
it, and it hedged correctly ("either the record was not updated, or the authority
is not there") rather than asserting fabrication.

**The bar caused the false positive.** Barring the critic from builder narrative
is right; HANDOFF.md is not builder narrative, it is the decision record. Future
critics should be barred from `wave*-report.md` only, and given HANDOFF.md's
"Owner decisions already made" section as part of the rubric.

**A smaller real defect survives inside it:** the piece spec
(`pieces6/cards-and-identity.md`) still says the rail shows PROJECTS and that
businesses move into Settings. HANDOFF.md says the rail is the HUB switcher and
stays. Those contradict, and the spec is the older of the two. The verbatim owner
quotes live only in code comments, never in `FEEDBACK.md`, whose stated purpose
is to hold exactly that — and whose own first line warns that feedback held
outside the record is what gets lost.

## Biggest gap — becomes the next piece

**Give Work the card treatment, and make the bolt a real object while doing it.**

Work is where the operator lives, absorbed eight of the twenty old tabs, and has
zero card treatment. The owner's table (`FEEDBACK.md:46`) names its four cards:
Bolt board, Backlog, Epics, Due — which makes the bolt work part of the Work
work. `components/nav/Card.tsx` implements the full contract and has exactly one
consumer; the next piece should be its second.

The bolt-time logic must be extracted from `OverviewTab.tsx:110-124` into one
shared module so `formatRemaining`, the `isBolt` test and the live-vs-ended
selection have a single implementation — with the `24h` badge derived from the
row's real window, and the headline picking the soonest FUTURE end rather than
the smallest signed number.
