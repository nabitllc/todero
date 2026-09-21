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
  readChatCompletionsInputs,
} from "./chat-completions.js";
import { estimatePromptTokens, promptBudgetTokens } from "./prompt-budget.js";

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

  it("keeps Todero's own markers out of the prompt", () => {
    const prompt = buildChatCompletionsPrompt({
      toderoIssue: {
        title: "Write the sign-up spec",
        description: "<!-- todero-type: Task -->\n<!-- todero-blocked-by: waiting-on-you -->\nGoal: Ship it",
      },
    });
    expect(prompt).not.toContain("todero-type");
    expect(prompt).not.toContain("todero-blocked-by");
    expect(prompt).toContain("Goal: Ship it");
    expect(prompt).toContain("Write the sign-up spec");
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

describe("http adapter chat completions model routing", () => {
  it("keeps the configured model unchanged when the heartbeat named no task kind", () => {
    const body = buildChatCompletionsBody({
      config: { model: "the-default" },
      context: {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoAvailableModels: ["qwen2.5-coder:14b"],
      },
      payloadTemplate: {},
    });
    expect(body.model).toBe("the-default");
  });

  it("routes planning to the 12-16B class when one is available", () => {
    const body = buildChatCompletionsBody({
      config: { model: "the-default" },
      context: {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoTaskKind: "planning",
        toderoAvailableModels: ["llama3.2:1b", "qwen2.5-coder:14b"],
      },
      payloadTemplate: {},
    });
    expect(body.model).toBe("qwen2.5-coder:14b");
  });

  it("routes drafting to the default model even when a bigger one is available", () => {
    const body = buildChatCompletionsBody({
      config: { model: "the-default" },
      context: {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoTaskKind: "drafting",
        toderoAvailableModels: ["qwen2.5-coder:14b"],
      },
      payloadTemplate: {},
    });
    expect(body.model).toBe("the-default");
  });

  it("falls back to the default model for planning when nothing in range is available", () => {
    const body = buildChatCompletionsBody({
      config: { model: "the-default" },
      context: {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoTaskKind: "planning",
        toderoAvailableModels: ["llama3.2:1b"],
      },
      payloadTemplate: {},
    });
    expect(body.model).toBe("the-default");
  });

  it("ignores an unrecognized task kind and keeps the configured model", () => {
    const body = buildChatCompletionsBody({
      config: { model: "the-default" },
      context: {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoTaskKind: "not-a-real-kind",
        toderoAvailableModels: ["qwen2.5-coder:14b"],
      },
      payloadTemplate: {},
    });
    expect(body.model).toBe("the-default");
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

  it("adds skill text as a second system message when present", () => {
    const skillText = "## Ask or Decide\n\nAsk at most three questions...";
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoSkillText: skillText,
        toderoThread: [
          { role: "agent", body: "Which city first?" },
          { role: "user", body: "Austin." },
        ],
      },
      { agentName: "Ron" },
    );
    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user", "assistant", "user"]);
    expect(messages[0]!.content).toContain("You are Ron");
    expect(messages[1]!.content).toBe(skillText);
    expect(messages[2]!.content).toContain(MISSION);
    expect(messages[3]!.content).toBe("Which city first?");
    expect(messages[4]!.content).toBe("Austin.");
  });

  it("does not add skill text message when skill text is empty", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoSkillText: "",
        toderoThread: [{ role: "user", body: "Start here." }],
      },
      { agentName: "Ron" },
    );
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
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

  it("keeps the first turn of the conversation out of the task, skills or not", () => {
    // The task is the opening user message and nothing from the thread is ever
    // folded into it. Adding a second system message moved where the opening
    // block ends, which is why this is asserted both ways.
    const withSkills = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoSkillText: "What you know\n\n## plan\n\nHow to plan.",
      toderoThread: [{ role: "user", body: "Start now." }],
    });
    expect(withSkills.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
    expect(withSkills[2]!.content).not.toContain("Start now.");
    expect(withSkills[3]!.content).toBe("Start now.");

    const withoutSkills = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoThread: [{ role: "user", body: "Start now." }],
    });
    expect(withoutSkills.map((m) => m.role)).toEqual(["system", "user", "user"]);
  });

  it("still merges same-side turns inside the conversation when skills are present", () => {
    const messages = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoSkillText: "What you know\n\n## plan\n\nHow to plan.",
      toderoThread: [
        { role: "user", body: "First." },
        { role: "user", body: "Second." },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user", "user"]);
    expect(messages[3]!.content).toBe("First.\n\nSecond.");
  });

  it("preserves turn instruction at the end even with skill text", () => {
    const skillText = "**What your agent knows:**\n\nSkill content";
    const turnInstruction = "Wrap up: summarize what you did.";
    const messages = buildChatCompletionsMessages({
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoSkillText: skillText,
      toderoTurnInstruction: turnInstruction,
      toderoThread: [{ role: "user", body: "Please start." }],
    });
    const lastMessage = messages[messages.length - 1]!;
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toContain(turnInstruction);
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

describe("status line tacked onto the last sentence", () => {
  it("reads a status wrapped in backticks, as the instruction itself shows it", () => {
    const line = parseChatCompletionsReply("Here is the concept document.\n\n`STATUS: done`");
    expect(line.disposition).toBe("done");
    expect(line.body).toBe("Here is the concept document.");
    const suffix = parseChatCompletionsReply("Thank you for your review. Here is the final document. `STATUS: done`");
    expect(suffix.disposition).toBe("done");
    expect(suffix.body).toBe("Thank you for your review. Here is the final document.");
    const waiting = parseChatCompletionsReply("If any changes are needed, please let me know. `STATUS: waiting`");
    expect(waiting.disposition).toBe("waiting");
  });

  it("strips a trailing status suffix and reads it", () => {
    const reply = parseChatCompletionsReply("Which provider do you want? Please choose one. STATUS: waiting");
    expect(reply.body).toBe("Which provider do you want? Please choose one.");
    expect(reply.disposition).toBe("waiting");
    const done = parseChatCompletionsReply("Here is the spec.\n\n1. Form\n2. Code **STATUS: done**");
    expect(done.body).toBe("Here is the spec.\n\n1. Form\n2. Code");
    expect(done.disposition).toBe("done");
  });
});

describe("the window Todero sets for the model", () => {
  const OLLAMA = {
    url: "http://127.0.0.1:11434/v1/chat/completions",
    model: "qwen2.5-coder:14b",
    localLlm: { runtimeId: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
  };

  it("asks Ollama for the window the connection test recorded", () => {
    const body = buildChatCompletionsBody({
      config: OLLAMA,
      context: { toderoTaskMarkdown: TASK_MARKDOWN, toderoContextLength: 16_384 },
      payloadTemplate: {},
    });
    expect(body.options).toEqual({ num_ctx: 16_384 });
  });

  it("invents no window when none was recorded", () => {
    const body = buildChatCompletionsBody({
      config: OLLAMA,
      context: { toderoTaskMarkdown: TASK_MARKDOWN },
      payloadTemplate: {},
    });
    expect(body.options).toBeUndefined();
  });

  it("keeps whatever else the payload template already asked Ollama for", () => {
    const body = buildChatCompletionsBody({
      config: OLLAMA,
      context: { toderoTaskMarkdown: TASK_MARKDOWN, toderoContextLength: 8_192 },
      payloadTemplate: { options: { temperature: 0.2 } },
    });
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 8_192 });
  });

  it("asks for no more than Todero needs, whatever the model could hold", () => {
    const body = buildChatCompletionsBody({
      config: OLLAMA,
      context: { toderoTaskMarkdown: TASK_MARKDOWN, toderoContextLength: 131_072 },
      payloadTemplate: {},
    });
    expect(body.options).toEqual({ num_ctx: 16_384 });
  });

  it("stops at the measured window even when the model holds twice it", () => {
    // 32,768 is what qwen2.5-coder:14b holds and what this machine measured
    // as a quarter slower for room the prompt does not use.
    const body = buildChatCompletionsBody({
      config: OLLAMA,
      context: { toderoTaskMarkdown: TASK_MARKDOWN, toderoContextLength: 32_768 },
      payloadTemplate: {},
    });
    expect(body.options).toEqual({ num_ctx: 16_384 });
  });

  it("sends no Ollama option to an endpoint that is not Ollama", () => {
    const body = buildChatCompletionsBody({
      config: { url: "https://api.example.test/v1/chat/completions", model: "gpt-x" },
      context: { toderoTaskMarkdown: TASK_MARKDOWN, toderoContextLength: 16_384 },
      payloadTemplate: {},
    });
    expect(body.options).toBeUndefined();
  });
});

describe("budgeting the prompt against the window", () => {
  function longThread(count: number) {
    return Array.from({ length: count }, (_v, index) => ({
      role: index % 2 === 0 ? "user" : "agent",
      body: `turn ${index}: ${"word ".repeat(120)}`,
    }));
  }

  it("keeps the system prompt, what the agent knows, and the task when the thread is too long", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoSkillText: `Always answer with a fenced todero-plan block. ${"detail ".repeat(200)}`,
        toderoThread: longThread(40),
        toderoContextLength: 4096,
      },
      { agentName: "Ash" },
    );
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("You are Ash");
    expect(messages[1]!.content).toContain("Always answer with a fenced todero-plan block.");
    expect(messages[2]!.content).toContain(MISSION);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("turn 39");
    expect(joined).not.toContain("turn 0:");
    expect(joined).toMatch(/left out/i);
  });

  it("leaves a short conversation exactly as it was", () => {
    const context = {
      toderoTaskMarkdown: TASK_MARKDOWN,
      toderoThread: [
        { role: "agent", body: "Here is my question." },
        { role: "user", body: "Here is my answer." },
      ],
      toderoContextLength: 16_384,
    };
    const messages = buildChatCompletionsMessages(context, { agentName: "Ash" });
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Here is my question.");
    expect(joined).toContain("Here is my answer.");
    expect(joined).not.toMatch(/left out/i);
  });

  /**
   * The turn instruction is pinned at the back of the budget, not stapled on
   * after it. Appended afterwards its tokens are free, and a long instruction
   * (the corrective "write the plan again, here is the shape") pushes the
   * prompt past the window it was just trimmed to fit — which drops the front
   * of it, which is the system prompt this whole file exists to protect.
   */
  it("keeps Todero's own turn instruction last and counts it against the window", () => {
    const instruction = `Write the plan block now, nothing else. ${"shape detail ".repeat(300)}`;
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoThread: longThread(40),
        toderoTurnInstruction: instruction,
        toderoContextLength: 4096,
      },
      { agentName: "Ash" },
    );
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("Write the plan block now, nothing else.");
    expect(messages[0]!.content).toContain("You are Ash");
    expect(estimatePromptTokens(messages)).toBeLessThanOrEqual(promptBudgetTokens(4096));
  });
});

