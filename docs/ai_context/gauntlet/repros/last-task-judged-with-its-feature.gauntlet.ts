// Repro — wave 5 of the improvement loop: the last task of a feature is judged
// with what the rest of that feature already achieved, and a line about
// packaging is judged on substance.
//
// Observed in wave 20 (2026-09-21), organization "Zz Gauntlet Org 0921-092802"
// (42c3d5e4-f0fd-4aea-ae98-32e90707d31f). The feature "Review and Editing" has
// two tasks. ZZGAAAAAAAAAAA-4 "Review and edit the draft guides" handed in the
// four edited guides and was accepted, and closed. ZZGAAAAAAAAAAA-5 "Prepare
// the guides for publishing" handed in those same four guides, twice, and the
// reviewer refused both:
//
//   - not met — All four guides have been reviewed and edited, with final
//     drafts ready for publishing.
//   - not met — The hand-in is The final guides formatted and ready for
//     distribution.
//   "... it has not been reviewed and edited ... The guides are in plain text
//    format and have not been reviewed or edited to ensure they are ready for
//    publishing."
//   then: "I reviewed this twice and it is still not there. Over to you."
//
// Two things were wrong with what the reviewer was given.
//
//   The "reviewed and edited" half of that line is work ZZGAAAAAAAAAAA-4 had
//   already done and had accepted, and the reviewer was never told that task
//   exists, let alone what it handed in. It sees one hand-in and the whole
//   feature's finish line.
//
//   "Formatted and ready for distribution" is about how the text would be laid
//   out on a page. A chat reply cannot show that at all, so a 14B reviewer
//   reads plain prose and answers "not formatted" every single time.
//
// The plan below is the real approved plan of that organization, copied whole
// from its Plan document (issue db48a20d-fc12-4790-b101-6456d180108f, key
// "plan"), and the work below is the real Output document of
// ZZGAAAAAAAAAAA-4 (issue 9f38e2b8-6799-4998-adf4-54bb6003204f, key "output").
// Nothing here asks a model anything: it builds the brief and reads it.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/last-task-judged-with-its-feature.gauntlet.ts
//
// Fails on origin/main, where the reviewer is told neither of those two things.
import { describe, expect, it } from "vitest";
import { parseToderoPlanBlock } from "../../../../packages/shared/src/todero-plan.js";
import {
  acceptedWorkOfSameFeature,
  buildAcceptanceChecks,
  buildJudgeComment,
  buildJudgeReviewPrompt,
  findPlanFeatureForTask,
  findPlanTaskByTitle,
  isLastTaskOfFeature,
} from "../../../../server/src/todero/judge.js";
import {
  checksAlreadyDone,
  namesPackaging,
} from "../../../../server/src/todero/judge-feature-work.js";

/** The approved plan of 42c3d5e4, as its Plan document holds it. */
const PLAN_DOCUMENT = [
  "```todero-plan",
  "goal: Publish a one-page guide to each of four houseplants that survive a dark flat for the end-user.",
  "features:",
  "  - name: Research and Content Creation",
  "    why: To gather accurate information about the plants and their care requirements.",
  "    done_when: The research is complete, and a draft for each guide is ready.",
  "  - name: Review and Editing",
  "    why: To ensure the content is clear, concise, and meets the requirements.",
  "    done_when: All four guides have been reviewed and edited, with final drafts ready for publishing.",
  "tasks:",
  "  - title: Identify and select four houseplants that survive in a dark flat",
  "    feature: Research and Content Creation",
  "    output: A list of four plant names with brief descriptions of their light and water needs.",
  "  - title: Write initial drafts for each plant guide",
  "    feature: Research and Content Creation",
  "    output: Four one-page draft guides, each naming the plant, the light it needs, and how often to water it.",
  "    after: Identify and select four houseplants that survive in a dark flat",
  "  - title: Review and edit the draft guides",
  "    feature: Review and Editing",
  "    output: Four final, edited one-page guides.",
  "    after: Write initial drafts for each plant guide",
  "  - title: Prepare the guides for publishing",
  "    feature: Review and Editing",
  "    output: The final guides formatted and ready for distribution.",
  "    after: Review and edit the draft guides",
  "```",
].join("\n");

const DONE_WHEN = "All four guides have been reviewed and edited, with final drafts ready for publishing.";

