/**
 * Making the runtime hold the model to the plan's shape, instead of asking it
 * to remember one.
 *
 * Observed: a 14B model on Ollama, forty comments into an onboarding thread,
 * answered "Do you approve this plan?" fifteen times and never wrote a fenced
 * block, so there was never anything to approve. Two earlier organizations the
 * same day, same model, same prompts, wrote the block fine. Asking nicely is
 * not a mechanism.
 *
 * Where the runtime can enforce a shape it is enforced, and only there and
 * only then:
 *
 * - Only Ollama. It is the one endpoint Todero can be sure reads a schema
 *   (`format` on its own `/api/chat`, `response_format` on its OpenAI-shaped
 *   one). Anywhere else the request goes out exactly as it does today.
 * - Only on the turn where Todero itself is asking for the plan and nothing
 *   else — the corrective turn after a plan was claimed and never written.
 *   A schema constrains the whole reply, so a conversational turn must never
 *   carry one or the agent would answer every question in JSON.
 *
 * And the prose path stays: if the runtime ignores the schema, or answers
 * with a fenced block anyway, the reply is read the way it always was.
 */
import { formatToderoPlanBlock } from "@todero/shared";
import {
  TODERO_PLAN_JSON_SCHEMA,
  TODERO_PLAN_JSON_SCHEMA_NAME,
  parseToderoPlanJson,
  readToderoPlanJsonAttempt,
} from "@todero/shared/todero-plan-schema";
import { parseObject } from "../utils.js";
import { CHAT_COMPLETIONS_STATUS_WAITING, isOllamaChatCompletionsConfig } from "./chat-completions.js";

/** The fenced plan template, wherever Todero spells it out for the model. */
const PLAN_FENCE_ASKED_RE = /(?:^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*todero-plan\b/i;

/**
 * Is this turn one where Todero asked for the plan itself? Only Todero's own
 * turn instruction counts — the task description carries the plan template for
 * the whole life of the conversation, and a schema on every turn of that
 * conversation would turn ordinary answers into JSON.
 */
export function turnAsksForThePlan(context: Record<string, unknown>): boolean {
  const instruction = context.toderoTurnInstruction;
  return typeof instruction === "string" && PLAN_FENCE_ASKED_RE.test(instruction);
}

/** True when this request should carry the schema. */
export function shouldAskForStructuredPlan(input: {
  config: Record<string, unknown>;
  context: Record<string, unknown>;
}): boolean {
  return turnAsksForThePlan(input.context) && isOllamaChatCompletionsConfig(input.config);
}

/** The OpenAI-compatible way to ask: `response_format` with the schema in it. */
export function planResponseFormat(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: TODERO_PLAN_JSON_SCHEMA_NAME,
      strict: true,
      schema: TODERO_PLAN_JSON_SCHEMA,
    },
  };
}

/** Ollama's own way to ask: the bare schema in `format`. */
export function planNativeFormat(): Record<string, unknown> {
  return TODERO_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>;
}

/** The schema inside a `response_format`, or null when that is not what it is. */
export function readPlanNativeFormat(responseFormat: unknown): Record<string, unknown> | null {
  const record = parseObject(responseFormat);
  if (record.type !== "json_schema") return null;
  const schema = parseObject(parseObject(record.json_schema).schema);
  return Object.keys(schema).length > 0 ? schema : null;
}

/**
 * A reply the runtime shaped, rewritten as the reply the rest of Todero
 * already knows how to read: the words for the person, the canonical fenced
 * block, and the status line a plan waits on. Null when the reply is not a
 * plan object — the caller then reads it as prose, unchanged.
 */
export function replyFromStructuredPlan(text: string): string | null {
  const read = parseToderoPlanJson(text);
  if (!read) return null;
  return [read.body, formatToderoPlanBlock(read.plan), CHAT_COMPLETIONS_STATUS_WAITING]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** What a person is told when the shaped reply carried no words of its own. */
export const STRUCTURED_PLAN_UNREADABLE_NOTE =
  "I could not write the plan in a shape Todero could read. Ask me for it again and I will write it out.";

/**
 * The reply to post when the runtime honoured the schema but what came back
 * is not a plan Todero can use — the wrong shape, no features or tasks, or
 * cut off mid-object when the room ran out.
 *
 * The person gets the object's own `message`, or one plain sentence. They are
 * never shown the JSON: a raw blob in the thread reads as a broken agent, and
 * before the schema this same turn produced prose. Null when the reply was
 * never an attempt at the object, which is the prose path, unchanged.
 */
export function replyWhenStructuredPlanUnreadable(text: string): string | null {
  const attempt = readToderoPlanJsonAttempt(text);
  if (!attempt) return null;
  return attempt.message.trim() || STRUCTURED_PLAN_UNREADABLE_NOTE;
}
