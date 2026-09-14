import { describe, expect, it } from "vitest";

import {
  TODERO_PLAN_JSON_SCHEMA,
  TODERO_PLAN_JSON_SCHEMA_NAME,
  parseToderoPlanJson,
} from "./todero-plan-schema.js";

describe("the plan shape a runtime can enforce", () => {
  it("names every field the plan needs and allows nothing else", () => {
    expect(TODERO_PLAN_JSON_SCHEMA_NAME).toBe("todero_plan");
    expect(TODERO_PLAN_JSON_SCHEMA.type).toBe("object");
    expect(TODERO_PLAN_JSON_SCHEMA.required).toEqual(["message", "goal", "features", "tasks"]);
    expect(TODERO_PLAN_JSON_SCHEMA.additionalProperties).toBe(false);
    const features = TODERO_PLAN_JSON_SCHEMA.properties.features;
    expect(features.items.required).toEqual(["name", "why", "done_when"]);
    const tasks = TODERO_PLAN_JSON_SCHEMA.properties.tasks;
    expect(tasks.items.required).toEqual(["title", "feature", "output", "after"]);
  });
});

describe("reading a plan the runtime shaped", () => {
  it("turns the object into the same plan the fenced block would have made", () => {
    const text = JSON.stringify({
      message: "Here is what I propose.",
      goal: "Seat neighbors at monthly dinners",
      features: [{ name: "Sign-ups", why: "People need a way in", done_when: "A form is live" }],
      tasks: [
        { title: "Draft the sign-up spec", feature: "Sign-ups", output: "A one-page spec", after: "" },
        { title: "Build the form", feature: "Sign-ups", output: "A working form", after: "Draft the sign-up spec" },
      ],
    });

    const read = parseToderoPlanJson(text);

    expect(read).not.toBeNull();
    expect(read!.body).toBe("Here is what I propose.");
    expect(read!.plan.goal).toBe("Seat neighbors at monthly dinners");
    expect(read!.plan.features).toEqual([
      { id: "f1", name: "Sign-ups", why: "People need a way in", doneWhen: "A form is live" },
    ]);
    expect(read!.plan.tasks).toEqual([
      { id: "t1", title: "Draft the sign-up spec", feature: "Sign-ups", output: "A one-page spec", after: "" },
      {
        id: "t2",
        title: "Build the form",
        feature: "Sign-ups",
        output: "A working form",
        after: "Draft the sign-up spec",
      },
    ]);
  });

  it("reads the object even when the model wrapped it in a fence", () => {
    const text = ["Sure.", "```json", '{"goal":"Ship it","tasks":[{"title":"Write the brief"}]}', "```"].join("\n");

    const read = parseToderoPlanJson(text);

    expect(read?.plan.goal).toBe("Ship it");
    expect(read?.plan.tasks.map((task) => task.title)).toEqual(["Write the brief"]);
  });

  it("makes one task per feature when the model named features and no tasks", () => {
    const text = JSON.stringify({
      goal: "Ship it",
      features: [{ name: "Checkout", why: "Money", done_when: "A card can be charged" }],
      tasks: [],
    });

    expect(parseToderoPlanJson(text)?.plan.tasks).toEqual([
      { id: "t1", title: "Checkout", feature: "Checkout", output: "A card can be charged", after: "" },
    ]);
  });

  it("is null for prose, so the fenced-block parser stays the fallback", () => {
    expect(parseToderoPlanJson("Do you approve this plan?")).toBeNull();
    expect(parseToderoPlanJson("")).toBeNull();
  });

  it("is null for an object that is not a plan", () => {
    expect(parseToderoPlanJson('{"message":"Do you approve this plan?"}')).toBeNull();
    expect(parseToderoPlanJson('{"goal":"Ship it"}')).toBeNull();
  });
});
