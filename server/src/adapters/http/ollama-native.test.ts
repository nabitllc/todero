import { describe, expect, it } from "vitest";
import {
  buildOllamaNativeBody,
  ollamaNativeChatUrl,
  parseOllamaNativeFinishReason,
  parseOllamaNativeText,
} from "./ollama-native.js";

describe("ollamaNativeChatUrl", () => {
  it("points at the endpoint that honours the window", () => {
    expect(ollamaNativeChatUrl("http://127.0.0.1:11434/v1/chat/completions")).toBe(
      "http://127.0.0.1:11434/api/chat",
    );
    expect(ollamaNativeChatUrl("http://127.0.0.1:11434/v1/chat/completions/")).toBe(
      "http://127.0.0.1:11434/api/chat",
    );
  });

  it("answers null for anything that is not the OpenAI-shaped endpoint", () => {
    expect(ollamaNativeChatUrl("https://example.test/webhook")).toBeNull();
    expect(ollamaNativeChatUrl("")).toBeNull();
  });
});

describe("buildOllamaNativeBody", () => {
  it("carries the same conversation and asks for the window Todero recorded", () => {
    const messages = [{ role: "user", content: "hello" }];
    const body = buildOllamaNativeBody({
      body: { model: "qwen2.5-coder:14b", messages },
      contextLength: 16_384,
    });
    expect(body).toEqual({
      model: "qwen2.5-coder:14b",
      messages,
      stream: false,
      options: { num_ctx: 16_384 },
    });
  });

  it("moves the OpenAI-shaped knobs into the options the native endpoint reads", () => {
    const body = buildOllamaNativeBody({
      body: {
        model: "m",
        messages: [],
        temperature: 0.2,
        max_tokens: 900,
        options: { num_ctx: 4096, top_p: 0.9 },
      },
      contextLength: 8_192,
    });
    expect(body.options).toEqual({ top_p: 0.9, temperature: 0.2, num_predict: 900, num_ctx: 8_192 });
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });
});

describe("reading the native reply", () => {
  const raw = JSON.stringify({
    model: "qwen2.5-coder:14b",
    message: { role: "assistant", content: "Here is the plan.\nSTATUS: waiting" },
    done: true,
    done_reason: "stop",
  });

  it("reads the assistant text", () => {
    expect(parseOllamaNativeText(raw)).toBe("Here is the plan.\nSTATUS: waiting");
    expect(parseOllamaNativeText(JSON.parse(raw))).toBe("Here is the plan.\nSTATUS: waiting");
    expect(parseOllamaNativeText("not json")).toBe("");
    expect(parseOllamaNativeText(JSON.stringify({ message: { content: "   " } }))).toBe("");
  });

  it("reads the reason the model stopped, so a cut-off reply is still caught", () => {
    expect(parseOllamaNativeFinishReason(raw)).toBe("stop");
    expect(parseOllamaNativeFinishReason(JSON.stringify({ done_reason: "length" }))).toBe("length");
    expect(parseOllamaNativeFinishReason(JSON.stringify({ done: true }))).toBeNull();
  });
});
