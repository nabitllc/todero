/**
 * How much of a conversation fits in the window Todero gave the model.
 *
 * A local model is served with a fixed context window. When the prompt is
 * longer than the window the runtime silently drops the front of it — which is
 * exactly where the system prompt and the format instructions sit. That is how
 * an agent that produced a fenced plan block on turn 3 stops producing one on
 * turn 30: the instructions lost a fight with old chat history.
 *
 * So Todero decides what goes, instead of the runtime. The pinned block (who
 * the agent is, what it knows, the task, and whatever Todero is telling it to
 * do this turn) always survives; the conversation in the middle is trimmed
 * oldest-first, and the prompt says how many turns were left out.
 *
 * Everything here is pure arithmetic on messages, so it can be unit-tested
 * without a runtime.
 */
import {
  CONTEXT_CHARS_PER_TOKEN,
  estimateContextTokens,
  SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH,
  SKILL_PACK_DEFAULT_CONTEXT_LENGTH,
} from "@todero/shared";
import type { ChatCompletionsMessage } from "./chat-completions.js";

/**
 * The window Todero asks a runtime for, and the ceiling on any recorded one.
 *
 * There are two mistakes available here and they are not the same size. Ask
 * for more than the machine can serve and a desktop swaps or the load fails —
 * a model's own maximum is 128k for some, and a 14B held at 128k takes a
 * desktop to its knees. Ask for less than the model can hold and every
 * organization on that machine runs shrunken, quietly, forever; that is the
 * one that actually happened, at 4,096 tokens on a model that holds 32,768.
 *
 * 16,384 is the answer, and it came from a measurement rather than from
 * taste. On this machine — a 12 GB card running qwen2.5-coder:14b, two
 * planning turns each against a padded thread, 2026-09-15:
 *
 *    4,096 → 21.1 tok/s, 24.4 s a turn, nothing spilled off the card
 *   16,384 → 21.3 tok/s, 25.7 s a turn, 2.2 GB spilled
 *   32,768 → 16.0 tok/s, 33.5 s a turn, 5.3 GB spilled
 *
 * Four times the window of the broken default for no measurable cost; the
 * step after that costs about a quarter of the speed and buys room this
 * prompt does not need — 16,384 already carries the whole skill pack, the
 * task and a long thread.
 *
 * A different machine deserves a different answer: a 24 GB card would take
 * 32,768 without spilling, and a laptop on integrated graphics wants less
 * than this. One measured number is not a policy, which is why sizing the
 * window to the machine is queued as its own piece of work in
 * `doc/plans/2026-09-14-any-llm-independence.md`. Until that lands, this is
 * the number, and it is the number because it was measured.
 *
 * Above it Todero does trim, deliberately: it has to name a number in the
 * request. Someone serving more than that loses room, not capability.
 */
export const MAX_REQUESTED_CONTEXT_LENGTH = SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH;

/**
 * The window Todero acts on: the recorded one, never above the ceiling, and
 * null when nothing recorded one. Both the request and the budget use this, so
 * the prompt is never sized for room the request did not ask for.
 */
export function effectiveContextLength(contextLength: number | null | undefined): number | null {
  if (typeof contextLength !== "number" || !Number.isFinite(contextLength) || contextLength <= 0) return null;
  return Math.min(Math.floor(contextLength), MAX_REQUESTED_CONTEXT_LENGTH);
}

/** Role framing and separators the chat template adds around every message. */
export const MESSAGE_FRAMING_TOKENS = 4;

/** The share of the window kept free for the model's own reply. */
const REPLY_RESERVE_SHARE = 0.25;
const REPLY_RESERVE_MIN_TOKENS = 256;
const REPLY_RESERVE_MAX_TOKENS = 2_048;

/** What the model reads where the dropped turns used to be. */
export const DROPPED_HISTORY_MARKER = "Earlier messages in this conversation were left out to fit this model's window";

/**
 * The most of the prompt budget Todero's own turn instruction may take while
 * there is a conversation to protect.
 *
 * Putting the instruction inside the budget was the right move — outside it,
 * the runtime trimmed the system prompt off the front to make room. But it
 * gave the instruction the power to crowd everything else out: measured, a
 * 300-word corrective instruction at a 1,024-token window dropped all 40
 * turns of history. A model that has been told to try again, and cannot see
 * what it did the first time, is not going to do better.
 *
 * So the instruction is capped and the conversation is not. At 16,384 this
 * is around 3,000 tokens and no instruction Todero writes comes close, so it
 * never bites; it exists for the small windows, where something has to give
 * and the instruction is the cheapest thing to shorten.
 */
export const TURN_INSTRUCTION_MAX_BUDGET_SHARE = 0.25;

/** What the model reads where the rest of a shortened instruction would be. */
export const SHORTENED_INSTRUCTION_MARKER =
  "[Todero: the rest of this instruction was cut to leave room for the conversation above.]";

/** About how many tokens one message costs, framing included. */
export function estimateMessageTokens(message: ChatCompletionsMessage): number {
  return estimateContextTokens(message.content) + MESSAGE_FRAMING_TOKENS;
}