/** The Output document of ZZGAAAAAAAAAAA-4, the task that was accepted. */
const EDITED_GUIDES = [
  "**Sansevieria Guide:**",
  "Sansevieria, also known as snake plant, is an excellent choice for a dark flat. It thrives in low light conditions and requires minimal water. Allow the soil to dry out completely between waterings, and avoid overwatering, which can lead to root rot.",
  "",
  "**ZZ Plant Guide:**",
  "ZZ Plant is highly adaptable and can survive in low to medium light conditions. It prefers well-draining soil and should be watered when the top inch of soil is dry. Overwatering can cause the plant to turn yellow, so it's crucial to let the soil dry out before watering again.",
  "",
  "**Pothos Guide:**",
  "Pothos is a versatile plant that can thrive in medium to low light. Water it when the top inch of soil is dry, ensuring the soil is moist but not waterlogged. Pothos is forgiving and can withstand periods of drought, making it ideal for low-light environments.",
  "",
  "**Spider Plant Guide:**",
  "Spider Plant can adapt to medium to low light conditions. Water it when the soil is slightly dry, allowing the top inch to dry out before watering again. This plant is known for its ability to tolerate low light and occasional neglect.",
].join("\n");

/** What ZZGAAAAAAAAAAA-5 handed in, and what the reviewer refused twice. */
const HANDED_IN = `${EDITED_GUIDES}\n\nThis plant is also known for its ability to improve indoor air quality.`;

const plan = parseToderoPlanBlock(PLAN_DOCUMENT)?.plan ?? null;

/** Exactly what the reviewer is given for one task of that plan. */
function reviewOf(input: {
  title: string;
  deliverable: string;
  /** What the tasks it waited on had finished, and whether they were accepted. */
  predecessors?: { identifier: string | null; title: string; body: string; status: string }[];
}) {
  const task = findPlanTaskByTitle(plan, input.title);
  const feature = findPlanFeatureForTask(plan, task);
  const lastOfFeature = isLastTaskOfFeature(plan, task);
  const checks = buildAcceptanceChecks({
    doneWhen: feature?.doneWhen ?? null,
    expectedOutput: task?.output ?? null,
    description: "<!-- todero-type: Task -->\nFour guides for a dark flat.",
    isLastTaskOfFeature: lastOfFeature,
  });
  const acceptedWork = acceptedWorkOfSameFeature({
    plan,
    featureName: feature?.name ?? task?.feature ?? null,
    predecessors: input.predecessors ?? [],
  });
  return {
    checks,
    acceptedWork,
    checkAlreadyDone: checksAlreadyDone({ checks, doneWhen: feature?.doneWhen ?? null, acceptedWork }),
    prompt: buildJudgeReviewPrompt({
      goal: plan?.goal ?? null,
      featureName: feature?.name ?? task?.feature ?? null,
      doneWhen: feature?.doneWhen ?? null,
      taskTitle: input.title,
      expectedOutput: task?.output ?? null,
      deliverable: input.deliverable,
      checks,
      isLastTaskOfFeature: lastOfFeature,
      acceptedWork,
    }),
  };
}

/** The tasks ZZGAAAAAAAAAAA-5 waited on, as the board had them. */
const WAITED_ON_MINUS_4 = [
  {
    identifier: "ZZGAAAAAAAAAAA-4",
    title: "Review and edit the draft guides",
    body: EDITED_GUIDES,
    status: "done",
  },
];

