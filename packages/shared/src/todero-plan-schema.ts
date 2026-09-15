/**
 * The plan, as a shape a runtime can enforce.
 *
 * `todero-plan.ts` asks a model, in words, to write the plan inside a fenced
 * block. A small model gets that right most of the time and then stops
 * getting it right: late in a long thread it says "Do you approve this plan?"
 * and writes no block at all, and there is nothing for the person to approve.
 *
 * Where the runtime can hold the model to a shape, it should. Ollama takes a
 * JSON schema in `format`, and an OpenAI-compatible endpoint takes the same
 * schema in `response_format: { type: "json_schema" }`. The model then cannot
 * reply with anything but a plan. This file is that schema and the reader for
 * what comes back; the fenced-block parser stays exactly where it was, for
 * every endpoint and every turn that does not use this.
 */
import { TODERO_PLAN_MAX_FEATURES, TODERO_PLAN_MAX_TASKS, tasksFromFeatures } from "./todero-plan.js";
import type { ToderoPlan, ToderoPlanFeature, ToderoPlanTask } from "./todero-plan.js";

/** What the endpoint calls the schema. Only OpenAI-shaped requests carry it. */
export const TODERO_PLAN_JSON_SCHEMA_NAME = "todero_plan";

/**
 * Every field is required and nothing else is allowed: strict mode on an
 * OpenAI-compatible endpoint rejects a schema with optional properties, and a
 * model told a field is optional leaves it out. `after` and `message` are
 * required but may be empty strings, which is how a model says "nothing".
 */
export const TODERO_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "One or two sentences for the person, in plain words. Empty if you have nothing to add.",
    },
    goal: {
      type: "string",
      description: "One sentence: what we are building and for whom.",
    },
    features: {
      type: "array",
      description: `Three to seven features, at most ${TODERO_PLAN_MAX_FEATURES}.`,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short feature name." },
          why: { type: "string", description: "One line on why it matters." },
          done_when: { type: "string", description: "One line that says how we know it is finished." },
        },
        required: ["name", "why", "done_when"],
        additionalProperties: false,
      },
    },
    tasks: {
      type: "array",
      description: `Four to twelve tasks, at most ${TODERO_PLAN_MAX_TASKS}, each naming one of the features.`,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "An imperative task title." },
          feature: { type: "string", description: "The feature name it belongs to." },
          output: { type: "string", description: "What you will hand in for it." },
          after: {
            type: "string",
            description: "The title of the task that has to finish first. Empty when nothing has to come first.",
          },
        },
        required: ["title", "feature", "output", "after"],
        additionalProperties: false,
      },
    },
  },
  required: ["message", "goal", "features", "tasks"],
  additionalProperties: false,
} as const;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * A piece of JSON the model wrote into a reply, and where it sits in the
 * text. Usually the whole reply, because that is what the schema forces; a
 * runtime that only half-honours it puts a sentence in front, wraps the
 * object in a fence, hands back an array, or runs out of room mid-object.
 * All four still have to be found, because the caller's job is to make sure
 * no part of one is ever shown to a person.
 */
export type ToderoPlanJsonBlob = {
  /** Where the blob starts, taking in a fence the model wrapped it in. */
  start: number;
  /** Just past the blob, and past that fence. */
  end: number;
  /** The JSON text itself, without the fence around it. */
  source: string;
  /** What it parses to, or null when it never closed or never parsed. */
  value: unknown;
};

/** Enough for any real reply, and a bound on a pathological one. */
const MAX_JSON_BLOBS = 8;

/** A fence line the model opened right before the blob. */
const FENCE_BEFORE_RE = /(?:^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n$/;
/** The fence line that closes it, on the blob's heels. */
const FENCE_AFTER_RE = /^[ \t]*\r?\n?[ \t]*(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*/;

/**
 * Where the JSON value opened at `start` ends — the matching brace, honouring
 * strings and escapes, or the end of the text when it never closes.
 */
function scanJsonValue(text: string, start: number): { end: number; complete: boolean } {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return { end: i + 1, complete: true };
    }
  }
  return { end: text.length, complete: false };
}

/** A brace in ordinary prose is not an attempt at JSON; `{"` or `[{` is. */
function looksLikeJsonStart(text: string, index: number): boolean {
  // Wide enough for any amount of pretty-printed indentation before the
  // first key, narrow enough that a stray brace in prose stays prose.
  const rest = text.slice(index + 1, index + 400).trimStart();
  if (text[index] === "{") return rest.startsWith('"');
  return rest.startsWith("{") || rest.startsWith('"');
}

/** The blob's span, widened over a fence the model wrapped it in. */
function spanOverFence(text: string, start: number, end: number): { start: number; end: number } {
  const before = text.slice(0, start).match(FENCE_BEFORE_RE);
  const after = text.slice(end).match(FENCE_AFTER_RE);
  return {
    start: before ? start - before[0].length + (before[0].startsWith("\n") ? 1 : 0) : start,
    end: after ? end + after[0].length : end,
  };
}

/**
 * Every piece of JSON in a reply, in the order it appears — wherever it sits,
 * fenced or bare, object or array, closed or cut off.
 */
