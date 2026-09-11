# Wave 1 verdict

## 1. Which failures share a root cause

**Two clusters, and one non-failure.**

**Cluster A — the live loop and everything it dragged with it.** The timeout, the banned word "issue" in notices to the person, the doubled `finish_successful_run_handoff` wake, and the two tasks that ended "waiting on you" are all one cause: since the manager wave, approving a plan starts the first task of every feature at once, and nothing enforces the agent's own `maxConcurrentRuns: 1`. Four turns hit a single model, two starved past their limit, and the recovery path fired — the copy defect and the duplicate wake are that path's output, not separate bugs. The same check passing in two minutes on an idle machine confirms it: contention, not the loop.

**Cluster B — checks that hard-code a snapshot of the world.** The symlink cases assumed a host that can make symlinks; the size allowlist assumed a repo state from before PR 92. Neither says anything about the product. Both are now fixed by deciding at runtime instead of at authoring time.

**Not a failure:** item1–item4 fail because their code does not exist yet. That is the point of a red check.

## 2. What wave 2 should add, and stop

**Add** — turn cluster A's residue into cheap deterministic checks so the slow live loop is not the only thing that catches it: one that plan approval never starts more runs than the agent's concurrency limit; one that a wake is delivered once; one that user-visible recovery copy carries no banned words. Fix the fan-out first — the other three should then pass without touching the recovery service.

**Stop** — repeating the task-drain test locally. It passed, and the flake has only ever appeared on the GitHub runner, so the local repeat scores nothing. Keep the work item; move its evidence to CI.
