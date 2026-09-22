import { describe, expect, it } from "vitest";
import {
  buildToderoPlanTaskDescription,
  formatToderoPlanBlock,
  parseToderoPlanBlock,
  resolveToderoPlanTaskDependencies,
  spellsOutToderoPlanBlock,
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

  it("returns null when there is no block, no goal, or nothing to do", () => {
    expect(parseToderoPlanBlock("Just prose. STATUS: waiting")).toBeNull();
    expect(parseToderoPlanBlock("```todero-plan\nfeatures:\n  - name: X\n```")).toBeNull();
    expect(parseToderoPlanBlock("```todero-plan\ngoal: X\ntasks:\n```")).toBeNull();
    expect(parseToderoPlanBlock("```json\n{\"goal\": 1}\n```")).toBeNull();
  });

  it("makes one task per feature when the model wrote the features and stopped", () => {
    const result = parseToderoPlanBlock(
      [
        "Here is the plan.",
        "```todero-plan",
        "goal: Fill a table of five strangers for dinner in Tampa every Wednesday.",
        "features:",
        "  - name: One-page concept",
        "    why: A clear vision.",
        "    done_when: The one-page concept document is written and approved.",
        "  - name: Shortlist of ten restaurants",
        "    why: Somewhere to eat.",
        "    done_when: The shortlist is compiled with contact details.",
        "```",
        "Do you approve this plan?",
      ].join("\n"),
    );
    expect(result?.plan.tasks.map((task) => task.title)).toEqual(["One-page concept", "Shortlist of ten restaurants"]);
    expect(result?.plan.tasks[0]).toMatchObject({
      id: "t1",
      feature: "One-page concept",
      output: "The one-page concept document is written and approved.",
      after: "",
    });
    expect(result?.body).toBe("Here is the plan.\nDo you approve this plan?");
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

/**
 * One definition, used by both the turn that carries a schema and the task
 * that was told to write a plan. Two copies of this test were two copies of
 * the regex: change the wording of the instructions in one place and the
 * structured-output path stops firing with nothing failing.
 */
describe("spellsOutToderoPlanBlock", () => {
  it("fires on the instructions Todero actually sends", () => {
    expect(spellsOutToderoPlanBlock(TODERO_PLAN_BLOCK_INSTRUCTIONS)).toBe(true);
  });

  it("fires on a tilde fence and an indented one, the way small models write them", () => {
    expect(spellsOutToderoPlanBlock(["Write it like this:", "  ~~~todero-plan", "goal: x", "~~~"].join("\n"))).toBe(
      true,
    );
  });

  it("does not fire on prose that merely says the words", () => {
    expect(spellsOutToderoPlanBlock("Send me the todero-plan when you have it.")).toBe(false);
    expect(spellsOutToderoPlanBlock(["```yaml", "goal: x", "```"].join("\n"))).toBe(false);
    expect(spellsOutToderoPlanBlock("")).toBe(false);
    expect(spellsOutToderoPlanBlock(null)).toBe(false);
  });
});

/**
 * Wave 19 of the improvement loop finished with "Review the fourth guide" done
 * while "Draft the fourth guide" had never run. Its plan is kept here word for
 * word, from the archived organization f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3,
 * so what it does and does not say cannot drift.
 */
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
  - title: Draft the first guide
    feature: Draft guides
    output: The first guide draft.
  - title: Draft the second guide
    feature: Draft guides
    output: The second guide draft.
    after: Draft the first guide
  - title: Review the first guide
    feature: Review and refine guides
    output: The first guide review.
    after: Draft the first guide
  - title: Review the second guide
    feature: Review and refine guides
    output: The second guide review.
    after: Review the first guide
\`\`\``;

describe("a task the plan says nothing about", () => {
  function plan(block: string) {
    return parseToderoPlanBlock(`\`\`\`todero-plan\ngoal: Ship it\ntasks:\n${block}\`\`\``)!.plan;
  }

  it("follows the task listed before it in its feature, and its brief says so", () => {
    const made = plan(
      "  - title: Draft the fourth guide\n    feature: Draft guides\n" +
        "  - title: Review the fourth guide\n    feature: Draft guides\n",
    );
    const ordered = resolveToderoPlanTaskDependencies(made.tasks);
    expect(ordered[1]!.blockedByTaskIds).toEqual(["t1"]);
    expect(ordered[1]!.followsTaskId).toBe("t1");
    const brief = buildToderoPlanTaskDescription(made, ordered[1]!.task, {
      followsTaskTitled: "Draft the fourth guide",
    });
    expect(brief).toContain("Draft the fourth guide");
    expect(brief).toContain("The plan did not say what this task waits for");
  });

  it("still follows it when the plan named a wait that could never happen", () => {
    const made = plan(
      "  - title: One\n    feature: Alpha\n" +
        "  - title: Two\n    feature: Alpha\n    after: Three\n" +
        "  - title: Three\n    feature: Alpha\n    after: Two\n",
    );
    const ordered = resolveToderoPlanTaskDependencies(made.tasks);
    const two = ordered.find((entry) => entry.task.title === "Two")!;
    expect(two.blockedByTaskIds).toEqual(["t1"]);
    expect(two.followsTaskId).toBe("t1");
  });

  it("never gives one to the first task of a feature", () => {
    const made = plan(
      "  - title: A1\n    feature: Alpha\n" +
        "  - title: B1\n    feature: Beta\n" +
        "  - title: A2\n    feature: Alpha\n",
    );
    const ordered = resolveToderoPlanTaskDependencies(made.tasks);
    expect(ordered.map((entry) => entry.followsTaskId)).toEqual([null, null, "t1"]);
  });
});

describe("a plan that states every wait itself", () => {
  const wave19 = parseToderoPlanBlock(WAVE_19_PLAN)!.plan;
  const ordered = resolveToderoPlanTaskDependencies(wave19.tasks);

  it("is left exactly as it was", () => {
    expect(ordered.map((entry) => ({ title: entry.task.title, after: entry.blockedByTaskIds }))).toEqual([
      { title: "Draft the first guide", after: [] },
      { title: "Draft the second guide", after: ["t1"] },
      { title: "Review the first guide", after: ["t1"] },
      { title: "Review the second guide", after: ["t3"] },
    ]);
    expect(ordered.map((entry) => entry.followsTaskId)).toEqual([null, null, null, null]);
  });

  it("writes the same brief it wrote before, word for word", () => {
    for (const entry of ordered) {
      expect(buildToderoPlanTaskDescription(wave19, entry.task, { followsTaskTitled: null }))
        .toBe(buildToderoPlanTaskDescription(wave19, entry.task));
      expect(buildToderoPlanTaskDescription(wave19, entry.task))
        .not.toContain("The plan did not say what this task waits for");
    }
  });
});

/**
 * Wave 7's second look. The wave was called because wave 19 finished with
 * "Review the fourth guide" done while the fourth guide had never been
 * written. Reading the archive back showed the plan itself was the cause: the
 * planner chained each review to the review before it, and never to the guide
 * it reviews. Nothing the approval step can work out from that plan puts the
 * fourth guide in front of its review — the plan simply does not say it. So
 * the fix is in what the planner is asked for.
 */
describe("what the planner is asked for", () => {
  it("says a task that builds on another task's output must name that task", () => {
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "A task that reviews, checks, corrects or builds on what another task hands in cannot start"
        + " until that task is handed in: name that task in `after`",
    );
  });

  it("says a task can wait for more than one thing, and how to write that", () => {
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain("separated by commas");
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "even when it also waits for something else — list both",
    );
  });

  it("gives the planner wave 19's own case as the example", () => {
    expect(TODERO_PLAN_BLOCK_INSTRUCTIONS).toContain(
      "A review of the fourth guide waits for the fourth guide, not only for the review before it.",
    );
  });

  it("asks for a plan the parser reads as two waits, one of them the draft", () => {
    const written = parseToderoPlanBlock(`\`\`\`todero-plan
goal: Create four one-page guides for houseplants that survive a dark flat.
tasks:
  - title: Draft the third guide
    feature: Draft guides
  - title: Draft the fourth guide
    feature: Draft guides
    after: Draft the third guide
  - title: Review the third guide
    feature: Review and refine guides
    after: Draft the third guide
  - title: Review the fourth guide
    feature: Review and refine guides
    after: Draft the fourth guide, Review the third guide
\`\`\``)!.plan;
    const byId = new Map(written.tasks.map((task) => [task.id, task.title]));
    const ordered = resolveToderoPlanTaskDependencies(written.tasks);
    const review = ordered.find((entry) => entry.task.title === "Review the fourth guide")!;
    expect(review.blockedByTaskIds.map((id) => byId.get(id))).toEqual([
      "Draft the fourth guide",
      "Review the third guide",
    ]);
  });
});

describe("why a task follows the one before it", () => {
  function plan(block: string) {
    return parseToderoPlanBlock(`\`\`\`todero-plan\ngoal: Ship it\ntasks:\n${block}\`\`\``)!.plan;
  }

  it("says the plan was silent only when the plan really was silent", () => {
    const made = plan("  - title: One\n    feature: Alpha\n  - title: Two\n    feature: Alpha\n");
    const two = resolveToderoPlanTaskDependencies(made.tasks)[1]!;
    expect(two.followsReason).toBe("plan-said-nothing");
    const brief = buildToderoPlanTaskDescription(made, two.task, {
      followsTaskTitled: "One",
      followsReason: two.followsReason,
    });
    expect(brief).toContain("The plan did not say what this task waits for");
  });

  it("says the plan named a wait that cannot happen when that is what happened", () => {
    const made = plan(
      "  - title: One\n    feature: Alpha\n" +
        "  - title: Two\n    feature: Alpha\n    after: Three\n" +
        "  - title: Three\n    feature: Alpha\n    after: Two\n",
    );
    const two = resolveToderoPlanTaskDependencies(made.tasks).find((entry) => entry.task.title === "Two")!;
    expect(two.followsTaskId).toBe("t1");
    expect(two.followsReason).toBe("stated-wait-cannot-happen");
    const brief = buildToderoPlanTaskDescription(made, two.task, {
      followsTaskTitled: "One",
      followsReason: two.followsReason,
    });
    expect(brief).toContain("The plan named a wait for this task that can never happen");
    expect(brief).not.toContain("The plan did not say what this task waits for");
  });

  it("calls a wait on a task that is not in the plan a wait that cannot happen", () => {
    const made = plan(
      "  - title: One\n    feature: Alpha\n" +
        "  - title: Two\n    feature: Alpha\n    after: Something nobody wrote down\n",
    );
    const two = resolveToderoPlanTaskDependencies(made.tasks)[1]!;
    expect(two.followsReason).toBe("stated-wait-cannot-happen");
  });

  it("leaves a task the plan spoke for alone", () => {
    const made = plan(
      "  - title: One\n    feature: Alpha\n  - title: Two\n    feature: Alpha\n    after: One\n",
    );
    const ordered = resolveToderoPlanTaskDependencies(made.tasks);
    expect(ordered.map((entry) => entry.followsReason)).toEqual([null, null]);
  });
});
