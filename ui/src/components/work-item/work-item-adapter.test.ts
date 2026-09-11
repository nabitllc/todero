import { describe, expect, it } from "vitest";
import type { Issue } from "@todero/shared";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND } from "@todero/shared";
import {
  isOnboardingFirstTask,
  missionFromFirstTaskDescription,
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
    projects: [],
    costSummary: null,
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
