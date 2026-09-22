// Repro — wave 7 of the improvement loop: a review task must wait for the work
// it reviews, and a wait that cannot happen must not become no wait at all.
//
// Wave 19 (organization f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3, archived)
// finished with "Review the fourth guide" done, no blockers, nothing refused —
// while "Draft the fourth guide" had never run. A review task closed with
// nothing to review.
//
// What the archive actually says about why, read back through the API on
// 2026-09-21: every task in that plan carried an `after:` line, and "Review the
// fourth guide" carried `after: Review the third guide`. The task was created
// blocked by ZZGAAAAAAAAA-9, exactly as the plan asked. The draft chain and the
// review chain were two chains side by side, both anchored on "Draft the first
// guide", and the review chain simply ran ahead. So the plan was wrong, not the
// approval: a 14B planner chained each review to the review before it instead
// of to the guide it reviews. The first part of this file pins that, word for
// word, so nobody re-diagnoses it from memory.
//
// Nothing the approval step can work out from that plan puts the fourth guide
// in front of its review: the plan never connects them. What changed is what
// the planner is asked for — a task that reviews, checks, corrects or builds on
// another task's output must name that task, and a task may name more than one.
// The second part pins that instruction and shows the plan it asks for parsing
// into the two waits the fourth review needed.
//
// The third part closes the other way a task ends up with nothing in front of
// it. When the plan names a wait that can never happen — two tasks each waiting
// for the other, or a name nobody wrote down — the unusable wait is dropped,
// and before this wave the task was then left waiting for nothing at all and
// started at once: wave 19's shape, from a different cause. It now falls back
// to the task listed before it in its own feature, and its brief says which of
// the two reasons put it there.
//
// Nothing here touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/review-follows-its-draft.gauntlet.ts
//
// Fails on origin/main, where the planner is never told to name the work a task
// builds on, and a dropped wait becomes no wait.
import { describe, expect, it } from "vitest";
import {
  buildToderoPlanTaskDescription,
  parseToderoPlanBlock,
  resolveToderoPlanTaskDependencies,
  TODERO_PLAN_BLOCK_INSTRUCTIONS,
} from "../../../../packages/shared/src/todero-plan.js";

/** Wave 19's plan, from the root task's own plan document. Four of thirteen tasks. */
const WAVE_19_PLAN = `\`\`\`todero-plan
goal: Create four one-page guides for houseplants that survive a dark flat.
features:
  - name: Draft guides
    why: To produce the initial content for the one-page guides.
    done_when: Four drafts, each naming the plant, the light it needs, and how often to water it.
  - name: Review and refine guides
    why: To ensure the content is accurate, readable, and meets the required format.
    done_when: Four reviewed and refined guides.
tasks:
  - title: Draft the third guide
    feature: Draft guides
    output: The third guide draft, named and formatted according to the requirements.
  - title: Draft the fourth guide
    feature: Draft guides
    output: The fourth guide draft, named and formatted according to the requirements.
    after: Draft the third guide
  - title: Review the third guide
    feature: Review and refine guides
    output: The third guide review, with notes on changes needed.
    after: Draft the third guide
  - title: Review the fourth guide
    feature: Review and refine guides
    output: The fourth guide review, with notes on changes needed.
    after: Review the third guide
\`\`\``;

const wave19 = parseToderoPlanBlock(WAVE_19_PLAN)!.plan;

function shape(plan: { tasks: typeof wave19.tasks }) {
  const byId = new Map(plan.tasks.map((task) => [task.id, task.title]));
  return resolveToderoPlanTaskDependencies(plan.tasks).map((entry) => ({
    title: entry.task.title,
    waitsFor: entry.blockedByTaskIds.map((id) => byId.get(id)!),
    follows: entry.followsTaskId ? byId.get(entry.followsTaskId)! : null,
  }));
}

