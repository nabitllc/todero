import { describe, expect, it } from "vitest";
import {
  assignTasksByRule,
  buildManagerAssignedComment,
  buildManagerSendbackInstruction,
  buildPersonWroteLine,
  buildReviewVerdictLine,
  resolveManagerAssignments,
  taskLabel,
} from "./manager-wave.js";

describe("assignTasksByRule", () => {
  const tasks = [
    { id: "t1", feature: "Sign up" },
    { id: "t2", feature: "Sign up" },
    { id: "t3", feature: "Pick a dinner" },
    { id: "t4", feature: "Invite" },
  ];

  it("gives everything to the only worker", () => {
    const assigned = assignTasksByRule(tasks, [{ id: "w1", name: "Ash" }]);
    expect([...assigned.values()]).toEqual(["w1", "w1", "w1", "w1"]);
  });

  it("keeps one feature with one worker and balances by count", () => {
    const assigned = assignTasksByRule(tasks, [
      { id: "w1", name: "Ash" },
      { id: "w2", name: "Nova" },
    ]);
    expect(assigned.get("t1")).toBe("w1");
    expect(assigned.get("t2")).toBe("w1");
    // Ash is carrying two, so the next feature goes to Nova.
    expect(assigned.get("t3")).toBe("w2");
    // Nova is carrying one and Ash two, so Nova takes the third feature too.
    expect(assigned.get("t4")).toBe("w2");
  });

  it("gives a task that names no feature its own bucket", () => {
    const assigned = assignTasksByRule(
      [
        { id: "a", feature: "" },
        { id: "b", feature: "   " },
      ],
      [
        { id: "w1", name: "Ash" },
        { id: "w2", name: "Nova" },
      ],
    );
    expect(assigned.get("a")).toBe("w1");
    expect(assigned.get("b")).toBe("w2");
  });

  it("matches a feature whatever its capitals", () => {
    const assigned = assignTasksByRule(
      [
        { id: "a", feature: "Sign up" },
        { id: "b", feature: "SIGN UP" },
      ],
      [
        { id: "w1", name: "Ash" },
        { id: "w2", name: "Nova" },
      ],
    );
    expect(assigned.get("a")).toBe(assigned.get("b"));
  });

  it("assigns nothing when there is no team", () => {
    expect(assignTasksByRule(tasks, []).size).toBe(0);
  });
});

describe("resolveManagerAssignments", () => {
  const managerId = "manager-1";
  const tasks = [
    { id: "t1", identifier: "ZZW-1", title: "Draft the guide", assigneeAgentId: "w1" },
    { id: "t2", identifier: "ZZW-2", title: "List the prices", assigneeAgentId: "w1" },
  ];
  const workers = [
    { id: "w1", name: "Ash" },
    { id: "w2", name: "Nova" },
  ];

  it("moves the tasks the manager named", () => {
    const reply = ["assignments:", "- ZZW-1: Ash", "- ZZW-2: Nova", "", "STATUS: done"].join("\n");
    expect(resolveManagerAssignments(managerId, reply, tasks, workers)).toEqual([
      { taskId: "t1", assigneeAgentId: "w1", assignedByManagerId: managerId },
      { taskId: "t2", assigneeAgentId: "w2", assignedByManagerId: managerId },
    ]);
  });

  it("reads a fenced block and matches titles and capitals", () => {
    const reply = [
      "Here you go.",
      "```",
      "assignments:",
      "- draft the guide: NOVA",
      "```",
      "STATUS: done",
    ].join("\n");
    const resolved = resolveManagerAssignments(managerId, reply, tasks, workers);
    expect(resolved[0]).toEqual({ taskId: "t1", assigneeAgentId: "w2", assignedByManagerId: managerId });
  });

  it("leaves the rule's choice standing for a task the manager did not name", () => {
    const reply = ["assignments:", "- ZZW-1: Nova", "", "STATUS: done"].join("\n");
    const resolved = resolveManagerAssignments(managerId, reply, tasks, workers);
    expect(resolved[0]!.assigneeAgentId).toBe("w2");
    expect(resolved[1]).toEqual({ taskId: "t2", assigneeAgentId: "w1", assignedByManagerId: null });
  });

  it("leaves the rule's choice standing for a name nobody on the team has", () => {
    const reply = ["assignments:", "- ZZW-1: Somebody Else", "STATUS: done"].join("\n");
    const resolved = resolveManagerAssignments(managerId, reply, tasks, workers);
    expect(resolved[0]).toEqual({ taskId: "t1", assigneeAgentId: "w1", assignedByManagerId: null });
  });

  it("changes nothing when the reply has no block at all", () => {
    const resolved = resolveManagerAssignments(managerId, "I will handle it myself. STATUS: done", tasks, workers);
    expect(resolved.every((entry) => entry.assignedByManagerId === null)).toBe(true);
    expect(resolved.map((entry) => entry.assigneeAgentId)).toEqual(["w1", "w1"]);
  });

  it("changes nothing on an empty reply", () => {
    const resolved = resolveManagerAssignments(managerId, "", tasks, workers);
    expect(resolved.map((entry) => entry.assigneeAgentId)).toEqual(["w1", "w1"]);
  });
});

