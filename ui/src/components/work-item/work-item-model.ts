import type { Issue, IssueComment, IssuePriority, IssueStatus } from "@todero/shared";

export const WORK_ITEM_TYPES = ["Feature", "Story", "Task", "Bug"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATUSES = [
  "new",
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  new: "New",
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const WORK_ITEM_PRIORITIES = ["critical", "high", "medium", "low", "none"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

export const WORK_ITEM_SECTION_TITLES = [
  "Acceptance Criteria",
  "In Scope",
  "Out of Scope",
  "Testing Strategies",
] as const;
export type WorkItemSectionTitle = (typeof WORK_ITEM_SECTION_TITLES)[number];

export const COMPOSER_PLACEHOLDER = "Comment, or @ an agent";
export const BOLT_VALUE = "Coming";
export const EMPTY_BODY_PLACEHOLDER = "What is the work?";
export const EMPTY_ACTIVITY = "No activity yet.";
export const TITLE_PLACEHOLDER = "Short title";
export const IN_PROGRESS_ASSIGNEE_CAPTION = "Pick an assignee first.";
export const AGENT_SUMMARY_LIMIT = 140;
export const WAITING_ON_YOU = "Waiting on you.";
export const APOSTROPHE = "\u2019";

const TYPE_COMMENT_RE = /<!--\s*todero-type:\s*(Feature|Story|Task|Bug)\s*-->/i;
const WAITING_COMMENT_RE = /<!--\s*todero-blocked-by:\s*waiting-on-you\s*-->/i;
const REVIEW_COMMENT_RE = /<!--\s*todero-review:\s*pending\s*-->/i;
const PLAN_COMMENT_RE = /<!--\s*todero-plan:\s*pending\s*-->/i;
const SECTION_HEADING_RE = /^(#{1,6}\s+|\*\*)(Acceptance Criteria|In Scope|Out of Scope|Testing Strategies)(\*\*)?\s*$/i;
const CHECK_ITEM_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;

export type WorkItemBlockedBy =
  | { kind: "item"; id: string; identifier: string }
  | { kind: "waiting-on-you" };

export type WorkItemTrailEntry = {
  id: string;
  identifier: string;
  href: string;
  current: boolean;
};

export type WorkItemSection = {
  title: WorkItemSectionTitle;
  body: string;
};

export type WorkItemChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type ParsedWorkItemDescription = {
  type: WorkItemType;
  waitingOnYou: boolean;
  /** The agent handed in its output; the person accepts or sends it back. */
  reviewPending: boolean;
  /** The agent proposed a plan; the person approves or asks for changes. */
  planPending: boolean;
  body: string;
  sections: WorkItemSection[];
  checklist: WorkItemChecklistItem[];
};

export function stripWorkItemMeta(description: string | null | undefined): string {
  return (description ?? "")
    .replace(TYPE_COMMENT_RE, "")
    .replace(WAITING_COMMENT_RE, "")
    .replace(REVIEW_COMMENT_RE, "")
    .replace(PLAN_COMMENT_RE, "")
    .replace(/^\s+/, "");
}

function matchSectionTitle(line: string): WorkItemSectionTitle | null {
  const match = line.trim().match(SECTION_HEADING_RE);
  if (!match) return null;
  const raw = match[2]!;
  return WORK_ITEM_SECTION_TITLES.find((title) => title.toLowerCase() === raw.toLowerCase()) ?? null;
}

export function parseWorkItemDescription(
  description: string | null | undefined,
  fallbackType: WorkItemType = "Task",
): ParsedWorkItemDescription {
  const raw = description ?? "";
  const typeMatch = raw.match(TYPE_COMMENT_RE);
  const parsedType = typeMatch?.[1];
  const type: WorkItemType =
    parsedType && WORK_ITEM_TYPES.includes(parsedType as WorkItemType)
      ? (parsedType as WorkItemType)
      : fallbackType;
  const waitingOnYou = WAITING_COMMENT_RE.test(raw);
  const reviewPending = REVIEW_COMMENT_RE.test(raw);
  const planPending = PLAN_COMMENT_RE.test(raw);
  const stripped = stripWorkItemMeta(raw);
  const lines = stripped.split(/\r?\n/);

  const bodyLines: string[] = [];
  const sectionMap = new Map<WorkItemSectionTitle, string[]>();
  const checklist: WorkItemChecklistItem[] = [];
  let currentSection: WorkItemSectionTitle | null = null;

  for (const line of lines) {
    const sectionTitle = matchSectionTitle(line);
    if (sectionTitle) {
      currentSection = sectionTitle;
      if (!sectionMap.has(sectionTitle)) sectionMap.set(sectionTitle, []);
      continue;
    }
    const check = line.match(CHECK_ITEM_RE);
    if (check && !currentSection) {
      checklist.push({
        id: `check-${checklist.length + 1}`,
        text: check[2]!.trim(),
        done: check[1] !== " ",
      });
      continue;
    }
    if (currentSection) {
      sectionMap.get(currentSection)!.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  const sections: WorkItemSection[] = [];
  for (const title of WORK_ITEM_SECTION_TITLES) {
    const sectionLines = sectionMap.get(title);
    if (!sectionLines) continue;
    const body = sectionLines.join("\n").trim();
    if (!body) continue;
    sections.push({ title, body });
  }

  return {
    type,
    waitingOnYou,
    reviewPending,
    planPending,
    body: bodyLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
    sections,
    checklist,
  };
}

export function serializeWorkItemDescription(args: {
  type: WorkItemType;
  waitingOnYou: boolean;
  reviewPending?: boolean;
  planPending?: boolean;
  body: string;
  sections: WorkItemSection[];
  checklist: WorkItemChecklistItem[];
}): string {
  const parts: string[] = [`<!-- todero-type: ${args.type} -->`];
  if (args.waitingOnYou) parts.push("<!-- todero-blocked-by: waiting-on-you -->");
  if (args.reviewPending) parts.push("<!-- todero-review: pending -->");
  if (args.planPending) parts.push("<!-- todero-plan: pending -->");
  if (args.body.trim()) parts.push(args.body.trim());
  for (const item of args.checklist) {
    parts.push(`- [${item.done ? "x" : " "}] ${item.text}`);
  }
  for (const title of WORK_ITEM_SECTION_TITLES) {
    const section = args.sections.find((entry) => entry.title === title);
    if (!section?.body.trim()) continue;
    parts.push("", `## ${title}`, section.body.trim());
  }
  return parts.join("\n").trim() + "\n";
}

export function isAssigned(issue: {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}): boolean {
  return Boolean(issue.assigneeAgentId || issue.assigneeUserId);
}

export function displayStatus(issue: {
  status: IssueStatus | string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}): WorkItemStatus {
  switch (issue.status) {
    case "todo":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
    case "in_review":
      // Product vocabulary has no In review. This screen shows In progress for
      // active review work rather than inventing a seventh chip.
      return "in_progress";
    case "backlog":
    default:
      return isAssigned(issue) ? "todo" : "new";
  }
}

export function apiStatusFor(status: WorkItemStatus): IssueStatus {
  switch (status) {
    case "new":
      return "backlog";
    case "todo":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
  }
}

export function displayPriority(priority: IssuePriority | string | null | undefined): WorkItemPriority {
  if (priority === "critical" || priority === "high" || priority === "medium" || priority === "low") {
    return priority;
  }
  return "none";
}

export function apiPriorityFor(priority: WorkItemPriority): IssuePriority | null {
  return priority === "none" ? null : priority;
}

export function statusAllowsUnassigned(status: WorkItemStatus): boolean {
  return status === "new" || status === "todo";
}

export function statusFreezesAssignee(status: WorkItemStatus): boolean {
  return status === "done" || status === "cancelled";
}

export type StatusCommitResult =
  | { ok: true; apiStatus: IssueStatus }
  | { ok: false; reason: "assignee" | "blocked-by"; caption: string };

export function commitWorkItemStatus(args: {
  status: WorkItemStatus;
  assigned: boolean;
  blockedBy: WorkItemBlockedBy | null;
}): StatusCommitResult {
  if (args.status === "in_progress" && !args.assigned) {
    return { ok: false, reason: "assignee", caption: IN_PROGRESS_ASSIGNEE_CAPTION };
  }
  if (args.status === "blocked" && !args.blockedBy) {
    return { ok: false, reason: "blocked-by", caption: "Blocked by is required." };
  }
  return { ok: true, apiStatus: apiStatusFor(args.status) };
}

export function blockedChipLabel(blockedBy: WorkItemBlockedBy | null, blockerCount = 1): string | null {
  if (!blockedBy) return null;
  if (blockedBy.kind === "waiting-on-you") return `Blocked · ${WAITING_ON_YOU}`;
  if (blockerCount > 1) return `Blocked · ${blockerCount} tasks`;
  return `Blocked · ${blockedBy.identifier}`;
}

export function buildTrail(args: {
  ancestors?: Array<{ id: string; identifier: string | null }>;
  id: string;
  identifier: string | null;
  hrefFor: (identifier: string) => string;
}): WorkItemTrailEntry[] {
  const entries: WorkItemTrailEntry[] = [];
  for (const ancestor of args.ancestors ?? []) {
    const identifier = ancestor.identifier?.trim();
    if (!identifier) continue;
    entries.push({
      id: ancestor.id,
      identifier,
      href: args.hrefFor(identifier),
      current: false,
    });
  }
  const currentId = args.identifier?.trim() || args.id;
  entries.push({
    id: args.id,
    identifier: currentId,
    href: args.hrefFor(currentId),
    current: true,
  });
  return entries;
}

export function formatTrail(entries: WorkItemTrailEntry[]): string {
  return entries.map((entry) => entry.identifier).join(" › ");
}

export function agentSummaryOverflowLine(name: string, characterCount: number): string {
  return `${name}${APOSTROPHE}s summary was ${characterCount} characters (limit ${AGENT_SUMMARY_LIMIT}).`;
}

export type AgentSummaryRow =
  | { kind: "row"; name: string; summary: string }
  | { kind: "overflow"; text: string };

export function agentSummaryRow(name: string, summary: string): AgentSummaryRow {
  const trimmed = summary.replace(/\s+/g, " ").trim();
  if (trimmed.length > AGENT_SUMMARY_LIMIT) {
    return { kind: "overflow", text: agentSummaryOverflowLine(name, trimmed.length) };
  }
  return { kind: "row", name, summary: trimmed };
}

export function formatTokenUsage(args: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
} | null | undefined): string {
  if (!args) return "—";
  const total = (args.inputTokens ?? 0) + (args.outputTokens ?? 0) + (args.cachedInputTokens ?? 0);
  if (!Number.isFinite(total) || total <= 0) return "—";
  if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toFixed(1)}B`;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

export function formatTokenCost(costCents: number | null | undefined): string {
  if (costCents == null || !Number.isFinite(costCents) || costCents <= 0) return "—";
  return `$${(costCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function closedValue(issue: {
  status?: string;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}): Date | string | null {
  if (issue.completedAt) return issue.completedAt;
  if (issue.cancelledAt) return issue.cancelledAt;
  return null;
}

export function visibleCopyHasForbiddenWord(text: string): boolean {
  return /\bissue\b/i.test(text) || /\bdisposition\b/i.test(text);
}

export function systemStatusLine(status: WorkItemStatus): string {
  return `Moved to ${WORK_ITEM_STATUS_LABELS[status]}.`;
}

export function systemAssigneeLine(name: string): string {
  return `Assigned to ${name}.`;
}

export function staleAgentStatusCaption(args: {
  status: WorkItemStatus;
  agentName: string | null;
  agentFinished: boolean;
}): string | null {
  if (!args.agentFinished || !args.agentName) return null;
  if (args.status === "done" || args.status === "cancelled" || args.status === "blocked") return null;
  return `${args.agentName} finished without updating status`;
}

export function defaultWorkItemType(ancestorCount: number): WorkItemType {
  if (ancestorCount >= 2) return "Task";
  if (ancestorCount === 1) return "Story";
  return "Task";
}

export function isHumanComment(comment: Pick<IssueComment, "authorType">): boolean {
  return comment.authorType === "user";
}

export function isAgentComment(comment: Pick<IssueComment, "authorType" | "authorAgentId" | "derivedAuthorAgentId">): boolean {
  return comment.authorType === "agent" || Boolean(comment.authorAgentId || comment.derivedAuthorAgentId);
}

export type WorkItemActivityKind = "agent" | "agent-overflow" | "human" | "system";

export type WorkItemActivityItem = {
  id: string;
  kind: WorkItemActivityKind;
  name?: string;
  time?: string;
  body?: string;
  text?: string;
};

export function highlightMentions(body: string): Array<{ text: string; mention: boolean }> {
  const parts: Array<{ text: string; mention: boolean }> = [];
  const re = /@([A-Za-z0-9._-]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index), mention: false });
    parts.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}

export function resolveBlockedBy(issue: {
  blockedBy?: Array<{ id: string; identifier: string | null }> | null;
  description?: string | null;
}): WorkItemBlockedBy | null {
  const waiting = WAITING_COMMENT_RE.test(issue.description ?? "");
  const first = issue.blockedBy?.[0];
  if (first) {
    return { kind: "item", id: first.id, identifier: first.identifier?.trim() || first.id };
  }
  if (waiting) return { kind: "waiting-on-you" };
  return null;
}

/** A child task created from an approved plan, as the work-item view lists it. */
export type WorkItemTaskRow = {
  id: string;
  identifier: string;
  title: string;
  status: WorkItemStatus;
  /** Waiting behind another task; shown as Queued rather than To do. */
  queued?: boolean;
  href: string;
  /** When the plan approval created this task — the bolt's start time. */
  createdAt?: Date | string | null;
};

export const QUEUED_LABEL = "Queued";

export function taskRowLabel(task: Pick<WorkItemTaskRow, "status" | "queued">): string {
  if (task.queued && task.status !== "done" && task.status !== "cancelled") return QUEUED_LABEL;
  return WORK_ITEM_STATUS_LABELS[task.status];
}

/** One pass/fail step shown in the Bolt fact's tooltip. */
export type WorkItemBoltGate = {
  label: string;
  passed: boolean;
};

export type WorkItemBolt = {
  /** How many times the plan has been proposed (a revised plan starts a new bolt). */
  number: number;
  /** The first plan task's createdAt — when the approved plan started running. */
  startedAt: Date | string | null;
  gates: WorkItemBoltGate[];
  gatesPassed: number;
  gatesTotal: number;
  /** "Bolt 1 · 3 of 3 gates" */
  label: string;
};

/**
 * A bolt is one approved plan run to its wrap-up: propose, approve, work,
 * ship. There is nothing to show until a plan exists, so this returns null
 * for a task that never proposed one — the caller keeps the "Coming"
 * placeholder in that case.
 */
export function computeWorkItemBolt(input: {
  hasPlan: boolean;
  planRevisionNumber: number | null;
  tasks: Array<{ status: WorkItemStatus; createdAt?: Date | string | null }>;
  parentStatus: WorkItemStatus;
}): WorkItemBolt | null {
  if (!input.hasPlan) return null;
  const number =
    input.planRevisionNumber && input.planRevisionNumber > 0 ? Math.trunc(input.planRevisionNumber) : 1;
  const planApproved = input.tasks.length > 0;
  // Cancelled child tasks (dropped from the plan before approval, or later
  // abandoned) do not block the Evaluation gate — only "done" is required of
  // the tasks that are still part of the plan.
  const evaluation =
    planApproved && input.tasks.every((task) => task.status === "done" || task.status === "cancelled");
  const shipped = input.parentStatus === "done";
  const gates: WorkItemBoltGate[] = [
    { label: "Plan approved", passed: planApproved },
    { label: "Evaluation", passed: evaluation },
    { label: "Shipped", passed: shipped },
  ];
  const gatesPassed = gates.filter((gate) => gate.passed).length;
  return {
    number,
    startedAt: planApproved ? input.tasks[0]?.createdAt ?? null : null,
    gates,
    gatesPassed,
    gatesTotal: gates.length,
    label: `Bolt ${number} · ${gatesPassed} of ${gates.length} gates`,
  };
}

/** Newline-joined gate checklist for the Bolt fact's title (tooltip) attribute. */
export function boltTooltip(bolt: WorkItemBolt): string {
  return bolt.gates.map((gate) => `${gate.passed ? "✓" : "○"} ${gate.label}`).join("\n");
}
