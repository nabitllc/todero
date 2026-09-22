/**
 * The reviewer: a second pass over a finished task before it reaches the
 * person. A chat-only agent hands in prose, so the only check available is
 * another read of that prose against the feature's "done when" line. The
 * reviewer answers in the same fixed-shape way the worker proposes a plan:
 * one verdict line plus one paragraph, which Todero parses and acts on.
 *
 * Everything here is pure. The model call lives in `judge-review.ts`, the
 * agent record in `judge-agent.ts`, and the application of the outcome in the
 * heartbeat.
 */
import type { ToderoPlan, ToderoPlanFeature, ToderoPlanTask } from "@todero/shared";
import {
  buildAcceptedWorkLines,
  namesPackaging,
  PACKAGING_NOTE,
  type AcceptedFeatureWork,
} from "./judge-feature-work.js";
import { TEXT_ONLY_WORKER_NOTE } from "./judge-text-only-worker.js";

export type JudgeVerdict = "pass" | "fail";

/** Two rejections, then the person decides. A third round of the same 7B model rarely helps. */
export const JUDGE_MAX_FAIL_ROUNDS = 2;

/** How many times this task has already come back from the reviewer. */
const JUDGE_ROUNDS_RE = /<!--\s*todero-judge-rounds:\s*(\d+)\s*-->\s*\n?/gi;

export function buildJudgeRoundsMarker(rounds: number): string {
  return `<!-- todero-judge-rounds: ${Math.max(0, Math.trunc(rounds))} -->`;
}

/**
 * The round count lives in the task description, not a new column: the
 * product stores this kind of per-task bookkeeping in description markers
 * already (the waiting-on-you marker does the same).
 */
export function readJudgeFailRounds(description: string | null | undefined): number {
  const text = description ?? "";
  let rounds = 0;
  for (const match of text.matchAll(JUDGE_ROUNDS_RE)) {
    const value = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(value) && value > rounds) rounds = value;
  }
  return rounds;
}

/** The description with exactly one round marker, or none when the count is zero. */
export function descriptionWithJudgeFailRounds(
  description: string | null | undefined,
  rounds: number,
): string {
  const stripped = (description ?? "").replace(JUDGE_ROUNDS_RE, "");
  const count = Math.max(0, Math.trunc(rounds));
  if (count === 0) return stripped;
  return `${buildJudgeRoundsMarker(count)}\n${stripped.replace(/^\s*\n/, "")}`;
}

const VERDICT_LINE_RE = /^\s*\**\s*(?:final\s+)?verdict\s*:?\s*\**\s*[:\-–—]?\s*\**\s*([A-Za-z ]+?)\s*\**\s*\.?\s*$/i;
const VERDICT_INLINE_RE = /\bverdict\s*[:\-–—]\s*\**\s*(pass|fail|passed|failed|accept|accepted|reject|rejected|approve|approved|ok)\b/i;

const PASS_WORDS = new Set(["pass", "passed", "passes", "accept", "accepted", "approve", "approved", "ok", "yes"]);
const FAIL_WORDS = new Set(["fail", "failed", "fails", "reject", "rejected", "no", "needs work", "not yet"]);

function readVerdictWord(word: string): JudgeVerdict | null {
  const normalized = word.trim().toLowerCase().replace(/\s+/g, " ");
  if (PASS_WORDS.has(normalized)) return "pass";
  if (FAIL_WORDS.has(normalized)) return "fail";
  return null;
}

/** The paragraph a person reads, clipped so one runaway reply cannot fill the thread. */
export const JUDGE_NOTE_MAX_CHARS = 1_200;

function clipNote(note: string): string {
  const collapsed = note.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length > JUDGE_NOTE_MAX_CHARS
    ? `${collapsed.slice(0, JUDGE_NOTE_MAX_CHARS - 1)}…`
    : collapsed;
}

/**
 * Reads `VERDICT: pass|fail` plus the paragraph around it. Tolerant in the
 * same way the plan parser is: bold markers, "Verdict - passed", a verdict
 * sentence in the middle of the reply. Returns null when no verdict can be
 * read at all, which the caller treats as "no review happened".
 */
/**
 * How many checks the reviewer is asked to answer. A small model asked about
 * twenty things answers none of them well, so the list is capped and the
 * first items win.
 */
