# Todero public surface — UI standards

Scope: the public landing at `/` (`app/page.tsx`, `app/Octopus.tsx`, `app/page.module.css`,
`app/WaitlistForm.tsx`). `/demo` carries the in-app work-item tokens (`app/demo/work-item.css`);
`/progress` is a plain board. The local app under `local/` has its own system.

## Mode 0 (written 2026-09-01 before code; revised 2026-09-02 for the centered two-screen landing)

**World.** An octopus: one animal, eight semi-autonomous arms, deep water, ink. A laptop. A person
who hires. Not a cloud console.

**Color.** OKLCH, hue 172 — the in-app kelp hue, so the landing and `/demo` read as one product.
Six semantic values plus one derived hairline. Register: drenched (the ground is the color).

| Token | Value | Role | Contrast on ink |
|---|---|---|---|
| `--ink` | oklch(0.19 0.028 172) | ground | — |
| `--shallows` | oklch(0.25 0.03 172) | raised surface (input) | — |
| `--bone` | oklch(0.94 0.012 172) | text | ≈12:1 |
| `--kelp` | oklch(0.72 0.12 172) | the one accent: button, mark, focus, selection, the octopus | ≈6.5:1 (ink text on kelp ≈6.5:1) |
| `--drift` | oklch(0.72 0.03 172) | muted text | ≈6.3:1 |
| `--coral` | oklch(0.76 0.13 30) | error only | ≈7:1 |
| `--line` | bone 14% into ink | hairline (input and ghost-button border) | derived |

No hex/rgb in JSX. SVG uses `currentColor`.

**Type.** IBM Plex Sans (display + body) + IBM Plex Mono (utility). Same pair as in-app.
Loaded with `next/font/google`, no CSS `@import`. Scale ratio 1.25:
`xs 0.8125rem · sm 0.9375rem · base 1.0625rem · lg 1.375rem · xl 1.75rem · display clamp(2.5rem, 1rem + 6.5vw, 6rem)`.
Body 1.6 line-height, +0.005em tracking (light-on-dark compensation). Display 500, -0.035em.
Mono: form label, octopus roles, FAQ questions, footer.

**Layout.** Two screens. Screen one is a centered hero that fills the viewport: octopus, H1, breath,
one control row (input · Join the waitlist · See the product). Screen two: six facts as a three-up
text grid with no boxes, four questions in a row, a two-word footer. No hairlines between sections;
separation is `clamp(4rem, 10vh, 7rem)`. Header is static with Product and Board on the right.

**Signature.** A line-drawn octopus in kelp, eight arms, each ending at a role (Lead, Research,
Design, Build, Test, Write, Ops, Support). Arms draw in on load (`pathLength=1`,
`stroke-dashoffset`, 700ms, 60ms stagger); roles fade in after. A canned composition about the
product — no operator data, no screenshot. Everything else is quiet. Roles hide below 40rem.

**Motion.** Hero-only entrance: header, H1, breath, form rise 8px over 250ms with an 80ms stagger.
Buttons shift color on hover and drop 1px on `:active` (120ms). Nothing below the fold animates.
`prefers-reduced-motion` disables every animation and transition; the octopus renders complete.

**Spacing.** 4pt scale as `--s-4 … --s-64`; fluid `--pad-x`, `--gap-screen`.

**Radii (locked).** `--radius-control: 6px` for input and buttons. Surfaces are square. No other radius.

**Borders over shadows.** No shadows anywhere. Hairlines only on the input and the ghost button.

**Controls.** Min height 3rem (48px). Focus: 2px kelp outline, 2px offset. Primary: ink on kelp.
Secondary: ghost (hairline border, bone text). Nav links: 2.75rem hit area.

**Form states.** idle (label + placeholder + help) · submitting (`disabled`, `aria-busy`, "Joining…")
· success ("You’re on the list.") · error (`role="alert"`, what/why/fix copy, coral border).
Duplicate emails return 2xx from the API and read as "You’re on the list." — they are on the list.
Missing `RESEND_API_KEY` returns 503 and reads as the unavailable error. Never a fake success.

**Sharing.** `public/og.png` (1200×630, rendered from the same tokens) is wired through
`app/layout.tsx` metadata.

## Mode 1 tells checked against the proposal

No gradients, glass, glow, eyebrow, 01/02/03, side-stripe, cream body, pills, shadows, cards,
nested cards, hero metric, gradient text, uniform fade-and-rise (hero only), testimonials, badges.
Dark + kelp is chosen for continuity with `/demo`, not by category reflex; kelp at C 0.12 is sea
green, not acid; the ground is tinted. The reference set was paperclip.ing (composition) — not
hermes-agent.org's stat row or icon cards.
