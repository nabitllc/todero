# File Size Limits

**Status: inherited from the vault.** Todero does not set its own thresholds — searched
2026-09-06 across `*.md`, `*.mjs` and `*.json` for "line limit", "max-lines", "200 lines",
"300 lines", "file size" and "LOC limit"; nothing matched, and there is no ESLint config (and so no
`max-lines` rule) anywhere in the repo. These are therefore the defaults from the vault's
`Me/tech_stack.md` § Universal coding defaults, applied verbatim until this project sets its own.

| File type | Target | Soft cap | Hard cap |
|---|---|---|---|
| Component | 200 | 300 | 400 |
| Page | 150 | 250 | 350 |
| Hook / utility | 150 | 200 | 300 |
| Module / feature | 300 | 500 | 800 |
| SQL migration | 200 | 300 | 500 |

**The rule that matters:** when a file approaches its soft cap, extract *before* adding new code.
The cap is a trigger to refactor, not a budget to spend.

Entry-point files are governed separately by the vault's `Project_Bootstrap_Standard` § Eager-load
discipline: `CLAUDE.md` stays 30-100 lines, pointer-style. `AGENTS.md` (224 lines) is exempt — the
vault waived it on 2026-08-26 because it is parsed data, not documentation
(`Wiring/projects.json`, `entry_point_exempt`).

## Reality check — the repo is far past these today

Measured 2026-09-06 with `wc -l`:

| File | Lines | Bracket | Over hard cap by |
|---|---|---|---|
| `server/src/services/heartbeat.ts` | 20,351 | Module | 25x |
| `ui/src/pages/IssueDetail.tsx` | 5,773 | Page | 16x |
| `ui/src/components/IssueChatThread.tsx` | 5,343 | Component | 13x |
| `ui/src/index.css` | 2,496 | Token layer | n/a |

Do not read that as permission. It is standing debt, and it is why the caps are worth stating: the
files above are the ones a session is most likely to be asked to change, and each is already past
the point where "add one more function here" is the right move.

**Applying this to existing code:** the caps gate *new* files and *new* extractions. When you touch
one of the outliers, the expectation is that you do not make it longer — extract the region you came
to change rather than appending to it. A wholesale split of `heartbeat.ts` or `IssueDetail.tsx` is a
planned refactor with its own PR and its own coordination in Discord `#dev` per `CONTRIBUTING.md`,
not something to do as a side effect of a bug fix.

`ui/src/index.css` is the single token source and is explicitly allowed to grow;
`DESIGN.md` § The token layer permits extracting values into a `tokens.css` **imported by**
`index.css` if it becomes unwieldy, but forbids a parallel token source such as `ui/src/tokens/`.
