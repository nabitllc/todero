import { describe, expect, it } from "vitest";
import {
  applyManagerAssignmentReply,
  applyManagerGuidanceReply,
  postReviewVerdictLine,
  type ManagerWaveDeps,
} from "./manager-wave-apply.js";
import { readManagerAssignmentMarker } from "./manager-assignment.js";
import {
  descriptionWithWaitingForManagerMarker,
  hasGuidanceMarker,
  isWaitingForManagerSendback,
  readWaitingForManagerWorkerId,
} from "./manager-sendback.js";
import { MANAGER_GUIDANCE_DOCUMENT_KEY } from "./manager-wave.js";

type Recorded = {
  updates: Array<{ issueId: string; patch: { status?: string; description?: string; assigneeAgentId?: string } }>;
  comments: Array<{ issueId: string; body: string; agentId: string }>;
  wakes: Array<{ issueId: string; agentId: string }>;
  documents: Array<{ issueId: string; key: string; title: string; body: string }>;
  logs: string[];
};

function deps(): { deps: ManagerWaveDeps; recorded: Recorded } {
  const recorded: Recorded = { updates: [], comments: [], wakes: [], documents: [], logs: [] };
  return {
    recorded,
    deps: {
      updateIssue: async (issueId, patch) => {
        recorded.updates.push({ issueId, patch });
      },
      addComment: async (issueId, body, agentId) => {
        recorded.comments.push({ issueId, body, agentId });
      },
      wakeWorker: async (input) => {
        recorded.wakes.push(input);
      },
      saveDocument: async (input) => {
        recorded.documents.push(input);
      },
      log: (message) => recorded.logs.push(message),
    },
  };
}

const MANAGER_ID = "manager-1";
const WORKERS = [
  { id: "w1", name: "Ash" },
  { id: "w2", name: "Nova" },
];
const CHILDREN = [
  {
    id: "t1",
    identifier: "ZZW-1",
    title: "Draft the guide",
    description: "Write it.",
    assigneeAgentId: "w1",
  },
  {
    id: "t2",
    identifier: "ZZW-2",
    title: "List the prices",
    description: "Price it.",
    assigneeAgentId: "w1",
  },
];

describe("applyManagerAssignmentReply", () => {
  it("moves the task the manager named and stamps it", async () => {
    const { deps: d, recorded } = deps();
    const reply = ["assignments:", "- ZZW-2: Nova", "STATUS: done"].join("\n");

    const result = await applyManagerAssignmentReply(d, {
      managerId: MANAGER_ID,
      conversationIssueId: "conv-1",
      reply,
      children: CHILDREN,
      workers: WORKERS,
      readyChildIssueIds: ["t1"],
    });

    expect(result.managerNamedThem).toBe(true);
    expect(result.moved).toBe(1);
    const moved = recorded.updates.find((update) => update.issueId === "t2");
    expect(moved?.patch.assigneeAgentId).toBe("w2");
    expect(readManagerAssignmentMarker(moved?.patch.description)).toBe(MANAGER_ID);
  });

  it("leaves the rule's worker on anything the manager did not name", async () => {
    const { deps: d, recorded } = deps();
    const reply = ["assignments:", "- ZZW-2: Nova", "STATUS: done"].join("\n");

    await applyManagerAssignmentReply(d, {
      managerId: MANAGER_ID,
      conversationIssueId: "conv-1",
      reply,
      children: CHILDREN,
      workers: WORKERS,
      readyChildIssueIds: [],
    });

    expect(recorded.updates.some((update) => update.issueId === "t1")).toBe(false);
  });

  it("touches nothing when the reply has no usable shape", async () => {
    const { deps: d, recorded } = deps();

    const result = await applyManagerAssignmentReply(d, {
      managerId: MANAGER_ID,
      conversationIssueId: "conv-1",
      reply: "I will look at it later. STATUS: done",
      children: CHILDREN,
      workers: WORKERS,
      readyChildIssueIds: [],
    });

    expect(result.managerNamedThem).toBe(false);
    expect(result.moved).toBe(0);
    expect(recorded.updates).toHaveLength(0);
  });

  it("says on the conversation task who has what", async () => {
    const { deps: d, recorded } = deps();

    await applyManagerAssignmentReply(d, {
      managerId: MANAGER_ID,
      conversationIssueId: "conv-1",
      reply: ["assignments:", "- ZZW-1: Ash", "- ZZW-2: Nova"].join("\n"),
      children: CHILDREN,
      workers: WORKERS,
      readyChildIssueIds: [],
    });

    expect(recorded.comments).toHaveLength(1);
    expect(recorded.comments[0]!.issueId).toBe("conv-1");
    expect(recorded.comments[0]!.agentId).toBe(MANAGER_ID);
    expect(recorded.comments[0]!.body).toContain("ZZW-1 — Draft the guide → Ash");
    expect(recorded.comments[0]!.body).toContain("ZZW-2 — List the prices → Nova");
  });

  it("starts only the tasks nothing is holding up, on their new worker", async () => {
    const { deps: d, recorded } = deps();

    await applyManagerAssignmentReply(d, {
      managerId: MANAGER_ID,
      conversationIssueId: "conv-1",
      reply: ["assignments:", "- ZZW-1: Nova", "- ZZW-2: Nova"].join("\n"),
      children: CHILDREN,
      workers: WORKERS,
      readyChildIssueIds: ["t1"],
    });

    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w2" }]);
  });
});

