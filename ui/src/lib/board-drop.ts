import { BOARD_COLUMN_LABELS, type BoardColumn } from "./board-model";

export type { BoardColumn };

/**
 * What a drop does. Every action is a state the task could already reach by a
 * button on the task page — the board never invents a transition.
 */
export type DropAction = {
  action: "accept" | "start-now" | "park" | "reorder";
  taskId: string;
  /** The sentence the person confirms before anything happens. */
  confirm?: string;
};

export type DropRefusal = { refused: string };

export type DropResult = DropAction | DropRefusal;

export function isRefusal(result: DropResult): result is DropRefusal {
  return "refused" in result;
}

/** The least of a task a drop rule needs to decide. */
export interface DropTask {
  id: string;
  identifier: string;
  assigneeAgentId?: string | null;
  /** What the assignee is called, for a refusal that names who to press Play on. */
  assigneeName?: string | null;
  /** The assignee is paused: it drops every wake until somebody presses Play. */
  assigneePaused?: boolean;
  /** The whole organization is paused: nothing new starts at all. */
  organizationPaused?: boolean;
  /** The first task this one waits behind, if any. */
  blockedByIdentifier?: string | null;
  /** How many of its own child tasks are still open. */
  openChildCount?: number;
  /** How many of its own child tasks it has at all. */
  childCount?: number;
}

/**
 * Whether a drop is allowed, and what it does.
 *
 *  - Your turn → Done: accept the work, and the chain continues.
 *  - Queued → Agent working: start it now, ahead of what it waits behind.
 *  - Agent working → Queued: park it and wait for the person.
 *  - anything → Your turn: refused; only the agent can hand work in.
 *  - within a column: reorder, which the busy timer respects.
 *
 * A drop that would skip the task's own plan is refused: a parent cannot start
 * ahead of the tasks it is waiting on, because those tasks are its plan.
 */
export function dropFor(args: {
  task: DropTask;
  from: BoardColumn;
  to: BoardColumn;
}): DropResult {
  const { task, from, to } = args;

  // Landing where it started changes nothing. The order inside a column is the
  // task's priority, which the board does not write yet, so this is deliberately
  // a no-op rather than a silent half-move: dropping a card back on its own
  // column asks for nothing and saves nothing.
  if (from === to) {
    return { action: "reorder", taskId: task.id };
  }

  if (to === "your-turn") {
    return { refused: "Only the agent can hand work in." };
  }

  if (to === "review") {
    return { refused: "The reviewer picks work up on its own." };
  }

  if (to === "done") {
    if (from !== "your-turn") {
      return { refused: "Accept the work first; only work that is yours to accept can be finished here." };
    }
    return {
      action: "accept",
      taskId: task.id,
      confirm: `Accept ${task.identifier} and let the rest of the plan continue?`,
    };
  }

  if (to === "working") {
    if (from !== "queued") {
      return { refused: `${BOARD_COLUMN_LABELS[from]} work is already moving.` };
    }
    if ((task.openChildCount ?? 0) > 0) {
      return { refused: `${task.identifier} is waiting on its own plan; finish that first.` };
    }
    if (!task.assigneeAgentId) {
      return { refused: `Nobody is assigned to ${task.identifier} yet.` };
    }
    // A pause swallows the start silently — the agent simply never picks the
    // task up — so the board says no here rather than reporting a start that
    // never happens. Play is the button that undoes each pause.
    if (task.organizationPaused) {
      return { refused: "The organization is paused. Press Play on it, then this can start." };
    }
    if (task.assigneePaused) {
      const who = task.assigneeName?.trim();
      return {
        refused: who
          ? `${who} is paused. Press Play on ${who} first.`
          : "The agent is paused. Press Play on the agent first.",
      };
    }
    const ahead = task.blockedByIdentifier?.trim();
    return {
      action: "start-now",
      taskId: task.id,
      confirm: ahead ? `Start now, ahead of ${ahead}?` : `Start ${task.identifier} now?`,
    };
  }

  if (to === "queued") {
    if (from !== "working") {
      return { refused: `${BOARD_COLUMN_LABELS[from]} work cannot be put back in the queue.` };
    }
    return {
      action: "park",
      taskId: task.id,
      confirm: `Park ${task.identifier} and wait for you?`,
    };
  }

  return { refused: `${task.identifier} cannot move there.` };
}

/** A button on the card: the step it moves the task to, and what it is called. */
export type BoardCardAction = { label: string; to: BoardColumn };

/**
 * What a card offers when there is no dragging — on a phone, where touch does
 * not drag. Each button is the drop it replaces, so it goes through `dropFor`
 * and gets the same confirmation and the same refusals; the board has no
 * second set of rules for touch.
 */
export function cardActionsFor(column: BoardColumn): BoardCardAction[] {
  if (column === "your-turn") return [{ label: "Accept", to: "done" }];
  if (column === "queued") return [{ label: "Start now", to: "working" }];
  if (column === "working") return [{ label: "Park", to: "queued" }];
  return [];
}
