import { describe, expect, it } from "vitest";
import {
  buildToderoPlanTaskDescription,
  formatToderoPlanBlock,
  parseToderoPlanBlock,
  resolveToderoPlanTaskDependencies,
  TODERO_PLAN_BLOCK_INSTRUCTIONS,
  TODERO_PLAN_TASK_TYPE_MARKER,
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

  it("accepts a plan with no fence at all, and keeps the words around it", () => {
    const reply = "Proposed plan:\n\ngoal: Ship the launch kit.\nfeatures:\n  - name: Concept\n    done_when: written\ntasks:\n  - title: Draft the concept\n    feature: Concept\n    output: One page\n\nLet me know what to change.\nSTATUS: waiting";
    const result = parseToderoPlanBlock(reply)!;
    expect(result.plan.goal).toBe("Ship the launch kit.");
    expect(result.plan.tasks[0]?.title).toBe("Draft the concept");
    expect(result.body).toContain("Proposed plan:");
    expect(result.body).toContain("Let me know what to change.");
    expect(result.body).not.toContain("done_when");
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

  it("carries what the person said into the child brief, newest lines kept when over budget", () => {
    const plan = parseToderoPlanBlock(REPLY)!.plan;
    const brief = buildToderoPlanTaskDescription(plan, plan.tasks[0]!, {
      personSaid: ["Must have: phone sign-up and matching.", "Done means five real dinners."],
    });
    expect(brief).toContain("What the person said");
    expect(brief).toContain("- Must have: phone sign-up and matching.");
    expect(brief).toContain("- Done means five real dinners.");
    const huge = "x".repeat(1_600);
    const clipped = buildToderoPlanTaskDescription(plan, plan.tasks[0]!, { personSaid: [huge, "Keep this."] });
    expect(clipped).toContain("- Keep this.");
    expect(clipped).not.toContain(huge);
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

  it("marks every task it writes as a Task, so nothing has to guess from depth", () => {
    const plan = parseToderoPlanBlock(REPLY)!.plan;
    const brief = buildToderoPlanTaskDescription(plan, plan.tasks[0]!);
    expect(brief.startsWith(TODERO_PLAN_TASK_TYPE_MARKER)).toBe(true);
    expect(TODERO_PLAN_TASK_TYPE_MARKER).toBe("<!-- todero-type: Task -->");
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

describe("the optional 'after' line", () => {
  it("reads after, and the words a model reaches for instead", () => {
    const plan = parseToderoPlanBlock(`\`\`\`todero-plan
goal: Ship it
tasks:
  - title: One
    after: Two
  - title: Two
  - title: Three
    depends_on: One
  - title: Four
    blocked by: Two
\`\`\``)!.plan;
    expect(plan.tasks.map((task) => task.after)).toEqual(["Two", "", "One", "Two"]);
  });

  it("leaves after empty when the model did not write one", () => {
    const plan = parseToderoPlanBlock("```todero-plan\ngoal: Ship it\ntasks:\n  - title: One\n```")!.plan;
    expect(plan.tasks[0]!.after).toBe("");
  });

  it("keeps after through the canonical block", () => {
    const first = parseToderoPlanBlock(
      "```todero-plan\ngoal: Ship it\ntasks:\n  - title: One\n  - title: Two\n    after: One\n```",
    )!.plan;
    const again = parseToderoPlanBlock(formatToderoPlanBlock(first))!.plan;
    expect(again).toEqual(first);
    expect(again.tasks[1]!.after).toBe("One");
  });
});

describe("resolveToderoPlanTaskDependencies", () => {
  function plan(block: string) {
    return parseToderoPlanBlock(`\`\`\`todero-plan\ngoal: Ship it\ntasks:\n${block}\`\`\``)!.plan;
  }
  function shape(tasks: ReturnType<typeof plan>["tasks"]) {
    return resolveToderoPlanTaskDependencies(tasks).map((entry) => ({
      title: entry.task.title,
      after: entry.blockedByTaskIds,
    }));
  }

  it("starts the first task of every feature at once and chains the rest inside it", () => {
    const tasks = plan(
      "  - title: A1\n    feature: Alpha\n" +
        "  - title: B1\n    feature: Beta\n" +
        "  - title: A2\n    feature: Alpha\n" +
        "  - title: B2\n    feature: Beta\n",
    ).tasks;
    expect(shape(tasks)).toEqual([
      { title: "A1", after: [] },
      { title: "B1", after: [] },
      { title: "A2", after: ["t1"] },
      { title: "B2", after: ["t2"] },
    ]);
  });

  it("keeps one chain when the plan names no features at all", () => {
    const tasks = plan("  - title: One\n  - title: Two\n  - title: Three\n").tasks;
    expect(shape(tasks)).toEqual([
      { title: "One", after: [] },
      { title: "Two", after: ["t1"] },
      { title: "Three", after: ["t2"] },
    ]);
  });

  it("uses 'after' across features, by title or by plan id", () => {
    const tasks = plan(
      "  - title: Write the copy\n    feature: Alpha\n" +
        "  - title: Lay out the page\n    feature: Beta\n    after: Write the copy\n" +
        "  - title: Proofread\n    feature: Gamma\n    after: t2\n",
    ).tasks;
    expect(shape(tasks)).toEqual([
      { title: "Write the copy", after: [] },
      { title: "Lay out the page", after: ["t1"] },
      { title: "Proofread", after: ["t2"] },
    ]);
  });

  it("takes more than one name on a single after line", () => {
    const tasks = plan(
      "  - title: A\n    feature: Alpha\n" +
        "  - title: B\n    feature: Beta\n" +
        "  - title: C\n    feature: Gamma\n    after: A, B\n",
    ).tasks;
    expect(shape(tasks)[2]).toEqual({ title: "C", after: ["t1", "t2"] });
  });

  it("orders the result so a task always lands after what it waits for", () => {
    const tasks = plan(
      "  - title: Last\n    feature: Alpha\n    after: First\n" +
        "  - title: First\n    feature: Beta\n",
    ).tasks;
    expect(shape(tasks)).toEqual([
      { title: "First", after: [] },
      { title: "Last", after: ["t2"] },
    ]);
  });

  it("falls back to the feature chain when after names a task that is not there", () => {
    const tasks = plan(
      "  - title: One\n    feature: Alpha\n" +
        "  - title: Two\n    feature: Alpha\n    after: Something we dropped\n",
    ).tasks;
    expect(shape(tasks)[1]).toEqual({ title: "Two", after: ["t1"] });
  });

  it("ignores a task that says it comes after itself", () => {
    const tasks = plan("  - title: Only\n    feature: Alpha\n    after: Only\n").tasks;
    expect(shape(tasks)).toEqual([{ title: "Only", after: [] }]);
  });

  it("breaks an impossible circle instead of refusing the plan", () => {
    const tasks = plan(
      "  - title: A\n    feature: Alpha\n    after: B\n" +
        "  - title: B\n    feature: Beta\n    after: A\n",
    ).tasks;
    const result = shape(tasks);
    expect(result).toHaveLength(2);
    expect(result[0]!.after).toEqual([]);
    expect(result[1]!.after).toEqual([result[0]!.title === "A" ? "t1" : "t2"]);
  });
});
