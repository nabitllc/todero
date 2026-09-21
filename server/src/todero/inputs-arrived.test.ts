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

    it("leaves a hand-in alone however it words the handing over", () => {
      // None of these four appear in the 101 archived turns, so this is risk
      // rather than measured loss — but each one is a turn that delivers or
      // asks about scope, and each one was read as a request for missing work.
      expect(
        turnAsksForMissingWork("I cannot review my own work, so I am handing it to you."),
      ).toBe(false);
      expect(
        turnAsksForMissingWork("I cannot start the second phase; the first is finished and attached."),
      ).toBe(false);
      expect(
        turnAsksForMissingWork("I need it clarified whether the guides are one page each."),
      ).toBe(false);
      expect(
        turnAsksForMissingWork(
          "I finished the guides. I am waiting for the photographer to send the images.",
        ),
      ).toBe(false);
    });

    it("reads a turn that claims work done and still asks for the work as asking", () => {
      // A 14B model that prefaces its repeated request with a claim of work
      // done was keeping that turn in the thread, which is the loop this
      // exists to close. The ask wins over the claim.
      expect(
        turnAsksForMissingWork("I have drafted all four. Could you please provide the four draft guides?"),
      ).toBe(true);
      expect(
        turnAsksForMissingWork("Could you please provide the four draft guides?"),
      ).toBe(true);
      // And a hand-in with nothing asked anywhere in it is still a hand-in.
      expect(turnAsksForMissingWork(HAND_IN)).toBe(false);
    });

    it("reads the ask as winning even when the claim shares its sentence", () => {
      // The model does not always put a full stop between the two. On a comma,
      // a semicolon or the word "so", the claim used to swallow the ask and the
      // turn stayed in the thread — the same loop, one punctuation mark away.
      expect(
        turnAsksForMissingWork("I finished the outline, but I still need the four draft guides."),
      ).toBe(true);
      expect(
        turnAsksForMissingWork(
          "I have drafted all four, so could you please provide the four draft guides?",
        ),
      ).toBe(true);
      expect(turnAsksForMissingWork("Could you please provide the attached drafts?")).toBe(true);
      expect(
        turnAsksForMissingWork(
          "I have attached the outline; please provide the four draft guides.",
        ),
      ).toBe(true);
      expect(
        turnAsksForMissingWork("Here is my summary, but I am still waiting for the four draft guides."),
      ).toBe(true);
      expect(turnAsksForMissingWork("I completed the review and I still need the drafts.")).toBe(true);
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
});

// The two replies below are the real ones from wave 19, organization
// f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3. Both were treated as the agent handing
// the turn back to the person, and both ask the person for nothing at all.
const PARROTED_BRIEF = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
  "- **What the person said:** Must have: the four one-page guides, each naming the plant, the light it needs, and how often to water it. Everything else can wait. Done means all four read well. Keep the plan to at most four tasks. Propose the plan now.",
  "- **Last verdict:** The review said the second guide draft must include information for three additional houseplants. Check it before you start.",
].join("\n");

const NEXT_STEPS_LIST = [
  "**Final Review and Next Steps:**",
  "",
  "- **Review Status:** The first guide for the Snake Plant (Sansevieria) has been finalized and formatted. It meets the criteria of being one page and ready for distribution.",
  "- **Next Steps:** We need to finalize and format the remaining three guides for the other three houseplants. Once all four guides are complete, the task will be fully done.",
  "",
  "**Action Required:**",
  "",
  "1. Proceed with finalizing and formatting the guides for the remaining three houseplants.",
  "2. Ensure each guide includes the plant name, light needs, watering frequency, and additional care instructions.",
  "3. Hand in the first finalized guide as specified in the task.",
].join("\n");

describe("asksThePersonForAnything", () => {
  it("says no to the two wave-19 turns that left the person nothing to answer", () => {
    expect(asksThePersonForAnything(PARROTED_BRIEF)).toBe(false);
    expect(asksThePersonForAnything(NEXT_STEPS_LIST)).toBe(false);
  });

  it("says yes to a question", () => {
    expect(asksThePersonForAnything("Should the guides include repotting notes?")).toBe(true);
  });

  it("says yes to a request, however it is put", () => {
    expect(asksThePersonForAnything("Please send me the plant list.")).toBe(true);
    expect(asksThePersonForAnything("Could you confirm the four plants.")).toBe(true);
    expect(asksThePersonForAnything("Let me know which four plants to cover.")).toBe(true);
    expect(asksThePersonForAnything("I still need the four draft guides.")).toBe(true);
    expect(asksThePersonForAnything("I am waiting for the four draft guides.")).toBe(true);
  });

  it("says yes when it says it cannot go on", () => {
    expect(asksThePersonForAnything("I cannot proceed without the plant list.")).toBe(true);
  });

  it("does not hear a plan for itself as a request to the person", () => {
    expect(asksThePersonForAnything("We need to finalize the remaining three guides.")).toBe(false);
    expect(asksThePersonForAnything("")).toBe(false);
  });
});
