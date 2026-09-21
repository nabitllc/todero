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
// The four refusals quoted below are the real ones, copied from those two
// organizations' comments. Nothing here touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/text-only-worker-judged-on-content.gauntlet.ts
//
// Fails on origin/main, where the reviewer is told nothing about what the
// worker can hand in and its refusal is applied whatever its reason.
import { describe, expect, it } from "vitest";
import {
  buildJudgeComment,
  buildJudgeReviewPrompt,
  planJudgeOutcome,
} from "../../../../server/src/todero/judge.js";
import { buildJudgeRetryInstruction } from "../../../../server/src/todero/judge-apply.js";
import {
  TEXT_ONLY_WORKER_CHECK_NOTE,
  TEXT_ONLY_WORKER_NOTE,
  applyTextOnlyWorkerAllowance,
  isTextOnlyWorker,
  refusalIsOnlyAboutPackaging,
} from "../../../../server/src/todero/judge-text-only-worker.js";

/** Wave 21's first refusal of ZZGAAAAAAAAAAAAAA-4, 19:19:24Z. */
const WAVE_21_FIRST_REFUSAL =
  "The refined guides are provided in plain text format, but they are not ready for publication"
  + " as they lack any visual formatting or layout. To meet the done-when line, the guides need to"
  + " be formatted and exported in a way that is suitable for publication, such as a PDF or a"
  + " well-designed webpage.";

/** Wave 21's second refusal, 19:20:58Z, after the worker handed in a plan. */
const WAVE_21_SECOND_REFUSAL =
  "The work handed in is a plan for refining the guides, but it does not include the actual refined"
  + " guides themselves. The done-when line requires that all four drafts have been reviewed and"
  + " refined to read well, and that the hand-in is the refined guides, ready for publication."
  + " Since the refined guides are missing, the task has not been fully completed.";

/** Wave 20's two refusals of ZZGAAAAAAAAAAA-5, 14:39:18Z and 14:41:41Z. */
const WAVE_20_FIRST_REFUSAL =
  "The work handed in does not meet the done-when line because it lacks the final drafts that have"
  + " been reviewed and edited, and it is not formatted and ready for distribution. The guides are"
  + " in plain text format and have not been reviewed or edited to ensure they are ready for"
  + " publishing.";
const WAVE_20_SECOND_REFUSAL =
  "The work does not meet the done-when line because it has not been reviewed and edited, and the"
  + " final drafts are not ready for publishing. Additionally, the hand-in is not the final guides"
  + " formatted and ready for distribution.";

/** Wave 19's refusal of a draft that really was short of content. */
const A_CONTENT_REFUSAL =
  "The hand-in only contains information for one plant. To pass, it must include information for"
  + " three additional houseplants.";

/** Wave 21's two written-down checks, as the reviewer answered them. */
const CHECKS = [
  "All four drafts have been reviewed and refined to read well.",
  "The hand-in is The refined guides, ready for publication.",
];

/**
 * Refusals that name a packaging word and are still about the writing. The
 * guard has to leave every one of them alone: they are what a reviewer sounds
 * like when it is right, and setting one aside would accept unfinished work in
 * the person's name.
 */
const REFUSALS_ABOUT_THE_WRITING = [
  "The design of the experiment is not described.",
  "The report does not print the totals for Q4.",
  "The presentation of the argument is not clear and it never states the conclusion.",
  "There are no visual examples of the three plants the task named.",
  "The email template never mentions the discount.",
  "It lacks a proper layout and any mention of humidity.",
];

const workerOfWave21 = {
  adapterType: "http",
  adapterConfig: { url: "http://127.0.0.1:11434/v1/chat/completions", model: "qwen2.5-coder:14b" },
};

describe("wave 6: the worker's nature, not the reviewer's wording", () => {
  it("knows the wizard-hired local model can only write, and that an agent with tools cannot be told so", () => {
    expect(isTextOnlyWorker(workerOfWave21)).toBe(true);
    expect(isTextOnlyWorker({ adapterType: "claude_local", adapterConfig: {} })).toBe(false);
  });

  it("tells the reviewer, on the task wave 21 stopped on, what that worker can hand in", () => {
    const prompt = buildJudgeReviewPrompt({
      goal: "Publish a one-page guide to each of four houseplants that survive a dark flat.",
      featureName: "Review and refine",
      doneWhen: "All four drafts have been reviewed and refined to read well.",
      taskTitle: "Review and refine the draft guides",
      expectedOutput: "The refined guides, ready for publication",
      deliverable: "1. Sansevieria (Snake Plant) — low to bright indirect light, water every two to four weeks.",
      checks: CHECKS,
      isLastTaskOfFeature: true,
      workerIsTextOnly: true,
    });
    expect(prompt).toContain(TEXT_ONLY_WORKER_NOTE);
    // Wave 5's list never saw this line: "ready for publication" was not on it.
    expect(prompt).toContain("ready for publication");
  });
});

