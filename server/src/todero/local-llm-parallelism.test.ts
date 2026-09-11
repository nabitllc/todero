import { describe, expect, it } from "vitest";
import {
  countOllamaLoadedModels,
  detectLocalLlmParallelism,
  readConfiguredLocalLlmParallelism,
  resolveLocalLlmParallelism,
} from "./local-llm-parallelism.js";

describe("resolveLocalLlmParallelism", () => {
  it("prefers the configured value", () => {
    expect(resolveLocalLlmParallelism({ configured: "4", loadedModelCount: 1 })).toBe(4);
    expect(resolveLocalLlmParallelism({ configured: 3 })).toBe(3);
  });

  it("uses the loaded model count when nothing is configured", () => {
    expect(resolveLocalLlmParallelism({ loadedModelCount: 2 })).toBe(2);
  });

  it("answers one when nothing says otherwise", () => {
    expect(resolveLocalLlmParallelism({})).toBe(1);
    expect(resolveLocalLlmParallelism({ configured: "  ", loadedModelCount: 0 })).toBe(1);
    expect(resolveLocalLlmParallelism({ configured: "lots" })).toBe(1);
    expect(resolveLocalLlmParallelism({ configured: "-2" })).toBe(1);
  });

  it("never answers more than the cap", () => {
    expect(resolveLocalLlmParallelism({ configured: "99" })).toBe(8);
  });
});

describe("readConfiguredLocalLlmParallelism", () => {
  it("reads Todero's setting first, then Ollama's", () => {
    expect(readConfiguredLocalLlmParallelism({ TODERO_LOCAL_LLM_PARALLELISM: "2", OLLAMA_NUM_PARALLEL: "5" })).toBe("2");
    expect(readConfiguredLocalLlmParallelism({ OLLAMA_NUM_PARALLEL: "5" })).toBe("5");
    expect(readConfiguredLocalLlmParallelism({})).toBeNull();
  });
});

describe("countOllamaLoadedModels", () => {
  it("counts what the runtime is holding, and shrugs at anything else", () => {
    expect(countOllamaLoadedModels({ models: [{ name: "a" }, { name: "b" }] })).toBe(2);
    expect(countOllamaLoadedModels({ models: [] })).toBe(0);
    expect(countOllamaLoadedModels({})).toBe(0);
    expect(countOllamaLoadedModels(null)).toBe(0);
    expect(countOllamaLoadedModels("nope")).toBe(0);
  });
});

describe("detectLocalLlmParallelism", () => {
  it("asks Ollama what it is holding", async () => {
    const fetcher = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://127.0.0.1:11434/api/ps");
      return { ok: true, json: async () => ({ models: [{ name: "a" }, { name: "b" }, { name: "c" }] }) } as Response;
    }) as typeof fetch;
    await expect(
      detectLocalLlmParallelism({ kind: "ollama", baseUrl: "http://127.0.0.1:11434", fetcher, env: {} }),
    ).resolves.toBe(3);
  });

  it("answers one when the probe fails", async () => {
    const fetcher = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    await expect(
      detectLocalLlmParallelism({ kind: "ollama", baseUrl: "http://127.0.0.1:11434", fetcher, env: {} }),
    ).resolves.toBe(1);
  });

  it("does not probe a runtime that cannot answer the question", async () => {
    const fetcher = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    await expect(
      detectLocalLlmParallelism({ kind: "lmstudio", baseUrl: "http://127.0.0.1:1234", fetcher, env: {} }),
    ).resolves.toBe(1);
  });

  it("uses the operator's setting without probing at all", async () => {
    const fetcher = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    await expect(
      detectLocalLlmParallelism({
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        fetcher,
        env: { OLLAMA_NUM_PARALLEL: "2" },
      }),
    ).resolves.toBe(2);
  });
});
