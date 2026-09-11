import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { LOCAL_LLM_DETECT_PATH, liveLocalLlmSelection, localLlmSelectionIsConnected, localLlmSelectionParallelism, toderoLocalLlmApi, type LocalLlmRuntime } from "./local-llm";

const ollama: LocalLlmRuntime = {
  id: "ollama:127.0.0.1:11434",
  kind: "ollama",
  label: "Ollama",
  baseUrl: "http://127.0.0.1:11434",
  models: [{ id: "llama3.2:latest", label: "llama3.2:latest" }],
};

describe("localLlmSelectionIsConnected", () => {
  it("is true only when the selected runtime is up and already has the model", () => {
    expect(localLlmSelectionIsConnected({
      runtimes: [ollama],
      runtimeId: ollama.id,
      modelId: "llama3.2:latest",
    })).toBe(true);
    expect(localLlmSelectionIsConnected({
      runtimes: [ollama],
      runtimeId: ollama.id,
      modelId: "missing",
    })).toBe(false);
    expect(localLlmSelectionIsConnected({
      runtimes: [],
      runtimeId: ollama.id,
      modelId: "llama3.2:latest",
    })).toBe(false);
  });
});

describe("toderoLocalLlmApi.detect", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue({ runtimes: [] });
  });

  it("GETs the same /todero/local-llm/detect path the server mounts", async () => {
    await toderoLocalLlmApi.detect();
    expect(LOCAL_LLM_DETECT_PATH).toBe("/todero/local-llm/detect");
    expect(mockApi.get).toHaveBeenCalledWith(LOCAL_LLM_DETECT_PATH);
    expect(mockApi.get).toHaveBeenCalledWith("/todero/local-llm/detect");
  });
});

describe("liveLocalLlmSelection", () => {
  it("clears a leftover pick when detect is empty or the pick is not in the list", () => {
    const leftover = { runtimeId: ollama.id, modelId: "llama3.2:latest" };
    expect(liveLocalLlmSelection([], leftover)).toBeNull();
    expect(liveLocalLlmSelection([ollama], { runtimeId: ollama.id, modelId: "missing" })).toBeNull();
    expect(liveLocalLlmSelection([ollama], leftover)).toEqual(leftover);
  });
});

describe("localLlmSelectionParallelism", () => {
  it("reports what the picked runtime says it can serve at once", () => {
    expect(
      localLlmSelectionParallelism({
        runtimes: [{ ...ollama, parallelism: 3 }],
        runtimeId: ollama.id,
      }),
    ).toBe(3);
  });

  it("answers one when the runtime said nothing, or is not in the list", () => {
    expect(localLlmSelectionParallelism({ runtimes: [ollama], runtimeId: ollama.id })).toBe(1);
    expect(localLlmSelectionParallelism({ runtimes: [ollama], runtimeId: "missing" })).toBe(1);
    expect(localLlmSelectionParallelism({ runtimes: [], runtimeId: null })).toBe(1);
    expect(
      localLlmSelectionParallelism({
        runtimes: [{ ...ollama, parallelism: 0 }],
        runtimeId: ollama.id,
      }),
    ).toBe(1);
  });
});