export function findToderoPlanJsonBlobs(text: string): ToderoPlanJsonBlob[] {
  const blobs: ToderoPlanJsonBlob[] = [];
  if (typeof text !== "string" || !text.trim()) return blobs;
  let i = 0;
  while (i < text.length && blobs.length < MAX_JSON_BLOBS) {
    const ch = text[i]!;
    if ((ch === "{" || ch === "[") && looksLikeJsonStart(text, i)) {
      const { end, complete } = scanJsonValue(text, i);
      const source = text.slice(i, end);
      let value: unknown = null;
      if (complete) {
        try {
          value = JSON.parse(source) as unknown;
        } catch {
          // Close enough to JSON to hide from a person, too broken to read.
        }
      }
      blobs.push({ ...spanOverFence(text, i, end), source, value });
      i = end;
      continue;
    }
    i++;
  }
  return blobs;
}

/**
 * The records worth reading a plan out of: the object itself, and the entries
 * of an array when the model answered with one.
 */
function planRecordsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_JSON_BLOBS).flatMap((entry) => {
      const record = asRecord(entry);
      return record ? [record] : [];
    });
  }
  const record = asRecord(value);
  return record ? [record] : [];
}

/**
 * The words for the person in a record. A model told to write `message`
 * writes `body` about as often, and the live reply that forced this file to
 * be rewritten used `body`.
 */
function readWords(record: Record<string, unknown> | null): string {
  if (!record) return "";
  return readString(record.message) || readString(record.body);
}

function readFeatures(value: unknown): ToderoPlanFeature[] {
  if (!Array.isArray(value)) return [];
  const features: ToderoPlanFeature[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const name = row ? readString(row.name) || readString(row.title) : readString(entry);
    if (!name) continue;
    features.push({
      id: `f${features.length + 1}`,
      name,
      why: row ? readString(row.why) : "",
      doneWhen: row ? readString(row.done_when) || readString(row.doneWhen) : "",
    });
    if (features.length >= TODERO_PLAN_MAX_FEATURES) break;
  }
  return features;
}

function readTasks(value: unknown): ToderoPlanTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: ToderoPlanTask[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const title = row ? readString(row.title) || readString(row.name) : readString(entry);
    if (!title) continue;
    tasks.push({
      id: `t${tasks.length + 1}`,
      title,
      feature: row ? readString(row.feature) : "",
      output: row ? readString(row.output) : "",
      after: row ? readString(row.after) : "",
    });
    if (tasks.length >= TODERO_PLAN_MAX_TASKS) break;
  }
  return tasks;
}

/**
 * The plan in a reply the runtime shaped, and `body` — the words for the
 * person that went with it. Null when the reply is not a plan object at all:
 * the caller then reads it the way it always did, as prose with a fenced
 * block somewhere in it.
 */
export function parseToderoPlanJson(text: string): { plan: ToderoPlan; body: string } | null {
  for (const blob of findToderoPlanJsonBlobs(typeof text === "string" ? text : "")) {
    for (const record of planRecordsFrom(blob.value)) {
      const read = readPlanFromRecord(record);
      if (read) return read;
    }
  }
  return null;
}

/**
 * One record read as a plan. The fields may be at the top, or one level down
 * under `plan` — a model that half-honours the schema files them there and
 * keeps its words at the top, and a plan filed that way is still a plan.
 */
function readPlanFromRecord(record: Record<string, unknown>): { plan: ToderoPlan; body: string } | null {
  const nested = asRecord(record.plan);
  const source = readString(record.goal) ? record : (nested ?? record);
  const goal = readString(source.goal);
  if (!goal) return null;
  const features = readFeatures(source.features);
  const tasks = readTasks(source.tasks);
  // The same rule the fenced parser uses: features and no tasks is still a
  // plan — one task per feature, handing in what its done_when asks for.
  const plannedTasks = tasks.length > 0 ? tasks : tasksFromFeatures(features);
  if (plannedTasks.length === 0) return null;
  return { plan: { goal, features, tasks: plannedTasks }, body: readWords(record) || readWords(source) };
}

/**
 * A complete JSON string value for the words, even inside an object that
 * never closes.
 */
const PLAN_JSON_WORDS_RE = /"(?:message|body)"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/** The words in one blob, without ever handing back any of the JSON around them. */
function readBlobWords(blob: ToderoPlanJsonBlob): string {
  for (const record of planRecordsFrom(blob.value)) {
    const words = readWords(record) || readWords(asRecord(record.plan));
    if (words) return words;
  }
  if (blob.value !== null) return "";
  // Nothing parses when the object never closes. The words are the first
  // field the schema asks for, so they are usually written before the room
  // runs out.
  const match = blob.source.match(PLAN_JSON_WORDS_RE);
  if (!match) return "";
  try {
    return readString(JSON.parse(`"${match[1]!}"`) as unknown);
  } catch {
    return "";
  }
}

/**
 * The words for the person out of a reply that is *not* a usable plan: the
 * wrong shape, no features or tasks, an array instead of an object, or cut
 * off mid-object when the runtime ran out of room. Null when the reply holds
 * no JSON at all — the caller reads that as prose, unchanged.
 *
 * `message` is empty when the JSON carries no words of its own. It is never
 * the JSON itself: a person must not be shown the blob.
 */
export function readToderoPlanJsonAttempt(text: string): { message: string } | null {
  const blobs = findToderoPlanJsonBlobs(typeof text === "string" ? text : "");
  if (blobs.length === 0) return null;
  for (const blob of blobs) {
    const words = readBlobWords(blob);
    if (words) return { message: words };
  }
  return { message: "" };
}
