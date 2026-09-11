import { describe, expect, it } from "vitest";
import type { Issue, IssueComment } from "@todero/shared";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND } from "@todero/shared";
import {
  buildWorkItemActivity,
  isOnboardingFirstTask,
  missionFromFirstTaskDescription,
  systemNoticeItem,
  toWorkItemViewProps,
  workItemTypeFor,
} from "./work-item-adapter";
import { WORK_ITEM_CHOOSABLE_TYPES, WORK_ITEM_TYPES } from "./work-item-model";

describe("onboarding first task on the work-item view", () => {
  it("recognizes the first task by its origin", () => {
    expect(isOnboardingFirstTask({ originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND })).toBe(true);
    expect(isOnboardingFirstTask({ originKind: undefined })).toBe(false);
    expect(isOnboardingFirstTask({ originKind: "plugin:x" })).toBe(false);
  });

  it("lifts the mission out of the conversational brief", () => {
    const description = [
      "You are this company's first agent. This task is a conversation.",
      "",
      "The company mission, as the person typed it:",
      "Track every Pokemon in my Pokemon Go collection and know which ones I am missing.",
      "",
      "Do not ask what the company is for; they already told you.",
    ].join("\n");
    expect(missionFromFirstTaskDescription(description)).toBe(
      "Track every Pokemon in my Pokemon Go collection and know which ones I am missing.",
    );
  });

  it("lifts the mission out of the tool-agent brief too", () => {
    const description = "You are the Todero agent.\n\nCompany mission (from onboarding):\nShip the marketplace.\n\nA greeting has already been posted.";
    expect(missionFromFirstTaskDescription(description)).toBe("Ship the marketplace.");
  });

  it("returns nothing when the brief carries no mission", () => {
    expect(missionFromFirstTaskDescription("You are the Todero agent. Ask what they want.")).toBe("");
    expect(missionFromFirstTaskDescription(null)).toBe("");
  });
});

describe("the type a work item shows", () => {
  it("calls the onboarding conversation a Brief", () => {
    expect(
      workItemTypeFor({
        originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND,
        description: "You are this company's first agent.",
        ancestors: [],
      }),
    ).toBe("Brief");
  });

  it("calls a task from an approved plan a Task, however deep it sits", () => {
    expect(
      workItemTypeFor({
        originKind: "manual",
        description: "<!-- todero-type: Task -->\nGoal: Ship it",
        ancestors: [{ id: "a", identifier: "T-1", title: "Brief" }] as never,
      }),
    ).toBe("Task");
  });

  it("still honours a type somebody chose by hand", () => {
    expect(
      workItemTypeFor({
        originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND,
        description: "<!-- todero-type: Feature -->\nDo the thing",
        ancestors: [],
      }),
    ).toBe("Feature");
  });

  it("falls back to depth for anything unmarked and unplanned", () => {
    expect(workItemTypeFor({ description: "Plain task", ancestors: [] })).toBe("Task");
    expect(
      workItemTypeFor({
        description: "Plain child",
        ancestors: [{ id: "a", identifier: "T-1", title: "Parent" }] as never,
      }),
    ).toBe("Story");
  });
});

function issueFixture(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "TESA-1",
    title: "Ship it",
    description: "Plain body",
    status: "todo",
    priority: "medium",
    createdAt: new Date("2026-09-10T12:00:00.000Z"),
    ancestors: [],
    ...overrides,
  } as unknown as Issue;
}

function viewPropsFor(issue: Issue) {
  return toWorkItemViewProps({
    issue,
    comments: [],
    activity: [],
    agentMap: new Map(),
    userLabelMap: null,
  });
}

