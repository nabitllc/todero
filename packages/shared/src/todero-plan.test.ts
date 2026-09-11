import { describe, expect, it } from "vitest";
import {
  buildToderoPlanTaskDescription,
  formatToderoPlanBlock,
  parseToderoPlanBlock,
  TODERO_PLAN_BLOCK_INSTRUCTIONS,
} from "./todero-plan.js";

const REPLY = `Here is what I propose.

\`\`\`todero-plan
goal: A small web app that seats Tampa neighbors at weekend dinners with strangers.
features:
  - name: Sign up
    why: People need an account tied to a phone number
    done_when: A new person can sign up with a phone code in under a minute
  - name: Pick a dinner
    why: Wednesday and Saturday dinners are the product
    done_when: A signed-in person can pick one upcoming dinner
tasks:
  - title: Write the sign-up flow spec
    feature: Sign up
    output: A one-page spec with the screens and the phone-code step
  - title: List the first ten restaurants
    feature: Pick a dinner
    output: A table with name, neighborhood, and table-of-five availability
\`\`\`

Tell me what to change.
STATUS: waiting`;

describe("parseToderoPlanBlock", () => {
  it("reads the canonical shape and strips the block from the reply body", () => {
    const result = parseToderoPlanBlock(REPLY);
    expect(result).not.toBeNull();
    const { plan, body } = result!;
    expect(plan.goal).toBe("A small web app that seats Tampa neighbors at weekend dinners with strangers.");
    expect(plan.features.map((f) => f.name)).toEqual(["Sign up", "Pick a dinner"]);
    expect(plan.features[0]).toMatchObject({ id: "f1", why: "People need an account tied to a phone number" });
    expect(plan.features[0]!.doneWhen).toMatch(/^A new person can sign up/);
    expect(plan.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(plan.tasks[1]).toMatchObject({ title: "List the first ten restaurants", feature: "Pick a dinner" });
    expect(body).toBe("Here is what I propose.\n\nTell me what to change.\nSTATUS: waiting");
  });

  it("tolerates a 7B model's looser shape: star bullets, 'done when', quotes, wrapped lines, unknown keys", () => {
    const loose = `\`\`\`todero-plan
goal: "Seat neighbors at
  weekend dinners"
features:
* name: Matching
  done when: five people get a table
  priority: high
tasks:
* title: Draft the matching rules
  feature: Matching
  output: A short document
    with the rules listed
\`\`\``;
    const result = parseToderoPlanBlock(loose)!;
    expect(result.plan.goal).toBe("Seat neighbors at weekend dinners");
    expect(result.plan.features[0]).toMatchObject({ name: "Matching", doneWhen: "five people get a table" });
    expect(result.plan.tasks[0]).toMatchObject({ title: "Draft the matching rules", output: "A short document with the rules listed" });
  });

  it("accepts an unlabeled fence that starts with goal:", () => {
    const result = parseToderoPlanBlock("```\ngoal: Ship it\ntasks:\n  - title: Do the thing\n```");
    expect(result?.plan.tasks[0]?.title).toBe("Do the thing");
  });

  it("returns null when there is no block, no goal, or no tasks", () => {
    expect(parseToderoPlanBlock("Just prose. STATUS: waiting")).toBeNull();
    expect(parseToderoPlanBlock("```todero-plan\nfeatures:\n  - name: X\n```")).toBeNull();
    expect(parseToderoPlanBlock("```todero-plan\ngoal: X\ntasks:\n```")).toBeNull();
    expect(parseToderoPlanBlock("```json\n{\"goal\": 1}\n```")).toBeNull();
  });

  it("round-trips through the canonical block", () => {
    const first = parseToderoPlanBlock(REPLY)!.plan;
    const again = parseToderoPlanBlock(formatToderoPlanBlock(first))!.plan;
    expect(again).toEqual(first);
  });

  it("writes a child task brief that stands alone and asks for a status line", () => {
    const plan = parseToderoPlanBlock(REPLY)!.plan;
    const brief = buildToderoPlanTaskDescription(plan, plan.tasks[0]!);
    expect(brief).toContain("Goal: A small web app");
    expect(brief).toContain("Feature: Sign up — People need an account");
    expect(brief).toContain("Done when: A new person can sign up");
    expect(brief).toContain("Hand in: A one-page spec");
    expect(brief).toContain("STATUS: done");
  });

  it("ships instructions the brief can paste that the parser itself accepts", () => {
    const example = TODERO_PLAN_BLOCK_INSTRUCTIONS.slice(
      TODERO_PLAN_BLOCK_INSTRUCTIONS.indexOf("```"),
      TODERO_PLAN_BLOCK_INSTRUCTIONS.lastIndexOf("```") + 3,
    );
    const result = parseToderoPlanBlock(example);
    expect(result?.plan.features).toHaveLength(1);
    expect(result?.plan.tasks).toHaveLength(1);
  });
});
