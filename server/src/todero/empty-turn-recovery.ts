/**
 * A turn that delivered nothing and asked for nothing, and the way back from
 * it.
 *
 * Wave 4 of the improvement loop. Wave 19 (organization
 * f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3) deadlocked on exactly this. Two tasks
 * were sent back by the reviewer; on the round that came back, one of them
 * wrote its own task brief out again — goal, feature, done when, what the
 * person said, the last verdict — with no guide in it, and the other wrote a
 * "Final Review and Next Steps" action list about the work it had not done. A
 * chat reply with no `STATUS: done` line means "waiting", waiting means the
 * person's turn, so both tasks were parked in front of the person with nothing
 * on them to answer. Nobody answered. Five tasks queued behind one of them
 * never ran and the project never finished.
 *
 * A turn like that is not the person's to answer, so Todero does not hand it
 * to them. It says so on the task, asks the worker once more for the thing
 * itself, and if the second try is no better it stops and tells the person in
 * plain words that the task produced no work twice. Never a third silent
 * round.
 *
 * The conversation task is left alone: a conversation handing its turn back to
 * the person is the design, not a fault.
 *
 * Everything here is pure except `applyEmptyTurnRecovery`, which is the same
 * shape as the plan rescue next door in `missing-plan-recovery.ts` and is kept
 * out of the heartbeat so it can be tested without a database.
 */
import type { IssueCommentPresentation } from "@todero/shared";
import { descriptionWithWaitingMarker, type ConversationDisposition } from "./conversation-thread.js";
import { descriptionWithPlanMarker, descriptionWithReviewMarker } from "./conversation-outcome.js";
import { asksThePersonForAnything } from "./inputs-arrived.js";
import { SYSTEM_NOTICE_PRESENTATION } from "./missing-plan-recovery.js";

/** One corrective retry, never two. */
export const EMPTY_TURN_MAX_TRIES = 1;

/** The wake that carries the corrective turn back to the worker. */
export const EMPTY_TURN_RETRY_WAKE_REASON = "issue_turn_produced_nothing";

/**
 * How many turns in a row this task has ended with nothing on it. Kept in the
 * task's own text, the way the plan tries and the reviewer's rounds already
 * are: every heartbeat builds a fresh request, so a count held only in that
 * request is forgotten by the next one. It goes back to nothing the moment the
 * task hands real work in.
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

/**
 * The lines that are the task read back rather than the work. Both wave-19
 * replies are made of these and nothing else: the task's own identifier, and
 * the labelled lines of the brief the worker is given every turn.
 */
const IDENTIFIER_ONLY_RE = /^\s*\**\s*[A-Z][A-Z0-9]*-\d+\s*\**\s*$/;
const BRIEF_LABEL_RE =
  /^\s*(?:[-*]\s+|\d+[.)]\s+)?\**\s*(?:goal|feature|done[- ]when|what the person said|last verdict|task|title|output|deliverable|objective|context|acceptance criteria|status|review status|progress)\s*\**\s*:/i;

/**
 * Where a reply stops being the work and starts being a list of what someone
 * should do next. Everything from this line on is about the work, not the work
 * itself, so it does not count as a hand-in — but anything written above it
 * still does, which is why a real guide with "Next steps" tacked on the end is
 * a hand-in like any other.
 */
const WHAT_COMES_NEXT_RE =
  /^\s*(?:[-*]\s+|\d+[.)]\s+|#{1,6}\s+)?\**\s*(?:[\w ]*\b(?:next steps?|action required|action items?|recommended actions?|way forward|what happens next)\b[\w ]*)\s*\**\s*:?\s*\**\s*$/i;

/** Below this much left over, the turn handed nothing in. */
const DELIVERS_MIN_CHARS = 40;

/**
 * Did this turn actually hand something in? Take out the task read back and
 * the list of what to do next, and see whether anything of substance is left.
 */
