import { describe, expect, it } from "vitest";
import {
  buildChatCompletionsBody,
  buildChatCompletionsPrompt,
  isChatCompletionsUrl,
  parseChatCompletionsText,
} from "./chat-completions.js";

const MISSION = "Ship the marketplace";
const TASK_MARKDOWN = `Todero task context:
- Title: "${MISSION}"

Company mission (from onboarding):
${MISSION}

Start from the company mission below.`;

describe("http adapter chat completions prompt", () => {
  it("recognizes the local LLM hire URL", () => {
    expect(isChatCompletionsUrl("http://127.0.0.1:1234/v1/chat/completions")).toBe(true);
    expect(isChatCompletionsUrl("https://example.test/webhook")).toBe(false);
  });

  it("fails if the run-context prompt omits the typed mission", () => {
    const prompt = buildChatCompletionsPrompt({
      toderoTaskMarkdown: TASK_MARKDOWN,
    });
    expect(prompt).toContain(MISSION);
    expect(prompt).toContain("Company mission (from onboarding):");
  });

  it("reads the mission from the issue description when task markdown is missing", () => {
    const prompt = buildChatCompletionsPrompt({
      toderoIssue: {
        title: MISSION,
        description: `Company mission (from onboarding):\n${MISSION}`,
      },
    });
    expect(prompt).toContain(MISSION);
  });

  it("puts the mission on messages — a raw context dump would drop it", () => {
    const body = buildChatCompletionsBody({
      config: { model: "local-model" },
      context: { toderoTaskMarkdown: TASK_MARKDOWN },
      payloadTemplate: {
        messages: [{ role: "system", content: "adapter default with no mission" }],
      },
    });
    expect(body.model).toBe("local-model");
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain(MISSION);
    expect(prompt).not.toContain("adapter default with no mission");
  });
});

describe("parseChatCompletionsText", () => {
  it("reads assistant text from OpenAI-compatible choices", () => {
    expect(
      parseChatCompletionsText({
        choices: [{ message: { role: "assistant", content: "Ship checkout next." } }],
      }),
    ).toBe("Ship checkout next.");
  });

  it("reads text parts and treats empty bodies as no reply", () => {
    expect(
      parseChatCompletionsText({
        choices: [
          { message: { content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] } },
        ],
      }),
    ).toBe("Hello world");
    expect(parseChatCompletionsText({ choices: [] })).toBe("");
    expect(parseChatCompletionsText("")).toBe("");
    expect(parseChatCompletionsText("{ not json")).toBe("");
    expect(parseChatCompletionsText({ choices: [{ message: { content: "  " } }] })).toBe("");
  });
});
