/**
 * The work a task asked for has arrived. Two things follow from that, and this
 * is where both live.
 *
 * Wave 2 of the improvement loop (PR #118) started handing a task the finished
 * work of the tasks it waited on. It arrived, and the task went on asking for
 * it anyway. Wave 16 and its recovery are the case: ZZGAAA-5 asked for the four
 * drafts in forty-one of its forty-two turns — "Could you please provide the
 * four draft guides", then "I am still waiting for the four draft guides" —
 * long after they were in hand. The reason was in its own thread. It had said
 * that a dozen times before the work arrived, and a small local model reads its
 * own last turns as the pattern to follow.
 *
 * Wave 18's twenty-one repeats on ZZGAAAAA-3 look the same from a distance but
 * are not this: that task repeated a clarifying question ("Do you want the
 * notes to include both light requirements and watering frequency?"), and none
 * of its twenty-one turns asks for missing work. A repeated question is a
 * different fault and is not fixed here.
 *
 * So when the work is there:
 *
 *  - the task's own earlier turns asking for it are left out of the thread it
 *    reads. What the person said and what the reviewer said always stay: they
 *    are the other side of the conversation, not the loop.
 *  - it is told, in one sentence, that what it asked for is in front of it and
 *    that this turn is for doing the task. Only when Todero has nothing more
 *    specific to say — the wrap-up and the manager instructions win.
 *
 * Both rules are pure. Nothing here reads the database or the run.
 */
import { TASK_INPUTS_HEADING } from "../adapters/http/prompt-budget.js";
import type { ConversationTurn } from "./conversation-thread.js";

/** One predecessor's finished work, as the turn carries it. */
export type ArrivedInput = {
  identifier: string | null;
  title: string;
  body: string;
};

/**
 * The shapes a turn takes when it is asking for work it has not got. Narrow on
 * purpose, and narrowed again after review: anything that is not plainly a
 * request for the missing work stays in the thread, because losing a hand-in
 * costs far more than leaving one stale sentence in. A task the reviewer sends
 * back wakes with the earlier work in hand, and if its own hand-in went missing
 * it would simply write that work a second time.
 *
 * Three rules follow from that, and each is why a line below reads as it does:
 *
 *  - a turn that puts something on the table is never a request, whatever else
 *    it says. "I cannot finish the fourth guide without the plant list. Here
 *    are the three I have." is a delivery with a caveat.
 *  - waiting for a review, an answer or a go-ahead is not waiting for work.
 *    "Handing this in. I will wait for your review." is how a hand-in ends.
 *  - what is asked for has to be the work itself — the drafts, the guides, the
 *    documents, or a plain "them". A question about some other detail ("can you
 *    provide the brand colours?") is a question, and questions stay.
 */

/** The turn is handing something over. Nothing in it is a request for work. */
const HANDS_WORK_IN =
  /\b(?:here\s+(?:is|are)|here's|handing\s+(?:this|it|these)\s+in|handed\s+in\s+(?:the|my)|below\s+(?:is|are)|attached\s+(?:is|are|you)|i(?:\s+have|'ve)\s+(?:written|drafted|attached|completed|finished|prepared|put\s+together)|(?:this|these|that)\s+(?:is|are)\s+the\s+(?:finished|completed|final|revised))\b/i;

/** The work itself, named the way a task names it while it is missing it. */
const THE_MISSING_WORK =
  "(?:the\\s+|those\\s+|these\\s+|your\\s+|a\\s+copy\\s+of\\s+the\\s+)?(?:\\w+\\s+){0,2}" +
  "(?:drafts?|guides?|documents?|files?|deliverables?|outputs?|contents?|materials?|write-?ups?|work|results?|them|those|these|it)\\b";

