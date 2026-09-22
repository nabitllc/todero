import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TODERO_PLAN_JSON_SCHEMA } from "./todero-plan-schema.js";
import { TODERO_PLAN_BLOCK_INSTRUCTIONS } from "./todero-plan.js";

/**
 * Three places tell a model what a plan looks like: the words Todero puts in
 * the turn itself, the planning skill loaded onto that same turn, and the
 * shape a runtime holds the model to when it asks for the plan directly. A
 * model that reads two of them disagreeing follows one of them, and nobody
 * chose which. These tests hold the other two to the words in the turn.
 */

const SKILL_PATH = fileURLToPath(
  new URL("../../../skills/todero-plan-a-project/SKILL.md", import.meta.url),
);

/** The pasted plan shape in the skill: everything under its first heading. */
function planShapeInSkill(): string {
  const text = readFileSync(SKILL_PATH, "utf8").replace(/\r\n?/g, "\n");
  const body = text.split("\n# Plan a Project\n")[1];
  if (body === undefined) throw new Error("The planning skill has no `# Plan a Project` heading.");
  return body.split("\n## ")[0]!.trim();
}

/** The `after` line out of the plan shape, without its parenthetical. */
function afterLine(): string {
  const match = TODERO_PLAN_BLOCK_INSTRUCTIONS.match(/\n\s*after: ([^(\n]+?)\s*\(/);
  if (!match) throw new Error("The plan shape no longer has an `after:` line.");
  return match[1]!;
}

/** The rule about a task that works on what another task handed in. */
function reviewRule(): string {
  const match = TODERO_PLAN_BLOCK_INSTRUCTIONS.match(/A task that reviews[^:.]+/);
  if (!match) throw new Error("The plan shape no longer states the rule for a review task.");
  return match[0];
}

describe("the plan shape says the same thing everywhere", () => {
  it("the planning skill pastes the plan shape whole", () => {
    expect(planShapeInSkill()).toEqual(TODERO_PLAN_BLOCK_INSTRUCTIONS);
  });

  it("the shape a runtime enforces describes `after` the same way", () => {
    const description = TODERO_PLAN_JSON_SCHEMA.properties.tasks.items.properties.after.description;
    expect(description).toContain(afterLine());
    expect(description).toContain(reviewRule());
  });
});
