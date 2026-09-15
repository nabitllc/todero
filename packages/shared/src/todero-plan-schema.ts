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
 * The JSON object in the reply. Usually the whole reply, because that is what
 * the schema forces; a runtime that only half-honours it wraps the object in a
 * fence or puts a sentence in front, so the first `{` to the last `}` is tried
 * as well.
 */
function findJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = trimmed.match(/(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*\n([\s\S]*?)\n\s*(?:`{3,}|~{3,})/);
  if (fenced) candidates.push(fenced[1]!);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = asRecord(JSON.parse(candidate) as unknown);
      if (parsed) return parsed;
    } catch {
      // Not this candidate; try the next shape.
    }
  }
  return null;
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
  const record = findJsonObject(typeof text === "string" ? text : "");
  if (!record) return null;
  const goal = readString(record.goal);
  if (!goal) return null;
  const features = readFeatures(record.features);
  const tasks = readTasks(record.tasks);
  // The same rule the fenced parser uses: features and no tasks is still a
  // plan — one task per feature, handing in what its done_when asks for.
  const plannedTasks = tasks.length > 0 ? tasks : tasksFromFeatures(features);
  if (plannedTasks.length === 0) return null;
  return { plan: { goal, features, tasks: plannedTasks }, body: readString(record.message) };
}

/**
 * The part of a reply that is trying to be the JSON object — the whole reply,
 * or the inside of a fence the runtime wrapped it in. Null when the reply is
 * not an attempt at the object at all, so prose (with or without a fenced
 * `todero-plan` block) is left alone.
 */
function jsonObjectAttempt(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/(?:`{3,}|~{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*\n([\s\S]*?)(?:\n[ \t]*(?:`{3,}|~{3,})|$)/);
  const inner = (fenced ? fenced[1]! : trimmed).trim();
  return inner.startsWith("{") ? inner : null;
}

/** A complete JSON string value for `message`, even inside an object that never closes. */
const PLAN_JSON_MESSAGE_RE = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/**
 * The words for the person out of a shaped reply that is *not* a usable plan:
 * the wrong shape, no features or tasks, or cut off mid-object when the
 * runtime ran out of room. Null when the reply was never an attempt at the
 * object — the caller reads that as prose, unchanged.
 *
 * `message` is empty when the attempt carries no words of its own. It is
 * never the JSON itself: a person must not be shown the blob.
 */
export function readToderoPlanJsonAttempt(text: string): { message: string } | null {
  const attempt = jsonObjectAttempt(typeof text === "string" ? text : "");
  if (attempt === null) return null;
  const record = findJsonObject(attempt);
  if (record) return { message: readString(record.message) };
  // Nothing parses when the object never closes. `message` is the first field
  // the schema asks for, so it is usually written before the room runs out.
  const match = attempt.match(PLAN_JSON_MESSAGE_RE);
  if (!match) return { message: "" };
  try {
    return { message: readString(JSON.parse(`"${match[1]!}"`) as unknown) };
  } catch {
    return { message: "" };
  }
}