describe("wave 6: a refusal about packaging is not a reason to send writing back", () => {
  it("reads the refusal that stopped wave 21", () => {
    expect(refusalIsOnlyAboutPackaging(WAVE_21_FIRST_REFUSAL)).toBe(true);
  });

  it("leaves a refusal that names the content itself", () => {
    expect(refusalIsOnlyAboutPackaging(A_CONTENT_REFUSAL)).toBe(false);
    // Wave 21's second refusal was right: the retry was a plan, not the guides.
    expect(refusalIsOnlyAboutPackaging(WAVE_21_SECOND_REFUSAL)).toBe(false);
  });

  it("leaves every refusal that names a packaging word and something written too", () => {
    for (const refusal of REFUSALS_ABOUT_THE_WRITING) {
      expect([refusal, refusalIsOnlyAboutPackaging(refusal)]).toEqual([refusal, false]);
    }
    // Wave 20's own two refusals are of that kind: each asks for a layout and,
    // in the same breath, for drafts that have been reviewed and edited. The
    // guard leaves them standing, and it is the reviewer's brief — the first
    // half of this wave — that answers wave 20.
    expect(refusalIsOnlyAboutPackaging(WAVE_20_FIRST_REFUSAL)).toBe(false);
    expect(refusalIsOnlyAboutPackaging(WAVE_20_SECOND_REFUSAL)).toBe(false);
  });

  it("turns wave 21's send-back into an accept, and says on the line why", () => {
    const allowance = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: WAVE_21_FIRST_REFUSAL,
      checks: [true, false],
      checkTexts: CHECKS,
    });
    expect(allowance.verdict).toBe("pass");
    expect(allowance.checks).toEqual([true, true]);

    const outcome = planJudgeOutcome({
      verdict: allowance.verdict,
      // This task had already been refused once when this reply came back.
      failRounds: 1,
      autoAcceptWhenJudgePasses: true,
    });
    expect(outcome).toEqual({ kind: "accept" });

    const comment = buildJudgeComment({
      verdict: allowance.verdict,
      note: WAVE_21_FIRST_REFUSAL,
      outcome,
      checks: CHECKS,
      checkResults: allowance.checks,
      checkNotes: allowance.allowed.map((allowed) => (allowed ? TEXT_ONLY_WORKER_CHECK_NOTE : null)),
    });
    expect(comment).toContain(`- met (${TEXT_ONLY_WORKER_CHECK_NOTE}) — ${CHECKS[1]}`);
  });

  it("still sends back the draft that only covered one plant", () => {
    const allowance = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: A_CONTENT_REFUSAL,
      checks: [false],
      checkTexts: [CHECKS[1]!],
    });
    expect(allowance.verdict).toBe("fail");
    expect(planJudgeOutcome({
      verdict: allowance.verdict,
      failRounds: 0,
      autoAcceptWhenJudgePasses: true,
    })).toEqual({ kind: "revise", round: 1 });
  });

  it("keeps a send-back when the line the reviewer refused was about the writing", () => {
    // The same packaging-only refusal, against a task whose unmet line asks for
    // content. Nothing here is out of the worker's reach, so nothing is set
    // aside and the work goes back.
    const allowance = applyTextOnlyWorkerAllowance({
      workerIsTextOnly: true,
      verdict: "fail",
      note: WAVE_21_FIRST_REFUSAL,
      checks: [false, false],
      checkTexts: ["Every guide names the light the plant needs.", CHECKS[1]!],
    });
    expect(allowance.checks).toEqual([false, true]);
    expect(allowance.verdict).toBe("fail");
  });
});

describe("wave 6: a send-back asks for the work, not for a plan", () => {
  it("tells the worker to hand in the thing itself", () => {
    const instruction = buildJudgeRetryInstruction();
    expect(instruction).toContain("hand in the work itself");
    expect(instruction).toContain("do not write a plan");
  });
});
