import { describe, expect, it } from "vitest";
import { estimateContextTokens } from "@todero/shared";
import {
  budgetChatMessages,
  buildTaskInputsBlock,
  shortenedInputMarker,
  TASK_INPUTS_HEADING,
  TASK_INPUTS_MAX_BUDGET_SHARE,
  effectiveContextLength,
  MAX_REQUESTED_CONTEXT_LENGTH,
  DROPPED_HISTORY_MARKER,
  SHORTENED_INSTRUCTION_MARKER,
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
    expect(effectiveContextLength(8_192)).toBe(8_192);
    expect(effectiveContextLength(16_384)).toBe(16_384);
  });

  it("asks for the measured default, not for everything the model could hold", () => {
    // Measured on a 12 GB card: 16,384 costs nothing over 4,096 and 32,768
    // costs about a quarter of the speed. See the constant's comment.
    expect(MAX_REQUESTED_CONTEXT_LENGTH).toBe(16_384);
    expect(effectiveContextLength(32_768)).toBe(16_384);
    expect(effectiveContextLength(131_072)).toBe(16_384);
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

  it("does not let the turn instruction starve the conversation to nothing", () => {
    // Measured: at a 1,024-token window a 300-word corrective instruction
    // took the whole budget and all 40 history turns were dropped. The
    // instruction is the least important thing in the prompt to keep whole —
    // a model with no memory of the conversation cannot follow it anyway.
    const system = { role: "system", content: `You are Ash. ${"s".repeat(1_000)}` };
    const history = Array.from({ length: 40 }, (_v, index) =>
      turn(index % 2 === 0 ? "assistant" : "user", `turn ${index} ${"x".repeat(400)}`),
    );
    const instruction = turn("user", Array.from({ length: 300 }, () => "again").join(" "));
    const budgeted = budgetChatMessages({
      messages: [system, pinnedTask, ...history, instruction],
      pinnedLeading: 2,
      pinnedTrailing: 1,
      contextLength: 1_024,
    });
    const kept = budgeted.messages.slice(2, -1);
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept[kept.length - 1]).toEqual(history[history.length - 1]);
    // The instruction survives, shortened, and says that it was.
    const last = budgeted.messages[budgeted.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content.startsWith("again again")).toBe(true);
    expect(last.content).toContain(SHORTENED_INSTRUCTION_MARKER);
    expect(estimatePromptTokens(budgeted.messages)).toBeLessThanOrEqual(promptBudgetTokens(1_024));
  });

  it("leaves a turn instruction whole when there is no conversation to protect", () => {
    const instruction = turn("user", Array.from({ length: 300 }, () => "again").join(" "));
    const budgeted = budgetChatMessages({
      messages: [{ role: "system", content: "S".repeat(4_000) }, pinnedTask, instruction],
      pinnedLeading: 2,
      pinnedTrailing: 1,
      contextLength: 1_024,
    });
    expect(budgeted.messages[budgeted.messages.length - 1]).toEqual(instruction);
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

describe("the work a task builds on", () => {
  const drafts = "Draft one: how to sign up.\nDraft two: how to invite a teammate.";

  it("renders nothing when the task waits on nobody", () => {
    expect(buildTaskInputsBlock([], { contextLength: 16_384 })).toBeNull();
    expect(
      buildTaskInputsBlock([{ identifier: "ZZF-3", title: "Write initial drafts", body: "   " }], {
        contextLength: 16_384,
      }),
    ).toBeNull();
  });

  it("carries each predecessor's hand-in under its identifier and title", () => {
    const block = buildTaskInputsBlock(
      [
        { identifier: "ZZF-3", title: "Write initial drafts", body: drafts },
        { identifier: "ZZF-2", title: "Pick the four topics", body: "Sign-up, invites, billing, support." },
      ],
      { contextLength: 16_384 },
    );
    expect(block).not.toBeNull();
    expect(block!).toContain(TASK_INPUTS_HEADING);
    expect(block!).toContain("ZZF-3 — Write initial drafts");
    expect(block!).toContain("ZZF-2 — Pick the four topics");
    expect(block!).toContain(drafts);
    expect(block!).toContain("Sign-up, invites, billing, support.");
    expect(block!).not.toContain("was cut");
  });

  it("cuts a hand-in that will not fit and says which task holds the rest", () => {
    const long = `START ${"guide text ".repeat(4_000)} END`;
    const block = buildTaskInputsBlock(
      [{ identifier: "ZZF-3", title: "Write initial drafts", body: long }],
      { contextLength: 4_096 },
    );
    expect(block).not.toBeNull();
    expect(block!).toContain("START");
    expect(block!).not.toContain("END");
    expect(block!).toContain(shortenedInputMarker("ZZF-3 — Write initial drafts"));
    expect(estimateContextTokens(block!)).toBeLessThanOrEqual(
      promptBudgetTokens(4_096) * TASK_INPUTS_MAX_BUDGET_SHARE,
    );
  });

  it("splits the room evenly, so one long hand-in cannot crowd the others out", () => {
    const long = (word: string) => `${word} ${"filler ".repeat(4_000)}`;
    const block = buildTaskInputsBlock(
      [
        { identifier: "ZZF-2", title: "Pick the four topics", body: long("ALPHA") },
        { identifier: "ZZF-3", title: "Write initial drafts", body: long("BETA") },
      ],
      { contextLength: 4_096 },
    );
    expect(block).not.toBeNull();
    expect(block!).toContain("ALPHA");
    expect(block!).toContain("BETA");
    expect(estimateContextTokens(block!)).toBeLessThanOrEqual(
      promptBudgetTokens(4_096) * TASK_INPUTS_MAX_BUDGET_SHARE,
    );
  });

  it("names the task even when it has no identifier yet", () => {
    const block = buildTaskInputsBlock([{ identifier: null, title: "Write initial drafts", body: drafts }], {
      contextLength: 16_384,
    });
    expect(block!).toContain("Write initial drafts");
  });
});
