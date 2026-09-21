// Repro — wave 2 of the improvement loop: a task that waits on another one now
// wakes holding that task's finished work.
//
// Observed 2026-09-20, organization "Zz Full 0920-1219": ZZF-3 handed in four
// guides, ZZF-4 was told to review them, and ZZF-4 said five times "I cannot
// review the guides without the actual content. Please provide the drafts so I
// can review them." It was never given them. The dependency was enforced for
// order and ignored for content.
//
// This walks the whole path with no database: one predecessor with a hand-in,
// gathered the way the heartbeat gathers it, put on the run context the way the
// heartbeat puts it there, and read back out of the prompt the model is sent.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/dependency-handoff.gauntlet.ts
//
// Fails on origin/main (neither the gathering nor the prompt slot exists there).
import { describe, expect, it } from "vitest";
import { buildChatCompletionsMessages } from "../../../../server/src/adapters/http/chat-completions.js";
import {
  syncTaskInputs,
  type TaskInputsDeps,
} from "../../../../server/src/todero/task-inputs.js";

const DRAFTS = [
  "Guide 1 — Signing up: open the invite link, pick a password, confirm the email.",
  "Guide 2 — Inviting a teammate: Settings, People, Invite, paste the address.",
  "Guide 3 — Billing: the plan page shows the seats in use and the next charge.",
  "Guide 4 — Getting help: the help button opens a thread with support.",
].join("\n");

describe("a task is given the work it builds on", () => {
  const writes: Array<{ issueId: string; body: string }> = [];

  let stored: string | null = null;

  const deps: TaskInputsDeps = {
    listDirectPredecessors: async () => [
      { id: "zzf-3", identifier: "ZZF-3", title: "Write initial drafts" },
    ],
    readOutput: async (issueId: string) => (issueId === "zzf-3" ? DRAFTS : null),
    readCurrentInputs: async () => stored,
    writeInputsDocument: async (write) => {
      writes.push(write);
      stored = write.body;
    },
  };

  it("carries the predecessor's hand-in into the prompt the reviewer reads", async () => {
    const inputs = await syncTaskInputs(deps, "zzf-4");

    // It is on the task as a document, so a person can open what the agent got.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.issueId).toBe("zzf-4");
    expect(writes[0]!.body).toContain("Guide 1 — Signing up");

    const messages = buildChatCompletionsMessages(
      {
        toderoIssue: { identifier: "ZZF-4", title: "Review drafts", description: "Review the four guides." },
        toderoContextLength: 16_384,
        toderoInputs: inputs.map((input) => ({
          identifier: input.identifier,
          title: input.title,
          body: input.body,
        })),
      },
      { agentName: "Robin" },
    );

    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("ZZF-3 — Write initial drafts");
    expect(prompt).toContain("Guide 1 — Signing up");
    expect(prompt).toContain("Guide 4 — Getting help");
  });

  it("carries it even when the document on the task cannot be saved", async () => {
    // A person can lock that document, or save an edit to it at the wrong
    // moment. That must cost the person the copy they can open, and nothing
    // more — not the drafts the reviewer is there to read.
    const failures: unknown[] = [];
    const inputs = await syncTaskInputs(
      {
        ...deps,
        readCurrentInputs: async () => null,
        writeInputsDocument: async () => {
          throw new Error("Document is locked");
        },
        onWriteFailed: (error: unknown) => failures.push(error),
      },
      "zzf-4",
    );

    expect(failures).toHaveLength(1);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.body).toContain("Guide 1 — Signing up");
  });
});
