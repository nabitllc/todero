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

export type ConversationOutcome = "done" | "review" | "waiting";

export type ConversationOutcomePlan = {
  outcome: ConversationOutcome;
  status: "done" | "blocked";
  description: string;
};

/**
 * Every conversation marker off. What a task keeps once it closes, and the
 * clean base a task sent back for another round starts from.
 */
export function descriptionWithoutConversationMarkers(description: string | null | undefined): string {
  return descriptionWithWaitingMarker(
    descriptionWithPlanMarker(descriptionWithReviewMarker(description, false), false),
    false,
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

/**
 * A plan that was claimed but never written.
 *
 * A small local model sometimes ends the planning turn with "Do you approve
 * this plan?" and writes no plan at all. Nothing parses, so the task has
 * nothing on it to approve and the person's answer only produces the same
 * question again — the loop seen with a 14B local model, fifteen rounds in
 * four minutes. Todero asks once more, saying exactly what is missing, and if
 * the second try is no better it stops asking and tells the person in plain
 * words.
 *
 * The count of tries lives in the task description, the way the reviewer's
 * round count already does, so it survives the run that made it: every
 * heartbeat builds a fresh request, and anything kept only in that request is
 * forgotten by the next one.
 */
const PLAN_TRIES_RE = /<!--\s*todero-plan-tries:\s*(\d+)\s*-->\s*\n?/gi;

/** One corrective retry, never two. */
export const PLAN_MAX_TRIES = 1;

/** The wake that carries the corrective turn back to the agent. */
export const MISSING_PLAN_RETRY_WAKE_REASON = "issue_plan_not_written";

export function readPlanTries(description: string | null | undefined): number {
  let tries = 0;
  for (const match of (description ?? "").matchAll(PLAN_TRIES_RE)) {
    const value = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(value) && value > tries) tries = value;
  }
  return tries;
}

/** The description with exactly one count on it, or none when the count is zero. */
export function descriptionWithPlanTries(description: string | null | undefined, tries: number): string {
  const stripped = (description ?? "").replace(PLAN_TRIES_RE, "");
  const count = Math.max(0, Math.trunc(tries));
  if (count === 0) return stripped;
  return `<!-- todero-plan-tries: ${count} -->\n${stripped.replace(/^\s*\n/, "")}`;
}

/** Todero already asked twice and got prose back: the plan step is over for this task. */
export function hasGivenUpOnPlan(description: string | null | undefined): boolean {
  return readPlanTries(description) > PLAN_MAX_TRIES;
}

const PLAN_WORD_RE = /\bplans?\b/i;
/**
 * The ways a model actually hands the turn over: "would you like to proceed",
 * "do you approve", "please confirm", "shall I proceed", "does this plan work
 * for you", "let me know if you'd like any changes", "if you're happy with it,
 * say go". Deliberately not the bare words "accept" or "review" — those belong
 * to ordinary hand-ins, and not a bare "let me know", which is how a model
 * invites questions after finishing real work.
 */
const HANDS_OVER_RES: RegExp[] = [
  /\b(?:approve[sd]?|approving|approval)\b/i,
  /\bconfirm(?:s|ed|ation)?\b/i,
  /\bsign[-\s]?off\b|\bsigns?\s+off\b/i,
  /\bgreen[-\s]?light\b|\bgo[-\s]?ahead\b/i,
  /\bshall\s+i\b/i,
  /\b(?:should|can|may)\s+i\s+(?:proceed|start|begin|continue|get\s+going|kick\s+off)\b/i,
  // The commonest closing of all in real qwen2.5-coder:14b planning replies:
  // "Would you like to proceed with this plan?", "Do you want me to start?".
  // The "me" is optional because the model writes it both ways.
  /\b(?:would\s+you\s+like|do\s+you\s+want)\s+(?:me\s+)?to\s+(?:proceed|start|begin|continue|go\s+ahead|move\s+forward|get\s+going|kick\s+off)\b/i,
  /\bhappy\s+with\b|\bokay?\s+with\b/i,
  /\bsay\s+go\b|\bgive\s+(?:me\s+)?the\s+(?:go|green)\b/i,
  /\bsounds?\s+good\b|\blooks?\s+good\b/i,
  /\blet\s+me\s+know\s+(?:if|whether)\s+(?:this|that|it|these|they|the\s+plan|you(?:'d|\s+would)?\s*(?:like|want)|you(?:'re|\s+are)?\s*(?:happy|ok|okay|good))\b/i,
  // "Does this plan work for you?" — and "Let me know and I'll get going",
  // which uses "and" where the line above wants "if".
  /\bworks?\s+for\s+you\b/i,
  /\blet\s+me\s+know\s+and\s+i(?:'ll|\s+will)\b/i,
  // The commonest hand-over of all in twenty sampled qwen2.5-coder:14b
  // planning replies — eleven of them close this way: "Please review the
  // plan and let me know if you need any changes." Bare "review" is still
  // an ordinary hand-in; it is "review the plan" that hands the turn over,
  // and "let me know if you need changes" that asks for an answer, where
  // "let me know if you have any questions" only invites questions.
  /\breview\s+(?:the|this|that|my|our|its)?\s*(?:above\s+|proposed\s+|attached\s+)*(?:plan|proposal)\b/i,
  /\blet\s+me\s+know\s+if\s+(?:you\s+(?:need|want|require|have)|any|there\s+(?:are|is))\b[^.?!\n]{0,40}\b(?:changes?|adjustments?|additions?|additional|feedback|thoughts?|tweaks?|edits?|revisions?|modifications?)\b/i,
];
/** How much of the tail of a reply counts as "the closing lines". */
const CLOSING_LINES = 8;

function handsTheTurnOver(text: string): boolean {
  return HANDS_OVER_RES.some((re) => re.test(text));
}

/**
 * The reply with its fenced blocks taken out.
 *
 * The closing-lines window is meant to hold the words the model writes to the
 * person. A block longer than the window fills it on its own and pushes the
 * sentence that named the plan out of reach of the sign-off, so "Sure, here's
 * the plan:" + a block + "Please review and let me know if any changes are
 * needed" reads as an ordinary hand-in. That only matters when the block did
 * not parse — a plan that parses is on the task and there is nothing to
 * rescue — and that is exactly the case this rescue exists for. An unclosed
 * fence runs to the end of the reply, which is what a truncated block looks
 * like.
 */
function withoutFencedBlocks(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i]!.match(/^[ \t]*(`{3,}|~{3,})/);
    if (!open) {
      kept.push(lines[i]!);
      continue;
    }
    const marker = open[1]![0]!;
    const closeRe = new RegExp(`^[ \\t]*${marker}{3,}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j]!)) j += 1;
    i = j;
  }
  return kept.join("\n");
}

