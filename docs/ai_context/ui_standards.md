# Todero public surface — UI standards

Scope: the public landing at `/` (`app/page.tsx`, `app/BoltBoard.tsx`, `app/page.module.css`,
`app/WaitlistForm.tsx`) and the internal `/progress` log (`app/progress/*`). The shared tokens live in
`app/globals.css` under `.todero`; page modules add only what is theirs. `/demo` carries the in-app work-item tokens (`app/demo/work-item.css`);
`/progress` is a plain board. The local app under `local/` has its own system.

## Mode 0 (written 2026-09-01; revised 2026-09-02 after the benchmark against Paperclip, Hermes, Linear, Vercel, Raycast, Ollama, Warp)

**World.** An octopus: one animal, eight semi-autonomous arms. A laptop. A person who hires.
Agents that work in 24-hour sprints — bolts. Not a cloud console.

**Color.** OKLCH, hue 172 — the in-app kelp hue, so the landing and `/demo` read as one product.
Six semantic values plus one derived hairline. Register: drenched (the ground is the color).

| Token | Value | Role | Contrast on ink |
|---|---|---|---|
| `--ink` | oklch(0.19 0.028 172) | ground | — |
| `--shallows` | oklch(0.25 0.03 172) | raised surface: input, the bolt board | — |
| `--bone` | oklch(0.94 0.012 172) | text | ≈12:1 |
| `--kelp` | oklch(0.72 0.12 172) | the one accent: button, mark, focus, selection, bolt label, Working chip | ≈6.5:1 (ink text on kelp ≈6.5:1) |
| `--drift` | oklch(0.72 0.03 172) | muted text | ≈6.3:1 |
| `--coral` | oklch(0.76 0.13 30) | error only | ≈7:1 |
| `--line` | bone 14% into ink | hairline: input, board edge, item rows | derived |

No hex/rgb in JSX. SVG uses `currentColor`.

**Type.** IBM Plex Sans (display + body) + IBM Plex Mono (utility). Same pair as in-app.
Loaded with `next/font/google`, no CSS `@import`. Scale ratio 1.25:
`xs 0.8125rem · sm 0.9375rem · base 1.0625rem · lg 1.375rem · display clamp(2.5rem, 1rem + 6.5vw, 6rem)`;
in the two-column layout the display caps at `clamp(3rem, 1rem + 3.8vw, 4.25rem)` so the H1 holds
three lines. Body 1.6 line-height, +0.005em tracking. Display 500, -0.035em.
Mono: bolt label, roles, chip, caption, footer. No tracked-caps anywhere.

**Layout.** One screen on desktop (Ollama's composition): left column H1 → breath → one plain
sentence naming the thing → email + Join the waitlist → help → "or see a bolt →"; right column the
bolt board, bleeding off the right edge (Linear's crop). Mobile stacks words, form, board — ≈1.3
screens; the proof costs a little scroll. Header: mark · Todero left, GitHub · Brain right.
Footer: Todero · Based on Paperclip (MIT) · Board.

**Signature.** The bolt board — a canned 24-hour sprint for an invented company (goal, Backlog /
Doing / Done, six items with roles). It is the proof of "agents work the mission" and the visible
form of the agile position. No operator data, no screenshot. The octopus is the mark beside the
wordmark at 28px, 2px strokes.

**Motion.** Hero entrance: H1, breath, sentence, form, board rise 8px over 250ms with an 80ms
stagger. One chip on the board loops Queued → Working every 4s. Button drops 1px on `:active`.
`prefers-reduced-motion` disables every animation and transition; the chip holds one state.

**Spacing.** 4pt scale as `--s-4 … --s-64`; fluid `--pad-x`.

**Radii (locked).** `--radius-control: 6px` for input and button. Surfaces, including the board,
are square.

**Borders over shadows.** No shadows anywhere. Hairlines: input, board edge, item row tops.

**Controls.** Min height 3rem (48px). Focus: 2px kelp outline, 2px offset. Primary: ink on kelp.
Secondary: underlined text link with a 2.75rem hit area. Nav and footer links: 2.75rem hit area.

**Form states.** idle (visually-hidden label, placeholder, help "One email when npx todero works.
Nothing else.") · submitting (`disabled`, `aria-busy`, "Joining…") · success ("You’re on the list.",
receives focus) · error (`role="alert"`, what/why/fix copy, coral border). Duplicate emails return
2xx from the API and read as "You’re on the list." Missing `RESEND_API_KEY` returns 503 and reads as
the unavailable error. Never a fake success.

**Sharing.** `public/og.png` (1200×630) wired through `app/layout.tsx` metadata.

## Benchmark notes (2026-09-02)

Borrowed: Ollama's two columns; Linear's cropped product frame; Paperclip's one-button-plus-text
CTA; Hermes's "what is it" paragraph (only that). Refused: Paperclip's gradient and testimonial
wall; Hermes's pill eyebrow, metric row, icon cards; Vercel's radial glow; Warp's 01/02/03; every
logo wall and counter. The six "facts" and four Q/As from the first brief were removed — two extra
phone screens answering unasked questions.

## Mode 1 tells checked

No gradients, glass, glow, eyebrow, 01/02/03, side-stripe, cream body, pills, shadows, cards
(the board's items are hairline rows, not boxes), hero metric, gradient text, uniform fade-and-rise,
testimonials, badges, counters. Dark + kelp is chosen for continuity with `/demo`.
