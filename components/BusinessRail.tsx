'use client'
// components/BusinessRail.tsx — cards-and-identity piece (Wave 6)
//
// OWNER CORRECTION, applied here directly (the piece doc originally called
// this "project switching"; the owner's own words on the running app say
// otherwise — see app/page.tsx's comment above where this renders):
//
//   "Survive similar to Slack. Left pane has 'Workspace'... Todero 'Hub'
//    should be similar to Slack 'Workspace'. User can be part of multiple
//    hubs, with a specific account/RBAC on each workspace. For now, we only
//    have one Hub (Limiglow) until we know Todero works properly... later
//    user should be able to create/join different hubs (similar to
//    Paperclip)."
//
// So this rail is the HUB switcher — Slack's workspace rail — and it stays
// here permanently; it does not move into Settings. Multi-hub membership and
// per-hub RBAC are explicitly post-MVP: no membership/role UI exists here,
// only a list of the hubs this account already has, so a second hub simply
// appearing in that list later requires no new UI.
//
// DATA SOURCE: /api/projects, not /api/businesses. That looks backwards next
// to the word "Hub" until you read the owner's own account of why: the
// `businesses` table has exactly one row today, named "Todero" — the rail
// used to show "T" for it, which is the thing that looked wrong to him. The
// account's actual single hub is "Limiglow" — today's one `projects` row —
// and reading /api/projects is what makes the rail show "L" and be correct.
// Column names are unchanged (no migration); this is a display-layer
// decision about which existing table currently models "Hub" correctly for
// an account with exactly one of each, not a schema claim that projects ARE
// hubs going forward.

import { useEffect, useState } from 'react'
import { fetchJson } from '@/hooks/useApiData'
import { Plus } from 'lucide-react'

interface HubRow { id: string; name: string; status: string; logo?: string | null }

interface Props {
  /** Real selected hub name (e.g. "Limiglow"), or null before one resolves. */
  selected: string | null
  onSelect: (name: string) => void
  /**
   * "+" — creating a second hub has no dedicated surface yet (Settings does
   * not have its own Hubs view). This opens the nearest real admin surface
   * (Settings → Projects) rather than a business-onboarding wizard, which
   * would create the wrong kind of row for what this rail now represents.
   */
  onManage: () => void
  refreshKey?: number
}

export default function BusinessRail({ selected, onSelect, onManage, refreshKey }: Props) {
  const [hubs, setHubs] = useState<HubRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setFetchError(false)
    // TOD-654: a non-ok response is an error, not an empty hub list.
    fetchJson<HubRow[]>('/api/projects').then(r => {
      if (!r.ok) { setFetchError(true); setHubs([]); setLoading(false); return }
      setHubs(Array.isArray(r.data) ? r.data.filter(h => h.status !== 'archived') : [])
      setLoading(false)
    })
  }, [refreshKey])

  return (
    <div className="flex flex-col items-center gap-2 w-14 min-h-screen bg-[#080808] border-r border-white/5 py-3 shrink-0 overflow-y-auto overflow-x-hidden">
      {/* MC-522: overflow-y-auto — rail scrolls on small phones instead of clipping under fixed nav */}

      {/* Loading skeleton */}
      {loading && (
        <>
          <div className="w-10 h-10 rounded-2xl bg-white/5 animate-pulse" />
          <div className="w-10 h-10 rounded-2xl bg-white/5 animate-pulse" />
        </>
      )}

      {/* Error state */}
      {!loading && fetchError && (
        <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-white/20 text-xs" title="Failed to load hubs">!</div>
      )}

      {/* No named-empty-state row here on purpose: with zero hubs there is
          nothing to scope to, and every destination is already gated behind
          "resolving project scope…" (app/page.tsx) — a second, duplicate
          empty message in the rail would say the same thing twice. */}

      {/* Hub avatars — one per real /api/projects row */}
      {!loading && !fetchError && hubs.map(h => {
        const isSelected = selected === h.name
        return (
          <div key={h.id} className="relative group">
            <button
              onClick={() => onSelect(h.name)}
              title={h.name}
              aria-label={`Hub: ${h.name}`}
              aria-current={isSelected ? 'true' : undefined}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-white/30
                ${isSelected ? 'ring-2 ring-white bg-[#1a1a1a]' : 'bg-white/10 hover:bg-white/20'}`}
            >
              {/* Real logo when the row has one; first letter of the real
                  hub name otherwise — never a hardcoded per-name lookup. */}
              {h.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/user-supplied logo, not a static asset
                <img src={h.logo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-white">{h.name.charAt(0).toUpperCase()}</span>
              )}
            </button>
            {/* Tooltip */}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#080808] text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-white/10">
              {h.name}
            </div>
          </div>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Add a hub — routes to the nearest real admin surface (see file header) */}
      <button
        onClick={onManage}
        title="Manage hubs"
        aria-label="Manage hubs"
        className="w-10 h-10 rounded-2xl bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/40 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-white/30"
      >
        <Plus size={18} />
      </button>
    </div>
  )
}
