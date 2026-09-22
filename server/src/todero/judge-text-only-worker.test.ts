// A worker that can only write is judged on what it wrote.
//
// What does that work is the brief: the reviewer is told outright what this
// teammate can hand in. Waves 21 and 22 also had a guard here that read a
// refusal's words and set the refusal aside; it is gone, because it accepted
// unfinished work under reading and never fired on a live run. So what is
// left to hold is who the sentence is said about, and that it reaches the
// reviewer for that worker and nobody else.
import { describe, expect, it } from "vitest";
import { buildJudgeReviewPrompt } from "./judge.js";
import { TEXT_ONLY_WORKER_NOTE, isTextOnlyWorker } from "./judge-text-only-worker.js";

describe("which workers can only write", () => {
  it("is the wizard-hired local model, and nothing with tools", () => {
    expect(isTextOnlyWorker({
      adapterType: "http",
      adapterConfig: { url: "http://127.0.0.1:11434/v1/chat/completions" },
    })).toBe(true);
    expect(isTextOnlyWorker({ adapterType: "http", adapterConfig: { url: "https://x.test/hook" } })).toBe(false);
    expect(isTextOnlyWorker({ adapterType: "claude_local", adapterConfig: {} })).toBe(false);
    expect(isTextOnlyWorker(null)).toBe(false);
  });
});

describe("the reviewer's brief", () => {
  const prompt = (workerIsTextOnly: boolean) =>
    buildJudgeReviewPrompt({
      taskTitle: "Review and refine the draft guides",
      expectedOutput: "The refined guides, ready for publication",
      doneWhen: "All four drafts have been reviewed and refined to read well.",
      deliverable: "1. Snake Plant — low light, water every two to four weeks.",
      checks: ["All four drafts have been reviewed and refined to read well."],
      workerIsTextOnly,
    });

  it("tells the reviewer what a text-only worker can and cannot hand in", () => {
    expect(prompt(true)).toContain(TEXT_ONLY_WORKER_NOTE);
  });

  it("says nothing of the kind about a worker that has tools", () => {
    expect(prompt(false)).not.toContain(TEXT_ONLY_WORKER_NOTE);
  });
});
