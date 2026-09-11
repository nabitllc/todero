import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMER_INTERVAL_SEC,
  planApproveLabel,
  timerIntervalText,
  turnSentence,
  type TurnSentenceView,
} from "./turn-sentence";
import { WORK_ITEM_STATUS_LABELS } from "./work-item-model";

function view(overrides: Partial<TurnSentenceView> = {}): TurnSentenceView {
  return {
    status: "todo",
    blockedBy: null,
    assigneeName: "Nova",
    assigneeId: "agent-1",
    ...overrides,
  };
}

describe("timerIntervalText", () => {
  it("says two minutes for the default interval", () => {
    expect(timerIntervalText(DEFAULT_TIMER_INTERVAL_SEC)).toBe("2 minutes");
  });

  it("says one minute in the singular", () => {
    expect(timerIntervalText(60)).toBe("1 minute");
  });

  it("rounds part of a minute up to one minute", () => {
    expect(timerIntervalText(30)).toBe("1 minute");
  });

  it("rounds a part-minute interval up", () => {
    expect(timerIntervalText(90)).toBe("2 minutes");
  });

  it("handles a long interval", () => {
    expect(timerIntervalText(300)).toBe("5 minutes");
  });

  it("falls back to the default when the interval is missing", () => {
    expect(timerIntervalText(undefined)).toBe("2 minutes");
  });

  it("falls back to the default when the interval is zero or negative", () => {
    expect(timerIntervalText(0)).toBe("2 minutes");
    expect(timerIntervalText(-30)).toBe("2 minutes");
  });

  it("falls back to the default when the interval is not a number", () => {
    expect(timerIntervalText(Number.NaN)).toBe("2 minutes");
    expect(timerIntervalText(Number.POSITIVE_INFINITY)).toBe("2 minutes");
  });
});

describe("planApproveLabel", () => {
  it("counts the ticked tasks against the total", () => {
    expect(planApproveLabel(4, 6)).toBe("Approve 4 of 6");
  });

  it("says Approve alone when the plan has no tasks", () => {
    expect(planApproveLabel(0, 0)).toBe("Approve");
  });

  it("does not go below zero", () => {
    expect(planApproveLabel(-2, 3)).toBe("Approve 0 of 3");
  });

  it("does not go above the total", () => {
    expect(planApproveLabel(9, 3)).toBe("Approve 3 of 3");
  });
});

describe("turnSentence — terminal states", () => {
  it("says Done and offers nothing", () => {
    const result = turnSentence(view({ status: "done" }));
    expect(result).toEqual({ text: "Done", actions: [], tone: "done" });
  });

  it("says Cancelled and offers nothing", () => {
    const result = turnSentence(view({ status: "cancelled" }));
    expect(result).toEqual({ text: "Cancelled", actions: [], tone: "done" });
  });

  it("uses the same words as the status chip", () => {
    expect(turnSentence(view({ status: "done" })).text).toBe(WORK_ITEM_STATUS_LABELS.done);
    expect(turnSentence(view({ status: "cancelled" })).text).toBe(WORK_ITEM_STATUS_LABELS.cancelled);
  });

  it("stays Done even when a review, a plan and a pause are all pending", () => {
    const result = turnSentence(
      view({ status: "done", reviewPending: true, planPending: true, paused: true }),
    );
    expect(result.text).toBe("Done");
  });
});

describe("turnSentence — paused", () => {
  it("offers Play when this screen can resume", () => {
    const result = turnSentence(view({ paused: true, canResume: true }));
    expect(result.text).toBe("Paused");
    expect(result.actions).toEqual([{ id: "play", label: "Play" }]);
    expect(result.tone).toBe("info");
  });

  it("says Paused without a button when this screen cannot resume", () => {
    const result = turnSentence(view({ paused: true }));
    expect(result.text).toBe("Paused");
    expect(result.actions).toEqual([]);
  });

  it("beats a live run and a pending review", () => {
    const result = turnSentence(view({ paused: true, agentWorking: true, reviewPending: true }));
    expect(result.text).toBe("Paused");
  });
});

describe("turnSentence — the agent is writing", () => {
  it("names the assignee", () => {
    const result = turnSentence(view({ status: "in_progress", agentWorking: true }));
    expect(result).toEqual({ text: "Nova is writing", actions: [], tone: "waiting" });
  });

  it("does not invent a name when the card has none", () => {
    const result = turnSentence(view({ agentWorking: true, assigneeName: null }));
    expect(result.text).toBe("The agent is writing");
  });

  it("beats a pending review", () => {
    expect(turnSentence(view({ agentWorking: true, reviewPending: true })).text).toBe(
      "Nova is writing",
    );
  });
});

