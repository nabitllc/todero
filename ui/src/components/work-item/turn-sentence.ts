import { APOSTROPHE, type WorkItemBlockedBy, type WorkItemStatus } from "./work-item-model";

/**
 * The turn sentence is the one line under the title that says what is happening
 * and whose turn it is. It is computed from state the card already has — status,
 * the three markers, blockers, child tasks, a live run — and never from a fresh
 * call.
 *
 * It is deliberately a different sentence from the status chip beside the title.
 * The chip says what state the task is in, in the six words of the status
 * vocabulary. The bar says who acts next and what they can do about it. Between
 * them they must not say the same thing twice: when the bar names the blocker
 * ("Queued behind ZZW-3"), the chip says only "Queued".
 */

/** How long an agent's busy timer waits before it picks up open work. */
export const DEFAULT_TIMER_INTERVAL_SEC = 120;

/** What the sentence calls the assignee when the card has no name for it. */
export const UNNAMED_AGENT = "The agent";

export type TurnActionId = "approve" | "accept" | "send-back" | "answer" | "start-now" | "play";

export type TurnTone = "action" | "waiting" | "info" | "done";

export type TurnAction = {
  id: TurnActionId;
  label: string;
};

export type TurnSentenceResult = {
  text: string;
  actions: TurnAction[];
  tone: TurnTone;
};

export type TurnSentenceView = {
  status: WorkItemStatus;
  /** The first task blocking this one, if any. */
  blockedBy: WorkItemBlockedBy | null;
  /** How many tasks block this one; past one the sentence says "and N more". */
  blockerCount?: number;
  /** The first still-open child task, for a parent waiting on its own plan. */
  openChildIdentifier?: string | null;
  /** How many child tasks are still open. */
  openChildCount?: number;
  /** The agent handed in its output and is waiting to be accepted or sent back. */
  reviewPending?: boolean;
  /** The agent proposed a plan and is waiting for a yes. */
  planPending?: boolean;
  /** How many tasks the proposed plan holds. */
  planTaskCount?: number;
  /** How many of them are still ticked, so the button can say "Approve 4 of 6". */
  planTasksKept?: number;
  /** The agent asked the person something and is waiting for the answer. */
  waitingOnYou?: boolean;
  /** A run is live on this task right now. */
  agentWorking?: boolean;
  /**
   * The work has been handed to the reviewer: the raw status is in review.
   * The status chip still says In progress — the product vocabulary has no
   * seventh state — but the bar says who acts next, and that is the reviewer.
   */
  reviewRunning?: boolean;
  assigneeName: string | null;
  assigneeId: string | null;
  /** The work is held: the assignee is paused, or a pause sits on the tree. */
  paused?: boolean;
  /** Whether this screen can resume it. Without a way to, the bar offers no button. */
  canResume?: boolean;
  /** Whether this screen can start the work by hand. */
  canStartNow?: boolean;
  /** The busy timer that makes an agent pick up open work by itself. */
  timerEnabled?: boolean;
  timerIntervalSec?: number;
};

/** "Nova", or "The agent" when the card has no name — never an invented one. */
function leadName(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : UNNAMED_AGENT;
}

/** The same name in the middle of a sentence: "answer Nova", "answer the agent". */
function midName(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : UNNAMED_AGENT.toLowerCase();
}