export function turnDeliversWork(body: string): boolean {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (WHAT_COMES_NEXT_RE.test(line)) break;
    if (IDENTIFIER_ONLY_RE.test(line)) continue;
    if (BRIEF_LABEL_RE.test(line)) continue;
    kept.push(line.trim());
  }
  return kept.join(" ").replace(/[*_#`>\s-]+/g, " ").trim().length >= DELIVERS_MIN_CHARS;
}

/** What Todero does about this turn: ask once more, or let it sit with the person. */
export type EmptyTurnDecision = "retry" | "waiting";

/**
 * A turn is only retried when all of this holds: it belongs to a task inside a
 * plan, the worker handed the turn back rather than finishing, it asked the
 * person for nothing, it handed nothing in, and Todero has not already asked
 * once. Anything else is left exactly where it was.
 */
export function planEmptyTurnOutcome(input: {
  issue: { status: string; description: string | null; parentId?: string | null };
  disposition: ConversationDisposition;
  reply: string;
}): EmptyTurnDecision {
  if (input.issue.status !== "in_progress") return "waiting";
  if (!input.issue.parentId) return "waiting";
  if (input.disposition !== "waiting") return "waiting";
  if (asksThePersonForAnything(input.reply)) return "waiting";
  if (turnDeliversWork(input.reply)) return "waiting";
  return readEmptyTurnTries(input.issue.description) < EMPTY_TURN_MAX_TRIES ? "retry" : "waiting";
}

export type EmptyTurnHandBack = { description: string; comment: string };

export type EmptyTurnRecovery =
  /**
   * Ask the worker once more, in the same task, for the thing itself.
   * `fallback` is what to write instead if it cannot be brought back at all:
   * the task must never be left sitting with nobody told.
   */
  | { kind: "retry"; description: string; instruction: string; comment: string; fallback: EmptyTurnHandBack }
  /** Stop asking: the task goes to the person with one plain message. */
  | ({ kind: "hand-back" } & EmptyTurnHandBack);

/**
 * What to do about a turn that produced nothing. Null means this is an
 * ordinary reply and the usual outcome applies — including the third round and
 * any after it, which are parked the way everything else is, with nothing more
 * said about it.
 */
export function planEmptyTurnRecovery(input: {
  issue: { status: string; description: string | null; parentId?: string | null };
  disposition: ConversationDisposition;
  /** The reply as the person would read it. */
  reply: string;
  agentName?: string | null;
}): EmptyTurnRecovery | null {
  const tries = readEmptyTurnTries(input.issue.description);
  const base = descriptionWithPlanMarker(descriptionWithReviewMarker(input.issue.description, false), false);
  const handBack: EmptyTurnHandBack = {
    description: descriptionWithEmptyTurnTries(
      descriptionWithWaitingMarker(base, true),
      EMPTY_TURN_MAX_TRIES + 1,
    ),
    comment: buildEmptyTurnHandBackComment(input.agentName ?? null),
  };
  if (planEmptyTurnOutcome(input) === "retry") {
    return {
      kind: "retry",
      description: descriptionWithEmptyTurnTries(descriptionWithWaitingMarker(base, false), tries + 1),
      instruction: buildEmptyTurnRetryInstruction(),
      comment: buildEmptyTurnRetryComment(),
      fallback: handBack,
    };
  }
  // The retry Todero asked for came back just as empty. That is the one round
  // the person is told about; a later one is an ordinary hand-back.
  if (tries !== EMPTY_TURN_MAX_TRIES) return null;
  if (input.issue.status !== "in_progress" || !input.issue.parentId) return null;
  if (input.disposition !== "waiting") return null;
  if (asksThePersonForAnything(input.reply) || turnDeliversWork(input.reply)) return null;
  return { kind: "hand-back", ...handBack };
}

/** What Todero tells the worker when its turn produced nothing. */
export function buildEmptyTurnRetryInstruction(): string {
  return [
    "Your last message did not contain the work this task was asked for, and it did not ask the person anything either, so there is nothing to show them and nothing for them to answer.",
    "",
    "Write the work itself in this reply — the guide, the list, the document, whatever this task was asked to hand in — in full.",
    "",
    "What this message must hold is the thing itself — not a summary of the task, not the goal or the done-when line read back, and not a list of next steps or of what still has to happen.",
    "",
    "Then end your message with `STATUS: done`.",
  ].join("\n");
}

/** The one line the person sees when Todero decides to ask again. */
export function buildEmptyTurnRetryComment(): string {
  return [
    "That last turn did not produce any work, and it did not ask you anything either, so there is nothing here for you to look at yet.",
    "",
    "Todero is asking it once more for the work itself. Nothing is needed from you.",
  ].join("\n");
}

/** The one thing the person reads when it happened twice. */
export function buildEmptyTurnHandBackComment(agentName: string | null): string {
  const who = agentName?.trim() || "This agent";
  return [
    `${who} has now had two turns on this task and produced no work twice — no guide, no list, nothing handed in — and asked you nothing either time. Todero has stopped asking.`,
    "",
    "Tell it in your own words what you want handed in here, or do this one yourself and mark it accepted. If it still cannot get going, stop this one and start again with a stronger model.",
  ].join("\n");
}

export type EmptyTurnRecoveryDeps = {
  updateIssue: (issueId: string, patch: { status?: string; description?: string }) => Promise<unknown>;
  /** Posted as Todero's own words, never as a turn of the conversation. */
  addComment: (issueId: string, body: string, presentation: IssueCommentPresentation) => Promise<unknown>;
  /** Bring the worker back for the corrective turn. */
  wakeAgent: (input: { issueId: string; agentId: string }) => Promise<unknown>;
  log: (message: string) => unknown;
};

/**
 * The decision above, carried out.
 *
 * The retry leaves the task at `todo` rather than `in_progress`: the run that
 * wrote the empty reply has already been stamped finished, and a task left
 * running with no turn behind it is read by the recovery sweep as a turn that
 * stopped halfway, which starts a second turn of its own. `todo` plus a wake
 * is the same route the plan rescue next door already takes, and the point
 * holds either way — the task is not in front of the person.
 */
export async function applyEmptyTurnRecovery(
  deps: EmptyTurnRecoveryDeps,
  input: { issueId: string; agentId: string; recovery: EmptyTurnRecovery },
): Promise<EmptyTurnRecovery["kind"]> {
  const { recovery } = input;
  if (recovery.kind === "retry") {
    await deps.updateIssue(input.issueId, { status: "todo", description: recovery.description });
    await deps.addComment(input.issueId, recovery.comment, SYSTEM_NOTICE_PRESENTATION);
    try {
      await deps.wakeAgent({ issueId: input.issueId, agentId: input.agentId });
    } catch (err) {
      // The task is sitting in todo with nobody on the way to it. Put it in
      // front of the person rather than leave it there.
      deps.log(
        `[todero] It could not be started again to write the work: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      await deps.updateIssue(input.issueId, { status: "blocked", description: recovery.fallback.description });
      await deps.addComment(input.issueId, recovery.fallback.comment, SYSTEM_NOTICE_PRESENTATION);
      return "hand-back";
    }
    deps.log("[todero] The turn produced no work and asked nothing; asking it once more.\n");
    return "retry";
  }
  await deps.updateIssue(input.issueId, { status: "blocked", description: recovery.description });
  await deps.addComment(input.issueId, recovery.comment, SYSTEM_NOTICE_PRESENTATION);
  deps.log("[todero] Two turns in a row produced no work; the task is over to the person.\n");
  return "hand-back";
}
