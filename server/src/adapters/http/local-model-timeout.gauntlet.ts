// Gauntlet item 0: a slow local model must not derail the loop. Every turn
// in the wave-1 live loop that failed did so at the http adapter's 180 s
// limit while the model was busy; the recovery paths then took over. A
// local runtime gets a floor well above that, whatever the hire wrote down.
import { describe, expect, it } from "vitest";
import { LOCAL_MODEL_TIMEOUT_FLOOR_MS, resolveHttpAdapterTimeoutMs } from "./local-model-timeout.js";

const localConfig = {
  url: "http://127.0.0.1:11434/v1/chat/completions",
  method: "POST",
  timeoutMs: 180_000,
  model: "qwen2.5-coder:14b",
  localLlm: { runtimeId: "ollama", runtimeLabel: "Ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
};

describe("resolveHttpAdapterTimeoutMs", () => {
  it("gives a local runtime at least ten minutes, even when the hire wrote 180 s", () => {
    expect(LOCAL_MODEL_TIMEOUT_FLOOR_MS).toBeGreaterThanOrEqual(600_000);
    expect(resolveHttpAdapterTimeoutMs(localConfig)).toBeGreaterThanOrEqual(LOCAL_MODEL_TIMEOUT_FLOOR_MS);
  });

  it("keeps a longer value a person set on purpose", () => {
    expect(resolveHttpAdapterTimeoutMs({ ...localConfig, timeoutMs: 1_200_000 })).toBe(1_200_000);
  });

  it("recognises a loopback chat endpoint as local even without the localLlm block", () => {
    const { localLlm: _omit, ...bare } = localConfig;
    expect(resolveHttpAdapterTimeoutMs(bare)).toBeGreaterThanOrEqual(LOCAL_MODEL_TIMEOUT_FLOOR_MS);
  });

  it("leaves a remote webhook's own timeout alone", () => {
    expect(resolveHttpAdapterTimeoutMs({ url: "https://example.test/webhook", timeoutMs: 30_000 })).toBe(30_000);
  });
});