describe("who may change the type", () => {
  it("locks the type on the onboarding conversation, the way the body is locked", () => {
    const props = viewPropsFor(
      issueFixture({
        originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND,
        description: "You are this company's first agent.",
      } as Partial<Issue>),
    );
    expect(props.type).toBe("Brief");
    expect(props.typeEditable).toBe(false);
    expect(props.bodyEditable).toBe(false);
  });

  it("leaves the type open on an ordinary task", () => {
    const props = viewPropsFor(issueFixture());
    expect(props.typeEditable).toBe(true);
    expect(props.bodyEditable).toBe(true);
  });

  it("keeps Brief out of the types a person can pick", () => {
    expect(WORK_ITEM_CHOOSABLE_TYPES).toEqual(["Feature", "Story", "Task", "Bug"]);
    expect(WORK_ITEM_TYPES).toContain("Brief");
  });
});

describe("the three markers the turn bar reads", () => {
  it("surfaces a question waiting on the person", () => {
    const props = viewPropsFor(
      issueFixture({ description: "<!-- todero-blocked-by: waiting-on-you -->\nWhich one?" }),
    );
    expect(props.waitingOnYou).toBe(true);
    expect(props.reviewPending).toBe(false);
    expect(props.planPending).toBe(false);
  });

  it("surfaces a hand-in waiting to be accepted", () => {
    const props = viewPropsFor(
      issueFixture({ description: "<!-- todero-review: pending -->\nHanded in." }),
    );
    expect(props.reviewPending).toBe(true);
    expect(props.waitingOnYou).toBe(false);
  });

  it("surfaces a plan waiting for a yes", () => {
    const props = viewPropsFor(
      issueFixture({ description: "<!-- todero-plan: pending -->\nHere is the plan." }),
    );
    expect(props.planPending).toBe(true);
    expect(props.waitingOnYou).toBe(false);
  });

  it("leaves all three off on a plain task", () => {
    const props = viewPropsFor(issueFixture());
    expect(props.waitingOnYou).toBe(false);
    expect(props.reviewPending).toBe(false);
    expect(props.planPending).toBe(false);
  });
});

describe("notices the product posted", () => {
  const commentFixture = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "c1",
      companyId: "co",
      issueId: "i1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Recovery attempt failed.\n\nCause: recovery_issue_failed",
      presentation: null,
      metadata: null,
      createdAt: new Date("2026-09-11T10:00:00Z"),
      updatedAt: new Date("2026-09-11T10:00:00Z"),
      ...overrides,
    }) as unknown as IssueComment;

  it("leaves a person's reply and an agent's reply alone", () => {
    expect(systemNoticeItem(commentFixture({ authorType: "user", authorUserId: "u1" }))).toBeNull();
    expect(systemNoticeItem(commentFixture({ authorType: "agent", authorAgentId: "a1" }))).toBeNull();
  });

  it("turns a posted notice into one machinery line, not anyone's words", () => {
    const item = systemNoticeItem(commentFixture());
    expect(item?.kind).toBe("system");
    expect(item?.text).toBe("Recovery attempt failed.");
    expect(item?.tone).toBeUndefined();
  });

  it("keeps a recovery notice's warning tone", () => {
    const item = systemNoticeItem(
      commentFixture({
        presentation: { kind: "system_notice", tone: "warning", title: "Recovery: it came back blocked" },
      }),
    );
    expect(item?.text).toBe("Recovery: it came back blocked");
    expect(item?.tone).toBe("warning");
  });

  it("treats a danger notice as a warning too", () => {
    const item = systemNoticeItem(
      commentFixture({ presentation: { kind: "system_notice", tone: "danger", title: "It stopped" } }),
    );
    expect(item?.tone).toBe("warning");
  });

  it("takes a notice posted under a name at its presentation's word", () => {
    const item = systemNoticeItem(
      commentFixture({
        authorType: "user",
        authorUserId: "u1",
        presentation: { kind: "system_notice", tone: "info", title: "Moved by the board" },
      }),
    );
    expect(item?.kind).toBe("system");
    expect(item?.tone).toBeUndefined();
  });

  it("never draws a posted notice as the person's own reply", () => {
    const items = buildWorkItemActivity({
      comments: [commentFixture()],
      activity: [],
      agentMap: new Map(),
      userLabelMap: null,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("system");
  });
});