describe("wave 7: what wave 19's plan actually asked for", () => {
  it("named a wait for every task, including the review that closed with nothing to review", () => {
    expect(wave19.tasks.map((task) => task.after)).toEqual([
      "",
      "Draft the third guide",
      "Draft the third guide",
      "Review the third guide",
    ]);
  });

  it("puts the fourth review behind the third review, which is what the plan said", () => {
    expect(shape(wave19)).toEqual([
      { title: "Draft the third guide", waitsFor: [], follows: null },
      { title: "Draft the fourth guide", waitsFor: ["Draft the third guide"], follows: null },
      { title: "Review the third guide", waitsFor: ["Draft the third guide"], follows: null },
      { title: "Review the fourth guide", waitsFor: ["Review the third guide"], follows: null },
    ]);
    // The fourth review never waits for the fourth guide. That is the plan's
    // own doing, and what this wave records rather than quietly overrules: a
    // stated wait is the person's approved order.
    expect(shape(wave19)[3]!.waitsFor).not.toContain("Draft the fourth guide");
  });

  it("writes the same brief it always wrote when the plan stated the wait", () => {
    for (const task of wave19.tasks) {
      expect(buildToderoPlanTaskDescription(wave19, task, { followsTaskTitled: null }))
        .toBe(buildToderoPlanTaskDescription(wave19, task));
      expect(buildToderoPlanTaskDescription(wave19, task)).not.toContain("Follows:");
    }
  });
});

describe("wave 7: what the planner is asked for now", () => {
  it("tells it that a task building on another task's output names that task", () => {
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "A task that reviews, checks, corrects or builds on what another task hands in cannot start"
        + " until that task is handed in: name that task in `after`",
    );
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "A review of the fourth guide waits for the fourth guide, not only for the review before it.",
    );
  });

  it("tells it a task can wait for more than one thing, and how to write that", () => {
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "The titles of the tasks that have to finish first, separated by commas",
    );
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "even when it also waits for something else — list both, separated by commas",
    );
  });

  it("asks for the plan wave 19 needed, and that plan holds both waits", () => {
    const written = parseToderoPlanBlock(WAVE_19_PLAN.replace(
      "    after: Review the third guide",
      "    after: Draft the fourth guide, Review the third guide",
    ))!.plan;
    expect(shape(written)[3]).toEqual({
      title: "Review the fourth guide",
      waitsFor: ["Draft the fourth guide", "Review the third guide"],
      follows: null,
    });
  });
});

describe("wave 7: a task with nothing left in front of it", () => {
  const circled = parseToderoPlanBlock(`\`\`\`todero-plan
goal: Create four one-page guides for houseplants that survive a dark flat.
tasks:
  - title: Draft the fourth guide
    feature: Guides
  - title: Review the fourth guide
    feature: Guides
    after: Finalize the fourth guide
  - title: Finalize the fourth guide
    feature: Guides
    after: Review the fourth guide
\`\`\``)!.plan;

  it("no longer starts at once when the plan asked for a wait that can never happen", () => {
    const review = shape(circled).find((entry) => entry.title === "Review the fourth guide")!;
    expect(review.waitsFor).toEqual(["Draft the fourth guide"]);
    expect(review.follows).toBe("Draft the fourth guide");
  });

  it("tells the worker the true reason, which here is not that the plan was silent", () => {
    const ordered = resolveToderoPlanTaskDependencies(circled.tasks);
    const review = ordered.find((entry) => entry.task.title === "Review the fourth guide")!;
    expect(review.followsReason).toBe("stated-wait-cannot-happen");
    const brief = buildToderoPlanTaskDescription(circled, review.task, {
      followsTaskTitled: "Draft the fourth guide",
      followsReason: review.followsReason,
    });
    expect(brief).toContain("Follows: Draft the fourth guide.");
    expect(brief).toContain("The plan named a wait for this task that can never happen");
    expect(brief).not.toContain("The plan did not say what this task waits for");
  });

  it("says the plan was silent when the plan wrote no wait at all", () => {
    const silent = parseToderoPlanBlock(`\`\`\`todero-plan
goal: Ship it
tasks:
  - title: Draft the fourth guide
    feature: Guides
  - title: Review the fourth guide
    feature: Guides
\`\`\``)!.plan;
    const review = resolveToderoPlanTaskDependencies(silent.tasks)[1]!;
    expect(review.followsReason).toBe("plan-said-nothing");
    expect(buildToderoPlanTaskDescription(silent, review.task, {
      followsTaskTitled: "Draft the fourth guide",
      followsReason: review.followsReason,
    })).toContain("The plan did not say what this task waits for");
  });

  it("leaves the first task of a feature free, so separate features still run side by side", () => {
    const parallel = parseToderoPlanBlock(`\`\`\`todero-plan
goal: Ship it
tasks:
  - title: Draft the first guide
    feature: Draft guides
  - title: Review the first guide
    feature: Review guides
    after: Nothing that exists
\`\`\``)!.plan;
    expect(shape(parallel)).toEqual([
      { title: "Draft the first guide", waitsFor: [], follows: null },
      { title: "Review the first guide", waitsFor: [], follows: null },
    ]);
  });
});
