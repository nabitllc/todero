import { describe, expect, it } from "vitest";
import { readJudgeModelConfig, requestJudgeVerdict } from "./judge-review.js";
import { buildJudgeAgentName, isJudgeAgentMetadataFor, buildJudgeAgentMetadata } from "./judge-agent.js";

function completion(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }),
  } as Response;
}

describe("readJudgeModelConfig", () => {
  it("reads the same endpoint and model the worker uses", () => {
    const config = readJudgeModelConfig({
      url: "http://127.0.0.1:11434/v1/chat/completions",
      model: "qwen2.5-coder:14b",
      headers: { authorization: "Bearer x", bad: 3 },
    });
    expect(config).toEqual({
      url: "http://127.0.0.1:11434/v1/chat/completions",
      model: "qwen2.5-coder:14b",
      headers: { authorization: "Bearer x" },
      timeoutMs: 120_000,
    });
  });

  it("falls back to the model in the payload template", () => {
    expect(
      readJudgeModelConfig({
        url: "http://127.0.0.1:1234/v1/chat/completions",
        payloadTemplate: { model: "llama3" },
      })?.model,
    ).toBe("llama3");
  });

  it("refuses anything that is not a chat endpoint", () => {
    expect(readJudgeModelConfig({ url: "https://example.com/webhook" })).toBeNull();
    expect(readJudgeModelConfig({})).toBeNull();
    expect(readJudgeModelConfig(null)).toBeNull();
  });
});

describe("requestJudgeVerdict", () => {
  const config = {
    url: "http://127.0.0.1:11434/v1/chat/completions",
    model: "qwen2.5-coder:14b",
    headers: {},
    timeoutMs: 1_000,
  };

  it("sends one request and reads the verdict out of the reply", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const result = await requestJudgeVerdict({
      config,
      systemPrompt: "You are the reviewer.",
      prompt: "Review this.",
      fetcher: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return completion("VERDICT: fail\nThe prices are missing.");
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ verdict: "fail", note: "The prices are missing." });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.model).toBe("qwen2.5-coder:14b");
    expect(calls[0]!.body.messages[0].role).toBe("system");
    expect(calls[0]!.body.messages[1].content).toBe("Review this.");
  });

  it("returns nothing when the runtime is down, answers badly, or skips the verdict", async () => {
    const down = await requestJudgeVerdict({
      config,
      systemPrompt: "s",
      prompt: "p",
      fetcher: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(down).toBeNull();

    const errored = await requestJudgeVerdict({
      config,
      systemPrompt: "s",
      prompt: "p",
      fetcher: (async () => completion("", 500)) as unknown as typeof fetch,
    });
    expect(errored).toBeNull();

    const rambled = await requestJudgeVerdict({
      config,
      systemPrompt: "s",
      prompt: "p",
      fetcher: (async () => completion("Looks good to me!")) as unknown as typeof fetch,
    });
    expect(rambled).toBeNull();
  });
});

describe("the reviewer agent record", () => {
  it("is named after the agent it reviews for", () => {
    expect(buildJudgeAgentName("Ash")).toBe("Ash's reviewer");
    expect(buildJudgeAgentName("Ross")).toBe("Ross' reviewer");
  });

  it("is found again by its marker", () => {
    const metadata = buildJudgeAgentMetadata("agent-1");
    expect(isJudgeAgentMetadataFor(metadata, "agent-1")).toBe(true);
    expect(isJudgeAgentMetadataFor(metadata, "agent-2")).toBe(false);
    expect(isJudgeAgentMetadataFor({}, "agent-1")).toBe(false);
    expect(isJudgeAgentMetadataFor(null, "agent-1")).toBe(false);
  });
});