export const ACCEPTANCE_CHECK_LIMIT = 8;

const ACCEPTANCE_HEADING_RE = /^\s*(?:#{1,6}\s+|\*\*)?acceptance criteria(?:\*\*)?\s*:?\s*$/i;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

/**
 * What this task has to be true for. A task that wrote its own Acceptance
 * Criteria list is checked against that list; a task created from a plan has
 * no list, so the task's hand-in line stands in for one. Returns an empty list
 * when nothing was written down anywhere, which the caller reports rather than
 * papering over.
 *
 * The feature's done-when line is the finish line for the whole feature, not
 * for one task inside it, so it is only something to check on the task the
 * feature ends with. Wave 19 is why: "Draft the second guide" handed in a
 * correct second guide and was sent back because there were not four of them —
 * a criterion that task could never make true, on a loop that could never end.
 * On every earlier task the line is still told to the reviewer, as background.
 * Leaving the flag out keeps the line as a check, which is what a caller that
 * cannot tell where the task sits should get.
 */
export function buildAcceptanceChecks(input: {
  doneWhen?: string | null;
  expectedOutput?: string | null;
  description?: string | null;
  isLastTaskOfFeature?: boolean;
}): string[] {
  const written = readAcceptanceCriteriaSection(input.description);
  const source = written.length > 0
    ? written
    : [
        input.isLastTaskOfFeature === false ? "" : (input.doneWhen ?? "").trim(),
        // Phrased as something that can be true or false. "The work handed in
        // is: X" reads as a label, and a reviewer answering it just restates X.
        (input.expectedOutput ?? "").trim() ? `The hand-in is ${(input.expectedOutput ?? "").trim()}` : "",
      ];
  const seen = new Set<string>();
  const checks: string[] = [];
  for (const raw of source) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push(text);
    if (checks.length >= ACCEPTANCE_CHECK_LIMIT) break;
  }
  return checks;
}

/** The bullets under an "Acceptance Criteria" heading, if the description has one. */
function readAcceptanceCriteriaSection(description: string | null | undefined): string[] {
  const lines = (description ?? "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => ACCEPTANCE_HEADING_RE.test(line));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const bullet = line.match(BULLET_RE);
    // The first line that is not a bullet ends the section, which is how the
    // next heading stops it without needing to know every heading there is.
    if (!bullet) break;
    items.push(bullet[1]!);
  }
  return items;
}

const CHECK_ANSWER_RE = /^\s*\**\s*(\d+)\s*\**\s*[:.)\-]\s*\**\s*(met|not met|unmet|pass|passed|fail|failed|yes|no)\s*\**\s*\.?\s*$/i;
const CHECK_MET_WORDS = new Set(["met", "pass", "passed", "yes"]);

/** One answer per check, in order, or null when the reviewer did not answer them all. */
function readCheckAnswers(lines: string[], expected: number): boolean[] | null {
  if (expected <= 0) return null;
  const byIndex = new Map<number, boolean>();
  for (const line of lines) {
    const match = line.match(CHECK_ANSWER_RE);
    if (!match) continue;
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index) || index < 1 || index > expected) continue;
    if (byIndex.has(index)) continue;
    byIndex.set(index, CHECK_MET_WORDS.has(match[2]!.trim().toLowerCase()));
  }
  // Partial answers are worse than none: they read as a full review that
  // happens to be short. Report nothing and let the comment say so.
  if (byIndex.size !== expected) return null;
  return Array.from({ length: expected }, (_, i) => byIndex.get(i + 1)!);
}

function isCheckAnswerLine(line: string): boolean {
  return CHECK_ANSWER_RE.test(line);
}

export function parseJudgeVerdict(
  text: string,
  expectedChecks = 0,
): { verdict: JudgeVerdict; note: string; checks: boolean[] | null } | null {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const checks = readCheckAnswers(lines, expectedChecks);
  // The per-check answers are bookkeeping. They are rendered as their own
  // list, so they come out of the paragraph a person reads.
  const prose = (keep: string[]) => clipNote(keep.filter((line) => !isCheckAnswerLine(line)).join("\n"));
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]!.match(VERDICT_LINE_RE);
    const verdict = match ? readVerdictWord(match[1]!) : null;
    if (!verdict) continue;
    return { verdict, note: prose([...lines.slice(0, i), ...lines.slice(i + 1)]), checks };
  }
  const inline = (text ?? "").match(VERDICT_INLINE_RE);
  if (inline) {
    const verdict = readVerdictWord(inline[1]!);
    if (verdict) {
      const stripped = (text ?? "").replace(VERDICT_INLINE_RE, "").replace(/\r\n?/g, "\n").split("\n");
      return { verdict, note: prose(stripped), checks };
    }
  }
  return null;
}

