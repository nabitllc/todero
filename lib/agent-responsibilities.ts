// ─── Agent responsibilities ────────────────────────────────────────────────
//
// WHAT THIS ANSWERS, AND WHAT IT DELIBERATELY DOES NOT
//
//   who exists?             -> AGENTS.md, parsed by loadAgentRoster()
//   what CAN an agent do?   -> lib/agent-capabilities.ts (AGENT_REGISTRY)
//   what does it pick up?   -> lib/agent-queue.ts (dispatch config)
//   WHAT DOES IT OWN, AND WHO ANSWERS WHEN THAT STALLS?  -> this file + table
//
// A capability is an ability ("builder can code"). A responsibility is an
// obligation ("builder owns the build area of this hub, and when nothing ships
// builder is who you ask"). The second is assigned by a human, changes without
// a code change, and is stored in `agent_responsibilities` (migration 065).
//
// The two are joined but never merged: `capabilityBacking()` below reports
// whether an assignment is backed by a declared capability. It never refuses
// one. An owner may deliberately hold the orchestrator accountable for spend.
//
// PURE ON PURPOSE
//   No `fs`, no `db()`, no `next/server`. Everything here is data plus
//   validators over data, so the same functions run in the API route, in the
//   unit test, and (for the types and AREAS) in the client card. The roster is
//   passed IN as `RosterFacts` rather than read here — that is what lets the
//   test prove the "roster unreadable" refusal without a filesystem.
//
// NOTHING IS SEEDED. There is no default assignment anywhere in this file. An
// empty table means "no responsibilities are assigned yet".

import { getAgentCapabilities } from '@/lib/agent-capabilities'

/* ── Levels ──────────────────────────────────────────────────────────────── */

/**
 * RACI's obligation half, and only that half.
 *
 * `consulted` and `informed` create no obligation and this product has no
 * mechanism that would act on them, so storing them would be decoration.
 *
 * `accountable` is capped at one per (business_id, area) by a partial unique
 * index in both migration dialects. An area with two accountable agents has
 * nobody accountable, which is the whole failure this table exists to prevent.
 */
export const RESPONSIBILITY_LEVELS = ['accountable', 'responsible'] as const
export type ResponsibilityLevel = (typeof RESPONSIBILITY_LEVELS)[number]

export function isResponsibilityLevel(v: unknown): v is ResponsibilityLevel {
  return typeof v === 'string' && (RESPONSIBILITY_LEVELS as readonly string[]).includes(v)
}

/* ── Areas ───────────────────────────────────────────────────────────────── */

export interface AreaDefinition {
  /** Stored value. Lowercase, stable — renaming one is a data migration. */
  id: string
  /** Operator-facing name. */
  label: string
  /** The question this area's owner is expected to be able to answer. */
  question: string
  /**
   * The artifact IN THIS REPO that evidences the work is real. This list is a
   * declared product vocabulary, not data read from a table — nothing in Todero
   * currently enumerates "areas of the business". Citing the anchor is what
   * keeps the list auditable instead of asserted.
   */
  evidence: string
  /**
   * Capability strings from lib/agent-capabilities.ts that would BACK an
   * assignment in this area. Empty means the capability registry names nothing
   * for this area — reported as `null` (unknown), never as `false` (unbacked),
   * because "the registry has no opinion" and "the registry disagrees" are
   * different facts and only one of them is a warning.
   */
  capabilityKeywords: readonly string[]
}

/**
 * The closed vocabulary. Adding an area is deliberately a code change, the same
 * stance app/api/hub-settings/route.ts takes for setting keys: an open
 * vocabulary on a write endpoint is an open write to a table the app reads back
 * and trusts. The write path refuses anything not listed here.
 */
