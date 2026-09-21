/**
 * The work a task asked for has arrived. Two things follow from that, and this
 * is where both live.
 *
 * Wave 2 of the improvement loop (PR #118) started handing a task the finished
 * work of the tasks it waited on. It arrived, and the task went on asking for
 * it anyway: in wave 17 ZZGAAA-5 was given the four drafts and said "I am still
 * waiting for the four draft guides" thirty times; in wave 18 ZZGAAAAA-3 did
 * the same twenty-one times. The reason was in its own thread. It had already
 * said that thirteen times before the work arrived, and a small local model
 * reads its own last turns as the pattern to follow.
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
 * purpose: everything that is not clearly a request for missing material stays
 * in the thread, because dropping a hand-in or a real question would cost more
 * than leaving one stale sentence in.
 */
const STILL_WAITING = /\b(still\s+)?wait(ing|s)?\s+(for|on)\b/i;
const CANNOT_GO_ON =
  /\b(cannot|can'?t|unable to)\b[^.?!]{0,40}\b(review|complete|proceed|continue|start|begin|finish|go ahead|move forward)\b/i;
const NEEDS_IT = /\b(i|we)\s+(need|require)\s+(the|those|these|them|it|a copy)\b/i;
const ASKS_FOR_IT =
  /\b(provide|send|share|supply|attach|paste|upload|forward)\s+(me\s+)?(the|those|these|them|it|a copy)\b/i;
const WITHOUT_IT = /\bwithout\s+(the|those|these|them|it)\b/i;

/**
 * Does this turn ask for work it is missing? A hand-in, a question about
 * scope and a status report all answer no.
 */
export function turnAsksForMissingWork(body: string): boolean {
  const said = body ?? "";
  return (
    STILL_WAITING.test(said) ||
    CANNOT_GO_ON.test(said) ||
    NEEDS_IT.test(said) ||
    ASKS_FOR_IT.test(said) ||
    WITHOUT_IT.test(said)
  );
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
