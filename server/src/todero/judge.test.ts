import { describe, expect, it } from "vitest";
import type { ToderoPlan } from "@todero/shared";
import {
  ACCEPTANCE_CHECK_LIMIT,
  buildAcceptanceChecks,
  buildJudgeComment,
  buildJudgeReviewPrompt,
  buildJudgeSystemPrompt,
  descriptionWithJudgeFailRounds,
  findPlanFeatureForTask,
  findPlanTaskByTitle,
  JUDGE_MAX_FAIL_ROUNDS,
  parseJudgeVerdict,
  planJudgeOutcome,
  readAutoAcceptWhenJudgePasses,
  readJudgeFailRounds,
} from "./judge.js";

const plan: ToderoPlan = {
  goal: "A one-page guide for new collectors.",
  features: [
    { id: "f1", name: "Starter guide", why: "Newcomers bounce", doneWhen: "A reader can start in ten minutes." },
    { id: "f2", name: "Price list", why: "People ask", doneWhen: "Every card has a price." },
  ],
  tasks: [
    { id: "t1", title: "Draft the starter guide", feature: "Starter guide", output: "A one-page draft", after: "" },
    { id: "t2", title: "List the top twenty cards", feature: "Price list", output: "A list with prices", after: "" },
  ],
};

describe("parseJudgeVerdict", () => {
  it("reads the plain shape the reviewer is asked for", () => {
    const parsed = parseJudgeVerdict("VERDICT: pass\nIt covers every step a beginner needs.");
    // No checks were asked for, so there are none to report either way.
    expect(parsed).toEqual({ verdict: "pass", note: "It covers every step a beginner needs.", checks: null });
  });

  it("reads a fail with the paragraph above the line", () => {
    const parsed = parseJudgeVerdict("The prices are missing.\n\nVERDICT: fail\n");
    expect(parsed?.verdict).toBe("fail");
    expect(parsed?.note).toBe("The prices are missing.");
  });

  it("tolerates bold, spacing and synonyms a small model produces", () => {
    expect(parseJudgeVerdict("**VERDICT:** Passed\nGood enough.")?.verdict).toBe("pass");
    expect(parseJudgeVerdict("Verdict - rejected\nNo prices.")?.verdict).toBe("fail");
    expect(parseJudgeVerdict("verdict: APPROVE")?.verdict).toBe("pass");
  });

  it("reads a verdict written inside a sentence", () => {
    const parsed = parseJudgeVerdict("My verdict: fail because the list stops at five cards.");
    expect(parsed?.verdict).toBe("fail");
    expect(parsed?.note).toContain("five cards");
  });

  it("returns null when there is no verdict at all", () => {
    expect(parseJudgeVerdict("Looks fine to me.")).toBeNull();
    expect(parseJudgeVerdict("")).toBeNull();
  });

  it("clips a runaway paragraph", () => {
    const parsed = parseJudgeVerdict(`VERDICT: fail\n${"x".repeat(5_000)}`);
    expect(parsed?.note.length).toBeLessThanOrEqual(1_200);
  });
});

describe("the round counter", () => {
  it("starts at zero and round-trips through the description marker", () => {
    expect(readJudgeFailRounds(null)).toBe(0);
    expect(readJudgeFailRounds("Do the thing.")).toBe(0);
    const once = descriptionWithJudgeFailRounds("Do the thing.", 1);
    expect(once).toContain("<!-- todero-judge-rounds: 1 -->");
    expect(readJudgeFailRounds(once)).toBe(1);
  });

  it("keeps exactly one marker when the count goes up", () => {
    const once = descriptionWithJudgeFailRounds("Do the thing.", 1);
    const twice = descriptionWithJudgeFailRounds(once, 2);
    expect(twice.match(/todero-judge-rounds/g)).toHaveLength(1);
    expect(readJudgeFailRounds(twice)).toBe(2);
    expect(twice).toContain("Do the thing.");
  });

  it("drops the marker at zero", () => {
    const once = descriptionWithJudgeFailRounds("Do the thing.", 1);
    expect(descriptionWithJudgeFailRounds(once, 0)).toBe("Do the thing.");
  });
});

