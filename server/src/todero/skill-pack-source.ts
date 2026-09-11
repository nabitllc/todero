/**
 * The skills Todero ships, read straight off disk.
 *
 * These files under `skills/` are the reset target: an organization gets its
 * own copy of each one, the person edits the copy, and "Reset to the original"
 * puts the shipped text back. Nothing here touches the database.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFrontmatterMarkdown } from "@todero/shared";
import { readSkillPackFacts, type SkillPackFacts } from "./skill-pack.js";

export interface ShippedPackSkill {
  /** The folder name, which equals the frontmatter name. */
  slug: string;
  name: string;
  description: string | null;
  /** The whole SKILL.md, frontmatter included. */
  markdown: string;
  facts: SkillPackFacts;
}

/**
 * Where `skills/` sits relative to the built server, the source tree and the
 * working directory. The same three candidates the bundled-skill importer
 * uses, so both find the same checkout.
 */
export function resolveShippedSkillsRoots(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(moduleDir, "../../../skills"),
  ];
}

/**
 * Every shipped skill that carries pack metadata, sorted by slug so two reads
 * of the same checkout produce the same order.
 *
 * A skill without `todero-task-kinds` is one of the command-line skills and is
 * deliberately skipped: those mount the way they always have.
 */
export async function readShippedPackSkills(
  roots: string[] = resolveShippedSkillsRoots(),
): Promise<ShippedPackSkill[]> {
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;

    const skills: ShippedPackSkill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const markdown = await fs
        .readFile(path.join(root, entry.name, "SKILL.md"), "utf8")
        .catch(() => null);
      if (!markdown) continue;

      const parsed = parseFrontmatterMarkdown(markdown);
      const facts = readSkillPackFacts(parsed.frontmatter.metadata);
      if (!facts) continue;

      const name = typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name.trim() : "";
      if (name !== entry.name) continue;

      const description = typeof parsed.frontmatter.description === "string"
        ? parsed.frontmatter.description.trim() || null
        : null;
      skills.push({ slug: entry.name, name, description, markdown, facts });
    }

    if (skills.length > 0) {
      return skills.sort((left, right) => left.slug.localeCompare(right.slug));
    }
  }
  return [];
}

/** One shipped skill by its slug, or null when this checkout does not have it. */
export async function readShippedPackSkill(
  slug: string,
  roots: string[] = resolveShippedSkillsRoots(),
): Promise<ShippedPackSkill | null> {
  const skills = await readShippedPackSkills(roots);
  return skills.find((skill) => skill.slug === slug) ?? null;
}
