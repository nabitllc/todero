# Gauntlet

The project's artifacts for the vault's gauntlet loop (`Skills/gauntlet`, runner
`C:\Development\Mich-Brain2\Wiring\gauntlet\wave.py`). Nothing here is run by hand: a wave runs the
checks, diffs the previous wave, captures the telemetry window and writes the report.

- `checks.json`: the surface at the top, then the checks. Baseline checks first (smoke, tokens,
  typecheck, unit per package, file-size caps, the live loop on Ollama), then one check per work
  item that fails until the item is done.
- `checks/`: the scripts the checks call. `_lib.mjs` resolves the repo root; `vitest.mjs`, `tsc.mjs`
  and `pnpm-run.mjs` wrap the per-package commands that run on Windows (the full `pnpm typecheck` and
  `pnpm test` do not, see `../session_gates.md`); `repeat.mjs` runs a test file N times for timing
  flakes; `file-size-caps.mjs` turns `../file_size_limits.md` into a check against
  `file-size-allowlist.json` (the standing outliers on the day the check was added; a new outlier or
  a grown one fails); `live-loop.py` drives a throwaway organization through the routes.
- `reports/`: one report per wave, written by the runner.
- `repros/`: one file per fixed bug, runnable forever, each also listed in `checks.json`.

Run a wave from the repo root:

```bash
python C:/Development/Mich-Brain2/Wiring/gauntlet/wave.py run --wave N --checks docs/ai_context/gauntlet/checks.json --reports docs/ai_context/gauntlet/reports/ --label "..."
```

The collector must be listening on 127.0.0.1:4318 first (`Wiring/gauntlet/start-collector.ps1`);
without it the cost section is blank, and the report says so rather than estimating.