describe("turnSentence — the person owes an answer", () => {
  it("offers accept and send back on a hand-in", () => {
    const result = turnSentence(view({ reviewPending: true }));
    expect(result.text).toBe("Your turn: accept or send back");
    expect(result.actions).toEqual([
      { id: "accept", label: "Accept" },
      { id: "send-back", label: "Send back" },
    ]);
    expect(result.tone).toBe("action");
  });

  it("beats a pending plan", () => {
    expect(turnSentence(view({ reviewPending: true, planPending: true })).text).toBe(
      "Your turn: accept or send back",
    );
  });

  it("counts the plan tasks on the approve button", () => {
    const result = turnSentence(view({ planPending: true, planTaskCount: 6, planTasksKept: 4 }));
    expect(result.text).toBe("Your turn: approve the plan");
    expect(result.actions).toEqual([
      { id: "approve", label: "Approve 4 of 6" },
      { id: "send-back", label: "Ask for changes" },
    ]);
  });

  it("keeps every plan task when none has been unticked", () => {
    const result = turnSentence(view({ planPending: true, planTaskCount: 3 }));
    expect(result.actions[0]).toEqual({ id: "approve", label: "Approve 3 of 3" });
  });

  it("says Approve alone when the plan count is unknown", () => {
    const result = turnSentence(view({ planPending: true }));
    expect(result.actions[0]).toEqual({ id: "approve", label: "Approve" });
  });

  it("beats a waiting-on-you marker", () => {
    expect(turnSentence(view({ planPending: true, waitingOnYou: true })).text).toBe(
      "Your turn: approve the plan",
    );
  });

  it("asks the person to answer the named agent", () => {
    const result = turnSentence(view({ waitingOnYou: true }));
    expect(result.text).toBe("Your turn: answer Nova");
    expect(result.actions).toEqual([{ id: "answer", label: "Answer" }]);
    expect(result.tone).toBe("action");
  });

  it("answers the blocker resolver's waiting-on-you marker too", () => {
    const result = turnSentence(
      view({ status: "blocked", blockedBy: { kind: "waiting-on-you" } }),
    );
    expect(result.text).toBe("Your turn: answer Nova");
  });

  it("does not invent a name in the middle of the sentence", () => {
    expect(turnSentence(view({ waitingOnYou: true, assigneeName: null })).text).toBe(
      "Your turn: answer the agent",
    );
  });

  it("beats a task blocker", () => {
    const result = turnSentence(
      view({ waitingOnYou: true, blockedBy: { kind: "item", id: "b1", identifier: "ZZW-3" } }),
    );
    expect(result.text).toBe("Your turn: answer Nova");
  });
});

describe("turnSentence — queued behind another task", () => {
  const blocker = { kind: "item", id: "b1", identifier: "ZZW-3" } as const;

  it("names the blocker and promises a pickup", () => {
    const result = turnSentence(view({ status: "blocked", blockedBy: blocker }));
    expect(result.text).toBe("Queued behind ZZW-3, then Nova picks it up");
    expect(result.actions).toEqual([]);
    expect(result.tone).toBe("waiting");
  });

  it("counts the other blockers", () => {
    const result = turnSentence(view({ status: "blocked", blockedBy: blocker, blockerCount: 3 }));
    expect(result.text).toBe("Queued behind ZZW-3 and 2 more, then Nova picks it up");
  });

  it("does not promise a pickup when the timer is off", () => {
    const result = turnSentence(
      view({ status: "blocked", blockedBy: blocker, timerEnabled: false }),
    );
    expect(result.text).toBe("Queued behind ZZW-3");
  });

  it("does not promise a pickup when nobody is assigned", () => {
    const result = turnSentence(
      view({ status: "blocked", blockedBy: blocker, assigneeId: null, assigneeName: null }),
    );
    expect(result.text).toBe("Queued behind ZZW-3");
  });

  it("beats open child tasks", () => {
    const result = turnSentence(
      view({ blockedBy: blocker, openChildIdentifier: "ZZW-9", openChildCount: 2 }),
    );
    expect(result.text).toBe("Queued behind ZZW-3, then Nova picks it up");
  });
});

