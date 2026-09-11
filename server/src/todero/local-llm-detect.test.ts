import { describe, expect, it } from "vitest";
import {
  detectLocalLlms,
  localLlmSelectionIsConnected,
  type LocalLlmDetectResult,
} from "./local-llm-detect.js";

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("detectLocalLlms", () => {
  it("returns only reachable runtimes and the models they already have", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.startsWith("http://127.0.0.1:11434")) {
        return jsonOk({ models: [{ name: "llama3.2:latest" }] });
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    const result: LocalLlmDetectResult = await detectLocalLlms(fetchImpl, { env: {} });
    expect(result.runtimes).toEqual([
      {
        id: "ollama",
        kind: "ollama",
        label: "Ollama",
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        models: [{ id: "llama3.2:latest", label: "llama3.2:latest" }],
        parallelism: 1,
      },
    ]);
    expect(
      localLlmSelectionIsConnected({
        runtimes: result.runtimes,
        runtimeId: "ollama",
        modelId: "llama3.2:latest",
      }),
    ).toBe(true);
    expect(
      localLlmSelectionIsConnected({
        runtimes: result.runtimes,
        runtimeId: "ollama",
        modelId: "missing",
      }),
    ).toBe(false);
  });

  it("reports nothing running when every probe fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const result = await detectLocalLlms(fetchImpl);
    expect(result.runtimes).toEqual([]);
    expect(
      localLlmSelectionIsConnected({
        runtimes: result.runtimes,
        runtimeId: "ollama",
        modelId: "llama3.2:latest",
      }),
    ).toBe(false);
  });

  it("parses OpenAI-compatible /v1/models lists", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.startsWith("http://127.0.0.1:1234")) {
        return jsonOk({ data: [{ id: "local-qwen" }] });
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    const result = await detectLocalLlms(fetchImpl, { env: {} });
    expect(result.runtimes.map((r) => r.id)).toEqual(["lmstudio"]);
    expect(result.runtimes[0]?.models).toEqual([{ id: "local-qwen", label: "local-qwen" }]);
    expect(result.runtimes[0]?.parallelism).toBe(1);
  });

  it("reports what Ollama can serve at once from the models it is holding", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "http://127.0.0.1:11434/api/ps") {
        return jsonOk({ models: [{ name: "a" }, { name: "b" }] });
      }
      if (href.startsWith("http://127.0.0.1:11434")) {
        return jsonOk({ models: [{ name: "llama3.2:latest" }] });
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    const result = await detectLocalLlms(fetchImpl, { env: {} });
    expect(result.runtimes[0]?.parallelism).toBe(2);
  });

  it("lets the operator's setting override what the runtime reports", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.startsWith("http://127.0.0.1:11434")) {
        return jsonOk({ models: [{ name: "llama3.2:latest" }] });
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    const result = await detectLocalLlms(fetchImpl, { env: { TODERO_LOCAL_LLM_PARALLELISM: "3" } });
    expect(result.runtimes[0]?.parallelism).toBe(3);
  });
});