describe("planJudgeOutcome", () => {
  it("accepts a pass when the company accepts for the person", () => {
    expect(planJudgeOutcome({ verdict: "pass", failRounds: 0, autoAcceptWhenJudgePasses: true })).toEqual({
      kind: "accept",
    });
  });

  it("hands a pass to the person when the switch is off", () => {
    expect(planJudgeOutcome({ verdict: "pass", failRounds: 0, autoAcceptWhenJudgePasses: false })).toEqual({
      kind: "handoff",
      because: "passed",
    });
  });

  it("sends a first fail back to the agent", () => {
    expect(planJudgeOutcome({ verdict: "fail", failRounds: 0, autoAcceptWhenJudgePasses: true })).toEqual({
      kind: "revise",
      round: 1,
    });
  });

  it("stops after two failed rounds and hands over to the person", () => {
    expect(planJudgeOutcome({ verdict: "fail", failRounds: 1, autoAcceptWhenJudgePasses: true })).toEqual({
      kind: "handoff",
      because: "rounds_exhausted",
    });
    expect(planJudgeOutcome({ verdict: "fail", failRounds: 7, autoAcceptWhenJudgePasses: false })).toEqual({
      kind: "handoff",
      because: "rounds_exhausted",
    });
    expect(JUDGE_MAX_FAIL_ROUNDS).toBe(2);
  });

  it("never auto-accepts a fail", () => {
    const outcome = planJudgeOutcome({ verdict: "fail", failRounds: 0, autoAcceptWhenJudgePasses: true });
    expect(outcome.kind).not.toBe("accept");
  });

  it("changes nothing when there is no verdict", () => {
    expect(planJudgeOutcome({ verdict: null, failRounds: 0, autoAcceptWhenJudgePasses: true })).toEqual({
      kind: "skip",
    });
  });
});

describe("readAutoAcceptWhenJudgePasses", () => {
  it("is off for a company that never opened the setting", () => {
    expect(readAutoAcceptWhenJudgePasses({})).toBe(false);
    expect(readAutoAcceptWhenJudgePasses(null)).toBe(false);
    expect(readAutoAcceptWhenJudgePasses({ suggest_tasks: { cap: "board_only" } })).toBe(false);
  });

  it("is on only when it was turned on", () => {
    expect(readAutoAcceptWhenJudgePasses({ autoAcceptWhenJudgePasses: true })).toBe(true);
    expect(readAutoAcceptWhenJudgePasses({ autoAcceptWhenJudgePasses: false })).toBe(false);
  });
});

describe("the review prompt", () => {
  it("finds the plan item a task came from and its done-when line", () => {
    const task = findPlanTaskByTitle(plan, "  draft the starter guide ");
    expect(task?.id).toBe("t1");
    expect(findPlanFeatureForTask(plan, task)?.doneWhen).toBe("A reader can start in ten minutes.");
    expect(findPlanTaskByTitle(plan, "Something else")).toBeNull();
  });

  it("carries the done-when line, the asked-for output and the work", () => {
    const prompt = buildJudgeReviewPrompt({
      goal: plan.goal,
      featureName: "Starter guide",
      doneWhen: "A reader can start in ten minutes.",
      taskTitle: "Draft the starter guide",
      expectedOutput: "A one-page draft",
      deliverable: "Here is the guide...",
    });
    expect(prompt).toContain("Done when: A reader can start in ten minutes.");
    expect(prompt).toContain("Was asked to hand in: A one-page draft");
    expect(prompt).toContain("Here is the guide...");
    expect(prompt).toContain("VERDICT: pass");
  });
});

describe("buildJudgeComment", () => {
  it("says what happened in plain words", () => {
    expect(
      buildJudgeComment({ verdict: "pass", note: "It reads well.", outcome: { kind: "accept" } }),
    ).toContain("accepted it");
    expect(
      buildJudgeComment({ verdict: "pass", note: "", outcome: { kind: "handoff", because: "passed" } }),
    ).toContain("ready for you");
    expect(
      buildJudgeComment({ verdict: "fail", note: "Add the prices.", outcome: { kind: "revise", round: 1 } }),
    ).toContain("Add the prices.");
    expect(
      buildJudgeComment({ verdict: "fail", note: "", outcome: { kind: "handoff", because: "rounds_exhausted" } }),
    ).toContain("Over to you");
  });
});

describe("buildJudgeSystemPrompt", () => {
  it("builds the reviewer identity prompt", () => {
    const prompt = buildJudgeSystemPrompt({ judgeName: "Alex", companyName: "Acme" });
    expect(prompt).toContain("You are Alex at Acme, the reviewer");
    expect(prompt).toContain("VERDICT: pass");
    expect(prompt).toContain("VERDICT: fail");
  });

  it("appends skill text when provided", () => {
    const skillText = "## Review Against Done When\n\nCheck that the work meets the done-when line.";
    const prompt = buildJudgeSystemPrompt({
      judgeName: "Alex",
      companyName: "Acme",
      skillText,
    });
    expect(prompt).toContain("You are Alex at Acme, the reviewer");
    expect(prompt).toContain(skillText);
  });

  it("ignores empty or whitespace-only skill text", () => {
    const prompt1 = buildJudgeSystemPrompt({
      judgeName: "Alex",
      companyName: "Acme",
      skillText: "",
    });
    expect(prompt1).not.toContain("\n\n\n");

    const prompt2 = buildJudgeSystemPrompt({
      judgeName: "Alex",
      companyName: "Acme",
      skillText: "   ",
    });
    expect(prompt2).not.toContain("   ");
  });
});