const CANNOT_GO_ON =
  /\b(cannot|can'?t|unable to)\b[^.?!]{0,40}\b(review|complete|proceed|continue|start|begin|finish|go ahead|move forward)\b/i;
const NEEDS_IT = new RegExp("\\b(?:i|we)\\s+(?:still\\s+)?(?:need|require)\\s+" + THE_MISSING_WORK, "i");
const ASKS_FOR_IT = new RegExp(
  "\\b(?:provide|send|share|supply|attach|paste|upload|forward)\\s+(?:me\\s+)?" + THE_MISSING_WORK,
  "i",
);

/**
 * "Waiting for the drafts" counts; "waiting for your review" does not. Every
 * place the turn says it is waiting is read, so one mention of a review does
 * not excuse a turn that is still asking for the work somewhere else.
 */
const EVERY_WAIT = /\b(?:still\s+)?wait(?:ing|s)?\s+(?:for|on)\s+([^.?!\n]{0,60})/gi;
const WAITING_ON_A_PERSON =
  /^(?:your|the|a|an|his|her|their|my)?\s*(?:reviews?|approvals?|feedback|repl(?:y|ies)|responses?|answers?|go[- ]?ahead|sign[- ]?off|confirmation|comments?|verdict|decision|word|you\b)/i;

function waitsForTheWork(said: string): boolean {
  for (const match of said.matchAll(EVERY_WAIT)) {
    if (!WAITING_ON_A_PERSON.test(match[1] ?? "")) return true;
  }
  return false;
}

/**
 * Does this turn ask for work it is missing? A hand-in, a question about
 * scope and a status report all answer no.
 */
export function turnAsksForMissingWork(body: string): boolean {
  const said = body ?? "";
  if (HANDS_WORK_IN.test(said)) return false;
  return waitsForTheWork(said) || CANNOT_GO_ON.test(said) || NEEDS_IT.test(said) || ASKS_FOR_IT.test(said);
}

const A_QUESTION = /\?/;
const A_POLITE_REQUEST =
  /\b(please|could you|can you|would you)\b[^.?!]{0,60}\b(provide|send|share|give|supply|attach|paste|tell|confirm)\b/i;
const A_STATED_NEED = /\b(i|we)\s+(need|require|cannot|can'?t)\b/i;

/**
 * Does this turn ask the person for anything at all? Wider than the one above:
 * any question, any request, anything the turn says it cannot do without.
 *
 * A reply that answers no is a restatement. Nobody should have to answer one,
 * which is why the improvement-loop check's stand-in person ignores them, and
 * why a turn like wave 18's "Sure, let's move forward with the plan … Let me
 * know if this plan looks good to you" leaves the person nothing to do.
 */
export function asksThePersonForAnything(body: string): boolean {
  const said = body ?? "";
  return A_QUESTION.test(said) || A_POLITE_REQUEST.test(said) || A_STATED_NEED.test(said) || turnAsksForMissingWork(said);
}

/**
 * The thread as the task should read it this turn. With the work in hand, its
 * own earlier requests for that work come out; with nothing in hand, nothing
 * changes.
 */
export function threadWithoutRequestsForArrivedWork(
  turns: readonly ConversationTurn[],
  opts: { hasInputs: boolean },
): { turns: ConversationTurn[]; dropped: number } {
  if (!opts.hasInputs) return { turns: [...turns], dropped: 0 };
  const kept = turns.filter((turn) => !(turn.role === "agent" && turnAsksForMissingWork(turn.body)));
  return { turns: kept, dropped: turns.length - kept.length };
}

/** The one sentence a task is told when the work it asked for is in front of it. */
export function buildInputsArrivedTurnInstruction(): string {
  return [
    `The work you were waiting for is above, under "${TASK_INPUTS_HEADING}".`,
    "Do not ask for it again and do not say you are still waiting for it.",
    "Use it and do your own task in this reply.",
  ].join(" ");
}

/**
 * Put the arrived work on the turn, take the task's own stale requests out of
 * the thread, and say the sentence above when it is worth saying.
 *
 * The sentence is worth saying when the task actually asked — at least one turn
 * came out — or when what it was handed changed since the last time it woke.
 * It is never said over an instruction Todero already set: the wrap-up and the
 * manager's instructions are the more specific thing to do this turn.
 */
export function applyArrivedInputs(
  context: Record<string, unknown>,
  inputs: readonly ArrivedInput[],
  opts?: { inputsChanged?: boolean },
): void {
  const hasInputs = inputs.length > 0;
  if (hasInputs) {
    context.toderoInputs = inputs.map((input) => ({
      identifier: input.identifier,
      title: input.title,
      body: input.body,
    }));
  } else {
    delete context.toderoInputs;
  }

  const thread = context.toderoThread;
  const filtered = threadWithoutRequestsForArrivedWork(
    Array.isArray(thread) ? (thread as ConversationTurn[]) : [],
    { hasInputs },
  );
  if (Array.isArray(thread)) context.toderoThread = filtered.turns;

  if (!hasInputs) return;
  if (filtered.dropped === 0 && !opts?.inputsChanged) return;
  const alreadySaid = context.toderoTurnInstruction;
  if (typeof alreadySaid === "string" && alreadySaid.trim().length > 0) return;
  context.toderoTurnInstruction = buildInputsArrivedTurnInstruction();
}