export type JudgeOutcome =
  /** The reviewer passed it and the company accepts passes on its own. */
  | { kind: "accept" }
  /** Back to the agent with the reviewer's paragraph; `round` is the new count. */
  | { kind: "revise"; round: number }
  /** The person decides: a pass they still want to see, or two failed rounds. */
  | { kind: "handoff"; because: "passed" | "rounds_exhausted" }
  /** No usable verdict: leave the task exactly as the reply asked for. */
  | { kind: "skip" };

/**
 * What happens to a handed-in task once the reviewer has spoken. The company
 * switch only decides what a *pass* means: accept it now, or put it in front
 * of the person. A fail never auto-accepts.
 */
export function planJudgeOutcome(input: {
  verdict: JudgeVerdict | null;
  failRounds: number;
  autoAcceptWhenJudgePasses: boolean;
  maxFailRounds?: number;
}): JudgeOutcome {
  if (!input.verdict) return { kind: "skip" };
  if (input.verdict === "pass") {
    return input.autoAcceptWhenJudgePasses ? { kind: "accept" } : { kind: "handoff", because: "passed" };
  }
  const max = input.maxFailRounds ?? JUDGE_MAX_FAIL_ROUNDS;
  const alreadyFailed = Math.max(0, Math.trunc(input.failRounds));
  if (alreadyFailed + 1 >= max) return { kind: "handoff", because: "rounds_exhausted" };
  return { kind: "revise", round: alreadyFailed + 1 };
}

/** The plan item this task came from, matched on the title the approval created it with. */
export function findPlanTaskByTitle(plan: ToderoPlan | null, title: string): ToderoPlanTask | null {
  if (!plan) return null;
  const wanted = title.trim().toLowerCase();
  if (!wanted) return null;
  return plan.tasks.find((task) => task.title.trim().toLowerCase() === wanted) ?? null;
}

/**
 * Is this the task the feature ends with — the one after which the feature is
 * finished? The plan lists its tasks in the order they are meant to happen, so
 * the feature's last task is the last one in that list carrying its name. A
 * feature with a single task is finished by that task.
 */
export function isLastTaskOfFeature(plan: ToderoPlan | null, task: ToderoPlanTask | null): boolean {
  if (!plan || !task) return false;
  const wanted = task.feature.trim().toLowerCase();
  const ofFeature = plan.tasks.filter((candidate) => candidate.feature.trim().toLowerCase() === wanted);
  const last = ofFeature[ofFeature.length - 1];
  return Boolean(last && last.id === task.id && last.title === task.title);
}

export function findPlanFeatureForTask(plan: ToderoPlan | null, task: ToderoPlanTask | null): ToderoPlanFeature | null {
  if (!plan || !task) return null;
  const wanted = task.feature.trim().toLowerCase();
  if (!wanted) return null;
  return plan.features.find((feature) => feature.name.trim().toLowerCase() === wanted) ?? null;
}

export const JUDGE_VERDICT_SHAPE = "VERDICT: pass";

/**
 * How the reviewer opens a refusal: once for a send-back, once for the one
 * that puts the task in front of the person. Named because a later pass reads
 * them back off the task to tell a refused hand-in from an accepted one.
 */
export const JUDGE_SENT_BACK_OPENING = "I reviewed this and it is not finished yet.";
export const JUDGE_OVER_TO_YOU_OPENING = "I reviewed this twice and it is still not there.";

/**
 * Of the tasks this one waited on, the ones in the same feature that finished
 * and handed something in. A predecessor in another feature is somebody else's
 * work and is left out: the point is the feature's own finish line.
 */