function closesOnAPlan(text: string): boolean {
  const closing = text
    .split("\n")
    .filter((line) => line.trim())
    .slice(-CLOSING_LINES)
    .join("\n");
  return PLAN_WORD_RE.test(closing) && handsTheTurnOver(closing);
}

/**
 * Does the reply hand the turn over on the strength of a plan? A plan has to
 * be named and the turn handed over close together — in one paragraph, or
 * across the closing lines of the reply, which is where a model writes "Here
 * is the plan:", lists it, and signs off with "Please confirm and I'll get
 * started." A hand-in that says "please accept the config", a line that
 * merely mentions a plan, and a sign-off that only invites questions are
 * ordinary replies and never match.
 *
 * The closing lines are read twice, once as written and once with the fenced
 * blocks taken out, so a long block cannot hide the sign-off from the
 * sentence that named the plan. No new way of handing the turn over is
 * recognised by that second pass: the same two signals have to be there, in
 * the same closing lines, with the block no longer counted as words.
 */
export function asksToApproveAPlan(reply: string): boolean {
  const text = reply.replace(/\r\n?/g, "\n");
  const paragraphs = text.split(/\n[ \t]*\n+/);
  if (paragraphs.some((para) => PLAN_WORD_RE.test(para) && handsTheTurnOver(para))) return true;
  return closesOnAPlan(text) || closesOnAPlan(withoutFencedBlocks(text));
}

