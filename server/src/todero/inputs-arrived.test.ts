// What a turn is told, and what it is allowed to remember, once the work it
// was waiting for has arrived.
//
// Wave 3 of the improvement loop. Wave 2 (PR #118) started handing a task the
// finished work of the tasks before it. In wave 17 ZZGAAA-5 was handed the four
// drafts and still said "I am still waiting for the four draft guides" thirty
// times; the same happened twenty-one times on ZZGAAAAA-3 in wave 18. Its own
// thread carried thirteen earlier turns saying exactly that, and a small local
// model copies what it sees itself having said.
import { describe, expect, it } from "vitest";
import type { ConversationTurn } from "./conversation-thread.js";
import {
  applyArrivedInputs,
  asksThePersonForAnything,
  buildInputsArrivedTurnInstruction,
  threadWithoutRequestsForArrivedWork,
  turnAsksForMissingWork,
} from "./inputs-arrived.js";

const HAND_IN = [
  "Here are the four guides.",
  "",
  "1. Snake plant — low light, water every three weeks.",
  "2. ZZ plant — low light, water once a month.",
].join("\n");

describe("telling a turn that the work it asked for has arrived", () => {
  describe("which of its own turns asked for the work", () => {
    it("reads a turn that says it is still waiting as asking", () => {
      expect(turnAsksForMissingWork("I am still waiting for the four draft guides.")).toBe(true);
      expect(turnAsksForMissingWork("Waiting on the drafts before I can start.")).toBe(true);
    });

    it("reads a turn that says it cannot go on without them as asking", () => {
      expect(
        turnAsksForMissingWork("I cannot review the guides without the actual content."),
      ).toBe(true);
      expect(turnAsksForMissingWork("Please provide the drafts so I can review them.")).toBe(true);
      expect(turnAsksForMissingWork("I need the drafts before I can continue.")).toBe(true);
    });

    it("leaves a hand-in, a question about scope and a status report alone", () => {
      expect(turnAsksForMissingWork(HAND_IN)).toBe(false);
      expect(turnAsksForMissingWork("What must be in the first version, and what can wait?")).toBe(false);
      expect(turnAsksForMissingWork("Two of the four guides are written; the rest follow today.")).toBe(false);
    });
  });

  describe("the thread the task reads", () => {
    const thread: ConversationTurn[] = [
      { role: "user", body: "Review the four guides when they land." },
      { role: "agent", body: "I am still waiting for the four draft guides." },
      { role: "agent", body: "I cannot review the guides without the actual content." },
      { role: "user", body: "They are coming." },
      { role: "agent", body: "Please provide the drafts so I can review them." },
      { role: "agent", body: HAND_IN },
    ];

    it("drops its own earlier requests for that work once the work is there", () => {
      const filtered = threadWithoutRequestsForArrivedWork(thread, { hasInputs: true });
      expect(filtered.dropped).toBe(3);
      expect(filtered.turns).toEqual([
        { role: "user", body: "Review the four guides when they land." },
        { role: "user", body: "They are coming." },
        { role: "agent", body: HAND_IN },
      ]);
    });

    it("keeps everything when no work arrived", () => {
      const filtered = threadWithoutRequestsForArrivedWork(thread, { hasInputs: false });
      expect(filtered.dropped).toBe(0);
      expect(filtered.turns).toEqual(thread);
    });

    it("never drops what the person or the reviewer said", () => {
      const onlyOthers: ConversationTurn[] = [
        { role: "user", body: "I am still waiting for the four draft guides." },
      ];
      expect(threadWithoutRequestsForArrivedWork(onlyOthers, { hasInputs: true }).dropped).toBe(0);
    });
  });

  describe("what the turn is told", () => {
    it("says in plain words where the work is and not to ask again", () => {
      const said = buildInputsArrivedTurnInstruction();
      expect(said).toContain("Work you build on");
      expect(said.toLowerCase()).toContain("do not ask for it again");
      expect(said).not.toMatch(/todero-|marker|predecessor/i);
    });
  });

  describe("what the turn is handed", () => {
    const inputs = [{ identifier: "ZZF-3", title: "Write initial drafts", body: HAND_IN }];

    it("puts the work on the turn and tells it not to ask again", () => {
      const context: Record<string, unknown> = {
        toderoThread: [
          { role: "agent", body: "I am still waiting for the four draft guides." },
          { role: "user", body: "They are coming." },
        ],
      };
      applyArrivedInputs(context, inputs);
      expect(context.toderoInputs).toEqual(inputs);
      expect(context.toderoThread).toEqual([{ role: "user", body: "They are coming." }]);
      expect(String(context.toderoTurnInstruction)).toContain("Work you build on");
    });

    it("says nothing extra when the task never asked for the work", () => {
      const context: Record<string, unknown> = {
        toderoThread: [{ role: "agent", body: HAND_IN }],
      };
      applyArrivedInputs(context, inputs);
      expect(context.toderoInputs).toEqual(inputs);
      expect(context.toderoTurnInstruction).toBeUndefined();
    });

    it("says it anyway when the work it was handed changed since last time", () => {
      const context: Record<string, unknown> = { toderoThread: [{ role: "agent", body: HAND_IN }] };
      applyArrivedInputs(context, inputs, { inputsChanged: true });
      expect(String(context.toderoTurnInstruction)).toContain("Work you build on");
    });

    it("never talks over the wrap-up or the manager", () => {
      const context: Record<string, unknown> = {
        toderoThread: [{ role: "agent", body: "I am still waiting for the four draft guides." }],
        toderoTurnInstruction: "This turn is the wrap-up. Write the summary.",
      };
      applyArrivedInputs(context, inputs);
      expect(context.toderoTurnInstruction).toBe("This turn is the wrap-up. Write the summary.");
      // The thread is still cleaned: the wrap-up should not read its own
      // unanswered requests back either.
      expect(context.toderoThread).toEqual([]);
    });

    it("takes the work off the turn when there is none", () => {
      const context: Record<string, unknown> = {
        toderoInputs: inputs,
        toderoThread: [{ role: "agent", body: "I am still waiting for the four draft guides." }],
      };
      applyArrivedInputs(context, []);
      expect(context.toderoInputs).toBeUndefined();
      expect(context.toderoThread).toEqual([
        { role: "agent", body: "I am still waiting for the four draft guides." },
      ]);
    });
  });

  describe("a reply that asks the person for nothing", () => {
    // Wave 18, the conversation task ZZGAAAAAAA-1. The lazy human in the
    // improvement-loop check ignores a hand-back that asks nothing, by design:
    // nobody should have to answer a restatement.
    it("is not a question, however politely it ends", () => {
      expect(
        asksThePersonForAnything(
          "Sure, let's move forward with the plan. This plan outlines the necessary steps to create the four one-page guides. Let me know if this plan looks good to you.",
        ),
      ).toBe(false);
    });

    it("still reads a real question as one", () => {
      expect(asksThePersonForAnything("What must be in the first version?")).toBe(true);
      expect(asksThePersonForAnything("Please send me the brand colours.")).toBe(true);
      expect(asksThePersonForAnything("I cannot start without a list of the plants.")).toBe(true);
    });
  });
});
