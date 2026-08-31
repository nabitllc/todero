import { describe, expect, it } from "vitest";
import {
  summarizeHeartbeatRunResultJson,
  buildHeartbeatRunIssueComment,
  mergeHeartbeatRunResultJson,
  MAX_FALLBACK_COMMENT_CHARS,
  FALLBACK_COMMENT_CONTINUED_MARKER,
} from "../services/heartbeat-run-summary.js";

describe("summarizeHeartbeatRunResultJson", () => {
  it("truncates text fields and preserves cost aliases", () => {
    const summary = summarizeHeartbeatRunResultJson({
      summary: "a".repeat(600),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      stopReason: "timeout",
      effectiveTimeoutSec: 30,
      timeoutConfigured: true,
      timeoutFired: true,
      nested: { ignored: true },
    });

    expect(summary).toEqual({
      summary: "a".repeat(500),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      stopReason: "timeout",
      effectiveTimeoutSec: 30,
      timeoutConfigured: true,
      timeoutFired: true,
    });
  });

  it("returns null for non-object and irrelevant payloads", () => {
    expect(summarizeHeartbeatRunResultJson(null)).toBeNull();
    expect(summarizeHeartbeatRunResultJson(["nope"] as unknown as Record<string, unknown>)).toBeNull();
    expect(summarizeHeartbeatRunResultJson({ nested: { only: "ignored" } })).toBeNull();
  });
});

describe("buildHeartbeatRunIssueComment", () => {
  it("uses the final summary text for issue comments on successful runs", () => {
    const comment = buildHeartbeatRunIssueComment({
      summary: "## Summary\n\n- fixed deploy config\n- posted issue update",
    });

    expect(comment).toContain("## Summary");
    expect(comment).toContain("- fixed deploy config");
    expect(comment).not.toContain("Run summary");
  });

  it("falls back to result or message when summary is missing", () => {
    expect(buildHeartbeatRunIssueComment({ result: "done" })).toBe("done");
    expect(buildHeartbeatRunIssueComment({ message: "completed" })).toBe("completed");
  });

  it("returns null when there is no usable final text", () => {
    expect(buildHeartbeatRunIssueComment({ costUsd: 1.2 })).toBeNull();
  });

  it("posts a conversational-plan completion that starts with Let me / I'll", () => {
    const plan =
      "Let me check the issue thread first. I'll fetch the latest comments and then decide what to do next.";
    const comment = buildHeartbeatRunIssueComment({ summary: plan });

    expect(comment).toBe(plan);
    expect(comment).toContain("Let me check");
    expect(comment).not.toMatch(/did not post a summary comment/i);
    expect(comment).not.toMatch(/transcript withheld/i);
  });

  it("posts completions that start with Let me / I'll / First,", () => {
    for (const opener of [
      "Let me look into this.",
      "I'll start by reading the file.",
      "First, I'll reproduce the bug.",
    ]) {
      const comment = buildHeartbeatRunIssueComment({ summary: opener });
      expect(comment).toBe(opener);
      expect(comment).not.toMatch(/did not post a summary comment/i);
      expect(comment).not.toMatch(/transcript withheld/i);
    }
  });

  it("does not treat the apostrophe opener as a regex wildcard", () => {
    // Prior regex used `i.ll` where `.` matched any char; these must pass through.
    for (const summary of ["Iall greetings logged.", "I-ll formatting kept."]) {
      expect(buildHeartbeatRunIssueComment({ summary })).toBe(summary);
    }
  });

  it("truncates an over-long completion with continued instead of replacing it with a stub", () => {
    const summary = "x".repeat(1201);
    const comment = buildHeartbeatRunIssueComment({ summary });
    expect(comment).toContain("xxxx");
    expect(comment).toContain(FALLBACK_COMMENT_CONTINUED_MARKER);
    expect(comment).toMatch(/continued/i);
    expect(comment).not.toMatch(/did not post a summary comment/i);
    expect(comment).not.toMatch(/transcript withheld/i);
    expect(comment!.length).toBe(MAX_FALLBACK_COMMENT_CHARS);
  });

  it("posts an over-long Let me / I'll / First, plan truncated with continued, not a stub", () => {
    const plan = "First, I'll map checkout. Let me keep going. " + "next step. ".repeat(200);
    expect(plan.length).toBeGreaterThan(MAX_FALLBACK_COMMENT_CHARS);
    const comment = buildHeartbeatRunIssueComment({ summary: plan });
    expect(comment).toContain("First, I'll map checkout");
    expect(comment).toContain("Let me keep going");
    expect(comment).toContain(FALLBACK_COMMENT_CONTINUED_MARKER);
    expect(comment).toMatch(/continued/i);
    expect(comment).not.toMatch(/did not post a summary comment/i);
    expect(comment).not.toMatch(/transcript withheld/i);
    expect(comment).not.toBe(plan);
    expect(comment!.length).toBe(MAX_FALLBACK_COMMENT_CHARS);
  });

  it("posts a clean, in-length summary with no narration opener normally", () => {
    const summary = "## Summary\n\n- fixed the fallback gate\n- added regression tests";
    expect(buildHeartbeatRunIssueComment({ summary })).toBe(summary);
  });

  it("posts a summary exactly at the length cap", () => {
    const summary = "S" + "x".repeat(1199);
    expect(summary.length).toBe(1200);
    expect(buildHeartbeatRunIssueComment({ summary })).toBe(summary);
  });
});

describe("mergeHeartbeatRunResultJson", () => {
  it("adds adapter summaries into stored result json for comment posting", () => {
    const merged = mergeHeartbeatRunResultJson(
      { stdout: "raw stdout", stderr: "" },
      "## Summary\n\n1. first thing\n2. second thing",
    );

    expect(merged).toEqual({
      stdout: "raw stdout",
      stderr: "",
      summary: "## Summary\n\n1. first thing\n2. second thing",
    });
    expect(buildHeartbeatRunIssueComment(merged)).toBe("## Summary\n\n1. first thing\n2. second thing");
  });

  it("posts only the final adapter summary when raw output contains intermediate narration", () => {
    const merged = mergeHeartbeatRunResultJson(
      { stdout: "Intermediate setup that must not be published" },
      "## Final update\n\n- Remediation verified",
    );

    expect(buildHeartbeatRunIssueComment(merged)).toBe(
      "## Final update\n\n- Remediation verified",
    );
    expect(buildHeartbeatRunIssueComment(merged)).not.toContain("Intermediate setup");
  });

  it("creates a result payload when only a summary exists", () => {
    expect(mergeHeartbeatRunResultJson(null, "done")).toEqual({ summary: "done" });
  });

  it("does not overwrite an explicit summary already returned by the adapter", () => {
    expect(
      mergeHeartbeatRunResultJson(
        { summary: "adapter result", stdout: "raw stdout" },
        "fallback summary",
      ),
    ).toEqual({
      summary: "adapter result",
      stdout: "raw stdout",
    });
  });
});
