# Corrected no-progress halt — apply to every future wave script

## The bug (Wave 3, measured)

```js
let bestFailed = Infinity
...
if (failed >= bestFailed) { flatRounds++; if (flatRounds >= 2) halt }
else { bestFailed = failed; flatRounds = 0 }
```

`failed` is the count of failing HARNESS checks. Round 1 usually drives it to 0,
so `bestFailed` becomes 0. From then on `0 >= 0` is true every round, the counter
climbs, and the piece halts at round 3 reporting `no progress: 0 checks still
failing` — a sentence that contradicts itself.

Result in Wave 3: **7 of 8 pieces halted this way. 0 of 8 passed.** The critic
work in rounds 2 and 3 was real and was discarded by a halt watching a signal
that had already gone flat by construction.

The halt was added citing Loop_Engineering element 3 — "stop when state stops
changing" — and then wired to a signal that stops changing as soon as the cheap
gate goes green. The gate passing is the START of the critic loop, not the end of
progress.

## The fix — composite progress

Progress is measured on whichever signal is currently in play:

```js
let bestFailed = Infinity      // harness failures
let bestScore  = -Infinity     // critic score, once the harness is green
let flatRounds = 0

// after each round, with `failed` from the harness and `score` from the critic
// (score is null when the harness was red, because no critic ran)
let improved
if (failed > 0) {
  improved = failed < bestFailed          // still red: fewer failures is progress
  if (improved) bestFailed = failed
} else {
  if (bestFailed > 0) {                   // just went green this round
    improved = true
    bestFailed = 0
  } else {
    improved = score != null && score > bestScore   // green: a better verdict is progress
  }
  if (score != null && score > bestScore) bestScore = score
}

if (improved) flatRounds = 0
else if (++flatRounds >= 2) halt
```

Two properties this restores:

1. **Going green counts as progress.** The round that fixes the harness resets the
   counter instead of starting it.
2. **Once green, the critic's score is the signal.** A piece that moves 4 → 6 → 7
   keeps its rounds; a piece stuck at 6 → 6 → 6 halts, which is the case the halt
   was actually for.

## Also raise maxRounds when the gate is cheap

Wave 3 gave every piece 3 rounds. Now that the harness answers in seconds and only
a green gate spends a frontier critic, the expensive part runs at most once per
round anyway — 4 or 5 rounds costs little more and gives the critic loop room to
converge. The round cap was sized for Wave 2's economics, where every round was
frontier-priced.
