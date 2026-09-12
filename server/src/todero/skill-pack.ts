/**
 * The skill pack: the short pieces of know-how an organization's agents read,
 * one set per kind of turn.
 *
 * The rows come from the organization's own copies (companySkills), so an edit
 * a person makes on the Skills page is what the model reads on the next turn.
 * A pack skill is any skill whose frontmatter metadata carries
 * `todero-task-kinds`; everything else on the Skills page (the command-line
 * skills, anything imported) is left alone.
 *
 * Note on parsing: the repo's frontmatter parser returns a YAML flow list
 * (`[planning, drafting]`) as the literal string `"[planning, drafting]"`, so
 * every reader here accepts a string as well as an array.
 */

import type { CompanySkill } from "@todero/shared";
import { parseFrontmatterMarkdown, parseSkillPackKinds, isSkillPackSkill } from "@todero/shared";
import { readToderoSkillSyncPreference } from "@todero/adapter-utils/server-utils";

/** The turn kinds model routing labels a turn with, plus the reviewer's own. */
export const SKILL_PACK_TASK_KINDS = ["planning", "drafting", "judging", "wrap-up"] as const;

/**
 * Kinds that are not one of the agent's own turns.
 *
 * The reviewer never goes through the worker's message path: it is a separate
 * model call with one job, and its whole brief is the one skill about reviewing
 * against a done-when line. A skill written for every turn ("all") is written
 * for the agent's turns, so it stops here rather than becoming a second rubric
 * for a reviewer that was asked for a verdict.
 */
export const SKILL_PACK_OUT_OF_BAND_KINDS = new Set<string>(["judging"]);

/** The metadata key that marks a skill as part of the pack. */
export const SKILL_PACK_KINDS_KEY = "todero-task-kinds";

/** The metadata key that orders the pack; 1 is the highest. */
export const SKILL_PACK_PRIORITY_KEY = "todero-priority";

/** A skill with no stated priority sorts last. */
export const SKILL_PACK_DEFAULT_PRIORITY = 99;

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
 * window in characters, never above the fixed ceiling.
 */
export function skillPackCeilingForContext(contextLength: number | null | undefined): number {
  const tokens =
    typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength > 0
      ? contextLength
      : SKILL_PACK_DEFAULT_CONTEXT_LENGTH;
  return Math.min(SKILL_PACK_TEXT_CEILING, Math.floor(tokens * SKILL_PACK_CONTEXT_SHARE * SKILL_PACK_CHARS_PER_TOKEN));
}

/** The heading that opens the part of a skill written for the person, not the model. */
const SKILL_PACK_NOTES_HEADING_RE = /^##\s+What Todero changed\s*$/im;

/**
 * The body as the model should read it: everything up to the "What Todero
 * changed" section, which names sources and dropped parts for the person and
 * only spends the model's window.
 */
export function skillBodyForModel(body: string): string {
  const match = SKILL_PACK_NOTES_HEADING_RE.exec(body);
  return (match ? body.slice(0, match.index) : body).trim();
}

/** The heading the pack text opens with. */
export const SKILL_PACK_HEADING = "What you know";

export interface SkillPackFacts {
  /** The kinds of turn this skill applies to, or "all" for every turn. */
  kinds: "all" | string[];
  /** 1 is the highest; a skill with none stated sorts last. */
  priority: number;
}