describe("taskLabel", () => {
  it("puts the short name in front of the title", () => {
    expect(taskLabel({ identifier: "ZZW-1", title: "Draft the guide" })).toBe("ZZW-1 — Draft the guide");
  });

  it("falls back to the title alone", () => {
    expect(taskLabel({ identifier: null, title: "Draft the guide" })).toBe("Draft the guide");
    expect(taskLabel({ identifier: "  ", title: "Draft the guide" })).toBe("Draft the guide");
  });
});

describe("buildManagerAssignedComment", () => {
  const rows = [
    { identifier: "ZZW-1", title: "Draft the guide", workerName: "Ash" },
    { identifier: "ZZW-2", title: "List the prices", workerName: "Nova" },
  ];

  it("says who has what when the manager named them", () => {
    const body = buildManagerAssignedComment(rows, { managerNamedThem: true });
    expect(body).toContain("ZZW-1 — Draft the guide → Ash");
    expect(body).toContain("ZZW-2 — List the prices → Nova");
    expect(body).not.toContain("rule");
  });

  it("says so when the usual rule shared them out", () => {
    expect(buildManagerAssignedComment(rows, { managerNamedThem: false })).toContain("usual rule");
  });
});

describe("buildReviewVerdictLine", () => {
  const task = { identifier: "ZZW-1", title: "Draft the guide" };

  it("is one line for a pass", () => {
    expect(buildReviewVerdictLine({ ...task, verdict: "passed" })).toBe(
      "ZZW-1 — Draft the guide: the reviewer passed it.",
    );
  });

  it("is one line for the first send-back", () => {
    expect(buildReviewVerdictLine({ ...task, verdict: "sent-back", round: 1 })).toBe(
      "ZZW-1 — Draft the guide: the reviewer sent it back.",
    );
  });

  it("names the manager on the second send-back", () => {
    expect(buildReviewVerdictLine({ ...task, verdict: "sent-back", round: 2, managerName: "Nova" })).toContain(
      "Nova is rewriting the brief",
    );
  });

  it("leaves the manager out when there is none", () => {
    expect(buildReviewVerdictLine({ ...task, verdict: "sent-back", round: 2 })).toBe(
      "ZZW-1 — Draft the guide: the reviewer sent it back again.",
    );
  });
});

describe("buildPersonWroteLine", () => {
  it("copies the manager in one line", () => {
    expect(buildPersonWroteLine({ identifier: "ZZW-2", title: "List the prices" })).toBe(
      "The person wrote on ZZW-2 — List the prices.",
    );
  });
});

describe("buildManagerSendbackInstruction", () => {
  const task = { identifier: "ZZW-1", title: "Draft the guide" };

  it("asks for one paragraph and the usual ending", () => {
    const instruction = buildManagerSendbackInstruction({
      ...task,
      reason: "reviewer_fail",
      workerNames: ["Ash", "Nova"],
    });
    expect(instruction).toContain("The reviewer sent ZZW-1 — Draft the guide back a second time.");
    expect(instruction).toContain("one short paragraph");
    expect(instruction).toContain("STATUS: done");
    expect(instruction).toContain("assignments:");
    expect(instruction).toContain("Ash, Nova");
  });

  it("says it was the person, and passes on what they wrote", () => {
    const instruction = buildManagerSendbackInstruction({
      ...task,
      reason: "person_sendback",
      note: "The prices are out of date.",
      workerNames: [],
    });
    expect(instruction).toContain("The person sent ZZW-1 — Draft the guide back.");
    expect(instruction).toContain("The prices are out of date.");
    // With nobody to move it to, the shape is not offered.
    expect(instruction).not.toContain("assignments:");
  });
});
