import { describe, expect, it, vi } from "vitest";

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(async (companyId: string, data: Record<string, unknown>) => ({ id: "approval-1", companyId, ...data })),
}));
vi.mock("../services/approvals.js", () => ({ approvalService: () => mockApprovalService }));

const { buildPendingHireComment, readRequireBoardApprovalForNewAgents, requestHireApproval } = await import(
  "./plan-hire-approval.js"
);

function fakeDb(require: boolean | null) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ require }] }) }) }),
  } as never;
}

describe("readRequireBoardApprovalForNewAgents", () => {
  it("is true only when the organization asked for it", async () => {
    await expect(readRequireBoardApprovalForNewAgents(fakeDb(true), "company-1")).resolves.toBe(true);
    await expect(readRequireBoardApprovalForNewAgents(fakeDb(false), "company-1")).resolves.toBe(false);
    await expect(readRequireBoardApprovalForNewAgents(fakeDb(null), "company-1")).resolves.toBe(false);
  });
});

describe("requestHireApproval", () => {
  it("asks in the same shape a person's own hire does", async () => {
    await requestHireApproval(fakeDb(true), {
      companyId: "company-1",
      agent: { id: "agent-2", name: "Ash's reviewer", adapterType: "http", adapterConfig: { model: "qwen" } },
      requestedByUserId: "person-1",
    });
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        status: "pending",
        requestedByUserId: "person-1",
        payload: expect.objectContaining({ agentId: "agent-2", name: "Ash's reviewer" }),
      }),
    );
  });
});

describe("buildPendingHireComment", () => {
  it("names one teammate", () => {
    expect(buildPendingHireComment(["Ash's reviewer"])).toBe(
      "Ash's reviewer waits for your approval in the Inbox before starting.",
    );
  });

  it("names two", () => {
    expect(buildPendingHireComment(["Ash's reviewer", "Ash 2"])).toBe(
      "Ash's reviewer and Ash 2 wait for your approval in the Inbox before starting.",
    );
  });

  it("says nothing when nothing waits", () => {
    expect(buildPendingHireComment([])).toBe("");
    expect(buildPendingHireComment([" "])).toBe("");
  });

  /** Plain words only: this line is read by a person on the task. */
  it("uses none of the words a person never sees", () => {
    const body = buildPendingHireComment(["Ash's reviewer", "Ash 2"]).toLowerCase();
    for (const forbidden of ["issue", "disposition", "handoff", "run", "wake", "heartbeat"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