export const AREAS: readonly AreaDefinition[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    question: 'What gets built next, and is it ready to start?',
    evidence: "AGENTS.md 'Issue Creation Protocol'; the queue lane that picks up status 'defined'",
    capabilityKeywords: ['Backlog Grooming', 'PRDs', 'DoR', 'Sprint Facilitation'],
  },
  {
    id: 'build',
    label: 'Build',
    question: 'Who ships the code once work is accepted?',
    evidence: "issues.status open -> in_progress; the queue lane that picks up status 'open'",
    capabilityKeywords: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'],
  },
  {
    id: 'quality',
    label: 'Quality',
    question: 'Who says a change is safe to release?',
    evidence: "issues.tester_status and tester_notes; the code_review gate described in AGENTS.md",
    capabilityKeywords: ['QA', 'Code Review', 'Test Suites', 'DoD Enforcement'],
  },
  {
    id: 'design',
    label: 'Design',
    question: 'Who owns how the product looks and feels?',
    evidence: 'issues.designer_status and designer_notes; the design/*.dc.html artboards',
    capabilityKeywords: ['Design System', 'UI Review', 'Visual QA', 'Accessibility', 'Mobile UX'],
  },
  {
    id: 'release',
    label: 'Release',
    question: 'Who gets finished work in front of users?',
    evidence: "the deploy_history table; the queue lane that picks up status 'approved'",
    capabilityKeywords: ['Deployments', 'Webhooks', 'Release Notes'],
  },
  {
    id: 'audit',
    label: 'Audit',
    question: 'Who catches drift after something has shipped?',
    evidence: "the queue lane that picks up status 'released'; scripts/acceptance/run.mjs",
    capabilityKeywords: ['Drift Detection', 'Config Audit', 'Task Hygiene'],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    question: 'Who keeps the thing running?',
    evidence: '/api/health and the lib/required-tables.ts schema preflight',
    capabilityKeywords: ['Infrastructure', 'Monitoring', 'Alerts'],
  },
  {
    id: 'security',
    label: 'Security',
    question: 'Who owns secrets, auth and dependency risk?',
    evidence: 'lib/rbac-types.ts role matrix; scripts/check-no-secrets.js',
    capabilityKeywords: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'],
  },
  {
    id: 'spend',
    label: 'Spend',
    question: 'Who watches what the fleet costs, against its ceilings?',
    evidence: 'the agent_budgets and agent_cost_log tables; lib/agent-budget.ts',
    // The capability registry names nothing for spend. That is a real finding,
    // not an oversight to paper over: no declared agent capability covers cost
    // control, so every assignment here reports backing as unknown.
    capabilityKeywords: [],
  },
  {
    id: 'research',
    label: 'Research',
    question: 'Who watches the market, the competition and the tooling?',
    evidence: "AGENTS.md's Research Agent role row",
    capabilityKeywords: ['Web Research', 'Summarization', 'Trends'],
  },
  {
    id: 'growth',
    label: 'Growth',
    question: 'Who owns revenue and go-to-market?',
    evidence: "the roster's Growth Strategist row in AGENTS.md",
    capabilityKeywords: ['Monetization', 'GTM', 'Pricing', 'LATAM'],
  },
  {
    id: 'content',
    label: 'Content',
    question: 'Who owns what the business publishes?',
    evidence: "the roster's Content Creator row in AGENTS.md",
    capabilityKeywords: ['Blog', 'SEO', 'Email', 'Help Docs'],
  },
  {
    id: 'community',
    label: 'Community',
    question: "Who owns the brand's voice in public?",
    evidence: "the roster's Community Mgr row in AGENTS.md",
    capabilityKeywords: ['Social Content', 'Brand Voice'],
  },
  {
    id: 'orchestration',
    label: 'Orchestration',
    question: 'Who decides what the fleet does next?',
    evidence: 'app/api/run-agent as the dispatch entry point; the triage queue lane',
    capabilityKeywords: ['Orchestration', 'Delegation', 'Strategy'],
  },
]

export const AREA_IDS: readonly string[] = AREAS.map(a => a.id)

export function findArea(id: unknown): AreaDefinition | undefined {
  return typeof id === 'string' ? AREAS.find(a => a.id === id) : undefined
}

/* ── The capability join — reported, never enforced ──────────────────────── */

