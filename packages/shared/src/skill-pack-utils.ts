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

/**
 * How much of the pack one turn may carry, in characters.
 *
 * Sized to hold the whole pack for the busiest kind (a planning turn reads six
 * of the ten) with room for an organization's own edits, and to bite before a
 * person who has written four long skills of their own hands a small model
 * more rubrics than it can follow. Over the ceiling, the lowest-priority skill
 * goes first and a line about it reaches the task's log.
 */
export const SKILL_PACK_TEXT_CEILING = 20_000;

/**
 * Ollama serves a model with a 4,096-token window unless the person raised it
 * (OLLAMA_CONTEXT_LENGTH or a Modelfile), and the OpenAI-compatible endpoint
 * cannot ask for more per request. When nothing was detected, size for that.
 */
export const SKILL_PACK_DEFAULT_CONTEXT_LENGTH = 4096;

/** The share of the window the skills may take; the rest is the task, the thread and the reply. */
const SKILL_PACK_CONTEXT_SHARE = 0.35;

/** A rough characters-per-token ratio for English prose and markdown. */
const SKILL_PACK_CHARS_PER_TOKEN = 4;

/**
 * The ceiling for a runtime with this many tokens of context: a share of the
 * window in characters, never above the fixed ceiling. The server sizes the
 * pack with it on every turn; the wizard uses it to say when the window is
 * too small for the whole pack.
 */
export function skillPackCeilingForContext(contextLength: number | null | undefined): number {
  const tokens =
    typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength > 0
      ? contextLength
      : SKILL_PACK_DEFAULT_CONTEXT_LENGTH;
  return Math.min(SKILL_PACK_TEXT_CEILING, Math.floor(tokens * SKILL_PACK_CONTEXT_SHARE * SKILL_PACK_CHARS_PER_TOKEN));
}

/**
 * The model-facing size of the ten pack skills as shipped (frontmatter and the
 * "What Todero changed" notes left out), measured on 2026-09-11. A server test
 * keeps this within reach of the real files, so the wizard's hint stays honest.
 */
export const SKILL_PACK_FULL_CHARS = 15_893;

/** The window at which the whole pack fits, the value the wizard recommends. */
export const SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH = 16_384;

/** True when a runtime with this window carries the whole pack. */
export function skillPackFitsContext(contextLength: number): boolean {
  return skillPackCeilingForContext(contextLength) >= SKILL_PACK_FULL_CHARS;
}
