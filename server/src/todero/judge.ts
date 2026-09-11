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
export function parseJudgeVerdict(text: string): { verdict: JudgeVerdict; note: string } | null {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]!.match(VERDICT_LINE_RE);
    const verdict = match ? readVerdictWord(match[1]!) : null;
    if (!verdict) continue;
    const note = clipNote([...lines.slice(0, i), ...lines.slice(i + 1)].join("\n"));
    return { verdict, note };
  }
  const inline = (text ?? "").match(VERDICT_INLINE_RE);
  if (inline) {
    const verdict = readVerdictWord(inline[1]!);
    if (verdict) {
      const note = clipNote((text ?? "").replace(VERDICT_INLINE_RE, "").trim());
      return { verdict, note };
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

export function findPlanFeatureForTask(plan: ToderoPlan | null, task: ToderoPlanTask | null): ToderoPlanFeature | null {
  if (!plan || !task) return null;
  const wanted = task.feature.trim().toLowerCase();
  if (!wanted) return null;
  return plan.features.find((feature) => feature.name.trim().toLowerCase() === wanted) ?? null;
}

export const JUDGE_VERDICT_SHAPE = "VERDICT: pass";

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
}): string {
  const parts: string[] = [
    "A teammate has finished a task and handed in the work below. Decide whether it is good enough to show the person who asked for it.",
    "",
  ];
  if (input.goal?.trim()) parts.push(`Goal: ${input.goal.trim()}`);
  if (input.featureName?.trim()) parts.push(`Feature: ${input.featureName.trim()}`);
  if (input.doneWhen?.trim()) parts.push(`Done when: ${input.doneWhen.trim()}`);
  parts.push(`Task: ${input.taskTitle.trim()}`);
  if (input.expectedOutput?.trim()) parts.push(`Was asked to hand in: ${input.expectedOutput.trim()}`);
  parts.push(
    "",
    "What was handed in:",
    '"""',
    input.deliverable.trim(),
    '"""',
    "",
    "Judge only what is above. Pass it when it does what the task asked and meets the done-when line, even if it could be longer or prettier. Fail it only when something the task asked for is missing or wrong.",
    "",
    "Answer in exactly this shape and nothing else:",
    `${JUDGE_VERDICT_SHAPE}`,
    "One short paragraph: why. If it fails, name exactly what to change.",
  );
  return parts.join("\n");
}

/** The reviewer's standing brief, in place of the worker's identity prompt. */
export function buildJudgeSystemPrompt(input: { judgeName: string; companyName?: string | null }): string {
  const name = input.judgeName.trim() || "the reviewer";
  const company = input.companyName?.trim();
  return [
    `You are ${name}${company ? ` at ${company}` : ""}, the reviewer on this team. You read finished work and say whether it is ready for the person who asked for it.`,
    "You have no tools. You never rewrite the work yourself and you never ask questions.",
    `Reply with one line \`VERDICT: pass\` or \`VERDICT: fail\`, then one short paragraph. Nothing else.`,
  ].join("\n\n");
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

/** The comment the reviewer posts, in the reviewer's own voice. */
export function buildJudgeComment(input: { verdict: JudgeVerdict; note: string; outcome: JudgeOutcome }): string {
  const note = input.note.trim();
  if (input.verdict === "pass") {
    const head = input.outcome.kind === "accept"
      ? "I reviewed this and it does what the task asked, so I accepted it."
      : "I reviewed this and it does what the task asked. It is ready for you to accept.";
    return note ? `${head}\n\n${note}` : head;
  }
  const head = input.outcome.kind === "revise"
    ? "I reviewed this and it is not finished yet. Sending it back with what to change."
    : "I reviewed this twice and it is still not there. Over to you.";
  return note ? `${head}\n\n${note}` : head;
}
