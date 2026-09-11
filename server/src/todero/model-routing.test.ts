import { describe, expect, it } from "vitest";
import { MODEL_ROUTING_TABLE, parseModelSizeB, pickModelForKind, resolveToderoTaskKind } from "./model-routing.js";

describe("parseModelSizeB", () => {
  it("reads a trailing size tag", () => {
    expect(parseModelSizeB("qwen2.5-coder:14b")).toBe(14);
    expect(parseModelSizeB("llama3.1:8b-instruct-q4_0")).toBe(8);
    expect(parseModelSizeB("Meta-Llama-3.1-8B-Instruct")).toBe(8);
  });

  it("returns null when no size marker is present", () => {
    expect(parseModelSizeB("llama3.2:latest")).toBeNull();
    expect(parseModelSizeB("gpt-4o-mini")).toBeNull();
  });
});

describe("pickModelForKind", () => {
  const available = [
    "qwen2.5-coder:14b",
    "qwen2.5-coder:32b",
    "llama3.2:1b",
    "llama3.2:3b",
    "llama3.2:latest",
  ];

  it("prefers the 12-16B class for planning and judging", () => {
    expect(pickModelForKind({ kind: "planning", available, defaultModel: "llama3.2:latest" })).toBe(
      "qwen2.5-coder:14b",
    );
    expect(pickModelForKind({ kind: "judging", available, defaultModel: "llama3.2:latest" })).toBe(
      "qwen2.5-coder:14b",
    );
  });

  it("picks the largest model within the 12-16B window, not merely the first match", () => {
    const withTwoInRange = ["qwen2.5-coder:12b", "qwen2.5-coder:16b"];
    expect(
      pickModelForKind({ kind: "planning", available: withTwoInRange, defaultModel: "default" }),
    ).toBe("qwen2.5-coder:16b");
  });

  it("prefers the smallest available model for formatting", () => {
    expect(pickModelForKind({ kind: "formatting", available, defaultModel: "llama3.2:latest" })).toBe(
      "llama3.2:1b",
    );
  });

  it("uses the default model for drafting and wrap-up", () => {
    expect(pickModelForKind({ kind: "drafting", available, defaultModel: "the-default" })).toBe(
      "the-default",
    );
    expect(pickModelForKind({ kind: "wrap-up", available, defaultModel: "the-default" })).toBe(
      "the-default",
    );
  });

  it("falls back to the default model when no local model matches the preferred class", () => {
    const smallOnly = ["llama3.2:1b", "llama3.2:3b"];
    expect(pickModelForKind({ kind: "planning", available: smallOnly, defaultModel: "the-default" })).toBe(
      "the-default",
    );
  });

  it("falls back to the default model when nothing is available at all", () => {
    expect(pickModelForKind({ kind: "planning", available: [], defaultModel: "the-default" })).toBe(
      "the-default",
    );
    expect(pickModelForKind({ kind: "formatting", available: [], defaultModel: "the-default" })).toBe(
      "the-default",
    );
  });

  it("covers every task kind in the routing table", () => {
    expect(Object.keys(MODEL_ROUTING_TABLE).sort()).toEqual(
      ["drafting", "formatting", "judging", "planning", "wrap-up"].sort(),
    );
  });
});

describe("resolveToderoTaskKind", () => {
  it("is planning for the standing conversation task (no parent, no turn instruction)", () => {
    expect(resolveToderoTaskKind({ turnInstructionPresent: false, hasParentIssue: false })).toBe(
      "planning",
    );
  });

  it("is drafting for a child task created under an approved plan", () => {
    expect(resolveToderoTaskKind({ turnInstructionPresent: false, hasParentIssue: true })).toBe(
      "drafting",
    );
  });

  it("is wrap-up when a closing turn instruction is present, regardless of parent", () => {
    expect(resolveToderoTaskKind({ turnInstructionPresent: true, hasParentIssue: false })).toBe(
      "wrap-up",
    );
    // The precedence that matters: a wrapping-up child task must still route
    // as wrap-up, not silently fall through to drafting because it has a
    // parent. This is exactly the branch a bad merge/rebase could invert.
    expect(resolveToderoTaskKind({ turnInstructionPresent: true, hasParentIssue: true })).toBe(
      "wrap-up",
    );
  });
});