/**
 * `true`  — the agent declares a capability this area names.
 * `false` — the area names capabilities and the agent has none of them.
 * `null`  — the area names no capabilities, or the registry has no entry for
 *           this agent (a roster may declare an agent the registry never met).
 *
 * Three states, not two, because "unknown" and "unbacked" are different claims
 * and only the second is a warning worth putting on screen.
 */
export function capabilityBacking(areaId: string, agentId: string): boolean | null {
  const area = findArea(areaId)
  if (!area || area.capabilityKeywords.length === 0) return null
  const caps = getAgentCapabilities(agentId)
  if (caps.length === 0) return null
  const have = caps.map(c => c.toLowerCase())
  return area.capabilityKeywords.some(k => have.includes(k.toLowerCase()))
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

export interface ResponsibilityRow {
  business_id: string
  area: string
  agent_id: string
  level: ResponsibilityLevel
  note: string | null
  assigned_by: string
  created_at?: string | null
  updated_at?: string | null
}

/** What the caller learned about the fleet before attempting a write. */
export interface RosterFacts {
  /** Ids the roster file actually declares. Never a built-in fallback list. */
  agentIds: readonly string[]
  /** The file the roster was read from, or null when none was readable. */
  source: string | null
  /** Why the roster is empty, when it is. */
  warning: string | null
}

export interface Refusal {
  status: number
  body: Record<string, unknown>
}

export type Validated<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

function refuse(status: number, body: Record<string, unknown>): { ok: false; refusal: Refusal } {
  return { ok: false, refusal: { status, body } }
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/** Longest note the UI renders without truncating into nonsense. */
export const MAX_NOTE_LENGTH = 500

export interface AssignmentInput {
  business_id?: unknown
  area?: unknown
  agent_id?: unknown
  level?: unknown
  note?: unknown
}

export interface ValidAssignment {
  business_id: string
  area: string
  agent_id: string
  level: ResponsibilityLevel
  note: string | null
}

/**
 * Validate an assignment before it can reach the table. FAIL CLOSED at every
 * step — each refusal names what is allowed so the caller can ask deliberately.
 *
 * The agent-id check is the important one. This codebase has repeatedly
 * invented agents (`kemuni-sme`, `vespera-sme`, and — verified 2026-08-26 —
 * `todero-sme` and `infra-sme`, which still hold live queue lanes in
 * lib/agent-queue.ts while no AGENTS.md in this repo declares either). An id
 * the roster does not declare is REFUSED, not stored: a responsibility table
 * that can name a nonexistent agent is a table that manufactures accountability
 * out of nothing.
 *
 * An UNREADABLE roster refuses too, rather than widening to "allow anything".
 */
export function validateAssignment(
  input: AssignmentInput,
  roster: RosterFacts,
): Validated<ValidAssignment> {
  const businessId = asNonEmptyString(input.business_id)
  if (!businessId) {
    return refuse(400, { error: 'business_id is required' })
  }

  const area = findArea(input.area)
  if (!area) {
    return refuse(400, {
      error: `unknown area ${JSON.stringify(input.area ?? null)}`,
      known: AREA_IDS,
      hint: 'Areas are a declared vocabulary in lib/agent-responsibilities.ts. Adding one is a code change.',
    })
  }

  if (!isResponsibilityLevel(input.level)) {
    return refuse(422, {
      error: `unknown level ${JSON.stringify(input.level ?? null)}`,
      known: RESPONSIBILITY_LEVELS,
    })
  }

  // Cannot verify the fleet -> cannot verify the assignee -> refuse.
  if (roster.agentIds.length === 0) {
    return refuse(503, {
      error: 'the agent roster could not be read, so no assignee can be verified',
      roster_source: roster.source,
      roster_warning: roster.warning,
      hint: 'Set AGENTS_MD_PATH to a readable roster file. Assignments are refused rather than stored unverified.',
    })
  }

  const agentId = asNonEmptyString(input.agent_id)
  if (!agentId) {
    return refuse(400, { error: 'agent_id is required' })
  }
  if (!roster.agentIds.includes(agentId)) {
    return refuse(422, {
      error: `no agent "${agentId}" is declared by the roster`,
      known_agents: roster.agentIds,
      roster_source: roster.source,
      hint: 'The roster is the only source of who exists. A queue lane, a capability entry or a config default is not a declaration.',
    })
  }

  let note: string | null = null
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') {
      return refuse(422, { error: 'note must be a string when present' })
    }
    const trimmed = input.note.trim()
    if (trimmed.length > MAX_NOTE_LENGTH) {
      return refuse(422, { error: `note must be at most ${MAX_NOTE_LENGTH} characters`, length: trimmed.length })
    }
    note = trimmed.length > 0 ? trimmed : null
  }

  return { ok: true, value: { business_id: businessId, area: area.id, agent_id: agentId, level: input.level, note } }
}