describe("applyManagerGuidanceReply", () => {
  const task = {
    id: "t1",
    identifier: "ZZW-1",
    title: "Draft the guide",
    description: descriptionWithWaitingForManagerMarker("Write it.", "w1"),
    // The manager holds the task while it writes the brief.
    assigneeAgentId: MANAGER_ID,
  };

  it("keeps the paragraph, hands the task back, and starts the worker", async () => {
    const { deps: d, recorded } = deps();
    const reply = [
      "Cut the intro and lead with the price table.",
      "",
      "STATUS: done",
    ].join("\n");

    const result = await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply,
      task,
      workers: WORKERS,
    });

    expect(result.guidance).toBe("Cut the intro and lead with the price table.");
    expect(recorded.documents).toEqual([
      {
        issueId: "t1",
        key: MANAGER_GUIDANCE_DOCUMENT_KEY,
        title: "What to change",
        body: "Cut the intro and lead with the price table.",
      },
    ]);
    const patch = recorded.updates[0]!.patch;
    expect(patch.status).toBe("todo");
    expect(patch.assigneeAgentId).toBe("w1");
    expect(isWaitingForManagerSendback(patch.description)).toBe(false);
    expect(hasGuidanceMarker(patch.description)).toBe(true);
    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w1" }]);
  });

  it("says the paragraph on the task, since the worker only reads the thread", async () => {
    const { deps: d, recorded } = deps();

    await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply: "Lead with the price table.\n\nSTATUS: done",
      task,
      workers: WORKERS,
    });

    expect(recorded.comments).toHaveLength(1);
    expect(recorded.comments[0]!.issueId).toBe("t1");
    expect(recorded.comments[0]!.body).toContain("Lead with the price table.");
  });

  it("sends it to somebody else when the manager said so", async () => {
    const { deps: d, recorded } = deps();
    const reply = [
      "The price table needs to come first.",
      "",
      "assignments:",
      "- ZZW-1: Nova",
      "",
      "STATUS: done",
    ].join("\n");

    const result = await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply,
      task,
      workers: WORKERS,
    });

    expect(result.reassigned).toBe(true);
    expect(result.assigneeAgentId).toBe("w2");
    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w2" }]);
    expect(readManagerAssignmentMarker(recorded.updates[0]!.patch.description)).toBe(MANAGER_ID);
  });

  it("still hands the task back when the reply carries no paragraph", async () => {
    const { deps: d, recorded } = deps();

    const result = await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply: "STATUS: done",
      task,
      workers: WORKERS,
    });

    expect(result.guidance).toBeNull();
    expect(recorded.documents).toHaveLength(0);
    expect(recorded.comments).toHaveLength(0);
    expect(recorded.updates[0]!.patch.assigneeAgentId).toBe("w1");
    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w1" }]);
  });

  it("falls back to the first worker when the marker remembers nobody", async () => {
    const { deps: d, recorded } = deps();

    await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply: "Try again with shorter steps.\n\nSTATUS: done",
      task: { ...task, description: descriptionWithWaitingForManagerMarker("Write it.") },
      workers: WORKERS,
    });

    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w1" }]);
  });

  it("falls back to the first worker when the remembered one has gone", async () => {
    const { deps: d, recorded } = deps();

    await applyManagerGuidanceReply(d, {
      managerId: MANAGER_ID,
      reply: "Try again with shorter steps.\n\nSTATUS: done",
      task: { ...task, description: descriptionWithWaitingForManagerMarker("Write it.", "left-the-company") },
      workers: WORKERS,
    });

    expect(recorded.wakes).toEqual([{ issueId: "t1", agentId: "w1" }]);
  });
});

describe("the waiting-for-manager marker", () => {
  it("remembers whose task it was", () => {
    const description = descriptionWithWaitingForManagerMarker("Write it.", "w1");
    expect(isWaitingForManagerSendback(description)).toBe(true);
    expect(readWaitingForManagerWorkerId(description)).toBe("w1");
  });

  it("still reads as waiting with nobody remembered", () => {
    const description = descriptionWithWaitingForManagerMarker("Write it.");
    expect(isWaitingForManagerSendback(description)).toBe(true);
    expect(readWaitingForManagerWorkerId(description)).toBeNull();
  });

  it("keeps exactly one marker", () => {
    const once = descriptionWithWaitingForManagerMarker("Write it.", "w1");
    const twice = descriptionWithWaitingForManagerMarker(once, "w2");
    expect((twice.match(/todero-waiting-for-manager-sendback/g) ?? []).length).toBe(1);
    expect(readWaitingForManagerWorkerId(twice)).toBe("w2");
    expect(twice).toContain("Write it.");
  });
});

describe("postReviewVerdictLine", () => {
  it("puts one line on the conversation task, authored by the reviewer", async () => {
    const { deps: d, recorded } = deps();

    await postReviewVerdictLine(d, {
      conversationIssueId: "conv-1",
      reviewerAgentId: "judge-1",
      task: { identifier: "ZZW-1", title: "Draft the guide" },
      verdict: "passed",
    });

    expect(recorded.comments).toEqual([
      { issueId: "conv-1", body: "ZZW-1 — Draft the guide: the reviewer passed it.", agentId: "judge-1" },
    ]);
  });
});