export function acceptedWorkOfSameFeature(input: {
  plan: ToderoPlan | null;
  featureName: string | null;
  predecessors: { identifier: string | null; title: string; body: string; status: string }[];
}): AcceptedFeatureWork[] {
  const wanted = (input.featureName ?? "").trim().toLowerCase();
  if (!wanted) return [];
  const work: AcceptedFeatureWork[] = [];
  for (const predecessor of input.predecessors) {
    if (predecessor.status !== "done") continue;
    if (!predecessor.body.trim()) continue;
    const planTask = findPlanTaskByTitle(input.plan, predecessor.title);
    if ((planTask?.feature ?? "").trim().toLowerCase() !== wanted) continue;
    work.push({
      identifier: predecessor.identifier,
      title: predecessor.title,
      output: predecessor.body.trim(),
    });
  }
  return work;
}

/**
 * The reviewer's whole prompt. Short on purpose: the same small model that
 * did the work is doing the reviewing, and a long rubric makes it hedge.
 */
export function buildJudgeReviewPrompt(input: {
  goal?: string | null;
  featureName?: string | null;
  doneWhen?: string | null;
  taskTitle: string;
  expectedOutput?: string | null;
  deliverable: string;
  /** What this task has to be true for, from `buildAcceptanceChecks`. */
  checks?: string[];
  /** The same flag `buildAcceptanceChecks` took, so the two agree. */
  isLastTaskOfFeature?: boolean;
  /** What the tasks before this one, in this same feature, already handed in. */
  acceptedWork?: AcceptedFeatureWork[];
  /** True when the worker under review can only write text in a reply. */
  workerIsTextOnly?: boolean;
}): string {
  const parts: string[] = [
    "A teammate has finished a task and handed in the work below. Decide whether it is good enough to show the person who asked for it.",
    "",
  ];
  if (input.goal?.trim()) parts.push(`Goal: ${input.goal.trim()}`);
  if (input.featureName?.trim()) parts.push(`Feature: ${input.featureName.trim()}`);
  // On any task but the one a feature ends with, the feature's finish line is
  // background. Said as a bare "Done when:" line a small model reads it as the
  // bar for this task and fails work that is exactly right.
  const feature = input.featureName?.trim() || "this feature";
  if (input.doneWhen?.trim()) {
    parts.push(
      input.isLastTaskOfFeature === false
        ? `This task is one step of ${feature}, which is finished when: ${input.doneWhen.trim()}. That is the finish line for the whole of ${feature}, not for this task — judge only this task's hand-in.`
        : `Done when: ${input.doneWhen.trim()}`,
    );
  }
  parts.push(`Task: ${input.taskTitle.trim()}`);
  if (input.expectedOutput?.trim()) parts.push(`Was asked to hand in: ${input.expectedOutput.trim()}`);
  const checks = (input.checks ?? []).filter((check) => check.trim());
  // What the rest of the feature already did. Without this the reviewer sees
  // one hand-in and the whole feature's finish line, and refuses the last task
  // for work its own teammates finished and had accepted days earlier.
  parts.push(...buildAcceptedWorkLines(input.acceptedWork));
  if (checks.length > 0) {
    parts.push("", "It has to be true that:");
    checks.forEach((check, index) => parts.push(`${index + 1}. ${check.trim()}`));
  }
  parts.push("", "What was handed in:", '"""', input.deliverable.trim(), '"""', "");
  // What this worker can hand in at all. For one that can only write, that is
  // said outright and covers every line whatever its wording. For anything
  // else — a worker with tools, or one whose adapter could not be read — wave
  // 5's narrower note stands: it fires only on the lines this task is actually
  // held to, its own hand-in line and whatever it has to be true for.
  if (input.workerIsTextOnly) {
    parts.push(TEXT_ONLY_WORKER_NOTE, "");
  } else if (namesPackaging(input.expectedOutput) || checks.some(namesPackaging)) {
    parts.push(PACKAGING_NOTE, "");
  }
  parts.push(
    input.isLastTaskOfFeature === false
      ? "Judge only what is above, and only against this one task. Pass it when it does what this task asked for, even if it could be longer or prettier, and even though the rest of the feature is still to come. Fail it only when something this task asked for is missing or wrong."
      : "Judge only what is above. Pass it when it does what the task asked and meets the done-when line, even if it could be longer or prettier. Fail it only when something the task asked for is missing or wrong.",
    "",
    "Answer in exactly this shape and nothing else:",
  );
  if (checks.length > 0) {
    // One line per check, before the verdict, so a person can see which ones
    // were looked at instead of taking the reviewer's word for it.
    checks.forEach((_, index) => parts.push(`${index + 1}: ${index === 0 ? "met" : "not met"}`));
  }
  parts.push(
    `${JUDGE_VERDICT_SHAPE}`,
    "One short paragraph: why. If it fails, name exactly what to change.",
  );
  return parts.join("\n");
}

