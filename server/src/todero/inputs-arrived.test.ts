// What a turn is told, and what it is allowed to remember, once the work it
// was waiting for has arrived.
//
// Wave 3 of the improvement loop. Wave 2 (PR #118) started handing a task the
// finished work of the tasks before it. Wave 16 and its recovery are the case
// this closes: ZZGAAA-5 spent forty-one of its forty-two turns asking for the
// four drafts — "Could you please provide the four draft guides", then "I am
// still waiting for the four draft guides" — with the drafts in hand. Its own
// thread carried a dozen earlier turns saying exactly that, and a small local
// model copies what it sees itself having said.
//
// Wave 18's twenty-one repeats on ZZGAAAAA-3 are NOT this case: that task
// repeated a clarifying question, and none of those turns asks for missing
// work. A repeated question is a different fault, fixed somewhere else.
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

    it("never reads a turn that hands work in as asking, whatever else it says", () => {
      // A task sent back by the reviewer wakes with the earlier work in hand.
      // If its own hand-in were dropped it would write that work again, which
      // is the waste this whole thing exists to stop.
      expect(turnAsksForMissingWork("Handing this in. I will wait for your review.")).toBe(false);
      expect(
        turnAsksForMissingWork(
          "I cannot complete the fourth guide without the plant list. Here are the three I have.",
        ),
      ).toBe(false);
      expect(
        turnAsksForMissingWork(
          "Here is the finished guide. I wrote it without the photos, which were not needed.",
        ),
      ).toBe(false);
    });

    it("leaves a question about some other detail alone", () => {
      expect(turnAsksForMissingWork("Can you provide the brand colours for the guides?")).toBe(false);
      expect(turnAsksForMissingWork("I need the brand colours before I publish.")).toBe(false);
    });

    it("reads the real loop, word for word, as asking", () => {
      // The turns wave 16 and its recovery repeated forty-one times on ZZGAAA-5.
      expect(
        turnAsksForMissingWork("Could you please provide the four draft guides for me to review and edit?"),
      ).toBe(true);
      expect(
        turnAsksForMissingWork(
          "I am still waiting for the four draft guides to proceed with the review and editing.",
        ),
      ).toBe(true);
      expect(
        turnAsksForMissingWork("I need the four draft guides to begin the review and editing process."),
      ).toBe(true);
      expect(
        turnAsksForMissingWork("I cannot complete the task without the four draft guides to review and edit."),
      ).toBe(true);
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
