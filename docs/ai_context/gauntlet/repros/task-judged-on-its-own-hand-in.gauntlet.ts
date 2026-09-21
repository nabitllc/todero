// Repro — wave 4 of the improvement loop: a task is judged on what it was
// asked to hand in, not on the finish line of the whole feature it belongs to.
//
// Observed in wave 19 (2026-09-21), organization "Zz Gauntlet Org 0921-034835"
// (f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3). ZZGAAAAAAAAA-4 "Draft the second
// guide" handed in a correct second guide — Pothos, the light it needs, how
// often to water it — and the reviewer sent it back:
//
//   - met — Four drafts, each naming the plant, the light it needs, and how
//     often to water it.
//   - not met — The hand-in is The second guide draft, named and formatted
//     according to the requirements.
//   "... it only contains information for one plant. To pass, it must include
//    information for three additional houseplants."
//
// "Four drafts" is the finish line of the feature, not of this task. A task
// asked for one guide can never make it true, so the task could never pass.
// ZZGAAAAAAAAA-11 "Finalize the first guide" was sent back the same way, and
// between them they gated five tasks that never ran.
//
// The plan below is the real approved plan of that organization, copied from
// its Plan document.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/task-judged-on-its-own-hand-in.gauntlet.ts
//
// Fails on origin/main, where every task of a feature is checked against the
// feature's finish line.
import { describe, expect, it } from "vitest";
import { parseToderoPlanBlock } from "../../../../packages/shared/src/todero-plan.js";
import {
  buildAcceptanceChecks,
  buildJudgeReviewPrompt,
  findPlanFeatureForTask,
  findPlanTaskByTitle,
  isLastTaskOfFeature,
} from "../../../../server/src/todero/judge.js";

/** The approved plan of f6e02c4b, as its Plan document holds it. */
const PLAN_DOCUMENT = [
  "```todero-plan",
  "goal: Create four one-page guides for houseplants that survive a dark flat.",
  "features:",
  "  - name: Research and select plants",
  "    why: To ensure the guides are about plants that can thrive in low light conditions.",
  "    done_when: A list of four plants with their light and watering needs.",
  "  - name: Draft guides",
  "    why: To produce the initial content for the one-page guides.",
  "    done_when: Four drafts, each naming the plant, the light it needs, and how often to water it.",
  "  - name: Review and refine guides",
  "    why: To ensure the content is accurate, readable, and meets the required format.",
  "    done_when: Four reviewed and refined guides.",
  "  - name: Finalize and format guides",
  "    why: To prepare the guides for publication.",
  "    done_when: Four finalized and formatted one-page guides ready for distribution.",
  "tasks:",
  "  - title: Identify suitable plants",
  "    feature: Research and select plants",
  "    output: A list of four plants with their light and watering needs.",
  "  - title: Draft the first guide",
  "    feature: Draft guides",
  "    output: The first guide draft, named and formatted according to the requirements.",
  "    after: Identify suitable plants",
  "  - title: Draft the second guide",
  "    feature: Draft guides",
  "    output: The second guide draft, named and formatted according to the requirements.",
  "    after: Draft the first guide",
  "  - title: Draft the third guide",
  "    feature: Draft guides",
  "    output: The third guide draft, named and formatted according to the requirements.",
  "    after: Draft the second guide",
  "  - title: Draft the fourth guide",
  "    feature: Draft guides",
  "    output: The fourth guide draft, named and formatted according to the requirements.",
  "    after: Draft the third guide",
  "  - title: Review the first guide",
  "    feature: Review and refine guides",
  "    output: The first guide review, with notes on changes needed.",
  "    after: Draft the first guide",
  "  - title: Finalize the first guide",
  "    feature: Finalize and format guides",
  "    output: The first finalized and formatted guide.",
  "    after: Review the first guide",
  "  - title: Finalize the fourth guide",
  "    feature: Finalize and format guides",
  "    output: The fourth finalized and formatted guide.",
  "    after: Finalize the first guide",
  "```",
].join("\n");

const FOUR_DRAFTS = "Four drafts, each naming the plant, the light it needs, and how often to water it.";

/** Exactly what the reviewer was given for one task of that plan. */
function reviewOf(title: string, description = "<!-- todero-type: Task -->\nGoal: four guides.") {
  const plan = parseToderoPlanBlock(PLAN_DOCUMENT)?.plan ?? null;
  const task = findPlanTaskByTitle(plan, title);
  const feature = findPlanFeatureForTask(plan, task);
  const lastOfFeature = isLastTaskOfFeature(plan, task);
  const checks = buildAcceptanceChecks({
    doneWhen: feature?.doneWhen ?? null,
    expectedOutput: task?.output ?? null,
    description,
    isLastTaskOfFeature: lastOfFeature,
  });
  return {
    checks,
    prompt: buildJudgeReviewPrompt({
      goal: plan?.goal ?? null,
      featureName: feature?.name ?? null,
      doneWhen: feature?.doneWhen ?? null,
      taskTitle: title,
      expectedOutput: task?.output ?? null,
      deliverable: "Pothos (Epipremnum aureum) — light: low to bright indirect. Water when the top inch is dry.",
      checks,
      isLastTaskOfFeature: lastOfFeature,
    }),
  };
}

describe("a task is judged on its own hand-in line", () => {
  it("does not ask ZZGAAAAAAAAA-4 for four drafts", () => {
    const review = reviewOf("Draft the second guide");
    expect(review.checks).toEqual([
      "The hand-in is The second guide draft, named and formatted according to the requirements.",
    ]);
    expect(review.checks).not.toContain(FOUR_DRAFTS);
    // The reviewer is still told where the task sits, in plain words, so it
    // does not mistake one guide for the whole job either way.
    expect(review.prompt).toContain("one step of Draft guides");
    expect(review.prompt).toContain("judge only this task's hand-in");
    expect(review.prompt).not.toContain(`1. ${FOUR_DRAFTS}`);
  });

  it("does not ask ZZGAAAAAAAAA-11 for four finished guides", () => {
    const review = reviewOf("Finalize the first guide");
    expect(review.checks).toEqual(["The hand-in is The first finalized and formatted guide."]);
    expect(review.checks).not.toContain("Four finalized and formatted one-page guides ready for distribution.");
  });

  it("still holds the task a feature ends with to the feature's finish line", () => {
    const review = reviewOf("Draft the fourth guide");
    expect(review.checks).toEqual([
      FOUR_DRAFTS,
      "The hand-in is The fourth guide draft, named and formatted according to the requirements.",
    ]);
    expect(review.prompt).toContain(`Done when: ${FOUR_DRAFTS}`);
  });

  it("leaves a task that wrote its own criteria exactly as it was", () => {
    const review = reviewOf(
      "Draft the second guide",
      ["Acceptance Criteria", "- It names the plant", "- It says how often to water it"].join("\n"),
    );
    expect(review.checks).toEqual(["It names the plant", "It says how often to water it"]);
  });
});
