import { describe, expect, it } from "vitest";
import { REVIEW_PENDING_MARKER } from "./conversation-outcome.js";
import { isWaitingOnPersonToAccept, routePersonComment } from "./manager-person-comment.js";

describe("routePersonComment", () => {
  const base = {
    managerMode: true,
    parentIssueId: "conv-1",
    reviewPending: false,
    assigneeIsManager: false,
  };

  it("changes nothing before the organization has a worker", () => {
    expect(routePersonComment({ ...base, managerMode: false, reviewPending: true })).toBe("none");
  });

  it("changes nothing on the conversation task itself", () => {
    expect(routePersonComment({ ...base, parentIssueId: null, reviewPending: true })).toBe("none");
  });

  it("changes nothing on a task the manager already holds", () => {
    expect(routePersonComment({ ...base, assigneeIsManager: true, reviewPending: true })).toBe("none");
  });

  it("sends a task the person sent back to the manager first", () => {
    expect(routePersonComment({ ...base, reviewPending: true })).toBe("manager_sendback");
  });

  it("leaves a question with the worker and copies the manager", () => {
    expect(routePersonComment(base)).toBe("copy_manager");
  });
});

describe("isWaitingOnPersonToAccept", () => {
  it("is true while the task sits in front of the person", () => {
    expect(isWaitingOnPersonToAccept(`${REVIEW_PENDING_MARKER}\nDraft the guide.`)).toBe(true);
  });

  it("is false otherwise", () => {
    expect(isWaitingOnPersonToAccept("Draft the guide.")).toBe(false);
    expect(isWaitingOnPersonToAccept(null)).toBe(false);
    expect(isWaitingOnPersonToAccept(undefined)).toBe(false);
  });
});
