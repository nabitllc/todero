// What the reviewer is told about the work the rest of the feature already
// finished, and about a line no plain-text hand-in can show.
//
// Wave 5 of the improvement loop. The last task of a feature was being refused
// for two things that were never its to do: work an earlier task in the same
// feature had already handed in and had accepted, and a line about packaging
// ("formatted and ready for distribution") that a text reply cannot display.
import { describe, expect, it } from "vitest";
import { parseToderoPlanBlock } from "@todero/shared";
import {
  acceptedWorkOfSameFeature,
  buildAcceptanceChecks,
  buildJudgeComment,
  buildJudgeReviewPrompt,
} from "./judge.js";
import { checksAlreadyDone, namesPackaging } from "./judge-feature-work.js";

const PLAN = parseToderoPlanBlock(
  [
    "```todero-plan",
    "goal: Publish four guides.",
    "features:",
    "  - name: Research",
    "    why: To know what to write about.",
    "    done_when: A list of four plants.",
    "  - name: Review and Editing",
    "    why: To make the guides read well.",
    "    done_when: All four guides have been reviewed and edited, with final drafts ready for publishing",
    "tasks:",
    "  - title: Pick the plants",
    "    feature: Research",
    "    output: A list of four plant names.",
    "  - title: Review and edit the draft guides",
    "    feature: Review and Editing",
    "    output: Four final, edited one-page guides.",
    "    after: Pick the plants",
    "  - title: Prepare the guides for publishing",
    "    feature: Review and Editing",
    "    output: The final guides formatted and ready for distribution.",
    "    after: Review and edit the draft guides",
    "```",
  ].join("\n"),
)?.plan ?? null;

const DONE_WHEN = "All four guides have been reviewed and edited, with final drafts ready for publishing";

describe("a line about packaging that a text hand-in cannot show", () => {
  it("knows the shapes it was told about", () => {
    for (const line of [
      "The final guides formatted and ready for distribution.",
      "All four guides reviewed and edited, with final drafts ready for publishing",
      "A one-page guide, laid out and ready for release",
      "The guide exported as a single page",
      "Four finalized and formatted one-page guides ready for distribution.",
      "The report, print-ready",
    ]) {
      expect(namesPackaging(line)).toBe(true);
    }
  });

  it("leaves every other line alone", () => {
    for (const line of [
      "The guide names the plant",
      "A list of four plant names with their light and water needs.",
      "Four one-page draft guides, each naming the plant and how often to water it.",
      "",
      null,
    ]) {
      expect(namesPackaging(line)).toBe(false);
    }
  });
});

describe("the work the rest of the feature already finished", () => {
  const predecessor = (over: Partial<{ identifier: string; title: string; body: string; status: string }> = {}) => ({
    identifier: "ZZ-4",
    title: "Review and edit the draft guides",
    body: "Sansevieria: low light, water when dry.",
    status: "done",
    ...over,
  });

  it("keeps a finished task of the same feature", () => {
    expect(
      acceptedWorkOfSameFeature({
        plan: PLAN,
        featureName: "Review and Editing",
        predecessors: [predecessor()],
      }),
    ).toEqual([
      {
        identifier: "ZZ-4",
        title: "Review and edit the draft guides",
        output: "Sansevieria: low light, water when dry.",
      },
    ]);
  });

  it("drops a task of another feature, one still running, and one that handed in nothing", () => {
    expect(
      acceptedWorkOfSameFeature({
        plan: PLAN,
        featureName: "Review and Editing",
        predecessors: [
          predecessor({ identifier: "ZZ-2", title: "Pick the plants" }),
          predecessor({ identifier: "ZZ-4", status: "in_progress" }),
          predecessor({ identifier: "ZZ-4", body: "   " }),
        ],
      }),
    ).toEqual([]);
  });

  it("has nothing to say when the task is in no feature", () => {
    expect(acceptedWorkOfSameFeature({ plan: PLAN, featureName: null, predecessors: [predecessor()] })).toEqual([]);
  });
});

describe("which checks an earlier accepted task already settled", () => {
  const checks = buildAcceptanceChecks({
    doneWhen: DONE_WHEN,
    expectedOutput: "The final guides formatted and ready for distribution.",
    description: "<!-- todero-type: Task -->\nPrepare the guides.",
    isLastTaskOfFeature: true,
  });

  it("marks the feature's finish line and nothing else", () => {
    expect(checks).toHaveLength(2);
    expect(
      checksAlreadyDone({
        checks,
        doneWhen: DONE_WHEN,
        acceptedWork: [{ identifier: "ZZ-4", title: "Review and edit the draft guides", output: "the guides" }],
      }),
    ).toEqual(["ZZ-4", null]);
  });

  it("marks nothing when no earlier task of the feature was accepted", () => {
    expect(checksAlreadyDone({ checks, doneWhen: DONE_WHEN, acceptedWork: [] })).toEqual([null, null]);
  });
});

