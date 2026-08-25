// INF-221 / TOD: kill-fake-infra-greens — split out of lib/theme.ts.
//
// This file holds only the client-safe theme data: types and the built-in
// palette. lib/theme.ts's getThemePreference/setThemePreference need
// lib/db.ts (server-only — its postgres adapter pulls in the `pg` package,
// which needs Node's `fs` and cannot be bundled for the browser). Any client
// component that only wants THEMES/THEME_IDS must import THIS file, not
// lib/theme.ts, or Next's client bundle fails to resolve 'fs' — which is
// exactly what broke every route on this host when SettingsTab.tsx pulled in
// lib/theme.ts (and therefore lib/db.ts) transitively.
// lib/theme.ts re-exports everything below for its existing server-side callers.

export type ThemeId = 'dark' | 'midnight' | 'slate' | 'abyss'

export interface ThemeConfig {
  id: ThemeId
  label: string
  bg: string
  surface: string
  border: string
  textPrimary: string
  textSecondary: string
  accent: string
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  dark: {
    id: 'dark',
    label: 'Dark (Default)',
    bg: '#080808',
    surface: '#0f0f0f',
    border: 'rgba(255,255,255,0.1)',
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.5)',
    accent: '#3b82f6',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight Blue',
    bg: '#0a0e1a',
    surface: '#111827',
    border: 'rgba(99,102,241,0.15)',
    textPrimary: '#e0e7ff',
    textSecondary: 'rgba(165,180,252,0.5)',
    accent: '#6366f1',
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    bg: '#0f1419',
    surface: '#1a1f2e',
    border: 'rgba(148,163,184,0.12)',
    textPrimary: '#e2e8f0',
    textSecondary: 'rgba(148,163,184,0.5)',
    accent: '#38bdf8',
  },
  abyss: {
    id: 'abyss',
    label: 'Abyss',
    bg: '#050505',
    surface: '#0a0a0a',
    border: 'rgba(255,255,255,0.06)',
    textPrimary: '#d4d4d4',
    textSecondary: 'rgba(255,255,255,0.3)',
    accent: '#10b981',
  },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]
