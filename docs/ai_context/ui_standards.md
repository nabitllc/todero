# UI Standards

## Precedence — read in this order

1. **`DESIGN.md`** at the repo root is the source of truth for UI design decisions in this repo.
   It already commits to the product stance, the single token source, eight principles, the
   enforcement bar for the simplification run, and the motion-token model. **This file does not
   restate it and does not override it.**
2. The vault's `Playbooks/UI_UX_Standards.md` — universal principles (mobile-first, semantic tokens
   only, border over shadow, required loading/empty/error/success states, the rendered-visual
   verification gate).
3. This file — only the design intent that `DESIGN.md` deliberately leaves open.

`DESIGN.md` says outright: *brand values (color, type, iconography) are intentionally unspecified;
they are being redesigned and will land as token values only.* That gap is what `critique-frontend`
Mode 0 is for, and what the rest of this file fills. Everything below is **stated intent for the
brand pass**, not a licence to change shipped values — `DESIGN.md` § Out of scope still forbids new
colours, new typefaces and layout restructuring during the simplification run.

## What DESIGN.md already settles — do not re-derive

- Single token source: `ui/src/index.css` (Tailwind v4, CSS custom properties via `@theme`). No
  parallel `ui/src/tokens/`. Runtime-tunable tokens must live in a non-`@theme inline` block.
- Token-only rule for `ui/src/components/**` and `ui/src/pages/**`: no hex, raw px, arbitrary
  bracket values, or raw `font-size`. Gate: `pnpm check:token-gates`.
- Locked radii: `--radius: 0.5rem` is the anchor (8px); `rounded-lg` **is** the anchor, with
  `--radius-sm/md/xl/2xl/3xl/4xl` derived by `calc()` from it (`ui/src/index.css:59-74`).
- Hierarchy through structure, not decoration. One component per job. Machine values in mono.
  One name per concept — the canonical term is **task**, never *issue* or *ticket*, in user-facing
  copy.
- Motion is tokenized in `:root` (not `@theme inline`), two tiers, `prefers-reduced-motion`
  collapses durations at the token layer.

## Mode 0 design intent — the part DESIGN.md leaves open

### The subject, in its own vocabulary

Todero is not a dashboard. It is a **company** — "if OpenClaw is an employee, Todero is the
company" (`README.md`). Its materials are the org chart, the shift log, the timecard, the ledger,
the approval slip and the audit trail. The user is an operator reading rows, deciding, and moving
on; `DESIGN.md` § Product stance already fixes the question every screen answers: *what is
happening, does it need me, what do I do about it.*

The design should read as **an operations ledger for a business that never closes** — not a
mission-control HUD.

### Colour — the substrate is achromatic; colour means something

Four semantic roles, and no fifth. This is already half-built in `ui/src/index.css`; the intent is
to make it a rule rather than an accident.

| Role | Meaning | Token family (existing) |
|---|---|---|
| **Substrate** | Every surface, border, and body/heading text. Carries **zero** chroma. | `--background`, `--foreground`, `--card`, `--muted`, `--border`, `--primary` — all currently OKLCH with chroma `0` (`index.css:75-93`, dark at `290-309`) |
| **State** | The status vocabulary an operator learns once. Never decorative. | `--status-task-*` (backlog / todo / in_progress / in_review / done / blocked / cancelled) and `--status-agent-*` (idle / running / paused / error), WCAG-tuned, `index.css:155-165` |
| **Identity** | Which agent did this. Recognisable at a glance across org chart, task rows, run log and cost tables. | `--agent-1a/1b` … `--agent-10a/10b`, `index.css:128-147` |
| **Alarm** | Destructive and irreversible only. | `--destructive` — the one saturated token in the semantic tier |

**The rule:** if a pixel is coloured, it is telling the operator a state, an identity, or a danger.
There is no brand accent applied decoratively. `--primary` is near-black
(`oklch(0.205 0 0)`) on purpose — the primary button is dark, not blue.

