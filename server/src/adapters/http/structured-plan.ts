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
import { formatToderoPlanBlock, spellsOutToderoPlanBlock } from "@todero/shared";
import {
  TODERO_PLAN_JSON_SCHEMA,
  TODERO_PLAN_JSON_SCHEMA_NAME,
  parseToderoPlanJson,
  readToderoPlanJsonAttempt,
  scanToderoPlanJsonBlobs,
} from "@todero/shared/todero-plan-schema";
import { parseObject } from "../utils.js";
import {
  CHAT_COMPLETIONS_STATUS_WAITING,
  isOllamaChatCompletionsConfig,
  parseChatCompletionsReply,
} from "./chat-completions.js";

/**
 * Is this turn one where Todero asked for the plan itself? Only Todero's own
 * turn instruction counts — the task description carries the plan template for
 * the whole life of the conversation, and a schema on every turn of that
 * conversation would turn ordinary answers into JSON.
 */
export function turnAsksForThePlan(context: Record<string, unknown>): boolean {
  const instruction = context.toderoTurnInstruction;
  return typeof instruction === "string" && spellsOutToderoPlanBlock(instruction);
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

/**
 * The schema inside a `response_format`, or null when that is not what it is.
 *
 * This is the whole of the native path: the adapter builds one OpenAI-shaped
 * body, and the Ollama-native call lifts the bare schema back out of it for
 * `format`. There is deliberately no second builder for the native shape —
 * one body, read two ways.
 */
export function readPlanNativeFormat(responseFormat: unknown): Record<string, unknown> | null {
  const record = parseObject(responseFormat);
  if (record.type !== "json_schema") return null;
  const schema = parseObject(parseObject(record.json_schema).schema);
  return Object.keys(schema).length > 0 ? schema : null;
}

/**
 * The model's own words in one stretch of the reply. A status line it wrote
 * around the JSON goes: Todero appends the one status the turn is entitled
 * to, and a stray `STATUS: done` in kept prose would close a task on a plan
 * nobody has approved.
 */
function wordsBetween(text: string, from: number, to: number): string {
  if (to <= from) return "";
  return parseChatCompletionsReply(text.slice(from, to)).body.trim();
}

/**
 * A reply the runtime shaped, rewritten as the reply the rest of Todero
 * already knows how to read: the words for the person, the canonical fenced
 * block, and the status line a plan waits on.
 *
 * Words the model wrote around the JSON are kept; every blob it wrote is
 * spliced out, not just the one the plan was read from. A model that puts a
 * scratch object in front of the plan, a token count after it, or a fenced
 * `json` block beside it is writing machine-readable text a person must
 * never be handed — only the plan itself earns a place in the reply, as the
 * canonical block.
 *
 * Null when no JSON in the reply reads as a plan — the caller then reads it
 * as prose, unchanged.
 */
export function replyFromStructuredPlan(text: string): string | null {
  const { blobs, scannedAll } = scanToderoPlanJsonBlobs(text);
  const plans = blobs.map((blob) => parseToderoPlanJson(blob.source));
  const planIndex = plans.findIndex((plan) => plan !== null);
  const read = planIndex < 0 ? null : plans[planIndex]!;
  if (!read) return null;
  // Past the cap there is text nobody scanned, and the reason the scan
  // stopped is that it was still finding JSON. The plan survives; the words
  // around it do not, because some of them are the blobs that were never read.
  const parts: string[] = [];
  let cursor = 0;
  blobs.forEach((blob, index) => {
    if (scannedAll) parts.push(wordsBetween(text, cursor, blob.start));
    if (index === planIndex) parts.push(read.body);
    cursor = blob.end;
  });
  if (scannedAll) parts.push(wordsBetween(text, cursor, text.length));
  const words = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  return [words, formatToderoPlanBlock(read.plan), CHAT_COMPLETIONS_STATUS_WAITING]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** What a person is told when the shaped reply carried no words of its own. */
export const STRUCTURED_PLAN_UNREADABLE_NOTE =
  "I could not write the plan in a shape Todero could read. Ask me for it again and I will write it out.";

/**
 * The reply to post when what came back carries JSON that is not a plan
 * Todero can use — the wrong shape, no features or tasks, an array instead
 * of an object, or cut off mid-object when the room ran out.
 *
 * Every blob is replaced by its own words, and everything the model wrote
 * around them is kept: a person is never shown JSON, and never loses the
 * sentence the model wrote next to it. One plain sentence when there were no
 * words anywhere. Null when the reply holds no JSON at all, which is the
 * prose path, unchanged.
 *
 * A reply with more blobs than the scanner reads gets that one plain
 * sentence and nothing else. The cap bounds a pathological reply; handing
 * back the part of it nobody scanned would make the cap the one thing that
 * shows a person the JSON.
 */
export function replyWhenStructuredPlanUnreadable(text: string): string | null {
  const { blobs, scannedAll } = scanToderoPlanJsonBlobs(text);
  if (blobs.length === 0) return null;
  if (!scannedAll) return STRUCTURED_PLAN_UNREADABLE_NOTE;
  const parts: string[] = [];
  let cursor = 0;
  for (const blob of blobs) {
    parts.push(wordsBetween(text, cursor, blob.start));
    parts.push(readToderoPlanJsonAttempt(blob.source)?.message ?? "");
    cursor = blob.end;
  }
  parts.push(wordsBetween(text, cursor, text.length));
  const shown = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  return shown || STRUCTURED_PLAN_UNREADABLE_NOTE;
}
