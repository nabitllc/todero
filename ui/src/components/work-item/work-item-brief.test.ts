import { describe, expect, it } from "vitest";
import { isWorkItemBrief, parseWorkItemBrief } from "./work-item-brief";

const STANDING_INSTRUCTION =
  "Do this task now, in this reply: write out the output described above in full, as the deliverable itself, not a description of it. Nobody is waiting to give you more information; everything you need is above. Only if something essential is missing, ask one question. End with `STATUS: done` when the output is complete, or `STATUS: waiting` right after that one question.";

const FULL_BRIEF = [
  "Goal: Open a coffee shop on Mission Street",
  "",
  "What the person said when we planned this (use it; do not ask for it again):",
  "- We want it open by March.",
  "- Keep the budget under forty thousand.",
  "",
  "Feature: Storefront — the room people walk into",
  "Done when: the lease is signed and the fit-out is booked",
  "Hand in: a one-page summary of the lease terms",
  "",
  STANDING_INSTRUCTION,
].join("\n");

describe("parseWorkItemBrief", () => {
  it("reads the labelled lines out of a plan-made brief", () => {
    const brief = parseWorkItemBrief(FULL_BRIEF);
    expect(brief.lines).toEqual([
      { label: "Goal", value: "Open a coffee shop on Mission Street" },
      { label: "Feature", value: "Storefront — the room people walk into" },
      { label: "Done when", value: "the lease is signed and the fit-out is booked" },
      { label: "Hand in", value: "a one-page summary of the lease terms" },
    ]);
  });

  it("keeps what the person said in their own words", () => {
    expect(parseWorkItemBrief(FULL_BRIEF).said).toEqual([
      "We want it open by March.",
      "Keep the budget under forty thousand.",
    ]);
  });

  it("drops the standing instruction and everything after it", () => {
    const brief = parseWorkItemBrief(FULL_BRIEF);
    expect(brief.rest).toBe("");
    expect(JSON.stringify(brief)).not.toContain("STATUS: done");
    expect(JSON.stringify(brief)).not.toContain("Nobody is waiting");
  });

  it("drops a reworded standing instruction too", () => {
    const brief = parseWorkItemBrief("Goal: Ship it\n\nDo this task now and tell me when.");
    expect(brief.rest).toBe("");
    expect(brief.lines).toEqual([{ label: "Goal", value: "Ship it" }]);
  });

  it("shows the labels in the card's order, not the order they were written", () => {
    const brief = parseWorkItemBrief(
      ["Hand in: a summary", "Done when: it is signed", "Goal: Open a shop"].join("\n"),
    );
    expect(brief.lines.map((line) => line.label)).toEqual(["Goal", "Done when", "Hand in"]);
  });

  it("keeps only the first of a repeated label", () => {
    const brief = parseWorkItemBrief("Goal: First goal\nGoal: Second goal");
    expect(brief.lines).toEqual([{ label: "Goal", value: "First goal" }]);
  });

  it("ignores a label with nothing after it", () => {
    const brief = parseWorkItemBrief("Goal:\nHand in: a summary");
    expect(brief.lines).toEqual([{ label: "Hand in", value: "a summary" }]);
    expect(brief.rest).toBe("Goal:");
  });

  it("matches a label whatever its case", () => {
    expect(parseWorkItemBrief("goal: Open a shop").lines).toEqual([
      { label: "Goal", value: "Open a shop" },
    ]);
  });

  it("stops collecting what the person said at the next labelled line", () => {
    const brief = parseWorkItemBrief(
      [
        "Goal: Open a shop",
        "What the person said when we planned this:",
        "- Keep it cheap.",
        "Feature: Storefront",
      ].join("\n"),
    );
    expect(brief.said).toEqual(["Keep it cheap."]);
    expect(brief.lines.map((line) => line.label)).toEqual(["Goal", "Feature"]);
  });

  it("takes an asterisk bullet as well as a dash", () => {
    const brief = parseWorkItemBrief(
      ["What the person said when we planned this:", "* Keep it cheap."].join("\n"),
    );
    expect(brief.said).toEqual(["Keep it cheap."]);
  });

  it("skips an empty bullet", () => {
    const brief = parseWorkItemBrief(
      ["What the person said when we planned this:", "-   ", "- Keep it cheap."].join("\n"),
    );
    expect(brief.said).toEqual(["Keep it cheap."]);
  });

  it("keeps a line it does not recognise, exactly as written", () => {
    const brief = parseWorkItemBrief("Goal: Open a shop\nAlso: talk to the landlord first.");
    expect(brief.rest).toBe("Also: talk to the landlord first.");
  });

  it("treats a body nobody planned as all rest", () => {
    const brief = parseWorkItemBrief("Fix the header on the pricing page.");
    expect(brief.lines).toEqual([]);
    expect(brief.said).toEqual([]);
    expect(brief.rest).toBe("Fix the header on the pricing page.");
  });

  it("handles an empty body", () => {
    expect(parseWorkItemBrief("")).toEqual({ lines: [], said: [], rest: "" });
    expect(parseWorkItemBrief(null)).toEqual({ lines: [], said: [], rest: "" });
    expect(parseWorkItemBrief(undefined)).toEqual({ lines: [], said: [], rest: "" });
  });

  it("reads a brief written with carriage returns", () => {
    const brief = parseWorkItemBrief("Goal: Open a shop\r\nHand in: a summary");
    expect(brief.lines).toEqual([
      { label: "Goal", value: "Open a shop" },
      { label: "Hand in", value: "a summary" },
    ]);
  });
});

describe("isWorkItemBrief", () => {
  it("recognises a plan-made brief", () => {
    expect(isWorkItemBrief(FULL_BRIEF)).toBe(true);
  });

  it("does not mistake a body a person typed for a brief", () => {
    expect(isWorkItemBrief("Fix the header on the pricing page.")).toBe(false);
    expect(isWorkItemBrief("")).toBe(false);
  });
});
