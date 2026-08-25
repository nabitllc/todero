// components/nav/config.ts
// TOD-2381 (nav-six-destinations): the target information architecture from
// design/Nav.dc.html — twenty tab ids collapsed into six destinations plus a
// Chat overlay. This file is the single source of truth for that shape; both
// the desktop and mobile nav read it, and app/page.tsx resolves every legacy
// tab id through LEGACY_TAB_MAP so no old link becomes a dead end.

export type DestinationId = 'now' | 'work' | 'fleet' | 'runs' | 'memory' | 'settings'

export interface DestinationView {
  /** Path segment / internal id for this view. */
  id: string
  /** Sidebar / pill label. */
  label: string
}

export interface Destination {
  id: DestinationId
  label: string
  /** The operator question this destination answers — design/Nav.dc.html. */
  question: string
  views: DestinationView[]
}

// Order here is render order everywhere: PrimaryNav, MobileNav, and the
// acceptance check "on a 375px viewport all six destinations are reachable
// from the phone nav" (nav-six-destinations piece, item 8).
export const DESTINATIONS: Destination[] = [
  {
    id: 'now',
    label: 'Now',
    question: 'What needs me right now, and what is running?',
    views: [
      { id: 'overview', label: 'Overview' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'activity', label: 'Activity' },
      { id: 'signal', label: 'Signal' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    question: 'What is the work, and where is it stuck?',
    views: [
      { id: 'board', label: 'Board' },
      { id: 'issues', label: 'Issues' },
      { id: 'features', label: 'Features' },
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'product-board', label: 'Product Board' },
      { id: 'epic-map', label: 'Epic Map' },
      { id: 'projects', label: 'Projects' },
      { id: 'calendar', label: 'Due dates' },
    ],
  },
  {
    id: 'fleet',
    label: 'Fleet',
    question: 'Which agents exist, which are alive, what are they doing?',
    views: [
      { id: 'team', label: 'Roster' },
      { id: 'office', label: 'Office' },
    ],
  },
  {
    id: 'runs',
    label: 'Runs',
    question: 'What did that agent actually do, and what did it cost?',
    views: [
      { id: 'all', label: 'All runs' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory',
    question: 'What has it learned, and what will it reuse?',
    views: [
      { id: 'memory', label: 'Memory' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    question: 'How is this wired, and what are its limits?',
    views: [
      { id: 'settings', label: 'Settings' },
      { id: 'ai-services', label: 'AI Services' },
      { id: 'automations', label: 'Automations' },
      { id: 'infra', label: 'Infra' },
      { id: 'calendar', label: 'Job timing' },
    ],
  },
]

export const DEFAULT_VIEW: Record<DestinationId, string> = {
  now: 'overview',
  work: 'board',
  fleet: 'team',
  runs: 'all',
  memory: 'memory',
  settings: 'settings',
}

/**
 * Every one of the 19 real (non-divider) ids from the old flat NAV array,
 * mapped to where it lives now. 'chat' is deliberately absent — it is no
 * longer a route, it is an overlay (see ChatOverlay.tsx); `navigate('chat')`
 * in app/page.tsx special-cases it before this map is consulted.
 *
 * Two ids split rather than move (nav-six-destinations piece, item 2):
 * - 'calendar' -> work/calendar is the redirect target (due dates); the same
 *   underlying CalendarTab is ALSO reachable at settings/calendar (job
 *   timing) — see app/page.tsx. This is a placement split, not a code split:
 *   CalendarTab's internals combine both concerns and are owned by another
 *   piece, so the "split" is achieved by surfacing the one component from
 *   two destinations, not by dividing its UI.
 * - 'infra' -> settings/infra is the redirect target (the detail, i.e. the
 *   full InfraTab). Now/signal is a NEW, separate, minimal real-data summary
 *   (see NowSignal.tsx) — not a code split of InfraTab either, for the same
 *   ownership reason.
 */
export const LEGACY_TAB_MAP: Record<string, [DestinationId, string]> = {
  overview: ['now', 'overview'],
  activity: ['now', 'activity'],
  inbox: ['now', 'inbox'],
  infra: ['settings', 'infra'],
  team: ['fleet', 'team'],
  office: ['fleet', 'office'],
  calendar: ['work', 'calendar'],
  memory: ['memory', 'memory'],
  board: ['work', 'board'],
  features: ['work', 'features'],
  'epic-map': ['work', 'epic-map'],
  pipeline: ['work', 'pipeline'],
  issues: ['work', 'issues'],
  projects: ['work', 'projects'],
  'product-board': ['work', 'product-board'],
  automations: ['settings', 'automations'],
  'ai-services': ['settings', 'ai-services'],
  settings: ['settings', 'settings'],
}

export function isDestinationId(x: string | undefined): x is DestinationId {
  return !!x && DESTINATIONS.some(d => d.id === x)
}

export function viewsOf(dest: DestinationId): string[] {
  return DESTINATIONS.find(d => d.id === dest)!.views.map(v => v.id)
}

export function destinationOf(id: DestinationId): Destination {
  return DESTINATIONS.find(d => d.id === id)!
}
