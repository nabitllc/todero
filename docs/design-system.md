# Mission Control Design System

Reference for UX review agent. All UI changes must comply with these standards.

## Colors

### Base Palette
- **Background**: `#080808` (body), `#0a0a0a` (app), `#0d0d0d` (surfaces)
- **Text primary**: `#ffffff` (headings), `#e5e5e5` (body)
- **Text secondary**: `white/40` to `white/60`
- **Text muted**: `white/25` (placeholders), `#71717a` (captions)
- **Borders**: `white/5` (subtle), `white/10` (default), `white/30` (focus/active)

### Semantic Colors
| Purpose       | Hex       | Tailwind       |
|---------------|-----------|----------------|
| Success/Done  | `#10b981` | emerald-500    |
| Error/Critical| `#ef4444` | red-500        |
| Warning       | `#f59e0b` | amber-500      |
| Info/Active   | `#3b82f6` | blue-500       |
| Purple/Review | `#a855f7` | purple-500     |
| Neutral       | `#6b7280` | gray-500       |

### Status Badge Colors
| Status      | Background  | Text      |
|-------------|-------------|-----------|
| Open/Backlog| `#27272a`   | `#a1a1aa` |
| In Progress | `#1e3a5f`   | `#60a5fa` |
| In Review   | `#312e81`   | `#a78bfa` |
| Done        | `#064e3b`   | `#34d399` |

**Rule**: Never use raw hex colors in components. Use the semantic/status colors above or Tailwind's opacity-based `white/N` pattern.

## Typography

**Font stack**: Inter (primary), JetBrains Mono (code)

| Class       | Size      | Weight | Color     | Use case        |
|-------------|-----------|--------|-----------|-----------------|
| `.mc-h1`    | 1.5rem    | 700    | `#ffffff` | Page titles     |
| `.mc-h2`    | 1.125rem  | 600    | `#e4e4e7` | Section heads   |
| `.mc-h3`    | 0.875rem  | 600    | `#d4d4d8` | Card titles     |
| `.mc-body`  | 0.875rem  | 400    | `#a1a1aa` | Body text       |
| `.mc-caption`| 0.6875rem| 400    | `#71717a` | Labels, meta    |

**Rules**:
- Headings use `font-semibold` or `font-bold`, never `font-normal`
- Body text is `text-sm` (14px), captions are `text-xs` (12px)
- Labels use `uppercase tracking-wider text-xs text-white/40`

## Spacing

Follow Tailwind's 4px base scale:
- **Micro**: `gap-1` (4px), `gap-1.5` (6px) -- tight element groups
- **Small**: `gap-2` (8px), `p-2` -- within cards/elements
- **Medium**: `gap-3` (12px), `p-3` -- card padding
- **Standard**: `gap-4` (16px), `p-4` -- section spacing
- **Large**: `gap-5` (20px), `p-6` -- page-level spacing

**Rules**:
- Card internal padding: `p-3` minimum
- Between cards: `gap-2` to `gap-3`
- Page margins: `px-6 py-6`

## Corners & Borders

- **Buttons/Inputs**: `rounded-lg` or `rounded-xl`
- **Cards**: `rounded-xl` or `rounded-2xl`
- **Badges**: `rounded` (small) or `rounded-full` (pills)
- **Dividers**: `h-px bg-white/5`

## Component Patterns

### Buttons
```
Primary:   bg-white text-black py-3 rounded-xl text-sm font-semibold
Secondary: bg-white/10 hover:bg-white/20 text-white rounded-lg px-3 py-1.5 text-xs
Icon:      w-10 h-10 rounded-full flex items-center justify-center bg-white/5
```
All buttons must have `transition-all` and a hover state.

### Cards
```
bg-white/5 border border-white/10 rounded-lg p-3
```
Hover: `.card-glow` class or `hover:border-white/20`

### Inputs
```
bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white
placeholder-white/25 focus:outline-none focus:border-white/30
```

### Modals
```
Overlay:  fixed inset-0 bg-black/90 backdrop-blur-sm z-50
Content:  bg-[#111] border border-white/10 rounded-2xl shadow-2xl
```

### Status Badges
```
text-[10px] px-2 py-0.5 rounded font-medium
```
Use status colors table above with 20% opacity background + 30% opacity border.

## Opacity Hierarchy

Text contrast is managed through `white/N` opacity scale:
- `white/80` -- prominent text
- `white/60` -- secondary text
- `white/40` -- tertiary/labels
- `white/25` -- placeholders
- `white/10` -- borders, dividers
- `white/5`  -- subtle backgrounds

## Accessibility

- Minimum contrast ratio: 4.5:1 for text (WCAG AA)
- All interactive elements must have visible focus states (`focus:border-white/30`)
- Icon-only buttons require `aria-label`
- Form inputs need associated labels or `aria-label`
- Color must not be the only indicator of state (use icons/text too)

## Responsive

- Mobile-first: base styles are mobile
- Breakpoints: `sm:` (640px), `md:` (768px), `lg:` (1024px)
- Sidebar collapses on mobile
- Tables scroll horizontally on small screens
- Touch targets: minimum 44x44px on mobile
