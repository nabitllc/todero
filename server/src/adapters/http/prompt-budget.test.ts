import { describe, expect, it } from "vitest";
import {
  budgetChatMessages,
  effectiveContextLength,
  MAX_REQUESTED_CONTEXT_LENGTH,
  DROPPED_HISTORY_MARKER,
  estimateMessageTokens,
  estimatePromptTokens,
  promptBudgetTokens,
} from "./prompt-budget.js";

function turn(role: "user" | "assistant", body: string) {
  return { role, content: body };
}

describe("promptBudgetTokens", () => {
  it("keeps room for the reply inside the window", () => {
    expect(promptBudgetTokens(16_384)).toBeLessThan(16_384);
    expect(promptBudgetTokens(16_384)).toBeGreaterThan(16_384 * 0.5);
  });

  it("falls back to the runtime default when the window is unknown", () => {
    expect(promptBudgetTokens(null)).toBe(promptBudgetTokens(4096));
    expect(promptBudgetTokens(undefined)).toBe(promptBudgetTokens(4096));
    expect(promptBudgetTokens(0)).toBe(promptBudgetTokens(4096));
    expect(promptBudgetTokens(-10)).toBe(promptBudgetTokens(4096));
  });

  it("grows with the window", () => {
    expect(promptBudgetTokens(32_768)).toBeGreaterThan(promptBudgetTokens(8_192));
  });
});

describe("effectiveContextLength", () => {
  it("takes the recorded window as it is when it is one Todero would ask for", () => {
    expect(effectiveContextLength(4096)).toBe(4096);
    expect(effectiveContextLength(16_384)).toBe(16_384);
    // The window qwen2.5-coder:14b actually holds. Capping this one is what
    // pinned live organizations to an eighth of the model they paid for.
    expect(effectiveContextLength(32_768)).toBe(32_768);
  });

  it("does not ask a machine for the model's whole maximum", () => {
    // /api/show reports what the model was built with — 128k for some — which
    // is not what the machine can serve.
    expect(effectiveContextLength(131_072)).toBe(MAX_REQUESTED_CONTEXT_LENGTH);
    expect(MAX_REQUESTED_CONTEXT_LENGTH).toBe(32_768);
  });

  it("is null when nothing recorded a window", () => {
    expect(effectiveContextLength(null)).toBeNull();
    expect(effectiveContextLength(undefined)).toBeNull();
    expect(effectiveContextLength(0)).toBeNull();
  });
});

describe("estimateMessageTokens", () => {
  it("counts about a token per four characters plus the role framing", () => {
    const tokens = estimateMessageTokens(turn("user", "a".repeat(400)));
    expect(tokens).toBeGreaterThanOrEqual(100);
    expect(tokens).toBeLessThanOrEqual(120);
  });

  it("adds up over a whole prompt", () => {
    const messages = [turn("user", "a".repeat(400)), turn("assistant", "b".repeat(400))];
    expect(estimatePromptTokens(messages)).toBe(
      estimateMessageTokens(messages[0]!) + estimateMessageTokens(messages[1]!),
    );
  });
});

describe("budgetChatMessages", () => {
  const pinnedSystem = { role: "system", content: "You are Ash. Always answer in the fenced block." };
  const pinnedTask = turn("user", "The task: write the plan.");

  it("changes nothing when the whole conversation fits", () => {
    const messages = [pinnedSystem, pinnedTask, turn("assistant", "Here it is."), turn("user", "Thanks.")];
    const budgeted = budgetChatMessages({ messages, pinnedLeading: 2, contextLength: 16_384 });
    expect(budgeted.dropped).toBe(0);
    expect(budgeted.messages).toEqual(messages);
  });

  it("drops the oldest turns first and keeps the newest ones", () => {
    const history = Array.from({ length: 40 }, (_v, index) =>
      turn(index % 2 === 0 ? "assistant" : "user", `turn ${index} ${"x".repeat(400)}`),
    );
    const budgeted = budgetChatMessages({
      messages: [pinnedSystem, pinnedTask, ...history],
      pinnedLeading: 2,
      contextLength: 4096,
    });
    expect(budgeted.dropped).toBeGreaterThan(0);
    const kept = budgeted.messages.slice(2);
    expect(kept[kept.length - 1]).toEqual(history[history.length - 1]);
    expect(kept.some((message) => message.content.startsWith("turn 0 "))).toBe(false);
    expect(estimatePromptTokens(budgeted.messages)).toBeLessThanOrEqual(promptBudgetTokens(4096));
  });

  it("never drops the pinned system prompt or the task, even when they alone overflow", () => {
    const hugeSystem = { role: "system", content: "S".repeat(40_000) };
    const budgeted = budgetChatMessages({
      messages: [hugeSystem, pinnedTask, turn("assistant", "old"), turn("user", "new")],
      pinnedLeading: 2,
      contextLength: 4096,
    });
    expect(budgeted.messages[0]).toEqual(hugeSystem);
    expect(budgeted.messages[1]!.content).toContain(pinnedTask.content);
    expect(budgeted.dropped).toBe(2);
  });

  it("leaves a visible marker on the pinned block when it dropped turns", () => {
    const history = Array.from({ length: 30 }, (_v, index) =>
      turn(index % 2 === 0 ? "assistant" : "user", `turn ${index} ${"y".repeat(400)}`),
    );
    const budgeted = budgetChatMessages({
      messages: [pinnedSystem, pinnedTask, ...history],
      pinnedLeading: 2,
      contextLength: 4096,
    });
    const marked = budgeted.messages[1]!.content;
    expect(marked).toContain(pinnedTask.content);
    expect(marked).toContain(DROPPED_HISTORY_MARKER);
    expect(marked).toContain(String(budgeted.dropped));
    expect(budgeted.messages.filter((m) => m.content.includes(DROPPED_HISTORY_MARKER))).toHaveLength(1);
  });

  it("keeps a pinned trailing instruction whatever else goes", () => {
    const history = Array.from({ length: 30 }, (_v, index) =>
      turn(index % 2 === 0 ? "assistant" : "user", `turn ${index} ${"z".repeat(400)}`),
    );
    const instruction = turn("user", "Write the plan block now.");
    const budgeted = budgetChatMessages({
      messages: [pinnedSystem, pinnedTask, ...history, instruction],
      pinnedLeading: 2,
      pinnedTrailing: 1,
      contextLength: 4096,
    });
    expect(budgeted.messages[budgeted.messages.length - 1]).toEqual(instruction);
    expect(budgeted.dropped).toBeGreaterThan(0);
  });
});
