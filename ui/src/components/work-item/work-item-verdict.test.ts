import { describe, expect, it } from "vitest";
import {
  extractRoundFromDescription,
  formatVerdictLabel,
  parseVerdictFromComment,
  type VerdictInfo,
} from "./work-item-verdict";

describe("parseVerdictFromComment", () => {
  it("returns null for empty comments", () => {
    expect(parseVerdictFromComment({ body: null })).toBeNull();
    expect(parseVerdictFromComment({ body: "" })).toBeNull();
  });

  it("parses pass+accept verdict", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this and it does what the task asked, so I accepted it.",
    });
    expect(result).toEqual({
      verdict: "pass",
      outcome: "accept",
      note: "",
    });
  });

  it("parses pass+handoff verdict", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this and it does what the task asked. It is ready for you to accept.",
    });
    expect(result).toEqual({
      verdict: "pass",
      outcome: "handoff",
      note: "",
    });
  });

  it("parses fail+revise verdict", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this and it is not finished yet. Sending it back with what to change.",
    });
    expect(result).toEqual({
      verdict: "fail",
      outcome: "revise",
      note: "",
    });
  });

  it("parses fail+exhausted verdict", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this twice and it is still not there. Over to you.",
    });
    expect(result).toEqual({
      verdict: "fail",
      outcome: "exhausted",
      note: "",
    });
  });

  it("extracts note text after verdict", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this and it does what the task asked, so I accepted it.\n\nThe implementation looks good.",
    });
    expect(result?.note).toBe("The implementation looks good.");
  });

  it("handles multi-paragraph notes", () => {
    const result = parseVerdictFromComment({
      body: "I reviewed this and it is not finished yet. Sending it back with what to change.\n\nPlease fix:\n- The styling\n- The spacing",
    });
    expect(result?.note).toContain("Please fix");
    expect(result?.note).toContain("The styling");
  });

  it("returns null for unrecognized verdict text", () => {
    expect(parseVerdictFromComment({ body: "Some random comment" })).toBeNull();
  });
});

describe("extractRoundFromDescription", () => {
  it("returns null for no description", () => {
    expect(extractRoundFromDescription(null)).toBeNull();
    expect(extractRoundFromDescription(undefined)).toBeNull();
    expect(extractRoundFromDescription("")).toBeNull();
  });

  it("extracts round number from marker", () => {
    const desc = "<!-- todero-judge-rounds: 1 -->\nSome task.";
    expect(extractRoundFromDescription(desc)).toBe(1);
  });

  it("handles various whitespace formats", () => {
    expect(extractRoundFromDescription("<!--todero-judge-rounds:2-->")).toBe(2);
    expect(extractRoundFromDescription("<!-- todero-judge-rounds: 2 -->")).toBe(2);
    expect(extractRoundFromDescription("<!--  todero-judge-rounds: 2  -->")).toBe(2);
  });

  it("returns the round count", () => {
    expect(extractRoundFromDescription("<!-- todero-judge-rounds: 1 -->")).toBe(1);
    expect(extractRoundFromDescription("<!-- todero-judge-rounds: 2 -->")).toBe(2);
  });

  it("returns null if marker not found", () => {
    expect(extractRoundFromDescription("Some task without rounds")).toBeNull();
  });
});

describe("formatVerdictLabel", () => {
  const passVerdict: VerdictInfo = { verdict: "pass", outcome: "accept", note: "" };
  const failVerdict: VerdictInfo = { verdict: "fail", outcome: "revise", note: "" };

  it("formats pass verdict", () => {
    expect(formatVerdictLabel(passVerdict, "Nova's reviewer")).toBe(
      "Reviewed by Nova's reviewer · Pass"
    );
  });

  it("formats fail verdict", () => {
    expect(formatVerdictLabel(failVerdict, "Nova's reviewer")).toBe(
      "Reviewed by Nova's reviewer · Sent back"
    );
  });

  it("uses default name when reviewer name is null", () => {
    expect(formatVerdictLabel(passVerdict, null)).toBe("Reviewed by Reviewer · Pass");
  });
});
