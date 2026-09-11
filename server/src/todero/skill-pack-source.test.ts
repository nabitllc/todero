import { describe, expect, it } from "vitest";
import { SKILL_PACK_TASK_KINDS, skillPackAppliesToKind } from "./skill-pack.js";
import { readShippedPackSkill, readShippedPackSkills } from "./skill-pack-source.js";

/**
 * These run against the checkout's own `skills/` directory: a shipped file that
 * stops parsing is a shipped file the model silently stops reading.
 */
describe("the skills Todero ships", () => {
  it("finds the whole pack", async () => {
    const skills = await readShippedPackSkills();
    expect(skills.length).toBeGreaterThanOrEqual(10);
  });

  it("names each file after its folder and describes it in one line", async () => {
    for (const skill of await readShippedPackSkills()) {
      expect(skill.name).toBe(skill.slug);
      expect(skill.description ?? "").not.toBe("");
      expect((skill.description ?? "").length).toBeLessThanOrEqual(1024);
    }
  });

  it("names only turns Todero knows about", async () => {
    const known = new Set<string>(SKILL_PACK_TASK_KINDS);
    for (const skill of await readShippedPackSkills()) {
      if (skill.facts.kinds === "all") continue;
      for (const kind of skill.facts.kinds) {
        expect(known.has(kind), `${skill.slug} names an unknown kind of turn: ${kind}`).toBe(true);
      }
    }
  });

  it("gives every kind of turn at least one skill", async () => {
    const skills = await readShippedPackSkills();
    for (const kind of SKILL_PACK_TASK_KINDS) {
      expect(
        skills.some((skill) => skillPackAppliesToKind(skill.facts, kind)),
        `no shipped skill applies to a ${kind} turn`,
      ).toBe(true);
    }
  });

  it("leaves the command-line skills out of the pack", async () => {
    const slugs = (await readShippedPackSkills()).map((skill) => skill.slug);
    for (const commandLineSkill of ["todero", "todero-board", "todero-create-agent", "para-memory-files"]) {
      expect(slugs).not.toContain(commandLineSkill);
    }
  });

  it("carries the ten the pack was built from", async () => {
    const slugs = (await readShippedPackSkills()).map((skill) => skill.slug);
    for (const slug of [
      "todero-plan-a-project",
      "todero-when-to-hire",
      "todero-hand-off-a-task",
      "todero-review-against-done-when",
      "todero-ask-or-decide",
      "todero-files-with-the-work",
      "todero-propose-a-skill",
      "todero-retrospective",
      "todero-cost-and-time",
      "todero-talk-like-a-colleague",
    ]) {
      expect(slugs).toContain(slug);
    }
  });

  it("sends the right skills into a planning turn", async () => {
    const planning = (await readShippedPackSkills())
      .filter((skill) => skillPackAppliesToKind(skill.facts, "planning"))
      .map((skill) => skill.slug)
      .sort();
    expect(planning).toEqual([
      "todero-ask-or-decide",
      "todero-cost-and-time",
      "todero-hand-off-a-task",
      "todero-plan-a-project",
      "todero-talk-like-a-colleague",
      "todero-when-to-hire",
    ]);
  });

  it("gives the reviewer one skill of its own", async () => {
    const judging = (await readShippedPackSkills())
      .filter((skill) => skillPackAppliesToKind(skill.facts, "judging"))
      .map((skill) => skill.slug)
      .sort();
    expect(judging).toEqual(["todero-review-against-done-when"]);
  });

  it("reads one skill by its slug and nothing for a name it does not ship", async () => {
    expect((await readShippedPackSkill("todero-plan-a-project"))?.slug).toBe("todero-plan-a-project");
    expect(await readShippedPackSkill("not-a-skill")).toBeNull();
  });

  it("reads nothing when the checkout has no skills directory", async () => {
    expect(await readShippedPackSkills(["/definitely/not/a/real/path"])).toEqual([]);
  });
});