export interface SkillPackEntry {
  key: string;
  name: string;
  facts: SkillPackFacts;
  /** The skill body, with its frontmatter removed. */
  body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The pack facts on a skill's stored metadata, or null when the skill is not
 * part of the pack.
 */
export function readSkillPackFacts(metadata: unknown): SkillPackFacts | null {
  if (!isRecord(metadata)) return null;
  const kinds = parseSkillPackKinds(metadata[SKILL_PACK_KINDS_KEY]);
  if (!kinds) return null;

  const rawPriority = metadata[SKILL_PACK_PRIORITY_KEY];
  const priority = typeof rawPriority === "number" && Number.isFinite(rawPriority)
    ? rawPriority
    : typeof rawPriority === "string" && /^-?\d+$/.test(rawPriority.trim())
      ? Number(rawPriority.trim())
      : SKILL_PACK_DEFAULT_PRIORITY;

  return { kinds, priority };
}

/**
 * True when this skill's frontmatter names this kind of turn (or every turn).
 *
 * "Every turn" means every turn the agent itself takes. A kind that is out of
 * band — the reviewer's — has to be named outright, so only a skill written
 * for reviewing reaches the reviewer.
 */
export function skillPackAppliesToKind(facts: SkillPackFacts, kind: string): boolean {
  const wanted = kind.trim().toLowerCase();
  if (facts.kinds === "all") return !SKILL_PACK_OUT_OF_BAND_KINDS.has(wanted);
  return facts.kinds.includes(wanted);
}

/**
 * The pack entries among a set of skill rows, highest priority first and, at
 * equal priority, in a stable order by name so two turns read the same thing.
 */
export function toSkillPackEntries(skills: CompanySkill[]): SkillPackEntry[] {
  const entries: SkillPackEntry[] = [];
  for (const skill of skills) {
    const facts = readSkillPackFacts(skill.metadata);
    if (!facts) continue;
    const body = parseFrontmatterMarkdown(typeof skill.markdown === "string" ? skill.markdown : "").body.trim();
    if (!body) continue;
    entries.push({ key: skill.key, name: skill.name || skill.slug || skill.key, facts, body });
  }
  return entries.sort((left, right) => (
    left.facts.priority - right.facts.priority || left.name.localeCompare(right.name)
  ));
}

export interface SkillPackText {
  /** The text to hand the model, or "" when nothing applies. */
  text: string;
  /** The names left out because the turn was already over the ceiling. */
  dropped: string[];
  /** The names that made it in, highest priority first. */
  included: string[];
}

/**
 * Build the text for one kind of turn: every applicable entry, highest
 * priority first, stopping at the ceiling. Anything past the ceiling is
 * reported rather than trimmed mid-sentence.
 *
 * The stop is a stop, not a skip: the first entry that does not fit ends the
 * turn's reading, and everything below it in priority order sits out too.
 * Trying the next one instead would let a one-line low-priority skill in ahead
 * of the long high-priority skill it displaced, which is the opposite of what
 * the priority field is for.
 */
export function buildSkillPackText(
  entries: SkillPackEntry[],
  kind: string,
  ceiling: number = SKILL_PACK_TEXT_CEILING,
): SkillPackText {
  const applicable = entries.filter((entry) => skillPackAppliesToKind(entry.facts, kind));
  if (applicable.length === 0) return { text: "", dropped: [], included: [] };

  const blocks: string[] = [];
  const included: string[] = [];
  const dropped: string[] = [];
  let used = 0;

  for (let index = 0; index < applicable.length; index += 1) {
    const entry = applicable[index]!;
    const block = `## ${entry.name}\n\n${skillBodyForModel(entry.body)}`;
    const cost = block.length + (blocks.length > 0 ? 2 : 0);
    if (blocks.length > 0 && used + cost > ceiling) {
      for (const left of applicable.slice(index)) dropped.push(left.name);
      break;
    }
    blocks.push(block);
    included.push(entry.name);
    used += cost;
  }

  return { text: `${SKILL_PACK_HEADING}\n\n${blocks.join("\n\n")}`, dropped, included };
}

/**
 * What this agent knows for this kind of turn: the pack skills turned on for
 * it, filtered to the kind and capped.
 *
 * An agent with nothing turned on gets nothing, and the caller sends exactly
 * the messages it sent before the pack existed.
 */
export function loadAgentSkillText(input: {
  agent: { adapterConfig: unknown };
  kind: string;
  companySkills: CompanySkill[];
  /** The runtime's context window in tokens, when known; sizes the ceiling. */
  contextLength?: number | null;
}): SkillPackText {
  const config = isRecord(input.agent.adapterConfig) ? input.agent.adapterConfig : {};
  const turnedOn = new Set(readToderoSkillSyncPreference(config).desiredSkills);
  if (turnedOn.size === 0) return { text: "", dropped: [], included: [] };

  const entries = toSkillPackEntries(input.companySkills).filter((entry) => turnedOn.has(entry.key));
  if (entries.length === 0) return { text: "", dropped: [], included: [] };

  return buildSkillPackText(entries, input.kind, skillPackCeilingForContext(input.contextLength));
}
