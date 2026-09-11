import { describe, expect, it } from "vitest";
import {
  markConversationDispositionApplied,
  withConversationDispositionApplied,
} from "./conversation-disposition-applied.js";

function fakeDb(contextSnapshot: unknown) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ contextSnapshot }] }) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    } as never,
  };
}

describe("withConversationDispositionApplied", () => {
  it("keeps everything the context already carried", () => {
    const run = { id: "run-1", contextSnapshot: { issueId: "issue-1", wakeReason: "issue_assigned" } };
    expect(withConversationDispositionApplied(run)).toEqual({
      id: "run-1",
      contextSnapshot: {
        issueId: "issue-1",
        wakeReason: "issue_assigned",
        toderoDispositionApplied: true,
      },
    });
  });

  it("works for a context that was never set", () => {
    expect(withConversationDispositionApplied({ id: "run-1", contextSnapshot: null })).toEqual({
      id: "run-1",
      contextSnapshot: { toderoDispositionApplied: true },
    });
  });
});

describe("markConversationDispositionApplied", () => {
  it("records the mark on the stored row, next to what was there", async () => {
    const { db, updates } = fakeDb({ issueId: "issue-1" });
    await expect(markConversationDispositionApplied(db, "run-1")).resolves.toBe(true);
    expect(updates).toEqual([
      { contextSnapshot: { issueId: "issue-1", toderoDispositionApplied: true } },
    ]);
  });

  it("writes nothing a second time", async () => {
    const { db, updates } = fakeDb({ issueId: "issue-1", toderoDispositionApplied: true });
    await expect(markConversationDispositionApplied(db, "run-1")).resolves.toBe(false);
    expect(updates).toEqual([]);
  });
});
