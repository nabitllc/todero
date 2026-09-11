import { describe, expect, it } from "vitest";
import type { Agent, HeartbeatRun, Issue } from "@todero/shared";
import {
  inFlightRows,
  queuedRows,
  readReviewerRounds,
  recommendationRows,
} from "./paused-card-model";

const PAUSED_AT = new Date("2026-09-10T10:42:00Z");

function issue(partial: Partial<Issue> & { identifier: string }): Issue {
  return {
    id: partial.identifier,
    title: `Task ${partial.identifier}`,
    description: "",
    status: "todo",
    assigneeAgentId: "agent-1",
    updatedAt: new Date("2026-09-10T10:00:00Z"),
    createdAt: new Date("2026-09-10T10:00:00Z"),
    ...partial,
  } as unknown as Issue;
}

function run(partial: Partial<HeartbeatRun> & { id: string }): HeartbeatRun {
  return {
    agentId: "agent-1",
    status: "running",
    startedAt: new Date("2026-09-10T10:30:00Z"),
    createdAt: new Date("2026-09-10T10:30:00Z"),
    finishedAt: null,
    contextSnapshot: null,
    ...partial,
  } as unknown as HeartbeatRun;
}

function agent(partial: Partial<Agent> & { id: string; name: string }): Agent {
  return { budgetMonthlyCents: 0, spentMonthlyCents: 0, ...partial } as unknown as Agent;
}

describe("inFlightRows", () => {
  it("keeps what was going at the pause, including what has finished since", () => {
    const rows = inFlightRows(
      [
        run({ id: "still-going", contextSnapshot: { issueId: "T-1" } }),
        run({
          id: "finished-after-the-pause",
          status: "succeeded",
          finishedAt: new Date("2026-09-10T10:50:00Z"),
        }),
        run({
          id: "finished-before-the-pause",
          status: "succeeded",
          finishedAt: new Date("2026-09-10T10:35:00Z"),
        }),
        run({
          id: "started-after-the-pause",
          startedAt: new Date("2026-09-10T10:45:00Z"),
          createdAt: new Date("2026-09-10T10:45:00Z"),
        }),
        run({ id: "never-started", status: "queued", startedAt: null, createdAt: new Date("2026-09-10T10:45:00Z") }),
      ],
      PAUSED_AT,
    );
    expect(rows.map((row) => [row.id, row.finished, row.issueId])).toEqual([
      ["still-going", false, "T-1"],
      ["finished-after-the-pause", true, null],
    ]);
  });

  it("shows nothing when the organization is not paused", () => {
    expect(inFlightRows([run({ id: "r1" })], null)).toEqual([]);
  });
});

describe("queuedRows", () => {
  it("puts what can start now first, then what waits, and leaves out everything else", () => {
    const rows = queuedRows([
      issue({ identifier: "T-2" }),
      issue({
        identifier: "T-3",
        status: "blocked",
        blockedBy: [{ id: "T-1", identifier: "T-1", status: "todo" }],
      } as Partial<Issue> & { identifier: string }),
      issue({ identifier: "T-1" }),
      // Blocked on the person, not on another task: the Waiting on you list owns it.
      issue({
        identifier: "T-4",
        status: "blocked",
        description: "<!-- todero-blocked-by: waiting-on-you -->\nanswer me",
        blockedBy: [],
      } as Partial<Issue> & { identifier: string }),
      issue({ identifier: "T-5", status: "done" }),
      // Nobody is going to pick this one up on Play.
      issue({ identifier: "T-6", assigneeAgentId: null }),
      // A blocker that is already finished does not hold anything back.
      issue({
        identifier: "T-7",
        status: "blocked",
        blockedBy: [{ id: "T-1", identifier: "T-1", status: "done" }],
      } as Partial<Issue> & { identifier: string }),
    ]);
    expect(rows.map((row) => [row.identifier, row.blockers])).toEqual([
      ["T-1", []],
      ["T-2", []],
      ["T-7", []],
      ["T-3", ["T-1"]],
    ]);
  });
});

describe("readReviewerRounds", () => {
  it("reads the highest round the reviewer recorded", () => {
    expect(readReviewerRounds("<!-- todero-judge-rounds: 2 -->\nbody")).toBe(2);
    expect(readReviewerRounds("no marker")).toBe(0);
    expect(readReviewerRounds(null)).toBe(0);
  });
});

describe("recommendationRows", () => {
  it("computes all four kinds, each pointed at its task or agent", () => {
    const rows = recommendationRows({
      issues: [
        issue({ identifier: "T-1", description: "<!-- todero-judge-rounds: 2 -->\nx" }),
        // Unblocked and untouched since well before the pause.
        issue({ identifier: "T-2", updatedAt: new Date("2026-09-10T09:00:00Z") }),
        // Touched a moment before the pause: not waiting too long yet.
        issue({ identifier: "T-3", updatedAt: new Date("2026-09-10T10:41:30Z") }),
      ],
      agents: [
        agent({ id: "a1", name: "Ada", budgetMonthlyCents: 1000, spentMonthlyCents: 1000 }),
        agent({ id: "a2", name: "Grace", budgetMonthlyCents: 1000, spentMonthlyCents: 10 }),
        agent({ id: "a3", name: "No budget", budgetMonthlyCents: 0, spentMonthlyCents: 500 }),
      ],
      nextSuggestions: [{ issue: issue({ identifier: "T-9", status: "done" }), nextProjectName: "a billing page" }],
      pausedAt: PAUSED_AT,
    });
    expect(rows.map((row) => [row.kind, row.target])).toEqual([
      ["reviewer", { kind: "issue", identifier: "T-1" }],
      ["waiting", { kind: "issue", identifier: "T-2" }],
      ["next", { kind: "issue", identifier: "T-9" }],
      ["budget", { kind: "agent", agentId: "a1", name: "Ada" }],
    ]);
    expect(rows[2]?.label).toContain("a billing page");
  });

  it("says nothing about waiting time when the organization is not paused", () => {
    const rows = recommendationRows({
      issues: [issue({ identifier: "T-2", updatedAt: new Date("2026-09-10T09:00:00Z") })],
      agents: [],
      nextSuggestions: [],
      pausedAt: null,
    });
    expect(rows).toEqual([]);
  });
});
