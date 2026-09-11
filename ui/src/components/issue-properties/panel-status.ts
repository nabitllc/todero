import type { IssueStatus } from "@todero/shared";
import {
  WORK_ITEM_STATUSES,
  WORK_ITEM_STATUS_LABELS,
  apiStatusFor,
  commitWorkItemStatus,
  displayStatus,
  isAssigned,
  resolveBlockedBy,
  taskRowLabel,
  type WorkItemStatus,
} from "../work-item/work-item-model";

/**
 * One status vocabulary for the whole task view. The card's chip already reads
 * `displayStatus` and the six words of {@link WORK_ITEM_STATUS_LABELS}; these
 * helpers give the Properties panel the same reading of the same task, so the
 * chip and the panel can never disagree (the raw "backlog" never appears, and a
 * task waiting behind another says Queued in both places).
 */

/** The shape of an issue these helpers read. Kept structural so tests need no fixture. */
export type PanelStatusIssue = {
  status: IssueStatus | string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  blockedBy?: Array<{ id: string; identifier: string | null }> | null;
  description?: string | null;
};

/** The statuses the panel offers, in the order the picker lists them. */
export const PANEL_STATUS_OPTIONS: ReadonlyArray<WorkItemStatus> = WORK_ITEM_STATUSES;

export function panelStatusOptionLabel(status: WorkItemStatus): string {
  return WORK_ITEM_STATUS_LABELS[status];
}

/** The six-word status this task is in, as the card's chip reads it. */
export function panelStatus(issue: PanelStatusIssue): WorkItemStatus {
  return displayStatus(issue);
}

/** True when the task waits behind another task, so the label reads Queued. */
export function panelQueued(issue: PanelStatusIssue): boolean {
  return (issue.blockedBy ?? []).length > 0;
}

/** What the panel's Status row says: the six words, plus Queued when computed. */
export function panelStatusLabel(issue: PanelStatusIssue): string {
  return taskRowLabel({ status: panelStatus(issue), queued: panelQueued(issue) });
}

/**
 * Which glyph the row draws. A task held behind another gets the queued shape
 * (blocked, recoloured blue); everything else draws its own API status.
 */
export function panelStatusGlyph(issue: PanelStatusIssue): string {
  const status = panelStatus(issue);
  if (status === "blocked" && panelQueued(issue)) return "in_queue";
  return apiStatusFor(status);
}

/**
 * The hover and accessible line: the word the row shows, plus why the task is
 * held when something knows. `Blocked · waiting on PAP-2` becomes
 * `Queued · waiting on PAP-2` so the reason never contradicts the label.
 */
export function panelStatusTitle(label: string, attentionLabel: string | null | undefined): string {
  if (!attentionLabel) return label;
  if (attentionLabel === "Blocked") return label;
  const detail = attentionLabel.startsWith("Blocked · ")
    ? attentionLabel.slice("Blocked · ".length)
    : attentionLabel;
  return `${label} · ${detail}`;
}

export type PanelStatusCommit =
  | { ok: true; patch: { status: IssueStatus } }
  | { ok: false; caption: string };

/**
 * The card's own rules, applied to the panel: In progress needs an assignee,
 * and Blocked needs something to be blocked by. Without this the panel could
 * park a task on Blocked with no blocker — the state the turn bar has nothing
 * to say about.
 */
export function panelStatusPatch(issue: PanelStatusIssue, next: WorkItemStatus): PanelStatusCommit {
  const result = commitWorkItemStatus({
    status: next,
    assigned: isAssigned(issue),
    blockedBy: resolveBlockedBy(issue),
  });
  if (!result.ok) return { ok: false, caption: result.caption };
  return { ok: true, patch: { status: result.apiStatus } };
}