/** "2 minutes", "1 minute". Anything under a minute still reads as one minute. */
export function timerIntervalText(intervalSec: number | undefined): string {
  const seconds =
    typeof intervalSec === "number" && Number.isFinite(intervalSec) && intervalSec > 0
      ? intervalSec
      : DEFAULT_TIMER_INTERVAL_SEC;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * The label on the approve button, in the turn bar and on the plan card. One
 * function so the two can never disagree about the count.
 */
export function planApproveLabel(kept: number, total: number): string {
  if (total <= 0) return "Approve";
  return `Approve ${Math.max(0, Math.min(kept, total))} of ${total}`;
}

/** "ZZW-3 and 2 more", or just "ZZW-3" when it is the only one. */
function withOthers(identifier: string, count: number): string {
  return count > 1 ? `${identifier} and ${count - 1} more` : identifier;
}

/**
 * Whether the reviewer is the one holding the work.
 *
 * It is true only when the work has been handed over *and* the person owes
 * nothing: a hand-in to accept, a plan to approve or a question to answer is
 * the person's turn whatever the raw status says.
 *
 * Exported because the board's `columnFor` reads it too. One function is what
 * makes the card and the task page agree by construction rather than by
 * coincidence: whenever the board stands a card in Review, the bar on that
 * task says the reviewer has it, and never "the agent is working on it".
 */
export function reviewerHasIt(view: TurnSentenceView): boolean {
  if (!view.reviewRunning) return false;
  if (view.reviewPending || view.planPending || view.waitingOnYou) return false;
  if (view.blockedBy?.kind === "waiting-on-you") return false;
  return true;
}

/**
 * What the bar says, and which buttons it carries.
 *
 * Precedence, highest first:
 *  1. Done and Cancelled — the task is over, nothing else matters.
 *  2. Paused — nothing moves until it resumes, whatever else is pending.
 *  3. The reviewer has it — a live turn on handed-over work is the reviewer's.
 *  4. The agent is writing right now.
 *  5. The person owes an answer: a hand-in to accept, a plan to approve, a
 *     question to answer.
 *  6. The task is waiting on another task, or on its own children.
 *  7. Nobody owes anything: say when the agent will pick it up.
 */
export function turnSentence(view: TurnSentenceView): TurnSentenceResult {
  if (view.status === "done") {
    return { text: "Done", actions: [], tone: "done" };
  }
  if (view.status === "cancelled") {
    return { text: "Cancelled", actions: [], tone: "done" };
  }

  // A pause stops the agents, not the person: a hand-in to accept, a plan to
  // approve or a question to answer is still the person's move while the
  // organization is paused, and the buttons still work.
  const personsTurn =
    Boolean(view.reviewPending) || Boolean(view.planPending) || Boolean(view.waitingOnYou) ||
    view.blockedBy?.kind === "waiting-on-you";

  if (view.paused && !personsTurn) {
    return {
      text: "Paused",
      actions: view.canResume ? [{ id: "play", label: "Play" }] : [],
      tone: "info",
    };
  }

  // Handed over and nothing owed back: whoever is running on it now is
  // checking it, not writing it. Said before the live-turn line so the two
  // screens cannot describe the same turn two different ways.
  if (reviewerHasIt(view)) {
    return { text: "With the reviewer", actions: [], tone: "waiting" };
  }

  if (view.agentWorking) {
    return { text: `${leadName(view.assigneeName)} is writing`, actions: [], tone: "waiting" };
  }

  if (view.reviewPending) {
    return {
      text: "Your turn: accept or send back",
      actions: [
        { id: "accept", label: "Accept" },
        { id: "send-back", label: "Send back" },
      ],
      tone: "action",
    };
  }

  if (view.planPending) {
    const total = view.planTaskCount ?? 0;
    const kept = view.planTasksKept ?? total;
    return {
      text: "Your turn: approve the plan",
      actions: [
        { id: "approve", label: planApproveLabel(kept, total) },
        { id: "send-back", label: "Ask for changes" },
      ],
      tone: "action",
    };
  }

  // The waiting-on-you marker is the same thing the blocker resolver reports
  // when nothing else blocks the task, so it is answered here rather than
  // treated as a queue below.
  if (view.waitingOnYou || view.blockedBy?.kind === "waiting-on-you") {
    return {
      text: `Your turn: answer ${midName(view.assigneeName)}`,
      actions: [{ id: "answer", label: "Answer" }],
      tone: "action",
    };
  }

  if (view.blockedBy?.kind === "item") {
    const behind = withOthers(view.blockedBy.identifier, view.blockerCount ?? 1);
    // Only promise a pickup when something is actually set to do the picking.
    const thenPicksUp =
      view.timerEnabled !== false && view.assigneeId
        ? `, then ${midName(view.assigneeName)} picks it up`
        : "";
    return { text: `Queued behind ${behind}${thenPicksUp}`, actions: [], tone: "waiting" };
  }

  const openChildren = view.openChildCount ?? 0;
  if (openChildren > 0) {
    const identifier = view.openChildIdentifier?.trim();
    const text = identifier
      ? `Waiting on ${withOthers(identifier, openChildren)}`
      : openChildren === 1
        ? "Waiting on 1 open task"
        : `Waiting on ${openChildren} open tasks`;
    return { text, actions: [], tone: "waiting" };
  }

  if (view.status === "todo") {
    if (!view.assigneeId) {
      return { text: "Nobody is assigned yet", actions: [], tone: "info" };
    }
    if (view.timerEnabled === false) {
      const name = leadName(view.assigneeName);
      if (view.canStartNow) {
        return {
          text: `${name}${APOSTROPHE}s timer is off; start now?`,
          actions: [{ id: "start-now", label: "Start now" }],
          tone: "action",
        };
      }
      return {
        text: `${name}${APOSTROPHE}s timer is off; nothing will pick this up on its own`,
        actions: [],
        tone: "info",
      };
    }
    return {
      text: `${leadName(view.assigneeName)} picks this up within ${timerIntervalText(view.timerIntervalSec)}`,
      actions: [],
      tone: "waiting",
    };
  }

  if (view.status === "in_progress") {
    return { text: `${leadName(view.assigneeName)} is working on it`, actions: [], tone: "waiting" };
  }

  if (view.status === "blocked") {
    return { text: "Blocked", actions: [], tone: "info" };
  }

  // New, and nothing else to say about it.
  return { text: "Nobody is assigned yet", actions: [], tone: "info" };
}
