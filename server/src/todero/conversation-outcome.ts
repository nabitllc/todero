import { and, asc, eq } from "drizzle-orm";
import { TODERO_PLAN_BLOCK_INSTRUCTIONS, spellsOutToderoPlanBlock } from "@todero/shared";
import type { IssueCommentPresentation } from "@todero/shared";
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

/** True when the task's text says a hand-in is waiting to be read. */
export function hasReviewPendingNote(description: string | null | undefined): boolean {
  return new RegExp(REVIEW_PENDING_RE.source, "i").test(description ?? "");
}

/** True when the task's text says a proposed plan is waiting for a yes. */
export function hasPlanPendingNote(description: string | null | undefined): boolean {
  return new RegExp(PLAN_PENDING_RE.source, "i").test(description ?? "");
}

/**
 * The third of those markers, and the newest: a hand-in nobody could review,
 * because the organization was on hold when it arrived. It means a reviewer
 * still owes this task an answer, and it is taken off again the moment one is
 * given.
 */
export const REVIEW_DEFERRED_MARKER = "<!-- todero-review: deferred -->";
const REVIEW_DEFERRED_RE = /<!--\s*todero-review:\s*deferred\s*-->\s*\n?/gi;

export function descriptionWithDeferredReviewMarker(
  description: string | null | undefined,
  on: boolean,
): string {
  return withMarker(description ?? "", REVIEW_DEFERRED_MARKER, REVIEW_DEFERRED_RE, on);
}

export function hasDeferredReviewMarker(description: string | null | undefined): boolean {
  return (description ?? "").includes(REVIEW_DEFERRED_MARKER);
}

/**
 * The deferred marker's sibling: this task's refusal has already been looked
 * at once more under the reviewer's current brief. It stops a second start
 * reviewing the same refused hand-in all over again, and it comes off the
 * moment the task hands work in again or closes.
 */
export const REVIEW_REFRESHED_MARKER = "<!-- todero-review: refreshed -->";
const REVIEW_REFRESHED_RE = /<!--\s*todero-review:\s*refreshed\s*-->\s*\n?/gi;

export function descriptionWithRefreshedReviewMarker(
  description: string | null | undefined,
  on: boolean,
): string {
  return withMarker(description ?? "", REVIEW_REFRESHED_MARKER, REVIEW_REFRESHED_RE, on);
}

export function hasRefreshedReviewMarker(description: string | null | undefined): boolean {
  return (description ?? "").includes(REVIEW_REFRESHED_MARKER);
}

/**
 * Everything a task says while its review waits for the organization to start
 * again: it is in front of the person, it is in review, and a reviewer still
 * owes it an answer. Written from whatever the task already said, so it holds
 * whether the hand-in wrote its own two notes first or not.
 */
export function descriptionForDeferredReview(description: string | null | undefined): string {
  return descriptionWithDeferredReviewMarker(
    descriptionWithReviewMarker(descriptionWithWaitingMarker(description ?? "", true), true),
    true,
  );
}

/**
 * The fourth thing a task's text carries about its conversation: how many
 * turns in a row it has ended with nothing on it. Kept here, beside the
 * markers, rather than with the rest of the empty-turn rules, so that closing
 * a task takes it off with everything else. `empty-turn-recovery.ts` passes
 * both of these on under its own name.
 *
 * Every heartbeat builds a fresh request, so a count held only in that request
 * would be forgotten by the next one. It goes back to nothing the moment the
 * task hands real work in, and again when the task closes.
 */
const EMPTY_TURNS_RE = /<!--\s*todero-empty-turns:\s*(\d+)\s*-->\s*\n?/gi;

export function readEmptyTurnTries(description: string | null | undefined): number {
  let tries = 0;
  for (const match of (description ?? "").matchAll(EMPTY_TURNS_RE)) {
    const value = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(value) && value > tries) tries = value;
  }
  return tries;
}

/** The description with exactly one count on it, or none when the count is zero. */
export function descriptionWithEmptyTurnTries(description: string | null | undefined, tries: number): string {
  const stripped = (description ?? "").replace(EMPTY_TURNS_RE, "");
  const count = Math.max(0, Math.trunc(tries));
  if (count === 0) return stripped;
  return `<!-- todero-empty-turns: ${count} -->\n${stripped.replace(/^\s*\n/, "")}`;
}

export type ConversationOutcome = "done" | "review" | "waiting";

export type ConversationOutcomePlan = {
  outcome: ConversationOutcome;
  status: "done" | "blocked";
  description: string;
};

/**
 * Everything the conversation wrote on the task, off: the three markers and
 * the count of turns that produced nothing. What a task keeps once it closes,
 * and the clean base a task sent back for another round starts from.
 *
 * This is the last word on that count. A closed task can be set going again by
 * a person's comment, with the text it closed with and nothing rewritten, so a
 * count left on it here would be read by a turn days later.
 */
export function descriptionWithoutConversationMarkers(description: string | null | undefined): string {
  return descriptionWithEmptyTurnTries(
    descriptionWithWaitingMarker(
      descriptionWithPlanMarker(
        descriptionWithReviewMarker(
          descriptionWithRefreshedReviewMarker(descriptionWithDeferredReviewMarker(description, false), false),
          false,
        ),
        false,
      ),
      false,
    ),
    0,
  );
}

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
}): ConversationOutcomePlan | null {
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

/** What the reviewer decided about a hand-in that was headed for the person. */
export type ReviewerDecision = "accept" | "handoff" | "revise" | "none";

/**
 * Wave E: the reviewer reads the hand-in before the person does, and only its
 * "accept" changes where the task lands — it closes the task the same way the
 * person's Accept does. "revise" means the reviewer already sent the task back
 * to the agent, so there is nothing left for the caller to write (null).
 * Anything else leaves the review gate exactly where Wave C put it.
 */
export function planReviewedOutcome(
  plan: ConversationOutcomePlan,
  decision: ReviewerDecision,
): ConversationOutcomePlan | null {
  if (plan.outcome !== "review") return plan;
  if (decision === "revise") return null;
  if (decision !== "accept") return plan;
  return {
    outcome: "done",
    status: "done",
    description: descriptionWithoutConversationMarkers(plan.description),
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

/** The issue document a follow-on project idea from the wrap-up lives in. */
export const NEXT_PROJECT_DOCUMENT_KEY = "next";

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
    "Write the wrap-up for the person: in plain words, what was delivered for each feature, what they should look at first, and the one or two things you would do next if they want to keep going. Do not propose a new plan block.",
    "If you can see one clear next project worth doing after this one, end that wrap-up with one line that starts with `Next:` naming it in a few words — the idea, not a plan. Leave that line out if nothing obvious comes to mind.",
    "Then end with `STATUS: done`.",
  ].join("\n");
}

const NEXT_LINE_RE = /^\s*next\s*:\s*(.+?)\s*$/i;

/**
 * The last `Next:` line in a wrap-up reply, if the model included one. Scans
 * from the end since that is where `buildPlanSummaryTurnInstruction` asks for
 * it; an earlier, unrelated use of the word "next" in the body should not
 * match.
 */
export function parseNextProjectLine(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i]!.match(NEXT_LINE_RE);
    if (match) {
      const value = match[1]!.trim();
      return value ? value : null;
    }
  }
  return null;
}
