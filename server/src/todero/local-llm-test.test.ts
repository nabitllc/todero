import { describe, expect, it } from "vitest";
import {
  isLoopbackBaseUrl,
  LOCAL_LLM_TEST_PROMPT,
  testLocalLlmConnection,
} from "./local-llm-test.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("isLoopbackBaseUrl", () => {
  it("accepts the addresses the picker can produce", () => {
    expect(isLoopbackBaseUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost:1234")).toBe(true);
    expect(isLoopbackBaseUrl("http://[::1]:8080")).toBe(true);
  });

  it("refuses anything that is not this machine", () => {
    expect(isLoopbackBaseUrl("http://10.0.0.5:11434")).toBe(false);
    expect(isLoopbackBaseUrl("https://api.example.test")).toBe(false);
    expect(isLoopbackBaseUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackBaseUrl("not a url")).toBe(false);
  });
});

describe("testLocalLlmConnection", () => {
  it("sends one short chat completion to the picked model and reports the reply", async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "OK" } }] });
    }) as typeof fetch;

    const result = await testLocalLlmConnection(
      { baseUrl: "http://127.0.0.1:11434/", modelId: "qwen2.5-coder:latest" },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reply).toBe("OK");
    expect(seen!.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(seen!.body.model).toBe("qwen2.5-coder:latest");
    expect(seen!.body.messages).toEqual([{ role: "user", content: LOCAL_LLM_TEST_PROMPT }]);
    expect(seen!.body.stream).toBe(false);
  });

  it("fails when the runtime is not listening", async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch;
    const result = await testLocalLlmConnection({ baseUrl: "http://127.0.0.1:11434", modelId: "m" }, fetchImpl);
    expect(result).toMatchObject({ ok: false, error: "Nothing is listening at that address." });
  });

  it("fails on a non-2xx answer and keeps the runtime's message short", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "model 'm' not found" }, 404)) as typeof fetch;
    const result = await testLocalLlmConnection({ baseUrl: "http://127.0.0.1:11434", modelId: "m" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 404");
      expect(result.error).toContain("not found");
    }
  });

  it("fails when the reply has no text", async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { content: "   " } }] })) as typeof fetch;
    const result = await testLocalLlmConnection({ baseUrl: "http://127.0.0.1:11434", modelId: "m" }, fetchImpl);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no text") });
  });

  it("times out instead of hanging on a stuck model", async () => {
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as typeof fetch;
    const result = await testLocalLlmConnection({ baseUrl: "http://127.0.0.1:11434", modelId: "m" }, fetchImpl, 5);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("did not answer") });
  });

  it("refuses to call anything that is not on this machine", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch;
    const result = await testLocalLlmConnection({ baseUrl: "http://10.0.0.9:11434", modelId: "m" }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
