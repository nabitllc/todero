# Prompt — run a Todero work list as a gauntlet

Paste everything below the line into a Claude Code session opened on `C:\Development\Todero`,
after filling the WORK LIST. The `gauntlet` skill (Mich-Brain2, `Skills/gauntlet`) fires on the
first sentence and holds the rules; this prompt supplies what only this project knows.

---

Work through the WORK LIST below in a **gauntlet loop until done**. Nothing is fixed or built
before wave 1 has run.

## WORK LIST (Michael fills this in, one line each, in priority order)

1. …
2. …
3. …

Stop before any item Michael did not list. A new idea found on the way is a line in the wave
report's "what is next", never work.

## What this project already knows — use it, do not re-derive it

- `docs/ai_context/session_gates.md` is the authoritative list of verification commands and when
  to run them. `AGENTS.md`, `docs/ai_context/decisions.md` and `docs/ai_context/file_size_limits.md`
  are the constraints. Read all four before wave 1.
- Unit runner is Vitest through `pnpm test`; there is no jest and no eslint. Browser suites
  (`pnpm test:e2e`, `pnpm test:release-smoke`) are opt-in and only when the change touches them.
- Automation surface: the server's HTTP routes (`server/src/routes/`), the CLI, and the
  deterministic check scripts under `scripts/`. Anything reachable only by clicking the UI is a
  judge question, not a check.

## Set-up mode, in this order

1. Write `docs/ai_context/gauntlet/checks.json` with the surface named at the top and these
   checks, every one of which passed on main on 2026-09-06 per session_gates:

   ```json
   {
     "surface": "server HTTP routes + CLI + scripts/check-*.mjs; UI only through Playwright when a check demands it",
     "checks": [
       {"id": "smoke",             "cmd": "pnpm check:node-version && pnpm check:no-git-push", "timeout": 120},
       {"id": "tokens",            "cmd": "pnpm check:tokens && pnpm check:token-gates", "timeout": 300},
       {"id": "typecheck",         "cmd": "pnpm typecheck", "timeout": 900},
       {"id": "unit",              "cmd": "pnpm test", "timeout": 1800}
     ]
   }
   ```

   Then add one deterministic check **per WORK LIST item** that fails today and passes when the
   item is done (a Vitest file, a script asserting on a route's JSON, an exit code). If an item has
   no such check, say so in the wave-1 report and treat it as a judge question with a written
   acceptance sentence, not as "will know it when I see it".
2. Confirm the collector answers `http://127.0.0.1:4318/health` (it starts at logon; if it is down,
   `powershell -File C:\Development\Mich-Brain2\Wiring\gauntlet\start-collector.ps1`).
3. Run wave 1 and read it before touching code:
   `python C:\Development\Mich-Brain2\Wiring\gauntlet\wave.py run --wave 1 --checks docs/ai_context/gauntlet/checks.json --reports docs/ai_context/gauntlet/reports/ --label "baseline"`
4. Reply with the four answers: what moved (nothing, it is wave 1), what it cost, what is still
   broken (the per-item checks), what is next (the first item).

## Wave mode until green

Fix one item, rerun through the runner (never by hand), read the report. A regression from the
previous wave is worked before anything new. Every bug fixed leaves a repro under
`docs/ai_context/gauntlet/repros/` and a line in `checks.json`. The judge (opus, never local) is
asked only about what no check scored, with the brief the runner writes. Cost is measured or the
words "not measured", never an estimate.

## Hard limits for this repo

- One branch per WORK LIST item, `feat/<slug>` or `fix/<slug>`, a PR per branch, explicit file
  lists, never `git add -A`, never push `main`. The hand-off gate in session_gates runs before
  every PR is opened, not after.
- File-size caps in `docs/ai_context/file_size_limits.md` are a check, not advice: add
  `{"id": "file_sizes", "cmd": "<the repo's size check>"}` if one exists, or write one in wave 1.
- Never delete a test to make a wave pass. A check that encodes the wrong expectation gets
  rewritten in the open, with the reason in the wave report.
- If an item needs something only Michael has (a credential, an account, a product decision),
  the wave ends with it under "still broken" and names exactly what is needed.

## Done

"Done" is a runner wave with every check passing, its report on disk, and a PR link per item.
The closing message quotes the last report's four answers, lists the PRs, and states the honest
state: green, or "wave N, K checks failing, next is …".
