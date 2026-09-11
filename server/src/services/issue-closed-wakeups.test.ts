import { describe, expect, it, vi } from "vitest";
import {
  enqueueWakesForClosedIssue,
  ISSUE_CHILDREN_COMPLETED_WAKE_REASON,
  type ClosedIssueWakeDeps,
} from "./issue-closed-wakeups.js";
import { ISSUE_BLOCKERS_RESOLVED_WAKE_REASON } from "./issue-dependency-wakeups.js";

function deps(overrides: Partial<ClosedIssueWakeDeps> = {}) {
  const enqueueWakeup = vi.fn().mockResolvedValue({ id: "wake" });
  const base: ClosedIssueWakeDeps = {
    listWakeableBlockedDependents: vi.fn().mockResolvedValue([]),
    getWakeableParentAfterChildCompletion: vi.fn().mockResolvedValue(null),
    enqueueWakeup,
    ...overrides,
  };
  return { deps: base, enqueueWakeup: base.enqueueWakeup as ReturnType<typeof vi.fn> };
}

const closedTask = {
  issue: { id: "task-a", companyId: "company-1", parentId: "conversation-1" },
  source: "issue.judge_accepted",
  requestedByActorType: "agent" as const,
  requestedByActorId: "agent-1",
};

describe("enqueueWakesForClosedIssue", () => {
  it("wakes the task that was queued behind the one that closed", async () => {
    const { deps: d, enqueueWakeup } = deps({
      listWakeableBlockedDependents: vi.fn().mockResolvedValue([
        {
          id: "task-b",
          assigneeAgentId: "agent-1",
          blockerIssueIds: ["task-a"],
          blockedTransitionAt: null,
        },
      ]),
    });

    const result = await enqueueWakesForClosedIssue(d, closedTask);

    expect(result.dependentIssueIds).toEqual(["task-b"]);
    const [agentId, wakeup] = enqueueWakeup.mock.calls[0]!;
    expect(agentId).toBe("agent-1");
    expect(wakeup.reason).toBe(ISSUE_BLOCKERS_RESOLVED_WAKE_REASON);
    expect(wakeup.payload).toMatchObject({ issueId: "task-b", resolvedBlockerIssueId: "task-a" });
    expect(typeof wakeup.idempotencyKey).toBe("string");
  });

  it("skips a dependent whose wake is already queued", async () => {
    const { deps: d, enqueueWakeup } = deps({
      listWakeableBlockedDependents: vi.fn().mockResolvedValue([
        { id: "task-b", assigneeAgentId: "agent-1", blockerIssueIds: ["task-a"], blockedTransitionAt: null },
      ]),
      hasPendingDependencyWake: vi.fn().mockResolvedValue(true),
    });

    const result = await enqueueWakesForClosedIssue(d, closedTask);

    expect(result.dependentIssueIds).toEqual([]);
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("wakes the parent for its wrap-up once every task under it is closed", async () => {
    const { deps: d, enqueueWakeup } = deps({
      getWakeableParentAfterChildCompletion: vi.fn().mockResolvedValue({
        id: "conversation-1",
        assigneeAgentId: "agent-1",
        childIssueIds: ["task-a", "task-b"],
        childIssueSummaries: [],
        childIssueSummaryTruncated: false,
      }),
    });

    const result = await enqueueWakesForClosedIssue(d, closedTask);

    expect(result.parentIssueId).toBe("conversation-1");
    const [, wakeup] = enqueueWakeup.mock.calls[0]!;
    expect(wakeup.reason).toBe(ISSUE_CHILDREN_COMPLETED_WAKE_REASON);
    expect(wakeup.payload).toMatchObject({
      issueId: "conversation-1",
      completedChildIssueId: "task-a",
    });
  });

  it("leaves the parent alone while tasks are still open, and when there is no parent", async () => {
    const { deps: d, enqueueWakeup } = deps();
    expect((await enqueueWakesForClosedIssue(d, closedTask)).parentIssueId).toBeNull();

    const orphan = deps();
    await enqueueWakesForClosedIssue(orphan.deps, {
      ...closedTask,
      issue: { id: "task-a", companyId: "company-1", parentId: null },
    });
    expect(orphan.deps.getWakeableParentAfterChildCompletion).not.toHaveBeenCalled();
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("still wakes the parent when a dependent wake fails", async () => {
    const enqueueWakeup = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue is down"))
      .mockResolvedValue({ id: "wake" });
    const log = vi.fn();
    const result = await enqueueWakesForClosedIssue(
      {
        listWakeableBlockedDependents: vi.fn().mockResolvedValue([
          { id: "task-b", assigneeAgentId: "agent-1", blockerIssueIds: ["task-a"], blockedTransitionAt: null },
        ]),
        getWakeableParentAfterChildCompletion: vi.fn().mockResolvedValue({
          id: "conversation-1",
          assigneeAgentId: "agent-1",
          childIssueIds: ["task-a"],
        }),
        enqueueWakeup,
        log,
      },
      closedTask,
    );

    expect(result.dependentIssueIds).toEqual([]);
    expect(result.parentIssueId).toBe("conversation-1");
    expect(log).toHaveBeenCalled();
  });
});