export interface RemovalInput {
  business_id?: unknown
  area?: unknown
  agent_id?: unknown
}

export interface ValidRemoval {
  business_id: string
  area: string
  agent_id: string
}

/**
 * Validate a removal.
 *
 * Deliberately does NOT check the area against AREAS or the agent against the
 * roster: a row can only have been written when both were valid, and if a later
 * code change retires an area — or the roster drops an agent — the row must
 * still be removable. Refusing to delete a row because its vocabulary went out
 * of date would strand it forever.
 */
export function validateRemoval(input: RemovalInput): Validated<ValidRemoval> {
  const businessId = asNonEmptyString(input.business_id)
  const area = asNonEmptyString(input.area)
  const agentId = asNonEmptyString(input.agent_id)
  const missing = [
    ...(businessId ? [] : ['business_id']),
    ...(area ? [] : ['area']),
    ...(agentId ? [] : ['agent_id']),
  ]
  if (missing.length > 0) {
    return refuse(400, { error: `missing required field(s): ${missing.join(', ')}`, required: ['business_id', 'area', 'agent_id'] })
  }
  return { ok: true, value: { business_id: businessId!, area: area!, agent_id: agentId! } }
}

/* ── Read shaping ────────────────────────────────────────────────────────── */

export interface AreaCoverage {
  area: string
  label: string
  question: string
  evidence: string
  accountable: string | null
  responsible: string[]
}

/**
 * Fold real rows onto the declared vocabulary. Areas with no rows come back
 * with `accountable: null` and an empty `responsible` — which is the point:
 * "nobody owns this" is the most useful thing this data can say, and it is only
 * sayable because the vocabulary is declared and the rows are not seeded.
 */
export function coverage(rows: readonly ResponsibilityRow[]): AreaCoverage[] {
  return AREAS.map(area => {
    const mine = rows.filter(r => r.area === area.id)
    return {
      area: area.id,
      label: area.label,
      question: area.question,
      evidence: area.evidence,
      accountable: mine.find(r => r.level === 'accountable')?.agent_id ?? null,
      responsible: mine.filter(r => r.level === 'responsible').map(r => r.agent_id).sort(),
    }
  })
}

/** How many declared areas have someone accountable. The number that matters. */
export function coveredAreaCount(rows: readonly ResponsibilityRow[]): number {
  return coverage(rows).filter(a => a.accountable !== null).length
}

/**
 * The list of systems that READ these rows to make a decision.
 *
 * It is empty, and that is a fact about the product, not a placeholder. No
 * dispatch path consults agent_responsibilities: lib/agent-queue.ts routes on
 * `pickupStatus`/`extraFilters`, app/api/run-agent routes on the queue config,
 * and dispatch is off by default behind lib/dispatch-guard.ts. This piece ships
 * a RECORD, not a CONTROL.
 *
 * It is exported, returned by the API and rendered by the card so that the
 * claim is made once, in code, and goes stale loudly (a consumer added here
 * changes what the UI says) instead of quietly.
 */
export const RESPONSIBILITY_CONSUMERS: readonly string[] = []

export const NOT_CONSULTED_NOTICE =
  'Nothing acts on these assignments yet. Dispatch does not read them, and agent dispatch is off ' +
  '(TODERO_DISPATCH_ENABLED). This is a record of who owns what, not a control over what runs.'
