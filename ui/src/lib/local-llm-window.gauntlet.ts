// Gauntlet item 2: the wizard says when the model's window is too small for
// the whole pack, and how to raise it. Fails until ui/src/lib/local-llm-window.ts exists.
import { describe, expect, it } from "vitest";
import { localLlmWindowHint, SKILL_PACK_FULL_CHARS } from "./local-llm-window";

describe("localLlmWindowHint", () => {
  it("names the window, what fits, and how to raise it when the pack does not fit", () => {
    const hint = localLlmWindowHint({ contextLength: 4096 });
    expect(hint).not.toBeNull();
    expect(hint).toContain("4,096");
    expect(hint).toContain("OLLAMA_CONTEXT_LENGTH");
    expect(hint).toMatch(/16,384|16384/);
  });

  it("says nothing when the window carries the whole pack", () => {
    expect(localLlmWindowHint({ contextLength: 16384 })).toBeNull();
    expect(localLlmWindowHint({ contextLength: 32768 })).toBeNull();
  });

  it("says nothing when the window is unknown", () => {
    expect(localLlmWindowHint({ contextLength: null })).toBeNull();
    expect(localLlmWindowHint({})).toBeNull();
  });

  it("uses no jargon a person cannot act on", () => {
    const hint = localLlmWindowHint({ contextLength: 4096 }) ?? "";
    for (const word of ["prompt", "injection", "system message", "task kind", "token"]) {
      expect(hint.toLowerCase()).not.toContain(word);
    }
  });

  it("knows how big the whole pack is", () => {
    expect(SKILL_PACK_FULL_CHARS).toBeGreaterThan(10_000);
  });
});