describe("turnSentence — waiting on its own children", () => {
  it("names the first open child and counts the rest", () => {
    const result = turnSentence(view({ openChildIdentifier: "ZZW-3", openChildCount: 3 }));
    expect(result).toEqual({ text: "Waiting on ZZW-3 and 2 more", actions: [], tone: "waiting" });
  });

  it("names a single open child on its own", () => {
    expect(turnSentence(view({ openChildIdentifier: "ZZW-3", openChildCount: 1 })).text).toBe(
      "Waiting on ZZW-3",
    );
  });

  it("counts in the singular when it has no identifier", () => {
    expect(turnSentence(view({ openChildCount: 1 })).text).toBe("Waiting on 1 open task");
  });

  it("counts in the plural when it has no identifier", () => {
    expect(turnSentence(view({ openChildCount: 4 })).text).toBe("Waiting on 4 open tasks");
  });

  it("ignores a blank identifier", () => {
    expect(turnSentence(view({ openChildIdentifier: "   ", openChildCount: 2 })).text).toBe(
      "Waiting on 2 open tasks",
    );
  });
});

describe("turnSentence — nobody owes anything", () => {
  it("says when the agent picks a To do task up", () => {
    const result = turnSentence(view({ status: "todo" }));
    expect(result).toEqual({
      text: "Nova picks this up within 2 minutes",
      actions: [],
      tone: "waiting",
    });
  });

  it("uses the interval it is given", () => {
    expect(turnSentence(view({ status: "todo", timerIntervalSec: 600 })).text).toBe(
      "Nova picks this up within 10 minutes",
    );
  });

  it("offers Start now when the timer is off and this screen can start it", () => {
    const result = turnSentence(view({ status: "todo", timerEnabled: false, canStartNow: true }));
    expect(result.text).toBe("Nova’s timer is off; start now?");
    expect(result.actions).toEqual([{ id: "start-now", label: "Start now" }]);
    expect(result.tone).toBe("action");
  });

  it("says plainly that nothing will pick it up when it cannot offer a button", () => {
    const result = turnSentence(view({ status: "todo", timerEnabled: false }));
    expect(result.text).toBe("Nova’s timer is off; nothing will pick this up on its own");
    expect(result.actions).toEqual([]);
    expect(result.tone).toBe("info");
  });

  it("says nobody is assigned on an unassigned To do task", () => {
    const result = turnSentence(view({ status: "todo", assigneeId: null, assigneeName: null }));
    expect(result).toEqual({ text: "Nobody is assigned yet", actions: [], tone: "info" });
  });

  it("says the agent is working on an In progress task with no live run", () => {
    expect(turnSentence(view({ status: "in_progress" })).text).toBe("Nova is working on it");
  });

  it("does not invent a name on an In progress task", () => {
    expect(turnSentence(view({ status: "in_progress", assigneeName: null })).text).toBe(
      "The agent is working on it",
    );
  });

  it("says Blocked when nothing names the blocker", () => {
    const result = turnSentence(view({ status: "blocked" }));
    expect(result).toEqual({ text: "Blocked", actions: [], tone: "info" });
    expect(result.text).toBe(WORK_ITEM_STATUS_LABELS.blocked);
  });

  it("says nobody is assigned on a New task", () => {
    const result = turnSentence(view({ status: "new", assigneeId: null, assigneeName: null }));
    expect(result).toEqual({ text: "Nobody is assigned yet", actions: [], tone: "info" });
  });
});

describe("turnSentence — the words it is not allowed to use", () => {
  const forbidden = /\b(issue|disposition|handoff|run|wake|heartbeat)\b/i;

  const everyState: TurnSentenceView[] = [
    view({ status: "done" }),
    view({ status: "cancelled" }),
    view({ paused: true, canResume: true }),
    view({ paused: true }),
    view({ agentWorking: true }),
    view({ agentWorking: true, assigneeName: null }),
    view({ reviewPending: true }),
    view({ planPending: true, planTaskCount: 6, planTasksKept: 4 }),
    view({ waitingOnYou: true }),
    view({ waitingOnYou: true, assigneeName: null }),
    view({ status: "blocked", blockedBy: { kind: "item", id: "b", identifier: "ZZW-3" } }),
    view({ openChildIdentifier: "ZZW-3", openChildCount: 3 }),
    view({ openChildCount: 2 }),
    view({ status: "todo" }),
    view({ status: "todo", timerEnabled: false, canStartNow: true }),
    view({ status: "todo", timerEnabled: false }),
    view({ status: "todo", assigneeId: null, assigneeName: null }),
    view({ status: "in_progress" }),
    view({ status: "blocked" }),
    view({ status: "new", assigneeId: null, assigneeName: null }),
  ];

  it("never says issue, disposition, handed off, run, wake or heartbeat", () => {
    for (const state of everyState) {
      const result = turnSentence(state);
      expect(result.text).not.toMatch(forbidden);
      for (const action of result.actions) {
        expect(action.label).not.toMatch(forbidden);
      }
    }
  });

  it("never labels the agent AI", () => {
    for (const state of everyState) {
      expect(turnSentence(state).text).not.toMatch(/\bAI\b/);
    }
  });
});
