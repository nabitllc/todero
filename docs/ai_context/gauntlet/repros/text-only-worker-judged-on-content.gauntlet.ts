// Repro — wave 6 of the improvement loop: a worker that can only write text in
// a reply is judged on what it wrote, never on what the writing is not.
//
// Three waves stalled on this, each in different words.
//
// Wave 20 (2026-09-21), organization 42c3d5e4-f0fd-4aea-ae98-32e90707d31f,
// ZZGAAAAAAAAAAA-5 "Prepare the guides for publishing": four finished guides
// were refused twice — "The guides are in plain text format ... it is not
// formatted and ready for distribution".
//
// Wave 21, organization 9d181fc6-75fe-4cc9-ae04-f17e86ac0332,
// ZZGAAAAAAAAAAAAAA-4 "Review and refine the draft guides": the same four
// guides refused for lacking "any visual formatting or layout ... such as a
// PDF or a well-designed webpage". The worker's retry was then a three-step
// plan to format and export them, and the second refusal — that the guides
// themselves were missing — was right.
//
// Wave 5 answered wave 20 with a list of phrases matched against the task's
// own line. Wave 21 said "ready for publication", which was not on the list,
// and the project stopped again. A list of words against a model's vocabulary
// leaks. What does not leak is the worker: a wizard-hired local model talks to
// a chat endpoint and has no tools, so text in a reply is the whole of what it
// can ever hand in. A file, a layout, a PDF, a page, an export — all out of
// its reach by construction, on every task, whatever the wording.
//
// So the reviewer is told that, and then taken at its word. Waves 21 and 22
// also built a guard that read a refusal's words and set the refusal aside
// when they were all about packaging; wave 22 finished a whole project without
// it ever firing, and reading it closely found refusals it would have waved
// through. It is gone, and what is held here is the brief. Nothing here
// touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/text-only-worker-judged-on-content.gauntlet.ts
//
// Fails on origin/main, where the reviewer is told nothing about what the
// worker under review can hand in.
import { describe, expect, it } from "vitest";
import { buildJudgeReviewPrompt } from "../../../../server/src/todero/judge.js";
import { PACKAGING_NOTE } from "../../../../server/src/todero/judge-feature-work.js";
import { buildJudgeRetryInstruction } from "../../../../server/src/todero/judge-apply.js";
import {
  TEXT_ONLY_WORKER_NOTE,
  isTextOnlyWorker,
} from "../../../../server/src/todero/judge-text-only-worker.js";

/** Wave 21's two written-down checks, as the reviewer answered them. */
const CHECKS = [
  "All four drafts have been reviewed and refined to read well.",
  "The hand-in is The refined guides, ready for publication.",
];

const workerOfWave21 = {
  adapterType: "http",
  adapterConfig: { url: "http://127.0.0.1:11434/v1/chat/completions", model: "qwen2.5-coder:14b" },
};

/** The task wave 21 stopped on, as the reviewer was given it. */
const briefFor = (workerIsTextOnly: boolean | undefined) =>
  buildJudgeReviewPrompt({
    goal: "Publish a one-page guide to each of four houseplants that survive a dark flat.",
    featureName: "Review and refine",
    doneWhen: "All four drafts have been reviewed and refined to read well.",
    taskTitle: "Review and refine the draft guides",
    expectedOutput: "The refined guides, ready for publication",
    deliverable: "1. Sansevieria (Snake Plant) — low to bright indirect light, water every two to four weeks.",
    checks: CHECKS,
    isLastTaskOfFeature: true,
    workerIsTextOnly,
  });

describe("wave 6: the worker's nature, not the reviewer's wording", () => {
  it("knows the wizard-hired local model can only write, and that an agent with tools cannot be told so", () => {
    expect(isTextOnlyWorker(workerOfWave21)).toBe(true);
    expect(isTextOnlyWorker({ adapterType: "claude_local", adapterConfig: {} })).toBe(false);
  });

  it("tells the reviewer, on the task wave 21 stopped on, what that worker can hand in", () => {
    const brief = briefFor(true);
    expect(brief).toContain(TEXT_ONLY_WORKER_NOTE);
    // Wave 5's list never saw this line: "ready for publication" was not on it.
    expect(brief).toContain("ready for publication");
  });

  it("says nothing of the kind to the reviewer of a worker that has tools", () => {
    // An agent with tools really can produce a file, so it is not told it
    // cannot, and its brief is word for word the one it had before this wave:
    // wave 5's narrower note, on a task whose own line asks for packaging.
    const brief = briefFor(false);
    expect(brief).not.toContain(TEXT_ONLY_WORKER_NOTE);
    expect(brief).toContain(PACKAGING_NOTE);
    expect(briefFor(undefined)).toBe(brief);
  });
});

describe("wave 6: a send-back asks for the work, not for a plan", () => {
  it("tells the worker to hand in the thing itself", () => {
    const instruction = buildJudgeRetryInstruction();
    expect(instruction).toContain("hand in the work itself");
    expect(instruction).toContain("do not write a plan");
  });
});
