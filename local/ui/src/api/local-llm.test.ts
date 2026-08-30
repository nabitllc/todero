import { describe, expect, it } from "vitest";
import { localLlmSelectionIsConnected, type LocalLlmRuntime } from "./local-llm";

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
