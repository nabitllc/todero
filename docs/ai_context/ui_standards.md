# Todero public surface — UI standards

Scope: the public landing at `/` (`app/page.tsx`, `app/page.module.css`, `app/WaitlistForm.tsx`).
`/demo` carries the in-app work-item tokens (`app/demo/work-item.css`); `/progress` is a plain board.
The local app under `local/` has its own system.

## Mode 0 (written 2026-09-01, before code)

**World.** An octopus: one animal, eight semi-autonomous arms, deep water, ink. A laptop. A person
who hires. Not a cloud console.

**Color.** OKLCH, hue 172 — the in-app kelp hue, so the landing and `/demo` read as one product.
Six semantic values plus one derived hairline. Register: drenched (the ground is the color).

| Token | Value | Role | Contrast on ink |
|---|---|---|---|
| `--ink` | oklch(0.17 0.028 172) | ground | — |
| `--shallows` | oklch(0.23 0.03 172) | raised surface (input) | — |
| `--bone` | oklch(0.94 0.012 172) | text | ≈13:1 |
| `--kelp` | oklch(0.72 0.12 172) | the one accent: button, mark, focus, selection, H1 line 2 | ≈7.5:1 (ink text on kelp ≈7.5:1) |
| `--drift` | oklch(0.72 0.03 172) | muted text | ≈7:1 |
| `--coral` | oklch(0.76 0.13 30) | error only | ≈8:1 |
| `--line` | bone 14% into ink | hairline (footer top, input border) | derived |

No hex/rgb in JSX. SVG uses `currentColor`.

**Type.** IBM Plex Sans (display + body) + IBM Plex Mono (utility). Same pair as in-app.
Loaded with `next/font/google`, no CSS `@import`. Scale ratio 1.25:
`xs 0.8125rem · sm 0.9375rem · base 1.0625rem · lg 1.375rem · xl 1.75rem · display clamp(2.5rem, 1rem + 6.5vw, 5.5rem)`.
Body 1.6 line-height, +0.005em tracking (light-on-dark compensation). Display 500, -0.03em.
Mono: labels, FAQ questions, footer, and the H1's second line.

**Layout.** A left-anchored reading column inside a 72rem page: the H1 spans the width, breath and
the waitlist sit side by side beneath it at ≥64rem; six bands follow as a two-column ledger
(heading 14rem | prose ≤60ch) separated by `clamp(4rem, 10vw, 7rem)` of whitespace alone; the FAQ is a
mono-question / sans-answer list. One reading path, one action; hierarchy carried by space, not chrome.

**Signature.** The H1's second line, `on your laptop.`, in Plex Mono at display size, in kelp.
The laptop is literal. Everything else is quiet. No screenshot, no illustration, no metrics.

**Spacing.** 4pt scale as `--s-4 … --s-64`; fluid `--pad-x`, `--gap-band`, `--hero-top`.

**Radii (locked).** `--radius-control: 6px` for input and button. Surfaces are square. No other radius.

**Borders over shadows.** No shadows anywhere. Two hairlines on the page: input border, footer top.

**Controls.** Min height 3rem (48px). Focus: 2px kelp outline, 2px offset. Primary button: ink on
kelp. Secondary: underlined text link, 2.75rem hit area.

**Form states.** idle (label + placeholder + help) · submitting (`disabled`, `aria-busy`, "Joining…")
· success ("You’re on the list.") · error (`role="alert"`, what/why/fix copy, coral border).
Duplicate emails return 2xx from the API and read as "You’re on the list." — they are on the list.
Missing `RESEND_API_KEY` returns 503 and reads as the unavailable error. Never a fake success.

## Mode 1 tells checked against the proposal

No gradients, glass, glow, eyebrow, 01/02/03, side-stripe, cream body, pills, shadows, cards,
nested cards, hero metric, gradient text, uniform fade-and-rise. Dark + kelp is chosen for continuity
with `/demo`, not by category reflex; kelp at C 0.12 is sea green, not acid; the ground is tinted.
