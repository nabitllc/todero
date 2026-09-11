import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@todero/db";
import { issues } from "@todero/db";
import {
  descriptionWithWaitingMarker,
  type ConversationDisposition,
} from "./conversation-thread.js";

/**
 * Markers the work-item view and the Inbox read from the description. They
 * sit next to the existing waiting-on-you marker and mean:
 *  - review pending: the agent handed in its output; the person accepts or sends it back.
 *  - plan pending:   the agent proposed a plan; the person approves or asks for changes.
 */
export const REVIEW_PENDING_MARKER = "<!-- todero-review: pending -->";
export const PLAN_PENDING_MARKER = "<!-- todero-plan: pending -->";
const REVIEW_PENDING_RE = /<!--\s*todero-review:\s*pending\s*-->\s*\n?/gi;
const PLAN_PENDING_RE = /<!--\s*todero-plan:\s*pending\s*-->\s*\n?/gi;
const TYPE_MARKER_RE = /^(\s*<!--\s*todero-type:\s*[A-Za-z]+\s*-->\s*\n?)/;
const WAITING_HEAD_RE = /^([\s\S]*?<!--\s*todero-blocked-by:\s*waiting-on-you\s*-->[ \t]*\n?)/;

function withMarker(description: string, marker: string, re: RegExp, on: boolean): string {
  const stripped = description.replace(re, "");
  if (!on) return stripped;
  // Right after the waiting-on-you marker when present, else under the type marker.
  const waiting = stripped.match(WAITING_HEAD_RE);
  if (waiting) {
    const head = waiting[1]!.replace(/\s*$/, "\n");
    return `${head}${marker}\n${stripped.slice(waiting[1]!.length).replace(/^\s*\n/, "")}`;
  }
  const typeMatch = stripped.match(TYPE_MARKER_RE);
  if (typeMatch) {
    const head = typeMatch[1]!.replace(/\s*$/, "\n");
    return `${head}${marker}\n${stripped.slice(typeMatch[1]!.length).replace(/^\s*\n/, "")}`;
  }
  return `${marker}\n${stripped.replace(/^\s*\n/, "")}`;
}

export function descriptionWithReviewMarker(description: string | null | undefined, on: boolean): string {
  return withMarker(description ?? "", REVIEW_PENDING_MARKER, REVIEW_PENDING_RE, on);
}

export function descriptionWithPlanMarker(description: string | null | undefined, on: boolean): string {
  return withMarker(description ?? "", PLAN_PENDING_MARKER, PLAN_PENDING_RE, on);
}

export type ConversationOutcome = "done" | "review" | "waiting";

/**
 * Wave C: a child task's "done" is not the end. Its output goes to the
 * person first (blocked, waiting on you, review pending); Accept closes it
 * through the normal API, which wakes the task behind it. A task with no
 * parent (the conversation, or its final summary) closes directly.
 */
export function planConversationOutcome(input: {
  issue: { status: string; description: string | null; parentId?: string | null };
  disposition: ConversationDisposition;
  proposedPlan?: boolean;
  /**
   * Only the wrap-up turn (woken because every child closed) may close the
   * conversation task. A model that says "done" mid-conversation, or right
   * after proposing a plan, is handing the turn back, whatever it wrote.
   */
  closeAllowed?: boolean;
}): { outcome: ConversationOutcome; status: "done" | "blocked"; description: string } | null {
  if (input.issue.status !== "in_progress") return null;
  const base = descriptionWithPlanMarker(descriptionWithReviewMarker(input.issue.description, false), false);
  const isConversation = !input.issue.parentId;
  if (input.disposition === "done" && isConversation && input.closeAllowed && !input.proposedPlan) {
    return { outcome: "done", status: "done", description: descriptionWithWaitingMarker(base, false) };
  }
  if (input.disposition === "done" && !isConversation) {
    return {
      outcome: "review",
      status: "blocked",
      description: descriptionWithReviewMarker(descriptionWithWaitingMarker(base, true), true),
    };
  }
  return {
    outcome: "waiting",
    status: "blocked",
    description: input.proposedPlan
      ? descriptionWithPlanMarker(descriptionWithWaitingMarker(base, true), true)
      : descriptionWithWaitingMarker(base, true),
  };
}

export const CONVERSATION_OUTPUT_DOCUMENT_KEY = "output";

export type PlanChildSummary = { identifier: string; title: string; status: string };

/** The child tasks of a plan parent, oldest first, for the closing summary. */
export async function loadPlanChildren(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<PlanChildSummary[]> {
  const rows = await db
    .select({ identifier: issues.identifier, title: issues.title, status: issues.status, createdAt: issues.createdAt })
    .from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.parentId, input.issueId)))
    .orderBy(asc(issues.createdAt), asc(issues.id));
  return rows.map((row) => ({ identifier: row.identifier ?? "", title: row.title, status: row.status }));
}

export function allPlanChildrenClosed(children: PlanChildSummary[]): boolean {
  return children.length > 0 && children.every((child) => child.status === "done" || child.status === "cancelled");
}

/**
 * The extra turn a plan parent gets when its last task closes: the agent
 * writes the wrap-up for the person and closes the conversation itself.
 */
export function buildPlanSummaryTurnInstruction(children: PlanChildSummary[]): string {
  const lines = children.map((child) => `- ${child.identifier} ${child.title} (${child.status})`);
  return [
    "Every task in your plan is now closed:",
    ...lines,
    "",
    "Write the wrap-up for the person: in plain words, what was delivered for each feature, what they should look at first, and the one or two things you would do next if they want to keep going. Do not propose a new plan block. End with `STATUS: done`.",
  ].join("\n");
}