/** The reviewer's standing brief, in place of the worker's identity prompt. */
export function buildJudgeSystemPrompt(input: {
  judgeName: string;
  companyName?: string | null;
  skillText?: string | null;
}): string {
  const name = input.judgeName.trim() || "the reviewer";
  const company = input.companyName?.trim();
  const parts = [
    `You are ${name}${company ? ` at ${company}` : ""}, the reviewer on this team. You read finished work and say whether it is ready for the person who asked for it.`,
    "You have no tools. You never rewrite the work yourself and you never ask questions.",
    `Reply with one line \`VERDICT: pass\` or \`VERDICT: fail\`, then one short paragraph. Nothing else.`,
  ];
  if (input.skillText?.trim()) {
    parts.push(input.skillText.trim());
  }
  return parts.join("\n\n");
}

/**
 * The company's zero-human switch. Stored on the existing
 * `interactionResolverGovernance` JSON so no column is added. Missing means
 * off: a company that never opened the setting keeps today's behaviour, where
 * finished work waits in "Waiting on you" until the person accepts it. Nobody
 * hands acceptance to a reviewer without asking for it.
 */
export function readAutoAcceptWhenJudgePasses(governance: unknown): boolean {
  if (!governance || typeof governance !== "object" || Array.isArray(governance)) return false;
  return (governance as Record<string, unknown>).autoAcceptWhenJudgePasses === true;
}

/**
 * The comment the reviewer posts, in the reviewer's own voice.
 *
 * When the task had things written down to check, the comment says which ones
 * were met and which were not. When the reviewer skipped the answers it says
 * that too, in as many words: a review nobody can see into is the one thing
 * this comment must not look like.
 *
 * Met and not met are the reviewer's own answers and nothing else changes
 * them, so the count at the top can never disagree with the reviewer's words
 * underneath. Where an earlier task of the same feature already did the work a
 * line asks for, that is added to the line as a note beside the answer.
 */
export function buildJudgeComment(input: {
  verdict: JudgeVerdict;
  note: string;
  outcome: JudgeOutcome;
  checks?: string[];
  checkResults?: boolean[] | null;
  /** Per check, the earlier accepted task that had already done it, or null. */
  checkAlreadyDone?: (string | null)[];
}): string {
  const note = input.note.trim();
  const checks = (input.checks ?? []).filter((check) => check.trim());
  const results = input.checkResults ?? null;
  const alreadyDone = input.checkAlreadyDone ?? [];
  const body: string[] = [];
  if (checks.length > 0 && results && results.length === checks.length) {
    const met = results.filter(Boolean).length;
    body.push(
      [
        `Checked ${checks.length} thing${checks.length === 1 ? "" : "s"}. ${met} met, ${checks.length - met} not met.`,
        "",
        ...checks.map((check, index) => {
          const answer = results[index] ? "met" : "not met";
          const done = alreadyDone[index];
          return `- ${answer}${done ? ` (already done on ${done} and accepted)` : ""} — ${check}`;
        }),
      ].join("\n"),
    );
  } else if (checks.length > 0) {
    body.push(`It did not say which of the ${checks.length} checks it made, so nobody can see what was looked at.`);
  }
  if (note) body.push(note);
  const rest = body.join("\n\n");
  if (input.verdict === "pass") {
    const head = input.outcome.kind === "accept"
      ? "I reviewed this and it does what the task asked, so I accepted it."
      : "I reviewed this and it does what the task asked. It is ready for you to accept.";
    return rest ? `${head}\n\n${rest}` : head;
  }
  const head = input.outcome.kind === "revise"
    ? `${JUDGE_SENT_BACK_OPENING} Sending it back with what to change.`
    : `${JUDGE_OVER_TO_YOU_OPENING} Over to you.`;
  return rest ? `${head}\n\n${rest}` : head;
}
