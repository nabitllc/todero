# Todero — repo guidance for AI sessions

- **Every change ships through a pull request to `main`.** `/progress` (internal) reads merged PRs and direct
  commits; a PR carries the summary, cost, and proof — a direct commit carries only its message.
- **Fill the PR template's first four fields**: `Summary` (one sentence), `Cost` (`tokens= usd=` from your
  session; blank if unknown, never estimated), `Proof` (a URL, CI run, or screenshot), `Session` (who you are,
  e.g. "Claude Code on G14").
- Unattended sessions commit to a dated branch of their own and never push to `main` directly.
- The public site lives at the repo root (Next); the product lives under `local/` (see `local/AGENTS.md`).
