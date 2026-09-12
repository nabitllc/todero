/**
 * Shared utilities for detecting and parsing skill pack metadata.
 * These functions are used by both the server and UI to determine if a skill
 * belongs to the pack based on its metadata.
 */

/** The metadata key that marks a skill as part of the pack. */
export const SKILL_PACK_KINDS_KEY = "todero-task-kinds";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a `todero-task-kinds` value in any shape the frontmatter parser can
 * hand back: a real array, the flow-list string `"[a, b]"`, the plain string
 * `"a, b"`, a single kind `"a"`, or `"all"`.
 */
export function parseSkillPackKinds(value: unknown): "all" | string[] | null {
  const collected: string[] = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim().toLowerCase();
      if (trimmed) collected.push(trimmed);
    }
  } else if (typeof value === "string") {
    let text = value.trim();
    if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
    for (const entry of text.split(",")) {
      const trimmed = entry.trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (trimmed) collected.push(trimmed);
    }
  } else {
    return null;
  }

  if (collected.length === 0) return null;
  if (collected.includes("all")) return "all";
  return Array.from(new Set(collected));
}

/**
 * True when this skill belongs to the pack rather than the command-line set.
 * A skill is part of the pack when its metadata has a readable "todero-task-kinds" field.
 */
export function isSkillPackSkill(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  const kinds = parseSkillPackKinds(metadata[SKILL_PACK_KINDS_KEY]);
  return kinds !== null;
}
