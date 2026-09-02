# Todero public surface — UI standards

Scope: the public landing at `/` (`app/page.tsx`, `app/Octopus.tsx`, `app/page.module.css`,
`app/WaitlistForm.tsx`). `/demo` carries the in-app work-item tokens (`app/demo/work-item.css`);
`/progress` is a plain board. The local app under `local/` has its own system.

## Mode 0 (written 2026-09-01 before code; revised 2026-09-02 after the designer rejected the two-screen version)

**World.** An octopus: one animal, eight semi-autonomous arms, deep water, ink. A laptop. A person
who hires. Not a cloud console.

**Color.** OKLCH, hue 172 — the in-app kelp hue, so the landing and `/demo` read as one product.
Six semantic values plus one derived hairline. Register: drenched (the ground is the color).

| Token | Value | Role | Contrast on ink |
|---|---|---|---|
| `--ink` | oklch(0.19 0.028 172) | ground; also the mantle fill that occludes the back arms | — |
| `--shallows` | oklch(0.25 0.03 172) | raised surface (input) | — |
| `--bone` | oklch(0.94 0.012 172) | text | ≈12:1 |
| `--kelp` | oklch(0.72 0.12 172) | the one accent: button, mark, focus, selection, the octopus | ≈6.5:1 (ink text on kelp ≈6.5:1) |
| `--drift` | oklch(0.72 0.03 172) | muted text | ≈6.3:1 |
| `--coral` | oklch(0.76 0.13 30) | error only | ≈7:1 |
| `--line` | bone 14% into ink | hairline (input border) | derived |

No hex/rgb in JSX. SVG uses `currentColor`.

**Type.** IBM Plex Sans (display + body) + IBM Plex Mono (utility). Same pair as in-app.
Loaded with `next/font/google`, no CSS `@import`. Scale ratio 1.25:
`xs 0.8125rem · sm 0.9375rem · base 1.0625rem · lg 1.375rem · display clamp(2.5rem, 1rem + 6.5vw, 6rem)`;
the breath is fluid between base and lg. Body 1.6 line-height, +0.005em tracking. Display 500, -0.035em.
Mono: the one-line strip and the footer. No tracked-caps anywhere; no mono captions above the H1.

**Layout.** One screen. Header (mark · Product). Centered column: octopus → H1 → breath → email +
Join the waitlist → help → "See the product →" as a text link → one mono line
(`Local · Your model · MIT · macOS, Windows, Linux`) → footer (Todero · Based on Paperclip (MIT) · Board).
Groups, not a uniform gap: 16px octopus→words, 12px H1→breath, 32px words→form, 32px form→strip.
Nothing below the fold on desktop; ≈1.1 screens on a 375×812 phone.

**Signature.** A hand-drawn octopus in kelp: pointed mantle filled with ink, eight uneven arms with
different stroke weights (1.3–2.2), two of them starting behind the mantle for depth, tips curling.
Arms draw in on load (`pathLength=1`, `stroke-dashoffset`, 700ms, 70ms stagger); the mantle fades in
over them. No captions, no roles, no dots. Height `clamp(8rem, 22vh, 15rem)`.

**Motion.** Hero-only entrance: header, H1, breath, form rise 8px over 250ms with an 80ms stagger;
the strip fades last. Button shifts color on hover and drops 1px on `:active` (120ms).
`prefers-reduced-motion` disables every animation and transition; the octopus renders complete.

**Spacing.** 4pt scale as `--s-4 … --s-64`; fluid `--pad-x`.

**Radii (locked).** `--radius-control: 6px` for input and button. Surfaces are square.

**Borders over shadows.** No shadows anywhere. One hairline: the input border.

**Controls.** Min height 3rem (48px). Focus: 2px kelp outline, 2px offset. Primary: ink on kelp.
Secondary: underlined text link with a 2.75rem hit area. Nav and footer links: 2.75rem hit area.

**Form states.** idle (visually-hidden label, placeholder, help) · submitting (`disabled`,
`aria-busy`, "Joining…") · success ("You’re on the list.", receives focus) · error (`role="alert"`,
what/why/fix copy, coral border). Duplicate emails return 2xx from the API and read as
"You’re on the list." Missing `RESEND_API_KEY` returns 503 and reads as the unavailable error.
Never a fake success.

**Sharing.** `public/og.png` (1200×630) wired through `app/layout.tsx` metadata.

## What was cut, and why

The six "facts" and four Q/As from the first brief were removed on 2026-09-02: on a phone they were
two extra screens answering questions a stranger has not asked, and six same-size text blocks read as
an icon-card grid with the icons deleted. Their content belongs on `/demo`, next to the product.

## Mode 1 tells checked

No gradients, glass, glow, eyebrow, 01/02/03, side-stripe, cream body, pills, shadows, cards,
hero metric, gradient text, uniform fade-and-rise, testimonials, badges, caption row above the H1.
Dark + kelp is chosen for continuity with `/demo`; kelp at C 0.12 is sea green, not acid.