Why this is not the category reflex: the default answer for "AI agent orchestration tool" is a
near-black canvas with one electric accent (cyan, violet) sprayed across buttons, links, charts and
hero numbers. That palette makes colour meaningless exactly where this product needs it to be
load-bearing — an operator scanning forty task rows must read status by hue without stopping. Colour
is a scarce resource here, and it is spent on meaning.

### Type — sans and mono, paired as document and readout

- **Body and heading: InterVariable** (`--font-sans`, `index.css:23`). `--font-heading` currently
  aliases `--font-sans` (`index.css:66`) and should stay that way. There is no display face and
  should not be one: a display typeface is a magazine gesture, and nothing here is being read for
  pleasure.
- **Utility: the mono stack** (`--font-mono`, `index.css:24`) for every machine value — ids, costs,
  token counts, timestamps, log output — per `DESIGN.md` principle 6.

The pairing is therefore **document versus readout**, not display versus body. The contrast that
carries meaning is "a human wrote this" against "a machine produced this", and mono is the only
signal the operator needs. Hierarchy within the sans face comes from size, weight and space —
`UI_UX_Standards` § Visual hierarchy — never from a second family.

### Layout concept

**A dense ledger with a decision rail.** The primary column is a scannable list of rows (tasks,
runs, approvals, cost events) at a rhythm the eye can run down without re-anchoring; the
right-hand rail holds only what the operator must decide or act on now. Density comes from
information, never from chrome (`DESIGN.md` § Product stance). Cards are for genuine containers,
not for wrapping every region — a grid of identical icon-heading-text cards is an AI-slop tell
(`critique-frontend` Mode 1) and it destroys the row rhythm this product depends on.

### Signature element — the agent identity chip

Boldness is spent in exactly one place: **the agent identity chip**, drawn from the
`--agent-*` gradient pairs. It is the only saturated, non-semantic colour in the product. It appears
wherever an agent is the answer to "who" — org chart node, task assignee, run-log author, cost-table
row, approval requester — and it is the same colour for the same agent everywhere, so an operator
learns their team by hue the way they learn status by hue.

Everything else stays quiet: achromatic surfaces, hairline borders, no gradients, no glass, no
glow, no decorative shadow (border over shadow, per `UI_UX_Standards`).

### Reference and anti-reference

**Reference — Linear.** Take specifically: the row as the primary unit; status conveyed by a small
consistent chip rather than a coloured row; keyboard-first navigation; restraint in chrome so the
content is the interface. Take *structure and discipline*, not its palette.

**Reference — Stripe Dashboard.** Take specifically: dense tables that stay scannable, consistent
treatment of monetary and machine values, and the habit of putting the decision next to the number.
Budgets, cost events and spend caps are core Todero surfaces and this is the product that solved
reading them.

**Anti-reference — the mission-control HUD.** Grafana-style dark boards with glowing gauges, radial
meters, sparkline walls and a big hero metric. It looks like observation and reads like decoration;
it answers "how much" when this product must answer "does it need me".

**Anti-reference — the "AI swarm" look.** Near-black plus one acid accent, purple-blue gradients,
gradient text, glassmorphism, spotlight glow behind a hero, and tracked-caps eyebrows above
headings. All are named AI-slop tells in `critique-frontend` Mode 1 and are P0 findings here even if
a design comp contains them.

## Working rules

- Component library first: shadcn primitives in `ui/src/components/ui/`. Prove no existing component
  covers the job before adding one (`DESIGN.md` principle 1).
- Every interactive surface defines loading, empty, error and success states; AI surfaces also
  define thinking and streaming (`UI_UX_Standards` § States).
- Storybook is the verification surface, not the definition. Visual snapshots are baselined before a
  refactor; a change that alters rendered output must be intentional and human-approved
  (`DESIGN.md` § Enforcement).
- No UI surface is done without rendered visual evidence viewed at legible scale, region by region
  (`UI_UX_Standards` § Rendered-visual verification gate). A full-page thumbnail is not evidence.
- Run `pnpm check:token-gates` before committing UI changes. Note it currently fails on `main` for
  four pre-existing hex literals in a test file — see `session_gates.md`.
- **Never write an AI-slop tell into this file as a project pattern**, even if a shipped screen
  contains one. Record it as a carried defect (`critique-frontend` Mode 2).
