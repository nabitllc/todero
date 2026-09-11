// Repro — wave 2, gauntlet item 0: a terse local model derailed the loop.
//
// On the wave-2 live loop the 14B model answered the person's brief with a plan
// block that named the goal and four features and stopped before the tasks —
// twice in a row, each time ending "Do you approve this plan?". The parser
// dropped a plan with no tasks, so the reply posted as plain prose: no Plan
// document, no approval card, and a task that read "waiting on you" with
// nothing to approve. The loop stalled on its second turn.
//
// The fix (packages/shared/src/todero-plan.ts) keeps the plan: one task per
// feature, handing in what the feature's done_when asks for.
//
// Fails on origin/main (the block parses to null), passes on
// fix/local-model-slow-turns. Run with:
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/plan-without-tasks.gauntlet.ts
import { describe, expect, it } from "vitest";
import { formatToderoPlanBlock, parseToderoPlanBlock } from "../../../../packages/shared/src/todero-plan.js";

/** The reply the model wrote on the wave-2 live loop, word for word. */
const REPLY_FROM_THE_LIVE_LOOP = `Understood. Given your requirements, here is the proposed plan:

\`\`\`todero-plan
goal: To fill a table of five strangers for dinner in Tampa every Wednesday and Saturday.
features:
  - name: One-page concept
    why: Establishing a clear vision for the project.
    done_when: The one-page concept document is created and approved.
  - name: Sign-up flow
    why: Allowing users to register and participate in the dinner table.
    done_when: The sign-up flow is developed and tested, allowing users to successfully sign up.
  - name: Matching rules
    why: Defining how strangers are matched for dinner tables.
    done_when: Matching rules are established and documented.
  - name: Shortlist of ten restaurants
    why: Providing a selection of suitable dining options for the matches.
    done_when: The shortlist of ten restaurants is compiled with contact details and descriptions.
\`\`\`

Do you approve this plan?`;

describe("repro: a plan that names its features but no tasks", () => {
  it("is still a plan the person can approve", () => {
    const parsed = parseToderoPlanBlock(REPLY_FROM_THE_LIVE_LOOP);
    expect(parsed).not.toBeNull();
    expect(parsed!.plan.features).toHaveLength(4);
    expect(parsed!.plan.tasks.map((task) => task.title)).toEqual([
      "One-page concept",
      "Sign-up flow",
      "Matching rules",
      "Shortlist of ten restaurants",
    ]);
    expect(parsed!.plan.tasks.every((task) => task.feature === task.title)).toBe(true);
  });

  it("stores as a canonical block that reads back the same", () => {
    const first = parseToderoPlanBlock(REPLY_FROM_THE_LIVE_LOOP)!.plan;
    const again = parseToderoPlanBlock(formatToderoPlanBlock(first))!.plan;
    expect(again).toEqual(first);
  });

  it("posts the words around the block, not the block itself", () => {
    const parsed = parseToderoPlanBlock(REPLY_FROM_THE_LIVE_LOOP)!;
    expect(parsed.body).toBe("Understood. Given your requirements, here is the proposed plan:\n\nDo you approve this plan?");
  });
});
