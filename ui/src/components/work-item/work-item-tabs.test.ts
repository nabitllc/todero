import { describe, expect, it } from "vitest";
import { defaultTabFor, resolveTab, tabsFor } from "./work-item-tabs";

describe("tabsFor", () => {
  it("always offers the conversation", () => {
    expect(tabsFor({}).map((tab) => tab.id)).toEqual(["conversation"]);
  });

  it("offers the deliverable once there is one", () => {
    expect(tabsFor({ hasDeliverable: true }).map((tab) => tab.id)).toEqual([
      "conversation",
      "deliverable",
    ]);
  });

  it("offers the plan once there is one", () => {
    expect(tabsFor({ hasPlan: true }).map((tab) => tab.id)).toEqual(["conversation", "plan"]);
  });

  it("keeps conversation, deliverable, plan in that order", () => {
    expect(tabsFor({ hasDeliverable: true, hasPlan: true }).map((tab) => tab.id)).toEqual([
      "conversation",
      "deliverable",
      "plan",
    ]);
  });

  it("names them in the words the screen uses", () => {
    expect(tabsFor({ hasDeliverable: true, hasPlan: true }).map((tab) => tab.label)).toEqual([
      "Conversation",
      "Deliverable",
      "Plan",
    ]);
  });
});

describe("defaultTabFor", () => {
  it("opens the conversation while the task is being worked", () => {
    expect(defaultTabFor({ hasDeliverable: true })).toBe("conversation");
  });

  it("opens the deliverable once work is handed in", () => {
    expect(defaultTabFor({ hasDeliverable: true, reviewPending: true })).toBe("deliverable");
  });

  it("stays on the conversation when a hand-in left no document", () => {
    expect(defaultTabFor({ reviewPending: true })).toBe("conversation");
  });

  it("keeps opening on the output once the work is accepted", () => {
    expect(defaultTabFor({ hasDeliverable: true, reviewPending: false, status: "done" })).toBe(
      "deliverable",
    );
  });

  it("goes back to the conversation when the work was sent back to be redone", () => {
    expect(defaultTabFor({ hasDeliverable: true, status: "in_progress" })).toBe("conversation");
    expect(defaultTabFor({ hasDeliverable: true, status: "todo" })).toBe("conversation");
  });

  it("leaves a finished task with no output on the conversation", () => {
    expect(defaultTabFor({ status: "done" })).toBe("conversation");
  });

  it("opens the plan while it is still asking for a yes", () => {
    expect(defaultTabFor({ hasPlan: true, planApprovable: true })).toBe("plan");
  });

  it("leaves an approved plan behind the conversation", () => {
    expect(defaultTabFor({ hasPlan: true })).toBe("conversation");
  });

  it("puts a hand-in ahead of a plan when both are waiting", () => {
    expect(
      defaultTabFor({ hasDeliverable: true, hasPlan: true, reviewPending: true, planApprovable: true }),
    ).toBe("deliverable");
  });
});

describe("resolveTab", () => {
  it("keeps a tab that is still there", () => {
    expect(resolveTab("plan", { hasPlan: true })).toBe("plan");
  });

  it("falls back to the conversation when the tab has gone", () => {
    expect(resolveTab("plan", { hasPlan: false })).toBe("conversation");
    expect(resolveTab("deliverable", {})).toBe("conversation");
  });
});
