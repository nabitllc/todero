import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  markConversationDispositionApplied,
  recordConversationDispositionApplied,
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

describe("recordConversationDispositionApplied", () => {
  it("says so on the turn's log instead of throwing when the write fails", async () => {
    const said: string[] = [];
    const brokenDb = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => { throw new Error("the database went away"); } }) }),
      }),
    } as never;

    await expect(
      recordConversationDispositionApplied(brokenDb, "run-1", async (_stream, chunk) => {
        said.push(chunk);
      }),
    ).resolves.toBeUndefined();
    expect(said.join("")).toContain("the database went away");
    expect(said.join("")).not.toMatch(/\b(issue|disposition|handoff|wake|heartbeat|continuation|run)\b/i);
  });
});

describe("the finalize path stamps the stored row", () => {
  // Wave 1 saw a second turn asked for after a turn that had already said what
  // happens next. The in-memory flag was passed to the hand-in check, but the
  // stored row was only marked on one of the branches that set it, so a later
  // sweep reading the row asked again. The mark now sits on the one line every
  // branch reaches, and this holds it there: the finalize path must mark the
  // row before it asks whether a hand-in is still needed.
  const source = readFileSync(
    path.resolve(__dirname, "..", "services", "heartbeat.ts"),
    "utf8",
  );

  it("marks the row before the hand-in check, for every branch", () => {
    const mark = source.indexOf("if (conversationDispositionApplied) await recordConversationDispositionApplied(");
    const handoff = source.indexOf("await handleSuccessfulRunHandoff(");
    expect(mark).toBeGreaterThan(-1);
    expect(handoff).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(handoff);
    expect(source.slice(mark, handoff)).toContain("recordConversationDispositionApplied(db, livenessRun.id, onLog)");
  });
});
