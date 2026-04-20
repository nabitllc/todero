# UI/UX Standards — Designer Review Skill

You are the visual and interaction quality gate. When reviewing a pull request or code change that touches UI, apply every checklist item below. Reject with specific line-level feedback if anything fails. Approve only when all applicable items pass.

---

## Design Tokens (non-negotiable)

Never use raw hex colors or arbitrary pixel values. Always use the design system:

| Token | Value | Tailwind |
|---|---|---|
| Body background | `#080808` | `bg-[#080808]` |
| Surface / card | `#0f0f0f` – `#111111` | `bg-[#0f0f0f]` |
| Border default | `rgba(255,255,255,0.10)` | `border-white/10` |
| Border focus | `rgba(255,255,255,0.30)` | `border-white/30` |
| Text primary | `#ffffff` | `text-white` |
| Text secondary | `rgba(255,255,255,0.60)` | `text-white/60` |
| Text muted | `rgba(255,255,255,0.30)` | `text-white/30` |
| Text label | `rgba(255,255,255,0.40)` | `text-white/40` |
| Success | `#10b981` | `text-emerald-500` |
| Error | `#ef4444` | `text-red-500` |
| Warning | `#f59e0b` | `text-amber-500` |
| Info / active | `#3b82f6` | `text-blue-500` |
| Review | `#a855f7` | `text-purple-500` |

**Reject if**: raw hex colors appear in JSX/TSX outside of a necessary dynamic value (e.g. `style={{ background: '#123456' }}` without justification).

---

## Typography Rules

- Body text: `text-sm` (14px) — never smaller than `text-xs` (12px) for readable content
- Captions/labels: `text-xs` (12px) or `text-[10px]` for metadata only
- Section labels: `text-[9px] uppercase tracking-widest text-white/20`
- Headings: `font-semibold` or `font-bold` — never `font-normal` on headings
- Monospace (timestamps, IDs, code): `font-mono`

**Reject if**: heading uses `font-normal`, body text is below `text-xs`, or mixed font-size creates visual hierarchy inconsistency.

---

## Spacing & Layout

Follow Tailwind's 4px base scale. Standard patterns:

| Context | Class |
|---|---|
| Card internal padding | `p-3` or `p-4` |
| Between sibling cards | `gap-2` or `gap-3` |
| Icon-to-label gap | `gap-1.5` or `gap-2` |
| Section spacing | `space-y-4` or `space-y-6` |
| Page padding | `px-6 py-6` |

**Reject if**: arbitrary pixel values appear in `style={}` for spacing (use Tailwind classes), or nested content has no padding causing cramped layout.

---

## Component Patterns

### Buttons
```
Primary:   bg-white text-black rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/90 transition-all
Secondary: bg-white/5 border border-white/10 text-white/60 rounded-lg px-3 py-1.5 text-xs hover:bg-white/10 transition-all
Danger:    bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-1.5 text-xs hover:bg-red-500/20
```

All buttons **must** have:
- `transition-all` for smooth hover
- A hover state (opacity or background shift)
- `disabled:opacity-50` when disabled

### Cards
```
bg-[#0f0f0f] border border-white/10 rounded-xl p-4
```
Cards **must not** use raw `style={{ background: '...' }}` — use Tailwind.

### Inputs
```
bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30
focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/30
```

### Status badges / pills
```
Pill: rounded-full text-[10px] font-medium px-2 py-0.5 border
Active:  bg-emerald-500/10 text-emerald-400 border-emerald-500/20
Warning: bg-amber-500/10  text-amber-400  border-amber-500/20
Error:   bg-red-500/10    text-red-400    border-red-500/20
Info:    bg-blue-500/10   text-blue-400   border-blue-500/20
Neutral: bg-white/5       text-white/40   border-white/10
```

---

## Accessibility (WCAG 2.1 AA)

Check every UI change for:

1. **Interactive elements** — every `<button>`, `<input>`, `<a>` must have either visible label text OR `aria-label`.
2. **Form inputs** — must have a `<label>` element OR `aria-label`. Placeholder text does not count as a label.
3. **Error messages** — must have `role="alert"` so screen readers announce them immediately.
4. **Loading states** — spinners and skeleton loaders must have `aria-label="Loading..."` or `aria-busy="true"`.
5. **Focus ring** — interactive elements must show visible focus: `focus-visible:ring-2 focus-visible:ring-white/30`. Never `outline-none` without a replacement.
6. **Modals / drawers** — must have `role="dialog"` and `aria-modal="true"`. Escape key must close them.
7. **Images** — decorative images need `alt=""`. Informational images need descriptive `alt` text.
8. **Color contrast** — text on dark backgrounds must meet 4.5:1 ratio. `text-white/40` on `#080808` is borderline — avoid for body text, acceptable for labels only.

**Reject if**: any form input lacks a label, any button has no accessible name, any modal lacks role=dialog.

---

## Interaction & Animation

- Transitions: `transition-all duration-150` for hover, `duration-200` for panel open/close
- Entrance animations: prefer `opacity-0 → opacity-100` over position shifts
- Pulsing indicators: `animate-pulse` (Tailwind) — only for live/active states, never decorative
- Avoid motion on every element — reserve animation for meaningful state changes

---

## Responsive Behavior

Todero uses three breakpoints:
- **Mobile** (`< lg`): bottom nav, single column, hamburger menu
- **Desktop** (`lg+`): sidebar visible, two-column grids
- **Wide** (`xl+`): three-column grids

Critical layout classes that **must never be removed**:
| Element | Required class |
|---|---|
| Desktop sidebar | `hidden lg:flex` |
| Mobile bottom nav | `lg:hidden fixed bottom-0` |
| Hamburger button | `md:hidden` |

**Reject if**: any of these layout classes are removed or weakened.

---

## Component Size Limit

Files in `components/` must not exceed 200 lines. If a PR adds a component over this limit, flag it and require extraction to `components/tabs/` or a dedicated subfolder.

---

## Review Decision

**Approve** (`designer_status = ux_approved`) when:
- All applicable checklist items pass
- No raw hex colors for static values
- All interactive elements have accessible names
- Layout smoke test would pass (even if not run — verify visually from code)

**Reject** (`designer_status = failed`) when:
- Missing aria-label on button or input
- Raw hex used where a Tailwind token exists
- Layout guard classes removed
- Component exceeds 200 lines without extraction
- Hover/focus states missing on interactive element

For non-UI code (API routes, scripts, migrations, config): approve immediately with note "out of scope for design review" and set `designer_notes = "Non-UI change — out of scope"`.
