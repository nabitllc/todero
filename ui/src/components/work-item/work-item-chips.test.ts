import { describe, expect, it } from "vitest";
import { composerChipsFor } from "./work-item-chips";
import type { TurnActionId } from "./turn-sentence";

const labels = (chips: { label: string }[]) => chips.map((chip) => chip.label);

describe("composerChipsFor", () => {
  it("offers nothing once the work is done or called off", () => {
    expect(composerChipsFor({ actions: ["accept"], status: "done", reviewPending: true })).toEqual([]);
    expect(composerChipsFor({ actions: [], status: "cancelled" })).toEqual([]);
  });

  it("offers the everyday three while the work is open", () => {
    expect(labels(composerChipsFor({ actions: [], status: "in_progress" }))).toEqual([
      "Ask a question",
      "Give more context",
      "Skip this task",
    ]);
  });

  it("offers Approve and Send back on a hand-in", () => {
    const chips = composerChipsFor({
      actions: ["accept", "send-back"],
      status: "blocked",
      reviewPending: true,
    });
    expect(labels(chips)).toEqual(["Approve", "Send back with note", "Ask a question"]);
  });

  it("uses the same two words for a plan as for a hand-in", () => {
    const chips = composerChipsFor({
      actions: ["approve", "send-back"],
      status: "todo",
      planPending: true,
    });
    expect(labels(chips)).toEqual(["Approve", "Send back with note", "Ask a question"]);
    expect(chips[0].action).toBe<TurnActionId>("approve");
    expect(chips[1].action).toBe<TurnActionId>("send-back");
  });

  it("never offers a label outside the five the composer knows", () => {
    const known = new Set([
      "Approve",
      "Send back with note",
      "Ask a question",
      "Give more context",
      "Skip this task",
    ]);
    const every = [
      composerChipsFor({ actions: ["accept", "send-back"], status: "blocked", reviewPending: true }),
      composerChipsFor({ actions: ["approve", "send-back"], status: "todo", planPending: true }),
      composerChipsFor({ actions: [], status: "in_progress" }),
    ].flat();
    for (const chip of every) expect(known.has(chip.label)).toBe(true);
  });

  it("never offers a chip the turn bar has no button for", () => {
    const chips = composerChipsFor({ actions: [], status: "blocked", reviewPending: true });
    expect(labels(chips)).toEqual(["Ask a question"]);
  });

  it("presses the bar's own button rather than writing a sentence", () => {
    const chips = composerChipsFor({
      actions: ["accept", "send-back"],
      status: "blocked",
      reviewPending: true,
    });
    expect(chips[0].action).toBe<TurnActionId>("accept");
    expect(chips[1].action).toBe<TurnActionId>("send-back");
    expect(chips[0].opener).toBeUndefined();
  });

  it("opens a sentence for the chips with no button", () => {
    const chips = composerChipsFor({ actions: [], status: "todo" });
    for (const chip of chips) {
      expect(chip.action).toBeUndefined();
      expect(chip.opener?.length).toBeGreaterThan(0);
    }
  });

  it("puts the hand-in before the plan when somehow both are pending", () => {
    const chips = composerChipsFor({
      actions: ["accept", "send-back", "approve"],
      status: "blocked",
      reviewPending: true,
      planPending: true,
    });
    expect(labels(chips)[0]).toBe("Approve");
  });
});
