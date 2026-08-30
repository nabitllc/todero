import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { localLlmSelectionIsConnected, toderoLocalLlmApi, type LocalLlmRuntime } from "./local-llm";

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
    expect(mockApi.get).toHaveBeenCalledWith("/todero/local-llm/detect");
  });
});