/** The task was told to write a plan in the one shape Todero can read. */
export function taskAsksForPlanBlock(description: string | null | undefined): boolean {
  return spellsOutToderoPlanBlock(description);
}

/** What Todero tells the model when the plan it claimed did not arrive. */
export function buildMissingPlanRetryInstruction(): string {
  return [
    "Your last message asked the person to approve a plan, but no plan came with it, so there is nothing on the task for them to approve.",
    "",
    "Send the plan again now, with the real content of your plan in it.",
    "",
    TODERO_PLAN_BLOCK_INSTRUCTIONS,
    "",
    "Say at most one sentence before the block. Then end your message with `STATUS: waiting`.",
  ].join("\n");
}

/** What Todero tells the model on every later turn of a task it gave up on. */
export function buildStopAskingForPlanInstruction(): string {
  return [
    "Do not propose a plan on this task and do not ask for one to be approved: that step is over.",
    "Answer the person's last message directly, in plain words, and end with `STATUS: waiting`.",
  ].join("\n");
}

/** The one thing the person reads about it. Plain words, no shop talk. */
export function buildMissingPlanGaveUpComment(agentName: string | null): string {
  const who = agentName?.trim() || "This agent";
  return [
    `${who} is stuck on the plan. Twice now it has asked you to approve a plan and then not written one down, so there is nothing here for you to approve.`,
    "",
    "Tell it in your own words what the first few pieces of work should be and it will pick it up from there — it will not ask you to approve a plan again. If it still cannot get going, stop this one and start again with a stronger model.",
  ].join("\n");
}

/** The one thing the person reads when the agent could not even be restarted. */
export function buildMissingPlanStalledComment(agentName: string | null): string {
  const who = agentName?.trim() || "This agent";
  return [
    `${who} asked you to approve a plan and then did not write one down, so there is nothing here for you to approve. Todero tried to start it again to have another go and could not.`,
    "",
    "Tell it in your own words what the first few pieces of work should be and it will pick it up from there — it will not ask you to approve a plan again.",
  ].join("\n");
}

export type MissingPlanHandBack = { description: string; comment: string };

export type MissingPlanRecovery =
  /**
   * Ask the model once more, in the same task, with the shape spelled out.
   * `fallback` is what to write instead if the agent cannot be brought back
   * at all: the task must never be left sitting with nobody told.
   */
  | { kind: "retry"; description: string; instruction: string; fallback: MissingPlanHandBack }
  /** Give up: the task goes to the person and the plan step is closed. */
  | ({ kind: "hand-back" } & MissingPlanHandBack);

/**
 * What to do about a conversational reply that claimed a plan and wrote none.
 * Null means this is an ordinary reply and the usual outcome applies.
 */
