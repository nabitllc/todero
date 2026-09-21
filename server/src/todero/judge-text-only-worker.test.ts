// A worker that can only write is judged on what it wrote.
//
// The quoted refusals are the real ones, copied from the archived
// organizations: wave 21 (9d181fc6-75fe-4cc9-ae04-f17e86ac0332, task -4) and
// wave 20 (42c3d5e4-f0fd-4aea-ae98-32e90707d31f, task -5).
import { describe, expect, it } from "vitest";
import { buildJudgeComment, buildJudgeReviewPrompt } from "./judge.js";
import {
  TEXT_ONLY_WORKER_CHECK_NOTE,
  TEXT_ONLY_WORKER_NOTE,
  applyTextOnlyWorkerAllowance,
  isTextOnlyWorker,
  refusalIsOnlyAboutPackaging,
} from "./judge-text-only-worker.js";

/** Wave 21, first refusal of "Review and refine the draft guides". */
const WAVE_21_FIRST_REFUSAL =
  "The refined guides are provided in plain text format, but they are not ready for publication"
  + " as they lack any visual formatting or layout. To meet the done-when line, the guides need to"
  + " be formatted and exported in a way that is suitable for publication, such as a PDF or a"
  + " well-designed webpage.";

/** Wave 21, second refusal: the retry was a plan to format and export, not the guides. */
const WAVE_21_SECOND_REFUSAL =
  "The work handed in is a plan for refining the guides, but it does not include the actual refined"
  + " guides themselves. The done-when line requires that all four drafts have been reviewed and"
  + " refined to read well, and that the hand-in is the refined guides, ready for publication."
  + " Since the refined guides are missing, the task has not been fully completed.";

/** Wave 20, first refusal of "Prepare the guides for publishing". */
const WAVE_20_FIRST_REFUSAL =
  "The work handed in does not meet the done-when line because it lacks the final drafts that have"
  + " been reviewed and edited, and it is not formatted and ready for distribution. The guides are"
  + " in plain text format and have not been reviewed or edited to ensure they are ready for"
  + " publishing.";

/** Wave 19: a refusal about the content itself, which no allowance may touch. */
const CONTENT_REFUSAL =
  "The hand-in only contains information for one plant. To pass, it must include information for"
  + " three additional houseplants.";

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

describe("a refusal that is only about packaging", () => {
  it("recognizes both of the refusals that stopped wave 21 and wave 20", () => {
    expect(refusalIsOnlyAboutPackaging(WAVE_21_FIRST_REFUSAL)).toBe(true);
    expect(refusalIsOnlyAboutPackaging(WAVE_20_FIRST_REFUSAL)).toBe(true);
  });

  it("leaves a refusal that names something about the content itself", () => {
    expect(refusalIsOnlyAboutPackaging(CONTENT_REFUSAL)).toBe(false);
    // Wave 21's second refusal was right: the retry was a plan, not the guides.
    expect(refusalIsOnlyAboutPackaging(WAVE_21_SECOND_REFUSAL)).toBe(false);
  });

  it("leaves a paragraph that complains about nothing at all", () => {
    expect(refusalIsOnlyAboutPackaging("It does what the task asked and reads well.")).toBe(false);
    expect(refusalIsOnlyAboutPackaging("")).toBe(false);
  });
});

describe("what the guard does to the verdict", () => {
  it("records the refused check as met and turns wave 21's send-back into an accept", () => {
    const result = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: WAVE_21_FIRST_REFUSAL,
      checks: [true, false],
    });
    expect(result.checks).toEqual([true, true]);
    expect(result.allowed).toEqual([false, true]);
    expect(result.verdict).toBe("pass");
  });

  it("leaves a content refusal exactly where it was", () => {
    const result = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: CONTENT_REFUSAL,
      checks: [true, false],
    });
    expect(result.checks).toEqual([true, false]);
    expect(result.verdict).toBe("fail");
    expect(result.allowed).toEqual([false, false]);
  });

  it("does nothing for a worker that could have made the file", () => {
    const result = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: false,
      verdict: "fail",
      note: WAVE_21_FIRST_REFUSAL,
      checks: [false],
    });
    expect(result).toEqual({ verdict: "fail", checks: [false], allowed: [false] });
  });

  it("passes a packaging-only refusal that never said which checks it made", () => {
    const result = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: WAVE_20_FIRST_REFUSAL,
      checks: null,
    });
    expect(result.verdict).toBe("pass");
    expect(result.checks).toBeNull();
  });

  it("never touches a pass", () => {
    const result = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "pass",
      note: "It reads well.",
      checks: [true],
    });
    expect(result).toEqual({ verdict: "pass", checks: [true], allowed: [false] });
  });
});

describe("what the person reads afterwards", () => {
  it("says on the line itself why it counts as met", () => {
    const comment = buildJudgeComment({
      verdict: "pass",
      note: WAVE_21_FIRST_REFUSAL,
      outcome: { kind: "accept" },
      checks: ["All four drafts have been reviewed and refined to read well.", "The hand-in is the refined guides, ready for publication."],
      checkResults: [true, true],
      checkNotes: [null, TEXT_ONLY_WORKER_CHECK_NOTE],
    });
    expect(comment).toContain(
      `- met (${TEXT_ONLY_WORKER_CHECK_NOTE}) — The hand-in is the refined guides, ready for publication.`,
    );
  });
});
