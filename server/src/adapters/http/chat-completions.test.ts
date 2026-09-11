import { describe, expect, it } from "vitest";
import {
  buildChatCompletionsBody,
  buildChatCompletionsMessages,
  buildChatCompletionsPrompt,
  CHAT_COMPLETIONS_CONTINUE_NUDGE,
  CHAT_COMPLETIONS_STATUS_WAITING,
  isChatCompletionsUrl,
  parseChatCompletionsReply,
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

describe("http adapter chat completions conversation", () => {
  it("opens with a system prompt, then the task, then the thread in order", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoThread: [
          { role: "agent", body: "Which city first?" },
          { role: "user", body: "Austin." },
        ],
      },
      { agentName: "Ron" },
    );
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[0]!.content).toContain("You are Ron");
    expect(messages[0]!.content).toContain(CHAT_COMPLETIONS_STATUS_WAITING);
    expect(messages[1]!.content).toContain(MISSION);
    expect(messages[2]!.content).toBe("Which city first?");
    expect(messages[3]!.content).toBe("Austin.");
  });

  it("merges same-side turns and nudges when the thread ends with the agent", () => {
    const messages = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoThread: [
        { role: "agent", body: "Welcome." },
        { role: "agent", body: "Which city first?" },
      ],
    });
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[2]!.content).toBe("Welcome.\n\nWhich city first?");
    expect(messages[3]!.content).toBe(CHAT_COMPLETIONS_CONTINUE_NUDGE);
  });

  it("does not merge the task into a following user turn", () => {
    const messages = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoThread: [{ role: "user", body: "Start with downtown." }],
    });
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
    expect(messages[2]!.content).toBe("Start with downtown.");
  });

  it("ignores malformed thread entries", () => {
    const messages = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoThread: [null, { role: "system", body: "nope" }, { role: "user", body: "   " }, "text"],
    });
    expect(messages).toHaveLength(2);
  });

  it("strips the trailing status line and reads done", () => {
    const reply = parseChatCompletionsReply("Here is the plan.\n\n1. Do A\n2. Do B\n\nSTATUS: done\n");
    expect(reply.body).toBe("Here is the plan.\n\n1. Do A\n2. Do B");
    expect(reply.disposition).toBe("done");
  });

  it("treats a missing or waiting status line as the user's turn", () => {
    expect(parseChatCompletionsReply("What is the budget?").disposition).toBe("waiting");
    const reply = parseChatCompletionsReply("What is the budget?\n**Status: waiting**");
    expect(reply.body).toBe("What is the budget?");
    expect(reply.disposition).toBe("waiting");
  });

  it("does not read a status word from the middle of a reply", () => {
    const reply = parseChatCompletionsReply("STATUS: done is what I will write when finished.\nNot yet.");
    expect(reply.body).toContain("Not yet.");
    expect(reply.disposition).toBe("waiting");
  });
});

describe("http adapter chat completions identity", () => {
  it("opens with who the agent is and the company mission when the heartbeat supplies them", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoIdentity: {
          agentName: "Ash",
          roleTitle: "Chief of Staff",
          companyName: "PoGo Collection+",
          mission: "Track every  Pokemon\nin the collection.",
        },
      },
      { agentName: "fallback" },
    );
    const system = messages[0]!.content;
    expect(system).toContain("You are Ash, Chief of Staff at PoGo Collection+");
    expect(system).toContain("The company mission: Track every Pokemon in the collection.");
  });

  it("falls back to the agent name alone when no identity was supplied", () => {
    const messages = buildChatCompletionsMessages({ toderoTaskMarkdown: TASK_MARKDOWN }, { agentName: "Ron" });
    const system = messages[0]!.content;
    expect(system).toContain("You are Ron, an AI teammate");
    expect(system).not.toContain("The company mission:");
  });
});