describe("the reviewer's brief", () => {
  const base = {
    goal: "Publish four guides.",
    featureName: "Review and Editing",
    doneWhen: DONE_WHEN,
    taskTitle: "Prepare the guides for publishing",
    expectedOutput: "The final guides formatted and ready for distribution.",
    deliverable: "Sansevieria: low light. ZZ Plant: low light. Pothos: low light. Spider Plant: low light.",
    isLastTaskOfFeature: true,
  };

  it("names the earlier accepted task and says its work counts as done", () => {
    const prompt = buildJudgeReviewPrompt({
      ...base,
      checks: buildAcceptanceChecks({ doneWhen: DONE_WHEN, expectedOutput: base.expectedOutput }),
      acceptedWork: [
        { identifier: "ZZ-4", title: "Review and edit the draft guides", output: "The four edited guides." },
      ],
    });
    expect(prompt).toContain("ZZ-4 — Review and edit the draft guides");
    expect(prompt).toContain("The four edited guides.");
    expect(prompt).toContain("counts as done");
  });

  it("says a plain-text hand-in cannot show how the work is laid out", () => {
    const prompt = buildJudgeReviewPrompt({ ...base, checks: [] });
    expect(prompt).toContain("cannot show how");
  });

  it("is what it is today for a task with no earlier work and no packaging line", () => {
    const plain = {
      goal: "Publish four guides.",
      featureName: "Review and Editing",
      doneWhen: "Four reviewed guides",
      taskTitle: "Review and edit the draft guides",
      expectedOutput: "Four final, edited one-page guides.",
      deliverable: "Sansevieria: low light.",
      isLastTaskOfFeature: false,
      checks: ["The hand-in is Four final, edited one-page guides."],
    };
    expect(buildJudgeReviewPrompt({ ...plain, acceptedWork: [] })).toBe(buildJudgeReviewPrompt(plain));
    expect(buildJudgeReviewPrompt(plain)).not.toContain("counts as done");
    expect(buildJudgeReviewPrompt(plain)).not.toContain("cannot show how");
  });
});

describe("the verdict comment", () => {
  // Wave 20's own comment, replayed: organization 42c3d5e4, task
  // ZZGAAAAAAAAAAA-5. The reviewer answered no to both lines and wrote "have
  // not been reviewed or edited" underneath. The count above has to say the
  // same thing the reviewer said, and who already did the work is a note on
  // the line rather than an answer of its own.
  it("counts only what the reviewer itself answered", () => {
    const comment = buildJudgeComment({
      verdict: "fail",
      note: "The guides are in plain text format and have not been reviewed or edited.",
      outcome: { kind: "revise", round: 1 },
      checks: [DONE_WHEN, "The hand-in is The final guides formatted and ready for distribution."],
      checkResults: [false, false],
      checkAlreadyDone: ["ZZGAAAAAAAAAAA-4", null],
    });
    expect(comment).toContain("0 met, 2 not met");
    expect(comment).toContain(
      `- not met (already done on ZZGAAAAAAAAAAA-4 and accepted) — ${DONE_WHEN}`,
    );
    expect(comment).not.toContain("- met — done on");
  });

  it("leaves a met line reading met, with the note only where something earlier settled it", () => {
    const comment = buildJudgeComment({
      verdict: "pass",
      note: "The four guides are all there and read well.",
      outcome: { kind: "accept" },
      checks: [DONE_WHEN, "The hand-in is The final guides formatted and ready for distribution."],
      checkResults: [true, true],
      checkAlreadyDone: ["ZZGAAAAAAAAAAA-4", null],
    });
    expect(comment).toContain("2 met, 0 not met");
    expect(comment).toContain(
      `- met (already done on ZZGAAAAAAAAAAA-4 and accepted) — ${DONE_WHEN}`,
    );
    expect(comment).toContain(
      "- met — The hand-in is The final guides formatted and ready for distribution.",
    );
  });

  it("is unchanged when nothing earlier settled anything", () => {
    const of = (checkAlreadyDone?: (string | null)[]) =>
      buildJudgeComment({
        verdict: "fail",
        note: "One guide is missing.",
        outcome: { kind: "revise", round: 1 },
        checks: [DONE_WHEN],
        checkResults: [false],
        ...(checkAlreadyDone ? { checkAlreadyDone } : {}),
      });
    expect(of([null])).toBe(of());
    expect(of()).toContain("0 met, 1 not met");
  });
});
