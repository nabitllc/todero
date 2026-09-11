import { describe, expect, it } from "vitest";
import { parseToderoPlanAssignmentsBlock, taskRefMatches, agentNameMatches } from "./todero-assignments.js";

describe("parseToderoPlanAssignmentsBlock", () => {
  it("parses the plain shape with fenced block", () => {
    const text = "```todero-assignments\nassignments:\n  - ZZW-2: Nova\n  - ZZW-3: Ada\n```";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [
        { taskRef: "ZZW-2", agentName: "Nova" },
        { taskRef: "ZZW-3", agentName: "Ada" },
      ],
    });
  });

  it("parses unfenced block with assignments: header", () => {
    const text = "assignments:\n- ZZW-2: Nova\n- ZZW-3: Ada\nSome more text after.";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [
        { taskRef: "ZZW-2", agentName: "Nova" },
        { taskRef: "ZZW-3", agentName: "Ada" },
      ],
    });
  });

  it("accepts task titles as task references", () => {
    const text = "assignments:\n- Draft the starter guide: Nova\n- List the top twenty cards: Ada";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [
        { taskRef: "Draft the starter guide", agentName: "Nova" },
        { taskRef: "List the top twenty cards", agentName: "Ada" },
      ],
    });
  });

  it("tolerates colon-separated format without bullets", () => {
    const text = "assignments:\nZZW-2: Nova\nZZW-3: Ada";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [
        { taskRef: "ZZW-2", agentName: "Nova" },
        { taskRef: "ZZW-3", agentName: "Ada" },
      ],
    });
  });

  it("ignores lines that don't match the pattern", () => {
    const text = "assignments:\n- ZZW-2: Nova\nSome unrelated text\n- ZZW-3: Ada\nAnother line that breaks the pattern";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result?.assignments).toHaveLength(2);
    expect(result?.assignments[0]).toEqual({ taskRef: "ZZW-2", agentName: "Nova" });
    expect(result?.assignments[1]).toEqual({ taskRef: "ZZW-3", agentName: "Ada" });
  });

  it("returns null when there is no assignments block", () => {
    const text = "Just some regular text with no plan block.";
    expect(parseToderoPlanAssignmentsBlock(text)).toBeNull();
  });

  it("returns null when assignments list is empty", () => {
    const text = "assignments:";
    expect(parseToderoPlanAssignmentsBlock(text)).toBeNull();
  });

  it("handles tilde fences", () => {
    const text = "~~~assignments\nassignments:\n- ZZW-2: Nova\n~~~";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [{ taskRef: "ZZW-2", agentName: "Nova" }],
    });
  });

  it("strips whitespace from task refs and agent names", () => {
    const text = "assignments:\n-   ZZW-2   :   Nova";
    const result = parseToderoPlanAssignmentsBlock(text);
    expect(result).toEqual({
      assignments: [{ taskRef: "ZZW-2", agentName: "Nova" }],
    });
  });
});

describe("taskRefMatches", () => {
  it("matches identifiers exactly", () => {
    expect(taskRefMatches("ZZW-2", "ZZW-2", "Draft the guide")).toBe(true);
  });

  it("matches titles exactly", () => {
    expect(taskRefMatches("Draft the guide", "ZZW-2", "Draft the guide")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(taskRefMatches("DRAFT THE GUIDE", "zzw-2", "draft the guide")).toBe(true);
    expect(taskRefMatches("zzw-2", "ZZW-2", "Draft the guide")).toBe(true);
  });

  it("returns false when neither matches", () => {
    expect(taskRefMatches("Other task", "ZZW-2", "Draft the guide")).toBe(false);
  });

  it("tolerates extra whitespace", () => {
    expect(taskRefMatches("  ZZW-2  ", "  ZZW-2  ", "Draft")).toBe(true);
  });
});

describe("agentNameMatches", () => {
  it("matches case-insensitively", () => {
    expect(agentNameMatches("Nova", "nova")).toBe(true);
    expect(agentNameMatches("NOVA", "Nova")).toBe(true);
  });

  it("tolerates whitespace", () => {
    expect(agentNameMatches("  Nova  ", "  nova  ")).toBe(true);
  });

  it("returns false when not matching", () => {
    expect(agentNameMatches("Nova", "Ada")).toBe(false);
  });
});
