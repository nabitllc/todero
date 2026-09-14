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
  estimateContextTokens,
  SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH,
  SKILL_PACK_DEFAULT_CONTEXT_LENGTH,
} from "@todero/shared";
import type { ChatCompletionsMessage } from "./chat-completions.js";

/**
 * The largest window Todero will ask a runtime for.
 *
 * There are two mistakes available here and they are not the same size. Ask
 * for more than the machine can serve and a desktop swaps or the load fails —
 * a model's own maximum is 128k for some, and a 14B held at 128k takes a
 * desktop to its knees. Ask for less than the model can hold and every
 * organization on that machine runs shrunken, quietly, forever; that is the
 * one that actually happened, at 4,096 tokens on a model that holds 32,768.
 *
 * So the ceiling is 32,768, not the wizard's 16,384 comfort recommendation.
 * 16,384 was chosen as "enough for the skill pack, the task and a long
 * thread", which is a comfort number, not a hardware limit: it would have
 * capped qwen2.5-coder:14b — the model this is actually run with — to half of
 * what it holds. 32k of KV cache on a 14B is roughly two gigabytes, which the
 * machines Todero targets can pay; 128k is not, so the ceiling stays.
 *
 * Above it Todero does trim, deliberately: it has to name a number in the
 * request, and 32k already carries the whole pack, the task and a long
 * thread. Someone serving more than that loses room, not capability.
 */
export const MAX_REQUESTED_CONTEXT_LENGTH = 2 * SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH;

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
 * Fit a prompt into the window.
 *
 * `pinnedLeading` messages at the front (identity, what the agent knows, the
 * task) and `pinnedTrailing` at the back (Todero's instruction for this turn)
 * always survive, even in the pathological case where they alone overflow —
 * losing them is what this exists to prevent. The conversation between them is
 * kept newest-first for as long as it fits; the rest is dropped oldest-first
 * and a marker goes on the last pinned leading message.
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

  const pinnedTokens = estimatePromptTokens(leading) + estimatePromptTokens(trailing);
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

  return { messages: [...markedLeading, ...kept, ...trailing], dropped };
}