export function planMissingPlanRecovery(input: {
  issue: { status: string; description: string | null; parentId?: string | null };
  disposition: ConversationDisposition;
  /** The reply as the person would read it. */
  reply: string;
  /** The plan block lifted out of that reply, when there was one. */
  planBlock?: string | null;
  /** A wrap-up or manager turn Todero steered itself is never a planning turn. */
  steeredTurn?: boolean;
  /**
   * This conversation already produced a plan: one is stored on it, or its
   * tasks exist. Then there is no planning turn to rescue — whatever the
   * reply says about a plan, the plan was written and approved rounds ago and
   * the work may already be finished. Without this, any of the phrases below
   * could demand a fresh plan block from a conversation that is past that
   * step entirely.
   */
  conversationHasPlan?: boolean;
  agentName?: string | null;
}): MissingPlanRecovery | null {
  if (input.issue.status !== "in_progress") return null;
  if (input.issue.parentId) return null;
  if (input.steeredTurn) return null;
  if (input.conversationHasPlan) return null;
  if (input.disposition !== "waiting") return null;
  if (input.planBlock?.trim()) return null;
  if (!taskAsksForPlanBlock(input.issue.description)) return null;
  if (hasGivenUpOnPlan(input.issue.description)) return null;
  if (!asksToApproveAPlan(input.reply)) return null;

  const tries = readPlanTries(input.issue.description);
  const base = descriptionWithPlanMarker(descriptionWithReviewMarker(input.issue.description, false), false);
  // Whatever happens, the plan step is over once this description is written:
  // the count is past the last try, so the agent is never driven into the
  // same ask again.
  const handBack: MissingPlanHandBack = {
    description: descriptionWithPlanTries(descriptionWithWaitingMarker(base, true), PLAN_MAX_TRIES + 1),
    comment: buildMissingPlanGaveUpComment(input.agentName ?? null),
  };
  if (tries < PLAN_MAX_TRIES) {
    return {
      kind: "retry",
      description: descriptionWithPlanTries(descriptionWithWaitingMarker(base, false), tries + 1),
      instruction: buildMissingPlanRetryInstruction(),
      fallback: {
        description: handBack.description,
        comment: buildMissingPlanStalledComment(input.agentName ?? null),
      },
    };
  }
  return { kind: "hand-back", ...handBack };
}

/**
 * Todero's own words on a task, marked as Todero's.
 *
 * This is not decoration. `loadConversationThread` drops every comment that
 * carries a presentation block, because those are Todero talking about the
 * run rather than a turn of the conversation. Without it the hand-back below
 * is stored under the agent's own id with no marking, comes back as the
 * agent's last turn on the next wake, and the model — a 14B, live — reads
 * Todero's "this agent is stuck on the plan" as something it said and says it
 * again to the person, still asking for a plan review. The machinery had
 * already stopped; only the words kept going.
 */
export const SYSTEM_NOTICE_PRESENTATION: IssueCommentPresentation = {
  kind: "system_notice",
  tone: "warning",
  title: "Todero",
  detailsDefaultOpen: false,
  density: "compact",
};

export type MissingPlanRecoveryDeps = {
  updateIssue: (issueId: string, patch: { status?: string; description?: string }) => Promise<unknown>;
  /**
   * Post the one thing the person reads, on the task. `presentation` is
   * always Todero's own marking: the caller must pass it through so the
   * comment never returns to the model as conversation.
   */
  addComment: (
    issueId: string,
    body: string,
    presentation: IssueCommentPresentation,
  ) => Promise<unknown>;
  /** Bring the agent back for the corrective turn. */
  wakeAgent: (input: { issueId: string; agentId: string }) => Promise<unknown>;
  log: (message: string) => unknown;
};

/** The decision above, carried out. Kept out of heartbeat.ts so it can be tested without a database. */
export async function applyMissingPlanRecovery(
  deps: MissingPlanRecoveryDeps,
  input: { issueId: string; agentId: string; recovery: MissingPlanRecovery },
): Promise<MissingPlanRecovery["kind"]> {
  const { recovery } = input;
  if (recovery.kind === "retry") {
    await deps.updateIssue(input.issueId, { status: "todo", description: recovery.description });
    try {
      await deps.wakeAgent({ issueId: input.issueId, agentId: input.agentId });
    } catch (err) {
      // The task is sitting in todo with nobody on the way to it. Put it in
      // front of the person rather than leave it there.
      deps.log(
        `[todero] It could not be started again to rewrite the plan: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      await deps.updateIssue(input.issueId, { status: "blocked", description: recovery.fallback.description });
      await deps.addComment(input.issueId, recovery.fallback.comment, SYSTEM_NOTICE_PRESENTATION);
      return "hand-back";
    }
    deps.log("[todero] It asked to have a plan approved but wrote none; asking it once more.\n");
    return "retry";
  }
  await deps.updateIssue(input.issueId, { status: "blocked", description: recovery.description });
  await deps.addComment(input.issueId, recovery.comment, SYSTEM_NOTICE_PRESENTATION);
  deps.log("[todero] No plan came back the second time either; the task is over to the person.\n");
  return "hand-back";
}
