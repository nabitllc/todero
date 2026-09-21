import { describe, expect, it } from "vitest";
import {
  buildTaskInputsDocumentBody,
  collectTaskInputs,
  syncTaskInputs,
  TASK_INPUTS_DOCUMENT_KEY,
  type TaskInputsDeps,
} from "./task-inputs.js";

const CHILD = "child-issue";

function deps(input: {
  predecessors: Array<{ id: string; identifier: string | null; title: string }>;
  outputs: Record<string, string>;
  writes: Array<{ issueId: string; body: string }>;
  /** What the task's own hand-off document already says, when the test cares. */
  stored?: { body: string | null };
  /** Makes the write fail, the way a locked or just-edited document does. */
  failWriteWith?: Error;
  failures?: unknown[];
  /** One entry each time the work this task builds on is not what it was. */
  changed?: string[];
}): TaskInputsDeps {
  return {
    listDirectPredecessors: async () => input.predecessors,
    readOutput: async (issueId: string) => input.outputs[issueId] ?? null,
    readCurrentInputs: async () => input.stored?.body ?? null,
    writeInputsDocument: async (write) => {
      if (input.failWriteWith) throw input.failWriteWith;
      input.writes.push(write);
      if (input.stored) input.stored.body = write.body;
    },
    onChanged: () => {
      input.changed?.push("changed");
    },
    onWriteFailed: (error: unknown) => {
      input.failures?.push(error);
    },
  };
}

describe("the work a task builds on", () => {
  it("collects the finished work of every task it waited on", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    const inputs = await collectTaskInputs(
      deps({
        predecessors: [
          { id: "a", identifier: "ZZF-2", title: "Pick the four topics" },
          { id: "b", identifier: "ZZF-3", title: "Write initial drafts" },
        ],
        outputs: { a: "Sign-up, invites, billing, support.", b: "Draft one: how to sign up." },
        writes,
      }),
      CHILD,
    );
    expect(inputs.map((entry) => entry.identifier)).toEqual(["ZZF-2", "ZZF-3"]);
    expect(inputs[1]!.body).toBe("Draft one: how to sign up.");
  });

  it("leaves out a task that handed in nothing", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    const inputs = await collectTaskInputs(
      deps({
        predecessors: [
          { id: "a", identifier: "ZZF-2", title: "Pick the four topics" },
          { id: "b", identifier: "ZZF-3", title: "Write initial drafts" },
        ],
        outputs: { b: "Draft one: how to sign up." },
        writes,
      }),
      CHILD,
    );
    expect(inputs.map((entry) => entry.identifier)).toEqual(["ZZF-3"]);
  });

  it("writes it on the task as a document anyone can open", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    await syncTaskInputs(
      deps({
        predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
        outputs: { b: "Draft one: how to sign up." },
        writes,
      }),
      CHILD,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]!.issueId).toBe(CHILD);
    expect(writes[0]!.body).toContain("ZZF-3 — Write initial drafts");
    expect(writes[0]!.body).toContain("Draft one: how to sign up.");
    expect(TASK_INPUTS_DOCUMENT_KEY).toBe("inputs");
  });

  it("writes nothing when the task waits on nobody", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    const inputs = await syncTaskInputs(
      deps({ predecessors: [], outputs: {}, writes }),
      CHILD,
    );
    expect(inputs).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("shows the newest version after a task was sent back and redone", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    const outputs: Record<string, string> = { b: "The first, thin draft." };
    const state = {
      predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
      outputs,
      writes,
    };
    await syncTaskInputs(deps(state), CHILD);
    outputs.b = "The rewritten draft, with the four guides.";
    const second = await syncTaskInputs(deps(state), CHILD);

    expect(second[0]!.body).toBe("The rewritten draft, with the four guides.");
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toContain("The rewritten draft, with the four guides.");
    expect(writes[1]!.body).not.toContain("The first, thin draft.");
  });

  it("still hands the work to the task when the document cannot be written", async () => {
    // A person can lock this document, or edit it in the moment between the
    // read and the write; the documents service throws in both cases. The
    // document is only how a person sees the hand-off. Losing it must not
    // lose the work itself, which is the whole point of the feature.
    const writes: Array<{ issueId: string; body: string }> = [];
    const failures: unknown[] = [];
    const locked = new Error("Document is locked");
    const inputs = await syncTaskInputs(
      deps({
        predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
        outputs: { b: "Draft one: how to sign up." },
        writes,
        failWriteWith: locked,
        failures,
      }),
      CHILD,
    );

    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.body).toBe("Draft one: how to sign up.");
    expect(writes).toEqual([]);
    expect(failures).toEqual([locked]);
  });

  it("leaves the document alone when nothing it says has changed", async () => {
    // Every wake of every task after this one would otherwise store another
    // full copy of the same text, and a person opening the history would see
    // a list of identical versions.
    const writes: Array<{ issueId: string; body: string }> = [];
    const outputs: Record<string, string> = { b: "Draft one: how to sign up." };
    const state = {
      predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
      outputs,
      writes,
      stored: { body: null as string | null },
    };

    await syncTaskInputs(deps(state), CHILD);
    await syncTaskInputs(deps(state), CHILD);
    await syncTaskInputs(deps(state), CHILD);
    expect(writes).toHaveLength(1);

    outputs.b = "The rewritten draft, with the four guides.";
    await syncTaskInputs(deps(state), CHILD);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toContain("The rewritten draft, with the four guides.");
  });

  it("says so when what the task builds on is not what it was last time", async () => {
    // This is the half of the "inputs changed" rule that decides whether the
    // task is told again that the work is in front of it. Without it a task
    // whose predecessor was sent back and redone would be handed the new
    // version with nothing said about it.
    const writes: Array<{ issueId: string; body: string }> = [];
    const changed: string[] = [];
    const outputs: Record<string, string> = { b: "The first, thin draft." };
    const state = {
      predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
      outputs,
      writes,
      stored: { body: null as string | null },
      changed,
    };

    await syncTaskInputs(deps(state), CHILD);
    expect(changed).toHaveLength(1);

    // Same work again: nothing changed, so nothing is said.
    await syncTaskInputs(deps(state), CHILD);
    expect(changed).toHaveLength(1);

    // The predecessor was sent back and redone.
    outputs.b = "The rewritten draft, with the four guides.";
    await syncTaskInputs(deps(state), CHILD);
    expect(changed).toHaveLength(2);
  });

  it("says nothing changed when the document could not be written", async () => {
    const writes: Array<{ issueId: string; body: string }> = [];
    const changed: string[] = [];
    await syncTaskInputs(
      deps({
        predecessors: [{ id: "b", identifier: "ZZF-3", title: "Write initial drafts" }],
        outputs: { b: "Draft one: how to sign up." },
        writes,
        failWriteWith: new Error("Document is locked"),
        failures: [],
        changed,
      }),
      CHILD,
    );
    expect(changed).toEqual([]);
  });

  it("says in the document where the work came from", () => {
    const body = buildTaskInputsDocumentBody([
      { issueId: "b", identifier: "ZZF-3", title: "Write initial drafts", body: "Draft one." },
    ]);
    expect(body).toContain("ZZF-3 — Write initial drafts");
    expect(body).toContain("Draft one.");
  });
});