describe("the last task of a feature is judged with what the feature already achieved", () => {
  it("is the whole plan of 42c3d5e4, four tasks across two features", () => {
    expect(plan?.features.map((feature) => feature.name)).toEqual([
      "Research and Content Creation",
      "Review and Editing",
    ]);
    expect(plan?.tasks).toHaveLength(4);
    // Where the feature ends is the whole point, so it is spelled out.
    expect(isLastTaskOfFeature(plan, findPlanTaskByTitle(plan, "Prepare the guides for publishing"))).toBe(true);
    expect(isLastTaskOfFeature(plan, findPlanTaskByTitle(plan, "Review and edit the draft guides"))).toBe(false);
  });

  it("tells the reviewer what ZZGAAAAAAAAAAA-4 handed in and that it counts as done", () => {
    const review = reviewOf({
      title: "Prepare the guides for publishing",
      deliverable: HANDED_IN,
      predecessors: WAITED_ON_MINUS_4,
    });
    expect(review.acceptedWork.map((work) => work.identifier)).toEqual(["ZZGAAAAAAAAAAA-4"]);
    expect(review.prompt).toContain("Already done on this feature, and accepted:");
    expect(review.prompt).toContain("ZZGAAAAAAAAAAA-4 — Review and edit the draft guides handed in:");
    expect(review.prompt).toContain("Sansevieria, also known as snake plant");
    expect(review.prompt).toContain("That work is finished and counts as done.");
    expect(review.prompt).toContain("Judge this task on what it alone was asked to hand in.");
  });

  it("tells the reviewer that a plain-text hand-in cannot show how it is laid out", () => {
    const review = reviewOf({
      title: "Prepare the guides for publishing",
      deliverable: HANDED_IN,
      predecessors: WAITED_ON_MINUS_4,
    });
    // Both the feature's line and the task's own hand-in line ask for it.
    expect(namesPackaging(DONE_WHEN)).toBe(true);
    expect(namesPackaging("The final guides formatted and ready for distribution.")).toBe(true);
    expect(review.prompt).toContain("plain text, so it cannot show how anything is laid out");
    expect(review.prompt).toContain("count that met when the content itself is complete and reads well");
  });

  it("says on the verdict which line ZZGAAAAAAAAAAA-4 had already made true", () => {
    const review = reviewOf({
      title: "Prepare the guides for publishing",
      deliverable: HANDED_IN,
      predecessors: WAITED_ON_MINUS_4,
    });
    expect(review.checks).toEqual([
      DONE_WHEN,
      "The hand-in is The final guides formatted and ready for distribution.",
    ]);
    expect(review.checkAlreadyDone).toEqual(["ZZGAAAAAAAAAAA-4", null]);
    const comment = buildJudgeComment({
      verdict: "fail",
      note: "The guides are in plain text and have not been reviewed or edited.",
      outcome: { kind: "revise", round: 1 },
      checks: review.checks,
      // What the reviewer actually answered on 2026-09-21T14:39:18Z.
      checkResults: [false, false],
      checkAlreadyDone: review.checkAlreadyDone,
    });
    expect(comment).toContain("1 met, 1 not met");
    expect(comment).toContain(`- met — done on ZZGAAAAAAAAAAA-4 and accepted — ${DONE_WHEN}`);
    expect(comment).not.toMatch(/marker|todero-|disposition/i);
  });

  it("leaves the brief of a task with no accepted work of its own feature exactly as it was", () => {
    // ZZGAAAAAAAAAAA-4 itself: the task it waited on, ZZGAAAAAAAAAAA-3, belongs
    // to the other feature, so nothing of this feature is done yet.
    const review = reviewOf({
      title: "Review and edit the draft guides",
      deliverable: EDITED_GUIDES,
      predecessors: [
        {
          identifier: "ZZGAAAAAAAAAAA-3",
          title: "Write initial drafts for each plant guide",
          body: EDITED_GUIDES,
          status: "done",
        },
      ],
    });
    expect(review.acceptedWork).toEqual([]);
    expect(review.checkAlreadyDone).toEqual([null]);
    expect(review.prompt).not.toContain("Already done on this feature");
    expect(review.prompt).not.toContain("plain text, so it cannot show");
    // Word for word what wave 4 left it as.
    expect(review.prompt).toBe(
      [
        "A teammate has finished a task and handed in the work below. Decide whether it is good enough to show the person who asked for it.",
        "",
        "Goal: Publish a one-page guide to each of four houseplants that survive a dark flat for the end-user.",
        "Feature: Review and Editing",
        // The second full stop is the builder's own; this is word for word.
        `This task is one step of Review and Editing, which is finished when: ${DONE_WHEN}. That is the finish line for the whole of Review and Editing, not for this task — judge only this task's hand-in.`,
        "Task: Review and edit the draft guides",
        "Was asked to hand in: Four final, edited one-page guides.",
        "",
        "It has to be true that:",
        "1. The hand-in is Four final, edited one-page guides.",
        "",
        "What was handed in:",
        '"""',
        EDITED_GUIDES,
        '"""',
        "",
        "Judge only what is above, and only against this one task. Pass it when it does what this task asked for, even if it could be longer or prettier, and even though the rest of the feature is still to come. Fail it only when something this task asked for is missing or wrong.",
        "",
        "Answer in exactly this shape and nothing else:",
        "1: met",
        "VERDICT: pass",
        "One short paragraph: why. If it fails, name exactly what to change.",
      ].join("\n"),
    );
  });
});
