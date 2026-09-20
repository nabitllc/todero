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
}): TaskInputsDeps {
  return {
    listDirectPredecessors: async () => input.predecessors,
    readOutput: async (issueId: string) => input.outputs[issueId] ?? null,
    writeInputsDocument: async (write) => {
      input.writes.push(write);
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

  it("says in the document where the work came from", () => {
    const body = buildTaskInputsDocumentBody([
      { issueId: "b", identifier: "ZZF-3", title: "Write initial drafts", body: "Draft one." },
    ]);
    expect(body).toContain("ZZF-3 — Write initial drafts");
    expect(body).toContain("Draft one.");
  });
});
