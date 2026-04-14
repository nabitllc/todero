export interface FAQEntry {
  id: string
  question: string
  answer: string
  keywords: string[]
}

export const FAQ_DATA: FAQEntry[] = [
  {
    id: "account-setup",
    question: "How do I set up my account and get started?",
    answer:
      "Todero is an internal tool — no account creation needed. Access it at https://kaos.nabit.work in your browser. The app uses Supabase for data storage and is pre-configured for the team. If you can't reach the URL, check that the Cloudflare tunnel is active.",
    keywords: ["setup", "account", "start", "access", "login", "get started", "onboard"],
  },
  {
    id: "navigation",
    question: "How do I navigate the issue board?",
    answer:
      "The sidebar (desktop) or bottom nav (mobile) gives access to all sections: Issues, Epics, Sprints, Agents, and Settings. Click any issue row to expand details. Use the tab bar at the top of the issue list to filter by status (Backlog, Open, In Progress, etc.). On mobile, tap the hamburger menu for additional options.",
    keywords: ["navigate", "navigation", "sidebar", "menu", "tabs", "board", "find", "where"],
  },
  {
    id: "known-limitations",
    question: "What are the known limitations of Todero?",
    answer:
      "Known limitations in the current alpha: (1) No real-time sync — refresh the page to see updates from other agents. (2) The agent office visualization may lag behind actual agent activity. (3) Bulk issue operations are not yet supported. (4) Search is keyword-based with no fuzzy matching. (5) Mobile layout is functional but not fully optimized for small screens.",
    keywords: ["limitation", "known issue", "bug", "problem", "missing", "not working", "alpha", "caveat"],
  },
  {
    id: "report-bug",
    question: "How do I report a bug?",
    answer:
      "File a bug via the MC API: POST to http://localhost:3000/api/issues with type='bug', include a clear title, description of what you expected vs what happened, and acceptance_criteria describing the fix. Assign to 'builder' and set a parent_id linking it to the affected feature. Alternatively, message Michael directly in Discord with #bug-report.",
    keywords: ["report", "bug", "file", "submit", "issue", "error", "wrong", "broken", "fix"],
  },
  {
    id: "sprint-workflow",
    question: "How does the sprint workflow work?",
    answer:
      "Sprints are a reporting cadence, not a work boundary. Agents pull continuously from the queue regardless of sprint dates. Each issue has a 'sprint' field (YYYY-MM-DD format) indicating target delivery. KAOS opens one batched PR per window at 7am and 7pm ET. Sprint review happens when Michael reviews merged PRs — there's no formal sprint ceremony.",
    keywords: ["sprint", "workflow", "cadence", "release", "window", "pr", "merge", "schedule"],
  },
  {
    id: "agent-roles",
    question: "What are the different agent roles?",
    answer:
      "Agent roles: builder (code implementation), tester (QA review), designer (UI/UX review), po (product owner — grooms backlog, writes tasks), scout (research), ops (infrastructure/config), kemuni-sme/vespera-sme/todero-sme/infra-sme (Tier-1 epic decomposers by project domain), auditor (review), deployer (deploy coordination), and main/KAOS (orchestrator).",
    keywords: ["agent", "role", "builder", "tester", "designer", "po", "scout", "ops", "sme", "kaos", "who does what"],
  },
  {
    id: "issue-types",
    question: "What are the different issue types?",
    answer:
      "Issue types in Todero: epic (large multi-sprint theme, parent of features), feature (shippable capability, parent of tasks/bugs), task (single implementable unit, 1-2 days), bug (something broken, references a feature), ops (config/infra/setup work), research (investigate/evaluate something). Each type has a specific assignee and workflow.",
    keywords: ["issue type", "epic", "feature", "task", "bug", "ops", "research", "type", "difference"],
  },
  {
    id: "status-meanings",
    question: "What do the different issue statuses mean?",
    answer:
      "Issue statuses: backlog (not yet ready for work), defined (DoR fields filled, ready to activate), open (activated, in the queue), in_progress (actively being worked), code_review (builder done, awaiting tester/designer review), product_review (approved by tester, awaiting PO), approved (PO sign-off, ready for PR window), done (merged and deployed), closed (won't fix or duplicate).",
    keywords: ["status", "meaning", "backlog", "open", "in progress", "review", "approved", "done", "closed", "state"],
  },
  {
    id: "escalate",
    question: "How do I escalate an issue or get urgent help?",
    answer:
      "To escalate: (1) PATCH the issue with a high priority and add a note in implementation_notes explaining the urgency. (2) Message Michael directly in Discord — he monitors #agent-logs and the board. (3) For blockers mid-task, PATCH the issue back to 'open' with rejection_count++ and a clear explanation in implementation_notes. Never bypass the PR window — that is never the right escalation path.",
    keywords: ["escalate", "urgent", "help", "stuck", "blocker", "priority", "critical", "emergency", "unblock"],
  },
  {
    id: "wildcard-api",
    question: "How does the MC API work?",
    answer:
      "The MC API lives at /api/issues and is the single source of truth for all issue operations. Use POST to create issues (required: title, project, type, priority, assignee, acceptance_criteria). Use PATCH to update (fires Discord notifications, enforces business rules). Use GET to list all issues. Never write directly to Supabase for status changes — always go through the API.",
    keywords: ["api", "mc api", "endpoint", "post", "patch", "get", "create", "update", "rest", "http"],
  },
  {
    id: "issue-creation",
    question: "What fields are required to create an issue?",
    answer:
      "Required fields for issue creation: title, project (Todero/Kemuni/Vespera/Infrastructure), type (epic/feature/task/bug/ops/research), priority (critical/high/medium/low), assignee, and acceptance_criteria. For tasks moving to 'open', also required: description, severity (S0-S3), reviewer, owner, parent_id, and sprint date. Missing any required field will cause the API to reject the request.",
    keywords: ["create", "fields", "required", "new issue", "dor", "definition of ready", "mandatory", "what do I need"],
  },
  {
    id: "decomposition",
    question: "How are epics broken down into tasks?",
    answer:
      "Issue decomposition follows a 3-tier model: Tier 1 — Hub SME breaks epics into features (routed by project field). Tier 2 — PO breaks features into tasks (1-2 day scope each). Tier 3 — Builder may split a task only via an approved Inbox request (TOD-792). Never skip tiers or decompose issues outside your role — it breaks the workflow.",
    keywords: ["decompose", "breakdown", "split", "epic to feature", "feature to task", "hierarchy", "parent", "child"],
  },
]

/**
 * Look up the best matching FAQ entry for a user query.
 * Matching is case-insensitive and handles partial keyword matches.
 * Returns the best matching answer string, or null if no match found.
 */
export function lookupFAQ(query: string): string | null {
  if (!query || query.trim().length === 0) return null

  const normalized = query.toLowerCase()

  let bestEntry: FAQEntry | null = null
  let bestScore = 0

  for (const entry of FAQ_DATA) {
    let score = 0

    // Check direct question match
    if (entry.question.toLowerCase().includes(normalized)) {
      score += 10
    }

    // Check each keyword
    for (const keyword of entry.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score += 3
      } else if (keyword.toLowerCase().includes(normalized)) {
        score += 1
      }
    }

    // Check individual words in the query against keywords
    const words = normalized.split(/\s+/).filter((w) => w.length > 2)
    for (const word of words) {
      for (const keyword of entry.keywords) {
        if (keyword.toLowerCase().includes(word)) {
          score += 1
        }
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
    }
  }

  // Require a minimum score to avoid returning garbage matches
  if (bestScore < 1) return null

  return bestEntry?.answer ?? null
}
