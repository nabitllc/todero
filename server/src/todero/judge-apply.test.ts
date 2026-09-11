import { describe, expect, it } from "vitest";
import { applyJudgeReview, type JudgeApplyDeps } from "./judge-apply.js";
import { readJudgeFailRounds } from "./judge.js";
import type { JudgeReviewResult } from "./judge-review.js";

type Recorded = {
  comments: Array<{ issueId: string; body: string; agentId: string }>;
  updates: Array<{ issueId: string; patch: { status?: string; description?: string } }>;
  wakes: Array<{ issueId: string; agentId: string; status: string }>;
  logs: string[];
};

function deps(): { deps: JudgeApplyDeps; recorded: Recorded } {
  const recorded: Recorded = { comments: [], updates: [], wakes: [], logs: [] };
  return {
    recorded,
    deps: {
      addComment: async (issueId, body, agentId) => {
        recorded.comments.push({ issueId, body, agentId });
      },
      updateIssue: async (issueId, patch) => {
        recorded.updates.push({ issueId, patch });
      },
      wakeAgent: async (input) => {
        recorded.wakes.push(input);
      },
      log: (message) => recorded.logs.push(message),
    },
  };
}

const judgeAgent = {
  id: "judge-1",
  name: "Ash's reviewer",
  companyId: "co-1",
  status: "idle",
  adapterType: "http",
  adapterConfig: {},
};

function review(partial: Partial<JudgeReviewResult>): JudgeReviewResult {
  return {
    outcome: { kind: "skip" },
    verdict: null,
    note: "",
    comment: null,
    judgeAgent,
    skipped: null,
    ...partial,
  };
}

const issue = { id: "issue-1", description: "Draft the guide." };

describe("applyJudgeReview", () => {
  it("changes nothing when no review happened", async () => {
    const { deps: d, recorded } = deps();
    const result = await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({ outcome: { kind: "skip" }, skipped: "no_reviewer" }),
    });
    expect(result).toBe("none");
    expect(recorded.comments).toHaveLength(0);
    expect(recorded.updates).toHaveLength(0);
  });

  it("accepts a pass and posts the reviewer's note under the reviewer's name", async () => {
    const { deps: d, recorded } = deps();
    const result = await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({ outcome: { kind: "accept" }, verdict: "pass", note: "Reads well.", comment: "I accepted it." }),
    });
    expect(result).toBe("accept");
    expect(recorded.comments).toEqual([{ issueId: "issue-1", body: "I accepted it.", agentId: "judge-1" }]);
    // The caller closes the task; nothing is patched here.
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.wakes).toHaveLength(0);
  });

  it("hands a pass to the person when the company asked to see them", async () => {
    const { deps: d, recorded } = deps();
    const result = await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "handoff", because: "passed" },
        verdict: "pass",
        comment: "Ready for you.",
      }),
    });
    expect(result).toBe("handoff");
    expect(recorded.comments).toHaveLength(1);
    expect(recorded.updates).toHaveLength(0);
  });

  it("sends a fail back to the agent with the round counted", async () => {
    const { deps: d, recorded } = deps();
    const result = await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "revise", round: 1 },
        verdict: "fail",
        note: "Add the prices.",
        comment: "Sending it back. Add the prices.",
      }),
    });
    expect(result).toBe("revise");
    expect(recorded.comments).toHaveLength(1);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]!.patch.status).toBe("todo");
    expect(readJudgeFailRounds(recorded.updates[0]!.patch.description)).toBe(1);
    expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1", status: "todo" }]);
  });

  it("does not try to wake a task with no agent on it", async () => {
    const { deps: d, recorded } = deps();
    await applyJudgeReview(d, {
      issue,
      assigneeAgentId: null,
      review: review({ outcome: { kind: "revise", round: 2 }, verdict: "fail", comment: "Back to you." }),
    });
    expect(recorded.wakes).toHaveLength(0);
    expect(recorded.updates).toHaveLength(1);
  });
});
