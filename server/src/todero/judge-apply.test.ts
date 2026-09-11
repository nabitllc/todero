import { describe, expect, it } from "vitest";
import { applyJudgeReview, type JudgeApplyDeps } from "./judge-apply.js";
import { descriptionWithJudgeFailRounds, planJudgeOutcome, readJudgeFailRounds } from "./judge.js";
import { isWaitingForManagerSendback } from "./manager-sendback.js";
import type { JudgeReviewResult } from "./judge-review.js";

type Recorded = {
  comments: Array<{ issueId: string; body: string; agentId: string }>;
  updates: Array<{ issueId: string; patch: { status?: string; description?: string; assigneeAgentId?: string } }>;
  wakes: Array<{ issueId: string; agentId: string; status: string }>;
  managerSendbackWakes: Array<{
    issueId: string;
    managerId: string;
    reason: string;
    failRound: number;
    taskIdentifier: string | null;
    taskTitle: string;
  }>;
  logs: string[];
};

function deps(): { deps: JudgeApplyDeps; recorded: Recorded } {
  const recorded: Recorded = { comments: [], updates: [], wakes: [], managerSendbackWakes: [], logs: [] };
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
      wakeManagerForSendback: async (input) => {
        recorded.managerSendbackWakes.push(input);
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

  it("wakes the manager for second fail in manager mode", async () => {
    const { deps: d, recorded } = deps();
    const result = await applyJudgeReview(d, {
      issue: { ...issue, identifier: "T1", title: "Write the guide" },
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "revise", round: 2 },
        verdict: "fail",
        comment: "Back again.",
      }),
      managerMode: true,
      managerId: "manager-1",
    });
    expect(result).toBe("revise");
    expect(recorded.managerSendbackWakes).toHaveLength(1);
    expect(recorded.managerSendbackWakes[0]).toEqual({
      issueId: "issue-1",
      managerId: "manager-1",
      reason: "reviewer_fail",
      failRound: 2,
      taskIdentifier: "T1",
      taskTitle: "Write the guide",
    });
    // Description should have both judge rounds and waiting marker
    const update = recorded.updates[0]!;
    expect(readJudgeFailRounds(update.patch.description)).toBe(2);
    expect(isWaitingForManagerSendback(update.patch.description)).toBe(true);
    // Worker should not be woken
    expect(recorded.wakes).toHaveLength(0);
  });

  it("wakes worker for second fail without manager mode", async () => {
    const { deps: d, recorded } = deps();
    await applyJudgeReview(d, {
      issue: { ...issue, identifier: "T1", title: "Write the guide" },
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "revise", round: 2 },
        verdict: "fail",
        comment: "Back again.",
      }),
      managerMode: false,
    });
    expect(recorded.managerSendbackWakes).toHaveLength(0);
    expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1", status: "todo" }]);
  });

  it("wakes worker for second fail even if manager mode is on but no managerId", async () => {
    const { deps: d, recorded } = deps();
    await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "revise", round: 2 },
        verdict: "fail",
        comment: "Back again.",
      }),
      managerMode: true,
      // managerId not provided
    });
    expect(recorded.managerSendbackWakes).toHaveLength(0);
    expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1", status: "todo" }]);
  });

  // The reviewer's own plan decides the shape of the outcome, and it stops
  // saying "revise" at the cap. These go through it rather than hand-building
  // an outcome, so the manager's send-back is exercised the way it really
  // arrives.
  describe("with the outcome the reviewer's plan actually produces", () => {
    const failOutcome = (description: string) =>
      planJudgeOutcome({
        verdict: "fail",
        failRounds: readJudgeFailRounds(description),
        autoAcceptWhenJudgePasses: false,
      });

    it("sends the first one back to the worker", async () => {
      const { deps: d, recorded } = deps();
      const description = "Draft the guide.";
      const outcome = failOutcome(description);
      expect(outcome).toEqual({ kind: "revise", round: 1 });

      const result = await applyJudgeReview(d, {
        issue: { id: "issue-1", description, identifier: "T1", title: "Write the guide" },
        assigneeAgentId: "agent-1",
        review: review({ outcome, verdict: "fail", comment: "Back to you." }),
        managerMode: true,
        managerId: "manager-1",
      });

      expect(result).toBe("revise");
      expect(recorded.managerSendbackWakes).toHaveLength(0);
      expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1", status: "todo" }]);
      expect(readJudgeFailRounds(recorded.updates[0]!.patch.description)).toBe(1);
    });

    it("gives the second one to the manager in manager mode", async () => {
      const { deps: d, recorded } = deps();
      const description = descriptionWithJudgeFailRounds("Draft the guide.", 1);
      const outcome = failOutcome(description);
      // The plan calls the last send-back it allows a hand-off, not a revision.
      expect(outcome).toEqual({ kind: "handoff", because: "rounds_exhausted" });

      const result = await applyJudgeReview(d, {
        issue: { id: "issue-1", description, identifier: "T1", title: "Write the guide" },
        assigneeAgentId: "agent-1",
        review: review({ outcome, verdict: "fail", comment: "Back again." }),
        managerMode: true,
        managerId: "manager-1",
      });

      expect(result).toBe("revise");
      expect(recorded.managerSendbackWakes).toEqual([
        {
          issueId: "issue-1",
          managerId: "manager-1",
          reason: "reviewer_fail",
          failRound: 2,
          taskIdentifier: "T1",
          taskTitle: "Write the guide",
        },
      ]);
      expect(recorded.wakes).toHaveLength(0);
      const update = recorded.updates[0]!;
      expect(update.patch.assigneeAgentId).toBe("manager-1");
      expect(readJudgeFailRounds(update.patch.description)).toBe(2);
      expect(isWaitingForManagerSendback(update.patch.description)).toBe(true);
    });

    it("gives the second one to the person when there is no manager mode", async () => {
      const { deps: d, recorded } = deps();
      const description = descriptionWithJudgeFailRounds("Draft the guide.", 1);

      const result = await applyJudgeReview(d, {
        issue: { id: "issue-1", description, identifier: "T1", title: "Write the guide" },
        assigneeAgentId: "agent-1",
        review: review({ outcome: failOutcome(description), verdict: "fail", comment: "Back again." }),
      });

      expect(result).toBe("handoff");
      expect(recorded.updates).toHaveLength(0);
      expect(recorded.wakes).toHaveLength(0);
      expect(recorded.managerSendbackWakes).toHaveLength(0);
    });

    it("gives a later one to the person even in manager mode", async () => {
      const { deps: d, recorded } = deps();
      // The manager already rewrote the brief once; it does not get another go.
      const description = descriptionWithJudgeFailRounds("Draft the guide.", 2);

      const result = await applyJudgeReview(d, {
        issue: { id: "issue-1", description, identifier: "T1", title: "Write the guide" },
        assigneeAgentId: "agent-1",
        review: review({ outcome: failOutcome(description), verdict: "fail", comment: "Back again." }),
        managerMode: true,
        managerId: "manager-1",
      });

      expect(result).toBe("handoff");
      expect(recorded.managerSendbackWakes).toHaveLength(0);
      expect(recorded.updates).toHaveLength(0);
    });

    it("leaves a pass alone in manager mode", async () => {
      const { deps: d, recorded } = deps();
      const outcome = planJudgeOutcome({
        verdict: "pass",
        failRounds: 1,
        autoAcceptWhenJudgePasses: false,
      });

      const result = await applyJudgeReview(d, {
        issue: { id: "issue-1", description: descriptionWithJudgeFailRounds("Draft the guide.", 1) },
        assigneeAgentId: "agent-1",
        review: review({ outcome, verdict: "pass", comment: "Ready for you." }),
        managerMode: true,
        managerId: "manager-1",
      });

      expect(result).toBe("handoff");
      expect(recorded.managerSendbackWakes).toHaveLength(0);
      expect(recorded.updates).toHaveLength(0);
    });
  });

  it("wakes worker for first fail even in manager mode", async () => {
    const { deps: d, recorded } = deps();
    await applyJudgeReview(d, {
      issue,
      assigneeAgentId: "agent-1",
      review: review({
        outcome: { kind: "revise", round: 1 },
        verdict: "fail",
        comment: "Add more details.",
      }),
      managerMode: true,
      managerId: "manager-1",
    });
    // First fail should always go to worker, even in manager mode
    expect(recorded.managerSendbackWakes).toHaveLength(0);
    expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1", status: "todo" }]);
  });
});