/**
 * A task that waits on another one used to wake with no idea what that task
 * produced. Observed 2026-09-20: the reviewer asked for the drafts five times
 * and the project ended with two of five tasks blocked. The finished work now
 * travels with the task, pinned, right after what the agent knows.
 */
describe("the work a task builds on reaches the model", () => {
  const DRAFTS = "Draft one: how to sign up. Draft two: how to invite a teammate.";

  function thread(count: number) {
    return Array.from({ length: count }, (_v, index) => ({
      role: index % 2 === 0 ? "user" : "agent",
      body: `turn ${index}: ${"word ".repeat(120)}`,
    }));
  }

  it("renders nothing when the task waits on nobody", () => {
    expect(readChatCompletionsInputs({})).toBeNull();
    expect(readChatCompletionsInputs({ toderoInputs: [] })).toBeNull();
    expect(readChatCompletionsInputs({ toderoInputs: [{ identifier: "ZZF-3", title: "Drafts", body: " " }] }))
      .toBeNull();
  });

  it("leaves every other prompt exactly as it was", () => {
    const base = { toderoTaskMarkdown: TASK_MARKDOWN, toderoSkillText: "SKILL", toderoContextLength: 16_384 };
    const without = buildChatCompletionsMessages(base, { agentName: "Ash" });
    const withEmpty = buildChatCompletionsMessages({ ...base, toderoInputs: [] }, { agentName: "Ash" });
    expect(withEmpty).toEqual(without);
  });

  it("puts the finished work after what the agent knows and before the task", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoSkillText: "SKILL TEXT",
        toderoContextLength: 16_384,
        toderoInputs: [{ identifier: "ZZF-3", title: "Write initial drafts", body: DRAFTS }],
      },
      { agentName: "Ash" },
    );
    const skillIndex = messages.findIndex((message) => message.content.includes("SKILL TEXT"));
    const inputsIndex = messages.findIndex((message) => message.content.includes(DRAFTS));
    const taskIndex = messages.findIndex((message) => message.content.includes(MISSION) && message.role === "user");
    expect(skillIndex).toBe(1);
    expect(inputsIndex).toBe(skillIndex + 1);
    expect(taskIndex).toBe(inputsIndex + 1);
    expect(messages[inputsIndex]!.role).toBe("system");
    expect(messages[inputsIndex]!.content).toContain("ZZF-3 — Write initial drafts");
  });

  it("keeps the finished work when the conversation is trimmed", () => {
    const messages = buildChatCompletionsMessages(
      {
        toderoTaskMarkdown: TASK_MARKDOWN,
        toderoThread: thread(40),
        toderoContextLength: 4_096,
        toderoInputs: [{ identifier: "ZZF-3", title: "Write initial drafts", body: DRAFTS }],
      },
      { agentName: "Ash" },
    );
    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain(DRAFTS);
    expect(joined).toMatch(/left out/i);
    expect(estimatePromptTokens(messages)).toBeLessThanOrEqual(promptBudgetTokens(4_096));
  });
});