/** About how many tokens a whole prompt costs. */
export function estimatePromptTokens(messages: ChatCompletionsMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

/**
 * How many tokens the prompt may take out of a window of this size: all of it
 * but a reserve for the reply. An unknown window is sized for the runtime
 * default (Ollama serves 4,096 tokens unless the person raised it) rather than
 * assumed to be large.
 */
export function promptBudgetTokens(contextLength: number | null | undefined): number {
  const window =
    typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength > 0
      ? Math.floor(contextLength)
      : SKILL_PACK_DEFAULT_CONTEXT_LENGTH;
  const reserve = Math.min(
    REPLY_RESERVE_MAX_TOKENS,
    Math.max(REPLY_RESERVE_MIN_TOKENS, Math.floor(window * REPLY_RESERVE_SHARE)),
  );
  return Math.max(1, window - reserve);
}

function markerText(dropped: number): string {
  const turns = dropped === 1 ? "1 message" : `${dropped} messages`;
  return `[Todero: ${DROPPED_HISTORY_MARKER} — ${turns} from the middle of the thread. The task above and the instructions still apply.]`;
}

export type BudgetedPrompt = {
  messages: ChatCompletionsMessage[];
  /** How many conversation messages were left out. */
  dropped: number;
};

/**
 * The pinned trailing block, shortened to its share of the budget.
 *
 * Only the last message is cut: the block is Todero's own text and the
 * instruction is the last thing in it. When even the cap leaves no room worth
 * keeping, the block is returned whole — a shortened instruction is better
 * than a stub, and the pinned overflow case is already tolerated above.
 */
function shortenTurnInstruction(
  trailing: ChatCompletionsMessage[],
  allowedTokens: number,
): ChatCompletionsMessage[] {
  if (trailing.length === 0 || estimatePromptTokens(trailing) <= allowedTokens) return trailing;
  const last = trailing[trailing.length - 1]!;
  const others = estimatePromptTokens(trailing.slice(0, -1));
  const room =
    allowedTokens - others - MESSAGE_FRAMING_TOKENS - estimateContextTokens(SHORTENED_INSTRUCTION_MARKER);
  if (room <= 0) return trailing;
  const chars = room * CONTEXT_CHARS_PER_TOKEN;
  if (last.content.length <= chars) return trailing;
  return [
    ...trailing.slice(0, -1),
    { ...last, content: `${last.content.slice(0, chars)}\n${SHORTENED_INSTRUCTION_MARKER}` },
  ];
}

/**
 * Fit a prompt into the window.
 *
 * `pinnedLeading` messages at the front (identity, what the agent knows, the
 * task) and `pinnedTrailing` at the back (Todero's instruction for this turn)
 * always survive, even in the pathological case where they alone overflow —
 * losing them is what this exists to prevent. The conversation between them is
 * kept newest-first for as long as it fits; the rest is dropped oldest-first
 * and a marker goes on the last pinned leading message.
 *
 * The one thing the trailing block does not get is unlimited room: while
 * there is any conversation to keep, the instruction is held to
 * `TURN_INSTRUCTION_MAX_BUDGET_SHARE` of the budget and shortened if it is
 * longer. With no conversation to protect it is left exactly as it came.
 */
export function budgetChatMessages(input: {
  messages: ChatCompletionsMessage[];
  pinnedLeading: number;
  pinnedTrailing?: number;
  contextLength?: number | null;
}): BudgetedPrompt {
  const messages = input.messages;
  const leadingCount = Math.max(0, Math.min(input.pinnedLeading, messages.length));
  const trailingCount = Math.max(0, Math.min(input.pinnedTrailing ?? 0, messages.length - leadingCount));
  const leading = messages.slice(0, leadingCount);
  const trailing = trailingCount > 0 ? messages.slice(messages.length - trailingCount) : [];
  const history = messages.slice(leadingCount, messages.length - trailingCount);

  const budget = promptBudgetTokens(input.contextLength);
  if (estimatePromptTokens(messages) <= budget) return { messages, dropped: 0 };

  // The instruction may not take the whole budget while there is a
  // conversation it is asking the model to correct.
  const cappedTrailing =
    history.length > 0
      ? shortenTurnInstruction(trailing, Math.floor(budget * TURN_INSTRUCTION_MAX_BUDGET_SHARE))
      : trailing;

  const pinnedTokens = estimatePromptTokens(leading) + estimatePromptTokens(cappedTrailing);
  // The marker itself costs tokens; it is only ever added when something was
  // dropped, and by here something will be.
  const markerTokens = estimateContextTokens(markerText(history.length));
  let remaining = budget - pinnedTokens - markerTokens;

  const kept: ChatCompletionsMessage[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    const cost = estimateMessageTokens(message);
    if (cost > remaining) break;
    remaining -= cost;
    kept.unshift(message);
  }

  const dropped = history.length - kept.length;
  const markedLeading =
    dropped > 0 && leading.length > 0
      ? [
          ...leading.slice(0, -1),
          {
            ...leading[leading.length - 1]!,
            content: `${leading[leading.length - 1]!.content}\n\n${markerText(dropped)}`,
          },
        ]
      : leading;

  return { messages: [...markedLeading, ...kept, ...cappedTrailing], dropped };
}