describe("buildAcceptanceChecks", () => {
  it("uses the task's own Acceptance Criteria list when the description has one", () => {
    const checks = buildAcceptanceChecks({
      doneWhen: "A reader can start in ten minutes.",
      expectedOutput: "A one-page draft",
      description: [
        "<!-- todero-type: Task -->",
        "Goal: A one-page guide.",
        "",
        "Acceptance Criteria",
        "- The guide fits on one page",
        "- It names three cards to buy first",
        "",
        "Testing Strategies",
        "- Read it out loud",
      ].join("\n"),
    });
    expect(checks).toEqual(["The guide fits on one page", "It names three cards to buy first"]);
  });

  it("falls back to the done-when and hand-in lines when no list was written", () => {
    const checks = buildAcceptanceChecks({
      doneWhen: "A reader can start in ten minutes.",
      expectedOutput: "A one-page draft",
      description: "Goal: A one-page guide.",
    });
    expect(checks).toEqual([
      "A reader can start in ten minutes.",
      "The hand-in is A one-page draft",
    ]);
  });

  it("drops blanks and duplicates, and caps the list so a small model is not buried", () => {
    const many = ["Acceptance Criteria", ...Array.from({ length: 20 }, (_, i) => `- Item ${i + 1}`)].join("\n");
    const checks = buildAcceptanceChecks({ doneWhen: "", expectedOutput: "", description: many });
    expect(checks).toHaveLength(ACCEPTANCE_CHECK_LIMIT);
    expect(checks[0]).toBe("Item 1");

    const dupes = ["Acceptance Criteria", "- Same thing", "-   ", "- Same thing"].join("\n");
    expect(buildAcceptanceChecks({ doneWhen: "", expectedOutput: "", description: dupes })).toEqual(["Same thing"]);
  });

  it("returns nothing to check when there is nothing written down", () => {
    expect(buildAcceptanceChecks({ doneWhen: "", expectedOutput: "", description: "" })).toEqual([]);
  });
});

describe("the review prompt, with checks", () => {
  it("numbers the checks and asks for one answer each", () => {
    const prompt = buildJudgeReviewPrompt({
      taskTitle: "Draft the starter guide",
      deliverable: "Here is the guide.",
      checks: ["The guide fits on one page", "It names three cards to buy first"],
    });
    expect(prompt).toContain("1. The guide fits on one page");
    expect(prompt).toContain("2. It names three cards to buy first");
    expect(prompt).toContain("1: met");
    expect(prompt).toContain("VERDICT: pass");
  });

  it("is unchanged when there is nothing to check against", () => {
    const prompt = buildJudgeReviewPrompt({
      taskTitle: "Draft the starter guide",
      deliverable: "Here is the guide.",
      checks: [],
    });
    expect(prompt).not.toContain("1: met");
  });
});

describe("parseJudgeVerdict, reading the per-check answers", () => {
  it("reads one answer per check, in order", () => {
    const parsed = parseJudgeVerdict(
      ["1: met", "2: not met", "VERDICT: fail", "The second card list is missing."].join("\n"),
      2,
    );
    expect(parsed?.verdict).toBe("fail");
    expect(parsed?.checks).toEqual([true, false]);
    // The answer lines are bookkeeping, not prose the person should read.
    expect(parsed?.note).toBe("The second card list is missing.");
  });

  it("reports nothing rather than guessing when the reviewer skipped the answers", () => {
    const parsed = parseJudgeVerdict(["VERDICT: pass", "Looks fine to me."].join("\n"), 2);
    expect(parsed?.verdict).toBe("pass");
    expect(parsed?.checks).toBeNull();
  });

  it("reports nothing when the reviewer answered a different number of checks", () => {
    const parsed = parseJudgeVerdict(["1: met", "VERDICT: pass", "Fine."].join("\n"), 3);
    expect(parsed?.checks).toBeNull();
  });
});

describe("buildJudgeComment, showing what was checked", () => {
  const checks = ["The guide fits on one page", "It names three cards to buy first"];

  it("lists each check and how it went", () => {
    const comment = buildJudgeComment({
      verdict: "fail",
      note: "The card list is missing.",
      outcome: { kind: "revise", round: 1 },
      checks,
      checkResults: [true, false],
    });
    expect(comment).toContain("Checked 2 things. 1 met, 1 not met.");
    expect(comment).toContain("- met — The guide fits on one page");
    expect(comment).toContain("- not met — It names three cards to buy first");
    expect(comment).toContain("The card list is missing.");
  });

  it("says so plainly when the reviewer did not answer the checks", () => {
    const comment = buildJudgeComment({
      verdict: "pass",
      note: "Looks fine.",
      outcome: { kind: "handoff", because: "passed" },
      checks,
      checkResults: null,
    });
    expect(comment).toContain("did not say which of the 2 checks it made");
  });

  it("keeps today's wording when the task had nothing written to check", () => {
    const comment = buildJudgeComment({
      verdict: "pass",
      note: "Looks fine.",
      outcome: { kind: "accept" },
      checks: [],
      checkResults: null,
    });
    expect(comment).toContain("I reviewed this and it does what the task asked");
    expect(comment).not.toContain("Checked");
    expect(comment).not.toContain("did not say which");
  });
});
