import { describe, expect, it } from "vitest";
import { localLlmWindowHint, SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH, SKILL_PACK_FULL_CHARS } from "./local-llm-window";

describe("localLlmWindowHint", () => {
  it("names the window, and how to raise it, when the pack does not fit", () => {
    const hint = localLlmWindowHint({ contextLength: 4096 }) ?? "";
    expect(hint).toContain("4,096");
    expect(hint).toContain(`OLLAMA_CONTEXT_LENGTH=${SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH}`);
    expect(hint).toContain("16,384");
    expect(hint).toContain("test the connection again");
  });

  it("says nothing once the window carries the whole pack", () => {
    expect(localLlmWindowHint({ contextLength: SKILL_PACK_COMFORTABLE_CONTEXT_LENGTH })).toBeNull();
    expect(localLlmWindowHint({ contextLength: 32_768 })).toBeNull();
  });

  it("says nothing when the window is unknown or nonsense", () => {
    expect(localLlmWindowHint({ contextLength: null })).toBeNull();
    expect(localLlmWindowHint({})).toBeNull();
    expect(localLlmWindowHint({ contextLength: 0 })).toBeNull();
    expect(localLlmWindowHint({ contextLength: Number.NaN })).toBeNull();
  });

  it("uses no jargon a person cannot act on", () => {
    const hint = (localLlmWindowHint({ contextLength: 4096 }) ?? "").toLowerCase();
    for (const word of ["prompt", "injection", "system message", "task kind", "token"]) {
      expect(hint).not.toContain(word);
    }
  });

  it("knows the pack is bigger than a small window's share", () => {
    expect(SKILL_PACK_FULL_CHARS).toBeGreaterThan(10_000);
  });
});
